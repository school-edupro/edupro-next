-- Approval levels where everyone must approve, and an admin passing a stuck level (docs/design/83, "As
-- built — any one or all at a level; the admin passes a level", 7 Nov 2026).

-- who has approved a step so far: a level that needs all its people passes when every one of them has
-- (a level that needs any one is decided by the first, as before, and keeps this empty)
ALTER TABLE workflow_steps ADD COLUMN approved_by BIGINT[] NOT NULL DEFAULT '{}';

-- 'passed': a level passed for its approvers by someone allowed to, with the reason
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_kind_check;
ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_kind_check CHECK (kind IN
  ('started', 'approved', 'rejected', 'cancelled', 'reassigned', 'reminded', 'escalated', 'comment', 'delegated',
   'skipped', 'passed'));

INSERT INTO permissions (code, module, description) VALUES
  ('purchase.approval.override', 'purchase',
   'Pass a purchase approval level for its approvers (an approver away), with the reason; never on what you raised')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.approval.override' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
