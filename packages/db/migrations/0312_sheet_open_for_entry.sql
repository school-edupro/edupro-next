-- 6 Nov 2026 (asked): the school admin reopens ONE sheet for entry — an exam × section × subject (Term I ·
-- VI-A · English) — while the exam or its class stays locked. The sheet is marked open for entry; only its
-- teacher enters (its subject teacher, else the section's class teacher; the office as before — checked by
-- the API); it closes again when it is submitted, or when the admin locks the exam or the class.
ALTER TABLE exam_entry_status ADD COLUMN entry_open BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.enter_marks(p_exam_subject_id BIGINT, p_rows JSONB)
RETURNS TABLE (o_inserted INT, o_updated INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_es     exam_subjects%ROWTYPE;
  v_exam   exams%ROWTYPE;
  v_scale  BIGINT;
  r        RECORD;
  v_marks  NUMERIC;
  v_code   TEXT;
  v_grade  TEXT;
  v_ins    INT := 0;
  v_upd    INT := 0;
  v_i      INT;
  v_u      INT;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_es FROM exam_subjects WHERE id = p_exam_subject_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exams.subject_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_exam FROM exams WHERE id = v_es.exam_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'exams.not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_year_open(v_exam.academic_year_id, 'exams');
  -- the locks are checked per student below: a section's sheet opened for entry (6 Nov 2026) passes
  PERFORM app.mark_codes_seed(app.current_school_id());
  v_scale := COALESCE(v_es.grade_scale_id,
                      (SELECT grade_scale_id FROM exam_classes WHERE exam_id = v_es.exam_id AND class_id = v_es.class_id));
  FOR r IN SELECT * FROM jsonb_to_recordset(p_rows)
             AS x("studentId" BIGINT, marks NUMERIC, absent BOOLEAN, exempt BOOLEAN, code TEXT, grade TEXT) LOOP
    IF r."studentId" IS NULL THEN RAISE EXCEPTION 'exams.student_required' USING ERRCODE = 'P0001'; END IF;
    v_code := NULLIF(upper(btrim(COALESCE(r.code, ''))), '');
    IF v_code IS NULL AND COALESCE(r.absent, false) THEN v_code := 'AB'; END IF;
    IF v_code IS NULL AND COALESCE(r.exempt, false) THEN v_code := 'EX'; END IF;
    v_grade := CASE WHEN v_code IS NULL THEN NULLIF(btrim(COALESCE(r.grade, '')), '') END;
    v_marks := CASE WHEN v_code IS NULL AND v_es.max_marks > 0 THEN r.marks END;
    IF NOT app.student_in_class(r."studentId", v_exam.academic_year_id, v_es.class_id) THEN
      RAISE EXCEPTION 'exams.student_not_in_class' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId")::TEXT;
    END IF;
    -- the exam or the class locked: only a sheet the admin opened for entry (its section) may change
    IF (v_exam.marks_locked OR v_es.entry_locked) AND NOT EXISTS (
         SELECT 1 FROM exam_entry_status st
           JOIN enrolments en ON en.class_section_id = st.class_section_id AND en.student_id = r."studentId"
                             AND en.academic_year_id = v_exam.academic_year_id AND en.status = 'active'
          WHERE st.exam_subject_id = p_exam_subject_id AND st.entry_open AND st.status = 'open') THEN
      RAISE EXCEPTION 'exams.entry_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('examSubjectId', p_exam_subject_id)::TEXT;
    END IF;
    IF EXISTS (SELECT 1 FROM exam_entry_status st
                 JOIN enrolments en ON en.class_section_id = st.class_section_id AND en.student_id = r."studentId"
                                   AND en.academic_year_id = v_exam.academic_year_id AND en.status = 'active'
                WHERE st.exam_subject_id = p_exam_subject_id AND st.status <> 'open') THEN
      RAISE EXCEPTION 'exams.entry_submitted' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId")::TEXT;
    END IF;
    IF app.student_exam_subject_kind(r."studentId", v_exam.id, v_es.subject_id) IS NULL THEN
      RAISE EXCEPTION 'exams.subject_not_taken' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId")::TEXT;
    END IF;
    IF v_code IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM mark_codes WHERE code = v_code AND status = 'active') THEN
        RAISE EXCEPTION 'exams.unknown_code' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId", 'code', v_code)::TEXT;
      END IF;
    ELSIF v_es.max_marks = 0 THEN
      IF v_grade IS NULL OR v_scale IS NULL
         OR NOT EXISTS (SELECT 1 FROM grade_bands WHERE scale_id = v_scale AND grade = v_grade) THEN
        RAISE EXCEPTION 'exams.grade_not_allowed' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId", 'grade', v_grade)::TEXT;
      END IF;
    ELSE
      v_grade := NULL;
      IF v_marks IS NULL OR v_marks < 0 OR v_marks > v_es.max_marks THEN
        RAISE EXCEPTION 'exams.marks_out_of_range' USING ERRCODE = 'P0001',
          DETAIL = jsonb_build_object('studentId', r."studentId", 'marks', v_marks, 'maxMarks', v_es.max_marks)::TEXT;
      END IF;
    END IF;
    WITH w AS (
      INSERT INTO mark_entries (school_id, exam_subject_id, student_id, marks, code, grade, absent, exempt, entered_by, updated_by)
      VALUES (app.current_school_id(), p_exam_subject_id, r."studentId", v_marks, v_code, v_grade,
              v_code IS NOT DISTINCT FROM 'AB', v_code IS NOT DISTINCT FROM 'EX', app.current_user_id(), app.current_user_id())
      ON CONFLICT (exam_subject_id, student_id) DO UPDATE
        SET marks = EXCLUDED.marks, code = EXCLUDED.code, grade = EXCLUDED.grade, absent = EXCLUDED.absent,
            exempt = EXCLUDED.exempt, updated_by = app.current_user_id()
        WHERE mark_entries.marks IS DISTINCT FROM EXCLUDED.marks OR mark_entries.code IS DISTINCT FROM EXCLUDED.code
           OR mark_entries.grade IS DISTINCT FROM EXCLUDED.grade
      RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_i, v_u FROM w;
    v_ins := v_ins + COALESCE(v_i, 0);
    v_upd := v_upd + COALESCE(v_u, 0);
  END LOOP;
  RETURN QUERY SELECT v_ins, v_upd;
END
$$;
