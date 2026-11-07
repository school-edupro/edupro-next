-- Item codes made from the item's category and sub-category (docs/design/83, "Item codes", 7 Nov 2026):
-- STAT-PAPER-0001, STAT-PAPER-0002 … counted per sub-category; STAT-0001 for an item with no sub-category.
-- A sub-category code that already starts with its category's ("STAT-PAPER" under "STAT") is not
-- repeated; "PENS" under "STAT" gives STAT-PENS-0001. The Add form fills the next code (and may be typed
-- over); an item saved without a code (the form left as filled, a blank cell in an Excel upload) gets
-- the next one here, at the moment it is saved. A code, once given, never changes with the category.

-- the prefix of an item's code
CREATE OR REPLACE FUNCTION app.purchase_item_code_prefix(p_category BIGINT, p_sub BIGINT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN s.code IS NULL THEN c.code
           WHEN starts_with(s.code, c.code || '-') THEN s.code
           -- the code is at most 30 characters with "-0001": a long pair keeps the sub-category's alone
           WHEN length(c.code || '-' || s.code) <= 25 THEN c.code || '-' || s.code
           ELSE s.code
         END
    FROM purchase_item_categories c
    LEFT JOIN purchase_item_categories s ON s.id = p_sub
   WHERE c.id = p_category
$$;

-- the next free code of that prefix in the school (the highest number used + 1, typed codes included)
CREATE OR REPLACE FUNCTION app.purchase_item_code(p_school BIGINT, p_category BIGINT, p_sub BIGINT)
RETURNS TEXT LANGUAGE plpgsql AS $$
-- volatile on purpose: called after the lock, it reads what was committed meanwhile
DECLARE
  v_prefix TEXT := app.purchase_item_code_prefix(p_category, p_sub);
  v_next   INT;
BEGIN
  IF v_prefix IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(max(substr(code, length(v_prefix) + 2)::int), 0) + 1 INTO v_next
    FROM purchase_items
   WHERE school_id = p_school
     AND left(code, length(v_prefix) + 1) = v_prefix || '-'
     AND substr(code, length(v_prefix) + 2) ~ '^[0-9]{1,6}$';
  RETURN v_prefix || '-' || CASE WHEN v_next < 10000 THEN lpad(v_next::text, 4, '0') ELSE v_next::text END;
END $$;

-- an item saved without a code gets the next one; one at a time per prefix in the school, so two
-- people saving at once never get the same number (the masters' save would otherwise update the other)
CREATE OR REPLACE FUNCTION app.purchase_item_auto_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('purchase_item_code:' || NEW.school_id::text || ':'
               || COALESCE(app.purchase_item_code_prefix(NEW.category_id, NEW.sub_category_id), '')));
    NEW.code := app.purchase_item_code(NEW.school_id, NEW.category_id, NEW.sub_category_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_items_auto_code BEFORE INSERT ON purchase_items
  FOR EACH ROW EXECUTE FUNCTION app.purchase_item_auto_code();
