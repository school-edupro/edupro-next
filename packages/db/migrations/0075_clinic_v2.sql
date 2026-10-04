-- 0075: clinic management.
--   * set-up: clinics, doctors, nurses, diseases / complaints, medicines;
--   * medicine stock by batch (received, given at a visit, written off), low-stock and expiry alerts;
--   * a clinic visit of a pupil or a member of staff: complaint, vitals, what the doctor found and did,
--     medicines given (taken from stock), outcome (back to class, rest, sent home, referred);
--   * health check-ups: a camp (once or twice a year), class by class, each pupil examined on the
--     school's form; the doctor publishes a class and the parents see the health card (PDF).
-- Medical data is for the clinic's people only: the doctor and nurse roles, and whoever the admin adds.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('engagement.clinic.view', 'engagement', 'Read clinic visits, health check-ups, reports and the clinic dashboard', false),
  ('engagement.clinic_setup.manage', 'engagement', 'Clinic set-up: clinics, doctors, nurses, diseases, medicines, check-up form', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'school_doctor', 'School Doctor', 'module', true,
   'Clinic: visits, treatment, medicines, health check-ups and their publication, reports and dashboard'),
  (NULL, 'school_nurse', 'School Nurse', 'module', true,
   'Clinic: visits, first aid, medicines and stock, health check-up entry')
ON CONFLICT (school_id, code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.clinic.manage'), ('engagement.clinic.view')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('school_doctor', 'school_nurse')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('engagement.clinic.view'), ('engagement.clinic_setup.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;

CREATE TABLE clinic_settings (
  school_id          BIGINT PRIMARY KEY REFERENCES schools(id),
  -- fields of the check-up form the school does not use (keys of the form)
  checkup_hidden     TEXT[] NOT NULL DEFAULT '{}',
  expiry_alert_days  INT NOT NULL DEFAULT 60 CHECK (expiry_alert_days BETWEEN 7 AND 365),
  card_note          TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT
);
CALL app.apply_tenant_rls('clinic_settings');

-- clinics, doctors, nurses and diseases share one small master
CREATE TABLE clinic_masters (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  kind         TEXT NOT NULL CHECK (kind IN ('clinic', 'doctor', 'nurse', 'disease')),
  name         TEXT NOT NULL,
  -- doctor / nurse: qualification, registration number, mobile; the employee behind a staff doctor or nurse
  qualification TEXT,
  reg_no       TEXT,
  mobile       TEXT,
  employee_id  BIGINT REFERENCES employees(id),
  note         TEXT,
  status       row_status NOT NULL DEFAULT 'active',
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clinic_masters_name ON clinic_masters (school_id, kind, lower(name));
CALL app.apply_tenant_rls('clinic_masters');

CREATE TABLE clinic_medicines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  name         TEXT NOT NULL,
  form         TEXT NOT NULL DEFAULT 'Tablet',   -- Tablet, Syrup, Ointment, Drops, Injection, Dressing...
  strength     TEXT,                              -- 500 mg, 5 ml...
  unit         TEXT NOT NULL DEFAULT 'tablet',    -- what one "given" counts: tablet, ml, piece
  low_stock_at INT NOT NULL DEFAULT 10 CHECK (low_stock_at >= 0),
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clinic_medicines_name ON clinic_medicines (school_id, lower(name), lower(COALESCE(strength, '')));
CALL app.apply_tenant_rls('clinic_medicines');

-- one batch received; qty_left goes down as the medicine is given (earliest expiry first) or written off
CREATE TABLE clinic_stock (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  medicine_id  BIGINT NOT NULL REFERENCES clinic_medicines(id),
  batch_no     TEXT,
  expiry_on    DATE,
  qty_in       INT NOT NULL CHECK (qty_in > 0),
  qty_left     INT NOT NULL CHECK (qty_left >= 0),
  received_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier     TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT
);
CREATE INDEX clinic_stock_by_medicine ON clinic_stock (medicine_id, expiry_on NULLS LAST) WHERE qty_left > 0;
CALL app.apply_tenant_rls('clinic_stock');

CREATE TABLE clinic_stock_moves (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  medicine_id  BIGINT NOT NULL REFERENCES clinic_medicines(id),
  stock_id     BIGINT REFERENCES clinic_stock(id),
  kind         TEXT NOT NULL CHECK (kind IN ('received', 'given', 'written_off')),
  qty          INT NOT NULL CHECK (qty > 0),
  visit_id     BIGINT,
  note         TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_user      BIGINT
);
CREATE INDEX clinic_stock_moves_by_medicine ON clinic_stock_moves (medicine_id, at DESC);
CALL app.apply_tenant_rls('clinic_stock_moves');

-- the visit: the v1 table (0031) grows from "a pupil came, complaint, treatment" to the full record
ALTER TABLE clinic_visits ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE clinic_visits
  ADD COLUMN number        TEXT,
  ADD COLUMN audience      TEXT NOT NULL DEFAULT 'student' CHECK (audience IN ('student', 'staff')),
  ADD COLUMN employee_id   BIGINT REFERENCES employees(id),
  ADD COLUMN clinic_id     BIGINT REFERENCES clinic_masters(id),
  ADD COLUMN doctor_id     BIGINT REFERENCES clinic_masters(id),
  ADD COLUMN nurse_id      BIGINT REFERENCES clinic_masters(id),
  ADD COLUMN disease_ids   BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN pulse         INT,
  ADD COLUMN bp            TEXT,
  ADD COLUMN spo2          INT,
  ADD COLUMN weight_kg     NUMERIC(5, 1),
  ADD COLUMN diagnosis     TEXT,
  ADD COLUMN prescription  TEXT,
  ADD COLUMN remark        TEXT,
  ADD COLUMN outcome       TEXT NOT NULL DEFAULT 'back_to_class'
                           CHECK (outcome IN ('back_to_class', 'rest', 'sent_home', 'referred')),
  ADD CONSTRAINT clinic_visits_whose CHECK (
    (audience = 'student' AND student_id IS NOT NULL) OR (audience = 'staff' AND employee_id IS NOT NULL));
UPDATE clinic_visits SET outcome = CASE WHEN referred_to IS NOT NULL AND btrim(referred_to) <> '' THEN 'referred' WHEN sent_home THEN 'sent_home' ELSE 'back_to_class' END;
UPDATE clinic_visits v SET number = 'CV-' || to_char(v.in_at AT TIME ZONE 'Asia/Kolkata', 'YYMM') || '-' || lpad(v.id::text, 4, '0') WHERE number IS NULL;
CREATE INDEX clinic_visits_by_day ON clinic_visits (school_id, in_at DESC);
CREATE INDEX clinic_visits_by_employee ON clinic_visits (employee_id, in_at DESC) WHERE employee_id IS NOT NULL;

CREATE TABLE clinic_visit_medicines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  visit_id     BIGINT NOT NULL REFERENCES clinic_visits(id) ON DELETE CASCADE,
  medicine_id  BIGINT NOT NULL REFERENCES clinic_medicines(id),
  qty          INT NOT NULL CHECK (qty > 0),
  dosage       TEXT
);
CREATE INDEX clinic_visit_medicines_by_visit ON clinic_visit_medicines (visit_id);
CALL app.apply_tenant_rls('clinic_visit_medicines');

-- a health check-up of the school: "Annual check-up 2026-27, first term"
CREATE TABLE health_camps (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT REFERENCES academic_years(id),
  name             TEXT NOT NULL,
  starts_on        DATE NOT NULL,
  ends_on          DATE,
  doctor_id        BIGINT REFERENCES clinic_masters(id),
  place            TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('health_camps');

-- one pupil examined in one camp; the parents see it once it is published
CREATE TABLE health_checkups (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  camp_id          BIGINT NOT NULL REFERENCES health_camps(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES students(id),
  class_section_id BIGINT REFERENCES class_sections(id),
  exam_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  doctor_id        BIGINT REFERENCES clinic_masters(id),
  place            TEXT,
  height_cm        NUMERIC(5, 1) CHECK (height_cm BETWEEN 40 AND 230),
  weight_kg        NUMERIC(5, 1) CHECK (weight_kg BETWEEN 5 AND 200),
  blood_group      TEXT,
  -- nails, skin, hair, anaemia, ear, nose, throat, vision_right, vision_left, tooth_cavity, plaque,
  -- stain, tartar, gums, resp, cvs, pa, nervous, surgery
  findings         JSONB NOT NULL DEFAULT '{}'::jsonb,
  disease_id       BIGINT REFERENCES clinic_masters(id),
  description      TEXT,
  remarks          TEXT,          -- for the parents
  -- something the parents should act on (see a specialist, glasses, dental care)
  needs_attention  BOOLEAN NOT NULL DEFAULT false,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at     TIMESTAMPTZ,
  published_by     BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  UNIQUE (camp_id, student_id)
);
CREATE INDEX health_checkups_by_student ON health_checkups (student_id, exam_date DESC);
CALL app.apply_tenant_rls('health_checkups');

-- a parent hears when a medicine is given, the child is sent home or referred
CREATE OR REPLACE FUNCTION app.clinic_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name, NULL, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('clinic_visit', 'Clinic: visit to the school clinic',
       '{{who}} visited the school clinic at {{time}} for {{complaint}}. {{action}} - {{school}}',
       '["who","time","complaint","action","school"]'),
      ('clinic_sent_home', 'Clinic: please collect your child',
       '{{who}} is unwell ({{complaint}}) and should go home. Please collect your child from the school clinic. - {{school}}',
       '["who","complaint","school"]'),
      ('clinic_referred', 'Clinic: referred to a doctor or hospital',
       '{{who}} was seen at the school clinic for {{complaint}} and is referred to {{referred}}. Please contact the school. - {{school}}',
       '["who","complaint","referred","school"]'),
      ('clinic_health_card', 'Clinic: health check-up card ready',
       'The health check-up card of {{who}} ({{camp}}) is ready. Open the parent portal → Health to read and download it. - {{school}}',
       '["who","camp","school"]')
    ) AS t(code, name, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION app.module_seed_templates(p_code TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_code LIKE 'gate\_pass\_%' THEN PERFORM app.gate_pass_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'helpdesk\_%' THEN PERFORM app.helpdesk_seed_templates(app.current_school_id());
  ELSIF p_code LIKE 'clinic\_%' THEN PERFORM app.clinic_seed_templates(app.current_school_id());
  END IF;
END
$$;
