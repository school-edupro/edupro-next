-- Sprint 10: communication and parent engagement.
-- Message requests approved through the workflow engine and dispatched to audiences (class, section, route,
-- group, individuals) with per-recipient delivery tracking; DPDP consent purposes and records; user groups;
-- minimal transport routes with student assignments (S12 extends them); parent queries, complaints and leave
-- requests with threaded responses and ratings; feedback; profile change requests; bus attendance from bus
-- readers; employee punch ingestion from biometric devices; provider delivery receipts.

CREATE TYPE consent_status         AS ENUM ('granted', 'withdrawn');
CREATE TYPE message_request_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'sending', 'sent', 'cancelled');
CREATE TYPE message_audience       AS ENUM ('everyone', 'students', 'employees', 'class', 'class_section', 'route', 'group', 'individuals');
CREATE TYPE message_category       AS ENUM ('service', 'general');
CREATE TYPE query_kind             AS ENUM ('query', 'complaint', 'leave');
CREATE TYPE query_status           AS ENUM ('open', 'in_progress', 'answered', 'closed');
CREATE TYPE author_kind            AS ENUM ('guardian', 'student', 'staff');
CREATE TYPE change_request_status  AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE device_kind            AS ENUM ('gate', 'bus', 'biometric');

-- ---------------------------------------------------------------------------
-- Transport (minimal): routes and the students on them
-- ---------------------------------------------------------------------------
CREATE TABLE transport_routes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  vehicle_no    TEXT,
  driver_name   TEXT,
  driver_mobile TEXT,
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT,
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX transport_routes_code ON transport_routes (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE student_route_assignments (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  student_id       BIGINT NOT NULL REFERENCES students(id),
  route_id         BIGINT NOT NULL REFERENCES transport_routes(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  stop_name        TEXT,
  pickup_time      TIME,
  drop_time        TIME,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  UNIQUE (student_id, academic_year_id)
);
CREATE INDEX student_route_assignments_route ON student_route_assignments (route_id, academic_year_id);

-- ---------------------------------------------------------------------------
-- Communication: groups, consent, message requests, delivery receipts
-- ---------------------------------------------------------------------------
CREATE TABLE comms_groups (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX comms_groups_code ON comms_groups (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE comms_group_members (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  group_id  BIGINT NOT NULL REFERENCES comms_groups(id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by  BIGINT,
  UNIQUE (group_id, user_id)
);

-- DPDP: purposes are versioned wording the person agreed to; consents are append-only, the latest row wins.
CREATE TABLE consent_purposes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,                       -- comms.sms, comms.whatsapp, comms.email, media.gallery, transport.tracking
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  channel     comms_channel,                       -- set for communication purposes
  is_required BOOLEAN NOT NULL DEFAULT false,      -- service messages never need consent; required purposes cannot be withdrawn in the app
  version     INT NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

CREATE TABLE consents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  user_id      BIGINT NOT NULL REFERENCES users(id),
  student_id   BIGINT REFERENCES students(id),      -- NULL = the person themselves / all children
  purpose_code TEXT NOT NULL,
  status       consent_status NOT NULL,
  version      INT NOT NULL DEFAULT 1,
  source       TEXT NOT NULL DEFAULT 'parent_app',  -- parent_app, office, import, seed
  note         TEXT,
  recorded_by  BIGINT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consents_lookup ON consents (school_id, user_id, purpose_code, recorded_at DESC);

CREATE OR REPLACE FUNCTION app.consent_status(p_user_id BIGINT, p_purpose TEXT) RETURNS consent_status
LANGUAGE sql STABLE AS $$
  SELECT status FROM consents WHERE user_id = p_user_id AND purpose_code = p_purpose ORDER BY recorded_at DESC, id DESC LIMIT 1
$$;

CREATE TABLE message_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  title                TEXT NOT NULL,
  category             message_category NOT NULL DEFAULT 'general',
  channel              comms_channel NOT NULL,
  template_id          BIGINT NOT NULL REFERENCES comms_templates(id),
  body                 TEXT NOT NULL,                              -- the message text merged into the template's {{body}}
  variables            JSONB NOT NULL DEFAULT '{}'::jsonb,         -- extra template variables
  audience             message_audience NOT NULL,
  targets              JSONB NOT NULL DEFAULT '[]'::jsonb,         -- [{type: class|class_section|route|group|user, id}]
  status               message_request_status NOT NULL DEFAULT 'pending_approval',
  scheduled_at         TIMESTAMPTZ,
  requested_by         BIGINT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  recipients_total     INT NOT NULL DEFAULT 0,
  recipients_skipped   INT NOT NULL DEFAULT 0,
  dispatched_at        TIMESTAMPTZ,
  request_id           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX message_requests_status ON message_requests (school_id, status, requested_at DESC);

CREATE TABLE message_request_recipients (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  request_id     BIGINT NOT NULL REFERENCES message_requests(id) ON DELETE CASCADE,
  user_id        BIGINT REFERENCES users(id),
  student_id     BIGINT REFERENCES students(id),
  name           TEXT,
  address        TEXT,
  message_id     BIGINT REFERENCES comms_messages(id),
  skipped_reason TEXT,                                            -- no_address, consent_withdrawn, duplicate
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX message_request_recipients_request ON message_request_recipients (request_id);

-- Provider delivery receipts (DLR): matched by provider message id, idempotent per (provider, receipt id, status)
CREATE TABLE comms_delivery_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  message_id  BIGINT NOT NULL REFERENCES comms_messages(id),
  provider    TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status      comms_message_status NOT NULL,
  reason      TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id, status)
);

-- ---------------------------------------------------------------------------
-- Parent engagement: queries, feedback, profile change requests
-- ---------------------------------------------------------------------------
CREATE TABLE query_categories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,                        -- fees, transport, academics, admin, other
  name        TEXT NOT NULL,
  route_to    TEXT NOT NULL DEFAULT 'school_admin', -- role code that owns the category (class_teacher = the child's class teacher)
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  UNIQUE (school_id, code)
);

CREATE TABLE query_sequences (
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  last_serial      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, academic_year_id)
);

CREATE OR REPLACE FUNCTION app.next_query_no(p_year_id BIGINT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_serial INT;
  v_year TEXT;
BEGIN
  PERFORM app.assert_context();
  SELECT code INTO v_year FROM academic_years WHERE id = p_year_id;
  INSERT INTO query_sequences (school_id, academic_year_id, last_serial) VALUES (app.current_school_id(), p_year_id, 1)
  ON CONFLICT (school_id, academic_year_id) DO UPDATE SET last_serial = query_sequences.last_serial + 1
  RETURNING last_serial INTO v_serial;
  RETURN 'Q/' || COALESCE(v_year, '') || '/' || lpad(v_serial::text, 4, '0');
END
$$;

CREATE TABLE parent_queries (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id   BIGINT NOT NULL REFERENCES academic_years(id),
  number             TEXT NOT NULL,
  kind               query_kind NOT NULL DEFAULT 'query',
  category_code      TEXT NOT NULL DEFAULT 'other',
  student_id         BIGINT NOT NULL REFERENCES students(id),
  raised_by_user_id  BIGINT NOT NULL REFERENCES users(id),
  subject            TEXT NOT NULL,
  body               TEXT NOT NULL,
  file_ids           JSONB NOT NULL DEFAULT '[]'::jsonb,
  leave_from         DATE,
  leave_to           DATE,
  status             query_status NOT NULL DEFAULT 'open',
  assigned_role      TEXT,                          -- who should answer (from the category)
  assigned_user_id   BIGINT REFERENCES users(id),
  decision           TEXT,                          -- leave: approved | rejected
  rating             INT CHECK (rating BETWEEN 1 AND 5),
  rating_comment     TEXT,
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at  TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  closed_by          BIGINT,
  legacy_ref         TEXT,
  request_id         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  CHECK (kind <> 'leave' OR (leave_from IS NOT NULL AND leave_to IS NOT NULL AND leave_to >= leave_from))
);
CREATE INDEX parent_queries_status ON parent_queries (school_id, status, opened_at DESC);
CREATE INDEX parent_queries_student ON parent_queries (student_id);

CREATE TABLE query_responses (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  query_id       BIGINT NOT NULL REFERENCES parent_queries(id) ON DELETE CASCADE,
  author_user_id BIGINT REFERENCES users(id),
  author_kind    author_kind NOT NULL,
  body           TEXT NOT NULL,
  file_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_internal    BOOLEAN NOT NULL DEFAULT false,   -- staff note, hidden from the family
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX query_responses_query ON query_responses (query_id, created_at);

CREATE TABLE feedback_entries (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  student_id BIGINT REFERENCES students(id),
  category   TEXT NOT NULL,                         -- teaching, transport, fees, facilities, communication, app
  rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_entries_school ON feedback_entries (school_id, created_at DESC);

CREATE TABLE profile_change_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  student_id           BIGINT NOT NULL REFERENCES students(id),
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id),
  entity               TEXT NOT NULL,               -- student | guardian
  entity_id            BIGINT NOT NULL,
  changes              JSONB NOT NULL,              -- { field: { from, to } }
  reason               TEXT,
  status               change_request_status NOT NULL DEFAULT 'pending',
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (entity IN ('student', 'guardian'))
);
CREATE INDEX profile_change_requests_status ON profile_change_requests (school_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Devices: bus readers and biometric punches
-- ---------------------------------------------------------------------------
ALTER TABLE rfid_devices ADD COLUMN kind device_kind NOT NULL DEFAULT 'gate';
ALTER TABLE rfid_devices ADD COLUMN route_id BIGINT REFERENCES transport_routes(id);
ALTER TABLE employees ADD COLUMN biometric_id TEXT;
CREATE UNIQUE INDEX employees_biometric_id ON employees (school_id, biometric_id) WHERE biometric_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE bus_attendance (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  device_id     BIGINT NOT NULL REFERENCES rfid_devices(id),
  route_id      BIGINT REFERENCES transport_routes(id),
  student_id    BIGINT REFERENCES students(id),
  tag           TEXT NOT NULL,
  on_date       DATE NOT NULL,
  direction     rfid_direction NOT NULL,             -- in = boarded, out = alighted
  occurred_at   TIMESTAMPTZ NOT NULL,
  lat           NUMERIC(9, 6),
  lng           NUMERIC(9, 6),
  outcome       TEXT NOT NULL,                       -- boarded, alighted, duplicate, unknown_tag
  alert_sent_at TIMESTAMPTZ,
  raw           JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bus_attendance_day ON bus_attendance (school_id, on_date, route_id);
CREATE INDEX bus_attendance_student ON bus_attendance (student_id, on_date);

CREATE TABLE punch_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  device_id    BIGINT NOT NULL REFERENCES rfid_devices(id),
  employee_id  BIGINT REFERENCES employees(id),
  biometric_id TEXT NOT NULL,
  punched_at   TIMESTAMPTZ NOT NULL,
  direction    rfid_direction,
  outcome      TEXT NOT NULL,                        -- recorded, duplicate, unknown_id
  raw          JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, biometric_id, punched_at)
);
CREATE INDEX punch_logs_day ON punch_logs (school_id, punched_at);

-- ---------------------------------------------------------------------------
-- Row-level security and cross-tenant lookups
-- ---------------------------------------------------------------------------
CALL app.apply_tenant_rls('transport_routes');
CALL app.apply_tenant_rls('student_route_assignments');
CALL app.apply_tenant_rls('comms_groups');
CALL app.apply_tenant_rls('comms_group_members');
CALL app.apply_tenant_rls('consent_purposes');
CALL app.apply_tenant_rls('consents');
CALL app.apply_tenant_rls('message_requests');
CALL app.apply_tenant_rls('message_request_recipients');
CALL app.apply_tenant_rls('comms_delivery_events');
CALL app.apply_tenant_rls('query_categories');
CALL app.apply_tenant_rls('query_sequences');
CALL app.apply_tenant_rls('parent_queries');
CALL app.apply_tenant_rls('query_responses');
CALL app.apply_tenant_rls('feedback_entries');
CALL app.apply_tenant_rls('profile_change_requests');
CALL app.apply_tenant_rls('bus_attendance');
CALL app.apply_tenant_rls('punch_logs');

-- Device lookup now also returns the device kind and route (bus readers, biometric devices).
DROP FUNCTION IF EXISTS app.rfid_device_lookup(TEXT, TEXT);
CREATE OR REPLACE FUNCTION app.rfid_device_lookup(p_school_code TEXT, p_device_code TEXT)
RETURNS TABLE (school_id BIGINT, device_id BIGINT, api_key_hash TEXT, status row_status, direction rfid_direction, kind device_kind, route_id BIGINT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT d.school_id, d.id, d.api_key_hash, d.status, d.direction, d.kind, d.route_id
    FROM rfid_devices d JOIN schools s ON s.id = d.school_id
   WHERE upper(s.code) = upper(p_school_code) AND d.code = p_device_code
$$;
REVOKE ALL ON FUNCTION app.rfid_device_lookup(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfid_device_lookup(TEXT, TEXT) TO edupro_app;

-- Delivery receipts arrive without a tenant: find the message by the provider's id (ADR-006/009 list).
CREATE OR REPLACE FUNCTION app.message_lookup_by_provider_ref(p_provider TEXT, p_ref TEXT)
RETURNS TABLE (school_id BIGINT, message_id BIGINT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT m.school_id, m.id FROM comms_messages m WHERE m.provider = p_provider AND m.provider_message_id = p_ref ORDER BY m.id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.message_lookup_by_provider_ref(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.message_lookup_by_provider_ref(TEXT, TEXT) TO edupro_app;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('comms.request.view',              'comms',       'View message requests and their delivery', false),
  ('comms.request.create',            'comms',       'Compose message requests for approval', false),
  ('comms.group.view',                'comms',       'View communication groups', false),
  ('comms.group.manage',              'comms',       'Create groups and manage members', false),
  ('comms.consent.view',              'comms',       'View consent records', false),
  ('comms.consent.manage',            'comms',       'Record or withdraw consent on behalf of a person (office)', false),
  ('comms.consent.self',              'comms',       'Manage my own consents', false),
  ('engagement.query.view',           'engagement',  'View parent queries, complaints and leave requests', false),
  ('engagement.query.respond',        'engagement',  'Respond to, assign and close queries', false),
  ('engagement.query.create',         'engagement',  'Raise a query for my child', false),
  ('engagement.feedback.view',        'engagement',  'View feedback and ratings', false),
  ('engagement.feedback.create',      'engagement',  'Give feedback', false),
  ('engagement.change_request.view',  'engagement',  'View profile change requests', false),
  ('engagement.change_request.decide','engagement',  'Approve or reject profile change requests', false),
  ('engagement.change_request.create','engagement',  'Request a change to my child''s or my own profile', false),
  ('engagement.family.view',          'engagement',  'View my children''s profiles, route and consents', false),
  ('transport.route.view',            'transport',   'View transport routes and the students on them', false),
  ('transport.route.manage',          'transport',   'Create routes and assign students', false),
  ('attendance.bus.view',             'attendance',  'View bus attendance', false),
  ('attendance.punch.view',           'attendance',  'View employee punches and the day summary', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.module IN ('comms', 'engagement', 'transport') AND p.code NOT IN ('comms.consent.self', 'engagement.query.create', 'engagement.feedback.create', 'engagement.change_request.create', 'engagement.family.view')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin') AND p.code IN ('attendance.bus.view', 'attendance.punch.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('comms.request.view', 'comms.request.create', 'comms.group.view', 'comms.consent.view',
                 'engagement.query.view', 'engagement.query.respond', 'engagement.feedback.view',
                 'engagement.change_request.view', 'engagement.change_request.decide',
                 'transport.route.view', 'attendance.bus.view', 'attendance.punch.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('comms.request.view', 'comms.request.create', 'engagement.query.view', 'engagement.query.respond', 'attendance.bus.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('engagement.query.view', 'engagement.query.respond', 'comms.request.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('comms.request.view', 'comms.group.view', 'comms.consent.view', 'engagement.query.view', 'engagement.feedback.view',
                 'engagement.change_request.view', 'transport.route.view', 'attendance.bus.view', 'attendance.punch.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
  AND p.code IN ('comms.consent.self', 'engagement.query.create', 'engagement.feedback.create', 'engagement.change_request.create',
                 'engagement.family.view', 'attendance.bus.view')
ON CONFLICT DO NOTHING;
