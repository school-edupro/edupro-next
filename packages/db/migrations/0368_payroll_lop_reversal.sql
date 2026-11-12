-- 0368: payroll, phase B step 4 — loss-of-pay reversal (docs/design/86; the legacy payroll_lopr_lib.php, read into
-- PAYROLL_RUN_SPEC.md §7.13). Days of a locked month given back (or charged) after the month is paid: a day's value
-- from that month's frozen record — each prorated structure line's monthly amount ÷ the month's days, split into
-- the PF part (Basic + DA) and the rest — times the days; approved by a checker who did not stage it, it becomes two
-- arrears (LOP_REV with PF, LOP_REVO without) paid by the next run that processes the employee. Fixed from the
-- legacy: a cancelled reversal no longer blocks its month for ever; a maker cannot cancel one a checker approved.

CREATE TABLE payroll_lop_reversals (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  employee_id       BIGINT NOT NULL REFERENCES employees(id),
  -- the month corrected
  source_month      DATE NOT NULL CHECK (extract(day FROM source_month) = 1),
  source_record_id  BIGINT NOT NULL REFERENCES payroll_records(id),
  -- + days given back, − days charged
  days              NUMERIC(5, 2) NOT NULL CHECK (days <> 0),
  amount_pf         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount_other      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 200),
  status            TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'CANCELLED')),
  approved_by       BIGINT REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  arrear_pf_id      BIGINT REFERENCES payroll_arrears(id),
  arrear_other_id   BIGINT REFERENCES payroll_arrears(id),
  cancelled_reason  TEXT CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 200),
  created_by        BIGINT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        BIGINT REFERENCES users(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one live reversal an employee and month (a cancelled one does not count)
CREATE UNIQUE INDEX payroll_lop_reversals_live ON payroll_lop_reversals (employee_id, source_month) WHERE status <> 'CANCELLED';
CREATE INDEX payroll_lop_reversals_status ON payroll_lop_reversals (school_id, status);

CALL app.apply_tenant_rls('payroll_lop_reversals');
CREATE TRIGGER payroll_lop_reversals_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_lop_reversals
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
