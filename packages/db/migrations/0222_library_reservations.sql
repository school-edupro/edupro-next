-- 0222: books reserved (docs/design/36-library.md, "Library round 3", part 4). A pupil or a staff member
-- reserves a title when every copy is out; when a copy comes back it is kept for the first in line for the
-- school's number of days (setting library.hold_days), then the next; issuing it to them collects the
-- reservation. Told in the portal only.
CREATE TABLE library_reservations (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  title_id       BIGINT NOT NULL REFERENCES library_titles(id),
  borrower_kind  library_borrower NOT NULL,
  borrower_id    BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'waiting'
                 CHECK (status IN ('waiting', 'ready', 'collected', 'cancelled', 'lapsed')),
  placed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  placed_by      BIGINT,
  -- kept for them: the copy, from when, until which day
  copy_id        BIGINT REFERENCES library_copies(id),
  ready_at       TIMESTAMPTZ,
  ready_until    DATE,
  loan_id        BIGINT REFERENCES library_loans(id),
  ended_at       TIMESTAMPTZ,
  end_reason     TEXT,
  ended_by_name  TEXT
);
-- one open reservation of a title a borrower
CREATE UNIQUE INDEX library_reservations_open
  ON library_reservations (title_id, borrower_kind, borrower_id) WHERE status IN ('waiting', 'ready');
CREATE INDEX library_reservations_queue ON library_reservations (title_id, status, placed_at);
CREATE INDEX library_reservations_borrower ON library_reservations (borrower_kind, borrower_id, status);
CREATE INDEX library_reservations_copy ON library_reservations (copy_id) WHERE status = 'ready';
CALL app.apply_tenant_rls('library_reservations');
