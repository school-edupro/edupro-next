-- 0372: payroll, phase C step 3 — the compliance calendar and the salary voucher (docs/design/86;
-- PAYROLL_PAYMENT_SPEC.md §7–8). The calendar holds each financial year's statutory dues (PF ECR, ESI, TDS deposit,
-- profession tax, LWF, the quarterly TDS return); a checker marks one done with its challan or acknowledgement number,
-- date and amount, which is set against the amount payroll worked out. Fixed against the legacy: a blank
-- acknowledgement and a second "done" over the first are refused; the payroll admin can reopen one, with a reason.
-- Decided 14 Nov 2026: one salary voucher (JV) a month, its ledger names from these settings.

CREATE TABLE payroll_compliance (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  -- the financial year's first year (2026 = 2026-27)
  fy               INT NOT NULL CHECK (fy BETWEEN 2000 AND 2100),
  item             TEXT NOT NULL CHECK (item IN ('ECR', 'ESI', 'TDS', 'PT', 'LWF', 'TDS_RETURN')),
  -- the pay month it is for (NULL for a quarter's return or a half-year's LWF: see period)
  month            DATE,
  period           TEXT NOT NULL CHECK (length(period) BETWEEN 2 AND 20),
  due_on           DATE NOT NULL,
  description      TEXT NOT NULL CHECK (length(description) <= 200),
  done_at          TIMESTAMPTZ,
  done_by          BIGINT REFERENCES users(id),
  ack_no           TEXT CHECK (ack_no IS NULL OR length(ack_no) BETWEEN 3 AND 60),
  ack_date         DATE,
  amount_paid      NUMERIC(14, 2) CHECK (amount_paid IS NULL OR amount_paid >= 0),
  -- what payroll worked out when it was marked done
  amount_computed  NUMERIC(14, 2),
  reopen_reason    TEXT CHECK (reopen_reason IS NULL OR length(reopen_reason) <= 300),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, fy, item, period),
  CHECK (done_at IS NULL OR (ack_no IS NOT NULL AND ack_date IS NOT NULL))
);
CREATE INDEX payroll_compliance_due ON payroll_compliance (school_id, due_on) WHERE done_at IS NULL;

-- the salary voucher's ledger names: { salary: { "<staff type>": ledger }, heads: { "<HEAD>": ledger },
-- employer: { "PF" | "ESI" | "NPS" | "LWF": ledger }, payable: { "PF" | "ESI" | "NPS" | "LWF": ledger }, net: ledger }
ALTER TABLE payroll_settings ADD COLUMN jv_ledgers JSONB NOT NULL DEFAULT '{}';

CALL app.apply_tenant_rls('payroll_compliance');
CREATE TRIGGER payroll_compliance_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_compliance
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
