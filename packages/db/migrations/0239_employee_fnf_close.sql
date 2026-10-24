-- Employee exit, part 7 of docs/design/38-employee-exit.md: the full and final statement and the close.
-- There is no payroll yet: accounts enters the earnings and deductions by hand; the dues the clearance
-- departments noted come in by themselves. The statement goes to the approvers set up (the principal by
-- default), is printed and marked paid (or recovered) with the mode and reference. The exit is closed on
-- or after the last working day: the employee becomes inactive with the leaving date, sign-ins and roles
-- stop, class-teacher and subject assignments end (listed for re-assignment). Letters: acceptance of
-- resignation, relieving letter, experience certificate. The exit register lists who left and the FNF.

ALTER TABLE employee_exits DROP CONSTRAINT employee_exits_status_check;
ALTER TABLE employee_exits
  ADD CONSTRAINT employee_exits_status_check
    CHECK (status IN ('pending', 'sent_back', 'approved', 'rejected', 'withdrawn', 'closed')),
  ADD COLUMN left_on    DATE,
  ADD COLUMN closed_at  TIMESTAMPTZ,
  ADD COLUMN closed_by  BIGINT REFERENCES users(id),
  -- what the close ended, for re-assignment: [{ kind, what }]
  ADD COLUMN handover   JSONB;
-- one exit in progress per employee; a closed one is history
DROP INDEX employee_exits_one_open;
CREATE UNIQUE INDEX employee_exits_one_open ON employee_exits (employee_id) WHERE status IN ('pending', 'sent_back', 'approved');

ALTER TABLE employee_exit_settings
  -- who approves the full and final statement: [{ "kind": "role", "code": "school_admin" } | office | user]
  ADD COLUMN fnf_approvers JSONB NOT NULL DEFAULT '[{"kind": "role", "code": "school_admin"}]';

CREATE TABLE employee_fnf (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  exit_id         BIGINT NOT NULL UNIQUE REFERENCES employee_exits(id) ON DELETE CASCADE,
  -- [{ "kind": "earning" | "deduction", "code": "salary", "label": "…", "amount": 0, "note": "…", "fromClearance": false }]
  lines           JSONB NOT NULL DEFAULT '[]',
  earnings        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deductions      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  -- earnings less deductions: payable to the employee when positive, recoverable from them when negative
  net             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
  prepared_by     BIGINT REFERENCES users(id),
  submitted_at    TIMESTAMPTZ,
  decided_by      BIGINT REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  paid_on         DATE,
  paid_mode       TEXT,
  paid_reference  TEXT,
  paid_by         BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT
);
CALL app.apply_tenant_rls('employee_fnf');
CREATE TRIGGER employee_fnf_audit AFTER INSERT OR UPDATE OR DELETE ON employee_fnf FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.exit.fnf', 'people', 'Prepare the full and final statement of an employee leaving, and mark it paid or recovered', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN (VALUES ('people.exit.fnf'), ('people.exit.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'accountant')
ON CONFLICT DO NOTHING;
