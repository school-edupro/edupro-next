-- Purchase, part 1 (docs/design/83-purchase-module.md): the masters a Purchase Indent, Requisition and
-- Order pick from — units, HSN / SAC codes with GST, item categories and items, payment terms in
-- instalments, the school's common vendor master (maker-checker: a new vendor and a change of its bank
-- account, GSTIN or PAN wait for a second person), rate contracts, the purchase settings, the purchase
-- committee, and who approves PIs, PRs and POs per department (levels as the workflow engine's staff
-- resolver keeps them: named employees, a designation, or the department's HOD). Each school its own.

-- ---- rights and the Purchase office role ------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.master.view', 'purchase', 'See the purchase masters: units, HSN / SAC, items, vendors, payment terms, rate contracts'),
  ('purchase.master.manage', 'purchase', 'Add and change the purchase masters (a new vendor or a bank / GSTIN / PAN change waits for approval)'),
  ('purchase.vendor.approve', 'purchase', 'Approve a new vendor or a change of its bank account, GSTIN or PAN (never one you entered)'),
  ('purchase.settings.manage', 'purchase', 'Purchase settings, the purchase committee and who approves PIs, PRs and POs per department')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'purchase_office', 'Purchase office', 'module', true,
   'Keeps the purchase masters (items, vendors, payment terms, rate contracts); a vendor it adds waits for approval')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code = 'purchase_office'
   AND p.code IN ('purchase.master.view', 'purchase.master.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
   AND p.code IN ('purchase.master.view', 'purchase.master.manage', 'purchase.vendor.approve', 'purchase.settings.manage')
ON CONFLICT DO NOTHING;

-- ---- units -----------------------------------------------------------------------------------------
CREATE TABLE purchase_uoms (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9]{1,10}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- a quantity may have decimals (kg, litre, metre); no for pieces, boxes, sets
  decimals    BOOLEAN NOT NULL DEFAULT false,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('purchase_uoms');

-- ---- HSN (goods) / SAC (services) with their GST rate ---------------------------------------------
CREATE TABLE purchase_hsn (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  code            TEXT NOT NULL CHECK (code ~ '^[0-9]{4,8}$'),
  kind            TEXT NOT NULL DEFAULT 'HSN' CHECK (kind IN ('HSN', 'SAC')),
  description     TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 300),
  gst_rate        NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (gst_rate BETWEEN 0 AND 40),
  -- the school pays the GST itself (reverse charge): the vendor charges none on the PO
  reverse_charge  BOOLEAN NOT NULL DEFAULT false,
  -- exempt when supplied to the school (e.g. some services to a school up to higher secondary)
  exempt          BOOLEAN NOT NULL DEFAULT false,
  effective_from  DATE,
  status          row_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('purchase_hsn');
-- the rate's history is the audit trail: every change of a code is kept
CREATE TRIGGER purchase_hsn_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_hsn
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- item categories: a category, and its sub-categories (parent set) -------------------------------
CREATE TABLE purchase_item_categories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,20}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  parent_id   BIGINT REFERENCES purchase_item_categories(id),
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CALL app.apply_tenant_rls('purchase_item_categories');

-- two levels only: a sub-category's parent is a category (not another sub-category), and a category
-- with sub-categories cannot become one
CREATE OR REPLACE FUNCTION app.purchase_category_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM purchase_item_categories p WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'purchase.category_depth' USING DETAIL = 'A sub-category belongs to a category, not to another sub-category';
    END IF;
    IF EXISTS (SELECT 1 FROM purchase_item_categories c WHERE c.parent_id = NEW.id) THEN
      RAISE EXCEPTION 'purchase.category_depth' USING DETAIL = 'This category has sub-categories: it cannot become a sub-category';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_category_depth BEFORE INSERT OR UPDATE OF parent_id ON purchase_item_categories
  FOR EACH ROW EXECUTE FUNCTION app.purchase_category_depth();

-- ---- items -----------------------------------------------------------------------------------------
CREATE TABLE purchase_items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  code                TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_./-]{1,30}$'),
  name                TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 150),
  specification       TEXT CHECK (specification IS NULL OR length(specification) <= 1000),
  item_type           TEXT NOT NULL DEFAULT 'consumable' CHECK (item_type IN ('consumable', 'asset', 'service')),
  category_id         BIGINT NOT NULL REFERENCES purchase_item_categories(id),
  sub_category_id     BIGINT REFERENCES purchase_item_categories(id),
  uom_id              BIGINT NOT NULL REFERENCES purchase_uoms(id),
  hsn_id              BIGINT REFERENCES purchase_hsn(id),
  -- the item's own GST rate when it differs from its HSN's (NULL: the HSN's)
  gst_rate            NUMERIC(5,2) CHECK (gst_rate IS NULL OR gst_rate BETWEEN 0 AND 40),
  brand               TEXT CHECK (brand IS NULL OR length(brand) <= 80),
  -- kept by the PO (part 4): the rate and date of the last approved purchase
  last_purchase_rate  NUMERIC(14,2),
  last_purchased_on   DATE,
  status              row_status NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('purchase_items');
CREATE INDEX purchase_items_category ON purchase_items (category_id);

-- an item's category is a category; its sub-category belongs to that category
CREATE OR REPLACE FUNCTION app.purchase_item_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_item_categories c WHERE c.id = NEW.category_id AND c.parent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'purchase.item_category' USING DETAIL = 'Choose a category, not a sub-category, as the item''s category';
  END IF;
  IF NEW.sub_category_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM purchase_item_categories s WHERE s.id = NEW.sub_category_id AND s.parent_id = NEW.category_id) THEN
    RAISE EXCEPTION 'purchase.item_category' USING DETAIL = 'The sub-category does not belong to the item''s category';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_item_category BEFORE INSERT OR UPDATE OF category_id, sub_category_id ON purchase_items
  FOR EACH ROW EXECUTE FUNCTION app.purchase_item_category();

-- ---- payment terms: one or more instalments --------------------------------------------------------
CREATE TABLE purchase_payment_terms (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,20}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  -- the words printed on the PO (empty: made from the instalments)
  print_text  TEXT CHECK (print_text IS NULL OR length(print_text) <= 500),
  is_default  BOOLEAN NOT NULL DEFAULT false,
  status      row_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('purchase_payment_terms');
CREATE UNIQUE INDEX purchase_payment_terms_default ON purchase_payment_terms (school_id) WHERE is_default;

CREATE TABLE purchase_payment_term_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  term_id     BIGINT NOT NULL REFERENCES purchase_payment_terms(id) ON DELETE CASCADE,
  seq         INT NOT NULL CHECK (seq BETWEEN 1 AND 12),
  pct         NUMERIC(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  -- when the instalment falls due: in advance (with the order), after delivery, after the invoice
  due_on      TEXT NOT NULL CHECK (due_on IN ('advance', 'delivery', 'invoice')),
  days        INT NOT NULL DEFAULT 0 CHECK (days BETWEEN 0 AND 365),
  UNIQUE (term_id, seq)
);
CALL app.apply_tenant_rls('purchase_payment_term_lines');

-- ---- vendors (one common master of the school) -----------------------------------------------------
CREATE TABLE vendors (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  code              TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,20}$'),
  legal_name        TEXT NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 2 AND 150),
  trade_name        TEXT CHECK (trade_name IS NULL OR length(trade_name) <= 150),
  kind              TEXT NOT NULL DEFAULT 'dealer' CHECK (kind IN ('manufacturer', 'dealer', 'service_provider')),
  gst_status        TEXT NOT NULL DEFAULT 'regular' CHECK (gst_status IN ('regular', 'composition', 'unregistered')),
  gstin             TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan               TEXT CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  -- the GST state code: the GSTIN's first two digits (or chosen for an unregistered vendor)
  state_code        TEXT CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  msme_type         TEXT CHECK (msme_type IS NULL OR msme_type IN ('micro', 'small', 'medium')),
  udyam_no          TEXT CHECK (udyam_no IS NULL OR udyam_no ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  address           TEXT CHECK (address IS NULL OR length(address) <= 500),
  city              TEXT,
  pin               TEXT CHECK (pin IS NULL OR pin ~ '^[1-9][0-9]{5}$'),
  phone             TEXT CHECK (phone IS NULL OR phone ~ '^[0-9+ -]{7,20}$'),
  email             TEXT CHECK (email IS NULL OR length(email) <= 150),
  -- the bank account, encrypted by the API (field crypto); `bank_hint` is what screens show
  bank_secure       TEXT,
  bank_hint         TEXT,
  category_ids      BIGINT[] NOT NULL DEFAULT '{}',
  payment_term_id   BIGINT REFERENCES purchase_payment_terms(id),
  -- pending: added, waiting for a second person; rejected: not approved; blacklisted: never offered
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'blacklisted', 'rejected')),
  status_reason     TEXT CHECK (status_reason IS NULL OR length(status_reason) <= 500),
  created_by        BIGINT REFERENCES users(id),
  approved_by       BIGINT REFERENCES users(id),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  CHECK (gst_status = 'unregistered' OR gstin IS NOT NULL),
  CHECK (gstin IS NULL OR pan IS NULL OR substr(gstin, 3, 10) = pan)
);
CALL app.apply_tenant_rls('vendors');
CREATE INDEX vendors_gstin ON vendors (school_id, gstin) WHERE gstin IS NOT NULL;
CREATE INDEX vendors_pan ON vendors (school_id, pan) WHERE pan IS NOT NULL;
CREATE TRIGGER vendors_audit AFTER INSERT OR UPDATE OR DELETE ON vendors
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change('bank_secure');

CREATE TABLE vendor_contacts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  vendor_id   BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  role        TEXT CHECK (role IS NULL OR length(role) <= 60),
  phone       TEXT CHECK (phone IS NULL OR phone ~ '^[0-9+ -]{7,20}$'),
  email       TEXT CHECK (email IS NULL OR length(email) <= 150),
  is_main     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('vendor_contacts');
CREATE INDEX vendor_contacts_vendor ON vendor_contacts (vendor_id);

CREATE TABLE vendor_documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  vendor_id    BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('gst_certificate', 'pan_card', 'cancelled_cheque', 'udyam_certificate', 'agreement', 'other')),
  file_id      BIGINT NOT NULL REFERENCES files(id),
  uploaded_by  BIGINT REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('vendor_documents');
CREATE INDEX vendor_documents_vendor ON vendor_documents (vendor_id);

-- a change of a vendor's bank account, GSTIN or PAN waiting for a second person: `changes` holds the new
-- values (the bank encrypted), `before` what the screen showed (the bank as its hint); one at a time
CREATE TABLE vendor_changes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  vendor_id     BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  changes       JSONB NOT NULL,
  before        JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason        TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by  BIGINT REFERENCES users(id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    BIGINT REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500)
);
CALL app.apply_tenant_rls('vendor_changes');
CREATE UNIQUE INDEX vendor_changes_one_pending ON vendor_changes (vendor_id) WHERE status = 'pending';
CREATE TRIGGER vendor_changes_audit AFTER INSERT OR UPDATE OR DELETE ON vendor_changes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- rate contracts: an agreed vendor and price of an item for a period -----------------------------
CREATE TABLE purchase_rate_contracts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  vendor_id      BIGINT NOT NULL REFERENCES vendors(id),
  item_id        BIGINT NOT NULL REFERENCES purchase_items(id),
  rate           NUMERIC(14,2) NOT NULL CHECK (rate > 0),
  gst_inclusive  BOOLEAN NOT NULL DEFAULT false,
  valid_from     DATE NOT NULL,
  valid_to       DATE NOT NULL,
  reference      TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  status         row_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, item_id, valid_from),
  CHECK (valid_to >= valid_from)
);
CALL app.apply_tenant_rls('purchase_rate_contracts');
CREATE INDEX purchase_rate_contracts_item ON purchase_rate_contracts (item_id, valid_from, valid_to);
CREATE TRIGGER purchase_rate_contracts_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_rate_contracts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- one active contract per item on any day; only an active vendor holds a contract
CREATE OR REPLACE FUNCTION app.purchase_rate_contract_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_other TEXT;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT to_char(o.valid_from, 'DD-Mon-YYYY') || ' to ' || to_char(o.valid_to, 'DD-Mon-YYYY') INTO v_other
      FROM purchase_rate_contracts o
     WHERE o.school_id = NEW.school_id AND o.item_id = NEW.item_id AND o.status = 'active' AND o.id <> COALESCE(NEW.id, -1)
       AND daterange(o.valid_from, o.valid_to, '[]') && daterange(NEW.valid_from, NEW.valid_to, '[]')
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'purchase.rate_contract_overlap' USING DETAIL = 'The item already has a rate contract from ' || v_other;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vendors v WHERE v.id = NEW.vendor_id AND v.status = 'active') THEN
      RAISE EXCEPTION 'purchase.vendor_not_active' USING DETAIL = 'Only an active (approved) vendor can hold a rate contract';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_rate_contract_check BEFORE INSERT OR UPDATE ON purchase_rate_contracts
  FOR EACH ROW EXECUTE FUNCTION app.purchase_rate_contract_check();

-- ---- settings, the purchase committee, approvals per department ------------------------------------
CREATE TABLE purchase_settings (
  school_id               BIGINT PRIMARY KEY REFERENCES schools(id),
  gstin                   TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code              TEXT CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  billing_address         TEXT CHECK (billing_address IS NULL OR length(billing_address) <= 500),
  delivery_address        TEXT CHECK (delivery_address IS NULL OR length(delivery_address) <= 500),
  pi_prefix               TEXT NOT NULL DEFAULT 'PI' CHECK (pi_prefix ~ '^[A-Z0-9-]{1,10}$'),
  pr_prefix               TEXT NOT NULL DEFAULT 'PR' CHECK (pr_prefix ~ '^[A-Z0-9-]{1,10}$'),
  po_prefix               TEXT NOT NULL DEFAULT 'PO' CHECK (po_prefix ~ '^[A-Z0-9-]{1,10}$'),
  -- sourcing tiers (GFR 2017 rules 154 / 155 by default): direct up to `direct_limit` with a
  -- certificate, the committee with quotes up to `committee_limit`, a tender above
  direct_limit            NUMERIC(14,2) NOT NULL DEFAULT 50000 CHECK (direct_limit >= 0),
  committee_limit         NUMERIC(14,2) NOT NULL DEFAULT 250000,
  committee_quotes        INT NOT NULL DEFAULT 3 CHECK (committee_quotes BETWEEN 1 AND 10),
  -- how many committee members must sign a comparative statement (NULL: all of them)
  committee_signatures    INT CHECK (committee_signatures IS NULL OR committee_signatures BETWEEN 1 AND 20),
  emergency_enabled       BOOLEAN NOT NULL DEFAULT true,
  po_terms                TEXT CHECK (po_terms IS NULL OR length(po_terms) <= 4000),
  po_validity_days        INT NOT NULL DEFAULT 30 CHECK (po_validity_days BETWEEN 1 AND 365),
  -- the department whose levels approve a PR that combines departments
  purchase_department_id  BIGINT REFERENCES departments(id),
  po_signatures           TEXT[] NOT NULL DEFAULT ARRAY['Prepared by', 'Checked by', 'Approved by'],
  -- the dashboard lists POs above this amount (information only: no approver is added)
  large_po_alert          NUMERIC(14,2) CHECK (large_po_alert IS NULL OR large_po_alert > 0),
  split_window_days       INT NOT NULL DEFAULT 30 CHECK (split_window_days BETWEEN 1 AND 365),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by              BIGINT REFERENCES users(id),
  CHECK (committee_limit >= direct_limit)
);
CALL app.apply_tenant_rls('purchase_settings');
CREATE TRIGGER purchase_settings_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE purchase_committee_members (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  role         TEXT CHECK (role IS NULL OR length(role) <= 60),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, employee_id)
);
CALL app.apply_tenant_rls('purchase_committee_members');

-- who approves a department's PIs, PRs and POs: up to 3 levels, each as the workflow engine's staff
-- resolver keeps it ({name, by: employees | designation | hod, employeeIds, designation, slaHours})
CREATE TABLE purchase_department_approvals (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  department_id  BIGINT NOT NULL REFERENCES departments(id),
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('indent', 'requisition', 'order')),
  levels         JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(levels) = 'array' AND jsonb_array_length(levels) <= 3),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT REFERENCES users(id),
  UNIQUE (school_id, department_id, doc_type)
);
CALL app.apply_tenant_rls('purchase_department_approvals');
CREATE TRIGGER purchase_department_approvals_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_department_approvals
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the department's bypass rules (part 2): a PI under `bypass_limit` skips the PR (0 = off); all lines on
-- rate contract skip it when `rate_contract_bypass`
CREATE TABLE purchase_department_rules (
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  department_id         BIGINT NOT NULL REFERENCES departments(id),
  bypass_limit          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (bypass_limit >= 0),
  rate_contract_bypass  BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            BIGINT REFERENCES users(id),
  PRIMARY KEY (school_id, department_id)
);
CALL app.apply_tenant_rls('purchase_department_rules');
CREATE TRIGGER purchase_department_rules_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_department_rules
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- what every school starts with -----------------------------------------------------------------
-- units; a short HSN list whose rates are settled (the GST changes of 22 Sep 2025 made school stationery
-- nil-rated) — the school adds the rest and confirms rates with its CA; one payment term
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
$$;

SELECT app.purchase_seed_masters(id) FROM schools WHERE status = 'active';
