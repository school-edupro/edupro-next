-- A sub-category's code made from its category (docs/design/83, "Item codes", 7 Nov 2026): AV-01, AV-02 …
-- under AV (the highest number used + 1, typed ones counted). The Add form fills it as the category is
-- picked (it may be typed over); a sub-category saved without a code gets the next one. A main category
-- keeps the short code the school types (STAT, IT …), which the item codes then start with.

CREATE OR REPLACE FUNCTION app.purchase_category_code(p_school BIGINT, p_parent BIGINT)
RETURNS TEXT LANGUAGE plpgsql AS $$
-- volatile on purpose: called after the lock, it reads what was committed meanwhile
DECLARE
  v_prefix TEXT;
  v_next   INT;
BEGIN
  IF p_parent IS NULL THEN
    RETURN NULL;
  END IF;
  -- codes are at most 20 characters with "-01"
  SELECT left(code, 17) INTO v_prefix FROM purchase_item_categories WHERE id = p_parent;
  IF v_prefix IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(max(substr(code, length(v_prefix) + 2)::int), 0) + 1 INTO v_next
    FROM purchase_item_categories
   WHERE school_id = p_school
     AND left(code, length(v_prefix) + 1) = v_prefix || '-'
     AND substr(code, length(v_prefix) + 2) ~ '^[0-9]{1,3}$';
  RETURN v_prefix || '-' || CASE WHEN v_next < 100 THEN lpad(v_next::text, 2, '0') ELSE v_next::text END;
END $$;

CREATE OR REPLACE FUNCTION app.purchase_category_auto_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    IF NEW.parent_id IS NULL THEN
      RAISE EXCEPTION 'purchase.category_code'
        USING DETAIL = 'Type the code of a main category (a sub-category''s is made from its category)';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('purchase_category_code:' || NEW.school_id::text || ':' || NEW.parent_id::text));
    NEW.code := app.purchase_category_code(NEW.school_id, NEW.parent_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_item_categories_auto_code BEFORE INSERT ON purchase_item_categories
  FOR EACH ROW EXECUTE FUNCTION app.purchase_category_auto_code();
