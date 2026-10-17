-- 0163: hostel withdrawal, part 4 (docs/design/27-hostel-withdrawal.md).
--  * A parent may ask, in the parent app, for the child to leave the hostel: the hostel office starts the
--    withdrawal from it (the request then points at the withdrawal) or declines it with a note.
--  * The room check-out list: the school's items (bed, mattress, cupboard, keys...) each with the charge for
--    one missing or damaged; at a withdrawal the warden or office marks each, and the total is the damage
--    charge of the withdrawal.
--  * (The hostel clearance certificate is a PDF made from the completed withdrawal; no table.)
CREATE TABLE hostel_exit_requests (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  student_id      BIGINT NOT NULL REFERENCES students(id),
  leaving_on      DATE NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('parent_request', 'health', 'other')),
  note            TEXT CHECK (note IS NULL OR length(note) <= 1000),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'started', 'declined', 'withdrawn')),
  withdrawal_id   BIGINT REFERENCES hostel_withdrawals(id),
  decline_note    TEXT CHECK (decline_note IS NULL OR length(decline_note) <= 500),
  requested_by    BIGINT NOT NULL,
  decided_by      BIGINT,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hostel_exit_requests_one ON hostel_exit_requests (student_id) WHERE status = 'pending';
CREATE INDEX hostel_exit_requests_school ON hostel_exit_requests (school_id, status, created_at DESC);
CALL app.apply_tenant_rls('hostel_exit_requests');

CREATE TABLE hostel_checkout_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  charge      NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (charge >= 0),
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX hostel_checkout_items_name ON hostel_checkout_items (school_id, lower(btrim(name)));
CALL app.apply_tenant_rls('hostel_checkout_items');

CREATE TABLE hostel_withdrawal_checkout (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  withdrawal_id  BIGINT NOT NULL REFERENCES hostel_withdrawals(id) ON DELETE CASCADE,
  item_id        BIGINT REFERENCES hostel_checkout_items(id),
  -- the item's name when checked (the list may change later)
  item_name      TEXT NOT NULL,
  condition      TEXT NOT NULL CHECK (condition IN ('ok', 'missing', 'damaged')),
  charge         NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (charge >= 0),
  note           TEXT CHECK (note IS NULL OR length(note) <= 200),
  checked_by     BIGINT,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (withdrawal_id, item_name)
);
CALL app.apply_tenant_rls('hostel_withdrawal_checkout');
ALTER TABLE hostel_withdrawals ADD COLUMN checked_out_at TIMESTAMPTZ, ADD COLUMN checked_out_by BIGINT,
  ADD COLUMN exit_request_id BIGINT REFERENCES hostel_exit_requests(id);
