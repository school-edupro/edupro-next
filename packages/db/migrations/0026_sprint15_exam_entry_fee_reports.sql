-- Sprint 15 (Phase 3): exam entry (marks, indicators, remarks, exam attendance, health records), the fee
-- reports centre (forecast mart, defaulter reminders, bank statement reconciliation, Tally export format),
-- and the assistant for teachers and parents with anomaly alerts. Design: docs/design/11-*.md.

-- ===========================================================================
-- 1. Exam entry
-- ===========================================================================
CREATE TABLE mark_entries (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  exam_subject_id  BIGINT NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES students(id),
  marks            NUMERIC(6, 2) CHECK (marks IS NULL OR marks >= 0),
  absent           BOOLEAN NOT NULL DEFAULT false,
  exempt           BOOLEAN NOT NULL DEFAULT false,
  entered_by       BIGINT,
  entered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_ref       TEXT,
  UNIQUE (exam_subject_id, student_id),
  CHECK (NOT (absent AND exempt)),
  CHECK ((absent OR exempt) = (marks IS NULL))
);
CREATE INDEX mark_entries_by_student ON mark_entries (student_id);
CREATE TRIGGER mark_entries_set_updated_at BEFORE UPDATE ON mark_entries FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER mark_entries_audit AFTER INSERT OR UPDATE OR DELETE ON mark_entries FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Co-scholastic / HPC descriptors: a set names the grades it allows; exams pick a set per class
CREATE TABLE indicator_sets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  grades      TEXT[] NOT NULL DEFAULT '{A,B,C}',
  status      row_status NOT NULL DEFAULT 'active',
  legacy_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  deleted_at  TIMESTAMPTZ,
  CHECK (cardinality(grades) BETWEEN 2 AND 10)
);
CREATE UNIQUE INDEX indicator_sets_code ON indicator_sets (school_id, code) WHERE deleted_at IS NULL;
CREATE TRIGGER indicator_sets_set_updated_at BEFORE UPDATE ON indicator_sets FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE indicators (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  set_id      BIGINT NOT NULL REFERENCES indicator_sets(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  area        TEXT,                                   -- e.g. Work education, Art, Health, Discipline
  sort_order  INT NOT NULL DEFAULT 0,
  legacy_ref  TEXT,
  UNIQUE (set_id, code)
);
CREATE INDEX indicators_by_set ON indicators (set_id, sort_order);

CREATE TABLE exam_indicator_sets (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id),
  exam_id   BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id  BIGINT NOT NULL REFERENCES classes(id),
  set_id    BIGINT NOT NULL REFERENCES indicator_sets(id),
  UNIQUE (exam_id, class_id)
);

CREATE TABLE indicator_entries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  exam_id       BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  indicator_id  BIGINT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  grade         TEXT NOT NULL,
  note          TEXT,
  entered_by    BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_ref    TEXT,
  UNIQUE (exam_id, indicator_id, student_id)
);
CREATE INDEX indicator_entries_by_exam_student ON indicator_entries (exam_id, student_id);
CREATE TRIGGER indicator_entries_set_updated_at BEFORE UPDATE ON indicator_entries FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER indicator_entries_audit AFTER INSERT OR UPDATE OR DELETE ON indicator_entries FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Predefined remarks (legacy exam_remark_mapping) and the per-student remark of an exam
CREATE TABLE remark_bank (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  text        TEXT NOT NULL CHECK (length(text) BETWEEN 3 AND 600),
  class_id    BIGINT REFERENCES classes(id),           -- NULL = every class
  sort_order  INT NOT NULL DEFAULT 0,
  status      row_status NOT NULL DEFAULT 'active',
  legacy_ref  TEXT,
  UNIQUE (school_id, code)
);

CREATE TABLE exam_remarks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  exam_id     BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  remark      TEXT NOT NULL CHECK (length(remark) BETWEEN 1 AND 600),
  bank_code   TEXT,
  entered_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_ref  TEXT,
  UNIQUE (exam_id, student_id)
);
CREATE TRIGGER exam_remarks_set_updated_at BEFORE UPDATE ON exam_remarks FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER exam_remarks_audit AFTER INSERT OR UPDATE OR DELETE ON exam_remarks FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE exam_attendance (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  exam_id       BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id    BIGINT NOT NULL REFERENCES students(id),
  days_present  INT NOT NULL CHECK (days_present >= 0),
  days_total    INT NOT NULL CHECK (days_total > 0),
  entered_by    BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_ref    TEXT,
  UNIQUE (exam_id, student_id),
  CHECK (days_present <= days_total)
);
CREATE TRIGGER exam_attendance_set_updated_at BEFORE UPDATE ON exam_attendance FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER exam_attendance_audit AFTER INSERT OR UPDATE OR DELETE ON exam_attendance FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Health records (sensitive: own permissions; the service never stages values into the audit payload;
-- the row trigger records the change with the values masked by app.audit_row_change's key masking)
CREATE TABLE health_records (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  student_id    BIGINT NOT NULL REFERENCES students(id),
  recorded_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  exam_id       BIGINT REFERENCES exams(id) ON DELETE SET NULL,
  height_cm     NUMERIC(5, 1) CHECK (height_cm IS NULL OR height_cm BETWEEN 40 AND 250),
  weight_kg     NUMERIC(5, 2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 3 AND 200),
  bmi           NUMERIC(5, 2) GENERATED ALWAYS AS (CASE WHEN height_cm IS NULL OR weight_kg IS NULL OR height_cm = 0 THEN NULL
                                                        ELSE round(weight_kg / ((height_cm / 100) * (height_cm / 100)), 2) END) STORED,
  blood_group   TEXT CHECK (blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  vision_left   TEXT,
  vision_right  TEXT,
  dental        TEXT,
  notes         TEXT,
  recorded_by   BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_ref    TEXT
);
CREATE UNIQUE INDEX health_records_one_per_day ON health_records (student_id, recorded_on, COALESCE(exam_id, 0));
CREATE INDEX health_records_by_student ON health_records (student_id, recorded_on DESC);
CREATE TRIGGER health_records_set_updated_at BEFORE UPDATE ON health_records FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER health_records_audit AFTER INSERT OR UPDATE OR DELETE ON health_records FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Is the student enrolled this year in a section of the class (any status other than active is out)
CREATE OR REPLACE FUNCTION app.student_in_class(p_student_id BIGINT, p_academic_year_id BIGINT, p_class_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                  WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id AND e.status = 'active' AND cs.class_id = p_class_id)
$$;

-- app.enter_marks: the only writer of mark_entries. Rows: [{studentId, marks|null, absent, exempt}].
CREATE OR REPLACE FUNCTION app.enter_marks(p_exam_subject_id BIGINT, p_rows JSONB)
RETURNS TABLE (o_inserted INT, o_updated INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_es   exam_subjects%ROWTYPE;
  v_exam exams%ROWTYPE;
  r      RECORD;
  v_marks  NUMERIC;
  v_absent BOOLEAN;
  v_exempt BOOLEAN;
  v_ins INT := 0;
  v_upd INT := 0;
  v_i   INT;
  v_u   INT;
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
  FOR r IN SELECT * FROM jsonb_to_recordset(p_rows) AS x("studentId" BIGINT, marks NUMERIC, absent BOOLEAN, exempt BOOLEAN) LOOP
    v_absent := COALESCE(r.absent, false);
    v_exempt := COALESCE(r.exempt, false);
    v_marks  := CASE WHEN v_absent OR v_exempt THEN NULL ELSE r.marks END;
    IF r."studentId" IS NULL THEN RAISE EXCEPTION 'exams.student_required' USING ERRCODE = 'P0001'; END IF;
    IF NOT app.student_in_class(r."studentId", v_exam.academic_year_id, v_es.class_id) THEN
      RAISE EXCEPTION 'exams.student_not_in_class' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('studentId', r."studentId")::TEXT;
    END IF;
    IF NOT v_absent AND NOT v_exempt AND (v_marks IS NULL OR v_marks < 0 OR v_marks > v_es.max_marks) THEN
      RAISE EXCEPTION 'exams.marks_out_of_range' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('studentId', r."studentId", 'marks', v_marks, 'maxMarks', v_es.max_marks)::TEXT;
    END IF;
    -- RETURNING (xmax = 0) is true for a fresh row and false for an updated one; an unchanged row returns nothing
    WITH w AS (
      INSERT INTO mark_entries (school_id, exam_subject_id, student_id, marks, absent, exempt, entered_by, updated_by)
      VALUES (app.current_school_id(), p_exam_subject_id, r."studentId", v_marks, v_absent, v_exempt, app.current_user_id(), app.current_user_id())
      ON CONFLICT (exam_subject_id, student_id) DO UPDATE
        SET marks = EXCLUDED.marks, absent = EXCLUDED.absent, exempt = EXCLUDED.exempt, updated_by = app.current_user_id()
        WHERE mark_entries.marks IS DISTINCT FROM EXCLUDED.marks OR mark_entries.absent <> EXCLUDED.absent OR mark_entries.exempt <> EXCLUDED.exempt
      RETURNING (xmax = 0) AS inserted
    )
    SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_i, v_u FROM w;
    v_ins := v_ins + COALESCE(v_i, 0);
    v_upd := v_upd + COALESCE(v_u, 0);
  END LOOP;
  RETURN QUERY SELECT v_ins, v_upd;
END
$$;

-- ===========================================================================
-- 2. Fee reports centre
-- ===========================================================================
CREATE TABLE mart.fee_forecast (
  school_id         BIGINT NOT NULL,
  academic_year_id  BIGINT NOT NULL,
  class_id          BIGINT,
  class_code        TEXT,
  due_month         DATE NOT NULL,
  ledger            TEXT NOT NULL,
  students          INT NOT NULL,
  expected          NUMERIC(14, 2) NOT NULL,
  collected         NUMERIC(14, 2) NOT NULL,
  balance           NUMERIC(14, 2) NOT NULL
);
CREATE INDEX fee_forecast_by_year ON mart.fee_forecast (school_id, academic_year_id, due_month);
CALL app.apply_tenant_rls_in('mart', 'fee_forecast');

-- Defaulter reminders sent from the reports centre (one per student per day)
CREATE TABLE fee_reminders (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  student_id  BIGINT NOT NULL REFERENCES students(id),
  sent_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  balance     NUMERIC(12, 2) NOT NULL,
  channel     comms_channel NOT NULL,
  message_id  BIGINT REFERENCES comms_messages(id),
  sent_by     BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, sent_on)
);

-- Bank statement upload and matching (cheque, DD, NEFT/UPI receipts against the bank's credits)
CREATE TABLE bank_statements (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  bank_name     TEXT NOT NULL,
  account_ref   TEXT,
  from_date     DATE,
  to_date       DATE,
  file_name     TEXT,
  rows          INT NOT NULL DEFAULT 0,
  matched       INT NOT NULL DEFAULT 0,
  unmatched     INT NOT NULL DEFAULT 0,
  returned      INT NOT NULL DEFAULT 0,
  credits       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  debits        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  uploaded_by   BIGINT,
  request_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bank_statement_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  statement_id     BIGINT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  line_no          INT NOT NULL,
  txn_date         DATE NOT NULL,
  value_date       DATE,
  narration        TEXT,
  reference        TEXT,
  debit            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  credit           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balance          NUMERIC(14, 2),
  status           TEXT NOT NULL CHECK (status IN ('matched', 'unmatched', 'ambiguous', 'returned', 'ignored')),
  matched_by       TEXT,                                -- instrument, reference, amount_date
  payment_id       BIGINT REFERENCES fee_payments(id),
  misc_receipt_id  BIGINT REFERENCES misc_receipts(id),
  note             TEXT,
  UNIQUE (statement_id, line_no)
);
CREATE INDEX bank_statement_lines_by_status ON bank_statement_lines (statement_id, status);
ALTER TABLE fee_payments ADD COLUMN cleared_on DATE, ADD COLUMN bank_line_id BIGINT REFERENCES bank_statement_lines(id);
ALTER TABLE misc_receipts ADD COLUMN cleared_on DATE, ADD COLUMN bank_line_id BIGINT REFERENCES bank_statement_lines(id);

-- Tally goes out as XML through the export service
ALTER TABLE exports DROP CONSTRAINT exports_format_check;
ALTER TABLE exports ADD CONSTRAINT exports_format_check CHECK (format IN ('xlsx', 'csv', 'pdf', 'xml'));

-- Default message templates for every school (editable under Communication → Templates)
INSERT INTO comms_templates (school_id, code, channel, name, body, variables, is_alert)
SELECT s.id, t.code, t.channel::comms_channel, t.name, t.body, t.variables::jsonb, t.is_alert
  FROM schools s CROSS JOIN (VALUES
    ('fee_due', 'whatsapp', 'Fee reminder',
     'Dear {{guardian_name}}, fees of ₹{{amount}} for {{student_name}} ({{section}}) are pending as on {{as_of}}. Please pay at the school counter or in the parent app. - {{school}}',
     '["guardian_name","amount","student_name","section","as_of","school"]', false),
    ('fee_due', 'sms', 'Fee reminder',
     'Dear {{guardian_name}}, fees of Rs {{amount}} for {{student_name}} are pending as on {{as_of}}. - {{school}}',
     '["guardian_name","amount","student_name","as_of","school"]', false),
    ('insight_alert', 'push', 'Insight alert',
     '{{title}}: {{message}}',
     '["title","message","school"]', true),
    ('insight_alert', 'whatsapp', 'Insight alert',
     '{{school}} alert. {{title}}: {{message}}',
     '["title","message","school"]', true)
  ) AS t(code, channel, name, body, variables, is_alert)
ON CONFLICT (school_id, code, channel) DO NOTHING;

-- ===========================================================================
-- 3. Anomaly alerts v1
-- ===========================================================================
CREATE TABLE insight_alerts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  kind          TEXT NOT NULL,                        -- attendance.drop, fees.collection_dip, reader.silent
  severity      TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'danger')),
  subject_type  TEXT,                                 -- class_section, school, rfid_device
  subject_id    BIGINT,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  notified_at   TIMESTAMPTZ,
  acked_by      BIGINT,
  acked_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX insight_alerts_one_per_day ON insight_alerts (school_id, kind, COALESCE(subject_id, 0), detected_on);
CREATE INDEX insight_alerts_open ON insight_alerts (school_id, detected_on DESC) WHERE acked_at IS NULL;

-- ===========================================================================
-- 4. Row-level security
-- ===========================================================================
CALL app.apply_tenant_rls('mark_entries');
CALL app.apply_tenant_rls('indicator_sets');
CALL app.apply_tenant_rls('indicators');
CALL app.apply_tenant_rls('exam_indicator_sets');
CALL app.apply_tenant_rls('indicator_entries');
CALL app.apply_tenant_rls('remark_bank');
CALL app.apply_tenant_rls('exam_remarks');
CALL app.apply_tenant_rls('exam_attendance');
CALL app.apply_tenant_rls('health_records');
CALL app.apply_tenant_rls('fee_reminders');
CALL app.apply_tenant_rls('bank_statements');
CALL app.apply_tenant_rls('bank_statement_lines');
CALL app.apply_tenant_rls('insight_alerts');

-- ===========================================================================
-- 5. Marts refresh with the forecast
-- ===========================================================================
CREATE OR REPLACE FUNCTION app.refresh_marts() RETURNS TABLE (o_mart TEXT, o_rows INT, o_ms INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_t0 TIMESTAMPTZ;
  v_n  INT;
BEGIN
  PERFORM app.assert_context();

  -- attendance_daily: working days (any session that day) of the last 400 days plus today, per section
  v_t0 := clock_timestamp();
  DELETE FROM mart.attendance_daily WHERE school_id = app.current_school_id();
  INSERT INTO mart.attendance_daily (school_id, academic_year_id, on_date, class_section_id, class_id, section, strength, present, absent, late, marked)
  SELECT cs.school_id, cs.academic_year_id, d.on_date, cs.id, cs.class_id, k.code || '-' || cs.name,
         (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.academic_year_id = cs.academic_year_id
            AND e.status = 'active' AND e.joined_on <= d.on_date AND (e.ended_on IS NULL OR e.ended_on >= d.on_date)),
         COALESCE(m.present, 0), COALESCE(m.absent, 0), COALESCE(m.late, 0), s.id IS NOT NULL
    FROM class_sections cs
    JOIN classes k ON k.id = cs.class_id
    JOIN academic_years y ON y.id = cs.academic_year_id
    CROSS JOIN LATERAL (
      SELECT gs::date AS on_date
        FROM generate_series(GREATEST(y.start_date, CURRENT_DATE - 400), LEAST(y.end_date, CURRENT_DATE), interval '1 day') gs
    ) d
    LEFT JOIN LATERAL (
      SELECT x.id FROM attendance_sessions x
       WHERE x.class_section_id = cs.id AND x.on_date = d.on_date AND x.kind = 'day'
       ORDER BY x.locked DESC, x.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE am.code <> 'A')::int AS present,
             count(*) FILTER (WHERE am.code = 'A')::int AS absent,
             count(*) FILTER (WHERE am.code = 'L')::int AS late
        FROM attendance_marks am WHERE am.session_id = s.id
    ) m ON true
   WHERE cs.deleted_at IS NULL AND cs.school_id = app.current_school_id()
     AND (d.on_date = CURRENT_DATE
          OR EXISTS (SELECT 1 FROM attendance_sessions x WHERE x.academic_year_id = cs.academic_year_id AND x.on_date = d.on_date AND x.kind = 'day'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO mart.refresh_log (school_id, mart, rows, duration_ms) VALUES (app.current_school_id(), 'attendance_daily', v_n, (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
  o_mart := 'attendance_daily'; o_rows := v_n; o_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int; RETURN NEXT;

  -- fee_dues: one row per student and due date with the open balance and ageing bucket
  v_t0 := clock_timestamp();
  DELETE FROM mart.fee_dues WHERE school_id = app.current_school_id();
  INSERT INTO mart.fee_dues (school_id, academic_year_id, student_id, admission_no, student_name, class_id, class_section_id, section, due_on, net, paid, balance, days_overdue, bucket)
  SELECT d.school_id, d.academic_year_id, d.student_id, s.admission_no, s.display_name, cs.class_id, cs.id, k.code || '-' || cs.name, d.due_on,
         sum(d.net), sum(d.paid), sum(d.net - d.paid), GREATEST(CURRENT_DATE - d.due_on, 0),
         CASE WHEN CURRENT_DATE <= d.due_on THEN 'current'
              WHEN CURRENT_DATE - d.due_on <= 30 THEN '1-30'
              WHEN CURRENT_DATE - d.due_on <= 60 THEN '31-60'
              WHEN CURRENT_DATE - d.due_on <= 90 THEN '61-90'
              ELSE '90+' END
    FROM fee_demands d
    JOIN students s ON s.id = d.student_id
    LEFT JOIN enrolments e ON e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id AND e.status = 'active'
    LEFT JOIN class_sections cs ON cs.id = e.class_section_id
    LEFT JOIN classes k ON k.id = cs.class_id
   WHERE d.status IN ('pending', 'partial', 'paid') AND d.school_id = app.current_school_id()
   GROUP BY d.school_id, d.academic_year_id, d.student_id, s.admission_no, s.display_name, cs.class_id, cs.id, k.code, cs.name, d.due_on;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO mart.refresh_log (school_id, mart, rows, duration_ms) VALUES (app.current_school_id(), 'fee_dues', v_n, (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
  o_mart := 'fee_dues'; o_rows := v_n; o_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int; RETURN NEXT;

  -- fee_collection_daily
  v_t0 := clock_timestamp();
  DELETE FROM mart.fee_collection_daily WHERE school_id = app.current_school_id();
  INSERT INTO mart.fee_collection_daily (school_id, academic_year_id, received_on, mode, receipts, amount)
  SELECT school_id, academic_year_id, received_on, mode, count(*)::int, sum(amount) FROM fee_payments WHERE school_id = app.current_school_id() AND status NOT IN ('reversed', 'bounced') GROUP BY 1, 2, 3, 4;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO mart.refresh_log (school_id, mart, rows, duration_ms) VALUES (app.current_school_id(), 'fee_collection_daily', v_n, (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
  o_mart := 'fee_collection_daily'; o_rows := v_n; o_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int; RETURN NEXT;

  -- admissions_funnel
  v_t0 := clock_timestamp();
  DELETE FROM mart.admissions_funnel WHERE school_id = app.current_school_id();
  INSERT INTO mart.admissions_funnel (school_id, cycle_id, cycle_code, cycle_status, class_id, class_code, status, applications)
  SELECT a.school_id, a.cycle_id, cy.code, cy.status::text, a.class_id, k.code, a.status::text, count(*)::int
    FROM applications a JOIN admission_cycles cy ON cy.id = a.cycle_id JOIN classes k ON k.id = a.class_id
   WHERE a.school_id = app.current_school_id()
   GROUP BY a.school_id, a.cycle_id, cy.code, cy.status, a.class_id, k.code, a.status;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO mart.refresh_log (school_id, mart, rows, duration_ms) VALUES (app.current_school_id(), 'admissions_funnel', v_n, (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
  o_mart := 'admissions_funnel'; o_rows := v_n; o_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int; RETURN NEXT;

  -- comms_delivery_daily (IST days, last 120 days)
  v_t0 := clock_timestamp();
  DELETE FROM mart.comms_delivery_daily WHERE school_id = app.current_school_id();
  INSERT INTO mart.comms_delivery_daily (school_id, on_date, channel, status, messages)
  SELECT school_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date, channel::text, status::text, count(*)::int
    FROM comms_messages WHERE school_id = app.current_school_id() AND created_at >= now() - interval '120 days' GROUP BY 1, 2, 3, 4;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO mart.refresh_log (school_id, mart, rows, duration_ms) VALUES (app.current_school_id(), 'comms_delivery_daily', v_n, (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
  o_mart := 'comms_delivery_daily'; o_rows := v_n; o_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int; RETURN NEXT;

  -- fee_forecast (Sprint 15): expected, collected and balance per class and due month of every year
  v_t0 := clock_timestamp();
  DELETE FROM mart.fee_forecast WHERE school_id = app.current_school_id();
  INSERT INTO mart.fee_forecast (school_id, academic_year_id, class_id, class_code, due_month, ledger, students, expected, collected, balance)
  SELECT d.school_id, d.academic_year_id, cs.class_id, k.code, date_trunc('month', d.due_on)::date, d.ledger::text,
         count(DISTINCT d.student_id)::int, sum(d.net), sum(d.paid), sum(d.net - d.paid)
    FROM fee_demands d
    LEFT JOIN enrolments e ON e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id AND e.status = 'active'
    LEFT JOIN class_sections cs ON cs.id = e.class_section_id
    LEFT JOIN classes k ON k.id = cs.class_id
   WHERE d.status IN ('pending', 'partial', 'paid') AND d.school_id = app.current_school_id()
   GROUP BY d.school_id, d.academic_year_id, cs.class_id, k.code, date_trunc('month', d.due_on), d.ledger;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO mart.refresh_log (school_id, mart, rows, duration_ms) VALUES (app.current_school_id(), 'fee_forecast', v_n, (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
  o_mart := 'fee_forecast'; o_rows := v_n; o_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int; RETURN NEXT;

  -- keep the log short
  DELETE FROM mart.refresh_log WHERE school_id = app.current_school_id() AND refreshed_at < now() - interval '30 days';
  RETURN;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Anomaly detection (run nightly by the workers job insights.alerts; one row per kind, subject and day)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.detect_insight_alerts() RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_n     INT := 0;
  v_i     INT;
  v_today DATE := CURRENT_DATE;
  r       RECORD;
  v_d7    NUMERIC;
  v_avg   NUMERIC;
BEGIN
  PERFORM app.assert_context();

  -- attendance.drop: this week against the previous four weeks per section (at least 20 pupil-days each)
  FOR r IN
    SELECT cs.id, k.code || '-' || cs.name AS section, this.pct AS this_pct, prev.pct AS prev_pct
      FROM (SELECT class_section_id, sum(present)::numeric * 100 / NULLIF(sum(strength), 0) AS pct, sum(strength) AS n
              FROM mart.attendance_daily WHERE marked AND on_date BETWEEN v_today - 6 AND v_today GROUP BY 1) this
      JOIN (SELECT class_section_id, sum(present)::numeric * 100 / NULLIF(sum(strength), 0) AS pct, sum(strength) AS n
              FROM mart.attendance_daily WHERE marked AND on_date BETWEEN v_today - 34 AND v_today - 7 GROUP BY 1) prev USING (class_section_id)
      JOIN class_sections cs ON cs.id = this.class_section_id JOIN classes k ON k.id = cs.class_id
     WHERE this.n >= 20 AND prev.n >= 20 AND prev.pct - this.pct >= 10
  LOOP
    INSERT INTO insight_alerts (school_id, kind, severity, subject_type, subject_id, title, message, data)
    VALUES (app.current_school_id(), 'attendance.drop', CASE WHEN r.prev_pct - r.this_pct >= 20 THEN 'danger' ELSE 'warning' END, 'class_section', r.id,
            'Attendance drop in ' || r.section,
            format('%s%% this week against %s%% over the previous four weeks', round(r.this_pct, 1), round(r.prev_pct, 1)),
            jsonb_build_object('section', r.section, 'thisWeekPct', round(r.this_pct, 1), 'previousPct', round(r.prev_pct, 1)))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_i = ROW_COUNT; v_n := v_n + v_i;
  END LOOP;

  -- fees.collection_dip: the last seven days under half the mean weekly collection of the previous four weeks
  SELECT COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN v_today - 6 AND v_today), 0),
         COALESCE(sum(amount) FILTER (WHERE received_on BETWEEN v_today - 34 AND v_today - 7), 0) / 4
    INTO v_d7, v_avg FROM mart.fee_collection_daily;
  IF v_avg > 0 AND v_d7 < v_avg * 0.5 THEN
    INSERT INTO insight_alerts (school_id, kind, severity, subject_type, subject_id, title, message, data)
    VALUES (app.current_school_id(), 'fees.collection_dip', 'warning', 'school', NULL, 'Fee collection dip',
            format('₹%s collected in the last 7 days against a weekly average of ₹%s', round(v_d7), round(v_avg)),
            jsonb_build_object('last7', round(v_d7, 2), 'weeklyAverage', round(v_avg, 2)))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_i = ROW_COUNT; v_n := v_n + v_i;
  END IF;

  -- reader.silent: an active RFID reader silent for a day
  FOR r IN SELECT id, code, name, last_seen_at FROM rfid_devices WHERE status = 'active' AND last_seen_at IS NOT NULL AND last_seen_at < now() - interval '24 hours' LOOP
    INSERT INTO insight_alerts (school_id, kind, severity, subject_type, subject_id, title, message, data)
    VALUES (app.current_school_id(), 'reader.silent', 'warning', 'rfid_device', r.id, 'Reader silent: ' || r.name,
            format('%s (%s) last reported at %s', r.name, r.code, to_char(r.last_seen_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI')),
            jsonb_build_object('code', r.code, 'lastSeenAt', r.last_seen_at))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_i = ROW_COUNT; v_n := v_n + v_i;
  END LOOP;
  RETURN v_n;
END
$$;

-- ===========================================================================
-- 6. Permissions, grants, segregation of duties
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('exams.marks.enter',        'exams',    'Enter marks for the sections and subjects assigned', false),
  ('exams.marks.view',         'exams',    'View marks entered', false),
  ('exams.marks.unlock',       'exams',    'Reopen a locked exam subject for entry', false),
  ('exams.indicator.enter',    'exams',    'Enter co-scholastic and HPC indicators', false),
  ('exams.remark.enter',       'exams',    'Enter exam remarks and exam attendance', false),
  ('exams.attendance.enter',   'exams',    'Enter exam attendance days', false),
  ('exams.health.enter',       'exams',    'Record height, weight and health notes', false),
  ('exams.health.view',        'exams',    'View health records', false),
  ('fees.defaulter.notify',    'fees',     'Send fee reminders to defaulters from the reports centre', false),
  ('insights.alert.view',      'insights', 'View anomaly alerts', false),
  ('insights.alert.ack',       'insights', 'Acknowledge anomaly alerts', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description;

INSERT INTO sod_rules (school_id, permission_a, permission_b, description) VALUES
  (NULL, 'exams.marks.enter', 'exams.marks.unlock', 'A teacher who enters marks must not be able to reopen a locked subject')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('exams.marks.view', 'exams.marks.unlock', 'exams.indicator.enter', 'exams.remark.enter', 'exams.attendance.enter',
                 'exams.health.enter', 'exams.health.view', 'fees.defaulter.notify', 'insights.alert.view', 'insights.alert.ack', 'insights.assistant.use')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('exams.marks.view', 'exams.marks.unlock', 'exams.indicator.enter', 'exams.remark.enter', 'exams.attendance.enter',
                 'exams.health.view', 'insights.alert.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('exams.marks.enter', 'exams.marks.view', 'exams.indicator.enter', 'insights.assistant.use')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'class_teacher'
  AND p.code IN ('exams.remark.enter', 'exams.attendance.enter', 'exams.health.enter', 'exams.health.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('fees.defaulter.notify')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('exams.marks.view', 'insights.alert.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'parent'
  AND p.code IN ('insights.assistant.use')
ON CONFLICT DO NOTHING;

-- The accounts desk runs and exports the reports centre
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('reports.export.view', 'reports.export.create')
ON CONFLICT DO NOTHING;
