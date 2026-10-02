-- Communication module v2 (2026-10-02). Groups by kind (student, employee, student + teacher, external)
-- that are kept by hand, uploaded from Excel or follow a rule (class, section, house, category, route,
-- department...); external contacts; SMS (DLT), WhatsApp (approved template) and HTML email templates;
-- multi-channel requests to masters, groups or an uploaded list with "send to" parents / student / both,
-- attachments and an approval rule; per-school providers (MSG91, Meta WhatsApp Cloud, SMTP/SES) with
-- encrypted keys; SMS units, cost and a credit ledger for the monthly usage statement.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('comms.settings.manage', 'comms', 'Communication settings: providers and keys, approval rule, quiet hours, attachment size, rates', true),
  ('comms.report.view', 'comms', 'Communication dashboard, delivery reports and the monthly usage statement', false),
  ('comms.credit.manage', 'comms', 'Record SMS / WhatsApp / email credit top-ups', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, p.code
  FROM role_permissions rp
  CROSS JOIN (VALUES ('comms.settings.manage'), ('comms.credit.manage'), ('comms.report.view')) AS p(code)
 WHERE rp.permission_code = 'comms.template.manage'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'comms.report.view'
  FROM role_permissions rp WHERE rp.permission_code = 'comms.message.view'
ON CONFLICT DO NOTHING;

-- ---- groups -------------------------------------------------------------------------------------
ALTER TABLE comms_groups
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'mixed' CHECK (kind IN ('student', 'employee', 'student_teacher', 'external', 'mixed')),
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'static' CHECK (mode IN ('static', 'rule')),
  -- rule groups: {classIds, sectionIds, houses, categories, genders, streams, routeIds, departments, designations, employeeTypes}
  ADD COLUMN rule JSONB,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_by BIGINT;

-- people outside the school (vendors, alumni, visiting parents...), kept in external groups
CREATE TABLE comms_contacts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL,
  mobile      TEXT,
  email       CITEXT,
  -- any other uploaded columns, usable as {{variables}}
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  deleted_at  TIMESTAMPTZ,
  CHECK (mobile IS NOT NULL OR email IS NOT NULL)
);
CALL app.apply_tenant_rls('comms_contacts');

ALTER TABLE comms_group_members
  ADD COLUMN person_type TEXT CHECK (person_type IN ('student', 'employee', 'guardian', 'contact', 'user')),
  ADD COLUMN person_id BIGINT,
  ALTER COLUMN user_id DROP NOT NULL;
-- existing members were logins: keep them as the person behind the login where one exists
UPDATE comms_group_members gm SET
  person_type = COALESCE(
    (SELECT 'employee' FROM employees e WHERE e.user_id = gm.user_id AND e.school_id = gm.school_id LIMIT 1),
    (SELECT 'guardian' FROM guardians g WHERE g.user_id = gm.user_id AND g.school_id = gm.school_id LIMIT 1),
    (SELECT 'student' FROM students s WHERE s.user_id = gm.user_id AND s.school_id = gm.school_id LIMIT 1),
    'user'),
  person_id = COALESCE(
    (SELECT e.id FROM employees e WHERE e.user_id = gm.user_id AND e.school_id = gm.school_id LIMIT 1),
    (SELECT g.id FROM guardians g WHERE g.user_id = gm.user_id AND g.school_id = gm.school_id LIMIT 1),
    (SELECT s.id FROM students s WHERE s.user_id = gm.user_id AND s.school_id = gm.school_id LIMIT 1),
    gm.user_id)
 WHERE person_type IS NULL;
ALTER TABLE comms_group_members ALTER COLUMN person_type SET NOT NULL, ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE comms_group_members DROP CONSTRAINT IF EXISTS comms_group_members_group_id_user_id_key;
CREATE UNIQUE INDEX comms_group_members_person ON comms_group_members (group_id, person_type, person_id);
CREATE INDEX comms_group_members_by_person ON comms_group_members (school_id, person_type, person_id);

-- ---- templates ----------------------------------------------------------------------------------
ALTER TABLE comms_templates
  ADD COLUMN format TEXT NOT NULL DEFAULT 'text' CHECK (format IN ('text', 'html')),
  ADD COLUMN category message_category NOT NULL DEFAULT 'general',
  -- WhatsApp: the name and language Meta approved, the variables for {{1}}, {{2}}... in order, and the header
  ADD COLUMN wa_template_name TEXT,
  ADD COLUMN wa_language TEXT,
  ADD COLUMN wa_params JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN wa_header TEXT NOT NULL DEFAULT 'none' CHECK (wa_header IN ('none', 'text', 'image', 'document')),
  -- MSG91 flow / template id when the school sends through flows
  ADD COLUMN provider_template_id TEXT;

-- ---- requests -----------------------------------------------------------------------------------
ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'filter';
ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'upload';

ALTER TABLE message_requests
  -- every channel of the request: [{channel, templateId}]; channel / template_id keep the first
  ADD COLUMN channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN send_to TEXT NOT NULL DEFAULT 'primary' CHECK (send_to IN ('primary', 'parents', 'student', 'student_parents')),
  ADD COLUMN rule JSONB,
  -- one-time list from Excel: [{name, mobile, email, vars}]
  ADD COLUMN upload JSONB,
  ADD COLUMN subject TEXT,
  ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text' CHECK (body_format IN ('text', 'html')),
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN needs_approval BOOLEAN NOT NULL DEFAULT true;
UPDATE message_requests SET channels = jsonb_build_array(jsonb_build_object('channel', channel::text, 'templateId', template_id::text))
 WHERE channels = '[]'::jsonb;

ALTER TABLE message_request_recipients
  ADD COLUMN channel comms_channel,
  ADD COLUMN person_type TEXT,
  ADD COLUMN person_id BIGINT;

-- ---- messages: units, cost, read receipts, attachments --------------------------------------------
ALTER TABLE comms_messages
  ADD COLUMN message_request_id BIGINT REFERENCES message_requests(id),
  ADD COLUMN format TEXT NOT NULL DEFAULT 'text' CHECK (format IN ('text', 'html')),
  ADD COLUMN units INT NOT NULL DEFAULT 1,
  ADD COLUMN cost NUMERIC(10, 4),
  ADD COLUMN read_at TIMESTAMPTZ,
  ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- WhatsApp parameters for {{1}}, {{2}}... rendered by the API
  ADD COLUMN params JSONB;
CREATE INDEX comms_messages_by_request ON comms_messages (school_id, message_request_id) WHERE message_request_id IS NOT NULL;
CREATE INDEX comms_messages_by_month ON comms_messages (school_id, channel, created_at);

-- ---- per-school providers and policy ------------------------------------------------------------
CREATE TABLE comms_providers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  channel     comms_channel NOT NULL,
  provider    TEXT NOT NULL CHECK (provider IN ('msg91', 'meta_whatsapp', 'smtp', 'console')),
  -- non-secret settings (sender id, route, phone number id, from address...)
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- keys and passwords, encrypted (app field key); never returned by the API
  secret      TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, channel)
);
CALL app.apply_tenant_rls('comms_providers');

CREATE TABLE comms_settings (
  school_id             BIGINT PRIMARY KEY REFERENCES schools(id),
  -- a bulk request needs approval above this many recipients (0 = always) unless the sender holds an exempt role
  approval_threshold    INT NOT NULL DEFAULT 100,
  approval_exempt_roles TEXT[] NOT NULL DEFAULT ARRAY['group_admin', 'school_admin', 'principal'],
  quiet_from            TIME,
  quiet_to              TIME,
  attachment_max_mb     INT NOT NULL DEFAULT 5 CHECK (attachment_max_mb BETWEEN 1 AND 25),
  -- rupees per SMS unit, WhatsApp message and email
  rates                 JSONB NOT NULL DEFAULT '{"sms": 0.2, "whatsapp": 0.8, "email": 0}'::jsonb,
  low_balance           JSONB NOT NULL DEFAULT '{"sms": 1000, "whatsapp": 200}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            BIGINT
);
CALL app.apply_tenant_rls('comms_settings');

CREATE TABLE comms_credits (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  channel     comms_channel NOT NULL,
  units       NUMERIC(12, 2) NOT NULL,           -- positive top-up, negative correction
  amount      NUMERIC(12, 2),                    -- rupees paid, if any
  note        TEXT,
  on_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT
);
CALL app.apply_tenant_rls('comms_credits');
CREATE INDEX comms_credits_by_channel ON comms_credits (school_id, channel, on_date);

-- WhatsApp read receipts: a delivered message's "read" event is kept as its own row
ALTER TABLE comms_delivery_events ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE comms_delivery_events DROP CONSTRAINT IF EXISTS comms_delivery_events_provider_external_id_status_key;
CREATE UNIQUE INDEX comms_delivery_events_once ON comms_delivery_events (provider, external_id, status, is_read);
