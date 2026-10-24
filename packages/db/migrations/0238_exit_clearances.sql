-- Employee exit, part 6 of docs/design/38-employee-exit.md: no-dues clearance.
-- Once an exit is accepted, each clearance department in use clears it or notes dues with an amount
-- (carried to the full and final statement of part 7). Library books on loan and unpaid library fines and
-- charges are shown from the system. Who clears a department is set on it: the office, the HOD of the
-- leaving employee's department, a role, or named users.

ALTER TABLE exit_clearance_departments
  -- [{ "kind": "office" } | { "kind": "hod" } | { "kind": "role", "code": "librarian" } | { "kind": "user", "userId": "12" }]
  ADD COLUMN approvers JSONB NOT NULL DEFAULT '[{"kind": "office"}]';

UPDATE exit_clearance_departments SET approvers = '[{"kind": "role", "code": "librarian"}, {"kind": "office"}]' WHERE code = 'library';
UPDATE exit_clearance_departments SET approvers = '[{"kind": "role", "code": "accountant"}, {"kind": "office"}]' WHERE code = 'accounts';
UPDATE exit_clearance_departments SET approvers = '[{"kind": "hod"}, {"kind": "office"}]' WHERE code = 'hod';

CREATE TABLE exit_clearances (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  exit_id       BIGINT NOT NULL REFERENCES employee_exits(id) ON DELETE CASCADE,
  department    TEXT NOT NULL,
  name          TEXT NOT NULL,
  auto          TEXT CHECK (auto IN ('library', 'assets')),
  -- who may clear it, copied from the department when the board was made
  approvers     JSONB NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared')),
  -- dues noted by the department (recovered in the full and final statement)
  dues          NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (dues >= 0),
  note          TEXT,
  -- what the system showed when it was cleared (library books, fines)
  check_result  JSONB,
  acted_by      BIGINT REFERENCES users(id),
  acted_at      TIMESTAMPTZ,
  UNIQUE (exit_id, department)
);
CREATE INDEX exit_clearances_open ON exit_clearances (school_id, status) WHERE status = 'pending';
CALL app.apply_tenant_rls('exit_clearances');
CREATE TRIGGER exit_clearances_audit AFTER INSERT OR UPDATE OR DELETE ON exit_clearances FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
