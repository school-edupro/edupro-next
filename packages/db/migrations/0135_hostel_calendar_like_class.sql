-- 0135: the hostel calendar works like the class calendar.
--  * A hostel month carries what a class month carries for parents: the start date (parents see the
--    instalment from it), the challan date, and Show / Fee pay. Under the hostel's own calendar the hostel
--    instalments take these from the hostel months, not from the class calendar.
--  * An empty hostel last date takes the class calendar's date of that month (it took the school's
--    default date, skipping the class's own date).
--  * Late fee of a hostel instalment is read from the first month of the instalment, as its last date
--    is. A pupil who joined the hostel in the second month of a quarter was read from that second month,
--    which has no late fee of its own, and so was never charged late fee.
ALTER TABLE fee_hostel_period_rules
  ADD COLUMN start_on   DATE,
  ADD COLUMN challan_on DATE,
  ADD COLUMN fee_pay    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN show       BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION app.fee_hostel_due_on(p_period_id bigint, p_class_id bigint, p_default date, p_plan text) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM fee_hostel_calendars hc JOIN fee_periods me ON me.academic_year_id = hc.academic_year_id
                  WHERE me.id = p_period_id AND hc.mode = 'own') THEN
      (SELECT COALESCE(hr.due_on, app.fee_due_on(a.id, p_class_id, a.due_on))
         FROM fee_periods me
        CROSS JOIN (SELECT CASE p_plan WHEN 'quarterly' THEN 3 WHEN 'half_yearly' THEN 6 WHEN 'yearly' THEN 12 ELSE 1 END AS n) n
         JOIN fee_periods a ON a.academic_year_id = me.academic_year_id AND a.sequence = ((me.sequence - 1) / n.n) * n.n + 1
         LEFT JOIN fee_hostel_period_rules hr ON hr.period_id = a.id
        WHERE me.id = p_period_id)
    ELSE app.fee_due_on_plan(p_period_id, p_class_id, p_default, p_plan)
  END
$$;

-- app.late_fee as 0134; the own-hostel branch anchors on the first month of the hostel instalment
CREATE OR REPLACE FUNCTION app.late_fee(p_student_id bigint, p_academic_year_id bigint, p_due_on date, p_as_of date DEFAULT CURRENT_DATE, p_ledger ledger_type DEFAULT 'school'::ledger_type)
 RETURNS TABLE(o_amount numeric, o_mode text, o_days integer, o_overridden boolean, o_reason text, o_period_id bigint)
 LANGUAGE plpgsql
 STABLE
AS $$
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
  v_class_id    BIGINT;
  v_rule        fee_period_class_rules%ROWTYPE;
  v_class       fee_class_charges%ROWTYPE;
  v_hostel      fee_hostel_calendars%ROWTYPE;
  v_hrule       fee_hostel_period_rules%ROWTYPE;
  v_own_hostel  BOOLEAN := false;
  v_n           INT;
BEGIN
  PERFORM app.assert_context();
  SELECT COALESCE(sum(net), 0), COALESCE(sum(paid), 0) INTO v_net, v_paid_now
    FROM fee_demands
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = p_ledger
     AND status IN ('pending', 'partial', 'paid');
  -- a hostel instalment under the hostel's own calendar takes the hostel's dates, rule and amounts
  IF p_ledger = 'hostel' THEN
    SELECT * INTO v_hostel FROM fee_hostel_calendars WHERE academic_year_id = p_academic_year_id AND mode = 'own';
    v_own_hostel := FOUND;
  END IF;
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id
   ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1;
  IF v_own_hostel THEN
    -- the instalment is known by the pupil's own hostel rows; its rule is that of the instalment's first month
    SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = 'hostel'
     ORDER BY fp.sequence LIMIT 1;
    IF v_anchor.id IS NOT NULL THEN
      v_n := CASE app.fee_hostel_plan(p_student_id, p_academic_year_id, app.fee_pay_plan(p_student_id, p_academic_year_id, v_class_id))
               WHEN 'quarterly' THEN 3 WHEN 'half_yearly' THEN 6 WHEN 'yearly' THEN 12 ELSE 1 END;
      SELECT fp.* INTO v_anchor FROM fee_periods fp
       WHERE fp.academic_year_id = p_academic_year_id AND fp.sequence = ((v_anchor.sequence - 1) / v_n) * v_n + 1;
      SELECT * INTO v_hrule FROM fee_hostel_period_rules WHERE period_id = v_anchor.id;
      v_anchor.late_fee_amount := v_hrule.late_fee_amount;
      v_anchor.late_slab_1_on := v_hrule.late_slab_1_on; v_anchor.late_slab_1_amount := v_hrule.late_slab_1_amount;
      v_anchor.late_slab_2_on := v_hrule.late_slab_2_on; v_anchor.late_slab_2_amount := v_hrule.late_slab_2_amount;
      v_anchor.late_slab_3_on := v_hrule.late_slab_3_on; v_anchor.late_slab_3_amount := v_hrule.late_slab_3_amount;
    END IF;
  -- a class with its own last dates: the instalment is known by the pupil's own rows, not the school calendar
  ELSIF v_class_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM fee_period_class_rules cr JOIN fee_periods fp ON fp.id = cr.period_id
        WHERE cr.class_id = v_class_id AND fp.academic_year_id = p_academic_year_id AND cr.due_on IS NOT NULL) THEN
    SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
     ORDER BY fp.sequence LIMIT 1;
  END IF;
  IF v_anchor.id IS NULL THEN
    SELECT fp.* INTO v_anchor FROM fee_periods fp
     WHERE fp.academic_year_id = p_academic_year_id AND fp.due_on = p_due_on ORDER BY fp.sequence LIMIT 1;
    IF v_anchor.id IS NULL THEN
      SELECT fp.* INTO v_anchor FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
       WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
       ORDER BY fp.sequence LIMIT 1;
    END IF;
  END IF;
  IF v_anchor.id IS NOT NULL AND v_class_id IS NOT NULL AND NOT v_own_hostel THEN
    SELECT * INTO v_rule FROM fee_period_class_rules WHERE period_id = v_anchor.id AND class_id = v_class_id;
    IF v_rule.late_fee_amount IS NOT NULL THEN
      v_anchor.late_fee_amount := v_rule.late_fee_amount;
      v_anchor.late_slab_1_on := v_rule.late_slab_1_on; v_anchor.late_slab_1_amount := v_rule.late_slab_1_amount;
      v_anchor.late_slab_2_on := v_rule.late_slab_2_on; v_anchor.late_slab_2_amount := v_rule.late_slab_2_amount;
      v_anchor.late_slab_3_on := v_rule.late_slab_3_on; v_anchor.late_slab_3_amount := v_rule.late_slab_3_amount;
    END IF;
  END IF;
  o_period_id := v_anchor.id;
  o_amount := 0; o_mode := 'none'; o_days := 0; o_overridden := false; o_reason := NULL;
  IF v_net <= 0 OR p_as_of <= p_due_on THEN RETURN NEXT; RETURN; END IF;

  SELECT COALESCE(sum(a.amount), 0) INTO v_paid_by_due
    FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
   WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger
     AND p.received_on <= p_due_on;
  IF v_net - v_paid_by_due <= 0 THEN RETURN NEXT; RETURN; END IF;   -- settled on time

  v_end := p_as_of;
  IF v_net - v_paid_now <= 0 THEN
    SELECT max(p.received_on) INTO v_settled_on
      FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
     WHERE d.student_id = p_student_id AND d.academic_year_id = p_academic_year_id AND d.due_on = p_due_on AND d.ledger = p_ledger;
    IF v_settled_on IS NOT NULL AND v_settled_on < v_end THEN v_end := v_settled_on; END IF;
  END IF;
  IF v_end <= p_due_on THEN RETURN NEXT; RETURN; END IF;
  o_days := v_end - p_due_on;

  IF v_anchor.id IS NOT NULL THEN
    SELECT * INTO v_ov FROM fee_late_fee_overrides
     WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND period_id = v_anchor.id AND ledger = p_ledger AND revoked_at IS NULL;
    IF FOUND THEN
      o_amount := v_ov.amount; o_mode := 'override'; o_overridden := true; o_reason := v_ov.reason;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v_own_hostel THEN
    IF v_hostel.late_mode = 'none' THEN RETURN NEXT; RETURN; END IF;
    v_mode := v_hostel.late_mode;
    v_class.late_per_day := v_hostel.late_per_day;
    v_class.late_max := v_hostel.late_max;
    v_rule.late_per_day := v_hrule.late_per_day;
  ELSE
    IF v_class_id IS NOT NULL THEN
      SELECT * INTO v_class FROM fee_class_charges WHERE academic_year_id = p_academic_year_id AND class_id = v_class_id;
    END IF;
    v_mode := COALESCE(v_class.late_mode, app.setting('fees.late_fee_mode') #>> '{}', 'daywise');
  END IF;
  IF v_mode = 'slab' THEN
    o_amount := CASE
      WHEN v_anchor.late_slab_3_on IS NOT NULL AND v_end > v_anchor.late_slab_3_on THEN COALESCE(v_anchor.late_slab_3_amount, 0)
      WHEN v_anchor.late_slab_2_on IS NOT NULL AND v_end > v_anchor.late_slab_2_on THEN COALESCE(v_anchor.late_slab_2_amount, 0)
      WHEN v_anchor.late_slab_1_on IS NOT NULL AND v_end > v_anchor.late_slab_1_on THEN COALESCE(v_anchor.late_slab_1_amount, 0)
      ELSE COALESCE(v_anchor.late_fee_amount, 0)
    END;
  ELSE
    v_mode := 'daywise';
    v_per_day := CASE WHEN v_own_hostel THEN COALESCE(v_rule.late_per_day, v_class.late_per_day, 0)
                      ELSE COALESCE(v_rule.late_per_day, v_class.late_per_day, (app.setting('fees.late_fee_per_day') #>> '{}')::numeric, 0) END;
    o_amount := round(o_days * v_per_day, 2);
    IF v_class.late_max > 0 THEN o_amount := LEAST(o_amount, v_class.late_max); END IF;   -- 0 or empty = no limit
  END IF;
  o_mode := v_mode;
  RETURN NEXT;
END
$$;
