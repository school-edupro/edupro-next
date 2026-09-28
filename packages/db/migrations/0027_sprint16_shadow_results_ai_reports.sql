-- Sprint 16 (Phase 3): the shadow run (legacy receipts dual-posted and reconciled daily), machine service
-- keys, exam results with registers, analysis and promotion proposals, AI reports v1. Design: docs/design/12-*.md.

-- ===========================================================================
-- 1. Service keys: machine credentials for feeds (the RFID device-key pattern, generalised)
-- ===========================================================================
CREATE TABLE service_keys (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL,                       -- sha256 of the key; the key itself is shown once
  scopes        TEXT[] NOT NULL DEFAULT '{}',        -- e.g. {shadow.feed}
  status        row_status NOT NULL DEFAULT 'active',
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  revoked_at    TIMESTAMPTZ,
  revoked_by    BIGINT,
  UNIQUE (school_id, name)
);
CREATE UNIQUE INDEX service_keys_hash ON service_keys (key_hash);

-- Looked up before any tenant context exists (SECURITY DEFINER, like app.rfid_device_lookup)
CREATE OR REPLACE FUNCTION app.service_key_lookup(p_key_hash TEXT)
RETURNS TABLE (o_id BIGINT, o_school_id BIGINT, o_name TEXT, o_scopes TEXT[], o_status TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, app AS $$
  SELECT id, school_id, name, scopes, status::text FROM service_keys WHERE key_hash = p_key_hash AND revoked_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.service_key_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.service_key_lookup(TEXT) TO edupro_app;

-- ===========================================================================
-- 2. Shadow run
-- ===========================================================================
CREATE TABLE shadow_feeds (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  kind         TEXT NOT NULL CHECK (kind IN ('receipts', 'balances')),
  source       TEXT NOT NULL,                        -- e.g. legacy-cron, upload:apr.csv
  file_name    TEXT,
  rows         INT NOT NULL DEFAULT 0,
  accepted     INT NOT NULL DEFAULT 0,
  posted       INT NOT NULL DEFAULT 0,
  skipped      INT NOT NULL DEFAULT 0,
  rejected     INT NOT NULL DEFAULT 0,
  rejects      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{legacyKey, column, reason}]
  received_by  BIGINT,                               -- user, or NULL when a service key fed it
  service_key_id BIGINT REFERENCES service_keys(id),
  request_id   UUID,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shadow_legacy_receipts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  feed_id          BIGINT NOT NULL REFERENCES shadow_feeds(id),
  legacy_receipt_no TEXT NOT NULL,
  admission_no     TEXT NOT NULL,
  student_id       BIGINT REFERENCES students(id),
  received_on      DATE NOT NULL,
  amount           NUMERIC(12, 2) NOT NULL,
  late_fee         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  mode             TEXT NOT NULL,
  instrument_no    TEXT,
  bank_name        TEXT,
  reference        TEXT,
  cancelled        BOOLEAN NOT NULL DEFAULT false,
  legacy_year      TEXT,
  lines            JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_id       BIGINT REFERENCES fee_payments(id),
  post_error       TEXT,
  posted_at        TIMESTAMPTZ,
  reversed_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, legacy_receipt_no)
);
CREATE INDEX shadow_legacy_receipts_by_day ON shadow_legacy_receipts (school_id, received_on);
CREATE TRIGGER shadow_legacy_receipts_set_updated_at BEFORE UPDATE ON shadow_legacy_receipts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE shadow_legacy_balances (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  feed_id       BIGINT NOT NULL REFERENCES shadow_feeds(id),
  as_of         DATE NOT NULL,
  admission_no  TEXT NOT NULL,
  student_id    BIGINT REFERENCES students(id),
  balance       NUMERIC(12, 2) NOT NULL,             -- legacy dues as of the date (dr + pre_dr - cr - pre_cr - paid)
  UNIQUE (school_id, as_of, admission_no)
);

CREATE TABLE shadow_runs (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  run_date           DATE NOT NULL,
  from_date          DATE NOT NULL,
  to_date            DATE NOT NULL,
  legacy_receipts    INT NOT NULL DEFAULT 0,
  legacy_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  new_receipts       INT NOT NULL DEFAULT 0,
  new_amount         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  matched            INT NOT NULL DEFAULT 0,
  variances          INT NOT NULL DEFAULT 0,
  open_variances     INT NOT NULL DEFAULT 0,
  variance_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balances_compared  INT NOT NULL DEFAULT 0,
  balance_variances  INT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('zero', 'variance')),
  ran_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, run_date)
);

CREATE TABLE shadow_variances (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  run_id        BIGINT NOT NULL REFERENCES shadow_runs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('missing_in_new', 'missing_in_legacy', 'amount', 'date', 'reversed_in_new', 'not_reversed', 'balance')),
  ref           TEXT NOT NULL,                       -- legacy receipt no, new receipt no or admission no
  legacy        JSONB NOT NULL DEFAULT '{}'::jsonb,
  current       JSONB NOT NULL DEFAULT '{}'::jsonb,
  delta         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'explained', 'resolved')),
  explanation   TEXT,
  decided_by    BIGINT,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, kind, ref)
);
CREATE INDEX shadow_variances_open ON shadow_variances (school_id, status) WHERE status = 'open';

-- app.run_shadow_reconcile: compares the legacy feed with the shadow postings for the window, keeps the day's
-- run (one per school and to_date) and its variances; explained/resolved rows of an earlier run of the same
-- day survive a re-run (same kind and ref).
CREATE OR REPLACE FUNCTION app.run_shadow_reconcile(p_from DATE, p_to DATE)
RETURNS shadow_runs
LANGUAGE plpgsql AS $$
DECLARE
  v_run shadow_runs;
  v_run_id BIGINT;
  r RECORD;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO shadow_runs (school_id, run_date, from_date, to_date, status)
  VALUES (app.current_school_id(), p_to, p_from, p_to, 'zero')
  ON CONFLICT (school_id, run_date) DO UPDATE SET from_date = EXCLUDED.from_date, to_date = EXCLUDED.to_date, ran_at = now()
  RETURNING id INTO v_run_id;
  DELETE FROM shadow_variances WHERE run_id = v_run_id AND status = 'open';

  -- receipts of the legacy feed against their shadow postings
  FOR r IN
    SELECT l.legacy_receipt_no, l.received_on, l.amount, l.mode, l.cancelled, l.payment_id, l.post_error,
           p.receipt_no AS new_no, p.received_on AS new_on, p.amount AS new_amount, p.status AS new_status
      FROM shadow_legacy_receipts l LEFT JOIN fee_payments p ON p.id = l.payment_id
     WHERE l.received_on BETWEEN p_from AND p_to
  LOOP
    IF r.payment_id IS NULL AND NOT r.cancelled THEN
      INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
      VALUES (app.current_school_id(), v_run_id, 'missing_in_new', r.legacy_receipt_no,
              jsonb_build_object('receivedOn', r.received_on, 'amount', r.amount, 'mode', r.mode), jsonb_build_object('error', r.post_error), r.amount)
      ON CONFLICT (run_id, kind, ref) DO NOTHING;
    ELSIF r.payment_id IS NOT NULL AND r.cancelled AND r.new_status NOT IN ('reversed', 'bounced') THEN
      INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
      VALUES (app.current_school_id(), v_run_id, 'not_reversed', r.legacy_receipt_no,
              jsonb_build_object('cancelled', true), jsonb_build_object('receiptNo', r.new_no, 'status', r.new_status), r.new_amount)
      ON CONFLICT (run_id, kind, ref) DO NOTHING;
    ELSIF r.payment_id IS NOT NULL AND NOT r.cancelled AND r.new_status IN ('reversed', 'bounced') THEN
      INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
      VALUES (app.current_school_id(), v_run_id, 'reversed_in_new', r.legacy_receipt_no,
              jsonb_build_object('amount', r.amount), jsonb_build_object('receiptNo', r.new_no, 'status', r.new_status), r.amount)
      ON CONFLICT (run_id, kind, ref) DO NOTHING;
    ELSIF r.payment_id IS NOT NULL AND NOT r.cancelled THEN
      IF abs(r.amount - r.new_amount) > 0.005 THEN
        INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
        VALUES (app.current_school_id(), v_run_id, 'amount', r.legacy_receipt_no,
                jsonb_build_object('amount', r.amount), jsonb_build_object('receiptNo', r.new_no, 'amount', r.new_amount), r.amount - r.new_amount)
        ON CONFLICT (run_id, kind, ref) DO NOTHING;
      END IF;
      IF r.received_on <> r.new_on THEN
        INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
        VALUES (app.current_school_id(), v_run_id, 'date', r.legacy_receipt_no,
                jsonb_build_object('receivedOn', r.received_on), jsonb_build_object('receiptNo', r.new_no, 'receivedOn', r.new_on), 0)
        ON CONFLICT (run_id, kind, ref) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- receipts posted in the new ledger during the window that the legacy feed does not know
  FOR r IN
    SELECT COALESCE(p.receipt_no, 'payment:' || p.id) AS receipt_no, p.received_on, p.amount, p.mode FROM fee_payments p
     WHERE p.received_on BETWEEN p_from AND p_to AND p.ledger = 'school' AND p.status NOT IN ('reversed', 'bounced')
       AND NOT EXISTS (SELECT 1 FROM shadow_legacy_receipts l WHERE l.payment_id = p.id)
  LOOP
    INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
    VALUES (app.current_school_id(), v_run_id, 'missing_in_legacy', r.receipt_no, '{}'::jsonb,
            jsonb_build_object('receivedOn', r.received_on, 'amount', r.amount, 'mode', r.mode), r.amount)
    ON CONFLICT (run_id, kind, ref) DO NOTHING;
  END LOOP;

  -- per-student balances when the legacy snapshot of the day is present
  FOR r IN
    SELECT b.admission_no, b.balance AS legacy_balance, s.id AS student_id,
           COALESCE((SELECT sum(d.net - d.paid) FROM fee_demands d
                      WHERE d.student_id = s.id AND d.ledger = 'school' AND d.status IN ('pending', 'partial', 'paid') AND d.due_on <= p_to), 0) AS new_balance
      FROM shadow_legacy_balances b LEFT JOIN students s ON s.id = b.student_id
     WHERE b.as_of = p_to
  LOOP
    IF r.student_id IS NULL OR abs(r.legacy_balance - r.new_balance) > 0.5 THEN
      INSERT INTO shadow_variances (school_id, run_id, kind, ref, legacy, current, delta)
      VALUES (app.current_school_id(), v_run_id, 'balance', r.admission_no,
              jsonb_build_object('balance', r.legacy_balance), jsonb_build_object('balance', r.new_balance, 'studentId', r.student_id),
              r.legacy_balance - r.new_balance)
      ON CONFLICT (run_id, kind, ref) DO NOTHING;
    END IF;
  END LOOP;

  UPDATE shadow_runs sr SET
    legacy_receipts = (SELECT count(*) FROM shadow_legacy_receipts l WHERE l.received_on BETWEEN p_from AND p_to AND NOT l.cancelled),
    legacy_amount   = COALESCE((SELECT sum(l.amount) FROM shadow_legacy_receipts l WHERE l.received_on BETWEEN p_from AND p_to AND NOT l.cancelled), 0),
    new_receipts    = (SELECT count(*) FROM fee_payments p WHERE p.received_on BETWEEN p_from AND p_to AND p.ledger = 'school' AND p.status NOT IN ('reversed', 'bounced')),
    new_amount      = COALESCE((SELECT sum(p.amount) FROM fee_payments p WHERE p.received_on BETWEEN p_from AND p_to AND p.ledger = 'school' AND p.status NOT IN ('reversed', 'bounced')), 0),
    matched         = (SELECT count(*) FROM shadow_legacy_receipts l JOIN fee_payments p ON p.id = l.payment_id
                        WHERE l.received_on BETWEEN p_from AND p_to AND NOT l.cancelled AND p.status NOT IN ('reversed', 'bounced') AND abs(l.amount - p.amount) <= 0.005 AND l.received_on = p.received_on),
    variances       = (SELECT count(*) FROM shadow_variances v WHERE v.run_id = v_run_id),
    open_variances  = (SELECT count(*) FROM shadow_variances v WHERE v.run_id = v_run_id AND v.status = 'open'),
    variance_amount = COALESCE((SELECT sum(abs(v.delta)) FROM shadow_variances v WHERE v.run_id = v_run_id AND v.status = 'open'), 0),
    balances_compared = (SELECT count(*) FROM shadow_legacy_balances b WHERE b.as_of = p_to),
    balance_variances = (SELECT count(*) FROM shadow_variances v WHERE v.run_id = v_run_id AND v.kind = 'balance'),
    status          = CASE WHEN EXISTS (SELECT 1 FROM shadow_variances v WHERE v.run_id = v_run_id AND v.status = 'open') THEN 'variance' ELSE 'zero' END,
    ran_at          = now()
  WHERE sr.id = v_run_id
  RETURNING * INTO v_run;
  RETURN v_run;
END
$$;

-- ===========================================================================
-- 3. Exam results (the object registers, analysis, promotion and later report cards read)
-- ===========================================================================
CREATE TABLE exam_results (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  exam_id          BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id       BIGINT NOT NULL REFERENCES students(id),
  class_id         BIGINT NOT NULL REFERENCES classes(id),
  class_section_id BIGINT REFERENCES class_sections(id),
  subjects         INT NOT NULL,
  entered          INT NOT NULL,
  absent           INT NOT NULL,
  exempt           INT NOT NULL,
  total            NUMERIC(8, 2) NOT NULL,
  max_total        NUMERIC(8, 2) NOT NULL,
  pct              NUMERIC(5, 2),
  grade            TEXT,
  points           NUMERIC(4, 2),
  failed_subjects  INT NOT NULL DEFAULT 0,
  result           TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'incomplete')),
  rank_in_section  INT,
  rank_in_class    INT,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);
CREATE INDEX exam_results_by_class ON exam_results (exam_id, class_id, class_section_id);

-- Absent counts 0 and fails the subject; exempt subjects leave the maximum; a missing entry makes the result
-- incomplete (no rank). Grade from the class's scale by percentage. Idempotent per exam.
CREATE OR REPLACE FUNCTION app.compute_exam_results(p_exam_id BIGINT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_exam exams%ROWTYPE;
  v_n INT;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_exam FROM exams WHERE id = p_exam_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'exams.not_found' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM exam_results WHERE exam_id = p_exam_id;
  INSERT INTO exam_results (school_id, exam_id, student_id, class_id, class_section_id, subjects, entered, absent, exempt, total, max_total, pct, grade, points, failed_subjects, result)
  SELECT app.current_school_id(), p_exam_id, x.student_id, x.class_id, x.class_section_id, x.subjects, x.entered, x.absent, x.exempt, x.total, x.max_total, x.pct,
         gb.grade, gb.points, x.failed,
         CASE WHEN x.entered + x.exempt < x.subjects THEN 'incomplete' WHEN x.failed > 0 THEN 'fail' ELSE 'pass' END
    FROM (
      SELECT e.student_id, cs.class_id, cs.id AS class_section_id, ec.grade_scale_id,
             count(es.id)::int AS subjects,
             count(me.id) FILTER (WHERE NOT me.exempt)::int AS entered,
             count(me.id) FILTER (WHERE me.absent)::int AS absent,
             count(me.id) FILTER (WHERE me.exempt)::int AS exempt,
             COALESCE(sum(me.marks) FILTER (WHERE NOT me.absent AND NOT me.exempt), 0) AS total,
             COALESCE(sum(es.max_marks) FILTER (WHERE me.id IS NULL OR NOT me.exempt), 0) AS max_total,
             CASE WHEN COALESCE(sum(es.max_marks) FILTER (WHERE me.id IS NULL OR NOT me.exempt), 0) > 0
                  THEN round(COALESCE(sum(me.marks) FILTER (WHERE NOT me.absent AND NOT me.exempt), 0) * 100 / sum(es.max_marks) FILTER (WHERE me.id IS NULL OR NOT me.exempt), 2) END AS pct,
             count(me.id) FILTER (WHERE me.absent OR (NOT me.exempt AND es.pass_marks IS NOT NULL AND me.marks < es.pass_marks))::int AS failed
        FROM exam_classes ec
        JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = v_exam.academic_year_id AND cs.deleted_at IS NULL
        JOIN enrolments e ON e.class_section_id = cs.id AND e.academic_year_id = v_exam.academic_year_id AND e.status = 'active'
        JOIN exam_subjects es ON es.exam_id = ec.exam_id AND es.class_id = ec.class_id
        LEFT JOIN mark_entries me ON me.exam_subject_id = es.id AND me.student_id = e.student_id
       WHERE ec.exam_id = p_exam_id
       GROUP BY e.student_id, cs.class_id, cs.id, ec.grade_scale_id
    ) x
    LEFT JOIN LATERAL (SELECT grade, points FROM grade_bands b WHERE b.scale_id = x.grade_scale_id AND x.pct BETWEEN b.min_pct AND b.max_pct ORDER BY b.sort_order LIMIT 1) gb ON true;
  -- ranks among complete results (dense, by percentage)
  UPDATE exam_results r SET rank_in_section = k.rs, rank_in_class = k.rc
    FROM (SELECT id, dense_rank() OVER (PARTITION BY class_section_id ORDER BY pct DESC) AS rs,
                 dense_rank() OVER (PARTITION BY class_id ORDER BY pct DESC) AS rc
            FROM exam_results WHERE exam_id = p_exam_id AND result <> 'incomplete') k
   WHERE r.id = k.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN (SELECT count(*)::int FROM exam_results WHERE exam_id = p_exam_id);
END
$$;

-- ===========================================================================
-- 4. AI reports v1
-- ===========================================================================
CREATE TABLE ai_reports (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  kind          TEXT NOT NULL CHECK (kind IN ('principal_brief', 'department_weekly')),
  department    TEXT,                                -- academics, attendance, fees, communication (weekly)
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  language      TEXT NOT NULL DEFAULT 'en',
  title         TEXT NOT NULL,
  narrative     TEXT NOT NULL,
  facts         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- the numbers the narrative was written from
  citations     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- fact query ids
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  cost_paise    INT NOT NULL DEFAULT 0,
  export_id     BIGINT REFERENCES exports(id),
  message_ids   BIGINT[] NOT NULL DEFAULT '{}',
  requested_by  BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_reports_one_per_period ON ai_reports (school_id, kind, COALESCE(department, ''), period_to);
CREATE INDEX ai_reports_recent ON ai_reports (school_id, created_at DESC);

-- ===========================================================================
-- 5. Row-level security
-- ===========================================================================
CALL app.apply_tenant_rls('service_keys');
CALL app.apply_tenant_rls('shadow_feeds');
CALL app.apply_tenant_rls('shadow_legacy_receipts');
CALL app.apply_tenant_rls('shadow_legacy_balances');
CALL app.apply_tenant_rls('shadow_runs');
CALL app.apply_tenant_rls('shadow_variances');
CALL app.apply_tenant_rls('exam_results');
CALL app.apply_tenant_rls('ai_reports');

-- ===========================================================================
-- 6. Permissions and grants
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.shadow.view',            'fees',     'View the shadow run: feeds, runs and variances', false),
  ('fees.shadow.manage',          'fees',     'Feed legacy receipts, run the reconciliation, explain and resolve variances', false),
  ('platform.service_key.manage', 'platform', 'Issue and revoke machine service keys', true),
  ('insights.report.view',        'insights', 'Read AI reports (weekly narratives, the Monday brief)', false),
  ('insights.report.run',         'insights', 'Generate AI reports on demand', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('fees.shadow.view', 'fees.shadow.manage', 'platform.service_key.manage', 'insights.report.view', 'insights.report.run')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('fees.shadow.view', 'fees.shadow.manage', 'insights.report.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('auditor', 'academic_coordinator')
  AND p.code IN ('fees.shadow.view', 'insights.report.view')
ON CONFLICT DO NOTHING;
