-- 0213: Library set-up corrections (docs/design/36-library.md, "Set-up review").
-- Names can be put right: an author, subject, language, publisher or periodical is renamed in place
-- (books point at it by id) and the names a title keeps for its list and search follow. A duplicate is
-- merged into the row kept: everything that pointed at it moves, then it is removed. An accession series
-- keeps its library and material type once copies are numbered from it; a shelf keeps its library once
-- copies sit on it. Periodical kinds become the school's own list. A staff borrowing rule may name an
-- employee type of the Staff setup.

-- ---- the names a title keeps (author, publisher, language, subject) --------------------------------
CREATE OR REPLACE FUNCTION app.library_title_names(p_titles BIGINT[]) RETURNS VOID LANGUAGE sql AS $$
  UPDATE library_titles t SET
     author = (SELECT string_agg(a.name::text, ', ' ORDER BY ta.position) FROM library_title_authors ta
                 JOIN library_authors a ON a.id = ta.author_id WHERE ta.title_id = t.id AND ta.role = 'Author'),
     publisher = (SELECT name::text FROM library_publishers WHERE id = t.publisher_id),
     language = (SELECT name::text FROM library_languages WHERE id = t.language_id),
     category = (SELECT name::text FROM library_subjects WHERE id = t.subject_id)
   WHERE t.id = ANY(p_titles)
$$;

-- a renamed author, publisher, language or subject: the titles that name it follow
CREATE OR REPLACE FUNCTION app.library_name_renamed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_titles BIGINT[];
BEGIN
  IF NEW.name::text IS NOT DISTINCT FROM OLD.name::text THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'library_authors' THEN
    v_titles := ARRAY(SELECT DISTINCT title_id FROM library_title_authors WHERE author_id = NEW.id);
  ELSIF TG_TABLE_NAME = 'library_publishers' THEN
    v_titles := ARRAY(SELECT id FROM library_titles WHERE publisher_id = NEW.id);
  ELSIF TG_TABLE_NAME = 'library_languages' THEN
    v_titles := ARRAY(SELECT id FROM library_titles WHERE language_id = NEW.id);
  ELSE
    v_titles := ARRAY(SELECT id FROM library_titles WHERE subject_id = NEW.id);
  END IF;
  IF cardinality(v_titles) > 0 THEN PERFORM app.library_title_names(v_titles); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER library_authors_renamed AFTER UPDATE OF name ON library_authors
  FOR EACH ROW EXECUTE FUNCTION app.library_name_renamed();
CREATE TRIGGER library_publishers_renamed AFTER UPDATE OF name ON library_publishers
  FOR EACH ROW EXECUTE FUNCTION app.library_name_renamed();
CREATE TRIGGER library_languages_renamed AFTER UPDATE OF name ON library_languages
  FOR EACH ROW EXECUTE FUNCTION app.library_name_renamed();
CREATE TRIGGER library_subjects_renamed AFTER UPDATE OF name ON library_subjects
  FOR EACH ROW EXECUTE FUNCTION app.library_name_renamed();

-- ---- merging a duplicate into the row kept ---------------------------------------------------------
-- Every row that points at the duplicate (any foreign key to it) is moved to the row kept; an author
-- named twice on a title keeps one line; a subject's sub-subjects are joined; the titles' names are
-- refreshed; the duplicate is removed. Runs under the caller's school (row-level security).
CREATE OR REPLACE FUNCTION app.library_merge(p_table TEXT, p_keep BIGINT, p_drop BIGINT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  n INT;
  v_moved INT := 0;
  v_titles BIGINT[];
BEGIN
  IF p_table NOT IN ('library_authors', 'library_subjects', 'library_languages', 'library_publishers',
                     'library_periodicals') THEN
    RAISE EXCEPTION 'library_merge: % cannot be merged', p_table USING ERRCODE = '22023';
  END IF;
  IF p_keep = p_drop THEN
    RAISE EXCEPTION 'a row cannot be merged into itself' USING ERRCODE = '23514';
  END IF;
  EXECUTE format('SELECT count(*) FROM %I WHERE id = ANY($1)', p_table) USING ARRAY[p_keep, p_drop] INTO n;
  IF n <> 2 THEN RAISE EXCEPTION 'row not found' USING ERRCODE = 'P0002'; END IF;

  IF p_table = 'library_authors' THEN
    v_titles := ARRAY(SELECT DISTINCT title_id FROM library_title_authors WHERE author_id = p_drop);
    DELETE FROM library_title_authors d
     WHERE d.author_id = p_drop
       AND EXISTS (SELECT 1 FROM library_title_authors k
                    WHERE k.title_id = d.title_id AND k.author_id = p_keep AND k.role = d.role);
  ELSIF p_table = 'library_subjects' THEN
    UPDATE library_subjects k
       SET sub_subjects = ARRAY(SELECT DISTINCT x FROM unnest(k.sub_subjects || d.sub_subjects) AS x ORDER BY x)
      FROM library_subjects d
     WHERE k.id = p_keep AND d.id = p_drop;
    v_titles := ARRAY(SELECT id FROM library_titles WHERE subject_id = p_drop);
  ELSIF p_table = 'library_publishers' THEN
    v_titles := ARRAY(SELECT id FROM library_titles WHERE publisher_id = p_drop);
  ELSIF p_table = 'library_languages' THEN
    v_titles := ARRAY(SELECT id FROM library_titles WHERE language_id = p_drop);
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = p_table::regclass AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', r.tbl, r.col, r.col) USING p_keep, p_drop;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_moved := v_moved + n;
  END LOOP;

  IF v_titles IS NOT NULL AND cardinality(v_titles) > 0 THEN
    PERFORM app.library_title_names(v_titles);
  END IF;
  EXECUTE format('DELETE FROM %I WHERE id = $1', p_table) USING p_drop;
  RETURN jsonb_build_object('moved', v_moved, 'titles', COALESCE(cardinality(v_titles), 0));
END
$$;

-- ---- keys that stay once used ----------------------------------------------------------------------
-- an accession series: its library and material type, once a copy of that library and type exists
CREATE OR REPLACE FUNCTION app.library_series_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.library_id, NEW.material_type_id) IS DISTINCT FROM (OLD.library_id, OLD.material_type_id)
     AND EXISTS (SELECT 1 FROM library_copies c JOIN library_titles t ON t.id = c.title_id
                  WHERE c.school_id = OLD.school_id AND c.library_id = OLD.library_id
                    AND t.material_type_id = OLD.material_type_id) THEN
    RAISE EXCEPTION 'copies are numbered from this series, so its library and material type stay; add a new series instead'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER library_accession_series_guard BEFORE UPDATE OF library_id, material_type_id
  ON library_accession_series FOR EACH ROW EXECUTE FUNCTION app.library_series_guard();

-- a shelf: its library, once copies sit on it (its code can always be put right)
CREATE OR REPLACE FUNCTION app.library_shelf_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.library_id IS DISTINCT FROM OLD.library_id
     AND EXISTS (SELECT 1 FROM library_copies c WHERE c.school_id = OLD.school_id AND c.shelf_id = OLD.id) THEN
    RAISE EXCEPTION 'copies sit on this shelf, so its library stays; move the copies first or add a shelf in the other library'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER library_shelves_guard BEFORE UPDATE OF library_id
  ON library_shelves FOR EACH ROW EXECUTE FUNCTION app.library_shelf_guard();

-- ---- periodical kinds: the school's own list -------------------------------------------------------
CREATE TABLE library_periodical_kinds (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        CITEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 100,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('library_periodical_kinds');

INSERT INTO library_periodical_kinds (school_id, name, sort_order)
SELECT s.id, x.name, x.n
  FROM schools s
 CROSS JOIN (VALUES ('Magazine', 10), ('Newspaper', 20), ('Journal', 30), ('Bulletin', 40)) AS x(name, n)
ON CONFLICT DO NOTHING;
-- a kind a school typed that is not one of the four stays, as its own row
INSERT INTO library_periodical_kinds (school_id, name)
SELECT DISTINCT school_id, btrim(kind) FROM library_periodicals WHERE NULLIF(btrim(kind), '') IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE library_periodicals ADD COLUMN kind_id BIGINT REFERENCES library_periodical_kinds(id);
UPDATE library_periodicals p SET kind_id = k.id
  FROM library_periodical_kinds k
 WHERE k.school_id = p.school_id AND k.name = btrim(p.kind);
ALTER TABLE library_periodicals DROP COLUMN kind;

-- ---- staff borrowing rules by employee type --------------------------------------------------------
ALTER TABLE library_borrow_rules ADD COLUMN employee_type_id BIGINT REFERENCES employee_types(id);
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'library_borrow_rules'::regclass AND contype = 'u';
  EXECUTE format('ALTER TABLE library_borrow_rules DROP CONSTRAINT %I', v_name);
END $$;
ALTER TABLE library_borrow_rules ADD CONSTRAINT library_borrow_rules_key
  UNIQUE NULLS NOT DISTINCT (school_id, applies_to, class_id, staff_group, employee_type_id);

-- a class belongs to a student rule; an employee type or a staff group (not both) to a staff rule
CREATE OR REPLACE FUNCTION app.library_borrow_rule_tidy() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.applies_to = 'Employee' THEN
    NEW.class_id := NULL;
    IF NEW.employee_type_id IS NOT NULL AND NEW.staff_group IS NOT NULL THEN
      RAISE EXCEPTION 'pick an employee type or a staff group, not both' USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.staff_group := NULL;
    NEW.employee_type_id := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- the rule a borrower follows: the most specific active rule (hostel students: a hostel rule first; the
-- class, then all classes; staff: the employee type, then the staff group, then all staff)
CREATE OR REPLACE FUNCTION app.library_rule(p_kind library_borrower, p_id BIGINT)
RETURNS TABLE (max_books INT, loan_days INT, renewals INT, fine_per_day NUMERIC, max_fine NUMERIC,
               grace_days INT, label TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_class BIGINT;
  v_hostel BOOLEAN := false;
  v_group TEXT;
  v_type TEXT;
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
    -- the group from the record; the type is the Staff setup type the record names (profile.staff_type)
    SELECT CASE e.employee_type::text WHEN 'teaching' THEN 'Teaching' WHEN 'non_teaching' THEN 'Non-teaching'
                WHEN 'contract' THEN 'Contract' WHEN 'visiting' THEN 'Visiting' END,
           lower(NULLIF(btrim(e.profile->>'staff_type'), ''))
      INTO v_group, v_type FROM employees e WHERE e.id = p_id;
    RETURN QUERY
      SELECT r.max_books, r.loan_days, r.renewals, r.fine_per_day, r.max_fine, r.grace_days,
             'Staff · ' || COALESCE(et.name, r.staff_group, 'all staff')
        FROM library_borrow_rules r LEFT JOIN employee_types et ON et.id = r.employee_type_id
       WHERE r.status = 'active' AND r.applies_to = 'Employee'
         AND (r.employee_type_id IS NULL OR lower(et.name) = v_type)
         AND (r.staff_group IS NULL OR r.staff_group = v_group)
       ORDER BY (r.employee_type_id IS NOT NULL) DESC, (r.staff_group IS NOT NULL) DESC
       LIMIT 1;
  END IF;
END
$$;

-- ---- a new school's library set-up also has the four periodical kinds ------------------------------
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
  INSERT INTO library_periodical_kinds (school_id, name, sort_order)
  SELECT p_school, x.name, x.n
    FROM (VALUES ('Magazine', 10), ('Newspaper', 20), ('Journal', 30), ('Bulletin', 40)) AS x(name, n)
  ON CONFLICT DO NOTHING;
  INSERT INTO library_borrow_rules (school_id, applies_to, max_books, loan_days, renewals, fine_per_day)
  VALUES (p_school, 'Student', 2, 14, 2, 2), (p_school, 'Hostel student', 2, 14, 2, 2),
         (p_school, 'Employee', 5, 30, 2, 0)
  ON CONFLICT DO NOTHING;
END
$$;
