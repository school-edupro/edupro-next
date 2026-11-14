-- 0371: payroll, phase C step 2 — PF, ESI, profession tax, LWF (docs/design/86; PAYROLL_PAYMENT_SPEC.md §3–6). The
-- registers and the challan figures are read from the locked runs' statutory rows; nothing new is stored for them.
-- Decided 14 Nov 2026: the PF ECR is made for a month (every locked run of it together, per member); once the school
-- files it, the file is kept here with its members, and a later run of the month gives a supplementary file of only
-- the members not yet filed (EPFO's regular and supplementary returns).

-- arrears in the ECR: folded into the month's wages (the legacy default), or a separate arrear file
ALTER TABLE payroll_settings
  ADD COLUMN ecr_arrear_mode TEXT NOT NULL DEFAULT 'FOLDED' CHECK (ecr_arrear_mode IN ('FOLDED', 'SEPARATE'));

CREATE TABLE payroll_returns (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  kind        TEXT NOT NULL CHECK (kind IN ('ECR')),
  month       DATE NOT NULL,
  -- 1: the month's regular return; 2 and on: supplementary returns of members not yet filed
  seq         INT NOT NULL CHECK (seq >= 1),
  members     INT NOT NULL CHECK (members > 0),
  -- the file's totals as filed (wages and each contribution, whole rupees)
  totals      JSONB NOT NULL DEFAULT '{}',
  -- the return's acknowledgement (TRRN or the portal's return number) and the day it was filed
  ack_no      TEXT NOT NULL CHECK (length(ack_no) BETWEEN 4 AND 60),
  filed_on    DATE NOT NULL,
  filed_by    BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, kind, month, seq)
);

CREATE TABLE payroll_return_members (
  return_id    BIGINT NOT NULL REFERENCES payroll_returns(id) ON DELETE CASCADE,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  uan          TEXT,
  -- the member's line as filed, and the payroll records it was made from
  line         JSONB NOT NULL,
  record_ids   BIGINT[] NOT NULL,
  PRIMARY KEY (return_id, employee_id)
);

CALL app.apply_tenant_rls('payroll_returns');
CALL app.apply_tenant_rls('payroll_return_members');
CREATE TRIGGER payroll_returns_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_returns
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
