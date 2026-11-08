-- An approved indent takes from the stores first (docs/design/83, "As built — indents served from
-- stock", 8 Nov 2026): what the department's store, then the main store, holds free is held for the
-- indent line at approval and goes to the keeper's To issue against the indent; only the rest is bought.
ALTER TABLE stock_reservations
  ALTER COLUMN requisition_line_id DROP NOT NULL,
  ADD COLUMN indent_line_id BIGINT REFERENCES purchase_indent_lines(id) ON DELETE CASCADE,
  ADD CONSTRAINT stock_reservations_for_one CHECK ((requisition_line_id IS NULL) <> (indent_line_id IS NULL));
CREATE INDEX stock_reservations_indent_line ON stock_reservations (indent_line_id) WHERE indent_line_id IS NOT NULL;

ALTER TABLE purchase_indent_lines
  -- held from the stores at approval, in the line's unit (the rest is bought)
  ADD COLUMN stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_qty >= 0);

-- every line served from the stores: the indent goes to the keepers, not to purchase
ALTER TABLE purchase_indents DROP CONSTRAINT purchase_indents_route_check;
ALTER TABLE purchase_indents ADD CONSTRAINT purchase_indents_route_check
  CHECK (route IS NULL OR route IN ('to_requisition', 'to_order', 'in_requisition', 'ordered', 'closed', 'from_store'));
