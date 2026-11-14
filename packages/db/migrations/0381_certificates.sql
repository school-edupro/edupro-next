-- 0381: certificate management, phase A (docs/design/87; CERTIFICATE_MODULE_PLAN.md). One register for every
-- certificate a school issues — the transfer certificate, bonafide, character, date of birth and the types that follow
-- — each numbered per type and academic year (never reused, even when cancelled), the TC with its book and Sl. No.
-- (100 a book); each certificate keeps a frozen copy of every field printed and the template version it was made
-- with, so a reprint is the same paper; a duplicate is its own row, printed DUPLICATE; the checks a type needs
-- (dues cleared, the student's state) are recorded, and a principal's override with its reason.

-- ---- the template a certificate was made with --------------------------------------------------------------------
CREATE TABLE document_template_versions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  template_id BIGINT NOT NULL REFERENCES document_templates(id),
  version     INT NOT NULL,
  body_html   TEXT NOT NULL,
  styles_css  TEXT NOT NULL DEFAULT '',
  page_width  TEXT NOT NULL,
  page_height TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  UNIQUE (template_id, version)
);
CALL app.apply_tenant_rls('document_template_versions');

-- every saved change of a template is a new version (the certificate made before keeps the one it used)
CREATE OR REPLACE FUNCTION app.document_template_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.body_html IS NOT DISTINCT FROM OLD.body_html AND NEW.styles_css IS NOT DISTINCT FROM OLD.styles_css
     AND NEW.page_width IS NOT DISTINCT FROM OLD.page_width AND NEW.page_height IS NOT DISTINCT FROM OLD.page_height THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := COALESCE((SELECT max(version) FROM document_template_versions WHERE template_id = NEW.id), OLD.version) + 1;
  END IF;
  INSERT INTO document_template_versions (school_id, template_id, version, body_html, styles_css, page_width, page_height, created_by)
  VALUES (NEW.school_id, NEW.id, NEW.version, NEW.body_html, NEW.styles_css, NEW.page_width, NEW.page_height, NEW.updated_by)
  ON CONFLICT (template_id, version) DO NOTHING;
  RETURN NEW;
END $$;
-- AFTER INSERT (the row has its id) and BEFORE UPDATE (the new version number is written with the change)
CREATE OR REPLACE FUNCTION app.document_template_version_after() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO document_template_versions (school_id, template_id, version, body_html, styles_css, page_width, page_height, created_by)
  VALUES (NEW.school_id, NEW.id, NEW.version, NEW.body_html, NEW.styles_css, NEW.page_width, NEW.page_height, NEW.created_by)
  ON CONFLICT (template_id, version) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER document_template_version_ins AFTER INSERT ON document_templates
  FOR EACH ROW EXECUTE FUNCTION app.document_template_version_after();
CREATE TRIGGER document_template_version_upd BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION app.document_template_version();
-- the templates as they are now are each one's first version
INSERT INTO document_template_versions (school_id, template_id, version, body_html, styles_css, page_width, page_height)
SELECT school_id, id, version, body_html, styles_css, page_width, page_height FROM document_templates
ON CONFLICT (template_id, version) DO NOTHING;

-- ---- the types ---------------------------------------------------------------------------------------------------
CREATE TABLE certificate_types (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  code          TEXT NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  audience      TEXT NOT NULL CHECK (audience IN ('STUDENT', 'STAFF')),
  -- the number's prefix: TC/2026-27/00001
  prefix        TEXT NOT NULL CHECK (prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
  template_id   BIGINT REFERENCES document_templates(id),
  -- the checks before issue: {"state": "left"|"active"|"any", "fees": bool, "library": bool, "hostel": bool, "transport": bool}
  rules         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- how many live certificates a person may hold: ONE (ever), YEAR (one a year), ANY
  multiple      TEXT NOT NULL DEFAULT 'ANY' CHECK (multiple IN ('ONE', 'YEAR', 'ANY')),
  -- the TC's book and Sl. No. series
  uses_book     BOOLEAN NOT NULL DEFAULT false,
  -- phase C: requests, approval levels and the fee
  request       JSONB NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  UNIQUE (school_id, prefix)
);
CALL app.apply_tenant_rls('certificate_types');
CREATE TRIGGER certificate_types_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_types
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- numbering ---------------------------------------------------------------------------------------------------
CREATE TABLE certificate_series (
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  type_code   TEXT NOT NULL,
  year_code   TEXT NOT NULL,
  last_serial INT NOT NULL DEFAULT 0 CHECK (last_serial >= 0),
  PRIMARY KEY (school_id, type_code, year_code)
);
CALL app.apply_tenant_rls('certificate_series');

-- the TC book: one series that never resets and is never reused, 100 a book
CREATE TABLE certificate_book_series (
  school_id  BIGINT PRIMARY KEY REFERENCES schools(id),
  last_sl    INT NOT NULL DEFAULT 0 CHECK (last_sl >= 0),
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('certificate_book_series');
CREATE TRIGGER certificate_book_series_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_book_series
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the next number of a type in a year, row-locked (two at once never get the same)
CREATE OR REPLACE FUNCTION app.next_certificate_no(p_type TEXT, p_prefix TEXT, p_year TEXT)
RETURNS TABLE (number TEXT, serial INT) LANGUAGE plpgsql AS $$
DECLARE v INT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO certificate_series (school_id, type_code, year_code, last_serial)
  VALUES (app.current_school_id(), p_type, p_year, 1)
  ON CONFLICT (school_id, type_code, year_code) DO UPDATE SET last_serial = certificate_series.last_serial + 1
  RETURNING last_serial INTO v;
  RETURN QUERY SELECT p_prefix || '/' || p_year || '/' || lpad(v::text, 5, '0'), v;
END $$;

-- the next Sl. No. of the TC book and its book number
CREATE OR REPLACE FUNCTION app.next_certificate_sl() RETURNS TABLE (sl_no INT, book_no INT) LANGUAGE plpgsql AS $$
DECLARE v INT;
BEGIN
  PERFORM app.assert_context();
  INSERT INTO certificate_book_series (school_id, last_sl) VALUES (app.current_school_id(), 1)
  ON CONFLICT (school_id) DO UPDATE SET last_sl = certificate_book_series.last_sl + 1, updated_at = now()
  RETURNING last_sl INTO v;
  RETURN QUERY SELECT v, ((v - 1) / 100) + 1;
END $$;

-- ---- the register ------------------------------------------------------------------------------------------------
CREATE TABLE certificates (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id           BIGINT NOT NULL REFERENCES schools(id),
  type_id             BIGINT NOT NULL REFERENCES certificate_types(id),
  number              TEXT NOT NULL,
  serial              INT,
  year_code           TEXT,
  -- 0 the original; 1, 2 … a duplicate of it (same number, printed DUPLICATE)
  copy_no             INT NOT NULL DEFAULT 0 CHECK (copy_no >= 0),
  original_id         BIGINT REFERENCES certificates(id),
  student_id          BIGINT REFERENCES students(id),
  employee_id         BIGINT REFERENCES employees(id),
  status              TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  issued_on           DATE NOT NULL DEFAULT CURRENT_DATE,
  issued_by           BIGINT REFERENCES users(id),
  purpose             TEXT CHECK (purpose IS NULL OR length(purpose) <= 200),
  -- every field printed, frozen at issue (a later change of the student or the template does not change it)
  data                JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_version_id BIGINT REFERENCES document_template_versions(id),
  -- the checks as they stood, and a principal's override with its reason
  checks              JSONB NOT NULL DEFAULT '[]'::jsonb,
  override_reason     TEXT CHECK (override_reason IS NULL OR length(override_reason) BETWEEN 10 AND 300),
  override_by         BIGINT REFERENCES users(id),
  -- the public check (phase D prints it as a QR)
  verify_token        TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  book_no             INT,
  sl_no               INT,
  export_id           BIGINT,
  transfer_certificate_id BIGINT REFERENCES transfer_certificates(id),
  legacy              BOOLEAN NOT NULL DEFAULT false,
  legacy_ref          TEXT,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        BIGINT REFERENCES users(id),
  cancel_reason       TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 300),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((student_id IS NULL) <> (employee_id IS NULL)),
  CHECK ((copy_no = 0) = (original_id IS NULL)),
  UNIQUE (school_id, number, copy_no),
  UNIQUE (verify_token)
);
CREATE INDEX certificates_student ON certificates (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX certificates_employee ON certificates (employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX certificates_type ON certificates (school_id, type_id, issued_on DESC);
CREATE UNIQUE INDEX certificates_tc ON certificates (transfer_certificate_id) WHERE transfer_certificate_id IS NOT NULL AND copy_no = 0;
CALL app.apply_tenant_rls('certificates');
CREATE TRIGGER certificates_audit AFTER INSERT OR UPDATE OR DELETE ON certificates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- the types every school starts with ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.certificate_types_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO certificate_types (school_id, code, name, audience, prefix, rules, multiple, uses_book, sort_order)
  SELECT p_school, x.code, x.name, 'STUDENT', x.prefix, x.rules::jsonb, x.multiple, x.book, x.n
    FROM (VALUES
      ('TC', 'Transfer certificate', 'TC',
       '{"state": "leaving", "fees": true, "library": true, "hostel": true, "transport": true}', 'ONE', true, 10),
      ('BONAFIDE', 'Bonafide certificate', 'BON', '{"state": "active"}', 'ANY', false, 20),
      ('CHARACTER', 'Character certificate', 'CHR', '{"state": "any"}', 'ANY', false, 30),
      ('DOB', 'Date of birth certificate', 'DOB', '{"state": "any"}', 'ANY', false, 40)
    ) AS x(code, name, prefix, rules, multiple, book, n)
  ON CONFLICT (school_id, code) DO NOTHING
$$;
SELECT app.certificate_types_seed(id) FROM schools;

-- ---- the transfer certificates issued so far come into the register (their numbers kept) --------------------------
INSERT INTO certificates (school_id, type_id, number, serial, year_code, student_id, status, issued_on, issued_by, data,
                          transfer_certificate_id, cancelled_at, cancelled_by, cancel_reason, created_at, export_id)
SELECT t.school_id, ct.id, t.tc_no, t.serial, split_part(t.tc_no, '/', 2), t.student_id, t.status::text, t.issued_on,
       t.issued_by,
       jsonb_build_object('student', t.snapshot, 'tc', jsonb_build_object('reason', t.reason, 'lastClass', t.last_class,
         'conduct', t.conduct, 'promotionStatus', t.promotion_status, 'duesCleared', t.dues_cleared, 'remarks', t.remarks)),
       t.id, t.cancelled_at, t.cancelled_by,
       CASE WHEN t.cancel_reason IS NULL OR length(t.cancel_reason) >= 3 THEN t.cancel_reason ELSE 'Cancelled' END,
       t.created_at, t.export_id
  FROM transfer_certificates t JOIN certificate_types ct ON ct.school_id = t.school_id AND ct.code = 'TC'
ON CONFLICT DO NOTHING;

-- ---- rights --------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('certificate.register.view', 'certificate', 'See the certificate register and print a certificate', false),
  ('certificate.register.issue', 'certificate', 'Issue a certificate (after its checks) and a duplicate', false),
  ('certificate.register.cancel', 'certificate', 'Cancel an issued certificate with a reason', false),
  ('certificate.register.override', 'certificate', 'Issue a certificate whose checks fail, with a reason (the principal)', true),
  ('certificate.setup.manage', 'certificate', 'Certificate types, their checks, templates and the TC book', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'certificate_office', 'Certificate office', 'module', true,
   'Issues student certificates after their checks: TC, bonafide, character, date of birth …; duplicates, cancels, the register')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('certificate.register.view'), ('certificate.register.issue'), ('certificate.register.cancel')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'certificate_office'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, (VALUES ('certificate.register.view'), ('certificate.register.issue'), ('certificate.register.cancel'),
                                          ('certificate.register.override'), ('certificate.setup.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'certificate.register.view' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('academic_coordinator', 'auditor')
ON CONFLICT DO NOTHING;
