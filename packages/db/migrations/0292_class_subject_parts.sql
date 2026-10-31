-- Sub-subjects set once per class (docs/design/67): Social Science entered in parts by its teachers of
-- Geography, History and Political Science, each with a share of the subject's maximum. Every exam of the
-- class gets those parts on its subject (split of the exam's maximum by the shares, whole marks, the last
-- part taking what is left), unless the exam subject already has parts or marks; an exam may still change
-- its parts. The parts add up to the subject's marks as before: registers show them, cards the total.

CREATE TABLE class_subject_parts (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  class_subject_id  BIGINT NOT NULL REFERENCES class_subjects(id) ON DELETE CASCADE,
  -- the sub-subject (its teacher enters the part); a subject under the class subject in the subject master
  subject_id        BIGINT NOT NULL REFERENCES subjects(id),
  share             NUMERIC(6, 2) NOT NULL DEFAULT 1 CHECK (share > 0),
  sort_order        INT NOT NULL DEFAULT 0,
  UNIQUE (class_subject_id, subject_id)
);
CREATE TRIGGER class_subject_parts_audit AFTER INSERT OR UPDATE OR DELETE ON class_subject_parts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('class_subject_parts');

-- An exam subject gets its class's parts: nothing when it has parts or marks already, no maximum (grade
-- only), or a maximum smaller than the number of parts. Returns the parts made.
CREATE OR REPLACE FUNCTION app.apply_class_parts(p_exam_subject BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_es     exam_subjects%ROWTYPE;
  v_year   BIGINT;
  v_total  NUMERIC;
  v_count  INT;
  v_left   NUMERIC;
  v_max    NUMERIC;
  v_i      INT := 0;
  r        RECORD;
BEGIN
  SELECT * INTO v_es FROM exam_subjects WHERE id = p_exam_subject;
  IF v_es.id IS NULL OR v_es.max_marks <= 0 THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM exam_subject_parts WHERE exam_subject_id = v_es.id)
     OR EXISTS (SELECT 1 FROM mark_entries WHERE exam_subject_id = v_es.id) THEN
    RETURN 0;
  END IF;
  SELECT academic_year_id INTO v_year FROM exams WHERE id = v_es.exam_id;
  SELECT sum(p.share), count(*) INTO v_total, v_count
    FROM class_subject_parts p JOIN class_subjects cs ON cs.id = p.class_subject_id
   WHERE cs.class_id = v_es.class_id AND cs.academic_year_id = v_year AND cs.subject_id = v_es.subject_id
     AND cs.status = 'active';
  IF COALESCE(v_count, 0) = 0 OR v_es.max_marks < v_count THEN RETURN 0; END IF;
  v_left := v_es.max_marks;
  FOR r IN
    SELECT p.subject_id, p.share, s.name
      FROM class_subject_parts p JOIN class_subjects cs ON cs.id = p.class_subject_id
      JOIN subjects s ON s.id = p.subject_id
     WHERE cs.class_id = v_es.class_id AND cs.academic_year_id = v_year AND cs.subject_id = v_es.subject_id
       AND cs.status = 'active'
     ORDER BY p.sort_order, p.id
  LOOP
    v_i := v_i + 1;
    v_max := CASE WHEN v_i = v_count THEN v_left
                  ELSE GREATEST(1, round(v_es.max_marks * r.share / v_total)) END;
    v_left := v_left - v_max;
    INSERT INTO exam_subject_parts (school_id, exam_subject_id, name, subject_id, max_marks, sort_order)
    VALUES (v_es.school_id, v_es.id, r.name, r.subject_id, v_max, v_i - 1);
  END LOOP;
  RETURN v_count;
END $$;
