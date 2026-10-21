-- 0215: lost and damaged books charged to the borrower (docs/design/36-library.md, "The register,
-- accession corrections and lost-book recovery", part 3). A book reported lost is charged its price (the
-- copy's, else the title's) + a processing fee (setting library.lost_processing_fee) + the late fine to that
-- day; a book returned damaged, what the librarian enters (a share of the price suggested, setting
-- library.damage_share_pct). The charge is announced at once as a misc fee on the pupil (collected at the
-- fees counter, seen by the parent); this row is the library's record of it. A lost book found again
-- before it is paid: the price and the fee come off through a misc fee change request (found_request_id).
CREATE TABLE library_charges (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  loan_id           BIGINT NOT NULL REFERENCES library_loans(id),
  copy_id           BIGINT NOT NULL REFERENCES library_copies(id),
  borrower_kind     library_borrower NOT NULL,
  borrower_id       BIGINT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('lost', 'damaged')),
  on_date           DATE NOT NULL,
  price             NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  processing_fee    NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (processing_fee >= 0),
  late_fine         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (late_fine >= 0),
  amount            NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  reason            TEXT,
  misc_fee_id       BIGINT REFERENCES misc_fees(id),
  misc_line_id      BIGINT REFERENCES misc_fee_students(id),
  found_on          DATE,
  found_request_id  BIGINT REFERENCES misc_fee_requests(id),
  created_by        BIGINT,
  created_by_name   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_id)
);
CREATE INDEX library_charges_borrower ON library_charges (school_id, borrower_kind, borrower_id);
CREATE INDEX library_charges_copy ON library_charges (copy_id);
CALL app.apply_tenant_rls('library_charges');

-- what a borrower still owes on lost and damaged books (the misc fee lines not yet paid)
CREATE OR REPLACE FUNCTION app.library_charges_due(p_kind library_borrower, p_id BIGINT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(GREATEST(l.amount - l.paid, 0)), 0)
    FROM library_charges ch
    JOIN misc_fee_students l ON l.id = ch.misc_line_id
    JOIN misc_fees f ON f.id = l.misc_fee_id
   WHERE ch.borrower_kind = p_kind AND ch.borrower_id = p_id
     AND l.status = 'open' AND f.status = 'announced'
$$;
