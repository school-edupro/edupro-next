-- 0397: CBSE board result analysis, phase B (docs/design/88): each candidate's details as the annexures need them
-- (taken from the student record when the file is saved, or from the school's old details sheet), the CBSE subject
-- codes linked to the school's subjects, and the teacher of a section's subject where it differs from the year's
-- teacher assignment (a section's subject split between teachers by roll number, as the old sheet allowed).

ALTER TABLE board_candidates
  ADD COLUMN section      TEXT,
  ADD COLUMN stream       TEXT,
  ADD COLUMN category     TEXT,
  ADD COLUMN religion     TEXT,
  ADD COLUMN ews          BOOLEAN,
  ADD COLUMN cwsn         BOOLEAN,
  ADD COLUMN boarder      BOOLEAN,
  ADD COLUMN staff_ward   BOOLEAN,
  -- record: taken from the student's record; sheet: from the uploaded details sheet; none: not found
  ADD COLUMN details_from TEXT NOT NULL DEFAULT 'none' CHECK (details_from IN ('record', 'sheet', 'none')),
  ADD COLUMN details_at   TIMESTAMPTZ;

CREATE TABLE board_subjects (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  board       TEXT NOT NULL DEFAULT 'CBSE',
  class_label TEXT NOT NULL CHECK (class_label IN ('X', 'XII')),
  code        TEXT NOT NULL CHECK (code ~ '^[0-9]{3}$'),
  -- null until the school names a code CBSE printed that the list did not have
  name        TEXT CHECK (name IS NULL OR length(btrim(name)) BETWEEN 2 AND 120),
  kind        TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('language', 'main', 'skill', 'additional', 'internal')),
  subject_id  BIGINT REFERENCES subjects(id),
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, board, class_label, code)
);
CALL app.apply_tenant_rls('board_subjects');

CREATE TABLE board_teacher_overrides (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  board        TEXT NOT NULL DEFAULT 'CBSE',
  class_label  TEXT NOT NULL CHECK (class_label IN ('X', 'XII')),
  exam_year    INT NOT NULL CHECK (exam_year BETWEEN 2000 AND 2100),
  section      TEXT NOT NULL CHECK (length(btrim(section)) BETWEEN 1 AND 40),
  code         TEXT NOT NULL CHECK (code ~ '^[0-9]{3}$'),
  employee_id  BIGINT REFERENCES employees(id),
  -- a teacher named in the old sheet who is not an employee in EduPro (kept as written)
  teacher_name TEXT CHECK (teacher_name IS NULL OR length(btrim(teacher_name)) BETWEEN 2 AND 120),
  -- empty: the whole section; else only these candidates (a language group, say)
  rolls        TEXT[] NOT NULL DEFAULT '{}',
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (employee_id IS NOT NULL OR teacher_name IS NOT NULL)
);
CREATE INDEX board_teacher_overrides_key ON board_teacher_overrides (school_id, board, class_label, exam_year, section, code);
CALL app.apply_tenant_rls('board_teacher_overrides');
