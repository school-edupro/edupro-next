-- Opening stock corrected, assets made from it, and the physical count's reasons (docs/design/84,
-- "As built — opening stock corrections; the count rebuilt", 9 Nov 2026).
--
-- Each posting of opening stock (by hand, from an Excel sheet, or one item's correction) is a row here;
-- its stock moves carry doc_type 'opening' and doc_id = the posting. While an item has not moved since
-- its opening, the opening can be changed or removed: an 'opening_undo' move reverses the line (doc_line_id
-- = the move reversed) and the corrected line posts as a new opening — nothing is deleted. A whole
-- posting can be undone the same way while none of its items has moved.
CREATE TABLE stock_openings (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  store_id     BIGINT NOT NULL REFERENCES stores(id),
  source       TEXT NOT NULL CHECK (source IN ('hand', 'excel', 'correction')),
  file_name    TEXT CHECK (file_name IS NULL OR length(file_name) <= 200),
  -- a correction: why
  reason       TEXT CHECK (reason IS NULL OR length(reason) <= 300),
  undone_at    TIMESTAMPTZ,
  undone_by    BIGINT REFERENCES users(id),
  undo_reason  TEXT CHECK (undo_reason IS NULL OR length(undo_reason) <= 300),
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('stock_openings');
CREATE TRIGGER stock_openings_audit AFTER INSERT OR UPDATE OR DELETE ON stock_openings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX stock_openings_store ON stock_openings (store_id, created_at DESC);

ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_kind_check;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_kind_check
  CHECK (kind IN ('opening', 'opening_undo', 'receipt', 'issue', 'return_in', 'return_vendor', 'transfer_out',
                  'transfer_in', 'adjustment', 'write_off', 'revalue'));
CREATE INDEX stock_moves_doc_line ON stock_moves (doc_line_id) WHERE kind = 'opening_undo';

-- the openings posted so far: one posting per store, person and moment (one transaction). The ledger is
-- frozen; only this one-time tagging of the old opening moves with their posting passes it.
ALTER TABLE stock_moves DISABLE TRIGGER stock_moves_frozen;
DO $$
DECLARE g RECORD; v_id BIGINT;
BEGIN
  FOR g IN SELECT school_id, store_id, created_by, created_at FROM stock_moves
            WHERE kind = 'opening' AND doc_id IS NULL
            GROUP BY school_id, store_id, created_by, created_at ORDER BY created_at LOOP
    INSERT INTO stock_openings (school_id, store_id, source, created_by, created_at)
    VALUES (g.school_id, g.store_id, 'hand', g.created_by, g.created_at) RETURNING id INTO v_id;
    UPDATE stock_moves SET doc_type = 'opening', doc_id = v_id
     WHERE kind = 'opening' AND doc_id IS NULL AND store_id = g.store_id AND created_at = g.created_at
       AND created_by IS NOT DISTINCT FROM g.created_by;
  END LOOP;
END $$;
ALTER TABLE stock_moves ENABLE TRIGGER stock_moves_frozen;

-- an asset item's opening stock makes one asset per unit; a correction of the opening changes them
ALTER TABLE assets ADD COLUMN opening_move_id BIGINT REFERENCES stock_moves(id);
CREATE INDEX assets_opening ON assets (opening_move_id) WHERE opening_move_id IS NOT NULL;

-- ---- a rate correction: what is left of an item in a store, revalued; the school admin approves ------
CREATE TABLE stock_revaluations (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  number         TEXT NOT NULL,
  store_id       BIGINT NOT NULL REFERENCES stores(id),
  item_id        BIGINT NOT NULL REFERENCES purchase_items(id),
  -- in hand and at what rate when asked; the rate it should be
  qty            NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  old_rate       NUMERIC(14,4) NOT NULL CHECK (old_rate >= 0),
  new_rate       NUMERIC(14,4) NOT NULL CHECK (new_rate >= 0),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  status         TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  decided_at     TIMESTAMPTZ,
  decided_by     BIGINT REFERENCES users(id),
  decision_note  TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CALL app.apply_tenant_rls('stock_revaluations');
CREATE TRIGGER stock_revaluations_audit AFTER INSERT OR UPDATE OR DELETE ON stock_revaluations
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
-- one open rate correction per item and store
CREATE UNIQUE INDEX stock_revaluations_open ON stock_revaluations (store_id, item_id) WHERE status = 'submitted';

ALTER TABLE purchase_numbering DROP CONSTRAINT purchase_numbering_doc_check;
ALTER TABLE purchase_numbering ADD CONSTRAINT purchase_numbering_doc_check
  CHECK (doc IN ('indent', 'requisition', 'order', 'receipt', 'completion', 'issue', 'return', 'transfer', 'count',
                 'asset', 'condemnation', 'revaluation'));

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
  v_prefix := COALESCE(v_prefix, CASE p_doc WHEN 'receipt' THEN 'GRN' WHEN 'completion' THEN 'SCC' WHEN 'issue' THEN 'ISS'
                                            WHEN 'return' THEN 'RTN' WHEN 'transfer' THEN 'TRF' WHEN 'count' THEN 'CNT'
                                            WHEN 'asset' THEN 'AST' WHEN 'condemnation' THEN 'CDN'
                                            WHEN 'revaluation' THEN 'RVL' ELSE upper(left(p_doc, 2)) END);
  RETURN v_prefix || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
END $$;

-- ---- the physical count: each difference's reason from a list (and a note) --------------------------
ALTER TABLE stock_count_lines
  ADD COLUMN reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN (
    'not_found', 'damaged', 'expired', 'issued_no_slip', 'received_no_grn', 'entry_mistake', 'found', 'other'));
-- the lines found but not on the list keep their "found" reason
UPDATE stock_count_lines SET reason_code = 'found' WHERE added AND reason_code IS NULL;
