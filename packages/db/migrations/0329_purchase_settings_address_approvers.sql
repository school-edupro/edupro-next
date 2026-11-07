-- Purchase settings (docs/design/83, "As built — purchase settings checks", 7 Nov 2026): the billing and
-- delivery addresses in parts (line, country, state, city, PIN from the school's masters; the delivery
-- address the billing one unless unticked); the people who approve vendors, named on the settings page.

ALTER TABLE purchase_settings
  ADD COLUMN billing_line     TEXT CHECK (billing_line IS NULL OR length(billing_line) <= 300),
  ADD COLUMN billing_country  TEXT CHECK (billing_country IS NULL OR length(billing_country) <= 80),
  ADD COLUMN billing_state    TEXT CHECK (billing_state IS NULL OR length(billing_state) <= 80),
  ADD COLUMN billing_city     TEXT CHECK (billing_city IS NULL OR length(billing_city) <= 80),
  ADD COLUMN billing_pin      TEXT CHECK (billing_pin IS NULL OR billing_pin ~ '^[A-Z0-9][A-Z0-9 -]{2,9}$'),
  -- the goods come to the billing address unless the school gives another
  ADD COLUMN delivery_same    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN delivery_line    TEXT CHECK (delivery_line IS NULL OR length(delivery_line) <= 300),
  ADD COLUMN delivery_country TEXT CHECK (delivery_country IS NULL OR length(delivery_country) <= 80),
  ADD COLUMN delivery_state   TEXT CHECK (delivery_state IS NULL OR length(delivery_state) <= 80),
  ADD COLUMN delivery_city    TEXT CHECK (delivery_city IS NULL OR length(delivery_city) <= 80),
  ADD COLUMN delivery_pin     TEXT CHECK (delivery_pin IS NULL OR delivery_pin ~ '^[A-Z0-9][A-Z0-9 -]{2,9}$');
-- billing_address / delivery_address stay the whole address as printed (made from the parts on saving)

-- what was typed before becomes the line, to be completed with its country, state and city
UPDATE purchase_settings
   SET billing_line = left(billing_address, 300),
       delivery_same = (delivery_address IS NULL OR delivery_address = billing_address),
       delivery_line = CASE WHEN delivery_address IS DISTINCT FROM billing_address THEN left(delivery_address, 300) END;

-- the vendor approvers named in Purchase → Settings; while none is named, the role right decides
CREATE TABLE purchase_vendor_approvers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, employee_id)
);
CALL app.apply_tenant_rls('purchase_vendor_approvers');
