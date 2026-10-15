-- Admin landing page by role (docs/design/26-admin-landing.md): the widgets and quick actions each role sees
-- by default (set by the school admin), each user's own order, hidden widgets and pinned actions, and the
-- birthday wishes sent from the landing page.

CREATE TABLE dashboard_role_defaults (
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  role_code      TEXT NOT NULL CHECK (role_code ~ '^[a-z_]{2,40}$'),
  -- widget keys in order
  widgets        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- menu hrefs pinned as quick actions
  quick_actions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     BIGINT,
  PRIMARY KEY (school_id, role_code)
);
CALL app.apply_tenant_rls('dashboard_role_defaults');

CREATE TABLE user_dashboards (
  school_id      BIGINT NOT NULL REFERENCES schools(id),
  user_id        BIGINT NOT NULL REFERENCES users(id),
  widgets        JSONB NOT NULL DEFAULT '[]'::jsonb,
  hidden         JSONB NOT NULL DEFAULT '[]'::jsonb,
  quick_actions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, user_id)
);
CALL app.apply_tenant_rls('user_dashboards');

CREATE TABLE birthday_wishes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  person_kind  TEXT NOT NULL CHECK (person_kind IN ('student', 'employee')),
  person_id    BIGINT NOT NULL,
  on_date      DATE NOT NULL,
  wished_by    BIGINT,
  channels     TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, person_kind, person_id, on_date)
);
CALL app.apply_tenant_rls('birthday_wishes');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.dashboard.manage', 'platform', 'Set the landing page widgets and quick actions of each role', false),
  ('people.birthday.wish', 'people', 'Send birthday wishes to staff and pupils from the landing page', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r
  JOIN (VALUES ('group_admin', 'platform.dashboard.manage'), ('school_admin', 'platform.dashboard.manage'),
               ('group_admin', 'people.birthday.wish'), ('school_admin', 'people.birthday.wish'),
               ('front_office', 'people.birthday.wish'), ('front_desk', 'people.birthday.wish')) AS p(role, code) ON p.role = r.code
 WHERE r.school_id IS NULL
ON CONFLICT DO NOTHING;
