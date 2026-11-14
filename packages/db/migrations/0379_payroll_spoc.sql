-- 0379: the Payroll SPOC (docs/design/86, "Payroll SPOC") and a narrow right to lock a month's staff attendance for
-- payroll (docs/design/85). The SPOC runs the whole payroll month alone: set-up, people, the month's inputs, the run
-- from draft to lock, the bank file, statutory returns, reports and the audit trail. Holding the payroll admin's right,
-- they may approve what they made themselves (the payroll admin's rule since phase A); each such approval is marked
-- "self-approved" in the payroll audit trail. Others still act on three things: the principal countersigns the
-- go-live, a second person commits the move from the old payroll, and another checker decides the SPOC's own claims
-- and tax declaration. Locking the attendance register for payroll was the leave office's alone; the new right lets
-- the SPOC lock a month that is over, while unlocking, corrections and balances stay with the leave office.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('leave.month.lock', 'leave',
   'Lock a month that is over in the staff attendance register for payroll (unlocking stays with the leave office)',
   false)
ON CONFLICT (code) DO NOTHING;

-- every role that holds the leave office's right keeps locking, a school's own roles too
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'leave.month.lock' FROM role_permissions rp
 WHERE rp.permission_code = 'leave.office.manage'
ON CONFLICT DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'payroll_spoc', 'Payroll SPOC', 'module', true,
   'Runs the whole payroll month alone: set-up, people, inputs, the run to lock, bank file, returns, reports, audit trail; locks the month''s staff attendance')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES
    ('payroll.setup.view'), ('payroll.setup.manage'), ('payroll.setup.approve'),
    ('payroll.run.view'), ('payroll.run.manage'), ('payroll.run.approve'),
    ('payroll.profile.reveal'), ('payroll.settings.manage'), ('payroll.audit.view'),
    ('leave.report.view'), ('leave.month.lock')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'payroll_spoc'
ON CONFLICT DO NOTHING;
