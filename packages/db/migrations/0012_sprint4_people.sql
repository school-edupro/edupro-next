-- 0012_sprint4_people.sql
-- Sprint 4: people masters (students, guardians, enrolments, employees, postings, documents), search and
-- the permissions of the people module (WP5). Students and employees are per school, identified by a
-- school-unique number; enrolments and postings are the per-year facts (ADR-003: no row copies).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TYPE gender            AS ENUM ('male', 'female', 'other', 'unspecified');
CREATE TYPE guardian_relation AS ENUM ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other');
CREATE TYPE enrolment_status  AS ENUM ('active', 'promoted', 'transferred', 'withdrawn', 'left');
CREATE TYPE employee_type     AS ENUM ('teaching', 'non_teaching', 'contract', 'visiting');
CREATE TYPE document_kind     AS ENUM ('photo', 'birth_certificate', 'aadhaar', 'transfer_certificate', 'address_proof',
                                       'category_certificate', 'medical', 'pan', 'bank', 'qualification', 'other');

-- Search text is accent-insensitive; the wrapper is IMMUTABLE so it can feed generated columns.
CREATE OR REPLACE FUNCTION app.search_text(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(public.unaccent(coalesce(p, ''))) $$;

CREATE TABLE students (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  admission_no     TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  last_name        TEXT,
  display_name     TEXT GENERATED ALWAYS AS (btrim(first_name || ' ' || coalesce(last_name, ''))) STORED,
  dob              DATE,
  gender           gender NOT NULL DEFAULT 'unspecified',
  category         TEXT,
  blood_group      TEXT,
  house            TEXT,
  admitted_on      DATE,
  left_on          DATE,
  user_id          BIGINT REFERENCES users(id),
  photo_file_id    BIGINT REFERENCES files(id),
  address          JSONB NOT NULL DEFAULT '{}'::jsonb,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- previous school, medical flags, custom fields
  status           row_status NOT NULL DEFAULT 'active',
  legacy_ref       TEXT,
  search_text      TEXT GENERATED ALWAYS AS (app.search_text(first_name || ' ' || coalesce(last_name, '') || ' ' || admission_no)) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ,
  UNIQUE (school_id, admission_no)
);
CREATE INDEX students_search_trgm ON students USING gin (search_text gin_trgm_ops);
CREATE INDEX students_by_status ON students (school_id, status) WHERE deleted_at IS NULL;

CREATE TABLE guardians (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  first_name       TEXT NOT NULL,
  last_name        TEXT,
  display_name     TEXT GENERATED ALWAYS AS (btrim(first_name || ' ' || coalesce(last_name, ''))) STORED,
  mobile           TEXT,
  email            CITEXT,
  occupation       TEXT,
  user_id          BIGINT REFERENCES users(id),
  address          JSONB NOT NULL DEFAULT '{}'::jsonb,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           row_status NOT NULL DEFAULT 'active',
  legacy_ref       TEXT,
  search_text      TEXT GENERATED ALWAYS AS (app.search_text(first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(mobile, ''))) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX guardians_search_trgm ON guardians USING gin (search_text gin_trgm_ops);
CREATE INDEX guardians_by_mobile ON guardians (school_id, mobile) WHERE mobile IS NOT NULL;

CREATE TABLE student_guardians (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  student_id             BIGINT NOT NULL REFERENCES students(id),
  guardian_id            BIGINT NOT NULL REFERENCES guardians(id),
  relation               guardian_relation NOT NULL,
  is_primary             BOOLEAN NOT NULL DEFAULT false,
  receives_notifications BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             BIGINT,
  UNIQUE (student_id, guardian_id)
);
CREATE INDEX student_guardians_by_guardian ON student_guardians (school_id, guardian_id);

CREATE TABLE enrolments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  student_id         BIGINT NOT NULL REFERENCES students(id),
  academic_year_id   BIGINT NOT NULL REFERENCES academic_years(id),
  class_section_id   BIGINT NOT NULL REFERENCES class_sections(id),
  roll_no            INT,
  status             enrolment_status NOT NULL DEFAULT 'active',
  joined_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_on           DATE,
  remarks            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  UNIQUE (student_id, academic_year_id)
);
CREATE INDEX enrolments_by_section ON enrolments (school_id, class_section_id) WHERE status = 'active';
CREATE UNIQUE INDEX enrolments_roll_no ON enrolments (class_section_id, roll_no) WHERE roll_no IS NOT NULL AND status = 'active';

CREATE TABLE employees (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  employee_code    TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  last_name        TEXT,
  display_name     TEXT GENERATED ALWAYS AS (btrim(first_name || ' ' || coalesce(last_name, ''))) STORED,
  dob              DATE,
  gender           gender NOT NULL DEFAULT 'unspecified',
  employee_type    employee_type NOT NULL DEFAULT 'teaching',
  designation      TEXT,
  department       TEXT,
  joined_on        DATE,
  left_on          DATE,
  mobile           TEXT,
  email            CITEXT,
  user_id          BIGINT REFERENCES users(id),
  photo_file_id    BIGINT REFERENCES files(id),
  address          JSONB NOT NULL DEFAULT '{}'::jsonb,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- qualifications, experience, statutory ids (masked in audit)
  status           row_status NOT NULL DEFAULT 'active',
  legacy_ref       TEXT,
  search_text      TEXT GENERATED ALWAYS AS (app.search_text(first_name || ' ' || coalesce(last_name, '') || ' ' || employee_code || ' ' || coalesce(mobile, ''))) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ,
  UNIQUE (school_id, employee_code)
);
CREATE INDEX employees_search_trgm ON employees USING gin (search_text gin_trgm_ops);

CREATE TABLE postings (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id               BIGINT NOT NULL REFERENCES schools(id),
  employee_id             BIGINT NOT NULL REFERENCES employees(id),
  academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
  campus_id               BIGINT REFERENCES campuses(id),
  department              TEXT,
  designation             TEXT,
  reports_to_employee_id  BIGINT REFERENCES employees(id),
  valid_from              DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to                DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              BIGINT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              BIGINT,
  UNIQUE (employee_id, academic_year_id),
  CHECK (reports_to_employee_id IS NULL OR reports_to_employee_id <> employee_id)
);
CREATE INDEX postings_by_year ON postings (school_id, academic_year_id);

CREATE TABLE person_documents (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  person_type   person_type NOT NULL CHECK (person_type IN ('student', 'guardian', 'employee')),
  person_id     BIGINT NOT NULL,
  kind          document_kind NOT NULL,
  file_id       BIGINT NOT NULL REFERENCES files(id),
  title         TEXT,
  number        TEXT,                      -- document number (Aadhaar, PAN...), masked in audit
  issued_on     DATE,
  expires_on    DATE,
  verified_at   TIMESTAMPTZ,
  verified_by   BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX person_documents_by_person ON person_documents (school_id, person_type, person_id) WHERE deleted_at IS NULL;

CALL app.apply_tenant_rls('students');
CALL app.apply_tenant_rls('guardians');
CALL app.apply_tenant_rls('student_guardians');
CALL app.apply_tenant_rls('enrolments');
CALL app.apply_tenant_rls('employees');
CALL app.apply_tenant_rls('postings');
CALL app.apply_tenant_rls('person_documents');

-- Siblings share a guardian. security_invoker keeps the caller's row-level security.
CREATE VIEW student_siblings WITH (security_invoker = true) AS
  SELECT a.school_id, a.student_id, b.student_id AS sibling_id, a.guardian_id
    FROM student_guardians a
    JOIN student_guardians b ON b.guardian_id = a.guardian_id AND b.student_id <> a.student_id;
GRANT SELECT ON student_siblings TO edupro_app, edupro_readonly;

-- ---------------------------------------------------------------------------
-- Enrolment procedure: one enrolment per student per academic year; the section must belong to the year;
-- the academics stage of the year must be open (app.assert_year_open from 0004).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.enrol_student(
  p_student_id       BIGINT,
  p_academic_year_id BIGINT,
  p_class_section_id BIGINT,
  p_roll_no          INT DEFAULT NULL,
  p_joined_on        DATE DEFAULT CURRENT_DATE
) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  v_id BIGINT;
  v_section_year BIGINT;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.assert_year_open(p_academic_year_id, 'academics');
  SELECT academic_year_id INTO v_section_year FROM class_sections WHERE id = p_class_section_id AND deleted_at IS NULL;
  IF v_section_year IS NULL THEN
    RAISE EXCEPTION 'enrolment.section_not_found' USING ERRCODE = 'P0002', DETAIL = 'class section does not exist';
  END IF;
  IF v_section_year <> p_academic_year_id THEN
    RAISE EXCEPTION 'enrolment.section_year_mismatch' USING ERRCODE = 'P0001', DETAIL = 'the section belongs to another academic year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND deleted_at IS NULL AND status = 'active') THEN
    RAISE EXCEPTION 'enrolment.student_not_active' USING ERRCODE = 'P0001', DETAIL = 'student is not active';
  END IF;
  INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on, created_by, updated_by)
  VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p_class_section_id, p_roll_no, p_joined_on, app.current_user_id(), app.current_user_id())
  ON CONFLICT (student_id, academic_year_id) DO UPDATE
    SET class_section_id = EXCLUDED.class_section_id, roll_no = EXCLUDED.roll_no, status = 'active', ended_on = NULL,
        joined_on = EXCLUDED.joined_on, updated_at = now(), updated_by = app.current_user_id()
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- ---------------------------------------------------------------------------
-- People search (S4-07): number and mobile matches first, then name similarity. Runs under the caller's
-- row-level security; the trigram indexes keep it under the 200 ms target on tens of thousands of rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.search_people(p_q TEXT, p_limit INT DEFAULT 20)
RETURNS TABLE (kind TEXT, id BIGINT, display_name TEXT, subtitle TEXT, rank REAL)
LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT app.search_text(p_q) AS text, regexp_replace(p_q, '\D', '', 'g') AS digits)
  SELECT * FROM (
    SELECT 'student'::text AS kind, s.id, s.display_name,
           s.admission_no || coalesce(' · ' || c.code || '-' || cs.name, '') AS subtitle,
           CASE WHEN lower(s.admission_no) = (SELECT text FROM q) THEN 2.0
                ELSE similarity(s.search_text, (SELECT text FROM q)) END::real AS rank
      FROM students s
      LEFT JOIN enrolments e ON e.student_id = s.id AND e.status = 'active' AND e.academic_year_id = app.current_academic_year_id()
      LEFT JOIN class_sections cs ON cs.id = e.class_section_id
      LEFT JOIN classes c ON c.id = cs.class_id
     WHERE s.deleted_at IS NULL
       AND (lower(s.admission_no) = (SELECT text FROM q) OR s.search_text % (SELECT text FROM q) OR s.search_text LIKE (SELECT text FROM q) || '%' OR s.search_text LIKE '% ' || (SELECT text FROM q) || '%')
    UNION ALL
    SELECT 'guardian', g.id, g.display_name, coalesce(g.mobile, g.email::text, ''),
           CASE WHEN (SELECT digits FROM q) <> '' AND g.mobile = (SELECT digits FROM q) THEN 2.0
                ELSE similarity(g.search_text, (SELECT text FROM q)) END::real
      FROM guardians g
     WHERE g.deleted_at IS NULL
       AND (((SELECT digits FROM q) <> '' AND g.mobile = (SELECT digits FROM q)) OR g.search_text % (SELECT text FROM q) OR g.search_text LIKE (SELECT text FROM q) || '%' OR g.search_text LIKE '% ' || (SELECT text FROM q) || '%')
    UNION ALL
    SELECT 'employee', em.id, em.display_name, em.employee_code || coalesce(' · ' || em.designation, ''),
           CASE WHEN lower(em.employee_code) = (SELECT text FROM q) OR ((SELECT digits FROM q) <> '' AND em.mobile = (SELECT digits FROM q)) THEN 2.0
                ELSE similarity(em.search_text, (SELECT text FROM q)) END::real
      FROM employees em
     WHERE em.deleted_at IS NULL
       AND (lower(em.employee_code) = (SELECT text FROM q) OR ((SELECT digits FROM q) <> '' AND em.mobile = (SELECT digits FROM q))
            OR em.search_text % (SELECT text FROM q) OR em.search_text LIKE (SELECT text FROM q) || '%' OR em.search_text LIKE '% ' || (SELECT text FROM q) || '%')
  ) hits
  ORDER BY rank DESC, display_name
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

-- ---------------------------------------------------------------------------
-- Permissions and templates
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.student.view',      'people', 'View students (scope: class_section)', false),
  ('people.student.create',    'people', 'Admit or create students', false),
  ('people.student.edit',      'people', 'Edit student records, photos and documents', false),
  ('people.student.delete',    'people', 'Remove a student record', true),
  ('people.guardian.view',     'people', 'View guardians', false),
  ('people.guardian.edit',     'people', 'Create, edit and link guardians', false),
  ('people.enrolment.manage',  'people', 'Enrol students into sections; change sections and roll numbers', false),
  ('people.employee.view',     'people', 'View employees', false),
  ('people.employee.create',   'people', 'Create employees', false),
  ('people.employee.edit',     'people', 'Edit employee records, postings and documents', false),
  ('people.employee.delete',   'people', 'Remove an employee record', true),
  ('people.document.view',     'people', 'View person documents', false),
  ('people.person.search',     'people', 'Search people by name, number or mobile', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin') AND p.module = 'people'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('people.student.view', 'people.student.create', 'people.student.edit', 'people.guardian.view', 'people.guardian.edit',
                 'people.enrolment.manage', 'people.employee.view', 'people.document.view', 'people.person.search')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('people.student.view', 'people.guardian.view', 'people.person.search')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('people.student.view', 'people.guardian.view', 'people.employee.view', 'people.document.view', 'people.person.search')
ON CONFLICT DO NOTHING;

-- Grants for the tables created after 0002 default privileges (the app role gets DML through defaults; keep explicit for clarity)
GRANT SELECT, INSERT, UPDATE, DELETE ON students, guardians, student_guardians, enrolments, employees, postings, person_documents TO edupro_app;
