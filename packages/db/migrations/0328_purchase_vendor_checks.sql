-- Vendor form checks and lists from the masters (docs/design/83, "As built — vendor checks", 7 Nov 2026):
-- the address takes its country, state and city from the school's Country / State / City masters (names
-- stored, like the school profile), the bank from the Banks master; a vendor code left blank is made
-- (V-0001, V-0002 …); every school has India and its states (with GST codes) to pick from.

-- the vendor's country and state, as named in the masters (state_code stays the GST state code)
ALTER TABLE vendors
  ADD COLUMN country TEXT CHECK (country IS NULL OR length(country) BETWEEN 2 AND 80),
  ADD COLUMN state   TEXT CHECK (state IS NULL OR length(state) BETWEEN 2 AND 80);

-- a vendor abroad has its own postal code; an Indian PIN (six digits) is checked by the API
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_pin_check;
ALTER TABLE vendors ADD CONSTRAINT vendors_pin_check CHECK (pin IS NULL OR pin ~ '^[A-Z0-9][A-Z0-9 -]{2,9}$');

-- vendors saved before: their state from the GST state code
UPDATE vendors v
   SET state = s.name, country = c.name
  FROM states s JOIN countries c ON c.id = s.country_id
 WHERE s.school_id = v.school_id AND s.gst_code = v.state_code AND v.state IS NULL;

-- the next vendor code of the school: V- and the highest number used + 1 (typed V-codes counted)
CREATE OR REPLACE FUNCTION app.purchase_vendor_code(p_school BIGINT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_next INT;
BEGIN
  SELECT COALESCE(max(substr(code, 3)::int), 0) + 1 INTO v_next
    FROM vendors WHERE school_id = p_school AND code ~ '^V-[0-9]{1,6}$';
  RETURN 'V-' || CASE WHEN v_next < 10000 THEN lpad(v_next::text, 4, '0') ELSE v_next::text END;
END $$;

-- a vendor saved without a code gets the next one (one at a time per school)
CREATE OR REPLACE FUNCTION app.purchase_vendor_auto_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('purchase_vendor_code:' || NEW.school_id::text));
    NEW.code := app.purchase_vendor_code(NEW.school_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vendors_auto_code BEFORE INSERT ON vendors
  FOR EACH ROW EXECUTE FUNCTION app.purchase_vendor_auto_code();

-- the purchase starter masters also give the school India and its states and union territories (with
-- their GST codes), where it has none of them yet; the cities are the school's own (Masters → Cities)
CREATE OR REPLACE FUNCTION app.purchase_seed_masters(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO purchase_uoms (school_id, code, name, decimals)
  SELECT p_school, x.code, x.name, x.d
    FROM (VALUES ('NOS', 'Numbers', false), ('PCS', 'Pieces', false), ('BOX', 'Box', false), ('PKT', 'Packet', false),
                 ('SET', 'Set', false), ('PAIR', 'Pair', false), ('DOZ', 'Dozen', false), ('REAM', 'Ream', false),
                 ('ROLL', 'Roll', false), ('BTL', 'Bottle', false), ('KG', 'Kilogram', true), ('GM', 'Gram', true),
                 ('LTR', 'Litre', true), ('MTR', 'Metre', true), ('SQM', 'Square metre', true), ('HRS', 'Hours', true),
                 ('JOB', 'Job (service)', false), ('MON', 'Month (service)', false)) AS x(code, name, d)
  ON CONFLICT (school_id, code) DO NOTHING;

  INSERT INTO purchase_hsn (school_id, code, kind, description, gst_rate, effective_from)
  SELECT p_school, x.code, 'HSN', x.description, x.rate, DATE '2025-09-22'
    FROM (VALUES ('4901', 'Printed books, brochures and similar printed matter', 0),
                 ('48202000', 'Exercise books, notebooks, graph books, laboratory notebooks', 0),
                 ('9609', 'Pencils, crayons, pastels, drawing charcoals, writing or drawing chalks', 0),
                 ('40169200', 'Erasers of vulcanised rubber', 0),
                 ('82141010', 'Pencil sharpeners', 0),
                 ('4905', 'Maps, atlases, globes and charts', 0),
                 ('8471', 'Computers and their units (laptops, desktops, monitors with them)', 18)) AS x(code, description, rate)
  ON CONFLICT (school_id, code) DO NOTHING;

  INSERT INTO purchase_payment_terms (school_id, code, name, is_default)
  SELECT p_school, 'NET30', 'Within 30 days of the invoice', NOT EXISTS (
           SELECT 1 FROM purchase_payment_terms t WHERE t.school_id = p_school AND t.is_default)
  ON CONFLICT (school_id, code) DO NOTHING;
  INSERT INTO purchase_payment_term_lines (school_id, term_id, seq, pct, due_on, days)
  SELECT p_school, t.id, 1, 100, 'invoice', 30 FROM purchase_payment_terms t
   WHERE t.school_id = p_school AND t.code = 'NET30'
  ON CONFLICT (term_id, seq) DO NOTHING;

  INSERT INTO purchase_settings (school_id) VALUES (p_school) ON CONFLICT (school_id) DO NOTHING;

  INSERT INTO countries (school_id, code, name, dial_code) VALUES (p_school, 'IN', 'India', '+91')
  ON CONFLICT (school_id, code) DO NOTHING;
  INSERT INTO states (school_id, country_id, code, name, gst_code)
  SELECT p_school, c.id, x.code, x.name, x.gst
    FROM countries c
   CROSS JOIN (VALUES ('JK', 'Jammu and Kashmir', '01'), ('HP', 'Himachal Pradesh', '02'), ('PB', 'Punjab', '03'),
                      ('CH', 'Chandigarh', '04'), ('UK', 'Uttarakhand', '05'), ('HR', 'Haryana', '06'), ('DL', 'Delhi', '07'),
                      ('RJ', 'Rajasthan', '08'), ('UP', 'Uttar Pradesh', '09'), ('BR', 'Bihar', '10'), ('SK', 'Sikkim', '11'),
                      ('AR', 'Arunachal Pradesh', '12'), ('NL', 'Nagaland', '13'), ('MN', 'Manipur', '14'), ('MZ', 'Mizoram', '15'),
                      ('TR', 'Tripura', '16'), ('ML', 'Meghalaya', '17'), ('AS', 'Assam', '18'), ('WB', 'West Bengal', '19'),
                      ('JH', 'Jharkhand', '20'), ('OD', 'Odisha', '21'), ('CG', 'Chhattisgarh', '22'), ('MP', 'Madhya Pradesh', '23'),
                      ('GJ', 'Gujarat', '24'), ('DH', 'Dadra and Nagar Haveli and Daman and Diu', '26'), ('MH', 'Maharashtra', '27'),
                      ('KA', 'Karnataka', '29'), ('GA', 'Goa', '30'), ('LD', 'Lakshadweep', '31'), ('KL', 'Kerala', '32'),
                      ('TN', 'Tamil Nadu', '33'), ('PY', 'Puducherry', '34'), ('AN', 'Andaman and Nicobar Islands', '35'),
                      ('TS', 'Telangana', '36'), ('AP', 'Andhra Pradesh', '37'), ('LA', 'Ladakh', '38')) AS x(code, name, gst)
   WHERE c.school_id = p_school AND c.code = 'IN'
     -- a state the school already has (by its GST code or its name) is left as it is
     AND NOT EXISTS (SELECT 1 FROM states s WHERE s.school_id = p_school
                        AND (s.gst_code = x.gst OR lower(s.name) = lower(x.name)))
  ON CONFLICT (school_id, code) DO NOTHING;
$$;

SELECT app.purchase_seed_masters(id) FROM schools WHERE status = 'active';
