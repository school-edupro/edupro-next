-- 0180: the employee master, more (docs/design/30-employee-master.md):
-- * Employee document types (Staff setup): the school's own list of documents for employment, each
--   required for all staff, teaching staff only, non-teaching staff only, or none (optional), and whether
--   it expires. Whether a person is teaching staff comes from their department (Staff setup), else the
--   staff group of their employee type.
-- * Employee documents: the files uploaded against those types (several per type allowed), with number,
--   dates and the HR check (verified by / on).
-- * Teaching subjects: several per employee, from Academics → Subjects (the free text field goes).

CREATE TABLE employee_document_types (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  required_for  TEXT NOT NULL DEFAULT 'none' CHECK (required_for IN ('all', 'teaching', 'non_teaching', 'none')),
  has_expiry    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INT NOT NULL DEFAULT 100,
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT,
  UNIQUE (school_id, code),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('employee_document_types');

CREATE OR REPLACE FUNCTION app.employee_document_types_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO employee_document_types (school_id, code, name, required_for, has_expiry, sort_order)
  SELECT p_school, x.code, x.name, x.req, x.exp, x.n
    FROM (VALUES
      ('photo', 'Photograph', 'all', false, 10),
      ('aadhaar', 'Aadhaar card', 'all', false, 20),
      ('pan', 'PAN card', 'all', false, 30),
      ('resume', 'Resume / CV', 'all', false, 40),
      ('class10', '10th marksheet / certificate', 'all', false, 50),
      ('class12', '12th marksheet / certificate', 'all', false, 60),
      ('graduation', 'Graduation degree', 'teaching', false, 70),
      ('post_graduation', 'Post-graduation degree', 'none', false, 80),
      ('teacher_training', 'B.Ed. / D.El.Ed. / NTT', 'teaching', false, 90),
      ('tet', 'CTET / TET certificate', 'none', false, 100),
      ('experience', 'Experience certificate', 'none', false, 110),
      ('relieving', 'Relieving letter (last employer)', 'none', false, 120),
      ('appointment', 'Appointment letter', 'all', false, 130),
      ('joining', 'Joining report', 'all', false, 140),
      ('police', 'Police verification', 'all', true, 150),
      ('medical', 'Medical fitness certificate', 'all', true, 160),
      ('bank', 'Cancelled cheque / bank passbook', 'all', false, 170),
      ('address', 'Address proof', 'all', false, 180),
      ('character', 'Character certificate', 'none', false, 190),
      ('driving_licence', 'Driving licence', 'none', true, 200)
    ) AS x(code, name, req, exp, n)
   WHERE NOT EXISTS (SELECT 1 FROM employee_document_types t WHERE t.school_id = p_school)
$$;
SELECT app.employee_document_types_seed(id) FROM schools;

CREATE TABLE employee_documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type_id      BIGINT NOT NULL REFERENCES employee_document_types(id),
  file_id      BIGINT NOT NULL REFERENCES files(id),
  number       TEXT,
  issued_on    DATE,
  expires_on   DATE,
  remarks      TEXT,
  verified_at  TIMESTAMPTZ,
  verified_by  BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  deleted_at   TIMESTAMPTZ,
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX employee_documents_emp ON employee_documents (employee_id) WHERE deleted_at IS NULL;
CALL app.apply_tenant_rls('employee_documents');

CREATE TABLE employee_subjects (
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  subject_id   BIGINT NOT NULL REFERENCES subjects(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  PRIMARY KEY (employee_id, subject_id)
);
CREATE INDEX employee_subjects_subject ON employee_subjects (subject_id);
CALL app.apply_tenant_rls('employee_subjects');

-- the free text "teaching subject" becomes subjects where its text names one (by name or code)
INSERT INTO employee_subjects (school_id, employee_id, subject_id)
SELECT DISTINCT e.school_id, e.id, s.id
  FROM employees e
  JOIN subjects s ON s.school_id = e.school_id
   AND (lower(s.name) = lower(trim(e.profile ->> 'teaching_subject')) OR lower(s.code) = lower(trim(e.profile ->> 'teaching_subject')))
 WHERE COALESCE(trim(e.profile ->> 'teaching_subject'), '') <> ''
ON CONFLICT DO NOTHING;
