-- Sprints 22 and 23: pilot cut-over runs with timed steps and reconciliation snapshots, hypercare issues,
-- fee period locks and month-end closes. Design note docs/design/18-pilot-cutover-hypercare.md.

-- ===========================================================================
-- 1. Cut-over runs, steps and snapshots
-- ===========================================================================
CREATE TABLE cutover_runs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  kind         TEXT NOT NULL CHECK (kind IN ('rehearsal', 'final')),
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'done', 'aborted')),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  signed_off_by BIGINT REFERENCES users(id),
  signed_off_at TIMESTAMPTZ,
  notes        TEXT,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cutover_runs_by_school ON cutover_runs (school_id, created_at DESC);
CALL app.apply_tenant_rls('cutover_runs');

CREATE TABLE cutover_steps (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  run_id       BIGINT NOT NULL REFERENCES cutover_runs(id) ON DELETE CASCADE,
  sequence     INT NOT NULL,
  phase        TEXT NOT NULL,
  code         TEXT NOT NULL,
  title        TEXT NOT NULL,
  owner_role   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
  done_by      BIGINT REFERENCES users(id),
  done_at      TIMESTAMPTZ,
  duration_s   INT,
  note         TEXT,
  UNIQUE (run_id, code)
);
CALL app.apply_tenant_rls('cutover_steps');

CREATE TABLE cutover_snapshots (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  run_id       BIGINT NOT NULL REFERENCES cutover_runs(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('legacy', 'live')),
  counts       JSONB NOT NULL,
  taken_by     BIGINT REFERENCES users(id),
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('cutover_snapshots');

-- Counts of the working school and year under the caller's row-level security; the live half of the
-- cut-over reconciliation and the number the go-live runbook compares with the legacy reports.
CREATE OR REPLACE FUNCTION app.live_counts()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'students',        (SELECT count(*) FROM students WHERE deleted_at IS NULL AND status = 'active'),
    'guardians',       (SELECT count(*) FROM guardians WHERE deleted_at IS NULL AND status = 'active'),
    'employees',       (SELECT count(*) FROM employees WHERE deleted_at IS NULL AND status = 'active'),
    'enrolments',      (SELECT count(*) FROM enrolments WHERE academic_year_id = app.current_academic_year_id() AND status = 'active'),
    'fee_demand',      (SELECT COALESCE(sum(net), 0) FROM fee_demands WHERE academic_year_id = app.current_academic_year_id()),
    'receipts',        (SELECT count(*) FROM fee_payments WHERE academic_year_id = app.current_academic_year_id() AND status <> 'reversed'),
    'receipt_amount',  (SELECT COALESCE(sum(amount), 0) FROM fee_payments WHERE academic_year_id = app.current_academic_year_id() AND status <> 'reversed'),
    'attendance_marks',(SELECT count(*) FROM attendance_marks m JOIN attendance_sessions s ON s.id = m.session_id WHERE s.academic_year_id = app.current_academic_year_id()),
    'exam_results',    (SELECT count(*) FROM exam_results x JOIN exams e ON e.id = x.exam_id WHERE e.academic_year_id = app.current_academic_year_id())
  );
$$;
GRANT EXECUTE ON FUNCTION app.live_counts() TO edupro_app;

-- ===========================================================================
-- 2. Hypercare issues
-- ===========================================================================
CREATE TABLE hypercare_issues (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  number         TEXT NOT NULL,
  title          TEXT NOT NULL,
  detail         TEXT,
  module         TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('s1', 's2', 's3', 's4')),
  channel        TEXT NOT NULL DEFAULT 'admin' CHECK (channel IN ('admin', 'teacher_app', 'help_desk', 'email', 'phone')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'in_progress', 'fixed', 'verified', 'closed')),
  reporter_user  BIGINT REFERENCES users(id),
  assigned_role  TEXT,
  assigned_user  BIGINT REFERENCES users(id),
  due_at         TIMESTAMPTZ NOT NULL,
  workaround     TEXT,
  resolution     TEXT,
  first_response_at TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ,
  request_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CREATE INDEX hypercare_issues_board ON hypercare_issues (school_id, status, severity, due_at);
CALL app.apply_tenant_rls('hypercare_issues');

CREATE TABLE hypercare_updates (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  issue_id     BIGINT NOT NULL REFERENCES hypercare_issues(id) ON DELETE CASCADE,
  author       BIGINT REFERENCES users(id),
  body         TEXT,
  status_from  TEXT,
  status_to    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hypercare_updates_by_issue ON hypercare_updates (issue_id, created_at);
CALL app.apply_tenant_rls('hypercare_updates');

-- ===========================================================================
-- 3. Fee period locks and month-end closes
-- ===========================================================================
CREATE TABLE fee_period_locks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  ledger         ledger_type,                     -- NULL = every ledger
  locked_through DATE NOT NULL,
  note           TEXT,
  locked_by      BIGINT REFERENCES users(id),
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at    TIMESTAMPTZ,
  released_by    BIGINT REFERENCES users(id),
  release_reason TEXT
);
CREATE INDEX fee_period_locks_active ON fee_period_locks (school_id, locked_through DESC) WHERE released_at IS NULL;
CALL app.apply_tenant_rls('fee_period_locks');

CREATE TABLE fee_month_closes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  month        DATE NOT NULL,                     -- first day of the month
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  checks       JSONB NOT NULL DEFAULT '{}'::jsonb,
  pack_export_ids BIGINT[] NOT NULL DEFAULT '{}',
  closed_by    BIGINT REFERENCES users(id),
  closed_at    TIMESTAMPTZ,
  reopened_by  BIGINT REFERENCES users(id),
  reopened_at  TIMESTAMPTZ,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, month)
);
CALL app.apply_tenant_rls('fee_month_closes');

-- The latest active lock date for a ledger (NULL when nothing is locked): the API refuses receipts on or before it.
CREATE OR REPLACE FUNCTION app.fee_locked_through(p_ledger ledger_type)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT max(locked_through) FROM fee_period_locks
   WHERE school_id = app.current_school_id() AND released_at IS NULL AND (ledger IS NULL OR ledger = p_ledger);
$$;
GRANT EXECUTE ON FUNCTION app.fee_locked_through(ledger_type) TO edupro_app;

-- ===========================================================================
-- 4. Permissions and grants
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.cutover.manage',   'platform', 'Run cut-over rehearsals, snapshots and sign-off', false),
  ('platform.hypercare.report', 'platform', 'Report a hypercare issue', false),
  ('platform.hypercare.manage', 'platform', 'Triage and resolve hypercare issues', false),
  ('fees.period.lock',          'fees',     'Close a fee month and lock the period (second factor)', true),
  ('fees.period.view',          'fees',     'View month-end checks and period locks', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('platform.cutover.manage', 'platform.hypercare.report', 'platform.hypercare.manage', 'fees.period.lock', 'fees.period.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant' AND p.code IN ('fees.period.lock', 'fees.period.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor' AND p.code = 'fees.period.view'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('academic_coordinator', 'class_teacher', 'subject_teacher', 'accountant', 'clerk', 'librarian', 'transport_incharge', 'auditor')
  AND p.code = 'platform.hypercare.report'
ON CONFLICT DO NOTHING;
