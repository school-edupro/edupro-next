-- Report builder (post-freeze change, 2026-09-30): saved, shareable student reports.
-- A definition holds the chosen columns with the user's own header text, filters, sort and page options
-- (spec JSONB, see packages/db/src/report-builder.ts). The owner shares it with named users or roles,
-- as view only or can edit. Exports run through the export pipeline with the school's branding.

CREATE TABLE report_definitions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  dataset     TEXT NOT NULL DEFAULT 'student_profile' CHECK (dataset IN ('student_profile')),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
  description TEXT,
  spec        JSONB NOT NULL,
  owner_id    BIGINT NOT NULL REFERENCES users(id),
  status      row_status NOT NULL DEFAULT 'active',
  last_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT
);
CREATE UNIQUE INDEX report_definitions_owner_name_uq
  ON report_definitions (school_id, owner_id, lower(name)) WHERE status = 'active';
CALL app.apply_tenant_rls('report_definitions');

CREATE TABLE report_shares (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  report_id   BIGINT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id),
  role_id     BIGINT REFERENCES roles(id),
  can_edit    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  BIGINT,
  CHECK ((user_id IS NULL) <> (role_id IS NULL))
);
CREATE UNIQUE INDEX report_shares_user_uq ON report_shares (report_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX report_shares_role_uq ON report_shares (report_id, role_id) WHERE role_id IS NOT NULL;
CALL app.apply_tenant_rls('report_shares');

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('reports.builder.use',    'reports', 'Build, save, share and download own custom reports', false),
  ('reports.builder.manage', 'reports', 'See, edit and delete every custom report of the school', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
   AND p.code IN ('reports.builder.use', 'reports.builder.manage', 'reports.export.view')
ON CONFLICT DO NOTHING;

-- builders who are not administrators; they also need to see their own exports
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.school_id IS NULL AND r.code IN ('academic_coordinator', 'accountant', 'clerk', 'class_teacher')
   AND p.code IN ('reports.builder.use', 'reports.export.view')
ON CONFLICT DO NOTHING;
