-- 0131: misc fees announced to pupils (a trip, an activity, an exam form): a fee with its head, amount,
-- last date, mandatory or not and, where it applies, a number of seats; the pupils it is offered to, each
-- with their own amount and last date; and the requests that change any of it or take a receipt back.
-- Everything goes through Fee setup -> Approval levels. Collection stays on the misc ledger: a misc
-- receipt now says which announced fee of which pupil it paid.
CREATE TABLE misc_fees (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  academic_year_id     BIGINT NOT NULL REFERENCES academic_years(id),
  head_id              BIGINT NOT NULL REFERENCES fee_heads(id),
  title                TEXT NOT NULL,
  amount               NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  last_date            DATE NOT NULL,
  remark               TEXT,
  mandatory            BOOLEAN NOT NULL DEFAULT true,
  seats                INT CHECK (seats IS NULL OR seats > 0),   -- first come, first served by payment
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'announced', 'rejected', 'closed')),
  requested_by         BIGINT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  announced_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX misc_fees_year ON misc_fees (school_id, academic_year_id, status);
CALL app.apply_tenant_rls('misc_fees');
CREATE TRIGGER misc_fees_audit AFTER INSERT OR UPDATE OR DELETE ON misc_fees FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE misc_fee_students (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  misc_fee_id  BIGINT NOT NULL REFERENCES misc_fees(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id),
  amount       NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  last_date    DATE,                       -- the pupil's own last date; NULL = the fee's
  paid         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid >= 0),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  paid_at      TIMESTAMPTZ,                -- when the seat was taken
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (misc_fee_id, student_id)
);
CREATE INDEX misc_fee_students_student ON misc_fee_students (student_id);
CALL app.apply_tenant_rls('misc_fee_students');
CREATE TRIGGER misc_fee_students_audit AFTER INSERT OR UPDATE OR DELETE ON misc_fee_students FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

ALTER TABLE misc_receipts
  ADD COLUMN misc_fee_student_id BIGINT REFERENCES misc_fee_students(id),
  ADD COLUMN refunded NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (refunded >= 0),
  ADD COLUMN reversed_at TIMESTAMPTZ,
  ADD COLUMN reversal_reason TEXT;
ALTER TABLE misc_receipts DROP CONSTRAINT misc_receipts_status_check;
ALTER TABLE misc_receipts ADD CONSTRAINT misc_receipts_status_check CHECK (status IN ('posted', 'reversed', 'bounced'));
CREATE INDEX misc_receipts_fee_line ON misc_receipts (misc_fee_student_id) WHERE misc_fee_student_id IS NOT NULL;

-- one table for every request about a misc fee: its announcement, a later change, a receipt taken back
CREATE TABLE misc_fee_requests (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  misc_fee_id          BIGINT REFERENCES misc_fees(id) ON DELETE CASCADE,
  line_id              BIGINT REFERENCES misc_fee_students(id) ON DELETE CASCADE,
  receipt_id           BIGINT REFERENCES misc_receipts(id),
  kind                 TEXT NOT NULL CHECK (kind IN ('announce', 'extend', 'pupil_change', 'add_pupils', 'close',
                                                     'receipt_cancel', 'receipt_bounce', 'receipt_refund')),
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason               TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  requested_by         BIGINT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by           BIGINT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  voucher_no           TEXT,              -- a refund's voucher
  result               JSONB
);
CREATE INDEX misc_fee_requests_fee ON misc_fee_requests (misc_fee_id);
CREATE INDEX misc_fee_requests_open ON misc_fee_requests (school_id, status) WHERE status = 'pending';
CALL app.apply_tenant_rls('misc_fee_requests');
CREATE TRIGGER misc_fee_requests_audit AFTER INSERT OR UPDATE OR DELETE ON misc_fee_requests FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
