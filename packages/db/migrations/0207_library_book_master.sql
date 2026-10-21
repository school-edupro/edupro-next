-- Library, part 2 (docs/design/36-library.md): the book master. A title is entered once and linked to
-- the masters of part 1 (material type, subject, publisher, language, class; its authors, editors,
-- translators and illustrators in order); a copy has its library, shelf and rack, barcode, how it came
-- (purchase from a vendor with the bill, or a donation) and its status with the reason. Accession numbers
-- come from the series of the copy's library and the title's material type, under a row lock, skipping
-- numbers already taken. The text columns of a title (author, publisher, language, category) stay as the
-- names of its links, for search and the screens that show them.

CREATE SEQUENCE library_title_code_seq;

ALTER TABLE library_titles
  ALTER COLUMN code SET DEFAULT ('T' || lpad(nextval('library_title_code_seq')::text, 6, '0')),
  ADD COLUMN subtitle          TEXT,
  ADD COLUMN material_type_id  BIGINT REFERENCES library_material_types(id),
  ADD COLUMN subject_id        BIGINT REFERENCES library_subjects(id),
  ADD COLUMN sub_subject       TEXT,
  ADD COLUMN publisher_id      BIGINT REFERENCES library_publishers(id),
  ADD COLUMN publication_place TEXT,
  ADD COLUMN language_id       BIGINT REFERENCES library_languages(id),
  ADD COLUMN volume            TEXT,
  ADD COLUMN call_no           TEXT,
  ADD COLUMN keywords          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN class_id          BIGINT REFERENCES classes(id),
  ADD COLUMN notes             TEXT,
  ADD COLUMN created_by        BIGINT,
  ADD COLUMN updated_by        BIGINT;
CREATE INDEX library_titles_isbn ON library_titles (school_id, isbn) WHERE isbn IS NOT NULL;

-- the people of a title, in the order printed
CREATE TABLE library_title_authors (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  title_id   BIGINT NOT NULL REFERENCES library_titles(id) ON DELETE CASCADE,
  author_id  BIGINT NOT NULL REFERENCES library_authors(id),
  role       TEXT NOT NULL DEFAULT 'Author' CHECK (role IN ('Author', 'Editor', 'Translator', 'Illustrator')),
  position   INT NOT NULL DEFAULT 1,
  UNIQUE (title_id, author_id, role)
);
CREATE INDEX library_title_authors_by_author ON library_title_authors (author_id);
CALL app.apply_tenant_rls('library_title_authors');

ALTER TABLE library_copies
  ADD COLUMN library_id     BIGINT REFERENCES library_libraries(id),
  ADD COLUMN shelf_id       BIGINT REFERENCES library_shelves(id),
  ADD COLUMN rack           TEXT,
  ADD COLUMN barcode        TEXT,
  ADD COLUMN acquisition    TEXT CHECK (acquisition IS NULL OR acquisition IN ('Purchase', 'Donation')),
  ADD COLUMN vendor_id      BIGINT REFERENCES library_vendors(id),
  ADD COLUMN donor          TEXT,
  ADD COLUMN bill_no        TEXT,
  ADD COLUMN bill_date      DATE,
  ADD COLUMN po_no          TEXT,
  ADD COLUMN status_on      DATE,
  ADD COLUMN status_reason  TEXT,
  ADD COLUMN created_by     BIGINT,
  ADD COLUMN updated_by     BIGINT;
CREATE UNIQUE INDEX library_copies_barcode ON library_copies (school_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX library_copies_by_library ON library_copies (school_id, library_id, status);

-- what happened to a copy: accessioned, edited, moved, a status with its reason (lost and paid with the
-- amount)
CREATE TABLE library_copy_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  copy_id    BIGINT NOT NULL REFERENCES library_copies(id) ON DELETE CASCADE,
  what       TEXT NOT NULL,
  from_status TEXT,
  to_status  TEXT,
  on_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  reason     TEXT,
  amount     NUMERIC(10,2),
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_user    BIGINT,
  by_name    TEXT
);
CREATE INDEX library_copy_events_by_copy ON library_copy_events (copy_id, at);
CALL app.apply_tenant_rls('library_copy_events');

-- the titles and copies already there: linked to the masters (their text becomes master rows), the copies
-- placed in the school's Main library
SELECT app.library_seed(id) FROM schools;
INSERT INTO library_authors (school_id, name)
SELECT DISTINCT t.school_id, btrim(t.author) FROM library_titles t WHERE NULLIF(btrim(t.author), '') IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO library_title_authors (school_id, title_id, author_id)
SELECT t.school_id, t.id, a.id FROM library_titles t
  JOIN library_authors a ON a.school_id = t.school_id AND a.name = btrim(t.author)::citext
 WHERE NULLIF(btrim(t.author), '') IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO library_publishers (school_id, name)
SELECT DISTINCT t.school_id, btrim(t.publisher) FROM library_titles t WHERE NULLIF(btrim(t.publisher), '') IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE library_titles t SET publisher_id = p.id
  FROM library_publishers p WHERE p.school_id = t.school_id AND p.name = btrim(t.publisher)::citext;
INSERT INTO library_languages (school_id, name)
SELECT DISTINCT t.school_id, btrim(t.language) FROM library_titles t WHERE NULLIF(btrim(t.language), '') IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE library_titles t SET language_id = l.id
  FROM library_languages l WHERE l.school_id = t.school_id AND l.name = btrim(t.language)::citext;
-- the old category was the subject (Fiction, Reference…)
INSERT INTO library_subjects (school_id, name)
SELECT DISTINCT t.school_id, btrim(t.category) FROM library_titles t WHERE NULLIF(btrim(t.category), '') IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE library_titles t SET subject_id = s.id
  FROM library_subjects s WHERE s.school_id = t.school_id AND s.name = btrim(t.category)::citext;
UPDATE library_titles t SET material_type_id = m.id
  FROM library_material_types m
 WHERE m.school_id = t.school_id AND m.code = CASE WHEN t.is_reference THEN 'REF' ELSE 'BOOK' END;
UPDATE library_copies c SET library_id = l.id
  FROM library_libraries l WHERE l.school_id = c.school_id AND l.code = 'MAIN' AND c.library_id IS NULL;
UPDATE library_copies SET acquisition = CASE WHEN lower(source) LIKE 'don%' THEN 'Donation'
                                             WHEN lower(source) LIKE 'pur%' THEN 'Purchase' END
 WHERE source IS NOT NULL AND acquisition IS NULL;
-- the title codes given from now on start after the highest T-number already used
SELECT setval('library_title_code_seq',
              GREATEST(1, COALESCE((SELECT max(substring(code FROM 2)::bigint) FROM library_titles WHERE code ~ '^T[0-9]{1,15}$'), 0) + 1),
              false);

ALTER TABLE library_copies ALTER COLUMN library_id SET NOT NULL;

-- the next accession numbers of a series: under a row lock, from its next number, skipping numbers any
-- copy of the school already has; the series moves past the last one given
CREATE OR REPLACE FUNCTION app.library_take_accessions(p_series BIGINT, p_count INT) RETURNS TEXT[]
LANGUAGE plpgsql AS $$
DECLARE
  s RECORD;
  n BIGINT;
  v TEXT;
  out TEXT[] := '{}';
BEGIN
  IF p_count < 1 OR p_count > 500 THEN RAISE EXCEPTION 'count out of range'; END IF;
  SELECT * INTO s FROM library_accession_series WHERE id = p_series FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such accession series'; END IF;
  n := s.next_no;
  WHILE cardinality(out) < p_count LOOP
    v := s.prefix || lpad(n::text, s.digits, '0');
    IF NOT EXISTS (SELECT 1 FROM library_copies WHERE school_id = s.school_id AND accession_no = v) THEN
      out := out || v;
    END IF;
    n := n + 1;
  END LOOP;
  UPDATE library_accession_series SET next_no = n, updated_at = now() WHERE id = p_series;
  RETURN out;
END
$$;
