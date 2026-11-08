-- A PO line for less than the requisition needs (docs/design/83, "As built — a PO line for less", 8 Nov
-- 2026): why (the vendor is short of stock, sold in packs, over budget, no longer needed, other with a
-- note) and what happens to the rest — it waits on To order, or it is closed (not to be ordered). A line
-- waiting on To order can be closed there too, with the same reasons.
ALTER TABLE purchase_order_lines
  ADD COLUMN short_reason  TEXT CHECK (short_reason IN ('vendor_stock', 'pack_size', 'budget', 'not_needed', 'other')),
  ADD COLUMN short_note    TEXT CHECK (short_note IS NULL OR length(short_note) <= 300),
  -- the rest of the requisition line is not to be ordered (while this PO counts)
  ADD COLUMN close_rest    BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT purchase_order_lines_close_rest_reason CHECK (NOT close_rest OR short_reason IS NOT NULL),
  ADD CONSTRAINT purchase_order_lines_short_other_note CHECK (short_reason IS DISTINCT FROM 'other' OR length(btrim(short_note)) > 0);

ALTER TABLE purchase_requisition_lines
  ADD COLUMN closed_reason  TEXT CHECK (closed_reason IN ('vendor_stock', 'pack_size', 'budget', 'not_needed', 'other')),
  ADD COLUMN closed_note    TEXT CHECK (closed_note IS NULL OR length(closed_note) <= 300),
  ADD COLUMN closed_by      BIGINT REFERENCES users (id),
  ADD COLUMN closed_at      TIMESTAMPTZ,
  ADD CONSTRAINT purchase_requisition_lines_closed CHECK ((closed_at IS NULL) = (closed_reason IS NULL));
