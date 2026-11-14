-- 0383: certificate management, phase B (docs/design/87). The school shapes its types — the fields each asks for,
-- template variants to choose from at issue, who may issue it, the classes it is for — and adds its own; the
-- certificate signatory (the principal: name, title, the signature image on the employee record) and what prints
-- with it; the remaining student types (date of birth justification, caste, domicile, study, no objection, travel,
-- visa, scholarship, board registration, fee paid) and the staff types (experience, service, visa).

ALTER TABLE certificate_types
  ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 300),
  -- the school's own fields: [{"key","label","kind":"text|date|number|list","required","options","hint"}]
  ADD COLUMN fields JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  -- other templates to choose from at issue: [{"templateId","label"}] (the type's template is the default)
  ADD COLUMN variants JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variants) = 'array'),
  -- the roles that may issue this type (role ids; empty: whoever holds certificate.register.issue)
  ADD COLUMN issuers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issuers) = 'array'),
  -- made by EduPro (its code and audience stay; the school may still rename it, change its checks or switch it off)
  ADD COLUMN built_in BOOLEAN NOT NULL DEFAULT false;
UPDATE certificate_types SET built_in = true;

-- a ready template remembers its ready layout (Reset to the ready layout)
ALTER TABLE document_templates ADD COLUMN ready_code TEXT CHECK (ready_code IS NULL OR ready_code ~ '^cert_[a-z_]{2,40}$');
UPDATE document_templates SET ready_code = code
 WHERE code IN ('cert_tc', 'cert_bonafide', 'cert_character', 'cert_dob') AND deleted_at IS NULL;

-- ---- who signs and what prints ------------------------------------------------------------------------------------
CREATE TABLE certificate_settings (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL UNIQUE REFERENCES schools(id),
  -- the principal (or whoever signs certificates): name, employee code, designation and signature image
  signatory_employee_id BIGINT REFERENCES employees(id),
  signatory_title       TEXT NOT NULL DEFAULT 'Principal' CHECK (length(btrim(signatory_title)) BETWEEN 2 AND 60),
  -- print the signatory's signature image (else the box is left to sign by hand)
  print_signature       BOOLEAN NOT NULL DEFAULT true,
  -- print who issued it (name, employee ID, date and time) in the Prepared by box
  print_preparer        BOOLEAN NOT NULL DEFAULT true,
  footer_note           TEXT CHECK (footer_note IS NULL OR length(footer_note) <= 200),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            BIGINT REFERENCES users(id)
);
CALL app.apply_tenant_rls('certificate_settings');
CREATE TRIGGER certificate_settings_audit AFTER INSERT OR UPDATE OR DELETE ON certificate_settings
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---- every type a school starts with --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.certificate_types_seed(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO certificate_types (school_id, code, name, audience, prefix, rules, multiple, uses_book, sort_order, built_in)
  SELECT p_school, x.code, x.name, x.audience, x.prefix, x.rules::jsonb, x.multiple, x.book, x.n, true
    FROM (VALUES
      ('TC', 'Transfer certificate', 'STUDENT', 'TC',
       '{"state": "leaving", "fees": true, "library": true, "hostel": true, "transport": true}', 'ONE', true, 10),
      ('BONAFIDE', 'Bonafide certificate', 'STUDENT', 'BON', '{"state": "active"}', 'ANY', false, 20),
      ('CHARACTER', 'Character certificate', 'STUDENT', 'CHR', '{"state": "any"}', 'ANY', false, 30),
      ('DOB', 'Date of birth certificate', 'STUDENT', 'DOB', '{"state": "any"}', 'ANY', false, 40),
      ('DOB_JUST', 'Date of birth justification', 'STUDENT', 'DOBJ', '{"state": "any"}', 'ANY', false, 45),
      ('STUDY', 'Study certificate', 'STUDENT', 'STU', '{"state": "any"}', 'ANY', false, 50),
      ('CASTE', 'Caste certificate (school record)', 'STUDENT', 'CST', '{"state": "any"}', 'ANY', false, 55),
      ('DOMICILE', 'Domicile (residence) certificate', 'STUDENT', 'DOM', '{"state": "active"}', 'ANY', false, 60),
      ('NOC', 'No objection certificate', 'STUDENT', 'NOC', '{"state": "active"}', 'ANY', false, 65),
      ('TRAVEL_NOC', 'No objection certificate for travel', 'STUDENT', 'TNOC', '{"state": "active"}', 'ANY', false, 70),
      ('VISA', 'Visa letter', 'STUDENT', 'VISA', '{"state": "active"}', 'ANY', false, 75),
      ('SCHOLAR', 'Scholarship certificate', 'STUDENT', 'SCH', '{"state": "active"}', 'ANY', false, 80),
      ('BOARD_REG', 'Board registration verification', 'STUDENT', 'BRV',
       '{"state": "active", "classes": ["VIII", "IX", "X", "XI", "XII"]}', 'ANY', false, 85),
      ('FEE_PAID', 'Fee paid certificate', 'STUDENT', 'FEE', '{"state": "any"}', 'ANY', false, 90),
      ('EXPERIENCE', 'Experience certificate', 'STAFF', 'EXP', '{"state": "leaving"}', 'ONE', false, 110),
      ('SERVICE', 'Service certificate', 'STAFF', 'SRV', '{"state": "active"}', 'ANY', false, 120),
      ('STAFF_VISA', 'Staff visa NOC', 'STAFF', 'SVN', '{"state": "active"}', 'ANY', false, 130)
    ) AS x(code, name, audience, prefix, rules, multiple, book, n)
  -- a type the school already has (by code, or a prefix it took for its own type) is left as it is
  ON CONFLICT DO NOTHING
$$;
SELECT app.certificate_types_seed(id) FROM schools;
