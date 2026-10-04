-- 0069: gate pass v2. One register for two kinds of pass:
--   * a pupil leaving early (or arriving late): asked by the parent in the portal or made at the front
--     desk, approved by the levels the admin sets, handed over at the front desk (photos on record are
--     compared, a live photo of the person collecting is taken, a one-time code confirms an outsider),
--     then let out by the gate keeper;
--   * a member of staff going out during school: RGP (returnable: comes back the same day) or NRGP
--     (non-returnable), with the equipment carried out item by item; approved, then out (and back in)
--     at the gate.
-- Approval is the school's own: levels in order (one after another), or any N of the chosen people.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('engagement.gate_pass.handover', 'engagement', 'Hand a pupil over at the front desk against an approved gate pass', false),
  ('engagement.gate_pass.gate', 'engagement', 'Let gate pass holders out and back in at the gate', false),
  ('engagement.gate_pass_setup.manage', 'engagement', 'Gate pass set-up: approval levels and rules', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.gate_pass.view'), ('engagement.gate_pass.issue'), ('engagement.gate_pass.handover')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'front_desk'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'engagement.gate_pass.gate' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'gate_security'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'engagement.gate_pass_setup.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;

ALTER TABLE gate_passes ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE gate_passes DROP CONSTRAINT IF EXISTS gate_passes_kind_check;
ALTER TABLE gate_passes
  ADD CONSTRAINT gate_passes_kind_check CHECK (kind IN ('early_leave', 'late_arrival', 'rgp', 'nrgp')),
  ADD COLUMN audience        TEXT NOT NULL DEFAULT 'student' CHECK (audience IN ('student', 'staff')),
  ADD COLUMN employee_id     BIGINT REFERENCES employees(id),
  ADD COLUMN source          TEXT NOT NULL DEFAULT 'parent' CHECK (source IN ('parent', 'front_desk', 'employee')),
  -- pending → approved → handed_over (pupil, at the front desk) → out (at the gate) → returned (RGP)
  ADD COLUMN state           TEXT NOT NULL DEFAULT 'pending'
                             CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled', 'handed_over', 'out', 'returned')),
  ADD COLUMN escort_kind     TEXT CHECK (escort_kind IN ('father', 'mother', 'guardian', 'other')),
  ADD COLUMN pass_code       TEXT,
  ADD COLUMN destination     TEXT,
  ADD COLUMN return_by       TIMESTAMPTZ,
  ADD COLUMN approval_mode   TEXT NOT NULL DEFAULT 'sequence' CHECK (approval_mode IN ('sequence', 'any')),
  ADD COLUMN approval_need   INT NOT NULL DEFAULT 1,
  ADD COLUMN decided_at      TIMESTAMPTZ,
  ADD COLUMN decision_note   TEXT,
  ADD COLUMN handover_at     TIMESTAMPTZ,
  ADD COLUMN handover_by     BIGINT,
  ADD COLUMN otp_hash        TEXT,
  ADD COLUMN otp_expires_at  TIMESTAMPTZ,
  ADD COLUMN otp_tries       INT NOT NULL DEFAULT 0,
  ADD COLUMN otp_verified_at TIMESTAMPTZ,
  ADD COLUMN out_at          TIMESTAMPTZ,
  ADD COLUMN out_by          BIGINT,
  ADD COLUMN out_gate        TEXT,
  ADD COLUMN in_at           TIMESTAMPTZ,
  ADD COLUMN in_by           BIGINT,
  ADD COLUMN gate_note       TEXT,
  ADD COLUMN cancelled_at    TIMESTAMPTZ,
  ADD COLUMN cancel_reason   TEXT,
  ADD COLUMN qr_file_id      BIGINT,
  ADD COLUMN card_file_id    BIGINT,
  ADD CONSTRAINT gate_passes_whose CHECK (
    (audience = 'student' AND student_id IS NOT NULL) OR (audience = 'staff' AND employee_id IS NOT NULL));
UPDATE gate_passes SET state = status::text;
CREATE UNIQUE INDEX gate_passes_pass_code ON gate_passes (school_id, pass_code) WHERE pass_code IS NOT NULL;
CREATE INDEX gate_passes_by_state ON gate_passes (school_id, state, on_date DESC);
CREATE INDEX gate_passes_by_employee ON gate_passes (school_id, employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE gate_pass_settings (
  school_id     BIGINT PRIMARY KEY REFERENCES schools(id),
  student_mode  TEXT NOT NULL DEFAULT 'sequence' CHECK (student_mode IN ('sequence', 'any')),
  student_need  INT NOT NULL DEFAULT 1 CHECK (student_need BETWEEN 1 AND 6),
  staff_mode    TEXT NOT NULL DEFAULT 'sequence' CHECK (staff_mode IN ('sequence', 'any')),
  staff_need    INT NOT NULL DEFAULT 1 CHECK (staff_need BETWEEN 1 AND 6),
  -- someone not on the pupil's record collects: a one-time code goes to the parent before the hand-over
  handover_otp  BOOLEAN NOT NULL DEFAULT true,
  notify_email  BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT
);
CALL app.apply_tenant_rls('gate_pass_settings');

-- who approves, in order. kind: the pupil's class teacher, everyone holding a role, everyone with a
-- designation (Vice Principal, Principal), or one named employee.
CREATE TABLE gate_pass_levels (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  audience     TEXT NOT NULL CHECK (audience IN ('student', 'staff')),
  seq          INT NOT NULL,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('class_teacher', 'role', 'designation', 'employee')),
  role_code    TEXT,
  designation  TEXT,
  employee_id  BIGINT REFERENCES employees(id),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gate_pass_levels_by_school ON gate_pass_levels (school_id, audience, seq);
CALL app.apply_tenant_rls('gate_pass_levels');

-- one row per level of one pass: waiting (its turn has not come), pending (may act now), approved,
-- rejected, skipped (nobody holds the level, the requester is the approver, or enough others approved)
CREATE TABLE gate_pass_approvals (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  pass_id            BIGINT NOT NULL REFERENCES gate_passes(id) ON DELETE CASCADE,
  seq                INT NOT NULL,
  label              TEXT NOT NULL,
  approver_user_ids  BIGINT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  acted_by           BIGINT,
  acted_at           TIMESTAMPTZ,
  note               TEXT,
  UNIQUE (pass_id, seq)
);
CREATE INDEX gate_pass_approvals_inbox ON gate_pass_approvals USING gin (approver_user_ids) WHERE status = 'pending';
CALL app.apply_tenant_rls('gate_pass_approvals');

-- what a member of staff carries out; an item marked returnable is ticked back in at the gate
CREATE TABLE gate_pass_items (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  pass_id       BIGINT NOT NULL REFERENCES gate_passes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  qty           INT NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 9999),
  serial_no     TEXT,
  returnable    BOOLEAN NOT NULL DEFAULT true,
  returned_qty  INT NOT NULL DEFAULT 0,
  returned_at   TIMESTAMPTZ
);
CREATE INDEX gate_pass_items_by_pass ON gate_pass_items (pass_id);
CALL app.apply_tenant_rls('gate_pass_items');

-- the live photo of the person who collects the pupil, taken at the front desk
CREATE TABLE gate_pass_photos (
  pass_id       BIGINT PRIMARY KEY REFERENCES gate_passes(id) ON DELETE CASCADE,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  content_type  TEXT NOT NULL,
  bytes         BYTEA NOT NULL,
  taken_by      BIGINT,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('gate_pass_photos');

-- one HTML mail (with optional files: an inline image named in the body by cid, a PDF) on the outbox
CREATE OR REPLACE FUNCTION app.queue_mail(p_to TEXT, p_subject TEXT, p_html TEXT, p_attachments JSONB DEFAULT '[]'::jsonb,
                                          p_vars JSONB DEFAULT '{}'::jsonb, p_user BIGINT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_id BIGINT;
BEGIN
  PERFORM app.assert_context();
  IF p_to IS NULL OR p_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN NULL; END IF;
  INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, subject, body, format, status, variables, attachments)
  VALUES (app.current_school_id(), 'email', p_user, lower(btrim(p_to)), left(p_subject, 200), p_html, 'html', 'queued',
          COALESCE(p_vars, '{}'::jsonb), COALESCE(p_attachments, '[]'::jsonb))
  RETURNING id INTO v_id;
  PERFORM app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL, 'requestId', NULL,
    'kind', 'comms.message', 'payload', jsonb_build_object('messageId', v_id::text)));
  RETURN v_id;
END
$$;

-- the v1 flow sent every gate pass to "a class teacher" on the workflow engine; v2 keeps its own levels
UPDATE workflow_definitions SET status = 'inactive', updated_at = now() WHERE code = 'gate_pass' AND status = 'active';
