-- Employee exit, part 5 of docs/design/38-employee-exit.md: set-up and the request.
-- An employee applies for resignation in the staff app, or the office creates an exit on their behalf
-- (resignation, termination, retirement, contract end …). The notice period of the employee's type gives
-- the expected last day and any shortfall. The request goes through the approval levels of the
-- employee's type (workflow `employee_exit_<type>`, set like vacancy approval); each level approves (may
-- set the accepted last working day and waive notice), sends back with a remark, or rejects. An employee
-- may withdraw a resignation until it is accepted. Clearance departments are set here for part 6.

CREATE TABLE employee_exit_types (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  -- the employee may ask for it in the staff app (resignation); the office creates every type
  staff_may_apply  BOOLEAN NOT NULL DEFAULT false,
  -- the notice period counts (resignation); not for a termination or a retirement
  notice_applies   BOOLEAN NOT NULL DEFAULT false,
  sort_order       INT NOT NULL DEFAULT 0,
  status           row_status NOT NULL DEFAULT 'active',
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('employee_exit_types');

CREATE TABLE employee_exit_settings (
  school_id    BIGINT PRIMARY KEY REFERENCES schools(id),
  -- notice period in days by employee type: { "teaching": 90, "non_teaching": 30, … }
  notice_days  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT
);
CALL app.apply_tenant_rls('employee_exit_settings');

CREATE TABLE exit_clearance_departments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- dues filled in from the system (part 6)
  auto        TEXT CHECK (auto IN ('library', 'assets')),
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('exit_clearance_departments');

CREATE TABLE employee_exits (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  employee_id           BIGINT NOT NULL REFERENCES employees(id),
  exit_type             TEXT NOT NULL,
  reason                TEXT NOT NULL,
  letter_file_id        BIGINT REFERENCES files(id),
  requested_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  proposed_last_day     DATE NOT NULL,
  -- the notice period as set when asked (0 when it does not apply to the type)
  notice_days           INT NOT NULL DEFAULT 0,
  expected_last_day     DATE NOT NULL,
  accepted_last_day     DATE,
  notice_waived         BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'sent_back', 'approved', 'rejected', 'withdrawn')),
  -- the employee asked in the staff app (otherwise the office on their behalf)
  by_self               BOOLEAN NOT NULL DEFAULT false,
  raised_by             BIGINT REFERENCES users(id),
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  -- what the approver chose when ending the approval early: sent back (to edit and send again) or rejected
  closing_as            TEXT CHECK (closing_as IN ('sent_back', 'rejected')),
  sent_back_note        TEXT,
  decision_note         TEXT,
  decided_by            BIGINT REFERENCES users(id),
  decided_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            BIGINT
);
-- one exit in progress per employee
CREATE UNIQUE INDEX employee_exits_one_open ON employee_exits (employee_id) WHERE status IN ('pending', 'sent_back', 'approved');
CREATE INDEX employee_exits_by_status ON employee_exits (school_id, status, requested_on DESC);
CALL app.apply_tenant_rls('employee_exits');
CREATE TRIGGER employee_exits_audit AFTER INSERT OR UPDATE OR DELETE ON employee_exits FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- what happened, in order, for the employee's and the office's timeline
CREATE TABLE employee_exit_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  exit_id     BIGINT NOT NULL REFERENCES employee_exits(id) ON DELETE CASCADE,
  what        TEXT NOT NULL,
  note        TEXT,
  by_user     BIGINT,
  by_name     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employee_exit_events_by_exit ON employee_exit_events (exit_id, at);
CALL app.apply_tenant_rls('employee_exit_events');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.exit.view', 'people', 'See employee exits (resignations, terminations, retirements) and their approval', false),
  ('people.exit.manage', 'people', 'Create employee exits on an employee''s behalf, and set up exit types, notice periods, approval levels and clearance departments', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN (VALUES ('people.exit.view'), ('people.exit.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
