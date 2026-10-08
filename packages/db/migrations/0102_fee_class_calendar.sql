-- 0102: the class-wise fee calendar, as the accounts office keeps it: for every class and month the
-- quarter, the start and last dates, the late fee with its three later dates, the challan date, the
-- bounce charge, and whether parents see the instalment (show) and may pay it online (fee pay).
-- A class also chooses how its late fee works: per day (with an optional maximum) or by slabs.
ALTER TABLE fee_period_class_rules
  ADD COLUMN instalment    INT CHECK (instalment IS NULL OR instalment BETWEEN 1 AND 12),   -- the class's own quarter number
  ADD COLUMN start_on      DATE,                       -- parents see the instalment from this date
  ADD COLUMN challan_on    DATE,                       -- bill date printed on the fee bill
  ADD COLUMN bounce_charge NUMERIC(12, 2) CHECK (bounce_charge IS NULL OR bounce_charge >= 0),
  ADD COLUMN fee_pay       BOOLEAN NOT NULL DEFAULT true,   -- parents may pay it online
  ADD COLUMN show          BOOLEAN NOT NULL DEFAULT true;   -- parents see it at all

ALTER TABLE fee_class_charges
  ALTER COLUMN bounce_charge DROP NOT NULL,
  ADD COLUMN late_mode    TEXT CHECK (late_mode IS NULL OR late_mode IN ('daywise', 'slab')),   -- NULL = the school's
  ADD COLUMN late_per_day NUMERIC(12, 2) CHECK (late_per_day IS NULL OR late_per_day >= 0),
  ADD COLUMN late_max     NUMERIC(12, 2) CHECK (late_max IS NULL OR late_max >= 0);              -- per instalment, day-wise

-- app.late_fee: as 0098, with the class's own way of charging and the maximum of the day-wise fine
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
BEGIN
  PERFORM app.assert_context();
  SELECT COALESCE(sum(net), 0), COALESCE(sum(paid), 0) INTO v_net, v_paid_now
    FROM fee_demands
   WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id AND due_on = p_due_on AND ledger = p_ledger
     AND status IN ('pending', 'partial', 'paid');
  SELECT cs.class_id INTO v_class_id
    FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
   WHERE e.student_id = p_student_id AND e.academic_year_id = p_academic_year_id
   ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1;
  -- a class with its own last dates: the instalment is known by the pupil's own rows, not the school calendar
  IF v_class_id IS NOT NULL AND EXISTS (
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
  IF v_anchor.id IS NOT NULL AND v_class_id IS NOT NULL THEN
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

  IF v_class_id IS NOT NULL THEN
    SELECT * INTO v_class FROM fee_class_charges WHERE academic_year_id = p_academic_year_id AND class_id = v_class_id;
  END IF;
  v_mode := COALESCE(v_class.late_mode, app.setting('fees.late_fee_mode') #>> '{}', 'daywise');
  IF v_mode = 'slab' THEN
    o_amount := CASE
      WHEN v_anchor.late_slab_3_on IS NOT NULL AND v_end > v_anchor.late_slab_3_on THEN COALESCE(v_anchor.late_slab_3_amount, 0)
      WHEN v_anchor.late_slab_2_on IS NOT NULL AND v_end > v_anchor.late_slab_2_on THEN COALESCE(v_anchor.late_slab_2_amount, 0)
      WHEN v_anchor.late_slab_1_on IS NOT NULL AND v_end > v_anchor.late_slab_1_on THEN COALESCE(v_anchor.late_slab_1_amount, 0)
      ELSE COALESCE(v_anchor.late_fee_amount, 0)
    END;
  ELSE
    v_mode := 'daywise';
    v_per_day := COALESCE(v_rule.late_per_day, v_class.late_per_day, (app.setting('fees.late_fee_per_day') #>> '{}')::numeric, 0);
    o_amount := round(o_days * v_per_day, 2);
    IF v_class.late_max IS NOT NULL THEN o_amount := LEAST(o_amount, v_class.late_max); END IF;
  END IF;
  o_mode := v_mode;
  RETURN NEXT;
END
$$;
