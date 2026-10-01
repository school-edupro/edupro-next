-- Parent / student portal profile (2026-10-01): the school decides, field by field and separately for
-- parents and students, what the portal shows and what a family may change (hidden, view only, edit
-- with approval, edit direct), which changes need a proof document, when editing is open, and who
-- approves a change (one or two levels: a role, a named employee, the student's class teacher or the
-- office). Approvers can accept some fields of a request and reject the rest, and decide many at once.

CREATE TABLE profile_portal_policies (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL UNIQUE REFERENCES schools(id),
  -- { "parent": { "<field key>": "hidden|view|edit_approval|edit_direct" }, "student": { ... } }
  fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { "<field key>": "<document kind>" }: the change must carry that document
  proofs      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { "mode": "open|closed|period", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "message": "..." }
  edit_window JSONB NOT NULL DEFAULT '{"mode": "open"}'::jsonb,
  -- { "default": [level...], "sections": { "<section>": [level...] }, "fields": { "<key>": [level...] } }
  approval    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CALL app.apply_tenant_rls('profile_portal_policies');

ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'partially_approved';
ALTER TYPE change_request_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Who asked (parent or student portal), the approval route copied from the policy when the request was
-- made (so later policy edits do not move requests already in flight), the level it is waiting at, the
-- proof documents and the group of requests one submission was split into (one per route).
ALTER TABLE profile_change_requests
  ADD COLUMN audience      TEXT NOT NULL DEFAULT 'parent' CHECK (audience IN ('parent', 'student', 'office')),
  ADD COLUMN route         JSONB NOT NULL DEFAULT '[{"kind": "office"}]'::jsonb,
  ADD COLUMN current_level INT NOT NULL DEFAULT 1 CHECK (current_level BETWEEN 1 AND 2),
  ADD COLUMN proofs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN submission    TEXT,
  ADD COLUMN auto_applied  BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX profile_change_requests_student ON profile_change_requests (school_id, student_id, created_at DESC);

-- Every decision on a request: who, at which level, which fields were accepted or refused, and why.
CREATE TABLE profile_change_actions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  request_id  BIGINT NOT NULL REFERENCES profile_change_requests(id) ON DELETE CASCADE,
  level       INT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'partial', 'auto', 'cancelled', 'override')),
  fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
  note        TEXT,
  actor_id    BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profile_change_actions_request ON profile_change_actions (request_id, created_at);
CALL app.apply_tenant_rls('profile_change_actions');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('engagement.change_request.approve',  'engagement', 'Approve or reject profile changes routed to me (my role, my name or my class)', false),
  ('engagement.change_request.override', 'engagement', 'Decide any profile change at any level; the decision is final', false),
  ('people.portal_profile.manage',       'people',     'Choose what parents and students see and change on the portal profile, proofs, window and approvers', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
   AND p.code IN ('engagement.change_request.approve', 'engagement.change_request.override', 'people.portal_profile.manage')
ON CONFLICT DO NOTHING;

-- staff who may be named as approvers
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.code IN ('academic_coordinator', 'class_teacher', 'subject_teacher', 'accountant', 'front_office', 'clerk')
   AND p.code = 'engagement.change_request.approve'
ON CONFLICT DO NOTHING;

-- families attach proof documents to their requests
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.files.upload' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
ON CONFLICT DO NOTHING;
