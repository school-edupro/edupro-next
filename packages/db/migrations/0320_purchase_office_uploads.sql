-- Purchase (docs/design/83): the purchase office uploads files — vendor documents (part 1), quotes and
-- tender documents (part 3), the vendor's bill of an emergency purchase (part 4). The Purchase office
-- role (0316) missed the upload right; the school and group admins have it already.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.files.upload' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'purchase_office'
ON CONFLICT DO NOTHING;
