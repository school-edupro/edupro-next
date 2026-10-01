-- Approvers attach documents (withdrawal clearances, profile approvals) and open the ones attached:
-- every role that clears withdrawals or approves profile changes may upload and view files. Covers the
-- built-in roles and any role a school created with those permissions.
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, p.code
  FROM role_permissions rp CROSS JOIN permissions p
 WHERE rp.permission_code IN ('people.withdrawal.clear', 'engagement.change_request.approve')
   AND p.code IN ('platform.files.upload', 'platform.files.view')
ON CONFLICT DO NOTHING;
