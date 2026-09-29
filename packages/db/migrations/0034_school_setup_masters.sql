-- School setup masters (post-freeze change, 2026-09-29): countries, states, cities and structured school
-- bank accounts behind the school profile's drop-downs; banks gain an address. Every master is per
-- school (row-level security), uploadable and exportable through the master-data framework.

CREATE TABLE countries (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  code       TEXT NOT NULL,                       -- ISO 3166-1 alpha-2
  name       TEXT NOT NULL,
  dial_code  TEXT,
  status     row_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CALL app.apply_tenant_rls('countries');

CREATE TABLE states (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  country_id BIGINT NOT NULL REFERENCES countries(id),
  code       TEXT NOT NULL,                       -- e.g. UP, DL (ISO 3166-2 suffix)
  name       TEXT NOT NULL,
  gst_code   TEXT,                                -- two-digit GST state code
  status     row_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);
CREATE INDEX states_by_country ON states (country_id);
CALL app.apply_tenant_rls('states');

CREATE TABLE cities (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  state_id   BIGINT NOT NULL REFERENCES states(id),
  name       TEXT NOT NULL,
  pincode    TEXT,                                -- default PIN of the city (six digits)
  status     row_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state_id, name)
);
CALL app.apply_tenant_rls('cities');

ALTER TABLE banks ADD COLUMN IF NOT EXISTS address TEXT;

CREATE TABLE school_bank_accounts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  bank_id      BIGINT NOT NULL REFERENCES banks(id),
  account_name TEXT NOT NULL,
  account_no   TEXT NOT NULL,
  ifsc         TEXT NOT NULL,
  branch       TEXT,
  address      TEXT,
  purpose      TEXT NOT NULL DEFAULT 'school' CHECK (purpose IN ('school', 'hostel', 'misc', 'admission', 'any')),
  is_default   BOOLEAN NOT NULL DEFAULT false,
  status       row_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, account_no)
);
CALL app.apply_tenant_rls('school_bank_accounts');
