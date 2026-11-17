-- CBSE board result analysis, phase E (docs/design/88): an earlier year's figures typed in when its result file is
-- lost — the headline (appeared, passed, the 90% and 75% counts, the aggregate, the PI) and, for Annexure 5, each
-- subject's figures. A year whose file is saved uses the file; these fill the five-year rows, the trend and the year
-- before only where no file is.
CREATE TABLE board_year_figures (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  board         TEXT NOT NULL DEFAULT 'CBSE',
  class_label   TEXT NOT NULL CHECK (class_label IN ('X', 'XII')),
  exam_year     INT NOT NULL CHECK (exam_year BETWEEN 2000 AND 2100),
  registered    INT CHECK (registered >= 0),
  appeared      INT NOT NULL CHECK (appeared >= 0),
  passed        INT CHECK (passed >= 0),
  compartments  INT CHECK (compartments >= 0),
  failures      INT CHECK (failures >= 0),
  n90           INT CHECK (n90 >= 0),
  n75           INT CHECK (n75 >= 0),
  aggregate     NUMERIC(5, 2) CHECK (aggregate BETWEEN 0 AND 100),
  pi            NUMERIC(5, 2) CHECK (pi BETWEEN 0 AND 100),
  -- code → {appeared, highest, aGrades, compartments, failures, distinctions, average, pi}
  subjects      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(subjects) = 'object'),
  note          TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, board, class_label, exam_year),
  CHECK (passed IS NULL OR passed <= appeared),
  CHECK (n90 IS NULL OR n75 IS NULL OR n90 <= n75),
  CHECK (n75 IS NULL OR n75 <= appeared)
);
CALL app.apply_tenant_rls('board_year_figures');
