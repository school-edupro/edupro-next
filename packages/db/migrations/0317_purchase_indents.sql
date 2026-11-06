-- Purchase, part 2 (docs/design/83): the Purchase Indent (PI) — a department asks for items; the
-- department's PI levels approve it (nobody approves their own); on approval the bypass rules decide:
-- every line on a rate contract, or the PI under the department's limit (with the split-indent guard),
-- makes a Purchase Requisition (PR) approved by the system with the rule written on it; otherwise the PI
-- waits for the purchase office's PR (part 3). Delegation may cover purchase approvals only.

-- ---- rights ----------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description) VALUES
  ('purchase.indent.raise', 'purchase', 'Raise a Purchase Indent for your department (or on behalf of a colleague) and see your department''s'),
  ('purchase.indent.view', 'purchase', 'See every department''s Purchase Indents and Requisitions'),
  ('purchase.indent.any_department', 'purchase', 'Raise a Purchase Indent for any department')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'purchase.indent.raise' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'purchase_office', 'class_teacher', 'subject_teacher',
                                         'academic_coordinator', 'accountant', 'librarian', 'front_desk', 'hostel_clerk',
                                         'transport_incharge', 'warden', 'exam_office', 'school_doctor', 'school_nurse')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'purchase_office')
   AND p.code IN ('purchase.indent.view', 'purchase.indent.any_department')
ON CONFLICT DO NOTHING;

-- ---- numbers: PI/2026-27/0001, restarting each financial year (April to March) ---------------------
CREATE TABLE purchase_numbering (
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  doc        TEXT NOT NULL CHECK (doc IN ('indent', 'requisition', 'order')),
  fy         TEXT NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  next_no    INT NOT NULL DEFAULT 1 CHECK (next_no >= 1),
  PRIMARY KEY (school_id, doc, fy)
);
CALL app.apply_tenant_rls('purchase_numbering');

CREATE OR REPLACE FUNCTION app.purchase_fy(p_day DATE) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN extract(month FROM p_day) >= 4
              THEN to_char(p_day, 'YYYY') || '-' || to_char(p_day + INTERVAL '1 year', 'YY')
              ELSE to_char(p_day - INTERVAL '1 year', 'YYYY') || '-' || to_char(p_day, 'YY') END
$$;

-- the next number of a document of the current school: prefix (settings) / financial year / 0001
CREATE OR REPLACE FUNCTION app.purchase_next_number(p_doc TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_fy TEXT := app.purchase_fy((now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_no INT;
  v_prefix TEXT;
BEGIN
  INSERT INTO purchase_numbering (school_id, doc, fy, next_no) VALUES (app.current_school_id(), p_doc, v_fy, 2)
  ON CONFLICT (school_id, doc, fy) DO UPDATE SET next_no = purchase_numbering.next_no + 1
  RETURNING next_no - 1 INTO v_no;
  SELECT CASE p_doc WHEN 'indent' THEN pi_prefix WHEN 'requisition' THEN pr_prefix ELSE po_prefix END INTO v_prefix
    FROM purchase_settings WHERE school_id = app.current_school_id();
  RETURN COALESCE(v_prefix, upper(left(p_doc, 2))) || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
END $$;

-- ---- the Purchase Indent ---------------------------------------------------------------------------
CREATE TABLE purchase_indents (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  number                TEXT,
  department_id         BIGINT NOT NULL REFERENCES departments(id),
  raised_by             BIGINT NOT NULL REFERENCES users(id),
  on_behalf_employee_id BIGINT REFERENCES employees(id),
  purpose               TEXT NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 500),
  required_by           DATE,
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  -- draft → submitted (the levels) → approved, or rejected / sent back / cancelled
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'sent_back', 'cancelled')),
  -- after approval: where the PI goes (part 3 / 4 move it on)
  route                 TEXT CHECK (route IS NULL OR route IN ('to_requisition', 'to_order', 'in_requisition', 'ordered', 'closed')),
  bypass_rule           TEXT CHECK (bypass_rule IS NULL OR bypass_rule IN ('rate_contract', 'under_limit')),
  bypass_note           TEXT,
  estimate              NUMERIC(14,2) NOT NULL DEFAULT 0,
  workflow_instance_id  BIGINT REFERENCES workflow_instances(id),
  submitted_at          TIMESTAMPTZ,
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CALL app.apply_tenant_rls('purchase_indents');
CREATE INDEX purchase_indents_department ON purchase_indents (department_id, status);
CREATE INDEX purchase_indents_raised_by ON purchase_indents (raised_by);
CREATE TRIGGER purchase_indents_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_indents
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE purchase_indent_lines (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  indent_id      BIGINT NOT NULL REFERENCES purchase_indents(id) ON DELETE CASCADE,
  seq            INT NOT NULL CHECK (seq BETWEEN 1 AND 200),
  -- a catalogue item, or a line in words for an item not in the catalogue (the PR maps it)
  item_id        BIGINT REFERENCES purchase_items(id),
  free_text      TEXT CHECK (free_text IS NULL OR length(btrim(free_text)) BETWEEN 2 AND 300),
  quantity       NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  uom_id         BIGINT NOT NULL REFERENCES purchase_uoms(id),
  est_rate       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (est_rate >= 0),
  -- where the estimate came from: the rate contract, the last purchase, or typed
  rate_source    TEXT NOT NULL DEFAULT 'typed' CHECK (rate_source IN ('contract', 'last', 'typed')),
  contract_id    BIGINT REFERENCES purchase_rate_contracts(id),
  note           TEXT CHECK (note IS NULL OR length(note) <= 300),
  file_id        BIGINT REFERENCES files(id),
  UNIQUE (indent_id, seq),
  CHECK (item_id IS NOT NULL OR free_text IS NOT NULL)
);
CALL app.apply_tenant_rls('purchase_indent_lines');
CREATE INDEX purchase_indent_lines_item ON purchase_indent_lines (item_id);

CREATE TABLE purchase_indent_files (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  indent_id   BIGINT NOT NULL REFERENCES purchase_indents(id) ON DELETE CASCADE,
  file_id     BIGINT NOT NULL REFERENCES files(id),
  added_by    BIGINT REFERENCES users(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('purchase_indent_files');

-- ---- the Purchase Requisition (made here only by a bypass; the purchase office's own in part 3) -----
CREATE TABLE purchase_requisitions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  number          TEXT NOT NULL,
  department_id   BIGINT REFERENCES departments(id),
  purpose         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sourcing', 'submitted', 'approved', 'rejected', 'sent_back', 'cancelled', 'ordered')),
  -- approved by the system under a bypass rule (the rule and the figures)
  auto_rule       TEXT CHECK (auto_rule IS NULL OR auto_rule IN ('rate_contract', 'under_limit')),
  auto_note       TEXT,
  estimate        NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by      BIGINT REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, number)
);
CALL app.apply_tenant_rls('purchase_requisitions');
CREATE TRIGGER purchase_requisitions_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_requisitions
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE purchase_requisition_lines (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id       BIGINT NOT NULL REFERENCES schools(id),
  requisition_id  BIGINT NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  seq             INT NOT NULL CHECK (seq BETWEEN 1 AND 500),
  item_id         BIGINT REFERENCES purchase_items(id),
  free_text       TEXT,
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  uom_id          BIGINT NOT NULL REFERENCES purchase_uoms(id),
  est_rate        NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- the vendor and rate chosen (a rate contract's at once; the sourcing's in part 3)
  vendor_id       BIGINT REFERENCES vendors(id),
  rate            NUMERIC(14,2),
  contract_id     BIGINT REFERENCES purchase_rate_contracts(id),
  -- buy, or issue from the store (part 3)
  fulfil          TEXT NOT NULL DEFAULT 'buy' CHECK (fulfil IN ('buy', 'store')),
  UNIQUE (requisition_id, seq)
);
CALL app.apply_tenant_rls('purchase_requisition_lines');

-- each PR line keeps the PI lines it came from (the tracker report follows them)
CREATE TABLE purchase_requisition_sources (
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  requisition_line_id  BIGINT NOT NULL REFERENCES purchase_requisition_lines(id) ON DELETE CASCADE,
  indent_line_id       BIGINT NOT NULL REFERENCES purchase_indent_lines(id),
  quantity             NUMERIC(14,3) NOT NULL,
  PRIMARY KEY (requisition_line_id, indent_line_id)
);
CALL app.apply_tenant_rls('purchase_requisition_sources');
CREATE INDEX purchase_requisition_sources_indent ON purchase_requisition_sources (indent_line_id);

-- ---- delegation of purchase approvals only (no role is handed over) -------------------------------
ALTER TABLE delegations ALTER COLUMN role_id DROP NOT NULL;
ALTER TABLE delegations ADD COLUMN scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'purchase'));
ALTER TABLE delegations ADD CONSTRAINT delegations_scope_role CHECK (scope = 'purchase' OR role_id IS NOT NULL);
