-- Purchase, part 4 (docs/design/83): the Purchase Order (PO) — drafted per vendor from an approved
-- requisition (or made by the purchase office from its lines), GST worked out by the vendor's and the
-- school's states (CGST + SGST, IGST, none from an unregistered or composition vendor, reverse charge
-- paid by the school), approved on the department's PO levels (the maker never approves it), printed
-- and e-mailed to the vendor, closed, cancelled or amended (a new revision approved again). An
-- emergency purchase is recorded after the fact with the vendor's bill and ratified by the Principal.

-- ---- rights ----------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.order.manage', 'purchase', 'Make, change and send Purchase Orders; close, amend them'),
  ('purchase.order.cancel', 'purchase', 'Cancel an approved Purchase Order (with the reason)'),
  ('purchase.emergency.record', 'purchase', 'Record an emergency purchase after the fact, for ratification')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
   AND p.code IN ('purchase.order.manage', 'purchase.order.cancel', 'purchase.emergency.record')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code = 'purchase_office'
   AND p.code IN ('purchase.order.manage', 'purchase.emergency.record')
ON CONFLICT DO NOTHING;

-- who ratifies an emergency purchase: everyone with this designation (the school admin when nobody)
ALTER TABLE purchase_settings
  ADD COLUMN emergency_ratifier TEXT NOT NULL DEFAULT 'Principal'
    CHECK (length(btrim(emergency_ratifier)) BETWEEN 2 AND 80);

-- ---- the order -------------------------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  number                TEXT NOT NULL,
  -- an amendment is the next revision of the same number (R1, R2...); the one it replaces is superseded
  revision              INT NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 99),
  supersedes_id         BIGINT REFERENCES purchase_orders(id),
  amend_reason          TEXT CHECK (amend_reason IS NULL OR length(amend_reason) <= 500),
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'approved', 'sent', 'closed', 'rejected', 'sent_back', 'cancelled', 'superseded')),
  -- recorded after the fact (no indent, no requisition): ratified on the emergency level
  emergency             BOOLEAN NOT NULL DEFAULT false,
  emergency_reason      TEXT CHECK (emergency_reason IS NULL OR length(emergency_reason) <= 1000),
  bill_file_id          BIGINT REFERENCES files(id),
  bill_ref              TEXT CHECK (bill_ref IS NULL OR length(bill_ref) <= 60),
  requisition_id        BIGINT REFERENCES purchase_requisitions(id),
  department_id         BIGINT REFERENCES departments(id),
  vendor_id             BIGINT NOT NULL REFERENCES vendors(id),
  -- the vendor's GST position when the PO was last worked out (it decides the tax)
  vendor_gst_status     TEXT NOT NULL CHECK (vendor_gst_status IN ('regular', 'composition', 'unregistered')),
  vendor_state_code     TEXT,
  supply                TEXT NOT NULL DEFAULT 'intra' CHECK (supply IN ('intra', 'inter')),
  quote_ref             TEXT CHECK (quote_ref IS NULL OR length(quote_ref) <= 60),
  po_date               DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  delivery_date         DATE,
  delivery_address      TEXT CHECK (delivery_address IS NULL OR length(delivery_address) <= 500),
  payment_term_id       BIGINT REFERENCES purchase_payment_terms(id),
  payment_text          TEXT CHECK (payment_text IS NULL OR length(payment_text) <= 500),
  validity_days         INT NOT NULL DEFAULT 30 CHECK (validity_days BETWEEN 1 AND 365),
  terms                 TEXT CHECK (terms IS NULL OR length(terms) <= 4000),
  -- a payment term over 45 days for a micro or small vendor (MSMED Act s.15), worded
  msme_warning          TEXT,
  taxable               NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- GST the school pays itself under reverse charge (not in the vendor's total)
  rcm_gst               NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off             NUMERIC(6,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  submitted_at          TIMESTAMPTZ,
  decided_at            TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  decision_note         TEXT,
  sent_at               TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  closed_note           TEXT,
  created_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number, revision),
  CHECK (NOT emergency OR (emergency_reason IS NOT NULL AND requisition_id IS NULL))
);
CALL app.apply_tenant_rls('purchase_orders');
CREATE TRIGGER purchase_orders_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX purchase_orders_requisition ON purchase_orders (requisition_id);
CREATE INDEX purchase_orders_vendor ON purchase_orders (vendor_id);

CREATE TABLE purchase_order_lines (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  order_id             BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  seq                  INT NOT NULL CHECK (seq BETWEEN 1 AND 500),
  requisition_line_id  BIGINT REFERENCES purchase_requisition_lines(id),
  item_id              BIGINT REFERENCES purchase_items(id),
  description          TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  hsn_code             TEXT CHECK (hsn_code IS NULL OR hsn_code ~ '^[0-9]{4,8}$'),
  quantity             NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  uom_id               BIGINT NOT NULL REFERENCES purchase_uoms(id),
  rate                 NUMERIC(14,2) NOT NULL CHECK (rate >= 0),
  discount_pct         NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  gst_rate             NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 40),
  -- the school pays the GST (the vendor charges none) / the supply is exempt for the school
  reverse_charge       BOOLEAN NOT NULL DEFAULT false,
  exempt               BOOLEAN NOT NULL DEFAULT false,
  taxable              NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  rcm_gst              NUMERIC(14,2) NOT NULL DEFAULT 0,
  total                NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- a rate-contract line: the contract and, when its rate was changed, why
  contract_id          BIGINT REFERENCES purchase_rate_contracts(id),
  rate_change_reason   TEXT CHECK (rate_change_reason IS NULL OR length(rate_change_reason) <= 300),
  UNIQUE (order_id, seq)
);
CALL app.apply_tenant_rls('purchase_order_lines');
CREATE INDEX purchase_order_lines_requisition_line ON purchase_order_lines (requisition_line_id);

CREATE TABLE purchase_order_charges (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  order_id   BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('freight', 'installation', 'packing', 'other')),
  label      TEXT CHECK (label IS NULL OR length(label) <= 80),
  amount     NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  gst_rate   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 40),
  cgst       NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst       NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total      NUMERIC(14,2) NOT NULL DEFAULT 0
);
CALL app.apply_tenant_rls('purchase_order_charges');
CREATE INDEX purchase_order_charges_order ON purchase_order_charges (order_id);

-- each e-mail of the PO to the vendor (the PDF kept as a file, the message in the outbox)
CREATE TABLE purchase_order_sends (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  order_id    BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  to_address  TEXT NOT NULL,
  file_id     BIGINT REFERENCES files(id),
  message_id  BIGINT REFERENCES comms_messages(id),
  sent_by     BIGINT REFERENCES users(id),
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('purchase_order_sends');
CREATE INDEX purchase_order_sends_order ON purchase_order_sends (order_id);

-- ---- the e-mail to the vendor (the school edits it on Communication → Templates) ------------------
CREATE OR REPLACE FUNCTION app.purchase_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  VALUES (p_school, 'purchase_order', 'email', 'Purchase: order to the vendor',
          'Purchase Order {{number}} from {{school}}',
          'Dear {{vendor}}, please find attached our Purchase Order {{number}} dated {{date}} for {{amount}}. '
          || 'Kindly confirm that you accept it and deliver by {{delivery}} to {{address}}. '
          || 'Please quote the order number on your invoice and delivery challan. For any question, write to {{contact}}. '
          || 'Regards, {{signatory}}, {{school}}',
          '["vendor","number","date","amount","delivery","address","contact","signatory","school"]'::jsonb, 'service')
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.purchase_seed_templates(id) FROM schools WHERE status = 'active';
