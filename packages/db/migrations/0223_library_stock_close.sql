-- 0223: closing (or cancelling) a stock verification cycle is its own right. The librarian scans and
-- uploads; the library in-charge / Principal closes the cycle and decides whether missing copies are
-- marked lost. Given to the admin roles; schools add it to whichever role they want.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('library.stock.close', 'library', 'Close or cancel a stock verification cycle (and mark missing copies lost)', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'library.stock.close' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
