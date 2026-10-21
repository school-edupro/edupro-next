-- 0214: correcting an accession number (docs/design/36-library.md, "The register, accession corrections
-- and lost-book recovery", part 2). A copy's number is changed with a reason; the change is kept, the old
-- number is retired (never given to another copy: not by a series, not typed, not imported) and still
-- names the copy at the desk, in a stock check and in a search. A copy may go back to a number it had.
CREATE TABLE library_accession_changes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  copy_id          BIGINT NOT NULL REFERENCES library_copies(id) ON DELETE CASCADE,
  old_no           TEXT NOT NULL,
  new_no           TEXT NOT NULL,
  reason           TEXT NOT NULL,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by       BIGINT,
  changed_by_name  TEXT
);
CREATE INDEX library_accession_changes_old ON library_accession_changes (school_id, upper(old_no));
CREATE INDEX library_accession_changes_copy ON library_accession_changes (copy_id, changed_at);
CALL app.apply_tenant_rls('library_accession_changes');

-- a number another copy had (retired): no copy may take it
CREATE OR REPLACE FUNCTION app.library_accession_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM library_accession_changes h
              WHERE h.school_id = NEW.school_id AND upper(h.old_no) = upper(NEW.accession_no)
                AND h.copy_id <> NEW.id) THEN
    RAISE EXCEPTION 'accession number % was used before and is retired', NEW.accession_no
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER library_copies_accession_guard BEFORE INSERT OR UPDATE OF accession_no ON library_copies
  FOR EACH ROW EXECUTE FUNCTION app.library_accession_guard();

-- the copy a number names: the copy that has it now, else the copy it was taken from
CREATE OR REPLACE FUNCTION app.library_copy_by_number(p_no TEXT) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT c.id FROM library_copies c WHERE c.accession_no = btrim(p_no) LIMIT 1),
    (SELECT c.id FROM library_copies c WHERE upper(c.accession_no) = upper(btrim(p_no)) LIMIT 1),
    (SELECT h.copy_id FROM library_accession_changes h
      WHERE upper(h.old_no) = upper(btrim(p_no)) ORDER BY h.changed_at DESC, h.id DESC LIMIT 1))
$$;

-- a series gives the next numbers no copy has and none had
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
    IF NOT EXISTS (SELECT 1 FROM library_copies WHERE school_id = s.school_id AND accession_no = v)
       AND NOT EXISTS (SELECT 1 FROM library_accession_changes
                        WHERE school_id = s.school_id AND upper(old_no) = upper(v)) THEN
      out := out || v;
    END IF;
    n := n + 1;
  END LOOP;
  UPDATE library_accession_series SET next_no = n, updated_at = now() WHERE id = p_series;
  RETURN out;
END
$$;
