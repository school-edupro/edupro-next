-- Examinations v2, part 3 (docs/design/65): mark schemes, the old Dynamic Mark Register as one engine.
-- A scheme reads some exams of the year (by key) for some classes and builds its columns per subject
-- (an exam's marks or a part, averages / best of N, sums, conversions, attendance slabs) with its result
-- rules; the definition is kept as JSON and worked out in packages/db (mark-scheme.ts). A locked version
-- is fixed; a new version starts from it. A result scheme (one per class and term) makes the term
-- results that ranks, promotion and the report cards read; a register is a sheet of the same numbers.

CREATE TABLE mark_schemes (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  name              TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  purpose           TEXT NOT NULL CHECK (purpose IN ('result', 'register')),
  term_code         TEXT CHECK (term_code IS NULL OR term_code ~ '^[A-Z0-9_]{1,12}$'),
  class_ids         BIGINT[] NOT NULL CHECK (cardinality(class_ids) BETWEEN 1 AND 30),
  def               JSONB NOT NULL,
  preset            TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'superseded')),
  version           INT NOT NULL DEFAULT 1,
  previous_id       BIGINT REFERENCES mark_schemes(id),
  created_by        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by         BIGINT,
  locked_at         TIMESTAMPTZ,
  computed_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CHECK (purpose = 'register' OR term_code IS NOT NULL)
);
CREATE INDEX mark_schemes_by_year ON mark_schemes (academic_year_id, purpose, status) WHERE deleted_at IS NULL;
CREATE TRIGGER mark_schemes_audit AFTER INSERT OR UPDATE OR DELETE ON mark_schemes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('mark_schemes');

-- one student's result of a term, made by the class's locked result scheme
CREATE TABLE term_results (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  scheme_id         BIGINT NOT NULL REFERENCES mark_schemes(id) ON DELETE CASCADE,
  term_code         TEXT NOT NULL,
  student_id        BIGINT NOT NULL REFERENCES students(id),
  class_id          BIGINT NOT NULL REFERENCES classes(id),
  class_section_id  BIGINT REFERENCES class_sections(id),
  -- per subject: the printed columns' values, total, maximum, %, grade, status
  subjects          JSONB NOT NULL,
  total             NUMERIC(8, 2),
  max_total         NUMERIC(8, 2) NOT NULL,
  pct               NUMERIC(5, 2),
  grade             TEXT,
  division          TEXT,
  result            TEXT NOT NULL CHECK (result IN ('pass', 'compartment', 'fail', 'absent', 'incomplete')),
  failed            TEXT[] NOT NULL DEFAULT '{}',
  rank_in_section   INT,
  rank_in_class     INT,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheme_id, student_id)
);
CREATE INDEX term_results_by_student ON term_results (student_id, academic_year_id, term_code);
CALL app.apply_tenant_rls('term_results');
