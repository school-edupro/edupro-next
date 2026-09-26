-- 0001_foundation.sql
-- Foundation schema: tenancy, years, identity, RBAC, sequences, files, outbox.
-- Conventions (see docs/design/00-foundation-design.md section 4):
--   id BIGINT identity PK; school_id second column on tenant tables; created/updated audit columns;
--   deleted_at for soft delete; legacy_ref for ETL traceability.
-- Row-level security is applied in 0002_rls.sql so that every table here is covered in one place.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;      -- procedures, context functions, maintenance
CREATE SCHEMA IF NOT EXISTS archive;  -- detached partitions and archived data

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
CREATE TYPE year_status   AS ENUM ('planned', 'active', 'locked', 'closed');
CREATE TYPE row_status    AS ENUM ('active', 'inactive');
CREATE TYPE role_kind     AS ENUM ('global', 'module');
CREATE TYPE person_type   AS ENUM ('employee', 'guardian', 'student', 'external');
CREATE TYPE scope_type    AS ENUM ('class_section', 'subject', 'department', 'route', 'campus');
CREATE TYPE actor_type    AS ENUM ('user', 'impersonated_user', 'system_job', 'device', 'migration');
CREATE TYPE audit_source  AS ENUM ('api', 'trigger', 'job', 'migration');
CREATE TYPE ledger_type   AS ENUM ('school', 'hostel', 'misc', 'admission');
CREATE TYPE login_method  AS ENUM ('oidc', 'dev', 'impersonation', 'compat', 'device');
CREATE TYPE login_outcome AS ENUM ('success', 'denied', 'error');
CREATE TYPE file_class    AS ENUM ('public', 'internal', 'personal', 'sensitive');
CREATE TYPE outbox_status AS ENUM ('pending', 'published', 'failed');

-- ---------------------------------------------------------------------------
-- Common trigger: maintain updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
CREATE TABLE school_groups (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  status        row_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT,
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE schools (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id        BIGINT REFERENCES school_groups(id),
  code            TEXT NOT NULL UNIQUE,                 -- short code, e.g. DPSRKP
  name            TEXT NOT NULL,
  short_name      TEXT,
  affiliation_no  TEXT,
  board           TEXT NOT NULL DEFAULT 'CBSE',         -- CBSE, ICSE, STATE, IB
  timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  locale          TEXT NOT NULL DEFAULT 'en-IN',
  address         JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact         JSONB NOT NULL DEFAULT '{}'::jsonb,
  branding        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- logo file id, letterhead, colours within DS constraints
  status          row_status NOT NULL DEFAULT 'active',
  legacy_ref      TEXT,                                 -- legacy database name
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      BIGINT,
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE campuses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  address     JSONB NOT NULL DEFAULT '{}'::jsonb,
  geo         JSONB,                                    -- {lat, lng}
  status      row_status NOT NULL DEFAULT 'active',
  legacy_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  deleted_at  TIMESTAMPTZ,
  UNIQUE (school_id, code)
);

-- ---------------------------------------------------------------------------
-- Years (ADR-003): dimensions, never row copies
-- ---------------------------------------------------------------------------
CREATE TABLE academic_years (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,                            -- '2026-27'
  name        TEXT NOT NULL,                            -- 'Session 2026-27'
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      year_status NOT NULL DEFAULT 'planned',
  locks       JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {"attendance": true, "exams": false, "fees": false, "academics": false}
  legacy_ref  TEXT,                                     -- legacy FinancialYear string, e.g. '2026'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code),
  CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX academic_years_one_active_per_school
  ON academic_years (school_id) WHERE status = 'active';

CREATE TABLE financial_years (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  code        TEXT NOT NULL,                            -- 'FY2026-27'
  name        TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      year_status NOT NULL DEFAULT 'planned',
  locks       JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_ref  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  UNIQUE (school_id, code),
  CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX financial_years_one_active_per_school
  ON financial_years (school_id) WHERE status = 'active';

-- Typed configuration per school (replaces AppConf.php and tbl_module_settings)
CREATE TABLE school_settings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  key         TEXT NOT NULL,                            -- 'fees.late_fee_mode', 'attendance.in_window'
  value       JSONB NOT NULL,
  valid_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX school_settings_lookup ON school_settings (school_id, key, valid_from DESC);

-- ---------------------------------------------------------------------------
-- Identity (credentials live in One Auth; the ERP stores identity links and memberships)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  oneauth_sub      TEXT NOT NULL UNIQUE,
  email            CITEXT,
  mobile           TEXT,
  display_name     TEXT NOT NULL,
  preferred_locale TEXT NOT NULL DEFAULT 'en',
  status           row_status NOT NULL DEFAULT 'active',
  last_login_at    TIMESTAMPTZ,
  legacy_ref       TEXT,                                -- legacy EmpId / sadmission / suser
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       BIGINT,
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX users_email ON users (email) WHERE email IS NOT NULL;
CREATE INDEX users_mobile ON users (mobile) WHERE mobile IS NOT NULL;

CREATE TABLE user_school_memberships (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  user_id        BIGINT NOT NULL REFERENCES users(id),
  person_type    person_type NOT NULL,
  person_ref_id  BIGINT,                                -- employee_id, guardian_id or student_id once those tables exist
  status         row_status NOT NULL DEFAULT 'active',
  invited_by     BIGINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT,
  deleted_at     TIMESTAMPTZ,
  UNIQUE (school_id, user_id, person_type)
);
CREATE INDEX user_school_memberships_by_user ON user_school_memberships (user_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- RBAC (ADR-004)
-- ---------------------------------------------------------------------------
CREATE TABLE permissions (
  code           TEXT PRIMARY KEY,                      -- 'fees.receipt.create'
  module         TEXT NOT NULL,                         -- 'fees'
  description    TEXT NOT NULL DEFAULT '',
  requires_mfa   BOOLEAN NOT NULL DEFAULT false,
  orphaned       BOOLEAN NOT NULL DEFAULT false,        -- present in DB but no longer declared in code
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$')
);

CREATE TABLE roles (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT REFERENCES schools(id),          -- NULL = system template
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         role_kind NOT NULL,
  is_system    BOOLEAN NOT NULL DEFAULT false,
  description  TEXT NOT NULL DEFAULT '',
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  deleted_at   TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (school_id, code)
);

CREATE TABLE role_permissions (
  role_id          BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code  TEXT NOT NULL REFERENCES permissions(code) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  user_id      BIGINT NOT NULL REFERENCES users(id),
  role_id      BIGINT NOT NULL REFERENCES roles(id),
  campus_id    BIGINT REFERENCES campuses(id),
  valid_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to     DATE,
  granted_by   BIGINT REFERENCES users(id),
  reason       TEXT,
  revoked_at   TIMESTAMPTZ,
  revoked_by   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX user_roles_effective ON user_roles (school_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE user_role_scopes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  user_role_id  BIGINT NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE,
  scope_type    scope_type NOT NULL,
  scope_id      BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  UNIQUE (user_role_id, scope_type, scope_id)
);

CREATE TABLE sod_rules (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id      BIGINT REFERENCES schools(id),        -- NULL = template applying to all schools
  permission_a   TEXT NOT NULL REFERENCES permissions(code),
  permission_b   TEXT NOT NULL REFERENCES permissions(code),
  description    TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     BIGINT,
  CHECK (permission_a < permission_b),
  UNIQUE NULLS NOT DISTINCT (school_id, permission_a, permission_b)
);

CREATE TABLE delegations (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  from_user_id  BIGINT NOT NULL REFERENCES users(id),
  to_user_id    BIGINT NOT NULL REFERENCES users(id),
  role_id       BIGINT NOT NULL REFERENCES roles(id),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  reason        TEXT NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT,
  CHECK (ends_at > starts_at),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX delegations_active ON delegations (school_id, to_user_id, starts_at, ends_at) WHERE revoked_at IS NULL;

-- Login tracking (replaces LoginTracking)
CREATE TABLE login_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  school_id   BIGINT REFERENCES schools(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method      login_method NOT NULL,
  outcome     login_outcome NOT NULL,
  ip          INET,
  user_agent  TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX login_events_by_user ON login_events (user_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Sequences for receipts and other numbered documents (ADR-006)
-- ---------------------------------------------------------------------------
CREATE TABLE receipt_sequences (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  ledger_type        ledger_type NOT NULL,
  financial_year_id  BIGINT NOT NULL REFERENCES financial_years(id),
  prefix             TEXT NOT NULL,
  next_no            BIGINT NOT NULL DEFAULT 1,
  width              SMALLINT NOT NULL DEFAULT 6,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, ledger_type, financial_year_id),
  CHECK (next_no > 0),
  CHECK (width BETWEEN 1 AND 12)
);

-- ---------------------------------------------------------------------------
-- Files (object storage index)
-- ---------------------------------------------------------------------------
CREATE TABLE files (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  bucket             TEXT NOT NULL,
  object_key         TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  size_bytes         BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256             TEXT,
  original_name      TEXT,
  owner_entity_type  TEXT,
  owner_entity_id    TEXT,
  classification     file_class NOT NULL DEFAULT 'internal',
  scanned_at         TIMESTAMPTZ,
  scan_result        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT,
  deleted_at         TIMESTAMPTZ,
  UNIQUE (bucket, object_key)
);
CREATE INDEX files_by_owner ON files (school_id, owner_entity_type, owner_entity_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Transactional outbox for reliable job and audit publishing
-- ---------------------------------------------------------------------------
CREATE TABLE jobs_outbox (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  queue         TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        outbox_status NOT NULL DEFAULT 'pending',
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
CREATE INDEX jobs_outbox_pending ON jobs_outbox (available_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- updated_at triggers for every table that has the column
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      t.table_name || '_set_updated_at', t.table_name
    );
  END LOOP;
END
$$;
