-- 0386: certificate management, phase E (docs/design/87). Bulk issue by section, chosen students or leavers, one PDF
-- for the batch in roll order; the awards the school gives (a master) and who received them (allotments, one by one or
-- from a CSV), issued as award certificates — achievement, merit, participation, award — with ready layouts; the
-- achievement certificates of the engagement module come into the register (their numbers kept) and are numbered by its
-- series from now on.

-- ---- a batch issued together -----------------------------------------------------------------------------------------
CREATE TABLE certificate_batches (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  type_id         BIGINT NOT NULL REFERENCES certificate_types(id),
  title           TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  -- what it was issued to: {"sectionId"} | {"studentIds"} | {"leavers": true} | {"allotmentIds"}
  scope           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- the certificates, in the order they print
  certificate_ids BIGINT[] NOT NULL DEFAULT '{}',
  -- who was left out and why: [{"studentId", "name", "reason"}]
  skipped         JSONB NOT NULL DEFAULT '[]'::jsonb,
  override_reason TEXT CHECK (override_reason IS NULL OR length(override_reason) BETWEEN 10 AND 300),
  export_id       BIGINT,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX certificate_batches_school ON certificate_batches (school_id, created_at DESC);
CALL app.apply_tenant_rls('certificate_batches');
CREATE TRIGGER certificate_batches_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_batches
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
ALTER TABLE certificates ADD COLUMN batch_id BIGINT REFERENCES certificate_batches(id);

-- ---- awards --------------------------------------------------------------------------------------------------------
CREATE TABLE certificate_awards (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  -- the certificate type it is issued on: ACHIEVEMENT, MERIT, PARTICIPATION, AWARD (or a type of the school's own)
  type_code   TEXT NOT NULL CHECK (type_code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('certificate_awards');
CREATE TRIGGER certificate_awards_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_awards
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE certificate_award_allotments (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  award_id       BIGINT NOT NULL REFERENCES certificate_awards(id),
  student_id     BIGINT NOT NULL REFERENCES students(id),
  event          TEXT CHECK (event IS NULL OR length(event) <= 160),
  -- the place or level: First, Second, Gold, Distinction …
  position       TEXT CHECK (position IS NULL OR length(position) <= 40),
  awarded_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks        TEXT CHECK (remarks IS NULL OR length(remarks) <= 300),
  certificate_id BIGINT REFERENCES certificates(id),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX certificate_award_allotments_award ON certificate_award_allotments (award_id, awarded_on DESC);
CREATE INDEX certificate_award_allotments_student ON certificate_award_allotments (student_id);
CALL app.apply_tenant_rls('certificate_award_allotments');
CREATE TRIGGER certificate_award_allotments_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_award_allotments
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the award types, with the others ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.certificate_types_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO certificate_types (school_id, code, name, audience, prefix, rules, multiple, uses_book, sort_order, built_in)
  SELECT p_school, x.code, x.name, x.audience, x.prefix, x.rules::jsonb, x.multiple, x.book, x.n, true
    FROM (VALUES
      ('TC', 'Transfer certificate', 'STUDENT', 'TC',
       '{"state": "leaving", "fees": true, "library": true, "hostel": true, "transport": true}', 'ONE', true, 10),
      ('BONAFIDE', 'Bonafide certificate', 'STUDENT', 'BON', '{"state": "active"}', 'ANY', false, 20),
      ('CHARACTER', 'Character certificate', 'STUDENT', 'CHR', '{"state": "any"}', 'ANY', false, 30),
      ('DOB', 'Date of birth certificate', 'STUDENT', 'DOB', '{"state": "any"}', 'ANY', false, 40),
      ('DOB_JUST', 'Date of birth justification', 'STUDENT', 'DOBJ', '{"state": "any"}', 'ANY', false, 45),
      ('STUDY', 'Study certificate', 'STUDENT', 'STU', '{"state": "any"}', 'ANY', false, 50),
      ('CASTE', 'Caste certificate (school record)', 'STUDENT', 'CST', '{"state": "any"}', 'ANY', false, 55),
      ('DOMICILE', 'Domicile (residence) certificate', 'STUDENT', 'DOM', '{"state": "active"}', 'ANY', false, 60),
      ('NOC', 'No objection certificate', 'STUDENT', 'NOC', '{"state": "active"}', 'ANY', false, 65),
      ('TRAVEL_NOC', 'No objection certificate for travel', 'STUDENT', 'TNOC', '{"state": "active"}', 'ANY', false, 70),
      ('VISA', 'Visa letter', 'STUDENT', 'VISA', '{"state": "active"}', 'ANY', false, 75),
      ('SCHOLAR', 'Scholarship certificate', 'STUDENT', 'SCH', '{"state": "active"}', 'ANY', false, 80),
      ('BOARD_REG', 'Board registration verification', 'STUDENT', 'BRV',
       '{"state": "active", "classes": ["VIII", "IX", "X", "XI", "XII"]}', 'ANY', false, 85),
      ('FEE_PAID', 'Fee paid certificate', 'STUDENT', 'FEE', '{"state": "any"}', 'ANY', false, 90),
      ('ACHIEVEMENT', 'Achievement certificate', 'STUDENT', 'ACH', '{"state": "any"}', 'ANY', false, 95),
      ('MERIT', 'Merit certificate', 'STUDENT', 'MRT', '{"state": "any"}', 'ANY', false, 96),
      ('PARTICIPATION', 'Participation certificate', 'STUDENT', 'PRT', '{"state": "any"}', 'ANY', false, 97),
      ('AWARD', 'Award certificate', 'STUDENT', 'AWD', '{"state": "any"}', 'ANY', false, 98),
      ('EXPERIENCE', 'Experience certificate', 'STAFF', 'EXP', '{"state": "leaving"}', 'ONE', false, 110),
      ('SERVICE', 'Service certificate', 'STAFF', 'SRV', '{"state": "active"}', 'ANY', false, 120),
      ('STAFF_VISA', 'Staff visa NOC', 'STAFF', 'SVN', '{"state": "active"}', 'ANY', false, 130)
    ) AS x(code, name, audience, prefix, rules, multiple, book, n)
  ON CONFLICT DO NOTHING
$$;
SELECT app.certificate_types_seed(id) FROM schools;

-- ---- the engagement module's achievement certificates come into the register (numbers kept; their PDF is the batch's)
INSERT INTO certificates (school_id, type_id, number, serial, year_code, student_id, status, issued_on, issued_by, data,
                         export_id, legacy_ref, created_at)
SELECT ci.school_id, ct.id, ci.serial_no, NULL, split_part(ci.serial_no, '/', 2), ci.student_id, 'issued', ci.issued_on,
       ci.issued_by,
       jsonb_build_object('student', jsonb_build_object('name', s.display_name, 'admissionNo', s.admission_no),
                          'fields', jsonb_build_object('award', ci.title, 'text', ci.text)),
       ci.export_id, 'achievement:' || ci.id::text, ci.created_at
  FROM certificates_issued ci
  JOIN certificate_types ct ON ct.school_id = ci.school_id AND ct.code = 'ACHIEVEMENT'
  JOIN students s ON s.id = ci.student_id
ON CONFLICT DO NOTHING;
