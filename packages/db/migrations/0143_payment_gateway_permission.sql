-- 0143: setting up payment gateways and their live keys is for the school admin (and group admin) only,
-- after a fresh strong sign-in.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('payments.gateway.manage', 'payments', 'Set up payment gateways, their keys and the fees they take', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payments.gateway.manage' FROM roles r WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
