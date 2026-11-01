-- A subject entered in parts has the sum of its parts as its maximum (docs/design/67). When the exam's
-- subjects change that maximum (Social Science 40 → 80) before any marks, the parts follow it in the
-- ratio they had (20 + 20 → 40 + 40), rounded as app.apply_class_parts (0293) does: whole marks rounded
-- down (at least 1) for every part but the last, which takes what is left; when that would leave the
-- last part nothing the parts stay and the exam sets them itself. Once marked, the service refuses the
-- change (the parts' maxima are changed instead), so this leaves a marked subject as it is.
CREATE OR REPLACE FUNCTION app.fit_parts_to_max(p_exam_subject BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_es     exam_subjects%ROWTYPE;
  v_total  NUMERIC;
  v_left   NUMERIC;
  v_ids    BIGINT[] := '{}';
  v_max    NUMERIC[] := '{}';
  v_n      INT;
  r        RECORD;
BEGIN
  SELECT * INTO v_es FROM exam_subjects WHERE id = p_exam_subject;
  IF v_es.id IS NULL OR v_es.max_marks <= 0 THEN RETURN 0; END IF;
  SELECT sum(max_marks) INTO v_total FROM exam_subject_parts WHERE exam_subject_id = v_es.id;
  IF v_total IS NULL OR v_total <= 0 OR v_total = v_es.max_marks THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM mark_entries WHERE exam_subject_id = v_es.id)
     OR EXISTS (SELECT 1 FROM mark_part_entries m JOIN exam_subject_parts p ON p.id = m.part_id
                 WHERE p.exam_subject_id = v_es.id) THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT id, max_marks FROM exam_subject_parts WHERE exam_subject_id = v_es.id ORDER BY sort_order, id
  LOOP
    v_ids := v_ids || r.id;
    v_max := v_max || GREATEST(1, floor(v_es.max_marks * r.max_marks / v_total));
  END LOOP;
  v_n := cardinality(v_ids);
  v_left := v_es.max_marks;
  FOR i IN 1 .. v_n - 1 LOOP
    v_left := v_left - v_max[i];
  END LOOP;
  IF v_left < 1 THEN RETURN 0; END IF;
  v_max[v_n] := v_left;
  FOR i IN 1 .. v_n LOOP
    UPDATE exam_subject_parts SET max_marks = v_max[i] WHERE id = v_ids[i];
  END LOOP;
  RETURN v_n;
END $$;
