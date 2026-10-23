-- Online admission, part 8 (docs/design/39): the enquiry desk. Enquiries from a walk-in, a phone call,
-- the school's website or a campaign; a counsellor; follow-ups with the next date; an invitation to
-- register (a link that fills the registration with the enquiry); the conversion to registration and
-- admission by source and class.

CREATE TABLE admission_enquiry_sources (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX admission_enquiry_sources_name ON admission_enquiry_sources (school_id, lower(name));
CALL app.apply_tenant_rls('admission_enquiry_sources');

CREATE TABLE admission_enquiries (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id            BIGINT NOT NULL REFERENCES schools(id),
  cycle_id             BIGINT REFERENCES admission_cycles(id),
  class_id             BIGINT REFERENCES classes(id),
  source_id            BIGINT REFERENCES admission_enquiry_sources(id),
  campaign             TEXT,
  parent_name          TEXT NOT NULL,
  child_name           TEXT,
  child_dob            DATE,
  mobile               TEXT,
  email                CITEXT,
  locality             TEXT,
  previous_school      TEXT,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'follow_up', 'interested', 'converted', 'not_interested', 'closed')),
  counsellor_user_id   BIGINT REFERENCES users(id),
  next_follow_up_on    DATE,
  last_contact_at      TIMESTAMPTZ,
  invite_token_hash    TEXT,
  invited_at           TIMESTAMPTZ,
  application_id       BIGINT REFERENCES applications(id),
  converted_at         TIMESTAMPTZ,
  from_website         BOOLEAN NOT NULL DEFAULT false,
  created_by           BIGINT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mobile IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX admission_enquiries_due ON admission_enquiries (school_id, next_follow_up_on) WHERE status IN ('new', 'follow_up', 'interested');
CREATE INDEX admission_enquiries_mobile ON admission_enquiries (school_id, mobile) WHERE mobile IS NOT NULL;
CREATE UNIQUE INDEX admission_enquiries_token ON admission_enquiries (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CALL app.apply_tenant_rls('admission_enquiries');
CREATE TRIGGER admission_enquiries_audit AFTER INSERT OR UPDATE OR DELETE ON admission_enquiries FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE admission_enquiry_followups (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  enquiry_id    BIGINT NOT NULL REFERENCES admission_enquiries(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('call', 'visit', 'email', 'sms', 'whatsapp', 'note', 'invite', 'system')),
  outcome       TEXT NOT NULL,
  next_on       DATE,
  status_after  TEXT,
  by_user_id    BIGINT REFERENCES users(id),
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admission_enquiry_followups_enquiry ON admission_enquiry_followups (enquiry_id, at);
CALL app.apply_tenant_rls('admission_enquiry_followups');

-- a registration started from an enquiry's invitation (or found by the same mobile / email)
ALTER TABLE applications ADD COLUMN enquiry_id BIGINT REFERENCES admission_enquiries(id);

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.enquiry.manage', 'admissions', 'Take admission enquiries, follow them up and invite families to register', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'admissions.enquiry.manage' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin', 'academic_coordinator', 'front_office', 'receptionist', 'clerk')
ON CONFLICT DO NOTHING;
