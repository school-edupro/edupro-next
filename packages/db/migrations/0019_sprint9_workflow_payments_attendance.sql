-- 0019_sprint9_workflow_payments_attendance.sql
-- Sprint 9 (Phase 2): workflow engine v0, payments v0 (intents, PayU adapter, idempotent webhooks),
-- admission decisions (draws, approvals, offers, admission numbers, enrolment), attendance sessions and
-- marks, RFID devices and ingestion v1.

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'admitted';

CREATE TYPE workflow_status   AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE step_status       AS ENUM ('pending', 'approved', 'rejected', 'skipped');
CREATE TYPE payment_status    AS ENUM ('created', 'pending', 'succeeded', 'failed', 'cancelled');
CREATE TYPE payment_purpose   AS ENUM ('admission_fee', 'fee_instalment', 'misc');
CREATE TYPE offer_status      AS ENUM ('offered', 'accepted', 'declined', 'expired', 'withdrawn');
CREATE TYPE attendance_code   AS ENUM ('P', 'A', 'L', 'SR', 'H', 'OD', 'SB');   -- present, absent, late, short leave, half day, on duty, stay back
CREATE TYPE attendance_kind   AS ENUM ('day', 'subject');
CREATE TYPE attendance_source AS ENUM ('manual', 'rfid');
CREATE TYPE rfid_direction    AS ENUM ('in', 'out');

-- ---------------------------------------------------------------------------
-- Workflow engine v0
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_definitions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  entity_type  TEXT NOT NULL,                       -- application, leave, purchase ...
  levels       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ level, name, resolver: { kind, userId?, roleCode?, designation? }, slaHours? }]
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX workflow_definitions_code ON workflow_definitions (school_id, code) WHERE deleted_at IS NULL;

CREATE TABLE workflow_instances (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  definition_id  BIGINT NOT NULL REFERENCES workflow_definitions(id),
  entity_type    TEXT NOT NULL,
  entity_id      BIGINT NOT NULL,
  subject        TEXT NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         workflow_status NOT NULL DEFAULT 'pending',
  current_level  INT NOT NULL DEFAULT 1,
  requested_by   BIGINT,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  completed_by   BIGINT,
  request_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workflow_instances_open ON workflow_instances (definition_id, entity_id) WHERE status = 'pending';
CREATE INDEX workflow_instances_by_entity ON workflow_instances (school_id, entity_type, entity_id);

CREATE TABLE workflow_steps (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  instance_id       BIGINT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  level             INT NOT NULL,
  name              TEXT NOT NULL,
  resolver          JSONB NOT NULL DEFAULT '{}'::jsonb,
  assignee_user_ids BIGINT[] NOT NULL DEFAULT '{}',
  status            step_status NOT NULL DEFAULT 'pending',
  acted_by          BIGINT,
  acted_at          TIMESTAMPTZ,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, level)
);
CREATE INDEX workflow_steps_inbox ON workflow_steps USING gin (assignee_user_ids) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Payments v0
-- ---------------------------------------------------------------------------
CREATE TABLE payment_intents (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  purpose              payment_purpose NOT NULL,
  entity_type          TEXT,
  entity_id            BIGINT,
  ledger               ledger_type NOT NULL DEFAULT 'school',
  amount               NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL DEFAULT 'INR',
  status               payment_status NOT NULL DEFAULT 'created',
  provider             TEXT NOT NULL DEFAULT 'payu',      -- payu, mock, offline
  txn_id               TEXT NOT NULL UNIQUE,              -- the gateway's transaction id (globally unique)
  provider_ref         TEXT,                              -- mihpayid
  payer_name           TEXT,
  payer_email          TEXT,
  payer_mobile         TEXT,
  return_url           TEXT,
  created_by_user      BIGINT,
  created_by_applicant BIGINT,
  request_id           UUID,
  expires_at           TIMESTAMPTZ,
  succeeded_at         TIMESTAMPTZ,
  failed_reason        TEXT,
  meta                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_intents_by_entity ON payment_intents (school_id, entity_type, entity_id);

CREATE TABLE payment_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  intent_id     BIGINT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                           -- created, redirected, webhook, marked_paid, failed, replay
  provider_ref  TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per gateway notification; the unique key makes replays harmless.
CREATE TABLE payment_webhooks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  provider      TEXT NOT NULL,
  external_id   TEXT NOT NULL,                           -- provider_ref + status
  txn_id        TEXT NOT NULL,
  signature_ok  BOOLEAN NOT NULL,
  payload       JSONB NOT NULL,
  outcome       TEXT NOT NULL,                           -- applied, duplicate, rejected, mismatch
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE TABLE fee_payments (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  intent_id         BIGINT REFERENCES payment_intents(id),
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  received_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  mode              TEXT NOT NULL DEFAULT 'online',      -- online, cash, cheque, upi, bank
  reference         TEXT,
  remarks           TEXT,
  received_by       BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fee_payment_allocations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  payment_id  BIGINT NOT NULL REFERENCES fee_payments(id) ON DELETE CASCADE,
  demand_id   BIGINT NOT NULL REFERENCES fee_demands(id),
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0)
);

-- Allocates a payment to the student's open demand rows in due-date order (oldest first) and keeps
-- fee_demands.paid and status in step. Returns the unallocated remainder (credit).
CREATE OR REPLACE FUNCTION app.allocate_fee_payment(p_payment_id BIGINT) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_p fee_payments%ROWTYPE;
  v_left NUMERIC;
  d RECORD;
  v_take NUMERIC;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_p FROM fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.payment_not_found' USING ERRCODE = 'P0002'; END IF;
  v_left := v_p.amount;
  FOR d IN
    SELECT id, net, paid FROM fee_demands
     WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND status IN ('pending', 'partial') AND net > paid
     ORDER BY due_on, id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, d.net - d.paid);
    INSERT INTO fee_payment_allocations (school_id, payment_id, demand_id, amount) VALUES (app.current_school_id(), p_payment_id, d.id, v_take);
    UPDATE fee_demands SET paid = paid + v_take, status = CASE WHEN paid + v_take >= net THEN 'paid' ELSE 'partial' END::fee_demand_status, updated_at = now() WHERE id = d.id;
    v_left := v_left - v_take;
  END LOOP;
  RETURN v_left;
END
$$;

-- ---------------------------------------------------------------------------
-- Admission decisions
-- ---------------------------------------------------------------------------
CREATE TABLE admission_draws (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id),
  class_id    BIGINT NOT NULL REFERENCES classes(id),
  seed        TEXT NOT NULL,
  candidates  INT NOT NULL,
  seats       INT NOT NULL,
  picked      BIGINT[] NOT NULL,
  run_by      BIGINT,
  run_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admission_offers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  application_id  BIGINT NOT NULL UNIQUE REFERENCES applications(id),
  offered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  admission_fee   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  intent_id       BIGINT REFERENCES payment_intents(id),
  status          offer_status NOT NULL DEFAULT 'offered',
  accepted_at     TIMESTAMPTZ,
  remarks         TEXT,
  created_by      BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admission_sequences (
  school_id    BIGINT PRIMARY KEY REFERENCES schools(id),
  prefix       TEXT NOT NULL DEFAULT 'A',
  last_serial  INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION app.next_admission_no() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_serial INT;
  v_prefix TEXT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO admission_sequences (school_id, prefix, last_serial)
  VALUES (app.current_school_id(), COALESCE((app.setting('admissions.number_prefix'))::text, '"A"')::jsonb #>> '{}', 1)
  ON CONFLICT (school_id) DO UPDATE SET last_serial = admission_sequences.last_serial + 1
  RETURNING prefix, last_serial INTO v_prefix, v_serial;
  RETURN v_prefix || lpad(v_serial::text, 4, '0');
END
$$;

ALTER TABLE applications ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id);
ALTER TABLE applications ADD COLUMN fee_paid_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Attendance and RFID
-- ---------------------------------------------------------------------------
ALTER TABLE students ADD COLUMN rfid_tag TEXT;
CREATE UNIQUE INDEX students_rfid_tag ON students (school_id, rfid_tag) WHERE rfid_tag IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE attendance_sessions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  class_section_id  BIGINT NOT NULL REFERENCES class_sections(id),
  on_date           DATE NOT NULL,
  kind              attendance_kind NOT NULL DEFAULT 'day',
  subject_id        BIGINT REFERENCES subjects(id),
  period_id         BIGINT REFERENCES timetable_periods(id),
  source            attendance_source NOT NULL DEFAULT 'manual',
  marked_by         BIGINT,
  marked_at         TIMESTAMPTZ,
  locked            BOOLEAN NOT NULL DEFAULT false,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'day' OR subject_id IS NOT NULL)
);
CREATE UNIQUE INDEX attendance_sessions_unique ON attendance_sessions (class_section_id, on_date, kind, COALESCE(subject_id, 0), COALESCE(period_id, 0));
CREATE INDEX attendance_sessions_by_date ON attendance_sessions (school_id, on_date);

CREATE TABLE attendance_marks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  session_id     BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id     BIGINT NOT NULL REFERENCES students(id),
  code           attendance_code NOT NULL,
  in_at          TIMESTAMPTZ,
  out_at         TIMESTAMPTZ,
  remarks        TEXT,
  source         attendance_source NOT NULL DEFAULT 'manual',
  alert_sent_at  TIMESTAMPTZ,
  marked_by      BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX attendance_marks_by_student ON attendance_marks (school_id, student_id);

CREATE TABLE rfid_devices (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  campus_id     BIGINT REFERENCES campuses(id),
  direction     rfid_direction,                          -- NULL = the event says
  api_key_hash  TEXT NOT NULL,
  status        row_status NOT NULL DEFAULT 'active',
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  UNIQUE (school_id, code)
);

CREATE TABLE rfid_events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  device_id    BIGINT NOT NULL REFERENCES rfid_devices(id),
  tag          TEXT NOT NULL,
  student_id   BIGINT REFERENCES students(id),
  occurred_at  TIMESTAMPTZ NOT NULL,
  direction    rfid_direction NOT NULL,
  outcome      TEXT NOT NULL,                             -- marked_present, marked_late, out_recorded, duplicate, unknown_tag, holiday, no_enrolment, manual_kept
  raw          JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rfid_events_by_time ON rfid_events (school_id, occurred_at DESC);

CALL app.apply_tenant_rls('workflow_definitions');
CALL app.apply_tenant_rls('workflow_instances');
CALL app.apply_tenant_rls('workflow_steps');
CALL app.apply_tenant_rls('payment_intents');
CALL app.apply_tenant_rls('payment_events');
CALL app.apply_tenant_rls('payment_webhooks');
CALL app.apply_tenant_rls('fee_payments');
CALL app.apply_tenant_rls('fee_payment_allocations');
CALL app.apply_tenant_rls('admission_draws');
CALL app.apply_tenant_rls('admission_offers');
CALL app.apply_tenant_rls('admission_sequences');
CALL app.apply_tenant_rls('attendance_sessions');
CALL app.apply_tenant_rls('attendance_marks');
CALL app.apply_tenant_rls('rfid_devices');
CALL app.apply_tenant_rls('rfid_events');

-- Lookups that happen before a tenant context exists (gateway webhooks, device ingestion): SECURITY DEFINER,
-- narrow surface, listed with the other exceptions in ADR-006/009.
CREATE OR REPLACE FUNCTION app.payment_intent_lookup(p_txn_id TEXT) RETURNS TABLE (school_id BIGINT, intent_id BIGINT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT school_id, id FROM payment_intents WHERE txn_id = p_txn_id
$$;
REVOKE ALL ON FUNCTION app.payment_intent_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payment_intent_lookup(TEXT) TO edupro_app;

CREATE OR REPLACE FUNCTION app.rfid_device_lookup(p_school_code TEXT, p_device_code TEXT)
RETURNS TABLE (school_id BIGINT, device_id BIGINT, api_key_hash TEXT, status row_status, direction rfid_direction)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT d.school_id, d.id, d.api_key_hash, d.status, d.direction
    FROM rfid_devices d JOIN schools s ON s.id = d.school_id
   WHERE s.code = upper(p_school_code) AND d.code = p_device_code
$$;
REVOKE ALL ON FUNCTION app.rfid_device_lookup(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rfid_device_lookup(TEXT, TEXT) TO edupro_app;

-- ---------------------------------------------------------------------------
-- Permissions and template grants
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('workflow.definition.view',    'workflow',    'View workflow definitions', false),
  ('workflow.definition.manage',  'workflow',    'Edit workflow definitions and levels', false),
  ('workflow.inbox.act',          'workflow',    'See and act on approval steps assigned to me', false),
  ('workflow.instance.view',      'workflow',    'View workflow instances and their history', false),
  ('payments.intent.view',        'payments',    'View payment intents and gateway events', false),
  ('payments.intent.create',      'payments',    'Create payment intents for fees', false),
  ('payments.offline.record',     'payments',    'Record an offline fee payment (cash, cheque, UPI, bank)', false),
  ('admissions.application.admit','admissions',  'Admit a selected applicant: admission number, student record, enrolment', false),
  ('attendance.session.view',     'attendance',  'View attendance sessions, marks and dashboards', false),
  ('attendance.session.mark',     'attendance',  'Mark or edit attendance (scope: class_section)', false),
  ('attendance.session.lock',     'attendance',  'Lock or unlock attendance sessions', false),
  ('attendance.rfid.manage',      'attendance',  'Register RFID devices and view the event log', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('workflow.definition.view', 'workflow.definition.manage', 'workflow.inbox.act', 'workflow.instance.view',
                 'payments.intent.view', 'payments.intent.create', 'payments.offline.record', 'admissions.application.admit',
                 'attendance.session.view', 'attendance.session.mark', 'attendance.session.lock', 'attendance.rfid.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('workflow.inbox.act', 'workflow.instance.view', 'workflow.definition.view', 'attendance.session.view', 'attendance.session.mark', 'attendance.session.lock', 'attendance.rfid.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('workflow.inbox.act', 'attendance.session.view', 'attendance.session.mark')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('workflow.inbox.act', 'payments.intent.view', 'payments.intent.create', 'payments.offline.record')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('workflow.definition.view', 'workflow.instance.view', 'payments.intent.view', 'attendance.session.view', 'attendance.rfid.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('parent', 'student')
  AND p.code IN ('attendance.session.view')
ON CONFLICT DO NOTHING;
