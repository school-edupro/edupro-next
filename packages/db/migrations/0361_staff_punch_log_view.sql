-- 0361: the staff punch log (docs/design/85, "the biometric log as the old Employee / Attendance Details"):
-- every raw punch the machines and uploads brought in, the versions of each day and the punches nobody
-- could be matched to. A right of its own, given to every role that saw the old one-day punch summary
-- (attendance.punch.view) or runs the leave office — the built-in roles and any a school made with them.
-- Giving an unknown ID to an employee stays with the leave office.
INSERT INTO permissions (code, module, description) VALUES
  ('leave.punch_log.view', 'leave',
   'Staff punch log: every raw punch of the biometric machines and uploads, the versions of each day, unmatched punches')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'leave.punch_log.view'
  FROM role_permissions rp
 WHERE rp.permission_code IN ('attendance.punch.view', 'leave.office.manage')
ON CONFLICT DO NOTHING;
