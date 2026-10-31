-- app.apply_class_parts (0292) worked out first, then written: whole marks rounded down (at least 1)
-- for every part but the last, which takes what is left; when that would leave the last part nothing
-- (very uneven shares on a small maximum) no part is made and the exam sets its parts itself.
CREATE OR REPLACE FUNCTION app.apply_class_parts(p_exam_subject BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_es     exam_subjects%ROWTYPE;
  v_year   BIGINT;
  v_total  NUMERIC;
  v_left   NUMERIC;
  v_ids    BIGINT[] := '{}';
  v_names  TEXT[] := '{}';
  v_max    NUMERIC[] := '{}';
  v_n      INT;
  r        RECORD;
BEGIN
  SELECT * INTO v_es FROM exam_subjects WHERE id = p_exam_subject;
  IF v_es.id IS NULL OR v_es.max_marks <= 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM exam_subject_parts WHERE exam_subject_id = v_es.id)
     OR EXISTS (SELECT 1 FROM mark_entries WHERE exam_subject_id = v_es.id) THEN
    RETURN 0;
  END IF;
  SELECT academic_year_id INTO v_year FROM exams WHERE id = v_es.exam_id;
  SELECT sum(p.share) INTO v_total
    FROM class_subject_parts p JOIN class_subjects cs ON cs.id = p.class_subject_id
   WHERE cs.class_id = v_es.class_id AND cs.academic_year_id = v_year AND cs.subject_id = v_es.subject_id
     AND cs.status = 'active';
  IF v_total IS NULL THEN RETURN 0; END IF;
  FOR r IN
    SELECT p.subject_id, p.share, s.name
      FROM class_subject_parts p JOIN class_subjects cs ON cs.id = p.class_subject_id
      JOIN subjects s ON s.id = p.subject_id
     WHERE cs.class_id = v_es.class_id AND cs.academic_year_id = v_year AND cs.subject_id = v_es.subject_id
       AND cs.status = 'active'
     ORDER BY p.sort_order, p.id
  LOOP
    v_ids := v_ids || r.subject_id;
    v_names := v_names || r.name;
    v_max := v_max || GREATEST(1, floor(v_es.max_marks * r.share / v_total));
  END LOOP;
  v_n := cardinality(v_ids);
  v_left := v_es.max_marks;
  FOR i IN 1 .. v_n - 1 LOOP
    v_left := v_left - v_max[i];
  END LOOP;
  IF v_left < 1 THEN RETURN 0; END IF;
  v_max[v_n] := v_left;
  FOR i IN 1 .. v_n LOOP
    INSERT INTO exam_subject_parts (school_id, exam_subject_id, name, subject_id, max_marks, sort_order)
    VALUES (v_es.school_id, v_es.id, v_names[i], v_ids[i], v_max[i], i - 1);
  END LOOP;
  RETURN v_n;
END $$;
