-- Library, part 2: a copy added without a library (the older accession call, an Excel upload of the
-- accession register) goes to the school's Main library, which the set-up's seed makes if the school has
-- none yet.
CREATE OR REPLACE FUNCTION app.library_copy_default_library() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.library_id IS NULL THEN
    SELECT id INTO NEW.library_id FROM library_libraries
     WHERE school_id = NEW.school_id ORDER BY (code = 'MAIN') DESC, id LIMIT 1;
    IF NEW.library_id IS NULL THEN
      PERFORM app.library_seed(NEW.school_id);
      SELECT id INTO NEW.library_id FROM library_libraries
       WHERE school_id = NEW.school_id ORDER BY (code = 'MAIN') DESC, id LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER library_copies_default_library BEFORE INSERT ON library_copies
  FOR EACH ROW EXECUTE FUNCTION app.library_copy_default_library();
