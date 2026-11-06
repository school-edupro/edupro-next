-- Purchase, part 5 (docs/design/83): the purchase dashboard and reports — registers, the tracker,
-- pending approvals, overrides, spend, GST, MSME vendors — for the purchase office, the school admin and
-- the auditor (read only).
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.report.view', 'purchase', 'See the purchase dashboard and reports (registers, tracker, overrides, spend, GST, MSME)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.report.view' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'purchase_office', 'auditor')
ON CONFLICT DO NOTHING;
