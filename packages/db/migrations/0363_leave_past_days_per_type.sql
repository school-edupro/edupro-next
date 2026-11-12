-- 0363: past days, set by the admin (docs/design/85, "As built — past days per leave type").
-- Leave: each leave type says how far back an employee may apply for it — the school's setting, none, up
-- to a number of days, or any day of a month still open (a month locked for payroll never is). The office's
-- own entry for an employee is never limited. Until the admin allows it, past days are not allowed: the
-- school's setting now starts at 0 (none), and the schools that had it open (empty) are closed.
-- Attendance corrections: an employee may ask for a day up to a number of days back (7 to start, as the
-- old module's analysis asked; empty: any day of an open month); the office corrects any day.
ALTER TABLE staff_leave_types
  ADD COLUMN backdate TEXT NOT NULL DEFAULT 'school' CHECK (backdate IN ('school', 'none', 'days', 'any')),
  ADD COLUMN backdate_days INT CHECK (backdate_days IS NULL OR backdate_days BETWEEN 1 AND 366);

ALTER TABLE staff_leave_settings
  ALTER COLUMN backdate_days SET DEFAULT 0,
  ADD COLUMN correction_backdate_days INT DEFAULT 7
    CHECK (correction_backdate_days IS NULL OR correction_backdate_days BETWEEN 0 AND 366);
UPDATE staff_leave_settings SET backdate_days = 0 WHERE backdate_days IS NULL;

-- the rules across columns, told plainly (the grid and the uploads show the message): as 0343, and the
-- past days — "days" needs Days back; the other choices keep none
CREATE OR REPLACE FUNCTION app.staff_leave_type_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paid AND NEW.loss_of_pay THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a loss-of-pay type is not paid: set Paid to no';
  END IF;
  IF NEW.loss_of_pay THEN
    -- loss of pay keeps no balance, carries nothing and has no pay %
    NEW.keeps_balance := false;
    NEW.half_day := true;
    IF NEW.carry_forward OR NEW.carry_cap IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a loss-of-pay type carries nothing forward';
    END IF;
    IF NEW.pay_percent IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a loss-of-pay type has no pay %';
    END IF;
  ELSIF NOT NEW.keeps_balance AND NEW.deduct_order IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'a type without a balance cannot be taken automatically: clear the deduction order';
  END IF;
  IF NEW.carry_cap IS NOT NULL AND NOT NEW.carry_forward THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a carry-forward cap needs Carry forward = yes';
  END IF;
  IF NEW.min_days IS NOT NULL AND NEW.max_days IS NOT NULL AND NEW.max_days < NEW.min_days THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'the most days in one application is less than the fewest';
  END IF;
  IF NOT (NEW.for_male OR NEW.for_female) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'a leave type is for men, women or both';
  END IF;
  IF NEW.backdate = 'days' AND NEW.backdate_days IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'Past days "days" needs Days back (1 to 366)';
  END IF;
  IF NEW.backdate <> 'days' THEN
    NEW.backdate_days := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
