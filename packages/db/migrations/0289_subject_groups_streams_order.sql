-- Subject choices and the class's subject order (docs/design/67). A class's subjects for the year are
-- put in order (the legacy class-wise "Priority"); report cards, the mark register, mark entry, date
-- sheets and analysis print them in that order. A subject is taken by everyone (compulsory), is one of a
-- choice group ("Second language: pick 1 of Hindi, Sanskrit, French"; a group that counts in the total
-- or an additional one, kept out of it), or a free elective. A class may have streams (Science-PCM,
-- Commerce...), each a set of its subjects: picking a student's stream gives them those subjects.
-- The order, groups and streams are exam set-up (exams.master.manage); choices are set by whoever holds
-- exams.choices.manage (admin, coordinator, exam office) and by a section's class teacher.

-- ---- 1. choice groups ------------------------------------------------------------------------------
CREATE TABLE subject_groups (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  class_id          BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- optional: counts in the total; additional: printed, kept out of the total
  kind              TEXT NOT NULL DEFAULT 'optional' CHECK (kind IN ('optional', 'additional')),
  pick_min          INT NOT NULL DEFAULT 1,
  pick_max          INT NOT NULL DEFAULT 1,
  updated_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pick_min >= 0 AND pick_max >= 1 AND pick_min <= pick_max AND pick_max <= 10),
  UNIQUE (academic_year_id, class_id, name)
);
CREATE TRIGGER subject_groups_audit AFTER INSERT OR UPDATE OR DELETE ON subject_groups
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('subject_groups');

-- ---- 2. the order and the group of each class subject ------------------------------------------------
-- sort_order NULL: not placed yet (printed after the placed ones, in the subject master's order)
ALTER TABLE class_subjects
  ADD COLUMN sort_order INT CHECK (sort_order IS NULL OR sort_order BETWEEN 1 AND 1000),
  ADD COLUMN group_id BIGINT REFERENCES subject_groups(id) ON DELETE SET NULL;
CREATE INDEX class_subjects_by_group ON class_subjects (group_id) WHERE group_id IS NOT NULL;

-- a subject everyone takes is in no group; a group belongs to the subject's own class and year
CREATE OR REPLACE FUNCTION app.class_subjects_group_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER class_subjects_group_guard BEFORE INSERT OR UPDATE ON class_subjects
  FOR EACH ROW EXECUTE FUNCTION app.class_subjects_group_guard();

-- ---- 3. streams ------------------------------------------------------------------------------------
CREATE TABLE class_streams (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  class_id          BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  sort_order        INT NOT NULL DEFAULT 1,
  updated_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, class_id, name)
);
CREATE TRIGGER class_streams_audit AFTER INSERT OR UPDATE OR DELETE ON class_streams
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('class_streams');

CREATE TABLE class_stream_subjects (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  stream_id         BIGINT NOT NULL REFERENCES class_streams(id) ON DELETE CASCADE,
  class_subject_id  BIGINT NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
  UNIQUE (stream_id, class_subject_id)
);
CREATE INDEX class_stream_subjects_by_subject ON class_stream_subjects (class_subject_id);
CREATE TRIGGER class_stream_subjects_audit AFTER INSERT OR UPDATE OR DELETE ON class_stream_subjects
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('class_stream_subjects');

-- ---- 4. where a subject prints in a class -----------------------------------------------------------
-- The class's order when placed; otherwise after every placed subject, in the subject master's order.
CREATE OR REPLACE FUNCTION app.subject_seq(p_class BIGINT, p_year BIGINT, p_subject BIGINT)
RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
           (SELECT cs.sort_order FROM class_subjects cs
             WHERE cs.class_id = p_class AND cs.academic_year_id = p_year AND cs.subject_id = p_subject),
           100000 + COALESCE((SELECT s.display_order FROM subjects s WHERE s.id = p_subject), 0))
$$;

-- ---- 5. who sets choices ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.choices.manage', 'exams', 'Set students'' subject choices for any section (a class teacher sets their own section without it)', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'exams.choices.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin', 'academic_coordinator', 'exam_office')
ON CONFLICT DO NOTHING;
