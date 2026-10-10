-- 0115: one rule for how often a pupil pays. The older per-pupil "pay in N instalments" number
-- (student_fee_profiles.instalments_override, set without approval and dated by the school calendar
-- only) is read as a pay plan: 12 = monthly, 4 = quarterly, 2 = half-yearly, 1 = yearly. Its own
-- re-dating step now runs only for the two counts the pay plan does not have (3 and 6), so it no longer
-- overwrites the class-calendar dates the pay plan gives.
CREATE OR REPLACE FUNCTION app.fee_pay_plan(p_student_id bigint, p_academic_year_id bigint, p_class_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(pay_plan, CASE instalments_override WHEN 12 THEN 'monthly' WHEN 4 THEN 'quarterly' WHEN 2 THEN 'half_yearly' WHEN 1 THEN 'yearly' END)
       FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id),
    (SELECT pay_plan FROM fee_class_charges WHERE academic_year_id = p_academic_year_id AND class_id = p_class_id),
    NULLIF(app.setting('fees.pay_plan') #>> '{}', ''),
    'monthly')
$$;

CREATE OR REPLACE FUNCTION app.apply_instalment_override(p_student_id bigint, p_academic_year_id bigint, p_run_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $$
DECLARE
  v_n INT;
  v_plan TEXT;
  v_moved INT := 0;
  d RECORD;
  a fee_periods%ROWTYPE;
BEGIN
  SELECT instalments_override, pay_plan INTO v_n, v_plan FROM student_fee_profiles WHERE student_id = p_student_id AND academic_year_id = p_academic_year_id;
  -- a pay plan, or a count the pay plan covers, is already dated by the generator
  IF v_n IS NULL OR v_plan IS NOT NULL OR v_n IN (1, 2, 4, 12) THEN RETURN 0; END IF;
  FOR d IN
    SELECT fd.id, fp.sequence FROM fee_demands fd JOIN fee_periods fp ON fp.id = fd.period_id
     WHERE fd.student_id = p_student_id AND fd.academic_year_id = p_academic_year_id AND fd.run_id = p_run_id
  LOOP
    a := app.instalment_anchor(p_academic_year_id, d.sequence, v_n);
    IF a.id IS NOT NULL THEN
      UPDATE fee_demands SET due_on = a.due_on WHERE id = d.id AND due_on <> a.due_on;
      IF FOUND THEN v_moved := v_moved + 1; END IF;
    END IF;
  END LOOP;
  RETURN v_moved;
END
$$;
