-- Class teachers clear the withdrawals of their own section when a department names them as approvers.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'academic_coordinator')
   AND p.code IN ('people.withdrawal.view', 'people.withdrawal.clear')
ON CONFLICT DO NOTHING;
