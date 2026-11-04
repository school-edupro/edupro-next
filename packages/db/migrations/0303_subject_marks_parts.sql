-- docs/design/70 (after part 2, 4 Nov 2026): a line of the subject marks master may be a part of its
-- subject instead of a paper of its own. Class VIII: Geography 13 and Political Science 22 are the parts
-- of Social Science 35, each entered by its own teacher; Class VI: Geography 40 and History 40 are papers.
-- The subject a part line belongs to is its subject's parent in the subject master; the list holds that
-- subject, and its part lines add up to its maximum (the service checks both). A part has a maximum and
-- no pass marks, scale or Optional of its own: the subject's are for the total.
ALTER TABLE exam_type_subjects ADD COLUMN is_part BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_type_subjects ADD CONSTRAINT exam_type_subjects_part_alone
  CHECK (NOT is_part OR (max_marks > 0 AND pass_marks IS NULL AND grade_scale_id IS NULL AND NOT is_optional));

-- An exam paper with no mark (as a whole or in a part) of an unlocked exam takes its parts from the
-- master of its exam's type and class: one part per part line of its subject, named after the
-- sub-subject (its teacher enters it), with the line's maximum, in the class's subject order. Nothing
-- when the master has no part lines for the subject or they do not add up to the paper's maximum; the
-- paper's other parts go. Returns 1 when the parts changed, else 0.
CREATE OR REPLACE FUNCTION app.apply_master_parts(p_exam_subject BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_es    exam_subjects%ROWTYPE;
  v_year  BIGINT;
  v_type  BIGINT;
  v_sum   NUMERIC;
  v_want  TEXT[];
  v_have  TEXT[];
  v_i     INT := 0;
  r       RECORD;
BEGIN
  SELECT * INTO v_es FROM exam_subjects WHERE id = p_exam_subject;
  IF v_es.id IS NULL OR v_es.max_marks <= 0 THEN RETURN 0; END IF;
  SELECT academic_year_id, exam_type_id INTO v_year, v_type
    FROM exams WHERE id = v_es.exam_id AND deleted_at IS NULL AND NOT marks_locked;
  IF v_year IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM mark_entries WHERE exam_subject_id = v_es.id)
     OR EXISTS (SELECT 1 FROM mark_part_entries m JOIN exam_subject_parts p ON p.id = m.part_id
                 WHERE p.exam_subject_id = v_es.id) THEN
    RETURN 0;
  END IF;
  SELECT sum(m.max_marks),
         array_agg(concat_ws('|', m.subject_id, s.name, m.max_marks)
                   ORDER BY app.subject_seq(v_es.class_id, v_year, m.subject_id), s.code)
    INTO v_sum, v_want
    FROM exam_type_subjects m JOIN subjects s ON s.id = m.subject_id
   WHERE m.academic_year_id = v_year AND m.exam_type_id = v_type AND m.class_id = v_es.class_id
     AND m.is_part AND s.parent_id = v_es.subject_id;
  IF v_sum IS NULL OR v_sum <> v_es.max_marks THEN RETURN 0; END IF;
  SELECT array_agg(concat_ws('|', subject_id, name, max_marks) ORDER BY sort_order, id) INTO v_have
    FROM exam_subject_parts WHERE exam_subject_id = v_es.id;
  IF v_have IS NOT DISTINCT FROM v_want THEN RETURN 0; END IF;
  -- no marks hang on the parts (checked above): made again in the master's order
  DELETE FROM exam_subject_parts WHERE exam_subject_id = v_es.id;
  FOR r IN
    SELECT m.subject_id, s.name, m.max_marks
      FROM exam_type_subjects m JOIN subjects s ON s.id = m.subject_id
     WHERE m.academic_year_id = v_year AND m.exam_type_id = v_type AND m.class_id = v_es.class_id
       AND m.is_part AND s.parent_id = v_es.subject_id
     ORDER BY app.subject_seq(v_es.class_id, v_year, m.subject_id), s.code
  LOOP
    INSERT INTO exam_subject_parts (school_id, exam_subject_id, name, subject_id, max_marks, sort_order)
    VALUES (v_es.school_id, v_es.id, r.name, r.subject_id, r.max_marks, v_i);
    v_i := v_i + 1;
  END LOOP;
  RETURN 1;
END $$;
