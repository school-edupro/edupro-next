-- Purchase, part 3 (docs/design/83): the Purchase Requisition (PR) — the purchase office turns approved
-- indents (or its own need) into a sourcing decision: lines bought or issued from the store; sourcing
-- by the tier of the PR's value (direct with a reasonable-price certificate; the committee's quotes,
-- comparative statement and signatures; a tender reference with its documents); a vendor and rate per
-- line (a costlier choice than the lowest needs a reason); the department's PR levels approve it.

-- ---- rights ----------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.requisition.manage', 'purchase', 'Make Purchase Requisitions from approved indents (or directly), enter quotes and choose vendors, send them for approval, close indents')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.requisition.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'purchase_office')
ON CONFLICT DO NOTHING;

-- ---- the requisition -------------------------------------------------------------------------------
ALTER TABLE purchase_requisitions DROP CONSTRAINT purchase_requisitions_status_check;
ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_status_check
  CHECK (status IN ('draft', 'sourcing', 'submitted', 'approved', 'rejected', 'sent_back', 'cancelled', 'part_ordered', 'ordered'));
ALTER TABLE purchase_requisitions
  ADD COLUMN required_by           DATE,
  -- the PR combines indents of several departments: the purchase office's department approves it
  ADD COLUMN combined              BOOLEAN NOT NULL DEFAULT false,
  -- the sourcing tier its value fell in when it was sent for approval
  ADD COLUMN tier                  TEXT CHECK (tier IS NULL OR tier IN ('none', 'direct', 'committee', 'tender')),
  -- direct purchase: the purchase officer's "reasonable price" certificate (GFR 2017 rule 154)
  ADD COLUMN price_certificate     TEXT CHECK (price_certificate IS NULL OR length(price_certificate) <= 1000),
  ADD COLUMN certified_by          BIGINT REFERENCES users(id),
  ADD COLUMN certified_at          TIMESTAMPTZ,
  -- above the committee limit: the tender run outside EduPro
  ADD COLUMN tender_ref            TEXT CHECK (tender_ref IS NULL OR length(tender_ref) <= 120),
  ADD COLUMN tender_note           TEXT CHECK (tender_note IS NULL OR length(tender_note) <= 1000),
  ADD COLUMN workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN submitted_at          TIMESTAMPTZ,
  ADD COLUMN decided_at            TIMESTAMPTZ,
  ADD COLUMN decision_note         TEXT,
  -- reopened after approval (a change approved again): 0 the first time
  ADD COLUMN revision              INT NOT NULL DEFAULT 0;

ALTER TABLE purchase_requisition_lines
  ADD COLUMN note          TEXT CHECK (note IS NULL OR length(note) <= 300),
  -- issued from the store (phase 1: marked by hand with a note)
  ADD COLUMN store_note    TEXT CHECK (store_note IS NULL OR length(store_note) <= 300),
  -- the GST rate of the chosen vendor's quote (else the item's)
  ADD COLUMN gst_rate      NUMERIC(5,2) CHECK (gst_rate IS NULL OR gst_rate BETWEEN 0 AND 40),
  -- why a vendor dearer than the lowest quote (L1) was chosen
  ADD COLUMN choice_reason TEXT CHECK (choice_reason IS NULL OR length(choice_reason) <= 300);
ALTER TABLE purchase_requisition_lines
  ADD CONSTRAINT purchase_requisition_lines_what CHECK (item_id IS NOT NULL OR free_text IS NOT NULL);

-- an indent line goes on one requisition only
CREATE UNIQUE INDEX purchase_requisition_sources_once ON purchase_requisition_sources (indent_line_id);

-- tender documents and anything else kept with the PR
CREATE TABLE purchase_requisition_files (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  requisition_id  BIGINT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'tender' CHECK (kind IN ('tender', 'other')),
  file_id         BIGINT NOT NULL REFERENCES files(id),
  uploaded_by     BIGINT REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('purchase_requisition_files');
CREATE INDEX purchase_requisition_files_pr ON purchase_requisition_files (requisition_id);

-- ---- quotes and the comparative statement ----------------------------------------------------------
CREATE TABLE purchase_quotes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  requisition_id  BIGINT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  vendor_id       BIGINT NOT NULL REFERENCES vendors(id),
  quote_ref       TEXT CHECK (quote_ref IS NULL OR length(quote_ref) <= 60),
  quote_date      DATE,
  valid_until     DATE,
  delivery_days   INT CHECK (delivery_days IS NULL OR delivery_days BETWEEN 0 AND 365),
  file_id         BIGINT REFERENCES files(id),
  note            TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requisition_id, vendor_id),
  CHECK (valid_until IS NULL OR quote_date IS NULL OR valid_until >= quote_date)
);
CALL app.apply_tenant_rls('purchase_quotes');
CREATE TRIGGER purchase_quotes_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_quotes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- a vendor's rate for a PR line (a line the vendor did not quote has no row)
CREATE TABLE purchase_quote_lines (
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  quote_id             BIGINT NOT NULL REFERENCES purchase_quotes(id) ON DELETE CASCADE,
  requisition_line_id  BIGINT NOT NULL REFERENCES purchase_requisition_lines(id) ON DELETE CASCADE,
  rate                 NUMERIC(14,2) NOT NULL CHECK (rate >= 0),
  gst_rate             NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 40),
  note                 TEXT CHECK (note IS NULL OR length(note) <= 300),
  PRIMARY KEY (quote_id, requisition_line_id)
);
CALL app.apply_tenant_rls('purchase_quote_lines');
CREATE INDEX purchase_quote_lines_line ON purchase_quote_lines (requisition_line_id);

-- the purchase committee's signatures on the comparative statement (cleared when it changes)
CREATE TABLE purchase_cs_signoffs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  requisition_id  BIGINT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  user_id         BIGINT NOT NULL REFERENCES users(id),
  note            TEXT CHECK (note IS NULL OR length(note) <= 300),
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requisition_id, employee_id)
);
CALL app.apply_tenant_rls('purchase_cs_signoffs');
CREATE TRIGGER purchase_cs_signoffs_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_cs_signoffs
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
