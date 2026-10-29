-- Examinations v2, part 2 (docs/design/65): marks of a subject in a section go open → submitted (the
-- teacher) → verified (the class teacher, HOD or coordinator; verified = locked); a verifier may send them
-- back; reopening needs the unlock right and a reason. The principal publishes a term's results and cards
-- (families told), a release may be sent to the principal first, withdrawn with a reason, and a card held
-- back for one student.

CREATE TABLE exam_entry_status (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  exam_subject_id   BIGINT NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  class_section_id  BIGINT NOT NULL REFERENCES class_sections(id),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'verified')),
  submitted_by      BIGINT,
  submitted_at      TIMESTAMPTZ,
  verified_by       BIGINT,
  verified_at       TIMESTAMPTZ,
  remark            TEXT CHECK (remark IS NULL OR length(remark) <= 500),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_subject_id, class_section_id)
);
CREATE INDEX exam_entry_status_waiting ON exam_entry_status (status) WHERE status = 'submitted';
CALL app.apply_tenant_rls('exam_entry_status');

CREATE TABLE exam_entry_status_log (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  exam_subject_id   BIGINT NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  class_section_id  BIGINT NOT NULL REFERENCES class_sections(id),
  from_status       TEXT NOT NULL,
  to_status         TEXT NOT NULL,
  note              TEXT CHECK (note IS NULL OR length(note) <= 500),
  actor_user_id     BIGINT,
  at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exam_entry_status_log_by_subject ON exam_entry_status_log (exam_subject_id, class_section_id, at DESC);
CALL app.apply_tenant_rls('exam_entry_status_log');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.marks.verify', 'exams', 'Verify (or send back) submitted marks of any section: HOD, coordinator, exam office', false),
  ('exams.result.publish', 'exams', 'Publish results and report cards to families, and withdraw them', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('exams.marks.verify'), ('exams.result.publish')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'exams.marks.verify' FROM roles r WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
ON CONFLICT DO NOTHING;

-- a release: draft → submitted (sent to the principal) → released (published) → withdrawn (a reason)
ALTER TABLE report_card_releases DROP CONSTRAINT report_card_releases_status_check;
ALTER TABLE report_card_releases ADD CONSTRAINT report_card_releases_status_check
  CHECK (status IN ('draft', 'submitted', 'released', 'withdrawn'));
ALTER TABLE report_card_releases ADD COLUMN submitted_by BIGINT;
ALTER TABLE report_card_releases ADD COLUMN submitted_at TIMESTAMPTZ;
ALTER TABLE report_card_releases ADD COLUMN withdrawn_by BIGINT;
ALTER TABLE report_card_releases ADD COLUMN withdrawn_at TIMESTAMPTZ;
ALTER TABLE report_card_releases ADD COLUMN withdrawn_reason TEXT CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) <= 500);
ALTER TABLE report_card_releases ADD COLUMN notified_at TIMESTAMPTZ;
ALTER TABLE report_card_releases ADD COLUMN notified_count INT NOT NULL DEFAULT 0;

-- one student's card held back by the school (the old "Report Card Hide / Show"), on top of the fee rule
CREATE TABLE report_card_holds (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  release_id  BIGINT NOT NULL REFERENCES report_card_releases(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  held_by     BIGINT,
  held_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, student_id)
);
CREATE TRIGGER report_card_holds_audit AFTER INSERT OR UPDATE OR DELETE ON report_card_holds
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('report_card_holds');

-- the families' message when a term's results are published
CREATE OR REPLACE FUNCTION app.exam_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, 'result_published', ch.channel::comms_channel, 'Exams: result published',
         CASE WHEN ch.channel = 'email' THEN 'The {{term}} result of {{name}} is published' END,
         'Dear parent, the {{term}} result of {{name}} at {{school}} is published. See the report card in the parent app.',
         '["name","term","school"]'::jsonb, 'service'
    FROM (VALUES ('sms'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- marks of a subject are entered only while its section's entry is open
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
    IF app.student_subject_kind(r."studentId", v_exam.academic_year_id, v_es.subject_id) IS NULL THEN
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
