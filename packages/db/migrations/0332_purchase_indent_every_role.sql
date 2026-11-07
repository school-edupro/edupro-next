-- Purchase Indents for every staff role (asked 7 Nov 2026; any staff raises a PI for their own department,
-- docs/design/83): the right for the staff roles that lacked it, and the page on the roles' quick menus.

-- the staff roles without it: Gate / Security (built-in) and the schools' own Front Office roles
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.indent.raise' FROM roles r
 WHERE r.deleted_at IS NULL
   AND ((r.school_id IS NULL AND r.code = 'gate_security') OR (r.school_id IS NOT NULL AND r.code = 'front_office'))
ON CONFLICT DO NOTHING;

-- a role whose quick menu the school saved gets Purchase Indents at the end (a role without one shows
-- its default tiles, which now always include it); never the portal and support roles
UPDATE dashboard_role_defaults
   SET quick_actions = quick_actions || '[{"href": "/purchase/indents"}]'::jsonb, updated_at = now()
 WHERE jsonb_array_length(quick_actions) BETWEEN 1 AND 23
   AND NOT (quick_actions @> '["/purchase/indents"]'::jsonb OR quick_actions @> '[{"href": "/purchase/indents"}]'::jsonb)
   AND role_code NOT IN ('parent', 'student', 'former_parent', 'former_student', 'auditor', 'erp_support',
                         'support_engineer', 'sensitive_data_viewer');
