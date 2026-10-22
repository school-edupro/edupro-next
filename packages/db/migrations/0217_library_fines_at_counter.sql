-- 0217: late fines paid at the fees counter (docs/design/36-library.md, "Library reports", part 1). A
-- returned book's late fine is announced at once as a misc fee on the borrower, as lost and damaged books
-- are (library_charges kind 'late'); the library takes no fine money. A fine waived at the desk is kept
-- with who, when and why; a reduction once announced goes through the fees office (misc fee change).
DO $$
DECLARE v TEXT;
BEGIN
  -- one charge of each kind on a loan (a damaged book returned late has both)
  SELECT conname INTO v FROM pg_constraint
   WHERE conrelid = 'library_charges'::regclass AND contype = 'u';
  EXECUTE format('ALTER TABLE library_charges DROP CONSTRAINT %I', v);
  SELECT conname INTO v FROM pg_constraint
   WHERE conrelid = 'library_charges'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%';
  EXECUTE format('ALTER TABLE library_charges DROP CONSTRAINT %I', v);
END $$;
ALTER TABLE library_charges
  ADD CONSTRAINT library_charges_kind_check CHECK (kind IN ('lost', 'damaged', 'late')),
  ADD CONSTRAINT library_charges_loan_kind UNIQUE (loan_id, kind);

-- a late fine waived at the desk: how much, why, who and when
CREATE TABLE library_fine_waivers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  loan_id     BIGINT NOT NULL REFERENCES library_loans(id),
  amount      NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL,
  waived_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  by_user     BIGINT,
  by_name     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX library_fine_waivers_loan ON library_fine_waivers (loan_id);
CREATE INDEX library_fine_waivers_day ON library_fine_waivers (school_id, waived_on);
CALL app.apply_tenant_rls('library_fine_waivers');

-- the waivers made before this history was kept: the amount and the loan's note (who is not known)
INSERT INTO library_fine_waivers (school_id, loan_id, amount, reason, waived_on, at)
SELECT school_id, id, fine_waived, COALESCE(NULLIF(btrim(note), ''), 'Waived (before the history was kept)'),
       COALESCE(returned_on, updated_at::date), updated_at
  FROM library_loans WHERE fine_waived > 0;

-- a borrower's old fines not yet sent to the fees counter (before 0217): still owed at the library
CREATE OR REPLACE FUNCTION app.library_fines_unsent(p_kind library_borrower, p_id BIGINT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(l.fine_amount - l.fine_waived), 0)
    FROM library_loans l
   WHERE l.borrower_kind = p_kind AND l.borrower_id = p_id
     AND l.fine_amount > l.fine_waived AND l.fine_paid_on IS NULL AND l.fine_receipt_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM library_charges ch WHERE ch.loan_id = l.id AND ch.kind = 'late')
$$;
