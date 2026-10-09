-- 0110: optional fee heads by opt-in, and two approval levels for a pupil's fee changes.
--   * An optional head (swimming, horse riding ...) is charged only to pupils it is opted in for, for the
--     months chosen. The opt-in list is changed through the fee change approval.
--   * The fee change approval gets two levels: the fee in-charge (accountant), then the principal. When
--     the fee in-charge raises the request, level 1 is approved by itself (the engine reads the level's
--     "autoIfRequester" mark); nobody approves a one-level request of their own this way.
CREATE TABLE student_fee_optional_heads (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  student_id       BIGINT NOT NULL REFERENCES students(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  head_id          BIGINT NOT NULL REFERENCES fee_heads(id),
  from_seq         INT NOT NULL DEFAULT 1 CHECK (from_seq BETWEEN 1 AND 12),
  to_seq           INT NOT NULL DEFAULT 12 CHECK (to_seq BETWEEN 1 AND 12),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  change_id        BIGINT REFERENCES fee_profile_changes(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  removed_at       TIMESTAMPTZ,
  removed_by       BIGINT,
  CHECK (from_seq <= to_seq)
);
CREATE INDEX student_fee_optional_heads_by_student ON student_fee_optional_heads (student_id, academic_year_id) WHERE status = 'active';
CALL app.apply_tenant_rls('student_fee_optional_heads');
CREATE TRIGGER student_fee_optional_heads_audit AFTER INSERT OR UPDATE OR DELETE ON student_fee_optional_heads FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- schools still on the one-level default move to the two levels; a school that set its own keeps it
UPDATE workflow_definitions
   SET levels = '[{"level": 1, "name": "Fee in-charge", "resolver": {"kind": "role", "roleCode": "accountant"}, "slaHours": 24, "autoIfRequester": true},
                  {"level": 2, "name": "Principal approval", "resolver": {"kind": "role", "roleCode": "school_admin"}, "slaHours": 48}]'::jsonb,
       name = 'Fee change of a pupil (discount, fee group, hostel, optional heads)', updated_at = now()
 WHERE code = 'fee_profile_change' AND deleted_at IS NULL AND jsonb_array_length(levels) = 1
   AND levels -> 0 -> 'resolver' ->> 'roleCode' = 'school_admin';

-- app.generate_fee_demand: as 0109, optional heads only for pupils opted in
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
  DELETE FROM fee_demands WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND paid = 0 AND status IN ('pending', 'cancelled')
     -- a line a waiver or a bounce points at is kept; it is refreshed in place below
     AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE a.demand_id = fee_demands.id OR a.charge_demand_id = fee_demands.id);

  -- 2. structure rows: school-ledger heads for everyone, hostel-ledger heads for hostellers (Sprint 14)
  FOR r IN
    SELECT fs.*, h.kind AS head_kind, h.ledger AS head_ledger, h.is_optional AS head_optional
      FROM fee_structures fs JOIN fee_heads h ON h.id = fs.head_id AND h.deleted_at IS NULL AND h.status = 'active'
     WHERE fs.academic_year_id = p_academic_year_id AND fs.class_id = v_class_id
       AND fs.fee_group = v_profile.fee_group
       AND fs.student_type IN ('all', v_profile.student_type)
       -- a row for the pupil's own type (old / new) replaces the "all students" row of the same head
       AND (fs.student_type = v_profile.student_type OR NOT EXISTS (
             SELECT 1 FROM fee_structures o
              WHERE o.academic_year_id = fs.academic_year_id AND o.class_id = fs.class_id AND o.fee_group = fs.fee_group
                AND o.head_id = fs.head_id AND o.student_type = v_profile.student_type))
       AND h.kind IN ('regular', 'misc')
       AND (h.ledger = 'school' OR (h.ledger = 'hostel' AND v_profile.hosteller))
  LOOP
    FOR p IN
      SELECT * FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id
         AND CASE
               -- an optional head is charged only in the months the pupil has opted in for
               WHEN r.head_optional AND NOT EXISTS (
                      SELECT 1 FROM student_fee_optional_heads oh
                       WHERE oh.student_id = p_student_id AND oh.academic_year_id = p_academic_year_id AND oh.head_id = r.head_id
                         AND oh.status = 'active' AND fp.sequence BETWEEN oh.from_seq AND oh.to_seq) THEN false
               WHEN r.amounts IS NOT NULL THEN COALESCE(r.amounts[fp.sequence], 0) > 0
               WHEN r.periods IS NOT NULL THEN fp.sequence = ANY (r.periods)
               WHEN r.frequency = 'monthly' THEN true
               WHEN r.frequency = 'quarterly' THEN fp.sequence IN (1, 4, 7, 10)
               WHEN r.frequency = 'half_yearly' THEN fp.sequence IN (1, 7)
               ELSE fp.sequence = 1
             END
       ORDER BY fp.sequence
    LOOP
      v_gross := CASE WHEN r.amounts IS NOT NULL THEN r.amounts[p.sequence] ELSE r.amount END;
      v_disc := app.fee_discount_for(p_student_id, p_academic_year_id, r.head_id, p.sequence, v_gross, false);
      v_due := app.fee_due_on(p.id, v_class_id, p.due_on);
      v_net := GREATEST(v_gross - v_disc, 0);
      INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, discount, net, due_on, source, run_id, ledger)
      VALUES (app.current_school_id(), p_student_id, p_academic_year_id, p.id, r.head_id, v_gross, v_disc, v_net, v_due, 'structure', v_run_id, r.head_ledger)
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO UPDATE SET gross = EXCLUDED.gross, discount = EXCLUDED.discount, net = EXCLUDED.net, due_on = EXCLUDED.due_on, run_id = EXCLUDED.run_id, updated_at = now()
        WHERE fee_demands.paid = 0 AND fee_demands.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE (a.demand_id = fee_demands.id OR a.charge_demand_id = fee_demands.id) AND a.status = 'approved');   -- a paid or waived line keeps its amounts
      IF FOUND THEN v_rows := v_rows + 1; END IF;
    END LOOP;
  END LOOP;

  -- 3. transport rows
  IF v_profile.transport_slab_id IS NOT NULL AND NOT v_profile.transport_disabled AND v_transport_head IS NOT NULL THEN
    FOR p IN SELECT * FROM fee_periods WHERE academic_year_id = p_academic_year_id AND transport_charged ORDER BY sequence LOOP
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
      ON CONFLICT (student_id, academic_year_id, period_id, head_id) DO UPDATE SET gross = EXCLUDED.gross, discount = EXCLUDED.discount, net = EXCLUDED.net, due_on = EXCLUDED.due_on, run_id = EXCLUDED.run_id, updated_at = now()
        WHERE fee_demands.paid = 0 AND fee_demands.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM fee_adjustments a WHERE (a.demand_id = fee_demands.id OR a.charge_demand_id = fee_demands.id) AND a.status = 'approved');
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
