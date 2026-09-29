-- Sprint 18: board result import, library sale / digital / stock verification, the partitioning
-- review's measures (index, archive of closed years), transport-request escalation.
-- See docs/design/15-all-bands-boards-partitioning.md and ADR-014.

-- ===========================================================================
-- 1. Board results
-- ===========================================================================
ALTER TABLE enrolments ADD COLUMN board_roll_no TEXT;
CREATE INDEX enrolments_board_roll ON enrolments (school_id, academic_year_id, board_roll_no) WHERE board_roll_no IS NOT NULL;

CREATE TABLE board_result_imports (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  board            TEXT NOT NULL DEFAULT 'CBSE',
  class_label      TEXT NOT NULL,                       -- X, XII
  file_name        TEXT,
  status           import_status NOT NULL,
  total_rows       INT NOT NULL DEFAULT 0,
  ok_rows          INT NOT NULL DEFAULT 0,
  rejected_rows    INT NOT NULL DEFAULT 0,
  unmatched_rows   INT NOT NULL DEFAULT 0,
  report           JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload          JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_by     BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at     TIMESTAMPTZ,
  request_id       UUID
);
CALL app.apply_tenant_rls('board_result_imports');

CREATE TABLE board_results (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  board            TEXT NOT NULL DEFAULT 'CBSE',
  class_label      TEXT NOT NULL,
  roll_no          TEXT NOT NULL,
  candidate_name   TEXT,
  student_id       BIGINT REFERENCES students(id),
  subject_code     TEXT NOT NULL,
  subject_name     TEXT,
  theory           NUMERIC(6, 2),
  practical        NUMERIC(6, 2),
  total            NUMERIC(6, 2),
  grade            TEXT,
  result           TEXT,                                -- PASS, COMP, ESSENTIAL REPEAT ...
  import_id        BIGINT REFERENCES board_result_imports(id),
  raw              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, board, class_label, roll_no, subject_code)
);
CREATE INDEX board_results_by_student ON board_results (student_id);
CALL app.apply_tenant_rls('board_results');

-- ===========================================================================
-- 2. Library: sale, digital library, stock verification
-- ===========================================================================
CREATE TABLE library_sales (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  copy_id      BIGINT NOT NULL REFERENCES library_copies(id),
  buyer_kind   TEXT NOT NULL CHECK (buyer_kind IN ('student', 'employee', 'other')),
  buyer_id     BIGINT,
  buyer_name   TEXT,
  price        NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  receipt_ref  TEXT,
  sold_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  sold_by      BIGINT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('library_sales');

CREATE TABLE library_digital_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,
  title        TEXT NOT NULL,
  author       TEXT,
  kind         TEXT NOT NULL DEFAULT 'link' CHECK (kind IN ('link', 'file')),
  url          TEXT,
  file_id      BIGINT REFERENCES files(id),
  category     TEXT,
  audience     TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'students', 'employees')),
  band         class_band,                            -- NULL = every class
  description  TEXT,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('library_digital_items');

CREATE TABLE library_stock_checks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  name         TEXT NOT NULL,
  started_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  finished_on  DATE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  expected     INT NOT NULL DEFAULT 0,
  found        INT NOT NULL DEFAULT 0,
  missing      INT NOT NULL DEFAULT 0,
  started_by   BIGINT,
  closed_by    BIGINT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('library_stock_checks');

CREATE TABLE library_stock_check_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  check_id     BIGINT NOT NULL REFERENCES library_stock_checks(id) ON DELETE CASCADE,
  copy_id      BIGINT NOT NULL REFERENCES library_copies(id),
  found_on     DATE,
  outcome      TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'found', 'missing', 'on_loan')),
  UNIQUE (check_id, copy_id)
);
CALL app.apply_tenant_rls('library_stock_check_items');

-- ===========================================================================
-- 3. Partitioning review (ADR-014): the measures
-- ===========================================================================
CREATE INDEX IF NOT EXISTS fee_payment_allocations_by_payment ON fee_payment_allocations (payment_id);

CREATE SCHEMA IF NOT EXISTS archive;
CREATE TABLE IF NOT EXISTS archive.attendance_marks (LIKE attendance_marks INCLUDING ALL);
ALTER TABLE archive.attendance_marks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Moves the attendance marks of closed academic years (older than the two most recent closed ones)
-- into the archive schema, per school, under the caller's tenant context. Returns rows moved.
CREATE OR REPLACE FUNCTION app.archive_closed_years() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_n INT := 0; v_year BIGINT; v_moved INT;
BEGIN
  PERFORM app.assert_context();
  FOR v_year IN
    SELECT id FROM academic_years
     WHERE school_id = app.current_school_id() AND status = 'closed'
     ORDER BY end_date DESC OFFSET 2
  LOOP
    WITH moved AS (
      DELETE FROM attendance_marks m
       USING attendance_sessions s
       WHERE m.session_id = s.id AND s.academic_year_id = v_year
       RETURNING m.*
    )
    INSERT INTO archive.attendance_marks SELECT moved.*, now() FROM moved;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    v_n := v_n + v_moved;
  END LOOP;
  RETURN v_n;
END $$;

-- ===========================================================================
-- 4. Transport requests on the workflow: escalation on the default definition
-- ===========================================================================
UPDATE workflow_definitions
   SET levels = (SELECT jsonb_agg(CASE WHEN (l->>'level')::int = 1 AND NOT (l ? 'escalateTo')
                                        THEN l || '{"escalateTo": {"kind": "role", "roleCode": "school_admin"}}'::jsonb
                                        ELSE l END)
                   FROM jsonb_array_elements(levels) AS l)
 WHERE entity_type = 'transport_request' AND deleted_at IS NULL;

-- ===========================================================================
-- 5. Permissions and grants
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.board_result.view',   'exams',   'View imported board results and their analysis', false),
  ('exams.board_result.import', 'exams',   'Import board result files', false),
  ('library.stock.verify',      'library', 'Run stock verification and record sales', false),
  ('insights.results.view',     'insights','Results analytics for the principal', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('exams.board_result.view', 'exams.board_result.import', 'library.stock.verify', 'insights.results.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('exams.board_result.view', 'exams.board_result.import', 'insights.results.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('auditor', 'class_teacher')
  AND p.code IN ('exams.board_result.view', 'insights.results.view')
ON CONFLICT DO NOTHING;
