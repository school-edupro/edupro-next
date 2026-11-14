-- 0375: payroll, phase E step 2 — people events (docs/design/86; PAYROLL_PEOPLE_SPEC.md). Decided 14 Nov 2026:
-- gratuity by the law (capped, tax-free to its limit, forfeiture by a checker with a reason); leave encashed at exit
-- from the leave module's balance of the types marked encashable on exit; every accepted exit hands payroll a draft
-- settlement, whose figures go to the exit's statement (employee_fnf) and are paid by the run of the month or a
-- full-and-final run; a negative balance is dues the school collects, with a letter; increments once a year by the
-- pay matrix's next cell (a % off the matrix), each with a numbered revision letter; a revision recomputes the locked
-- months through the engine and pays the difference as arrears.

-- ---- the heads a settlement pays and recovers (tax only where the law says) ------------------------------------------
CREATE OR REPLACE FUNCTION app.payroll_fnf_heads_seed(p_school BIGINT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO payroll_pay_heads (school_id, code, name, head_type, category, print_order)
  SELECT p_school, v.code, v.name, v.ty, v.cat, v.ord
    FROM (VALUES
      ('GRAT_EX', 'Gratuity (tax-free)', 'EARNING', 'MISC', 700),
      ('GRAT_TX', 'Gratuity (taxable)', 'EARNING', 'MISC', 701),
      ('ENCASH_EX', 'Leave encashment (tax-free)', 'EARNING', 'MISC', 702),
      ('ENCASH_TX', 'Leave encashment (taxable)', 'EARNING', 'MISC', 703),
      ('NOTICE_REC', 'Notice period recovery', 'DEDUCTION', 'MISC', 790),
      ('FNF_REC', 'Settlement recovery', 'DEDUCTION', 'MISC', 791)
    ) v(code, name, ty, cat, ord)
  ON CONFLICT DO NOTHING;
  INSERT INTO payroll_pay_head_versions (school_id, pay_head_id, calc_type, is_taxable, pf_wage, esi_wage, pt_wage,
                                         prorate_on_lop, rounding, effective_from, status, change_reason)
  SELECT p_school, h.id, 'MANUAL', h.code IN ('GRAT_TX', 'ENCASH_TX'), false, false, false, false, 'NEAREST_1',
         '2025-04-01', 'active', 'Default: a full-and-final settlement head'
    FROM payroll_pay_heads h
   WHERE h.school_id = p_school AND h.code IN ('GRAT_EX', 'GRAT_TX', 'ENCASH_EX', 'ENCASH_TX', 'NOTICE_REC', 'FNF_REC')
     AND NOT EXISTS (SELECT 1 FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id);
END $$;
DO $$
DECLARE s BIGINT;
BEGIN
  FOR s IN SELECT DISTINCT school_id FROM payroll_pay_heads LOOP
    PERFORM set_config('app.school_id', s::text, true);
    PERFORM app.payroll_fnf_heads_seed(s);
  END LOOP;
END $$;

-- a full-and-final run: a supplementary run for the leaver, its payslip titled so
ALTER TABLE payroll_runs ADD COLUMN purpose TEXT CHECK (purpose IS NULL OR purpose IN ('FNF'));

-- ---- the rules (the school's settings) -----------------------------------------------------------------------------
ALTER TABLE payroll_settings
  -- the month of the yearly increment (each employee's profile may name another) and the service it needs first
  ADD COLUMN increment_month       INT NOT NULL DEFAULT 7 CHECK (increment_month BETWEEN 1 AND 12),
  ADD COLUMN increment_min_months  INT NOT NULL DEFAULT 6 CHECK (increment_min_months BETWEEN 0 AND 24),
  -- for staff off the pay matrix
  ADD COLUMN increment_pct         NUMERIC(5, 2) NOT NULL DEFAULT 3 CHECK (increment_pct > 0 AND increment_pct <= 50),
  ADD COLUMN gratuity_cap          NUMERIC(14, 2) NOT NULL DEFAULT 2000000 CHECK (gratuity_cap > 0),
  ADD COLUMN gratuity_tax_free_cap NUMERIC(14, 2) NOT NULL DEFAULT 2000000 CHECK (gratuity_tax_free_cap >= 0),
  ADD COLUMN encash_tax_free_cap   NUMERIC(14, 2) NOT NULL DEFAULT 2500000 CHECK (encash_tax_free_cap >= 0),
  ADD COLUMN encash_max_days       NUMERIC(7, 2) NOT NULL DEFAULT 300 CHECK (encash_max_days >= 0);
ALTER TABLE payroll_profiles ADD COLUMN last_increment_on DATE;

-- ---- revisions, their arrears and letters ---------------------------------------------------------------------------
CREATE TABLE payroll_revisions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  -- RATE: a registry rate (DA); FORMULA: a head's formula; INCREMENT: the yearly increment
  kind           TEXT NOT NULL CHECK (kind IN ('RATE', 'FORMULA', 'INCREMENT')),
  -- RATE { rateCode, newValue }; FORMULA { headCode, formula }; INCREMENT { month, employees: [...] }
  detail         JSONB NOT NULL DEFAULT '{}',
  effective_from DATE NOT NULL,
  notified_on    DATE,
  reason         TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  status         TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPLIED', 'CANCELLED')),
  -- what applying found: arrears by employee and head (the simulation kept)
  arrears_total  NUMERIC(14, 2),
  arrears_count  INT,
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by     BIGINT REFERENCES users(id),
  applied_at     TIMESTAMPTZ,
  cancelled_by   BIGINT REFERENCES users(id),
  cancelled_at   TIMESTAMPTZ
);
ALTER TABLE payroll_arrears ADD COLUMN revision_id BIGINT REFERENCES payroll_revisions(id);

CREATE TABLE payroll_revision_letters (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  revision_id   BIGINT NOT NULL REFERENCES payroll_revisions(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  -- numbered by school and year: PR/2026/0001
  letter_no     TEXT NOT NULL,
  -- the pay before and after (each head's month), the level and cell
  before        JSONB NOT NULL DEFAULT '{}',
  after         JSONB NOT NULL DEFAULT '{}',
  effective_from DATE NOT NULL,
  issued_by     BIGINT REFERENCES users(id),
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, letter_no),
  UNIQUE (revision_id, employee_id)
);

-- ---- the settlement of a leaver ------------------------------------------------------------------------------------
CREATE TABLE payroll_settlements (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  employee_id        BIGINT NOT NULL REFERENCES employees(id),
  exit_id            BIGINT UNIQUE REFERENCES employee_exits(id) ON DELETE SET NULL,
  last_day           DATE NOT NULL,
  -- RESIGNATION, RETIREMENT, TERMINATION, DISMISSAL, DEATH, DISABLEMENT, END_OF_CONTRACT, OTHER
  reason             TEXT NOT NULL,
  fixed_term         BOOLEAN NOT NULL DEFAULT false,
  notice_days_short  NUMERIC(6, 2) NOT NULL DEFAULT 0 CHECK (notice_days_short >= 0),
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'COMPUTED', 'APPROVED', 'STAGED', 'DUES', 'SETTLED', 'CANCELLED')),
  -- the last month's basic + DA (or the labour-code wages) the figures stand on
  basis              NUMERIC(14, 2),
  gratuity           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gratuity_tax_free  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- a dismissal's forfeiture (a checker, with a reason)
  gratuity_forfeited NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (gratuity_forfeited >= 0),
  forfeit_reason     TEXT CHECK (forfeit_reason IS NULL OR length(forfeit_reason) BETWEEN 10 AND 300),
  encash_days        NUMERIC(7, 2) NOT NULL DEFAULT 0,
  encash_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  encash_tax_free    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- payroll's change to the leave balance's days, with its reason
  encash_adjust_reason TEXT CHECK (encash_adjust_reason IS NULL OR length(encash_adjust_reason) BETWEEN 3 AND 300),
  notice_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  loans              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  other_payable      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  other_recovery     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- payable when above nothing; dues to collect when below
  net                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- the working: service, years, leave by type, loans, nominees' shares, pending salary (an estimate)
  detail             JSONB NOT NULL DEFAULT '{}',
  -- the month whose run pays it
  pay_month          DATE,
  dues_letter_no     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_by        BIGINT REFERENCES users(id),
  computed_at        TIMESTAMPTZ,
  approved_by        BIGINT REFERENCES users(id),
  approved_at        TIMESTAMPTZ,
  staged_by          BIGINT REFERENCES users(id),
  staged_at          TIMESTAMPTZ,
  cancelled_by       BIGINT REFERENCES users(id),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 10 AND 300),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (gratuity_forfeited = 0 OR forfeit_reason IS NOT NULL)
);
CREATE INDEX payroll_settlements_employee ON payroll_settlements (employee_id);

-- an accepted exit hands payroll its draft settlement (the exit's last day, type and notice short)
CREATE OR REPLACE FUNCTION app.payroll_settlement_from_exit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_last DATE; v_short NUMERIC;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')
     AND EXISTS (SELECT 1 FROM payroll_settings WHERE school_id = NEW.school_id) THEN
    v_last := COALESCE(NEW.accepted_last_day, NEW.proposed_last_day);
    v_short := CASE WHEN NEW.notice_waived OR NEW.notice_days <= 0 THEN 0
                    ELSE GREATEST(0, NEW.expected_last_day - v_last) END;
    INSERT INTO payroll_settlements (school_id, employee_id, exit_id, last_day, reason, notice_days_short)
    VALUES (NEW.school_id, NEW.employee_id, NEW.id, v_last, upper(NEW.exit_type), v_short)
    ON CONFLICT (exit_id) DO UPDATE SET last_day = EXCLUDED.last_day, notice_days_short = EXCLUDED.notice_days_short,
      updated_at = now()
      WHERE payroll_settlements.status = 'DRAFT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_exits_payroll_settlement AFTER INSERT OR UPDATE OF status, accepted_last_day ON employee_exits
  FOR EACH ROW EXECUTE FUNCTION app.payroll_settlement_from_exit();
-- exits already accepted and not yet paid out get theirs now
INSERT INTO payroll_settlements (school_id, employee_id, exit_id, last_day, reason, notice_days_short)
SELECT x.school_id, x.employee_id, x.id, COALESCE(x.accepted_last_day, x.proposed_last_day), upper(x.exit_type),
       CASE WHEN x.notice_waived OR x.notice_days <= 0 THEN 0
            ELSE GREATEST(0, x.expected_last_day - COALESCE(x.accepted_last_day, x.proposed_last_day)) END
  FROM employee_exits x
 WHERE x.status = 'approved'
   AND EXISTS (SELECT 1 FROM payroll_settings s WHERE s.school_id = x.school_id)
   AND NOT EXISTS (SELECT 1 FROM employee_fnf f WHERE f.exit_id = x.id AND f.status = 'paid')
ON CONFLICT (exit_id) DO NOTHING;

-- ---- row-level security and the audit trail --------------------------------------------------------------------
CALL app.apply_tenant_rls('payroll_revisions');
CALL app.apply_tenant_rls('payroll_revision_letters');
CALL app.apply_tenant_rls('payroll_settlements');
CREATE TRIGGER payroll_revisions_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_revisions
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_revision_letters_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_revision_letters
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_settlements_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_settlements
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
