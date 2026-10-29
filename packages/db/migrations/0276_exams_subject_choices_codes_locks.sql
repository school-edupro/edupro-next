-- Examinations v2, part 1 (docs/design/65): each student's subjects for the year (compulsory, optional,
-- additional), the marks codes (AB, ML, EX, NA, OD, L, NEW ADM) and what each does to a result, a code or
-- a grade in place of marks, grade-only subjects (maximum 0) with a scale of their own, locks per entry
-- type on an exam's class, and a pre-primary report-card band.

-- ---- 1. subject choices -------------------------------------------------------------------------
CREATE TABLE student_subjects (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  subject_id        BIGINT NOT NULL REFERENCES subjects(id),
  kind              TEXT NOT NULL DEFAULT 'compulsory' CHECK (kind IN ('compulsory', 'optional', 'additional')),
  stream            TEXT CHECK (stream IS NULL OR length(stream) <= 40),
  created_by        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, student_id, subject_id)
);
CREATE INDEX student_subjects_by_student ON student_subjects (student_id, academic_year_id);
CREATE TRIGGER student_subjects_audit AFTER INSERT OR UPDATE OR DELETE ON student_subjects
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('student_subjects');

-- What a student does in a subject this year: their choice's kind; with no choices recorded for the year
-- the student takes every subject (as before choices existed). NULL = not taken.
CREATE OR REPLACE FUNCTION app.student_subject_kind(p_student BIGINT, p_year BIGINT, p_subject BIGINT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM student_subjects WHERE student_id = p_student AND academic_year_id = p_year)
             THEN (SELECT kind FROM student_subjects
                    WHERE student_id = p_student AND academic_year_id = p_year AND subject_id = p_subject)
           ELSE 'compulsory'
         END
$$;

-- ---- 2. marks codes -----------------------------------------------------------------------------
-- treatment in a result: zero (0 of the maximum), exclude (out of the maximum), fixed (value marks),
-- percent (value % of the maximum), pro_rata (from the other exams of a term; out of the maximum in one
-- exam). blocks_result: the subject counts as failed (AB).
CREATE TABLE mark_codes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  code           TEXT NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9 ]{0,11}$'),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  treatment      TEXT NOT NULL CHECK (treatment IN ('zero', 'exclude', 'fixed', 'percent', 'pro_rata')),
  value          NUMERIC(6, 2) CHECK (value IS NULL OR value >= 0),
  blocks_result  BOOLEAN NOT NULL DEFAULT false,
  sort_order     INT NOT NULL DEFAULT 0,
  status         row_status NOT NULL DEFAULT 'active',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((treatment IN ('fixed', 'percent')) = (value IS NOT NULL)),
  UNIQUE (school_id, code)
);
CREATE TRIGGER mark_codes_audit AFTER INSERT OR UPDATE OR DELETE ON mark_codes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('mark_codes');

CREATE OR REPLACE FUNCTION app.mark_codes_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO mark_codes (school_id, code, name, treatment, blocks_result, sort_order)
  SELECT p_school, x.code, x.name, x.treatment, x.blocks, x.ord FROM (VALUES
    ('AB', 'Absent', 'zero', true, 1),
    ('ML', 'Medical leave', 'exclude', false, 2),
    ('EX', 'Exempted', 'exclude', false, 3),
    ('NA', 'Not applicable', 'exclude', false, 4),
    ('OD', 'On duty', 'exclude', false, 5),
    ('L', 'Late admission', 'exclude', false, 6),
    ('NEW ADM', 'New admission', 'exclude', false, 7)
  ) AS x(code, name, treatment, blocks, ord)
  ON CONFLICT (school_id, code) DO NOTHING
$$;

-- ---- 3. a code or a grade in place of marks -----------------------------------------------------
ALTER TABLE mark_entries ADD COLUMN code TEXT;
ALTER TABLE mark_entries ADD COLUMN grade TEXT CHECK (grade IS NULL OR length(grade) BETWEEN 1 AND 10);
UPDATE mark_entries SET code = CASE WHEN absent THEN 'AB' ELSE 'EX' END WHERE absent OR exempt;
ALTER TABLE mark_entries DROP CONSTRAINT mark_entries_check1;
ALTER TABLE mark_entries ADD CONSTRAINT mark_entries_one_value
  CHECK ((marks IS NOT NULL)::int + (code IS NOT NULL)::int + (grade IS NOT NULL)::int = 1);
-- absent and exempt stay for the readers that use them: they follow the code
ALTER TABLE mark_entries ADD CONSTRAINT mark_entries_flags
  CHECK (absent = (code IS NOT DISTINCT FROM 'AB') AND exempt = (code IS NOT DISTINCT FROM 'EX'));

-- ---- 4. grade-only subjects; a subject's own grade scale ----------------------------------------
ALTER TABLE exam_subjects DROP CONSTRAINT exam_subjects_max_marks_check;
ALTER TABLE exam_subjects ADD CONSTRAINT exam_subjects_max_marks_check CHECK (max_marks >= 0);
ALTER TABLE exam_subjects ADD CONSTRAINT exam_subjects_grade_only CHECK (max_marks > 0 OR pass_marks IS NULL);
ALTER TABLE exam_subjects ADD COLUMN grade_scale_id BIGINT REFERENCES grade_scales(id);

-- ---- 5. locks per entry type on an exam's class (marks lock per subject as before) ----------------
ALTER TABLE exam_classes ADD COLUMN indicators_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_classes ADD COLUMN remarks_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_classes ADD COLUMN attendance_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_classes ADD COLUMN health_locked BOOLEAN NOT NULL DEFAULT false;

-- ---- 6. the pre-primary band (Nursery, KG, Balvatika) -------------------------------------------
ALTER TYPE class_band ADD VALUE IF NOT EXISTS 'pre_primary' BEFORE 'primary';

-- ---- 7. marks entry with codes, grades and the student's subjects --------------------------------
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
    IF app.student_subject_kind(r."studentId", v_exam.academic_year_id, v_es.subject_id) IS NULL THEN
      RAISE EXCEPTION 'exams.subject_not_taken' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId")::TEXT;
    END IF;
    IF v_code IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM mark_codes WHERE code = v_code AND status = 'active') THEN
        RAISE EXCEPTION 'exams.unknown_code' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId", 'code', v_code)::TEXT;
      END IF;
    ELSIF v_es.max_marks = 0 THEN
      -- a grade-only subject: a grade of its scale
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
    -- RETURNING (xmax = 0) is true for a fresh row and false for an updated one; an unchanged row returns nothing
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

-- ---- 8. results with the student's subjects and the codes ----------------------------------------
-- A subject the student does not take, an additional subject and a grade-only subject stay out of the
-- total. A code counts as its treatment says (zero, out of the maximum, fixed marks, % of the maximum;
-- pro-rata is out of the maximum in one exam); a code that blocks the result fails the subject. A missing
-- entry makes the result incomplete (no rank). Grade from the class's scale by percentage.
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
             AND app.student_subject_kind(e.student_id, v_exam.academic_year_id, es.subject_id) IN ('compulsory', 'optional')
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
