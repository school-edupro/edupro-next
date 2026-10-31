-- A subject changed mid-year (docs/design/67): Hindi in PT1, German from PT2. The change is recorded
-- from an exam with a reason (the office); the student's list holds the new subject, and every exam
-- before the change point still has the old one (its marks stay, on its register and card). What a
-- student takes is now asked per exam: app.student_exam_subject_kind(student, exam, subject). The term
-- results carry the old subject's marks into the new one's line (mark schemes, in the API).

CREATE TABLE student_subject_changes (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  from_subject_id   BIGINT NOT NULL REFERENCES subjects(id),
  to_subject_id     BIGINT NOT NULL REFERENCES subjects(id),
  -- the first exam with the new subject
  from_exam_id      BIGINT NOT NULL REFERENCES exams(id),
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  changed_by        BIGINT,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_subject_id <> to_subject_id),
  UNIQUE (academic_year_id, student_id, from_subject_id)
);
CREATE INDEX student_subject_changes_by_student ON student_subject_changes (student_id, academic_year_id);
CREATE TRIGGER student_subject_changes_audit AFTER INSERT OR UPDATE OR DELETE ON student_subject_changes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('student_subject_changes');

-- the exams' order in the session: the first day (or the first paper), then the id
CREATE OR REPLACE FUNCTION app.exam_day(p_exam BIGINT) RETURNS DATE
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(e.starts_on, (SELECT min(es.exam_on) FROM exam_subjects es WHERE es.exam_id = e.id), e.created_at::date)
    FROM exams e WHERE e.id = p_exam
$$;
CREATE OR REPLACE FUNCTION app.exam_before(p_exam BIGINT, p_than BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT (app.exam_day(p_exam), p_exam) < (app.exam_day(p_than), p_than)
$$;

-- What a student does in a subject in one exam: the year's choice, but a subject changed away from is
-- still theirs in the exams before the change (with the new subject's kind), and the subject changed to
-- is not theirs yet. NULL = not taken in that exam.
CREATE OR REPLACE FUNCTION app.student_exam_subject_kind(p_student BIGINT, p_exam BIGINT, p_subject BIGINT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_year BIGINT;
  c      student_subject_changes%ROWTYPE;
  v_sub  BIGINT;
  i      INT := 0;
BEGIN
  SELECT academic_year_id INTO v_year FROM exams WHERE id = p_exam;
  -- changed to this subject from a later exam: not taken yet
  IF EXISTS (SELECT 1 FROM student_subject_changes x
              WHERE x.student_id = p_student AND x.academic_year_id = v_year AND x.to_subject_id = p_subject
                AND app.exam_before(p_exam, x.from_exam_id)) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM student_subject_changes x
   WHERE x.student_id = p_student AND x.academic_year_id = v_year AND x.from_subject_id = p_subject;
  IF c.id IS NULL THEN
    RETURN app.student_subject_kind(p_student, v_year, p_subject);
  END IF;
  -- changed away from it: taken in the exams before, as the subject it became (followed to the end)
  IF NOT app.exam_before(p_exam, c.from_exam_id) THEN
    RETURN NULL;
  END IF;
  v_sub := c.to_subject_id;
  LOOP
    i := i + 1;
    SELECT * INTO c FROM student_subject_changes x
     WHERE x.student_id = p_student AND x.academic_year_id = v_year AND x.from_subject_id = v_sub;
    EXIT WHEN c.id IS NULL OR i > 10;
    v_sub := c.to_subject_id;
  END LOOP;
  RETURN app.student_subject_kind(p_student, v_year, v_sub);
END $$;

-- marks entry and the exam results ask per exam (bodies as in 0277 and 0276, one call changed)
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
  IF v_exam.marks_locked OR v_es.entry_locked THEN
    RAISE EXCEPTION 'exams.entry_locked' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('examSubjectId', p_exam_subject_id)::TEXT;
  END IF;
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

CREATE OR REPLACE FUNCTION app.compute_exam_results(p_exam_id BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_exam exams%ROWTYPE;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_exam FROM exams WHERE id = p_exam_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'exams.not_found' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM exam_results WHERE exam_id = p_exam_id;
  INSERT INTO exam_results (school_id, exam_id, student_id, class_id, class_section_id, subjects, entered, absent, exempt,
                            total, max_total, pct, grade, points, failed_subjects, result)
  SELECT app.current_school_id(), p_exam_id, x.student_id, x.class_id, x.class_section_id, x.subjects, x.entered, x.absent,
         x.exempt, x.total, x.max_total, x.pct, gb.grade, gb.points, x.failed,
         CASE WHEN x.entered + x.exempt < x.subjects THEN 'incomplete' WHEN x.failed > 0 THEN 'fail' ELSE 'pass' END
    FROM (
      SELECT s.student_id, s.class_id, s.class_section_id, s.grade_scale_id,
             count(*)::int AS subjects,
             count(*) FILTER (WHERE s.entry_id IS NOT NULL AND NOT s.out)::int AS entered,
             count(*) FILTER (WHERE s.code = 'AB')::int AS absent,
             count(*) FILTER (WHERE s.out)::int AS exempt,
             COALESCE(sum(s.got) FILTER (WHERE NOT s.out), 0) AS total,
             COALESCE(sum(s.max_marks) FILTER (WHERE NOT s.out), 0) AS max_total,
             CASE WHEN COALESCE(sum(s.max_marks) FILTER (WHERE NOT s.out), 0) > 0
                  THEN round(COALESCE(sum(s.got) FILTER (WHERE NOT s.out), 0) * 100 / sum(s.max_marks) FILTER (WHERE NOT s.out), 2) END AS pct,
             count(*) FILTER (WHERE s.blocks OR (s.code IS NULL AND s.pass_marks IS NOT NULL AND s.got < s.pass_marks))::int AS failed
        FROM (
          SELECT e.student_id, cs.class_id, cs.id AS class_section_id, ec.grade_scale_id, es.max_marks, es.pass_marks,
                 me.id AS entry_id, me.code,
                 CASE WHEN me.id IS NULL THEN NULL
                      WHEN me.code IS NULL THEN me.marks
                      WHEN COALESCE(mc.treatment, CASE WHEN me.code = 'AB' THEN 'zero' ELSE 'exclude' END) = 'zero' THEN 0
                      WHEN mc.treatment = 'fixed' THEN LEAST(mc.value, es.max_marks)
                      WHEN mc.treatment = 'percent' THEN round(es.max_marks * mc.value / 100, 2)
                 END AS got,
                 (me.code IS NOT NULL AND COALESCE(mc.treatment, CASE WHEN me.code = 'AB' THEN 'zero' ELSE 'exclude' END)
                    IN ('exclude', 'pro_rata')) AS out,
                 (me.code IS NOT NULL AND COALESCE(mc.blocks_result, me.code = 'AB')) AS blocks
            FROM exam_classes ec
            JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = v_exam.academic_year_id AND cs.deleted_at IS NULL
            JOIN enrolments e ON e.class_section_id = cs.id AND e.academic_year_id = v_exam.academic_year_id AND e.status = 'active'
            JOIN exam_subjects es ON es.exam_id = ec.exam_id AND es.class_id = ec.class_id AND es.max_marks > 0
            LEFT JOIN mark_entries me ON me.exam_subject_id = es.id AND me.student_id = e.student_id
            LEFT JOIN mark_codes mc ON mc.code = me.code
           WHERE ec.exam_id = p_exam_id
             AND app.student_exam_subject_kind(e.student_id, v_exam.id, es.subject_id) IN ('compulsory', 'optional')
        ) s
       GROUP BY s.student_id, s.class_id, s.class_section_id, s.grade_scale_id
    ) x
    LEFT JOIN LATERAL (SELECT grade, points FROM grade_bands b WHERE b.scale_id = x.grade_scale_id AND x.pct BETWEEN b.min_pct AND b.max_pct
                        ORDER BY b.sort_order LIMIT 1) gb ON true;
  -- ranks among complete results (dense, by percentage)
  UPDATE exam_results r SET rank_in_section = k.rs, rank_in_class = k.rc
    FROM (SELECT id, dense_rank() OVER (PARTITION BY class_section_id ORDER BY pct DESC) AS rs,
                 dense_rank() OVER (PARTITION BY class_id ORDER BY pct DESC) AS rc
            FROM exam_results WHERE exam_id = p_exam_id AND result <> 'incomplete') k
   WHERE r.id = k.id;
  RETURN (SELECT count(*)::int FROM exam_results WHERE exam_id = p_exam_id);
END
$$;
