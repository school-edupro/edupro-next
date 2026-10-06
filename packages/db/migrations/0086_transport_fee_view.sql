-- 0086: the transport in-charge sees the transport fee, and only that.
-- A new permission for the transport fee reports and a pupil's transport fee month by month (dues and
-- receipts of the transport head; no other fee head). The fee office already sees it through the ledger.
-- A person named in-charge of some routes sees those routes only (checked in the API).

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('transport.fee.view', 'transport', 'See the transport fee of pupils on the bus: projected, collected and receipts', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'transport.fee.view' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'accountant', 'auditor', 'transport_incharge')
ON CONFLICT DO NOTHING;
