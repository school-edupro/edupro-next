-- 0100: the bank deposit slip. The fee in-charge picks the cheques and drafts in hand, names the school
-- bank account and the date, and prints the slip. A cheque sits on one slip only; a cancelled slip frees
-- its cheques again.
CREATE TABLE fee_deposit_slips (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),
  slip_no          INT NOT NULL,
  deposit_on       DATE NOT NULL,
  bank_account_id  BIGINT NOT NULL REFERENCES school_bank_accounts(id),
  instruments      INT NOT NULL DEFAULT 0,
  total            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remarks          TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by     BIGINT,
  cancelled_at     TIMESTAMPTZ,
  UNIQUE (school_id, slip_no)
);
CALL app.apply_tenant_rls('fee_deposit_slips');
CREATE TRIGGER fee_deposit_slips_audit AFTER INSERT OR UPDATE OR DELETE ON fee_deposit_slips FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

ALTER TABLE fee_payments  ADD COLUMN deposit_slip_id BIGINT REFERENCES fee_deposit_slips(id);
ALTER TABLE misc_receipts ADD COLUMN deposit_slip_id BIGINT REFERENCES fee_deposit_slips(id);
CREATE INDEX fee_payments_by_slip ON fee_payments (deposit_slip_id) WHERE deposit_slip_id IS NOT NULL;
CREATE INDEX misc_receipts_by_slip ON misc_receipts (deposit_slip_id) WHERE deposit_slip_id IS NOT NULL;

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('fees.deposit_slip.manage', 'fees', 'Make and cancel bank deposit slips for cheques and drafts', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'fees.deposit_slip.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'accountant')
ON CONFLICT DO NOTHING;
