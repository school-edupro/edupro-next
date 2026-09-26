-- 0004_procedures_and_seed.sql
-- Foundation procedures (ADR-006) and system seed: role templates, foundation permissions, SoD templates.

-- ---------------------------------------------------------------------------
-- Year guard: every money and marks procedure calls this first.
-- p_stage: 'attendance' | 'exams' | 'fees' | 'academics'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.assert_year_open(p_year_id BIGINT, p_stage TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_status year_status;
  v_locks  JSONB;
BEGIN
  PERFORM app.assert_context();

  SELECT status, locks INTO v_status, v_locks
  FROM academic_years
  WHERE id = p_year_id;                       -- RLS restricts to the current school

  IF NOT FOUND THEN
    RAISE EXCEPTION 'year.not_found'
      USING ERRCODE = 'P0002', DETAIL = jsonb_build_object('academic_year_id', p_year_id)::TEXT;
  END IF;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'year.closed'
      USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('academic_year_id', p_year_id)::TEXT;
  END IF;

  IF v_status = 'locked' OR COALESCE((v_locks ->> p_stage)::BOOLEAN, false) THEN
    RAISE EXCEPTION 'year.stage_locked'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('academic_year_id', p_year_id, 'stage', p_stage)::TEXT;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Receipt numbering: row-locked sequence per school, ledger and financial year.
-- Replaces the legacy "'TF' + MAX+1" pattern. Safe under concurrency.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.next_receipt_no(p_ledger ledger_type, p_financial_year_id BIGINT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_id      BIGINT;
  v_prefix  TEXT;
  v_next    BIGINT;
  v_width   SMALLINT;
  v_fy_code TEXT;
BEGIN
  PERFORM app.assert_context();

  SELECT id, prefix, next_no, width INTO v_id, v_prefix, v_next, v_width
  FROM receipt_sequences
  WHERE school_id = app.current_school_id()
    AND ledger_type = p_ledger
    AND financial_year_id = p_financial_year_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT code INTO v_fy_code FROM financial_years WHERE id = p_financial_year_id;
    IF v_fy_code IS NULL THEN
      RAISE EXCEPTION 'financial_year.not_found'
        USING ERRCODE = 'P0002', DETAIL = jsonb_build_object('financial_year_id', p_financial_year_id)::TEXT;
    END IF;

    -- Default prefixes; schools override by editing receipt_sequences before the first receipt of the year.
    v_prefix := CASE p_ledger
                  WHEN 'school'    THEN 'TF/'  || v_fy_code || '/'
                  WHEN 'hostel'    THEN 'HF/'  || v_fy_code || '/'
                  WHEN 'misc'      THEN 'MF/'  || v_fy_code || '/'
                  WHEN 'admission' THEN 'ADM/' || v_fy_code || '/'
                END;
    v_width := 6;

    INSERT INTO receipt_sequences (school_id, ledger_type, financial_year_id, prefix, next_no, width)
    VALUES (app.current_school_id(), p_ledger, p_financial_year_id, v_prefix, 1, v_width)
    ON CONFLICT (school_id, ledger_type, financial_year_id) DO NOTHING;

    -- Re-read with lock: a concurrent transaction may have inserted first.
    SELECT id, prefix, next_no, width INTO v_id, v_prefix, v_next, v_width
    FROM receipt_sequences
    WHERE school_id = app.current_school_id()
      AND ledger_type = p_ledger
      AND financial_year_id = p_financial_year_id
    FOR UPDATE;
  END IF;

  UPDATE receipt_sequences SET next_no = next_no + 1 WHERE id = v_id;

  RETURN v_prefix || lpad(v_next::TEXT, v_width, '0');
END
$$;

-- ---------------------------------------------------------------------------
-- Settings lookup with validity window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.setting(p_key TEXT, p_on DATE DEFAULT CURRENT_DATE) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT value
  FROM school_settings
  WHERE school_id = app.current_school_id()
    AND key = p_key
    AND valid_from <= p_on
    AND (valid_to IS NULL OR valid_to >= p_on)
  ORDER BY valid_from DESC
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Seed: foundation permissions (the API re-syncs from code at startup; this seed lets role templates exist
-- before the first API start)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.school.view',            'platform',  'View school profile and campuses', false),
  ('platform.school.manage',          'platform',  'Edit school profile, campuses, branding', false),
  ('platform.year.view',              'platform',  'View academic and financial years', false),
  ('platform.year.manage',            'platform',  'Create years, set active, edit dates', false),
  ('platform.year.lock',              'platform',  'Lock a stage or close a year', true),
  ('platform.year.reopen',            'platform',  'Reopen a locked stage', true),
  ('platform.year.rollover',          'platform',  'Run the year rollover', true),
  ('platform.settings.view',          'platform',  'View school settings', false),
  ('platform.settings.edit',          'platform',  'Edit school settings', false),
  ('platform.audit.view',             'platform',  'View audit logs', false),
  ('platform.audit.export',           'platform',  'Export audit logs', true),
  ('platform.files.upload',           'platform',  'Obtain signed upload URLs', false),
  ('access.role.view',                'access',    'View roles and permissions', false),
  ('access.role.manage',              'access',    'Create and edit school roles', false),
  ('access.assignment.view',          'access',    'View role assignments', false),
  ('access.assignment.manage',        'access',    'Grant and revoke roles and scopes', true),
  ('access.delegation.create',        'access',    'Delegate an own role', false),
  ('access.delegation.manage',        'access',    'Manage any delegation', false),
  ('access.session.impersonate',              'access',    'Start an impersonation session', true),
  ('access.membership.manage',        'access',    'Invite users and manage memberships', true),
  ('academics.class.view',            'academics', 'View classes', false),
  ('academics.class.create',          'academics', 'Create a class', false),
  ('academics.class.edit',            'academics', 'Edit a class', false),
  ('academics.class.delete',          'academics', 'Soft-delete a class', false),
  ('academics.class_section.view',    'academics', 'View sections (scoped)', false),
  ('academics.class_section.create',  'academics', 'Create a section', false),
  ('academics.class_section.edit',    'academics', 'Edit a section', false),
  ('academics.class_section.delete',  'academics', 'Soft-delete a section', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

-- ---------------------------------------------------------------------------
-- Seed: system role templates (school_id NULL, is_system true)
-- ---------------------------------------------------------------------------
INSERT INTO roles (school_id, code, name, kind, is_system, description) VALUES
  (NULL, 'group_admin',          'Group Admin',          'global', true, 'Administers every school in the group'),
  (NULL, 'school_admin',         'School Admin',         'global', true, 'Administers one school'),
  (NULL, 'auditor',              'Auditor',              'global', true, 'Read-only access to everything including audit logs'),
  (NULL, 'support_engineer',     'Support Engineer',     'global', true, 'Time-boxed read access without personal data export'),
  (NULL, 'academic_coordinator', 'Academic Coordinator', 'module', true, 'Manages classes, sections, timetable and academic masters'),
  (NULL, 'class_teacher',        'Class Teacher',        'module', true, 'Teacher responsible for a section (scoped)'),
  (NULL, 'subject_teacher',      'Subject Teacher',      'module', true, 'Teacher of a subject in sections (scoped)'),
  (NULL, 'parent',               'Parent',               'global', true, 'Parent or guardian portal user'),
  (NULL, 'student',              'Student',              'global', true, 'Student portal user')
ON CONFLICT (school_id, code) DO NOTHING;

-- Role template permissions
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'group_admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'school_admin'
  AND p.code NOT IN ('platform.year.rollover', 'access.session.impersonate')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'auditor'
  AND (p.code LIKE '%.view' OR p.code IN ('platform.audit.export'))
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'support_engineer'
  AND p.code LIKE '%.view' AND p.module IN ('platform', 'access')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code = 'academic_coordinator' AND p.module = 'academics'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('class_teacher', 'subject_teacher')
  AND p.code IN ('academics.class.view', 'academics.class_section.view')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: segregation of duties templates (module pairs are added by their module migrations)
-- ---------------------------------------------------------------------------
INSERT INTO sod_rules (school_id, permission_a, permission_b, description) VALUES
  (NULL, 'access.assignment.manage', 'platform.audit.export',
   'A person who grants roles must not be able to export and remove the evidence trail')
ON CONFLICT DO NOTHING;
