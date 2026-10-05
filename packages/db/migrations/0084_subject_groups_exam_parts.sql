-- 0084: teaching subjects and marks-entry subjects.
--   * a subject can sit under a parent: Physics, Chemistry and Biology are taught (teachers, daily work,
--     timetable) and belong to Science, which is what the report card shows;
--   * an exam subject can be entered in parts, each with its own maximum: Theory and Practical, or one
--     part per teaching subject (the teacher of that subject enters it). The parts add up to the exam
--     subject's marks, so registers, analysis, report cards and promotion read the total as before.

ALTER TABLE subjects ADD COLUMN parent_id BIGINT REFERENCES subjects(id);
ALTER TABLE subjects ADD CONSTRAINT subjects_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX subjects_by_parent ON subjects (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE exam_subject_parts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  exam_subject_id  BIGINT NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- the teaching subject this part belongs to (its subject teacher enters the part); NULL = the exam subject's own teacher
  subject_id       BIGINT REFERENCES subjects(id),
  max_marks        NUMERIC(6, 2) NOT NULL CHECK (max_marks > 0),
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT
);
CREATE UNIQUE INDEX exam_subject_parts_name ON exam_subject_parts (exam_subject_id, lower(name));
CALL app.apply_tenant_rls('exam_subject_parts');

CREATE TABLE mark_part_entries (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  part_id     BIGINT NOT NULL REFERENCES exam_subject_parts(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  marks       NUMERIC(6, 2) CHECK (marks IS NULL OR marks >= 0),
  absent      BOOLEAN NOT NULL DEFAULT false,
  entered_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, student_id),
  CHECK (absent = (marks IS NULL))
);
CREATE INDEX mark_part_entries_by_student ON mark_part_entries (student_id);
CALL app.apply_tenant_rls('mark_part_entries');
