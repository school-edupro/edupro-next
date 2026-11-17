-- 0396: CBSE board result analysis, phase A (docs/design/88) — the CBSE result gazette (.TXT) read with a layout.
-- A layout is data (where each field sits); the 2026 Class X / XII layouts are built into the code, a new one is
-- learned once (Claude reads masked headings and sample lines) and kept here. Results are keyed by the
-- examination year, so earlier years can come in without an EduPro academic year (phase E).

CREATE TABLE board_layouts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  board         TEXT NOT NULL DEFAULT 'CBSE',
  class_label   TEXT NOT NULL CHECK (class_label IN ('X', 'XII')),
  fingerprint   TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  spec          JSONB NOT NULL,
  -- claude: learned from a file; edited: changed by hand afterwards
  source        TEXT NOT NULL CHECK (source IN ('claude', 'edited')),
  model         TEXT,
  notes         TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  learned_from  BIGINT,
  -- kept for next time once a file read with it is saved; switched off by hand
  active        BOOLEAN NOT NULL DEFAULT false,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX board_layouts_active ON board_layouts (school_id, board, class_label, fingerprint) WHERE active;
CALL app.apply_tenant_rls('board_layouts');

-- the import: the file itself (a CBSE gazette is plain text, under 2 MB), the examination year, the layout read with
ALTER TABLE board_result_imports
  ALTER COLUMN academic_year_id DROP NOT NULL,
  ADD COLUMN kind          TEXT NOT NULL DEFAULT 'sheet' CHECK (kind IN ('sheet', 'gazette')),
  ADD COLUMN exam_year     INT CHECK (exam_year IS NULL OR exam_year BETWEEN 2000 AND 2100),
  ADD COLUMN layout_key    TEXT,
  ADD COLUMN layout_how    TEXT CHECK (layout_how IS NULL OR layout_how IN ('fingerprint', 'tried', 'claude')),
  ADD COLUMN source_text   TEXT CHECK (source_text IS NULL OR length(source_text) <= 2097152),
  ADD COLUMN figures       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN replaced_at   TIMESTAMPTZ,
  ADD COLUMN replaced_by   BIGINT REFERENCES board_result_imports(id);
UPDATE board_result_imports i SET exam_year = EXTRACT(YEAR FROM y.end_date)::int
  FROM academic_years y WHERE y.id = i.academic_year_id AND i.exam_year IS NULL;
CREATE INDEX board_result_imports_year ON board_result_imports (school_id, board, class_label, exam_year);

-- one row per candidate of a saved gazette (the subjects stay one row each in board_results)
CREATE TABLE board_candidates (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  import_id        BIGINT NOT NULL REFERENCES board_result_imports(id),
  board            TEXT NOT NULL DEFAULT 'CBSE',
  class_label      TEXT NOT NULL CHECK (class_label IN ('X', 'XII')),
  exam_year        INT NOT NULL CHECK (exam_year BETWEEN 2000 AND 2100),
  academic_year_id BIGINT REFERENCES academic_years(id),
  roll_no          TEXT NOT NULL,
  name             TEXT,
  sex              TEXT,
  flag             TEXT,
  result           TEXT,
  compartment      TEXT[] NOT NULL DEFAULT '{}',
  internal_grades  TEXT[] NOT NULL DEFAULT '{}',
  subjects         INT NOT NULL DEFAULT 0,
  -- marks of every subject with marks, and their share of 100 a subject
  total            NUMERIC(7, 2),
  percent          NUMERIC(5, 2),
  student_id       BIGINT REFERENCES students(id),
  -- how the student was found: roll (board roll no), name (within the class), picked (by hand), none
  match            TEXT NOT NULL DEFAULT 'none' CHECK (match IN ('roll', 'name', 'picked', 'none', 'not_ours')),
  line_no          INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, board, class_label, exam_year, roll_no)
);
CREATE INDEX board_candidates_student ON board_candidates (student_id) WHERE student_id IS NOT NULL;
CALL app.apply_tenant_rls('board_candidates');

ALTER TABLE board_results
  ALTER COLUMN academic_year_id DROP NOT NULL,
  ADD COLUMN exam_year    INT CHECK (exam_year IS NULL OR exam_year BETWEEN 2000 AND 2100),
  ADD COLUMN candidate_id BIGINT REFERENCES board_candidates(id) ON DELETE CASCADE,
  ADD COLUMN slot         INT,
  ADD COLUMN absent       BOOLEAN NOT NULL DEFAULT false;
UPDATE board_results r SET exam_year = EXTRACT(YEAR FROM y.end_date)::int
  FROM academic_years y WHERE y.id = r.academic_year_id AND r.exam_year IS NULL;
ALTER TABLE board_results ALTER COLUMN exam_year SET NOT NULL;
ALTER TABLE board_results DROP CONSTRAINT board_results_academic_year_id_board_class_label_roll_no_su_key;
CREATE UNIQUE INDEX board_results_one ON board_results (school_id, board, class_label, exam_year, roll_no, subject_code);
CREATE INDEX board_results_candidate ON board_results (candidate_id) WHERE candidate_id IS NOT NULL;
