-- Purchase phase 2, part 8 (docs/design/84): stock reserved for requisition lines "from the store",
-- issues (against the reservations of a requisition, or at the counter) acknowledged by the
-- department, returns to the store and to the vendor, transfers between stores (in transit until
-- received) and the physical count (GFR 213) approved before its differences post.

-- ---- rights ---------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.count.approve', 'purchase', 'Approve a store''s physical count: its differences post as adjustments')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.count.approve' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;

-- ---- reservations ---------------------------------------------------------------------------------
-- a requisition line issued from the store names the store
ALTER TABLE purchase_requisition_lines ADD COLUMN store_id BIGINT REFERENCES stores(id);

CREATE TABLE stock_reservations (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  store_id             BIGINT NOT NULL REFERENCES stores(id),
  item_id              BIGINT NOT NULL REFERENCES purchase_items(id),
  requisition_line_id  BIGINT NOT NULL REFERENCES purchase_requisition_lines(id) ON DELETE CASCADE,
  -- in the store unit
  qty                  NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  issued_qty           NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  -- held → issued in full (done) or let go (released: the requisition sent back, rejected, cancelled, reopened)
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'released')),
  released_note        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ
);
CALL app.apply_tenant_rls('stock_reservations');
CREATE INDEX stock_reservations_line ON stock_reservations (requisition_line_id);
CREATE INDEX stock_reservations_open ON stock_reservations (store_id, item_id) WHERE status = 'open';

-- the balance's reserved quantity worked out again from the open reservations
CREATE OR REPLACE FUNCTION app.stock_reserved_refresh(p_store BIGINT, p_item BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO stock_balances (school_id, store_id, item_id)
  SELECT s.school_id, p_store, p_item FROM stores s WHERE s.id = p_store
  ON CONFLICT (store_id, item_id) DO NOTHING;
  UPDATE stock_balances b
     SET reserved = COALESCE((SELECT sum(r.qty - r.issued_qty) FROM stock_reservations r
                               WHERE r.store_id = p_store AND r.item_id = p_item AND r.status = 'open'), 0)
   WHERE b.store_id = p_store AND b.item_id = p_item;
END $$;

-- ---- issues -----------------------------------------------------------------------------------------
ALTER TABLE stock_issues ADD COLUMN requisition_id BIGINT REFERENCES purchase_requisitions(id);
ALTER TABLE stock_issues ADD COLUMN ack_on_paper BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stock_issue_lines
  ADD COLUMN reservation_id BIGINT REFERENCES stock_reservations(id),
  -- brought back to the store against this line (store unit)
  ADD COLUMN returned_qty   NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0);

-- returned to the vendor from stock (found defective) with a replacement wanted: the PO waits for it
ALTER TABLE purchase_order_lines
  ADD COLUMN returned_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0);

-- ---- returns: to the store (against an issue) and to the vendor (against a receipt) -------------------
CREATE TABLE stock_returns (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  number         TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('to_store', 'to_vendor')),
  store_id       BIGINT NOT NULL REFERENCES stores(id),
  -- to the store: the issue it came back against; to the vendor: the PO
  issue_id       BIGINT REFERENCES stock_issues(id),
  order_id       BIGINT REFERENCES purchase_orders(id),
  department_id  BIGINT REFERENCES departments(id),
  vendor_id      BIGINT REFERENCES vendors(id),
  returned_on    DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  -- to the vendor: how it went back (carrier, docket, who took it)
  dispatch       TEXT CHECK (dispatch IS NULL OR length(dispatch) <= 300),
  note           TEXT CHECK (note IS NULL OR length(note) <= 1000),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  CHECK ((kind = 'to_store') = (issue_id IS NOT NULL)),
  CHECK ((kind = 'to_vendor') = (order_id IS NOT NULL))
);
CALL app.apply_tenant_rls('stock_returns');
CREATE TRIGGER stock_returns_audit AFTER INSERT OR UPDATE OR DELETE ON stock_returns
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX stock_returns_issue ON stock_returns (issue_id);
CREATE INDEX stock_returns_order ON stock_returns (order_id);

CREATE TABLE stock_return_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  return_id        BIGINT NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
  item_id          BIGINT REFERENCES purchase_items(id),
  issue_line_id    BIGINT REFERENCES stock_issue_lines(id),
  receipt_line_id  BIGINT REFERENCES goods_receipt_lines(id),
  -- to the vendor: goods rejected at inspection (never in stock) or taken out of stock (found defective)
  source           TEXT NOT NULL CHECK (source IN ('issue', 'rejected', 'stock')),
  -- to the store: unused goes back into stock; damaged is recorded (for condemnation)
  condition        TEXT CHECK (condition IS NULL OR condition IN ('unused', 'damaged')),
  -- the store unit for stock moves; the PO line's unit for goods rejected at inspection
  qty              NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  rate             NUMERIC(14,4) NOT NULL DEFAULT 0,
  value            NUMERIC(16,2) NOT NULL DEFAULT 0,
  batch_no         TEXT,
  reason           TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  -- to the vendor: a replacement is wanted (the PO line waits for it) or not (closed short by hand)
  replacement      BOOLEAN NOT NULL DEFAULT true,
  move_id          BIGINT REFERENCES stock_moves(id)
);
CALL app.apply_tenant_rls('stock_return_lines');
CREATE INDEX stock_return_lines_return ON stock_return_lines (return_id);
CREATE INDEX stock_return_lines_receipt_line ON stock_return_lines (receipt_line_id);

-- ---- transfers between stores ---------------------------------------------------------------------
CREATE TABLE stock_transfers (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  number         TEXT NOT NULL,
  from_store_id  BIGINT NOT NULL REFERENCES stores(id),
  to_store_id    BIGINT NOT NULL REFERENCES stores(id),
  -- sent (in transit) → received by the receiving keeper, or cancelled (back into the sending store)
  status         TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  sent_on        DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  received_on    DATE,
  received_by    BIGINT REFERENCES users(id),
  note           TEXT CHECK (note IS NULL OR length(note) <= 500),
  receive_note   TEXT CHECK (receive_note IS NULL OR length(receive_note) <= 500),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  CHECK (from_store_id <> to_store_id)
);
CALL app.apply_tenant_rls('stock_transfers');
CREATE TRIGGER stock_transfers_audit AFTER INSERT OR UPDATE OR DELETE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE stock_transfer_lines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  transfer_id  BIGINT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES purchase_items(id),
  qty          NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  rate         NUMERIC(14,4) NOT NULL DEFAULT 0,
  value        NUMERIC(16,2) NOT NULL DEFAULT 0,
  batch_no     TEXT,
  expiry       DATE,
  out_move_id  BIGINT REFERENCES stock_moves(id),
  in_move_id   BIGINT REFERENCES stock_moves(id)
);
CALL app.apply_tenant_rls('stock_transfer_lines');
CREATE INDEX stock_transfer_lines_transfer ON stock_transfer_lines (transfer_id);

-- ---- the physical count (GFR 2017 rule 213) ----------------------------------------------------------
CREATE TABLE stock_counts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  number         TEXT NOT NULL,
  store_id       BIGINT NOT NULL REFERENCES stores(id),
  -- all the store's items, or one category
  category_id    BIGINT REFERENCES purchase_item_categories(id),
  -- counting → submitted (the differences with reasons) → approved (adjustments posted); sent back to
  -- counting, or cancelled
  status         TEXT NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'submitted', 'approved', 'cancelled')),
  counted_on     DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  counted_by     TEXT CHECK (counted_by IS NULL OR length(counted_by) <= 200),
  note           TEXT CHECK (note IS NULL OR length(note) <= 1000),
  submitted_at   TIMESTAMPTZ,
  submitted_by   BIGINT REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  decided_by     BIGINT REFERENCES users(id),
  decision_note  TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CALL app.apply_tenant_rls('stock_counts');
CREATE TRIGGER stock_counts_audit AFTER INSERT OR UPDATE OR DELETE ON stock_counts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
-- one open count per store at a time
CREATE UNIQUE INDEX stock_counts_open ON stock_counts (store_id) WHERE status IN ('counting', 'submitted');

CREATE TABLE stock_count_lines (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  count_id     BIGINT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES purchase_items(id),
  batch_no     TEXT,
  expiry       DATE,
  -- the book quantity when the count started (store unit); what was found
  book_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,
  counted_qty  NUMERIC(14,3) CHECK (counted_qty IS NULL OR counted_qty >= 0),
  reason       TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  -- found in the count but not on the book list
  added        BOOLEAN NOT NULL DEFAULT false,
  -- at approval: the rate the difference was valued at, its value, the adjustment move
  rate         NUMERIC(14,4),
  value        NUMERIC(16,2),
  move_id      BIGINT REFERENCES stock_moves(id),
  UNIQUE NULLS NOT DISTINCT (count_id, item_id, batch_no, expiry)
);
CALL app.apply_tenant_rls('stock_count_lines');
CREATE INDEX stock_count_lines_count ON stock_count_lines (count_id);
