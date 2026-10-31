-- Class and subject mapping (Masters): a mapping is made inactive instead of removed (the class no
-- longer studies the subject this year; exams that already hold it keep it), and the edit form may
-- correct its class or subject. Inactive mappings drop out of every list of a class's subjects
-- (subject choices, teacher assignments, daily work, syllabus, documents).

ALTER TABLE class_subjects
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));

-- a subject everyone takes is in no group; a group belongs to the subject's own class and year; a
-- mapping moved to another class or year leaves its place, its group and its streams behind
CREATE OR REPLACE FUNCTION app.class_subjects_group_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.class_id <> OLD.class_id OR NEW.academic_year_id <> OLD.academic_year_id) THEN
    NEW.group_id := NULL;
    NEW.sort_order := NULL;
    DELETE FROM class_stream_subjects WHERE class_subject_id = NEW.id;
  END IF;
  IF NOT NEW.is_elective THEN
    NEW.group_id := NULL;
  END IF;
  IF NEW.group_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM subject_groups g
        WHERE g.id = NEW.group_id AND g.class_id = NEW.class_id AND g.academic_year_id = NEW.academic_year_id) THEN
    RAISE EXCEPTION 'subject group % is not of this class and year', NEW.group_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
