-- Purchase phase 2, part 6 (docs/design/84): stores and the stock ledger — a main store and sub-stores
-- with their keepers, the item's stock settings (kept in stock or not, batch and expiry, serial
-- numbers, the store unit and how many make a purchase unit), reorder levels per store, every move of
-- stock in and out (append-only) with balances at the weighted average, batches by expiry, and
-- opening stock.

-- ---- rights and the Store keeper role ---------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.store.view', 'purchase', 'See the stores, stock in hand and the stock registers'),
  ('purchase.store.operate', 'purchase', 'Work the stores you keep: opening stock, receipts, issues, returns, transfers, counts'),
  ('purchase.store.manage', 'purchase', 'Set up stores and their keepers, items'' stock settings and reorder levels; work every store')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'store_keeper', 'Store keeper', 'module', true,
   'Keeps the stores given to them: receives goods, issues them, takes returns, transfers and counts stock')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'purchase_office')
   AND p.code IN ('purchase.store.view', 'purchase.store.operate', 'purchase.store.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code = 'store_keeper'
   AND p.code IN ('purchase.store.view', 'purchase.store.operate', 'purchase.master.view', 'purchase.indent.raise',
                  'platform.files.upload', 'platform.files.view')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.store.view' FROM roles r WHERE r.school_id IS NULL AND r.code = 'auditor'
ON CONFLICT DO NOTHING;

-- ---- stores -----------------------------------------------------------------------------------------
CREATE TABLE stores (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  code           TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name           TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  -- one main store receives; sub-stores (labs, sports room, library...) sit under it
  kind           TEXT NOT NULL DEFAULT 'sub' CHECK (kind IN ('main', 'sub')),
  parent_id      BIGINT REFERENCES stores(id),
  department_id  BIGINT REFERENCES departments(id),
  location       TEXT CHECK (location IS NULL OR length(location) <= 200),
  status         row_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  CHECK ((kind = 'main') = (parent_id IS NULL))
);
CALL app.apply_tenant_rls('stores');
CREATE UNIQUE INDEX stores_one_main ON stores (school_id) WHERE kind = 'main';
CREATE TRIGGER stores_audit AFTER INSERT OR UPDATE OR DELETE ON stores
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- a sub-store's parent is the school's main store
CREATE OR REPLACE FUNCTION app.store_parent_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM stores p WHERE p.id = NEW.parent_id AND p.kind = 'main' AND p.school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'A sub-store sits under the main store' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stores_parent BEFORE INSERT OR UPDATE OF parent_id, kind ON stores
  FOR EACH ROW EXECUTE FUNCTION app.store_parent_check();

CREATE TABLE store_keepers (
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  store_id     BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, employee_id)
);
CALL app.apply_tenant_rls('store_keepers');
CREATE INDEX store_keepers_employee ON store_keepers (employee_id);

-- ---- the item's stock settings -------------------------------------------------------------------------
ALTER TABLE purchase_items
  -- kept in stock (a service never is)
  ADD COLUMN stock_tracked   BOOLEAN NOT NULL DEFAULT true,
  -- batches with an expiry (lab chemicals, first aid); serial numbers per unit (assets)
  ADD COLUMN tracks_batch    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN tracks_serial   BOOLEAN NOT NULL DEFAULT false,
  -- the unit the store counts in, and how many of it make one purchase unit (a box of 10 pieces: 10)
  ADD COLUMN stock_uom_id    BIGINT REFERENCES purchase_uoms(id),
  ADD COLUMN stock_per_unit  NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (stock_per_unit > 0);
UPDATE purchase_items SET stock_tracked = false WHERE item_type = 'service';
UPDATE purchase_items SET tracks_serial = true WHERE item_type = 'asset';

-- a service is never stock; the store unit's conversion stays as it is once stock has moved
CREATE OR REPLACE FUNCTION app.purchase_item_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_type = 'service' THEN
    NEW.stock_tracked := false; NEW.tracks_batch := false; NEW.tracks_serial := false;
  END IF;
  IF NEW.stock_uom_id IS NULL OR NEW.stock_uom_id = NEW.uom_id THEN
    NEW.stock_uom_id := NULL;
    NEW.stock_per_unit := 1;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.stock_per_unit IS DISTINCT FROM OLD.stock_per_unit OR NEW.stock_uom_id IS DISTINCT FROM OLD.stock_uom_id
          OR NEW.uom_id IS DISTINCT FROM OLD.uom_id)
     AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.item_id = NEW.id) THEN
    RAISE EXCEPTION 'The item has stock moves: its units cannot change now' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ---- reorder levels per store (store units) --------------------------------------------------------
CREATE TABLE item_store_levels (
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  store_id       BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  item_id        BIGINT NOT NULL REFERENCES purchase_items(id),
  reorder_level  NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  reorder_qty    NUMERIC(14,3) CHECK (reorder_qty IS NULL OR reorder_qty > 0),
  max_qty        NUMERIC(14,3) CHECK (max_qty IS NULL OR max_qty > 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, item_id),
  CHECK (max_qty IS NULL OR max_qty >= reorder_level)
);
CALL app.apply_tenant_rls('item_store_levels');

-- ---- the stock ledger ---------------------------------------------------------------------------------
CREATE TABLE stock_moves (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  store_id       BIGINT NOT NULL REFERENCES stores(id),
  item_id        BIGINT NOT NULL REFERENCES purchase_items(id),
  kind           TEXT NOT NULL CHECK (kind IN ('opening', 'receipt', 'issue', 'return_in', 'return_vendor', 'transfer_out',
                                               'transfer_in', 'adjustment', 'write_off')),
  -- in the store unit: positive in, negative out
  qty            NUMERIC(14,3) NOT NULL CHECK (qty <> 0),
  -- per store unit: what came in at, or the average it went out at
  rate           NUMERIC(14,4) NOT NULL CHECK (rate >= 0),
  value          NUMERIC(16,2) NOT NULL,
  -- the store's balance of the item after the move
  balance_qty    NUMERIC(14,3) NOT NULL CHECK (balance_qty >= 0),
  balance_value  NUMERIC(16,2) NOT NULL,
  batch_no       TEXT CHECK (batch_no IS NULL OR length(batch_no) <= 40),
  expiry         DATE,
  -- the document it came from (a GRN, an issue, a count...) and its line
  doc_type       TEXT,
  doc_id         BIGINT,
  doc_line_id    BIGINT,
  note           TEXT CHECK (note IS NULL OR length(note) <= 300),
  moved_on       DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('stock_moves');
CREATE INDEX stock_moves_item ON stock_moves (item_id, store_id, id);
CREATE INDEX stock_moves_doc ON stock_moves (doc_type, doc_id);

-- the ledger is never changed: a mistake is put right by another move
CREATE OR REPLACE FUNCTION app.stock_moves_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The stock ledger is not changed: post a correcting move' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER stock_moves_frozen BEFORE UPDATE OR DELETE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION app.stock_moves_frozen();

CREATE TRIGGER purchase_items_stock BEFORE INSERT OR UPDATE ON purchase_items
  FOR EACH ROW EXECUTE FUNCTION app.purchase_item_stock();

CREATE TABLE stock_balances (
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  store_id      BIGINT NOT NULL REFERENCES stores(id),
  item_id       BIGINT NOT NULL REFERENCES purchase_items(id),
  qty           NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  value         NUMERIC(16,2) NOT NULL DEFAULT 0,
  avg_rate      NUMERIC(14,4) NOT NULL DEFAULT 0,
  -- held for approved requisition lines "from the store" (part 8)
  reserved      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  last_move_on  DATE,
  PRIMARY KEY (store_id, item_id)
);
CALL app.apply_tenant_rls('stock_balances');
CREATE INDEX stock_balances_item ON stock_balances (item_id);

CREATE TABLE stock_batches (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  store_id   BIGINT NOT NULL REFERENCES stores(id),
  item_id    BIGINT NOT NULL REFERENCES purchase_items(id),
  batch_no   TEXT NOT NULL,
  expiry     DATE,
  qty_left   NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_left >= 0),
  UNIQUE NULLS NOT DISTINCT (store_id, item_id, batch_no, expiry)
);
CALL app.apply_tenant_rls('stock_batches');

/**
 * Posts one move to a store's stock, the store's school's: a move in (qty > 0) at its rate re-averages
 * the balance (weighted average); a move out (qty < 0) goes at the average (`p_rate` ignored) and may
 * not take the balance below nothing. A batch-tracked item's move in goes to its batch; a move out takes
 * the named batch, or the earliest expiry first. Returns the move's id. Errors: stock.insufficient,
 * stock.batch_required.
 */
CREATE OR REPLACE FUNCTION app.stock_post(p_store BIGINT, p_item BIGINT, p_kind TEXT, p_qty NUMERIC, p_rate NUMERIC,
                                          p_batch TEXT DEFAULT NULL, p_expiry DATE DEFAULT NULL, p_doc_type TEXT DEFAULT NULL,
                                          p_doc_id BIGINT DEFAULT NULL, p_doc_line BIGINT DEFAULT NULL, p_note TEXT DEFAULT NULL,
                                          p_day DATE DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_school BIGINT;
  v_batch_on BOOLEAN;
  b RECORD;
  v_qty NUMERIC;
  v_value NUMERIC;
  v_rate NUMERIC;
  v_new_qty NUMERIC;
  v_new_value NUMERIC;
  v_left NUMERIC;
  v_take NUMERIC;
  bt RECORD;
  v_id BIGINT;
BEGIN
  SELECT s.school_id INTO v_school FROM stores s WHERE s.id = p_store;
  IF v_school IS NULL THEN RAISE EXCEPTION 'stock.no_store' USING ERRCODE = 'no_data_found'; END IF;
  SELECT i.tracks_batch INTO v_batch_on FROM purchase_items i WHERE i.id = p_item AND i.school_id = v_school AND i.stock_tracked;
  IF v_batch_on IS NULL THEN RAISE EXCEPTION 'stock.not_tracked' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO stock_balances (school_id, store_id, item_id) VALUES (v_school, p_store, p_item)
  ON CONFLICT (store_id, item_id) DO NOTHING;
  SELECT * INTO b FROM stock_balances WHERE store_id = p_store AND item_id = p_item FOR UPDATE;
  v_qty := round(p_qty, 3);
  IF v_qty > 0 THEN
    v_rate := round(COALESCE(p_rate, 0), 4);
    v_value := round(v_qty * v_rate, 2);
    v_new_qty := b.qty + v_qty;
    v_new_value := b.value + v_value;
    IF v_batch_on THEN
      IF p_batch IS NULL OR btrim(p_batch) = '' THEN RAISE EXCEPTION 'stock.batch_required' USING ERRCODE = 'check_violation'; END IF;
      INSERT INTO stock_batches (school_id, store_id, item_id, batch_no, expiry, qty_left)
      VALUES (v_school, p_store, p_item, btrim(p_batch), p_expiry, v_qty)
      ON CONFLICT (store_id, item_id, batch_no, expiry) DO UPDATE SET qty_left = stock_batches.qty_left + EXCLUDED.qty_left;
    END IF;
  ELSE
    IF b.qty + v_qty < 0 THEN
      RAISE EXCEPTION 'stock.insufficient: % in the store, % asked', b.qty, -v_qty USING ERRCODE = 'check_violation';
    END IF;
    v_rate := b.avg_rate;
    v_new_qty := b.qty + v_qty;
    -- the last of it takes what value is left, so nothing is stranded by rounding
    v_value := CASE WHEN v_new_qty = 0 THEN -b.value ELSE round(v_qty * b.avg_rate, 2) END;
    v_new_value := b.value + v_value;
    IF v_batch_on THEN
      v_left := -v_qty;
      FOR bt IN SELECT * FROM stock_batches
                 WHERE store_id = p_store AND item_id = p_item AND qty_left > 0
                   AND (p_batch IS NULL OR batch_no = btrim(p_batch))
                 ORDER BY expiry NULLS LAST, id FOR UPDATE LOOP
        EXIT WHEN v_left <= 0;
        v_take := least(v_left, bt.qty_left);
        UPDATE stock_batches SET qty_left = qty_left - v_take WHERE id = bt.id;
        v_left := v_left - v_take;
      END LOOP;
      IF v_left > 0 THEN
        RAISE EXCEPTION 'stock.insufficient: not enough in the batch' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  UPDATE stock_balances
     SET qty = v_new_qty, value = v_new_value,
         avg_rate = CASE WHEN v_new_qty > 0 THEN round(v_new_value / v_new_qty, 4) ELSE b.avg_rate END,
         last_move_on = COALESCE(p_day, (now() AT TIME ZONE 'Asia/Kolkata')::date)
   WHERE store_id = p_store AND item_id = p_item;
  INSERT INTO stock_moves (school_id, store_id, item_id, kind, qty, rate, value, balance_qty, balance_value, batch_no, expiry,
                           doc_type, doc_id, doc_line_id, note, moved_on, created_by)
  VALUES (v_school, p_store, p_item, p_kind, v_qty, v_rate, v_value, v_new_qty, v_new_value, NULLIF(btrim(p_batch), ''), p_expiry,
          p_doc_type, p_doc_id, p_doc_line, p_note, COALESCE(p_day, (now() AT TIME ZONE 'Asia/Kolkata')::date), app.current_user_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---- numbering for phase 2's documents ------------------------------------------------------------
ALTER TABLE purchase_numbering DROP CONSTRAINT purchase_numbering_doc_check;
ALTER TABLE purchase_numbering ADD CONSTRAINT purchase_numbering_doc_check
  CHECK (doc IN ('indent', 'requisition', 'order', 'receipt', 'issue', 'return', 'transfer', 'count', 'asset', 'condemnation'));

CREATE OR REPLACE FUNCTION app.purchase_next_number(p_doc TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_fy TEXT := app.purchase_fy((now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_no INT;
  v_prefix TEXT;
BEGIN
  INSERT INTO purchase_numbering (school_id, doc, fy, next_no) VALUES (app.current_school_id(), p_doc, v_fy, 2)
  ON CONFLICT (school_id, doc, fy) DO UPDATE SET next_no = purchase_numbering.next_no + 1
  RETURNING next_no - 1 INTO v_no;
  SELECT CASE p_doc WHEN 'indent' THEN pi_prefix WHEN 'requisition' THEN pr_prefix WHEN 'order' THEN po_prefix END INTO v_prefix
    FROM purchase_settings WHERE school_id = app.current_school_id();
  v_prefix := COALESCE(v_prefix, CASE p_doc WHEN 'receipt' THEN 'GRN' WHEN 'issue' THEN 'ISS' WHEN 'return' THEN 'RTN'
                                            WHEN 'transfer' THEN 'TRF' WHEN 'count' THEN 'CNT' WHEN 'asset' THEN 'AST'
                                            WHEN 'condemnation' THEN 'CDN' ELSE upper(left(p_doc, 2)) END);
  RETURN v_prefix || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
END $$;
