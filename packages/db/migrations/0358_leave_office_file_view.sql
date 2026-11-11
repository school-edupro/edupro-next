-- Staff leave (docs/design/85, "the three tabs as the old screen"): the leave office opens the document
-- attached to a leave (a medical certificate) from the leave lists and the leave's own page. Every role
-- that runs the leave office may view stored files, as approvers may (0047) — the built-in role and any
-- role a school made with the right.
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'platform.files.view'
  FROM role_permissions rp
 WHERE rp.permission_code = 'leave.office.manage'
ON CONFLICT DO NOTHING;
