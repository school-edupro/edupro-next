-- Sprint 12 (Phase 3 start): fee ledger foundation, transport fleet, insights marts v1.
-- Late fee rule (app.late_fee: day-wise and slab modes with per-student overrides, legacy fnlLateFee and
-- fees_latefee_adjust), instalment visibility, receipt numbers on payments through app.next_receipt_no,
-- demand regeneration diff; transport stops with geo, vehicles and drivers; reporting marts (schema mart)
-- refreshed per school under RLS by the workers; permissions for fleet, late fee and insights.

-- ---------------------------------------------------------------------------
-- Fee periods: late fee slabs (legacy Fees_MonthQuaterMapping Late_fee, LastFee_date_1..3, Late_fees_1..3)
-- and the date from which families see the instalment
-- ---------------------------------------------------------------------------
ALTER TABLE fee_periods
  ADD COLUMN late_fee_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,   -- slab mode: after the due date
  ADD COLUMN late_slab_1_on     DATE,
  ADD COLUMN late_slab_1_amount NUMERIC(12, 2),
  ADD COLUMN late_slab_2_on     DATE,
  ADD COLUMN late_slab_2_amount NUMERIC(12, 2),
  ADD COLUMN late_slab_3_on     DATE,
  ADD COLUMN late_slab_3_amount NUMERIC(12, 2),
  ADD COLUMN visible_from       DATE;                                -- NULL = due date minus fees.instalment_visible_days_before

-- Manual late fee decisions per student and instalment (legacy fees_latefee_adjust): amount 0 waives.
CREATE TABLE fee_late_fee_overrides (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  period_id         BIGINT NOT NULL REFERENCES fee_periods(id),      -- the instalment's anchor period
  amount            NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  reason            TEXT NOT NULL,
  created_by        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by        BIGINT,
  revoked_at        TIMESTAMPTZ,
  request_id        UUID
);
CREATE UNIQUE INDEX fee_late_fee_overrides_active ON fee_late_fee_overrides (student_id, academic_year_id, period_id) WHERE revoked_at IS NULL;

-- Receipt numbers on payments, issued by app.next_receipt_no per school, ledger and financial year.
ALTER TABLE fee_payments
  ADD COLUMN ledger            ledger_type NOT NULL DEFAULT 'school',
  ADD COLUMN financial_year_id BIGINT REFERENCES financial_years(id),
  ADD COLUMN receipt_no        TEXT;
CREATE UNIQUE INDEX fee_payments_receipt_no ON fee_payments (school_id, receipt_no) WHERE receipt_no IS NOT NULL;
CREATE INDEX fee_payments_by_student ON fee_payments (student_id, academic_year_id, received_on);
CREATE INDEX fee_payment_allocations_by_demand ON fee_payment_allocations (demand_id);

-- Regeneration keeps the diff (rows added, removed and changed) with the run.
ALTER TABLE fee_demand_runs ADD COLUMN diff JSONB;

-- Financial year that covers a date (receipts are numbered per financial year).
CREATE OR REPLACE FUNCTION app.financial_year_for(p_date DATE) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT id FROM financial_years WHERE p_date BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- app.late_fee: the legacy late fee rule for one instalment of a student (rows sharing a due date).
--   * nothing before the due date, nothing when the instalment was settled by the due date
--   * day-wise: days between the due date and the settlement date (or the as-of date) x fees.late_fee_per_day
--   * slab: the anchor period's slab amount for the settlement/as-of date (after slab 3, 2, 1, else after due)
--   * an active override for the student and anchor period wins (amount 0 = waived)
-- Reads only; posting the late fee onto a receipt is the collection procedure's job (Sprint 13).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.late_fee(p_student_id BIGINT, p_academic_year_id BIGINT, p_due_on DATE, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (o_amount NUMERIC, o_mode TEXT, o_days INT, o_overridden BOOLEAN, o_reason TEXT, o_period_id BIGINT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_net         NUMERIC;
  v_paid_now    NUMERIC;
  v_paid_by_due NUMERIC;
  v_settled_on  DATE;
  v_end         DATE;
  v_anchor      fee_periods%ROWTYPE;
  v_ov          fee_late_fee_overrides%ROWTYPE;
  v_mode        TEXT;
  v_per_day     NUMERIC;
BEGIN
  PERFORM app.assert_context();
  SELECT COALESCE(sum(net), 0), COALESCE(sum(paid), 0) INTO v_net, v_paid_now
    FROM fee_demands
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on
     AND status IN ('pending', 'partial', 'paid');
  SELECT fp.* INTO v_anchor FROM fee_periods fp
   WHERE fp.academic_year_id = p_academic_year_id AND fp.due_on = p_due_on ORDER BY fp.sequence LIMIT 1;
  IF v_anchor.id IS NULL THEN
    SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on
     ORDER BY fp.sequence LIMIT 1;
  END IF;
  o_period_id := v_anchor.id;
  o_amount := 0; o_mode := 'none'; o_days := 0; o_overridden := false; o_reason := NULL;
  IF v_net <= 0 OR p_as_of <= p_due_on THEN RETURN NEXT; RETURN; END IF;

  SELECT COALESCE(sum(a.amount), 0) INTO v_paid_by_due
    FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
   WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on
     AND p.received_on <= p_due_on;
  IF v_net - v_paid_by_due <= 0 THEN RETURN NEXT; RETURN; END IF;   -- settled on time

  v_end := p_as_of;
  IF v_net - v_paid_now <= 0 THEN
    SELECT max(p.received_on) INTO v_settled_on
      FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on;
    IF v_settled_on IS NOT NULL AND v_settled_on < v_end THEN v_end := v_settled_on; END IF;
  END IF;
  IF v_end <= p_due_on THEN RETURN NEXT; RETURN; END IF;
  o_days := v_end - p_due_on;

  IF v_anchor.id IS NOT NULL THEN
    SELECT * INTO v_ov FROM fee_late_fee_overrides
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = v_anchor.id AND revoked_at IS NULL;
    IF FOUND THEN
      o_amount := v_ov.amount; o_mode := 'override'; o_overridden := true; o_reason := v_ov.reason;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  v_mode := COALESCE(app.setting('fees.late_fee_mode') #>> '{}', 'daywise');
  IF v_mode = 'slab' THEN
    o_amount := CASE
      WHEN v_anchor.late_slab_3_on IS NOT NULL AND v_end > v_anchor.late_slab_3_on THEN COALESCE(v_anchor.late_slab_3_amount, 0)
      WHEN v_anchor.late_slab_2_on IS NOT NULL AND v_end > v_anchor.late_slab_2_on THEN COALESCE(v_anchor.late_slab_2_amount, 0)
      WHEN v_anchor.late_slab_1_on IS NOT NULL AND v_end > v_anchor.late_slab_1_on THEN COALESCE(v_anchor.late_slab_1_amount, 0)
      ELSE COALESCE(v_anchor.late_fee_amount, 0)
    END;
  ELSE
    v_mode := 'daywise';
    v_per_day := COALESCE((app.setting('fees.late_fee_per_day') #>> '{}')::numeric, 0);
    o_amount := round(o_days * v_per_day, 2);
  END IF;
  o_mode := v_mode;
  RETURN NEXT;
END
$$;

-- Receipt document templates join the transfer certificate, bonafide and letter kinds.
ALTER TYPE template_kind ADD VALUE IF NOT EXISTS 'fee_receipt';

-- ---------------------------------------------------------------------------
-- Transport fleet: vehicles, drivers, stops with geo; routes carry a vehicle and a driver
-- ---------------------------------------------------------------------------
CREATE TABLE transport_vehicles (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  reg_no           TEXT NOT NULL,
  make             TEXT,
  capacity         INT CHECK (capacity IS NULL OR capacity > 0),
  insurance_expiry DATE,
  fitness_expiry   DATE,
  permit_expiry    DATE,
  gps_device_id    TEXT,
  status           row_status NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX transport_vehicles_reg_no ON transport_vehicles (school_id, reg_no) WHERE deleted_at IS NULL;

CREATE TABLE transport_drivers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  name            TEXT NOT NULL,
  mobile          TEXT,
  licence_no      TEXT,
  licence_expiry  DATE,
  employee_id     BIGINT REFERENCES employees(id),
  status          row_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT,
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE transport_stops (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  route_id     BIGINT NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  sequence     INT NOT NULL CHECK (sequence > 0),
  name         TEXT NOT NULL,
  lat          NUMERIC(9, 6) CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90)),
  lng          NUMERIC(9, 6) CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180)),
  pickup_time  TIME,
  drop_time    TIME,
  slab_id      BIGINT REFERENCES transport_slabs(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, sequence)
);

ALTER TABLE transport_routes
  ADD COLUMN vehicle_id       BIGINT REFERENCES transport_vehicles(id),
  ADD COLUMN driver_id        BIGINT REFERENCES transport_drivers(id),
  ADD COLUMN conductor_name   TEXT,
  ADD COLUMN conductor_mobile TEXT;
ALTER TABLE student_route_assignments ADD COLUMN stop_id BIGINT REFERENCES transport_stops(id);

CALL app.apply_tenant_rls('fee_late_fee_overrides');
CALL app.apply_tenant_rls('transport_vehicles');
CALL app.apply_tenant_rls('transport_drivers');
CALL app.apply_tenant_rls('transport_stops');

-- ---------------------------------------------------------------------------
-- Insights marts v1 (docs/design/07-ai-layer.md section 4, ADR-010): reporting tables in schema mart,
-- rebuilt per school by app.refresh_marts() under the school's own tenant context, so forced RLS applies
-- to reads exactly as it does to the base tables. The workers refresh every school every 15 minutes.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS mart;
GRANT USAGE ON SCHEMA mart TO edupro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mart GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edupro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mart GRANT USAGE, SELECT ON SEQUENCES TO edupro_app;

CREATE OR REPLACE PROCEDURE app.apply_tenant_rls_in(p_schema TEXT, p_table TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', p_schema, p_table);
  EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', p_schema, p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p_table || '_tenant_isolation', p_schema, p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR ALL TO PUBLIC
       USING (school_id = app.current_school_id())
       WITH CHECK (school_id = app.current_school_id())',
    p_table || '_tenant_isolation', p_schema, p_table
  );
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p_table || '_migrator', p_schema, p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR ALL TO edupro_migrator USING (true) WITH CHECK (true)',
    p_table || '_migrator', p_schema, p_table
  );
END
$$;

CREATE TABLE mart.attendance_daily (
  school_id         BIGINT NOT NULL,
  academic_year_id  BIGINT NOT NULL,
  on_date           DATE NOT NULL,
  class_section_id  BIGINT NOT NULL,
  class_id          BIGINT NOT NULL,
  section           TEXT NOT NULL,
  strength          INT NOT NULL,
  present           INT NOT NULL,
  absent            INT NOT NULL,
  late              INT NOT NULL,
  marked            BOOLEAN NOT NULL,
  PRIMARY KEY (class_section_id, on_date)
);
CREATE INDEX mart_attendance_daily_by_day ON mart.attendance_daily (school_id, academic_year_id, on_date);

CREATE TABLE mart.fee_dues (
  school_id         BIGINT NOT NULL,
  academic_year_id  BIGINT NOT NULL,
  student_id        BIGINT NOT NULL,
  admission_no      TEXT NOT NULL,
  student_name      TEXT NOT NULL,
  class_id          BIGINT,
  class_section_id  BIGINT,
  section           TEXT,
  due_on            DATE NOT NULL,
  net               NUMERIC(14, 2) NOT NULL,
  paid              NUMERIC(14, 2) NOT NULL,
  balance           NUMERIC(14, 2) NOT NULL,
  days_overdue      INT NOT NULL,
  bucket            TEXT NOT NULL,        -- current, 1-30, 31-60, 61-90, 90+
  PRIMARY KEY (student_id, academic_year_id, due_on)
);
CREATE INDEX mart_fee_dues_by_year ON mart.fee_dues (school_id, academic_year_id, bucket);

CREATE TABLE mart.fee_collection_daily (
  school_id         BIGINT NOT NULL,
  academic_year_id  BIGINT NOT NULL,
  received_on       DATE NOT NULL,
  mode              TEXT NOT NULL,
  receipts          INT NOT NULL,
  amount            NUMERIC(14, 2) NOT NULL,
  PRIMARY KEY (school_id, academic_year_id, received_on, mode)
);

CREATE TABLE mart.admissions_funnel (
  school_id     BIGINT NOT NULL,
  cycle_id      BIGINT NOT NULL,
  cycle_code    TEXT NOT NULL,
  cycle_status  TEXT NOT NULL,
  class_id      BIGINT NOT NULL,
  class_code    TEXT NOT NULL,
  status        TEXT NOT NULL,
  applications  INT NOT NULL,
  PRIMARY KEY (cycle_id, class_id, status)
);

CREATE TABLE mart.comms_delivery_daily (
  school_id  BIGINT NOT NULL,
  on_date    DATE NOT NULL,
  channel    TEXT NOT NULL,
  status     TEXT NOT NULL,
  messages   INT NOT NULL,
  PRIMARY KEY (school_id, on_date, channel, status)
);

CREATE TABLE mart.refresh_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL,
  mart         TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows         INT NOT NULL,
  duration_ms  INT NOT NULL
);
CREATE INDEX mart_refresh_log_latest ON mart.refresh_log (school_id, mart, refreshed_at DESC);

CALL app.apply_tenant_rls_in('mart', 'attendance_daily');
CALL app.apply_tenant_rls_in('mart', 'fee_dues');
CALL app.apply_tenant_rls_in('mart', 'fee_collection_daily');
CALL app.apply_tenant_rls_in('mart', 'admissions_funnel');
CALL app.apply_tenant_rls_in('mart', 'comms_delivery_daily');
CALL app.apply_tenant_rls_in('mart', 'refresh_log');
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mart TO edupro_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mart TO edupro_app;

-- Rebuilds every mart for the current school. Runs under the tenant context (SECURITY INVOKER); the school
-- filter is explicit as well, so the seed (which runs as the owner, outside RLS) rebuilds one school at a time.
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
  SELECT school_id, academic_year_id, received_on, mode, count(*)::int, sum(amount) FROM fee_payments WHERE school_id = app.current_school_id() GROUP BY 1, 2, 3, 4;
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

  -- keep the log short
  DELETE FROM mart.refresh_log WHERE school_id = app.current_school_id() AND refreshed_at < now() - interval '30 days';
  RETURN;
END
$$;

-- The workers need the list of schools to refresh before any tenant context exists: SECURITY DEFINER with a
-- narrow surface (ids of active schools only), executable by the application role; recorded in ADR-010.
CREATE OR REPLACE FUNCTION app.mart_schools() RETURNS TABLE (o_school_id BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM schools WHERE status = 'active' AND deleted_at IS NULL ORDER BY id
$$;
REVOKE ALL ON FUNCTION app.mart_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mart_schools() TO edupro_app;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.late_fee.manage',     'fees',      'Waive or fix the late fee of an instalment for a student', false),
  ('fees.ledger.view',         'fees',      'View student fee ledgers (dues, late fee, receipts, regeneration history)', false),
  ('transport.fleet.view',     'transport', 'View vehicles, drivers and route stops', false),
  ('transport.fleet.manage',   'transport', 'Maintain vehicles, drivers and route stops', false),
  ('insights.dashboard.view',  'insights',  'View the principal and department dashboards', false),
  ('insights.mart.refresh',    'insights',  'Refresh the reporting marts on demand', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('fees.late_fee.manage', 'fees.ledger.view', 'transport.fleet.view', 'transport.fleet.manage', 'insights.dashboard.view', 'insights.mart.refresh')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'accountant'
  AND p.code IN ('fees.late_fee.manage', 'fees.ledger.view', 'payments.intent.view', 'payments.offline.record')
ON CONFLICT DO NOTHING;

-- whoever may see routes may see the fleet; auditors read ledgers and dashboards
INSERT INTO role_permissions (role_id, permission_code)
SELECT rp.role_id, 'transport.fleet.view' FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
WHERE r.school_id IS NULL AND rp.permission_code = 'transport.route.view'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND p.code IN ('fees.ledger.view', 'transport.fleet.view', 'insights.dashboard.view')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator'
  AND p.code IN ('insights.dashboard.view')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Amendments found by the Sprint 12 harness
-- ---------------------------------------------------------------------------
-- Two setting changes on the same day were ambiguous: the newest row wins.
CREATE OR REPLACE FUNCTION app.setting(p_key TEXT, p_on DATE DEFAULT CURRENT_DATE) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT value
  FROM school_settings
  WHERE school_id = app.current_school_id()
    AND key = p_key
    AND valid_from <= p_on
    AND (valid_to IS NULL OR valid_to >= p_on)
  ORDER BY valid_from DESC, id DESC
  LIMIT 1
$$;

-- Allocation is instalment-aware: a payment settles instalments (rows sharing a due date) oldest first and
-- never takes more than an instalment's balance, so an opening-balance credit (a negative row) really reduces
-- that instalment instead of leaving a phantom shortfall on the next one. When an instalment is settled its
-- rows are marked paid, the credit row included (its paid becomes its negative net). Returns the unallocated
-- remainder. A credit larger than its instalment is not carried forward (record it as a discount instead).
CREATE OR REPLACE FUNCTION app.allocate_fee_payment(p_payment_id BIGINT) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_p     fee_payments%ROWTYPE;
  v_left  NUMERIC;
  v_group NUMERIC;
  v_take  NUMERIC;
  g RECORD;
  d RECORD;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO v_p FROM fee_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fees.payment_not_found' USING ERRCODE = 'P0002'; END IF;
  v_left := v_p.amount;
  FOR g IN
    SELECT due_on, sum(net - paid) AS balance FROM fee_demands
     WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND status IN ('pending', 'partial')
     GROUP BY due_on HAVING sum(net - paid) > 0 ORDER BY due_on
  LOOP
    EXIT WHEN v_left <= 0;
    v_group := LEAST(v_left, g.balance);
    FOR d IN
      SELECT id, net, paid FROM fee_demands
       WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND due_on = g.due_on
         AND status IN ('pending', 'partial') AND net > paid
       ORDER BY id FOR UPDATE
    LOOP
      EXIT WHEN v_group <= 0;
      v_take := LEAST(v_group, d.net - d.paid);
      INSERT INTO fee_payment_allocations (school_id, payment_id, demand_id, amount) VALUES (app.current_school_id(), p_payment_id, d.id, v_take);
      UPDATE fee_demands SET paid = paid + v_take, status = CASE WHEN paid + v_take >= net THEN 'paid' ELSE 'partial' END::fee_demand_status, updated_at = now() WHERE id = d.id;
      v_group := v_group - v_take;
      v_left := v_left - v_take;
    END LOOP;
    -- instalment settled: apply the credit rows against whatever the cash left short
    IF (SELECT COALESCE(sum(net - paid), 0) FROM fee_demands
         WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND due_on = g.due_on AND status IN ('pending', 'partial', 'paid')) <= 0 THEN
      UPDATE fee_demands SET paid = net, status = 'paid', updated_at = now()
       WHERE student_id = v_p.student_id AND academic_year_id = v_p.academic_year_id AND due_on = g.due_on AND status IN ('pending', 'partial');
    END IF;
  END LOOP;
  RETURN v_left;
END
$$;

-- Accountants render receipts through the document renderer, which checks the template view permission.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'platform.template.view' FROM roles r WHERE r.school_id IS NULL AND r.code = 'accountant'
ON CONFLICT DO NOTHING;
