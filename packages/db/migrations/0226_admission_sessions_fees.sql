-- Online admission, part 2 (docs/design/39): the admission session per academic year with its classes
-- (form, seats, window, eligibility), fee categories decided from the form's answers, registration and
-- admission fees per class x category, and their own receipt series in the fee module.

CREATE TABLE admission_settings (
  school_id          BIGINT PRIMARY KEY REFERENCES schools(id),
  -- how sign-in codes reach a candidate (the admin's choice)
  signin_channels    TEXT[] NOT NULL DEFAULT ARRAY['email', 'sms', 'whatsapp'],
  reg_receipt_prefix TEXT NOT NULL DEFAULT 'RF' CHECK (reg_receipt_prefix ~ '^[A-Z]{1,6}$'),
  adm_receipt_prefix TEXT NOT NULL DEFAULT 'AF' CHECK (adm_receipt_prefix ~ '^[A-Z]{1,6}$'),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT
);
CALL app.apply_tenant_rls('admission_settings');

CREATE TABLE admission_fee_categories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,29}$'),
  name        TEXT NOT NULL,
  -- the form answers that put a candidate in this category: [{ field, op, value }] (admission-engine)
  conditions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  logic       TEXT NOT NULL DEFAULT 'any' CHECK (logic IN ('all', 'any')),
  sort_order  INT NOT NULL DEFAULT 0,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('admission_fee_categories');

CREATE TABLE admission_fees (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  cycle_id          BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id          BIGINT NOT NULL REFERENCES classes(id),
  category_id       BIGINT NOT NULL REFERENCES admission_fee_categories(id),
  registration_fee  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),
  admission_fee     NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (admission_fee >= 0),
  UNIQUE (cycle_id, class_id, category_id)
);
CALL app.apply_tenant_rls('admission_fees');
CREATE TRIGGER admission_fees_audit AFTER INSERT OR UPDATE OR DELETE ON admission_fees FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- a class line of the session: its own window, the age reference date, open / closed
ALTER TABLE admission_class_criteria
  ADD COLUMN opens_at   TIMESTAMPTZ,
  ADD COLUMN closes_at  TIMESTAMPTZ,
  ADD COLUMN age_as_on  DATE,
  ADD COLUMN notes      TEXT,
  ADD COLUMN status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'));

ALTER TABLE admission_cycles
  ADD COLUMN refund_deduction_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (refund_deduction_pct BETWEEN 0 AND 100);

-- registration / admission receipts: numbered RF/<session>/000001, AF/<session>/000001
CREATE TABLE admission_receipt_sequences (
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  prefix       TEXT NOT NULL,
  session_code TEXT NOT NULL,
  last_serial  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, prefix, session_code)
);
CALL app.apply_tenant_rls('admission_receipt_sequences');

CREATE OR REPLACE FUNCTION app.next_admission_receipt_no(p_prefix TEXT, p_session TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_serial INT;
BEGIN
  INSERT INTO admission_receipt_sequences (school_id, prefix, session_code, last_serial)
  VALUES (app.current_school_id(), p_prefix, p_session, 1)
  ON CONFLICT (school_id, prefix, session_code) DO UPDATE SET last_serial = admission_receipt_sequences.last_serial + 1
  RETURNING last_serial INTO v_serial;
  RETURN p_prefix || '/' || p_session || '/' || lpad(v_serial::text, 6, '0');
END;
$$;

ALTER TABLE misc_receipts ADD COLUMN application_id BIGINT REFERENCES applications(id);
CREATE INDEX misc_receipts_application ON misc_receipts (application_id) WHERE application_id IS NOT NULL;

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.setup.manage', 'admissions', 'Admission set-up: sign-in channels, receipt series, fee categories, stages and approval processes', false),
  ('admissions.fee.collect',  'admissions', 'Take registration and admission fees at the school desk and print receipts', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('admissions.setup.manage', 'admissions.fee.collect')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'admissions.fee.collect' FROM roles r WHERE r.school_id IS NULL AND r.code = 'accountant'
ON CONFLICT DO NOTHING;
