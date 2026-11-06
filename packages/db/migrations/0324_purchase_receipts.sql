-- Purchase phase 2, part 7 (docs/design/84): goods received against a PO and the services' completion
-- certificates — the keeper records what came (per PO line received, refused at the door with the
-- reason, batch and expiry, serial numbers; beyond the PO only within the tolerance), the PO's
-- department inspects and accepts (its Inspection levels on Purchase → Who approves, the HOD by
-- default; above the committee limit the purchase committee signs), the accepted quantity enters the
-- store at the PO line's cost and what was bought for an indent is issued at once to its department.
-- The PO lines keep their received, accepted and rejected quantities; the PO shows part received /
-- received and closes by itself when every line is accepted in full.

-- ---- settings -------------------------------------------------------------------------------------
ALTER TABLE purchase_settings
  -- the GST paid is part of the stock cost (a school rarely takes input credit)
  ADD COLUMN stock_gst_in_cost      BOOLEAN NOT NULL DEFAULT true,
  -- how much more than ordered a delivery may bring (per PO line); beyond it is refused
  ADD COLUMN receipt_tolerance_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
                                      CHECK (receipt_tolerance_pct BETWEEN 0 AND 50);

-- who inspects receipts, per department (the HOD when not set)
ALTER TABLE purchase_department_approvals DROP CONSTRAINT purchase_department_approvals_doc_type_check;
ALTER TABLE purchase_department_approvals ADD CONSTRAINT purchase_department_approvals_doc_type_check
  CHECK (doc_type IN ('indent', 'requisition', 'order', 'inspection'));

-- ---- numbering: completion certificates -------------------------------------------------------------
ALTER TABLE purchase_numbering DROP CONSTRAINT purchase_numbering_doc_check;
ALTER TABLE purchase_numbering ADD CONSTRAINT purchase_numbering_doc_check
  CHECK (doc IN ('indent', 'requisition', 'order', 'receipt', 'completion', 'issue', 'return', 'transfer', 'count',
                 'asset', 'condemnation'));

CREATE OR REPLACE FUNCTION app.purchase_next_number(p_doc TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_fy TEXT := app.purchase_fy((now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_no INT;
  v_prefix TEXT;
BEGIN
  INSERT INTO purchase_numbering (school_id, doc, fy, next_no) VALUES (app.current_school_id(), p_doc, v_fy, 2)
  ON CONFLICT (school_id, doc, fy) DO UPDATE SET next_no = purchase_numbering.next_no + 1
  RETURNING next_no - 1 INTO v_no;
  SELECT CASE p_doc WHEN 'indent' THEN pi_prefix WHEN 'requisition' THEN pr_prefix WHEN 'order' THEN po_prefix END INTO v_prefix
    FROM purchase_settings WHERE school_id = app.current_school_id();
  v_prefix := COALESCE(v_prefix, CASE p_doc WHEN 'receipt' THEN 'GRN' WHEN 'completion' THEN 'SCC' WHEN 'issue' THEN 'ISS'
                                            WHEN 'return' THEN 'RTN' WHEN 'transfer' THEN 'TRF' WHEN 'count' THEN 'CNT'
                                            WHEN 'asset' THEN 'AST' WHEN 'condemnation' THEN 'CDN' ELSE upper(left(p_doc, 2)) END);
  RETURN v_prefix || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
END $$;

-- ---- the PO's received quantities -------------------------------------------------------------------
ALTER TABLE purchase_orders
  -- nothing received yet / some / everything ordered has come (accepted or waiting for inspection)
  ADD COLUMN receipt_status TEXT NOT NULL DEFAULT 'none' CHECK (receipt_status IN ('none', 'part', 'received'));
ALTER TABLE purchase_order_lines
  -- in the PO line's unit: taken in (not refused at the door), accepted at inspection, rejected at inspection
  ADD COLUMN received_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  ADD COLUMN accepted_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
  ADD COLUMN rejected_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0);

-- ---- goods receipts (GRN) and completion certificates --------------------------------------------------
CREATE TABLE goods_receipts (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  number                TEXT NOT NULL,
  -- goods (a GRN into a store) or services (a completion certificate)
  kind                  TEXT NOT NULL CHECK (kind IN ('goods', 'service')),
  order_id              BIGINT NOT NULL REFERENCES purchase_orders(id),
  store_id              BIGINT REFERENCES stores(id),
  received_on           DATE NOT NULL,
  challan_no            TEXT CHECK (challan_no IS NULL OR length(btrim(challan_no)) BETWEEN 1 AND 60),
  challan_date          DATE,
  invoice_no            TEXT CHECK (invoice_no IS NULL OR length(btrim(invoice_no)) BETWEEN 1 AND 60),
  invoice_date          DATE,
  -- a photo or PDF of the challan / invoice (or of the work done)
  file_id               BIGINT REFERENCES files(id),
  note                  TEXT CHECK (note IS NULL OR length(note) <= 1000),
  -- waiting for inspection → accepted (in full or in part) / rejected (all of it) / cancelled (entered wrongly)
  status                TEXT NOT NULL DEFAULT 'inspecting'
                          CHECK (status IN ('inspecting', 'accepted', 'rejected', 'cancelled')),
  -- the PO department's inspection levels, or the purchase committee (above the committee limit)
  inspection            TEXT NOT NULL CHECK (inspection IN ('department', 'committee')),
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  -- the acceptance date (the MSME 45 days run from it)
  accepted_on           DATE,
  decided_at            TIMESTAMPTZ,
  decided_by            BIGINT REFERENCES users(id),
  decision_note         TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  cancel_reason         TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  created_by            BIGINT NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  CHECK ((kind = 'goods') = (store_id IS NOT NULL))
);
CALL app.apply_tenant_rls('goods_receipts');
CREATE TRIGGER goods_receipts_audit AFTER INSERT OR UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX goods_receipts_order ON goods_receipts (order_id);
CREATE INDEX goods_receipts_status ON goods_receipts (status, received_on);

CREATE TABLE goods_receipt_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  receipt_id       BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  seq              INT NOT NULL CHECK (seq BETWEEN 1 AND 500),
  order_line_id    BIGINT NOT NULL REFERENCES purchase_order_lines(id),
  -- in the PO line's unit: taken in, and refused at the door (damaged, wrong, more than ordered)
  received_qty     NUMERIC(14,3) NOT NULL CHECK (received_qty >= 0),
  refused_qty      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (refused_qty >= 0),
  refused_reason   TEXT CHECK (refused_reason IS NULL OR length(refused_reason) <= 300),
  batch_no         TEXT CHECK (batch_no IS NULL OR length(btrim(batch_no)) BETWEEN 1 AND 40),
  expiry           DATE,
  serials          TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(serials) <= 500),
  -- a service: what was done
  work_done        TEXT CHECK (work_done IS NULL OR length(work_done) <= 1000),
  -- the inspection
  accepted_qty     NUMERIC(14,3) CHECK (accepted_qty IS NULL OR accepted_qty >= 0),
  rejected_qty     NUMERIC(14,3) CHECK (rejected_qty IS NULL OR rejected_qty >= 0),
  reject_reason    TEXT CHECK (reject_reason IS NULL OR length(reject_reason) <= 300),
  rejected_serials TEXT[] NOT NULL DEFAULT '{}',
  -- per PO-line unit when accepted: the line's rate after discount, its GST (unless left out) and its
  -- share of the PO's other charges
  unit_cost        NUMERIC(14,4),
  UNIQUE (receipt_id, seq),
  CHECK (received_qty > 0 OR refused_qty > 0),
  CHECK (refused_qty = 0 OR refused_reason IS NOT NULL)
);
CALL app.apply_tenant_rls('goods_receipt_lines');
CREATE INDEX goods_receipt_lines_order_line ON goods_receipt_lines (order_line_id);

-- above the committee limit: the purchase committee's signatures on the inspection (cleared when it changes)
CREATE TABLE goods_receipt_signoffs (
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  receipt_id   BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  user_id      BIGINT NOT NULL REFERENCES users(id),
  signed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (receipt_id, employee_id)
);
CALL app.apply_tenant_rls('goods_receipt_signoffs');

-- ---- issues (part 7 issues what came for an indent; part 8 adds the counter and reserved issues) -------
CREATE TABLE stock_issues (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  number                TEXT NOT NULL,
  store_id              BIGINT NOT NULL REFERENCES stores(id),
  department_id         BIGINT NOT NULL REFERENCES departments(id),
  -- what came for an indent on a receipt (issued at once), an indent's reserved lines, or the counter
  kind                  TEXT NOT NULL CHECK (kind IN ('receipt', 'indent', 'counter')),
  indent_id             BIGINT REFERENCES purchase_indents(id),
  receipt_id            BIGINT REFERENCES goods_receipts(id),
  -- who took it (the counter); the indent's raiser otherwise
  taken_by_employee_id  BIGINT REFERENCES employees(id),
  purpose               TEXT CHECK (purpose IS NULL OR length(purpose) <= 300),
  issued_on             DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  -- issued → acknowledged by the department ("Received by")
  status                TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'acknowledged')),
  acknowledged_by       BIGINT REFERENCES users(id),
  acknowledged_at       TIMESTAMPTZ,
  ack_note              TEXT CHECK (ack_note IS NULL OR length(ack_note) <= 300),
  created_by            BIGINT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number),
  CHECK (kind <> 'receipt' OR (receipt_id IS NOT NULL AND indent_id IS NOT NULL))
);
CALL app.apply_tenant_rls('stock_issues');
CREATE TRIGGER stock_issues_audit AFTER INSERT OR UPDATE OR DELETE ON stock_issues
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE INDEX stock_issues_department ON stock_issues (department_id, status);
CREATE INDEX stock_issues_receipt ON stock_issues (receipt_id);

CREATE TABLE stock_issue_lines (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  issue_id        BIGINT NOT NULL REFERENCES stock_issues(id) ON DELETE CASCADE,
  item_id         BIGINT NOT NULL REFERENCES purchase_items(id),
  indent_line_id  BIGINT REFERENCES purchase_indent_lines(id),
  -- in the store unit, at the average it went out at
  qty             NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  rate            NUMERIC(14,4) NOT NULL DEFAULT 0,
  value           NUMERIC(16,2) NOT NULL DEFAULT 0,
  batch_no        TEXT,
  move_id         BIGINT REFERENCES stock_moves(id)
);
CALL app.apply_tenant_rls('stock_issue_lines');
CREATE INDEX stock_issue_lines_issue ON stock_issue_lines (issue_id);
CREATE INDEX stock_issue_lines_indent_line ON stock_issue_lines (indent_line_id);
