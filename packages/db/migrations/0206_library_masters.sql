-- Library, part 1 (docs/design/36-library.md): the set-up masters of the rebuilt library and the
-- borrowing rules the issue desk follows. The legacy set-up tabs (Library, Subjects, Authors, Languages,
-- Periodicals, Publishers, Define Shelf, Vendors, Study Materials, Book Limit) become masters of the
-- school (not of a year), on the shared masters grid. Titles and copies link to them in part 2.

CREATE TABLE library_libraries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  campus_id   BIGINT REFERENCES campuses(id),
  place       TEXT,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('library_libraries');

-- what a copy is: book, textbook, reference, magazine, CD/DVD, map (the legacy Study materials and the
-- Book/Text category); a type that cannot be issued stays in the library
CREATE TABLE library_material_types (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  issuable    BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 100,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('library_material_types');

-- the accession number of a new copy: the prefix of its library and material type, then the next number
-- of that series (one running series across the years; given under a row lock in part 2)
CREATE TABLE library_accession_series (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  library_id        BIGINT NOT NULL REFERENCES library_libraries(id),
  material_type_id  BIGINT NOT NULL REFERENCES library_material_types(id),
  prefix            TEXT NOT NULL DEFAULT '' CHECK (prefix ~ '^[A-Z0-9/-]{0,10}$'),
  digits            INT NOT NULL DEFAULT 5 CHECK (digits BETWEEN 1 AND 10),
  next_no           BIGINT NOT NULL DEFAULT 1 CHECK (next_no >= 1),
  status            row_status NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, library_id, material_type_id)
);
CALL app.apply_tenant_rls('library_accession_series');

CREATE TABLE library_subjects (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  name          CITEXT NOT NULL,
  class_no      TEXT,                                   -- Dewey class, the start of a call number
  sub_subjects  TEXT[] NOT NULL DEFAULT '{}',
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('library_subjects');

CREATE TABLE library_authors (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        CITEXT NOT NULL,
  note        TEXT,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('library_authors');

CREATE TABLE library_languages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        CITEXT NOT NULL,
  code        TEXT,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('library_languages');

CREATE TABLE library_publishers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        CITEXT NOT NULL,
  place       TEXT,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('library_publishers');

CREATE TABLE library_vendors (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  contact_person  TEXT,
  mobile          TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  gstin           TEXT,
  status          row_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('library_vendors');

CREATE TABLE library_periodicals (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  name          CITEXT NOT NULL,
  kind          TEXT,                                   -- Magazine, Newspaper, Journal, Bulletin
  frequency     TEXT,                                   -- Daily … Yearly (the issues expected, part 6)
  language_id   BIGINT REFERENCES library_languages(id),
  publisher_id  BIGINT REFERENCES library_publishers(id),
  vendor_id     BIGINT REFERENCES library_vendors(id),
  issn          TEXT,
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('library_periodicals');

-- a shelf (almirah) of a library and its racks: a copy sits on a shelf and a rack (part 2)
CREATE TABLE library_shelves (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  library_id  BIGINT NOT NULL REFERENCES library_libraries(id),
  code        TEXT NOT NULL,
  name        TEXT,
  racks       TEXT[] NOT NULL DEFAULT '{}',
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, library_id, code)
);
CALL app.apply_tenant_rls('library_shelves');

-- the legacy Book limit: who may borrow how many, for how long, renewed how often, at what fine. A rule
-- with no class is for every class; with no staff group, for all staff.
CREATE TABLE library_borrow_rules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  applies_to    TEXT NOT NULL CHECK (applies_to IN ('Student', 'Hostel student', 'Employee')),
  class_id      BIGINT REFERENCES classes(id),
  staff_group   TEXT CHECK (staff_group IS NULL OR staff_group IN ('Teaching', 'Non-teaching', 'Contract', 'Visiting')),
  max_books     INT NOT NULL CHECK (max_books BETWEEN 0 AND 50),
  loan_days     INT NOT NULL CHECK (loan_days BETWEEN 1 AND 365),
  renewals      INT NOT NULL DEFAULT 2 CHECK (renewals BETWEEN 0 AND 10),
  fine_per_day  NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (fine_per_day >= 0),
  max_fine      NUMERIC(10,2) CHECK (max_fine IS NULL OR max_fine >= 0),
  grace_days    INT NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 60),
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (school_id, applies_to, class_id, staff_group)
);
CALL app.apply_tenant_rls('library_borrow_rules');

-- a class belongs to a student rule, a staff group to a staff rule: the other is cleared
CREATE OR REPLACE FUNCTION app.library_borrow_rule_tidy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.applies_to = 'Employee' THEN NEW.class_id := NULL; ELSE NEW.staff_group := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER library_borrow_rules_tidy BEFORE INSERT OR UPDATE ON library_borrow_rules
  FOR EACH ROW EXECUTE FUNCTION app.library_borrow_rule_tidy();

-- every school starts with a Main library, the usual material types and their prefixes, the common
-- languages and three rules (students, hostel students, staff)
CREATE OR REPLACE FUNCTION app.library_seed(p_school BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO library_libraries (school_id, code, name)
  VALUES (p_school, 'MAIN', 'Main library') ON CONFLICT DO NOTHING;
  INSERT INTO library_material_types (school_id, code, name, issuable, sort_order)
  SELECT p_school, x.code, x.name, x.issuable, x.n
    FROM (VALUES ('BOOK', 'Book', true, 10), ('TEXT', 'Textbook', true, 20), ('REF', 'Reference', false, 30),
                 ('MAG', 'Magazine or periodical', true, 40), ('AV', 'CD or DVD', true, 50), ('MAP', 'Map or chart', false, 60))
         AS x(code, name, issuable, n)
  ON CONFLICT DO NOTHING;
  -- a series per library and type that has none yet
  INSERT INTO library_accession_series (school_id, library_id, material_type_id, prefix)
  SELECT p_school, l.id, m.id,
         CASE m.code WHEN 'BOOK' THEN 'B' WHEN 'TEXT' THEN 'T' WHEN 'REF' THEN 'R' WHEN 'MAG' THEN 'M'
                     WHEN 'AV' THEN 'AV' WHEN 'MAP' THEN 'MP' ELSE upper(left(m.code, 3)) END
    FROM library_libraries l CROSS JOIN library_material_types m
   WHERE l.school_id = p_school AND m.school_id = p_school AND l.code = 'MAIN'
  ON CONFLICT DO NOTHING;
  INSERT INTO library_languages (school_id, name, code)
  SELECT p_school, x.name, x.code
    FROM (VALUES ('English', 'en'), ('Hindi', 'hi'), ('Sanskrit', 'sa'), ('Urdu', 'ur'), ('Punjabi', 'pa'),
                 ('French', 'fr'), ('German', 'de')) AS x(name, code)
  ON CONFLICT DO NOTHING;
  INSERT INTO library_borrow_rules (school_id, applies_to, max_books, loan_days, renewals, fine_per_day)
  VALUES (p_school, 'Student', 2, 14, 2, 2), (p_school, 'Hostel student', 2, 14, 2, 2),
         (p_school, 'Employee', 5, 30, 2, 0)
  ON CONFLICT DO NOTHING;
END
$$;
SELECT app.library_seed(id) FROM schools;

-- the rule a borrower follows: the most specific active rule (hostel students: a hostel rule first; the
-- class, then all classes; staff: the staff group, then all staff); none: no row (the settings apply)
CREATE OR REPLACE FUNCTION app.library_rule(p_kind library_borrower, p_id BIGINT)
RETURNS TABLE (max_books INT, loan_days INT, renewals INT, fine_per_day NUMERIC, max_fine NUMERIC,
               grace_days INT, label TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_class BIGINT;
  v_hostel BOOLEAN := false;
  v_group TEXT;
BEGIN
  IF p_kind = 'student' THEN
    SELECT cs.class_id INTO v_class
      FROM enrolments e
      JOIN class_sections cs ON cs.id = e.class_section_id
      JOIN academic_years y ON y.id = e.academic_year_id
     WHERE e.student_id = p_id AND e.status = 'active'
     ORDER BY (y.id = app.current_academic_year_id()) DESC NULLS LAST, (y.status::text = 'active') DESC, y.start_date DESC
     LIMIT 1;
    v_hostel := EXISTS (SELECT 1 FROM hostel_allotments a
                         WHERE a.student_id = p_id AND a.from_date <= CURRENT_DATE
                           AND (a.to_date IS NULL OR a.to_date >= CURRENT_DATE));
    RETURN QUERY
      SELECT r.max_books, r.loan_days, r.renewals, r.fine_per_day, r.max_fine, r.grace_days,
             r.applies_to || ' · ' || COALESCE(c.name, 'every class')
        FROM library_borrow_rules r LEFT JOIN classes c ON c.id = r.class_id
       WHERE r.status = 'active'
         AND (r.applies_to = 'Student' OR (r.applies_to = 'Hostel student' AND v_hostel))
         AND (r.class_id IS NULL OR r.class_id = v_class)
       ORDER BY (r.applies_to = 'Hostel student') DESC, (r.class_id IS NOT NULL) DESC
       LIMIT 1;
  ELSE
    SELECT CASE e.employee_type::text WHEN 'teaching' THEN 'Teaching' WHEN 'non_teaching' THEN 'Non-teaching'
                WHEN 'contract' THEN 'Contract' WHEN 'visiting' THEN 'Visiting' END
      INTO v_group FROM employees e WHERE e.id = p_id;
    RETURN QUERY
      SELECT r.max_books, r.loan_days, r.renewals, r.fine_per_day, r.max_fine, r.grace_days,
             'Staff · ' || COALESCE(r.staff_group, 'all staff')
        FROM library_borrow_rules r
       WHERE r.status = 'active' AND r.applies_to = 'Employee'
         AND (r.staff_group IS NULL OR r.staff_group = v_group)
       ORDER BY (r.staff_group IS NOT NULL) DESC
       LIMIT 1;
  END IF;
END
$$;
