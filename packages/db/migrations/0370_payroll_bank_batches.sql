-- 0370: payroll, phase C step 1 — bank batches (docs/design/86; PAYROLL_PAYMENT_SPEC.md §2). A checker makes a bank
-- file from an approved (provisional) or locked run, one bank a file; it is uploaded and confirmed with the bank's
-- UTR only after the run is locked, and confirming marks its records paid. Decided 14 Nov 2026: each of the school's
-- bank accounts has its own file layout, set once from that bank's sample file (no layout typed from memory).
-- Fixed against the legacy: a batch keeps its own copy of each line's account and of the layout, so a re-download
-- is identical; one live line per record (two files could carry the same person); a bounced line re-issues to the
-- employee's current account; a line returned after the confirm takes the record back from paid to held.

-- ---- the school's accounts salaries are paid from: one a bank (the IFSC's first four letters) -----------------------
CREATE TABLE payroll_bank_accounts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  bank_code     TEXT NOT NULL CHECK (bank_code ~ '^[A-Z]{4}$'),
  bank_name     TEXT NOT NULL CHECK (length(bank_name) BETWEEN 2 AND 80),
  branch        TEXT CHECK (branch IS NULL OR length(branch) <= 120),
  -- the school's own account (debited for the salaries); not an employee's
  account_no    TEXT NOT NULL CHECK (account_no ~ '^[0-9A-Za-z]{6,20}$'),
  file_format   TEXT NOT NULL DEFAULT 'GENERIC_CSV'
                CHECK (file_format IN ('GENERIC_CSV', 'CUSTOM_CSV', 'BANK_LETTER')),
  -- CUSTOM_CSV: { columns: [{ field | value, header?, format? }], header: bool, delimiter: ',', extension: 'csv' }
  layout        JSONB NOT NULL DEFAULT '{}',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, bank_code)
);

-- ---- a bank file and its lines -----------------------------------------------------------------------------------
CREATE TABLE payroll_bank_batches (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  run_id           BIGINT NOT NULL REFERENCES payroll_runs(id),
  seq              INT NOT NULL,
  -- NULL: every bank together
  bank_code        TEXT CHECK (bank_code IS NULL OR bank_code ~ '^[A-Z]{4}$'),
  bank_account_id  BIGINT REFERENCES payroll_bank_accounts(id),
  -- what the file was made with, kept so a re-download is identical
  file_format      TEXT NOT NULL CHECK (file_format IN ('GENERIC_CSV', 'CUSTOM_CSV', 'BANK_LETTER')),
  layout           JSONB NOT NULL DEFAULT '{}',
  debit_bank_name  TEXT,
  debit_branch     TEXT,
  debit_account    TEXT,
  value_date       DATE,
  -- made while the run was only approved (its figures were not yet final)
  provisional      BOOLEAN NOT NULL DEFAULT false,
  status           TEXT NOT NULL DEFAULT 'GENERATED'
                   CHECK (status IN ('GENERATED', 'UPLOADED', 'CONFIRMED', 'CANCELLED')),
  txn_count        INT NOT NULL CHECK (txn_count > 0),
  total            NUMERIC(14, 2) NOT NULL CHECK (total > 0),
  utr              TEXT CHECK (utr IS NULL OR length(utr) BETWEEN 4 AND 60),
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by      BIGINT REFERENCES users(id),
  uploaded_at      TIMESTAMPTZ,
  confirmed_by     BIGINT REFERENCES users(id),
  confirmed_at     TIMESTAMPTZ,
  cancelled_by     BIGINT REFERENCES users(id),
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 10 AND 300),
  UNIQUE (run_id, seq),
  CHECK (status <> 'CONFIRMED' OR utr IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE INDEX payroll_bank_batches_run ON payroll_bank_batches (run_id);

CREATE TABLE payroll_bank_batch_lines (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  batch_id        BIGINT NOT NULL REFERENCES payroll_bank_batches(id),
  line_no         INT NOT NULL,
  record_id       BIGINT NOT NULL REFERENCES payroll_records(id),
  -- the payee as sent (encrypted account, as on the employee record)
  employee_code   TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  bank_ifsc       TEXT,
  account_enc     TEXT NOT NULL,
  account_masked  TEXT,
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  -- SENT; REJECTED (the bank returned it); CANCELLED (its batch was cancelled before upload)
  status          TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'REJECTED', 'CANCELLED')),
  reject_reason   TEXT CHECK (reject_reason IS NULL OR length(reject_reason) BETWEEN 3 AND 200),
  rejected_by     BIGINT REFERENCES users(id),
  rejected_at     TIMESTAMPTZ,
  UNIQUE (batch_id, line_no),
  CHECK (status <> 'REJECTED' OR reject_reason IS NOT NULL)
);
-- one live line a record: two files never carry the same payment
CREATE UNIQUE INDEX payroll_bank_lines_one_sent ON payroll_bank_batch_lines (record_id) WHERE status = 'SENT';

-- ---- how a record was paid -----------------------------------------------------------------------------------------
ALTER TABLE payroll_records
  ADD COLUMN paid_at      TIMESTAMPTZ,
  ADD COLUMN paid_by      BIGINT REFERENCES users(id),
  -- the bank's UTR, or the voucher / cheque number of a cash or cheque payment
  ADD COLUMN payment_ref  TEXT CHECK (payment_ref IS NULL OR length(payment_ref) BETWEEN 3 AND 60);

-- ---- row-level security and the audit trail --------------------------------------------------------------------
CALL app.apply_tenant_rls('payroll_bank_accounts');
CALL app.apply_tenant_rls('payroll_bank_batches');
CALL app.apply_tenant_rls('payroll_bank_batch_lines');
CREATE TRIGGER payroll_bank_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_bank_batches_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_bank_batches
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER payroll_bank_batch_lines_audit AFTER UPDATE ON payroll_bank_batch_lines
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
DROP TRIGGER payroll_records_audit ON payroll_records;
CREATE TRIGGER payroll_records_audit AFTER UPDATE OF status, held_reason, payment_ref ON payroll_records
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
