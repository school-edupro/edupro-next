-- The Purchase Order printed as the school's own format (docs/design/83, "As built — the PO format", 8
-- Nov 2026): the bill-to legal name and contacts, the ship-to place and contacts, freight terms and a
-- note to the vendor on the PO, the make and model on its lines.
ALTER TABLE purchase_settings
  -- the legal entity invoices are made out to (a society or trust); empty: the school's name
  ADD COLUMN bill_to_name        TEXT CHECK (bill_to_name IS NULL OR length(btrim(bill_to_name)) BETWEEN 2 AND 160),
  ADD COLUMN bill_contact_name   TEXT CHECK (bill_contact_name IS NULL OR length(bill_contact_name) <= 80),
  ADD COLUMN bill_contact_phone  TEXT CHECK (bill_contact_phone IS NULL OR length(bill_contact_phone) <= 30),
  -- where goods are delivered (a campus or block); empty: the school's name
  ADD COLUMN ship_to_name        TEXT CHECK (ship_to_name IS NULL OR length(btrim(ship_to_name)) BETWEEN 2 AND 160),
  ADD COLUMN ship_contact_name   TEXT CHECK (ship_contact_name IS NULL OR length(ship_contact_name) <= 80),
  ADD COLUMN ship_contact_phone  TEXT CHECK (ship_contact_phone IS NULL OR length(ship_contact_phone) <= 30);

ALTER TABLE purchase_orders
  ADD COLUMN freight_terms  TEXT CHECK (freight_terms IS NULL OR length(freight_terms) <= 300),
  ADD COLUMN vendor_note    TEXT CHECK (vendor_note IS NULL OR length(vendor_note) <= 1000);

ALTER TABLE purchase_order_lines
  ADD COLUMN make   TEXT CHECK (make IS NULL OR length(make) <= 80),
  ADD COLUMN model  TEXT CHECK (model IS NULL OR length(model) <= 80);

-- the lines already drafted take their item's brand as the make
UPDATE purchase_order_lines l SET make = i.brand
  FROM purchase_items i
 WHERE i.id = l.item_id AND l.make IS NULL AND i.brand IS NOT NULL AND length(i.brand) <= 80;
