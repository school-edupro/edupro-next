-- Purchase (docs/design/83): the purchase office opens the files it keeps — vendor documents, quotes,
-- tender documents, the bill of an emergency purchase, the PDF sent to a vendor (0320 gave it upload).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.files.view' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'purchase_office'
ON CONFLICT DO NOTHING;
