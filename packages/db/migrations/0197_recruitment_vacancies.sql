-- 0197: recruitment, part 1 (docs/design/34-recruitment.md): vacancies raised by the office or an HOD,
-- approved through the levels the school sets (workflow "vacancy_approval"), then published for a
-- period; the school's list of screening stages, from which each vacancy picks the ones it uses.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.recruitment.view', 'people', 'See vacancies, candidates and the screening of each vacancy', false),
  ('people.recruitment.raise', 'people', 'Raise a vacancy and send it for approval', false),
  ('people.recruitment.manage', 'people', 'Set up recruitment, publish and close vacancies, screen and select candidates', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('people.recruitment.view'), ('people.recruitment.raise'), ('people.recruitment.manage')) AS p(code)
 WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
-- an HOD (the academic coordinator role) raises vacancies for their department and follows them
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  CROSS JOIN (VALUES ('people.recruitment.view'), ('people.recruitment.raise')) AS p(code)
 WHERE r.school_id IS NULL AND r.code = 'academic_coordinator' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- the school's screening stages, in order; a vacancy ticks the ones it uses
CREATE TABLE recruitment_stages (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  name        TEXT NOT NULL,
  -- what the stage records: shortlisting (a yes/no on the papers), a test or an interview (marks), the
  -- final round (the selection)
  kind        TEXT NOT NULL CHECK (kind IN ('shortlist', 'test', 'interview', 'final')),
  max_marks   NUMERIC(6,2),
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);
CALL app.apply_tenant_rls('recruitment_stages');

CREATE TABLE vacancies (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id             BIGINT NOT NULL REFERENCES schools(id),
  code                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  designation           TEXT,
  department            TEXT,
  subject               TEXT,
  employee_type         TEXT,
  campus_id             BIGINT,
  posts                 INT NOT NULL DEFAULT 1 CHECK (posts BETWEEN 1 AND 500),
  qualification         TEXT,
  experience            TEXT,
  pay_band              TEXT,
  description           TEXT,
  stage_ids             BIGINT[] NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'published', 'closed', 'cancelled')),
  -- on the public careers page while published, between these dates
  opens_on              DATE,
  closes_on             DATE,
  workflow_instance_id  BIGINT,
  decision_note         TEXT,
  raised_by             BIGINT,
  raised_by_name        TEXT,
  submitted_at          TIMESTAMPTZ,
  decided_at            TIMESTAMPTZ,
  published_at          TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  CHECK (closes_on IS NULL OR opens_on IS NULL OR closes_on >= opens_on)
);
CREATE INDEX vacancies_status ON vacancies (school_id, status);
CALL app.apply_tenant_rls('vacancies');

-- what happened to a vacancy, for its page
CREATE TABLE vacancy_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  vacancy_id  BIGINT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  what        TEXT NOT NULL,
  note        TEXT,
  by_user     BIGINT,
  by_name     TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vacancy_events_vacancy ON vacancy_events (vacancy_id, at);
CALL app.apply_tenant_rls('vacancy_events');
