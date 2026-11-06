-- Purchase phase 2, part 9 (docs/design/84): the asset register (a tag per unit of an asset item, its
-- place, custodian, warranty and insurance, every movement), depreciation per item category with a
-- yearly run, condemnation of unserviceable, obsolete or surplus assets and stock (GFR 2017 rule 217:
-- the committee recommends, the school approves, they are written off and later disposed of), and stock
-- marked for condemnation held from issue.

-- ---- rights ---------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.asset.manage', 'purchase', 'Keep the asset register: assets, their movements, labels, import, depreciation; propose condemnation'),
  ('purchase.condemnation.approve', 'purchase', 'Approve a condemnation: the assets and stock in it are written off')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.asset.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'purchase_office')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.condemnation.approve' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
ON CONFLICT DO NOTHING;

-- ---- depreciation per item category -----------------------------------------------------------------
ALTER TABLE purchase_item_categories
  -- straight line over the useful life down to the salvage %, or written-down value at a rate a year
  ADD COLUMN dep_method        TEXT CHECK (dep_method IS NULL OR dep_method IN ('slm', 'wdv')),
  ADD COLUMN useful_life_years NUMERIC(5,2) CHECK (useful_life_years IS NULL OR useful_life_years BETWEEN 1 AND 100),
  ADD COLUMN salvage_pct       NUMERIC(5,2) CHECK (salvage_pct IS NULL OR salvage_pct BETWEEN 0 AND 100),
  ADD COLUMN wdv_rate_pct      NUMERIC(5,2) CHECK (wdv_rate_pct IS NULL OR wdv_rate_pct BETWEEN 0 AND 100);

-- how many of the condemnation committee must sign (all when not set)
ALTER TABLE purchase_settings
  ADD COLUMN condemnation_signatures INT CHECK (condemnation_signatures IS NULL OR condemnation_signatures BETWEEN 1 AND 20);

-- ---- the asset register -----------------------------------------------------------------------------
CREATE TABLE assets (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  tag                    TEXT NOT NULL CHECK (length(btrim(tag)) BETWEEN 1 AND 40),
  item_id                BIGINT NOT NULL REFERENCES purchase_items(id),
  description            TEXT CHECK (description IS NULL OR length(description) <= 300),
  make                   TEXT CHECK (make IS NULL OR length(make) <= 80),
  model                  TEXT CHECK (model IS NULL OR length(model) <= 80),
  serial_no              TEXT CHECK (serial_no IS NULL OR length(btrim(serial_no)) BETWEEN 1 AND 60),
  -- where it came from: the goods receipt line (and its PO and vendor), or imported from the old register
  receipt_line_id        BIGINT REFERENCES goods_receipt_lines(id),
  order_id               BIGINT REFERENCES purchase_orders(id),
  vendor_id              BIGINT REFERENCES vendors(id),
  source_note            TEXT CHECK (source_note IS NULL OR length(source_note) <= 300),
  -- what one unit cost: its share of the PO line with GST and other charges
  cost                   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  acquired_on            DATE,
  put_to_use_on          DATE,
  status                 TEXT NOT NULL DEFAULT 'in_store'
                           CHECK (status IN ('in_store', 'in_use', 'in_transit', 'under_repair', 'lost', 'returned',
                                             'written_off', 'disposed')),
  store_id               BIGINT REFERENCES stores(id),
  department_id          BIGINT REFERENCES departments(id),
  location               TEXT CHECK (location IS NULL OR length(location) <= 120),
  custodian_employee_id  BIGINT REFERENCES employees(id),
  condition              TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'poor', 'unserviceable')),
  warranty_until         DATE,
  insurer                TEXT CHECK (insurer IS NULL OR length(insurer) <= 120),
  policy_no              TEXT CHECK (policy_no IS NULL OR length(policy_no) <= 60),
  insured_value          NUMERIC(14,2) CHECK (insured_value IS NULL OR insured_value >= 0),
  insurance_renewal      DATE,
  -- the issue (or store transfer) it went out on
  issue_line_id          BIGINT REFERENCES stock_issue_lines(id),
  transfer_line_id       BIGINT REFERENCES stock_transfer_lines(id),
  -- when it left the register's books (written off, disposed, returned to the vendor), at what book value
  left_on                DATE,
  book_value_at_exit     NUMERIC(14,2),
  note                   TEXT CHECK (note IS NULL OR length(note) <= 1000),
  created_by             BIGINT REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, tag)
);
CALL app.apply_tenant_rls('assets');
CREATE TRIGGER assets_audit AFTER INSERT OR UPDATE OR DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX assets_item ON assets (item_id, status);
CREATE INDEX assets_store ON assets (store_id, item_id) WHERE status = 'in_store';
CREATE INDEX assets_custodian ON assets (custodian_employee_id) WHERE custodian_employee_id IS NOT NULL;
CREATE UNIQUE INDEX assets_serial ON assets (school_id, item_id, serial_no) WHERE serial_no IS NOT NULL AND status <> 'returned';

CREATE TABLE asset_movements (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id              BIGINT NOT NULL REFERENCES schools(id),
  asset_id               BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL CHECK (kind IN ('received', 'imported', 'issued', 'back_to_store', 'store_transfer',
                                                       'custody', 'repair_out', 'repair_back', 'lost', 'found', 'returned',
                                                       'written_off', 'disposed')),
  -- a custody change waits for the new custodian's acknowledgement
  status                 TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'pending', 'cancelled')),
  moved_on               DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  from_store_id          BIGINT REFERENCES stores(id),
  to_store_id            BIGINT REFERENCES stores(id),
  from_department_id     BIGINT REFERENCES departments(id),
  to_department_id       BIGINT REFERENCES departments(id),
  from_location          TEXT,
  to_location            TEXT,
  from_custodian_id      BIGINT REFERENCES employees(id),
  to_custodian_id        BIGINT REFERENCES employees(id),
  -- a repair: the vendor, when it is expected back, what it cost
  vendor_id              BIGINT REFERENCES vendors(id),
  expected_back          DATE,
  cost                   NUMERIC(14,2) CHECK (cost IS NULL OR cost >= 0),
  doc                    TEXT CHECK (doc IS NULL OR length(doc) <= 60),
  note                   TEXT CHECK (note IS NULL OR length(note) <= 500),
  acknowledged_by        BIGINT REFERENCES users(id),
  acknowledged_at        TIMESTAMPTZ,
  created_by             BIGINT REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('asset_movements');
CREATE INDEX asset_movements_asset ON asset_movements (asset_id, id);
CREATE INDEX asset_movements_pending ON asset_movements (to_custodian_id) WHERE status = 'pending';
-- one custody change waiting at a time
CREATE UNIQUE INDEX asset_movements_one_pending ON asset_movements (asset_id) WHERE status = 'pending';

-- the yearly depreciation of each asset, and each year's run
CREATE TABLE asset_depreciation (
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  asset_id      BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  fy            TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  method        TEXT NOT NULL CHECK (method IN ('slm', 'wdv')),
  opening       NUMERIC(14,2) NOT NULL,
  depreciation  NUMERIC(14,2) NOT NULL CHECK (depreciation >= 0),
  closing       NUMERIC(14,2) NOT NULL,
  days          INT NOT NULL,
  PRIMARY KEY (asset_id, fy)
);
CALL app.apply_tenant_rls('asset_depreciation');
CREATE INDEX asset_depreciation_fy ON asset_depreciation (school_id, fy);

CREATE TABLE asset_depreciation_runs (
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  fy         TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  assets     INT NOT NULL,
  total      NUMERIC(16,2) NOT NULL,
  run_by     BIGINT REFERENCES users(id),
  run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, fy)
);
CALL app.apply_tenant_rls('asset_depreciation_runs');

-- ---- condemnation and disposal (GFR 2017 rule 217) ------------------------------------------------------
CREATE TABLE condemnation_committee_members (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  role         TEXT CHECK (role IS NULL OR length(role) <= 60),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, employee_id)
);
CALL app.apply_tenant_rls('condemnation_committee_members');

CREATE TABLE condemnations (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  number          TEXT NOT NULL,
  title           TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  -- drafted → with the committee (signatures) → waiting for approval → written off → disposed;
  -- sent back to draft, rejected or cancelled
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'committee', 'approval', 'written_off', 'disposed', 'rejected', 'cancelled')),
  note            TEXT CHECK (note IS NULL OR length(note) <= 2000),
  submitted_at    TIMESTAMPTZ,
  decided_at      TIMESTAMPTZ,
  decided_by      BIGINT REFERENCES users(id),
  decision_note   TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  written_off_on  DATE,
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CALL app.apply_tenant_rls('condemnations');
CREATE TRIGGER condemnations_audit AFTER INSERT OR UPDATE OR DELETE ON condemnations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE condemnation_lines (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  condemnation_id   BIGINT NOT NULL REFERENCES condemnations(id) ON DELETE CASCADE,
  -- an asset, or a quantity of an item in a store (a batch for a batch item)
  kind              TEXT NOT NULL CHECK (kind IN ('asset', 'stock')),
  asset_id          BIGINT REFERENCES assets(id),
  store_id          BIGINT REFERENCES stores(id),
  item_id           BIGINT REFERENCES purchase_items(id),
  batch_no          TEXT,
  qty               NUMERIC(14,3) CHECK (qty IS NULL OR qty > 0),
  reason_kind       TEXT NOT NULL CHECK (reason_kind IN ('unserviceable', 'obsolete', 'surplus', 'expired', 'damaged', 'lost')),
  reason            TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  -- the book value proposed (the asset's after depreciation; the stock's at its average)
  book_value        NUMERIC(14,2) NOT NULL DEFAULT 0,
  move_id           BIGINT REFERENCES stock_moves(id),
  CHECK ((kind = 'asset') = (asset_id IS NOT NULL)),
  CHECK (kind = 'asset' OR (store_id IS NOT NULL AND item_id IS NOT NULL AND qty IS NOT NULL))
);
CALL app.apply_tenant_rls('condemnation_lines');
CREATE INDEX condemnation_lines_condemnation ON condemnation_lines (condemnation_id);
CREATE INDEX condemnation_lines_stock ON condemnation_lines (store_id, item_id) WHERE kind = 'stock';
CREATE INDEX condemnation_lines_asset ON condemnation_lines (asset_id);

CREATE TABLE condemnation_signoffs (
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  condemnation_id  BIGINT NOT NULL REFERENCES condemnations(id) ON DELETE CASCADE,
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  user_id          BIGINT NOT NULL REFERENCES users(id),
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (condemnation_id, employee_id)
);
CALL app.apply_tenant_rls('condemnation_signoffs');

CREATE TABLE disposals (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  condemnation_id  BIGINT NOT NULL REFERENCES condemnations(id),
  method           TEXT NOT NULL CHECK (method IN ('auction', 'tender_sale', 'sale', 'buyback', 'scrap', 'donation', 'destruction')),
  disposed_on      DATE NOT NULL,
  -- who bought or received it, for how much, the auction / tender reference
  party            TEXT CHECK (party IS NULL OR length(party) <= 200),
  amount           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reference        TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  note             TEXT CHECK (note IS NULL OR length(note) <= 1000),
  file_id          BIGINT REFERENCES files(id),
  created_by       BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (condemnation_id)
);
CALL app.apply_tenant_rls('disposals');
CREATE TRIGGER disposals_audit AFTER INSERT OR UPDATE OR DELETE ON disposals
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- stock marked for condemnation is held from issue --------------------------------------------------
-- the balance's reserved quantity: the requisitions' open reservations plus what an open condemnation
-- proposes to write off
CREATE OR REPLACE FUNCTION app.stock_reserved_refresh(p_store BIGINT, p_item BIGINT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO stock_balances (school_id, store_id, item_id)
  SELECT s.school_id, p_store, p_item FROM stores s WHERE s.id = p_store
  ON CONFLICT (store_id, item_id) DO NOTHING;
  UPDATE stock_balances b
     SET reserved = COALESCE((SELECT sum(r.qty - r.issued_qty) FROM stock_reservations r
                               WHERE r.store_id = p_store AND r.item_id = p_item AND r.status = 'open'), 0)
                  + COALESCE((SELECT sum(l.qty) FROM condemnation_lines l JOIN condemnations k ON k.id = l.condemnation_id
                               WHERE l.kind = 'stock' AND l.store_id = p_store AND l.item_id = p_item
                                 AND k.status IN ('draft', 'committee', 'approval')), 0)
   WHERE b.store_id = p_store AND b.item_id = p_item;
END $$;
