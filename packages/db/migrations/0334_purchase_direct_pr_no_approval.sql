-- A direct requisition by the purchase office without approval up to a limit, and documents on indent
-- lines (docs/design/83, "As built — indent items from Excel, line documents; direct PR without
-- approval", 8 Nov 2026).

-- who makes a direct requisition (not from indents): the purchase office; the admin may give it to others
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.requisition.direct', 'purchase',
   'Make a direct requisition (not from indents); up to the limit in Purchase settings it needs no approval')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.requisition.direct' FROM roles r WHERE r.school_id IS NULL AND r.code = 'purchase_office'
ON CONFLICT DO NOTHING;

-- a direct PR worth up to this (before GST) is approved by the system when its maker sends it; 0: never
ALTER TABLE purchase_settings
  ADD COLUMN direct_pr_limit NUMERIC(14,2) NOT NULL DEFAULT 50000 CHECK (direct_pr_limit >= 0);

-- why the system approved it (a direct PR within the limit); cleared when it is reopened
ALTER TABLE purchase_requisitions
  ADD COLUMN no_approval_note TEXT CHECK (no_approval_note IS NULL OR length(no_approval_note) <= 400);
