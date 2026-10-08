-- 0099: year-end carry-forward of fees. The accountant looks at every pupil's unpaid fee, unpaid late
-- fine and excess (advance) of the closing year and carries them to the new year, where they show as
-- "Previous dues", "Previous late fine" and "Advance" in the first instalment. The old year's unpaid
-- bills are marked carried, so no report counts the same rupee twice; a pupil's carry can be undone
-- while nothing has been paid against it.
ALTER TYPE fee_demand_status ADD VALUE IF NOT EXISTS 'carried';

ALTER TABLE student_fee_profiles
  ADD COLUMN opening_hostel   NUMERIC(12, 2) NOT NULL DEFAULT 0,   -- hostel dues of the year before
  ADD COLUMN opening_late_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (opening_late_fee >= 0);

CREATE TABLE fee_carry_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  from_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  to_year_id    BIGINT NOT NULL REFERENCES academic_years(id),
  students      INT NOT NULL DEFAULT 0,
  total_due     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_late    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_advance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ran_by        BIGINT,
  ran_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_year_id <> to_year_id)
);
CALL app.apply_tenant_rls('fee_carry_runs');

CREATE TABLE fee_carry_forwards (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  run_id       BIGINT NOT NULL REFERENCES fee_carry_runs(id),
  student_id   BIGINT NOT NULL REFERENCES students(id),
  from_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  to_year_id   BIGINT NOT NULL REFERENCES academic_years(id),
  due_school   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  due_hostel   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  late_fee     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  advance      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  demand_ids   BIGINT[] NOT NULL DEFAULT '{}',       -- the old year's bills marked carried, for the undo
  undone_at    TIMESTAMPTZ,
  undone_by    BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fee_carry_forwards_once ON fee_carry_forwards (student_id, to_year_id) WHERE undone_at IS NULL;
CALL app.apply_tenant_rls('fee_carry_forwards');
CREATE TRIGGER fee_carry_forwards_audit AFTER INSERT OR UPDATE OR DELETE ON fee_carry_forwards FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.carry_forward.run', 'fees', 'Carry unpaid fee, late fine and advance to the new year, and undo it', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'fees.carry_forward.run' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'accountant')
ON CONFLICT DO NOTHING;

-- What every pupil of the closing year would carry, as of a date (the late fine keeps growing day-wise).
CREATE OR REPLACE FUNCTION app.fee_carry_preview(p_from_year BIGINT, p_to_year BIGINT, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (student_id BIGINT, due_school NUMERIC, due_hostel NUMERIC, late_fee NUMERIC, advance NUMERIC, enrolled BOOLEAN, carried BOOLEAN)
LANGUAGE sql STABLE AS $$
  WITH due AS (
    SELECT d.student_id,
           COALESCE(sum(d.net - d.paid) FILTER (WHERE d.ledger <> 'hostel'), 0) AS due_school,
           COALESCE(sum(d.net - d.paid) FILTER (WHERE d.ledger = 'hostel'), 0) AS due_hostel
      FROM fee_demands d
     WHERE d.academic_year_id = p_from_year AND d.status IN ('pending', 'partial')
     GROUP BY d.student_id
  ), late AS (
    SELECT g.student_id, sum(GREATEST(lf.o_amount - app.late_fee_posted(g.student_id, p_from_year, g.due_on, g.ledger), 0)) AS late_fee
      FROM (SELECT DISTINCT d.student_id, d.due_on, d.ledger FROM fee_demands d
             WHERE d.academic_year_id = p_from_year AND d.status IN ('pending', 'partial', 'paid') AND d.due_on < p_as_of) g
      CROSS JOIN LATERAL app.late_fee(g.student_id, p_from_year, g.due_on, p_as_of, g.ledger) lf
     GROUP BY g.student_id
  ), adv AS (
    SELECT p.student_id,
           sum(p.amount - p.late_fee - p.refunded - COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0)) AS advance
      FROM fee_payments p
     WHERE p.academic_year_id = p_from_year AND p.status IN ('posted', 'partly_refunded')
     GROUP BY p.student_id
  ), ids AS (
    SELECT student_id FROM due UNION SELECT student_id FROM late WHERE late_fee > 0 UNION SELECT student_id FROM adv WHERE advance > 0
  )
  SELECT i.student_id,
         COALESCE(due.due_school, 0), COALESCE(due.due_hostel, 0), COALESCE(late.late_fee, 0), GREATEST(COALESCE(adv.advance, 0), 0),
         EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = i.student_id AND e.academic_year_id = p_to_year AND e.status = 'active'),
         EXISTS (SELECT 1 FROM fee_carry_forwards f WHERE f.student_id = i.student_id AND f.to_year_id = p_to_year AND f.undone_at IS NULL)
    FROM ids i LEFT JOIN due USING (student_id) LEFT JOIN late USING (student_id) LEFT JOIN adv USING (student_id)
$$;

-- ---------------------------------------------------------------------------
-- app.generate_fee_demand: as 0098, with the hostel dues and the late fine of the year before
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.generate_fee_demand(p_student_id bigint, p_academic_year_id bigint)
 RETURNS TABLE(o_run_id bigint, o_rows integer, o_total numeric)
 LANGUAGE plpgsql
AS $$
DECLARE
  v_class_id BIGINT;
  v_year academic_years%ROWTYPE;
  v_student students%ROWTYPE;
  v_profile student_fee_profiles%ROWTYPE;
  v_discount fee_discounts%ROWTYPE;
  v_transport_for_discounted BOOLEAN;
  v_transport_head BIGINT;
  v_opb_head BIGINT;
  v_opb_hostel_head BIGINT;
  v_prev_late_head BIGINT;
  v_run_id BIGINT;
  v_first_period fee_periods%ROWTYPE;
  v_rows INT := 0;
  v_total NUMERIC := 0;
  r RECORD;
  p RECORD;
  v_gross NUMERIC;
  v_disc NUMERIC;
  v_net NUMERIC;
  v_sum NUMERIC;
  v_delta NUMERIC;
  v_last_id BIGINT;
  v_due DATE;
BEGIN
  PERFORM app.assert_context();
  PERFORM app.assert_year_open(p_academic_year_id, 'fees');
  SELECT * INTO v_year FROM academic_years WHERE id = p_academic_year_id;
  SELECT * INTO v_student FROM students WHERE id = p_student_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fees.student_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_student.status <> 'active' THEN
    RAISE EXCEPTION 'fees.student_inactive' USING ERRCODE = 'P0001', DETAIL = 'withdrawn or inactive students get no demand';
  END IF;
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id AND e.status = 'active'
   ORDER BY e.id DESC LIMIT 1;
  IF v_class_id IS NULL THEN
    RAISE EXCEPTION 'fees.not_enrolled' USING ERRCODE = 'P0001', DETAIL = 'the student has no active enrolment in this year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fee_periods WHERE academic_year_id = p_academic_year_id) THEN
    RAISE EXCEPTION 'fees.no_periods' USING ERRCODE = 'P0001', DETAIL = 'define the fee periods of the year first';
  END IF;

  SELECT * INTO v_profile FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  IF NOT FOUND THEN
    v_profile.fee_group := 'general';
    v_profile.student_type := CASE WHEN v_student.admitted_on IS NOT NULL AND v_student.admitted_on >= v_year.start_date THEN 'new' ELSE 'old' END;
    v_profile.transport_slab_id := NULL;
    v_profile.transport_disabled := false;
    v_profile.discount_id := NULL;
    v_profile.opening_balance := 0;
    v_profile.opening_hostel := 0;
    v_profile.opening_late_fee := 0;
    v_profile.hosteller := false;
  END IF;
  IF v_profile.discount_id IS NOT NULL THEN
    SELECT * INTO v_discount FROM fee_discounts WHERE id = v_profile.discount_id AND status = 'active';
  END IF;
  v_transport_for_discounted := COALESCE((app.setting('fees.transport_for_discounted'))::text::boolean, false);
  SELECT id INTO v_transport_head FROM fee_heads WHERE kind = 'transport' AND deleted_at IS NULL AND status = 'active' ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_opb_head FROM fee_heads WHERE kind = 'opening_balance' AND deleted_at IS NULL ORDER BY (ledger = 'school') DESC, sort_order, id LIMIT 1;
  SELECT id INTO v_opb_hostel_head FROM fee_heads WHERE kind = 'opening_balance' AND ledger = 'hostel' AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 1;
  SELECT id INTO v_prev_late_head FROM fee_heads WHERE kind = 'late_fee' AND code = 'PREVLATE' AND deleted_at IS NULL LIMIT 1;
  SELECT * INTO v_first_period FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LIMIT 1;

  INSERT INTO fee_demand_runs (school_id, academic_year_id, student_id, rows, total, ran_by, request_id)
  VALUES (app.current_school_id(), p_academic_year_id, p_student_id, 0, 0, app.current_user_id(), app.current_request_id())
  RETURNING id INTO v_run_id;

  -- 1. drop unpaid rows of the year so the run is repeatable; paid or partly paid rows stay as they are
  DELETE FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND paid = 0 AND status IN ('pending', 'cancelled');

  -- 2. structure rows: school-ledger heads for everyone, hostel-ledger heads for hostellers (Sprint 14)
  FOR r IN
    SELECT fs.*, h.kind AS head_kind, h.ledger AS head_ledger
      FROM fee_structures fs JOIN fee_heads h ON h.id = fs.head_id AND h.deleted_at IS NULL AND h.status = 'active'
     WHERE fs.academic_year_id = p_academic_year_id AND fs.class_id = v_class_id
       AND fs.fee_group = v_profile.fee_group
       AND fs.student_type IN ('all', v_profile.student_type)
       AND h.kind IN ('regular', 'misc')
       AND (h.ledger = 'school' OR (h.ledger = 'hostel' AND v_profile.hosteller))
  LOOP
    FOR p IN
      SELECT * FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id
         AND CASE
               WHEN r.periods IS NOT NULL THEN fp.sequence = ANY (r.periods)
               WHEN r.frequency = 'monthly' THEN true
               WHEN r.frequency = 'quarterly' THEN fp.sequence IN (1, 4, 7, 10)
               WHEN r.frequency = 'half_yearly' THEN fp.sequence IN (1, 7)
               ELSE fp.sequence = 1
             END
       ORDER BY fp.sequence
    LOOP
      v_gross := r.amount;
      v_disc := app.fee_discount_for(p_student_id, p_academic_year_id, r.head_id, p.sequence, v_gross, false);
      v_due := app.fee_due_on(p.id, v_class_id, p.due_on);
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, r.head_id, v_gross, v_disc, v_net, v_due, 'structure', v_run_id, r.head_ledger)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;   -- a paid row keeps its amounts
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;

  -- 3. transport rows
  IF v_profile.transport_slab_id IS NOT NULL AND NOT v_profile.transport_disabled AND v_transport_head IS NOT NULL THEN
    FOR p IN SELECT * FROM fee_periods WHERE academic_year_id = p_academic_year_id ORDER BY sequence LOOP
      SELECT CASE WHEN EXISTS (SELECT 1 FROM student_transport x WHERE x.student_id = p_student_id AND x.academic_year_id = p_academic_year_id AND x.status <> 'cancelled')
                 THEN (SELECT x.monthly_amount FROM student_transport x
                        WHERE x.student_id = p_student_id AND x.academic_year_id = p_academic_year_id AND x.status <> 'cancelled'
                          AND make_date(p.year, p.month, 1) BETWEEN x.from_month AND x.to_month ORDER BY x.id DESC LIMIT 1)
                 ELSE (SELECT monthly_amount FROM transport_slabs WHERE id = v_profile.transport_slab_id) END INTO v_gross;
      IF v_gross IS NULL THEN CONTINUE; END IF;
      -- a pupil on a discount rides only when the school allows it or one of the month's discounts covers transport
      IF NOT v_transport_for_discounted
         AND app.fee_discount_count(p_student_id, p_academic_year_id, p.sequence, false) > 0
         AND app.fee_discount_count(p_student_id, p_academic_year_id, p.sequence, true) = 0 THEN CONTINUE; END IF;
      v_disc := app.fee_discount_for(p_student_id, p_academic_year_id, v_transport_head, p.sequence, v_gross, true);
      v_due := app.fee_due_on(p.id, v_class_id, p.due_on);
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, v_transport_head, v_gross, v_disc, v_net, v_due, 'transport', v_run_id, 'school')
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END IF;

  -- 4. opening balance (a credit reduces the first period; a due adds to it)
  IF v_profile.opening_balance <> 0 THEN
    IF v_opb_head IS NULL THEN
      RAISE EXCEPTION 'fees.no_opening_balance_head' USING ERRCODE = 'P0001', DETAIL = 'create a fee head of kind opening_balance';
    END IF;
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_opb_head, v_profile.opening_balance, 0, v_profile.opening_balance, app.fee_due_on(v_first_period.id, v_class_id, v_first_period.due_on), 'opening_balance', v_run_id, 'school')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;

  -- 4b. carried from the year before: hostel dues on the hostel ledger, and the unpaid late fine
  IF v_profile.opening_hostel <> 0 AND v_opb_hostel_head IS NOT NULL THEN
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_opb_hostel_head, v_profile.opening_hostel, 0, v_profile.opening_hostel, app.fee_due_on(v_first_period.id, v_class_id, v_first_period.due_on), 'opening_balance', v_run_id, 'hostel')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;
  IF v_profile.opening_late_fee > 0 AND v_prev_late_head IS NOT NULL THEN
    INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
    VALUES (app.current_school_id(), p_student_id, p_academic_year_id, v_first_period.id, v_prev_late_head, v_profile.opening_late_fee, 0, v_profile.opening_late_fee, app.fee_due_on(v_first_period.id, v_class_id, v_first_period.due_on), 'opening_balance', v_run_id, 'school')
    ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO NOTHING;
    IF FOUND THEN v_rows := v_rows + 1; END IF;
  END IF;

  -- 5. rounding reconcile: whole rupees per period and ledger, difference on the last row generated in this run
  FOR p IN SELECT fp.id, l.ledger FROM fee_periods fp CROSS JOIN (SELECT unnest(enum_range(NULL::ledger_type)) AS ledger) l WHERE fp.academic_year_id = p_academic_year_id ORDER BY fp.sequence LOOP
    SELECT COALESCE(sum(net), 0) INTO v_sum FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = p.id AND run_id = v_run_id AND ledger = p.ledger;
    v_delta := round(v_sum) - v_sum;
    IF v_delta <> 0 THEN
      SELECT id INTO v_last_id FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = p.id AND run_id = v_run_id AND ledger = p.ledger ORDER BY id DESC LIMIT 1;
      UPDATE fee_demands SET net = net + v_delta, discount = discount - v_delta WHERE id = v_last_id;
    END IF;
  END LOOP;

  SELECT COALESCE(sum(net), 0) INTO v_total FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  UPDATE fee_demand_runs SET rows = v_rows, total = v_total WHERE id = v_run_id;
  RETURN QUERY SELECT v_run_id, v_rows, v_total;
END
$$;
