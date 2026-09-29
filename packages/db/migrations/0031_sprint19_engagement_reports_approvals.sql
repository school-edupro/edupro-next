-- Sprint 19: scheduled reports, MIS role mapping, engagement (appointments, visitors and gate passes,
-- consent forms, certificates, clinic), the remaining approvals on the workflow engine (CCTV requests,
-- employee queries), the shadow-run closure (M3), group dashboards.
-- See docs/design/16-engagement-reports-approvals.md.

-- ===========================================================================
-- 1. Scheduled reports
-- ===========================================================================
CREATE TABLE report_schedules (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  name           TEXT NOT NULL,
  dataset        TEXT NOT NULL,                        -- dataset or renderer id
  format         TEXT NOT NULL DEFAULT 'xlsx' CHECK (format IN ('xlsx', 'csv', 'pdf', 'xml')),
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,
  cron           TEXT NOT NULL,                        -- five-field cron, IST
  recipient_roles TEXT[] NOT NULL DEFAULT '{}',
  recipient_addresses TEXT[] NOT NULL DEFAULT '{}',    -- mobiles (whatsapp) or emails
  channel        comms_channel NOT NULL DEFAULT 'whatsapp',
  owner_id       BIGINT NOT NULL,                      -- the export runs as this user
  status         row_status NOT NULL DEFAULT 'active',
  last_run_at    TIMESTAMPTZ,
  last_export_id BIGINT REFERENCES exports(id),
  next_run_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX report_schedules_due ON report_schedules (next_run_at) WHERE status = 'active';
CALL app.apply_tenant_rls('report_schedules');

-- ===========================================================================
-- 2. MIS dashboards per role
-- ===========================================================================
CREATE TABLE mis_dashboards (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,                          -- principal, academics, attendance, fees, communication, transport, library, results, group
  name         TEXT NOT NULL,
  roles        TEXT[] NOT NULL DEFAULT '{}',           -- role codes that see it
  sort_order   INT NOT NULL DEFAULT 0,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('mis_dashboards');

-- ===========================================================================
-- 3. Engagement
-- ===========================================================================
CREATE TABLE appointments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  requested_by  BIGINT NOT NULL,                       -- guardian user
  with_kind     TEXT NOT NULL CHECK (with_kind IN ('class_teacher', 'coordinator', 'principal', 'employee')),
  with_employee_id BIGINT REFERENCES employees(id),
  purpose       TEXT NOT NULL,
  preferred_slots JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["2026-10-03T10:00", ...]
  confirmed_at  TIMESTAMPTZ,
  location      TEXT,
  status        workflow_status NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX appointments_by_student ON appointments (school_id, student_id, created_at DESC);
CALL app.apply_tenant_rls('appointments');

CREATE TABLE visitor_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  visitor_name  TEXT NOT NULL,
  mobile        TEXT,
  organisation  TEXT,
  purpose       TEXT NOT NULL,
  to_meet       TEXT,
  id_proof_kind TEXT,                                  -- aadhaar, driving licence ... (number never stored)
  badge_no      TEXT,
  in_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  out_at        TIMESTAMPTZ,
  logged_by     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX visitor_log_by_day ON visitor_log (school_id, in_at DESC);
CALL app.apply_tenant_rls('visitor_log');

CREATE TABLE gate_passes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  kind          TEXT NOT NULL CHECK (kind IN ('early_leave', 'late_arrival')),
  on_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  at_time       TIME,
  reason        TEXT NOT NULL,
  escort_name   TEXT,
  escort_relation TEXT,
  escort_mobile TEXT,
  pass_no       TEXT,
  status        workflow_status NOT NULL DEFAULT 'pending',
  issued_at     TIMESTAMPTZ,
  issued_by     BIGINT,
  requested_by  BIGINT,
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gate_passes_by_day ON gate_passes (school_id, on_date DESC);
CALL app.apply_tenant_rls('gate_passes');

CREATE TABLE consent_forms (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  fields        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{key, label, type: text|choice|yesno|date|signature, required, options[]}]
  audience      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {classIds: [], sectionIds: []} empty = every family
  fee_amount    NUMERIC(12, 2),
  opens_on      DATE,
  closes_on     DATE,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_by    BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('consent_forms');

CREATE TABLE consent_form_responses (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  form_id       BIGINT NOT NULL REFERENCES consent_forms(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  answers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_by     BIGINT NOT NULL,                       -- guardian user
  signed_name   TEXT NOT NULL,
  signed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_intent_id BIGINT REFERENCES payment_intents(id),
  paid_at       TIMESTAMPTZ,
  request_id    UUID,
  UNIQUE (form_id, student_id)
);
CALL app.apply_tenant_rls('consent_form_responses');

ALTER TYPE template_kind ADD VALUE IF NOT EXISTS 'certificate';
ALTER TYPE template_kind ADD VALUE IF NOT EXISTS 'gate_pass';

CREATE TABLE certificates_issued (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  template_id   BIGINT NOT NULL REFERENCES document_templates(id),
  serial_no     TEXT NOT NULL,
  title         TEXT NOT NULL,
  text          TEXT,
  issued_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  export_id     BIGINT REFERENCES exports(id),
  issued_by     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, serial_no)
);
CREATE INDEX certificates_by_student ON certificates_issued (student_id, issued_on DESC);
CALL app.apply_tenant_rls('certificates_issued');

CREATE TABLE clinic_visits (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  in_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  out_at        TIMESTAMPTZ,
  complaint     TEXT NOT NULL,
  treatment     TEXT,
  temperature_c NUMERIC(4, 1),
  referred_to   TEXT,
  sent_home     BOOLEAN NOT NULL DEFAULT false,
  notified_at   TIMESTAMPTZ,
  attended_by   BIGINT,
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clinic_visits_by_student ON clinic_visits (student_id, in_at DESC);
CALL app.apply_tenant_rls('clinic_visits');

-- ===========================================================================
-- 4. The last approvals on the engine
-- ===========================================================================
CREATE TABLE cctv_requests (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  requested_by  BIGINT NOT NULL,
  student_id    BIGINT REFERENCES students(id),
  camera        TEXT NOT NULL,
  from_at       TIMESTAMPTZ NOT NULL,
  to_at         TIMESTAMPTZ NOT NULL,
  reason        TEXT NOT NULL,
  status        workflow_status NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_at > from_at)
);
CALL app.apply_tenant_rls('cctv_requests');

CREATE TABLE employee_queries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  category      TEXT NOT NULL,                         -- leave, payroll, facilities, grievance, other
  subject       TEXT NOT NULL,
  detail        TEXT NOT NULL,
  status        workflow_status NOT NULL DEFAULT 'pending',
  answer        TEXT,
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('employee_queries');

-- ===========================================================================
-- 5. Shadow-run closure (M3)
-- ===========================================================================
CREATE TABLE shadow_closures (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  closed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by     BIGINT,
  zero_runs     INT NOT NULL,                          -- consecutive zero runs at closure
  last_run_id   BIGINT REFERENCES shadow_runs(id),
  overridden    BOOLEAN NOT NULL DEFAULT false,
  reason        TEXT,
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CALL app.apply_tenant_rls('shadow_closures');

-- ===========================================================================
-- 6. Permissions and grants
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('reports.schedule.manage',      'reports',    'Create and run scheduled reports', false),
  ('insights.mis.view',            'insights',   'Open the MIS centre (dashboards mapped to the role)', false),
  ('insights.group.view',          'insights',   'Group dashboard across the schools of the group', false),
  ('engagement.appointment.view',  'engagement', 'View appointment requests', false),
  ('engagement.appointment.decide','engagement', 'Confirm or decline appointments', false),
  ('engagement.visitor.manage',    'engagement', 'Log visitors in and out', false),
  ('engagement.gate_pass.view',    'engagement', 'View gate passes', false),
  ('engagement.gate_pass.issue',   'engagement', 'Issue gate passes', false),
  ('engagement.consent_form.manage','engagement','Build consent forms and read responses', false),
  ('engagement.certificate.issue', 'engagement', 'Generate certificates', false),
  ('engagement.clinic.manage',     'engagement', 'Record clinic visits', false),
  ('engagement.cctv.request',      'engagement', 'Request CCTV footage', false),
  ('engagement.cctv.decide',       'engagement', 'Decide CCTV requests', false),
  ('engagement.employee_query.create','engagement','Raise an employee query', false),
  ('engagement.employee_query.answer','engagement','Answer employee queries', false),
  ('fees.shadow.close',            'fees',       'Close the shadow run (M3)', true)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('reports.schedule.manage', 'insights.mis.view', 'engagement.appointment.view', 'engagement.appointment.decide',
                 'engagement.visitor.manage', 'engagement.gate_pass.view', 'engagement.gate_pass.issue', 'engagement.consent_form.manage',
                 'engagement.certificate.issue', 'engagement.clinic.manage', 'engagement.cctv.request', 'engagement.cctv.decide',
                 'engagement.employee_query.create', 'engagement.employee_query.answer', 'fees.shadow.close')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'group_admin' AND p.code = 'insights.group.view'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('insights.mis.view', 'engagement.appointment.view', 'engagement.appointment.decide', 'engagement.gate_pass.view',
                 'engagement.certificate.issue', 'engagement.employee_query.create')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('engagement.appointment.view', 'engagement.appointment.decide', 'engagement.gate_pass.view', 'engagement.employee_query.create')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant' AND p.code IN ('fees.shadow.close', 'insights.mis.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor' AND p.code IN ('insights.mis.view', 'engagement.gate_pass.view', 'engagement.appointment.view')
ON CONFLICT DO NOTHING;
