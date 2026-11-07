-- What the store held when a Purchase Indent line was raised, and why it is bought anyway (docs/design/83,
-- "As built — rates hidden from the raiser; the stock when raised; the printed PI", 7 Nov 2026).
ALTER TABLE purchase_indent_lines
  -- the free stock (in hand less reserved) of the item in the main store and the PI department's stores,
  -- in the store unit, when the line was saved and again when the PI was sent; NULL for a line in words
  -- or an item not kept in stock
  ADD COLUMN stock_free    NUMERIC(14,3) CHECK (stock_free IS NULL OR stock_free >= 0),
  -- the stores that held it then: [{"store": "Main store", "free": 30}, ...]
  ADD COLUMN stock_stores  JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stock_stores) = 'array'),
  -- the raiser's reason for buying when those stores had enough free stock for the quantity
  ADD COLUMN stock_reason  TEXT CHECK (stock_reason IS NULL OR length(btrim(stock_reason)) BETWEEN 3 AND 300);
