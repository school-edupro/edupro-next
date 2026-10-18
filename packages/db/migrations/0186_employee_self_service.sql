-- 0186: employees see and update their own profile from the staff app, as families do for students
-- (0041; docs/design/33-people-dashboards.md part 2). The school sets per field whether staff see it,
-- change it with approval, or change it at once; which proof document a change needs (the school's
-- employee document types); when updating is open; and who approves (up to two steps: the HOD or L1/L2
-- approver from the employee record, HR (office), a role or a named person).

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.staff_profile.manage', 'people', 'Decide what staff may see and change on their own profile, and who approves', false),
  ('people.staff_change.approve', 'people', 'Approve the profile changes staff ask for that are routed to you', false),
  ('people.staff_change.override', 'people', 'Decide any staff profile change at any step (the decision is final)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('people.staff_profile.manage'), ('people.staff_change.approve'), ('people.staff_change.override')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
-- those who keep the staff records approve what is routed to them (HR, office)
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'people.staff_change.approve' FROM role_permissions rp
 WHERE rp.permission_code = 'people.employee.edit'
ON CONFLICT DO NOTHING;
-- staff attach proof documents to their requests
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.files.upload' FROM roles r
 WHERE r.school_id IS NULL AND r.deleted_at IS NULL
   AND r.code IN ('class_teacher', 'subject_teacher', 'academic_coordinator', 'accountant', 'front_desk', 'warden',
                  'hostel_clerk', 'transport_incharge', 'school_nurse', 'school_doctor', 'gate_security')
ON CONFLICT DO NOTHING;

CREATE TABLE employee_portal_policies (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL UNIQUE REFERENCES schools(id),
  -- { key: hidden | view | edit_approval | edit_direct }
  fields       JSONB NOT NULL DEFAULT '{}',
  -- { key: employee_document_types.id }
  proofs       JSONB NOT NULL DEFAULT '{}',
  -- { mode: open | closed | period, from, to, message }
  edit_window  JSONB NOT NULL DEFAULT '{"mode": "open"}',
  -- { default: [approver…], sections: { section: [approver…] }, fields: { key: [approver…] } }
  approval     JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT
);
CALL app.apply_tenant_rls('employee_portal_policies');

CREATE TABLE employee_change_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  employee_id          BIGINT NOT NULL REFERENCES employees(id),
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id),
  -- { key: { from, to, status?, note?, enc? } } (ID numbers encrypted)
  changes              JSONB NOT NULL,
  reason               TEXT,
  status               change_request_status NOT NULL DEFAULT 'pending',
  -- the approvers when asked, kept so later policy edits do not move requests in flight
  route                JSONB NOT NULL DEFAULT '[]',
  current_level        INT NOT NULL DEFAULT 1 CHECK (current_level BETWEEN 1 AND 2),
  -- [{ typeId, fileId, fileName }]
  proofs               JSONB NOT NULL DEFAULT '[]',
  submission           UUID,
  auto_applied         BOOLEAN NOT NULL DEFAULT false,
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employee_change_requests_status ON employee_change_requests (school_id, status, created_at DESC);
CREATE INDEX employee_change_requests_of ON employee_change_requests (school_id, employee_id, created_at DESC);
CALL app.apply_tenant_rls('employee_change_requests');

CREATE TABLE employee_change_actions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  request_id  BIGINT NOT NULL REFERENCES employee_change_requests(id) ON DELETE CASCADE,
  level       INT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'partial', 'auto', 'cancelled', 'override')),
  fields      JSONB NOT NULL DEFAULT '{}',
  note        TEXT,
  actor_id    BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('employee_change_actions');
