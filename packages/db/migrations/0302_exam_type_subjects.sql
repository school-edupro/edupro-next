-- docs/design/70: the subject marks master. For each year, exam type and class, the subjects its exams
-- hold with their maximum and pass marks, a grade-only subject's scale (maximum 0) and Optional, as the
-- legacy's Subject Master (exam_subject_master). An exam's Subjects step takes its papers from here
-- (part 2); the parts of a subject stay in Class set-up (docs/design/67).
CREATE TABLE exam_type_subjects (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  exam_type_id      BIGINT NOT NULL REFERENCES exam_types(id),
  class_id          BIGINT NOT NULL REFERENCES classes(id),
  subject_id        BIGINT NOT NULL REFERENCES subjects(id),
  max_marks         NUMERIC(6, 2) NOT NULL CHECK (max_marks >= 0),
  pass_marks        NUMERIC(6, 2) CHECK (pass_marks IS NULL OR (pass_marks >= 0 AND pass_marks <= max_marks)),
  grade_scale_id    BIGINT REFERENCES grade_scales(id),
  is_optional       BOOLEAN NOT NULL DEFAULT false,
  updated_by        BIGINT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a grade-only subject (no marks) needs its scale and has no pass marks
  CHECK (max_marks > 0 OR (grade_scale_id IS NOT NULL AND pass_marks IS NULL)),
  UNIQUE (academic_year_id, exam_type_id, class_id, subject_id)
);
CREATE INDEX exam_type_subjects_by_type ON exam_type_subjects (academic_year_id, exam_type_id, class_id);
CREATE TRIGGER exam_type_subjects_audit AFTER INSERT OR UPDATE OR DELETE ON exam_type_subjects
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('exam_type_subjects');
