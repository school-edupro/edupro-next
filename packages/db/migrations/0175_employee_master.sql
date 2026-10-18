-- 0175: the employee master (docs/design/30-employee-master.md), part 1.
-- Staff setup masters the employee form picks from: departments, designations and employee types (each
-- type belongs to a staff group, the employee_type the rest of the ERP already reads). The full staff
-- profile lives, like the student profile, in employees.profile (plain) and employees.secure (Aadhaar,
-- PAN and the bank account, encrypted by the API); addresses in employees.address (present / permanent,
-- the student address pattern). Education, languages, experience, transfers and remarks are rows.

-- ---- staff setup masters ------------------------------------------------------------------------
CREATE TABLE departments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  staff_group TEXT NOT NULL DEFAULT 'both' CHECK (staff_group IN ('teaching', 'non_teaching', 'both')),
  sort_order  INT NOT NULL DEFAULT 100,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('departments');

CREATE TABLE designations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  staff_group TEXT NOT NULL DEFAULT 'both' CHECK (staff_group IN ('teaching', 'non_teaching', 'both')),
  sort_order  INT NOT NULL DEFAULT 100,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('designations');

CREATE TABLE employee_types (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- the group the ERP reads (timetable, attendance, ID cards): teaching, non_teaching, contract, visiting
  staff_group employee_type NOT NULL,
  sort_order  INT NOT NULL DEFAULT 100,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('employee_types');

-- a code from a name: small letters, digits and _
CREATE OR REPLACE FUNCTION app.code_of(p TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT left(trim(BOTH '_' FROM regexp_replace(lower(p), '[^a-z0-9]+', '_', 'g')), 30)
$$;

-- every school starts with the usual Indian school lists, plus the departments and designations its
-- employees already carry (free text until now)
CREATE OR REPLACE FUNCTION app.staff_masters_seed(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO employee_types (school_id, code, name, staff_group, sort_order)
  SELECT p_school, x.code, x.name, x.g::employee_type, x.n
    FROM (VALUES ('teaching_regular', 'Teaching Regular', 'teaching', 10),
                 ('teaching_contract', 'Teaching Contract', 'contract', 20),
                 ('non_teaching_regular', 'Non-Teaching Regular', 'non_teaching', 30),
                 ('non_teaching_contract', 'Non-Teaching Contract', 'contract', 40),
                 ('visiting', 'Visiting Faculty', 'visiting', 50)) AS x(code, name, g, n)
  ON CONFLICT DO NOTHING;

  INSERT INTO departments (school_id, code, name, staff_group, sort_order)
  SELECT p_school, x.code, x.name, x.g, x.n
    FROM (VALUES ('teaching_pre_primary', 'Teaching Pre-Primary', 'teaching', 10),
                 ('teaching_primary', 'Teaching Primary', 'teaching', 20),
                 ('teaching_junior', 'Teaching Junior', 'teaching', 30),
                 ('teaching_senior', 'Teaching Senior', 'teaching', 40),
                 ('administration', 'Administration', 'non_teaching', 50),
                 ('accounts', 'Accounts', 'non_teaching', 60),
                 ('it', 'IT', 'non_teaching', 70),
                 ('library', 'Library', 'both', 80),
                 ('sports', 'Sports', 'both', 90),
                 ('transport', 'Transport', 'non_teaching', 100),
                 ('housekeeping', 'Housekeeping', 'non_teaching', 110),
                 ('security', 'Security', 'non_teaching', 120)) AS x(code, name, g, n)
  ON CONFLICT DO NOTHING;
  INSERT INTO departments (school_id, code, name, sort_order)
  SELECT DISTINCT ON (app.code_of(e.department)) p_school, app.code_of(e.department), trim(e.department), 200
    FROM employees e
   WHERE e.school_id = p_school AND e.department IS NOT NULL AND trim(e.department) <> '' AND app.code_of(e.department) <> ''
  ON CONFLICT DO NOTHING;

  INSERT INTO designations (school_id, code, name, staff_group, sort_order)
  SELECT p_school, x.code, x.name, x.g, x.n
    FROM (VALUES ('principal', 'Principal', 'teaching', 10), ('vice_principal', 'Vice Principal', 'teaching', 20),
                 ('headmistress', 'Headmistress', 'teaching', 30), ('coordinator', 'Coordinator', 'teaching', 40),
                 ('pgt', 'PGT', 'teaching', 50), ('tgt', 'TGT', 'teaching', 60), ('prt', 'PRT', 'teaching', 70),
                 ('ntt', 'NTT', 'teaching', 80), ('pet', 'PET', 'teaching', 90), ('counsellor', 'Counsellor', 'both', 100),
                 ('librarian', 'Librarian', 'both', 110), ('lab_assistant', 'Lab Assistant', 'non_teaching', 120),
                 ('accountant', 'Accountant', 'non_teaching', 130), ('office_assistant', 'Office Assistant', 'non_teaching', 140),
                 ('receptionist', 'Receptionist', 'non_teaching', 150), ('nurse', 'Nurse', 'non_teaching', 160),
                 ('driver', 'Driver', 'non_teaching', 170), ('conductor', 'Conductor', 'non_teaching', 180),
                 ('attendant', 'Attendant', 'non_teaching', 190), ('security_guard', 'Security Guard', 'non_teaching', 200)
         ) AS x(code, name, g, n)
  ON CONFLICT DO NOTHING;
  INSERT INTO designations (school_id, code, name, sort_order)
  SELECT DISTINCT ON (app.code_of(e.designation)) p_school, app.code_of(e.designation), trim(e.designation), 300
    FROM employees e
   WHERE e.school_id = p_school AND e.designation IS NOT NULL AND trim(e.designation) <> '' AND app.code_of(e.designation) <> ''
  ON CONFLICT DO NOTHING;
END $$;
SELECT app.staff_masters_seed(id) FROM schools;

-- ---- the profile ---------------------------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN secure JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN completeness INT NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100);
COMMENT ON COLUMN employees.profile IS 'employee field catalogue values (packages/db/src/employee-fields.ts)';
COMMENT ON COLUMN employees.secure IS 'encrypted catalogue values: Aadhaar, PAN, bank account (field crypto)';
COMMENT ON COLUMN employees.address IS '{present: {line1, line2, line3, city, state, country, pin}, permanent: {...}}';
-- what the type the employee carries says, kept with the group
UPDATE employees e SET profile = jsonb_build_object('staff_type', t.name)
  FROM employee_types t
 WHERE t.school_id = e.school_id
   AND t.code = CASE e.employee_type WHEN 'teaching' THEN 'teaching_regular' WHEN 'non_teaching' THEN 'non_teaching_regular'
                                     WHEN 'contract' THEN 'teaching_contract' ELSE 'visiting' END;

-- ---- rows: education, languages, experience, transfers, remarks -------------------------------
CREATE TABLE employee_education (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  employee_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  qualification  TEXT NOT NULL,
  specialisation TEXT,
  institution    TEXT,
  passing_year   INT CHECK (passing_year IS NULL OR passing_year BETWEEN 1940 AND 2100),
  score          TEXT,
  mode           TEXT,
  sort_order     INT NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT
);
CREATE INDEX employee_education_emp ON employee_education (employee_id);
CALL app.apply_tenant_rls('employee_education');

CREATE TABLE employee_languages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  can_read    BOOLEAN NOT NULL DEFAULT false,
  can_write   BOOLEAN NOT NULL DEFAULT false,
  can_speak   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  UNIQUE (employee_id, language)
);
CALL app.apply_tenant_rls('employee_languages');

CREATE TABLE employee_experience (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organisation  TEXT NOT NULL,
  designation   TEXT,
  from_on       DATE,
  to_on         DATE,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  CHECK (to_on IS NULL OR from_on IS NULL OR to_on >= from_on)
);
CREATE INDEX employee_experience_emp ON employee_experience (employee_id);
CALL app.apply_tenant_rls('employee_experience');

CREATE TABLE employee_transfers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  on_date      DATE NOT NULL,
  from_place   TEXT,
  to_place     TEXT NOT NULL,
  order_no     TEXT,
  remarks      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT
);
CREATE INDEX employee_transfers_emp ON employee_transfers (employee_id);
CALL app.apply_tenant_rls('employee_transfers');

CREATE TABLE employee_remarks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  on_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  remark       TEXT NOT NULL,
  -- typed by the office, or written by the system (status changes)
  source       TEXT NOT NULL DEFAULT 'office' CHECK (source IN ('office', 'system')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT
);
CREATE INDEX employee_remarks_emp ON employee_remarks (employee_id, on_date DESC);
CALL app.apply_tenant_rls('employee_remarks');
