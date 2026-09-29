-- Sprint 20: DPDP tooling (data-principal requests, retention runs, breach log, erasure routine) and the
-- compatibility parity settings. Design note docs/design/17-release-1-completeness.md.

-- ===========================================================================
-- 1. Data-principal requests
-- ===========================================================================
CREATE TABLE data_subject_requests (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  kind               TEXT NOT NULL CHECK (kind IN ('access', 'correction', 'erasure', 'grievance')),
  principal_kind     TEXT NOT NULL CHECK (principal_kind IN ('student', 'guardian', 'employee')),
  principal_id       BIGINT NOT NULL,
  requested_by_user  BIGINT REFERENCES users(id),
  channel            TEXT NOT NULL DEFAULT 'parent_app' CHECK (channel IN ('parent_app', 'office', 'email', 'letter')),
  detail             TEXT,
  status             TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'completed', 'refused')),
  received_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on             DATE NOT NULL,
  handled_by         BIGINT REFERENCES users(id),
  outcome            TEXT,
  export_id          BIGINT REFERENCES exports(id),
  change_request_id  BIGINT REFERENCES profile_change_requests(id),
  completed_at       TIMESTAMPTZ,
  request_id         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX data_subject_requests_queue ON data_subject_requests (school_id, status, due_on);
CREATE INDEX data_subject_requests_by_principal ON data_subject_requests (school_id, principal_kind, principal_id);
CALL app.apply_tenant_rls('data_subject_requests');

-- ===========================================================================
-- 2. Retention runs (one row per policy per nightly run)
-- ===========================================================================
CREATE TABLE retention_runs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  policy       TEXT NOT NULL,
  keep_days    INT NOT NULL,
  affected     INT NOT NULL DEFAULT 0,
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX retention_runs_recent ON retention_runs (school_id, ran_at DESC);
CALL app.apply_tenant_rls('retention_runs');

-- login_events is a global table (insert and select policies only), so the retention purge deletes
-- through a definer routine scoped to the current school.
CREATE OR REPLACE FUNCTION app.purge_login_events(p_days INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE v_n INT;
BEGIN
  DELETE FROM login_events WHERE school_id = app.current_school_id() AND occurred_at < now() - make_interval(days => GREATEST(p_days, 30));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION app.purge_login_events(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_login_events(INT) TO edupro_app;

-- ===========================================================================
-- 3. Breach log
-- ===========================================================================
CREATE TABLE breach_log (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id                BIGINT NOT NULL REFERENCES schools(id),
  title                    TEXT NOT NULL,
  detected_at              TIMESTAMPTZ NOT NULL,
  reported_by              BIGINT REFERENCES users(id),
  description              TEXT NOT NULL,
  data_classes             TEXT[] NOT NULL DEFAULT '{}',
  principals_affected      INT NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contained', 'notified', 'closed')),
  board_notified_at        TIMESTAMPTZ,
  principals_notified_at   TIMESTAMPTZ,
  actions                  TEXT,
  owner                    BIGINT REFERENCES users(id),
  closed_at                TIMESTAMPTZ,
  request_id               UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX breach_log_open ON breach_log (school_id, status, detected_at DESC);
CALL app.apply_tenant_rls('breach_log');

-- ===========================================================================
-- 4. Erasure: anonymise a principal's identifying data, keep the records the school must retain
-- ===========================================================================
CREATE OR REPLACE FUNCTION app.erase_principal(p_kind TEXT, p_id BIGINT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_school BIGINT := app.current_school_id();
  v_user   BIGINT;
  v_balance NUMERIC := 0;
  v_touched JSONB := '{}'::jsonb;
  v_n INT;
BEGIN
  IF p_kind = 'student' THEN
    IF EXISTS (SELECT 1 FROM enrolments e JOIN academic_years y ON y.id = e.academic_year_id
                WHERE e.student_id = p_id AND e.school_id = v_school AND e.status = 'active' AND y.status = 'active') THEN
      RAISE EXCEPTION 'principal-active' USING HINT = 'The pupil has an active enrolment; complete the withdrawal first', ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(sum(d.net - d.paid), 0) INTO v_balance
      FROM fee_demands d WHERE d.student_id = p_id AND d.school_id = v_school;
    IF v_balance > 0 THEN
      RAISE EXCEPTION 'principal-balance' USING HINT = 'The pupil has a fee balance; settle or write it off first', ERRCODE = 'P0001';
    END IF;
    SELECT user_id INTO v_user FROM students WHERE id = p_id AND school_id = v_school;
    UPDATE students SET first_name = 'Erased', last_name = 'Pupil ' || id,
           dob = NULL, gender = 'unspecified', category = NULL, blood_group = NULL, photo_file_id = NULL,
           address = '{}'::jsonb, details = jsonb_build_object('erased_at', now(), 'reason', p_reason),
           rfid_tag = NULL, status = 'inactive', updated_at = now()
     WHERE id = p_id AND school_id = v_school;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('students', v_n);
    UPDATE person_documents SET number = NULL, title = NULL, file_id = NULL, deleted_at = now()
     WHERE person_type = 'student' AND person_id = p_id AND school_id = v_school AND deleted_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('documents', v_n);
    UPDATE health_records SET notes = NULL WHERE student_id = p_id AND school_id = v_school;
    UPDATE clinic_visits SET complaint = '[erased]', treatment = NULL, referred_to = NULL WHERE student_id = p_id AND school_id = v_school;
    UPDATE files SET deleted_at = now() WHERE school_id = v_school AND owner_entity_type = 'student' AND owner_entity_id = p_id::text AND deleted_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('files', v_n);
    -- guardians linked only to this pupil lose their contact details too
    UPDATE guardians g SET first_name = 'Erased', last_name = 'Guardian ' || g.id,
           mobile = NULL, email = NULL, occupation = NULL, address = '{}'::jsonb,
           details = jsonb_build_object('erased_at', now()), status = 'inactive', updated_at = now()
     WHERE g.school_id = v_school
       AND g.id IN (SELECT sg.guardian_id FROM student_guardians sg WHERE sg.student_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM student_guardians o WHERE o.guardian_id = g.id AND o.student_id <> p_id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('guardians', v_n);
  ELSIF p_kind = 'guardian' THEN
    IF EXISTS (SELECT 1 FROM student_guardians sg JOIN enrolments e ON e.student_id = sg.student_id
                JOIN academic_years y ON y.id = e.academic_year_id
               WHERE sg.guardian_id = p_id AND sg.school_id = v_school AND e.status = 'active' AND y.status = 'active') THEN
      RAISE EXCEPTION 'principal-active' USING HINT = 'The guardian has a child on the rolls', ERRCODE = 'P0001';
    END IF;
    SELECT user_id INTO v_user FROM guardians WHERE id = p_id AND school_id = v_school;
    UPDATE guardians SET first_name = 'Erased', last_name = 'Guardian ' || id,
           mobile = NULL, email = NULL, occupation = NULL, address = '{}'::jsonb,
           details = jsonb_build_object('erased_at', now(), 'reason', p_reason), status = 'inactive', updated_at = now()
     WHERE id = p_id AND school_id = v_school;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('guardians', v_n);
    UPDATE person_documents SET number = NULL, title = NULL, file_id = NULL, deleted_at = now()
     WHERE person_type = 'guardian' AND person_id = p_id AND school_id = v_school AND deleted_at IS NULL;
  ELSIF p_kind = 'employee' THEN
    IF EXISTS (SELECT 1 FROM employees WHERE id = p_id AND school_id = v_school AND status = 'active' AND left_on IS NULL) THEN
      RAISE EXCEPTION 'principal-active' USING HINT = 'The employee is still in service; record the exit first', ERRCODE = 'P0001';
    END IF;
    SELECT user_id INTO v_user FROM employees WHERE id = p_id AND school_id = v_school;
    UPDATE employees SET first_name = 'Erased', last_name = 'Employee ' || id,
           dob = NULL, gender = 'unspecified', mobile = NULL, email = NULL, photo_file_id = NULL, address = '{}'::jsonb,
           details = jsonb_build_object('erased_at', now(), 'reason', p_reason), biometric_id = NULL, updated_at = now()
     WHERE id = p_id AND school_id = v_school;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('employees', v_n);
    UPDATE person_documents SET number = NULL, title = NULL, file_id = NULL, deleted_at = now()
     WHERE person_type = 'employee' AND person_id = p_id AND school_id = v_school AND deleted_at IS NULL;
    UPDATE files SET deleted_at = now() WHERE school_id = v_school AND owner_entity_type = 'employee' AND owner_entity_id = p_id::text AND deleted_at IS NULL;
  ELSE
    RAISE EXCEPTION 'principal-kind' USING HINT = 'kind must be student, guardian or employee', ERRCODE = 'P0001';
  END IF;

  -- the sign-in identity, when it belongs to this school only
  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_school_memberships m WHERE m.user_id = v_user AND m.school_id <> v_school AND m.deleted_at IS NULL) THEN
    UPDATE users SET display_name = 'Erased user ' || id, email = NULL, mobile = NULL, status = 'inactive',
           oneauth_sub = 'erased:' || id, updated_at = now(), deleted_at = now()
     WHERE id = v_user AND oneauth_sub NOT LIKE 'dev-%';
    UPDATE user_school_memberships SET status = 'inactive', deleted_at = now() WHERE user_id = v_user AND school_id = v_school AND deleted_at IS NULL;
    UPDATE comms_messages SET recipient_address = NULL, body = '[erased]', subject = CASE WHEN subject IS NULL THEN NULL ELSE '[erased]' END, variables = '{}'::jsonb
     WHERE school_id = v_school AND recipient_user_id = v_user;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_touched := v_touched || jsonb_build_object('messages', v_n);
    v_touched := v_touched || jsonb_build_object('user', true);
  END IF;
  RETURN v_touched;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_principal(TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_principal(TEXT, BIGINT, TEXT) TO edupro_app;

-- ===========================================================================
-- 5. Permissions and grants
-- ===========================================================================
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('platform.privacy.request',  'platform', 'Raise a data-principal request for oneself or one''s children', false),
  ('platform.privacy.erase',    'platform', 'Complete an erasure request (anonymises the person)', true),
  ('platform.breach.manage',    'platform', 'Record and work personal-data breaches', false)
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description, requires_mfa = EXCLUDED.requires_mfa;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('group_admin', 'school_admin')
  AND p.code IN ('platform.privacy.request', 'platform.privacy.erase', 'platform.breach.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE r.school_id IS NULL AND r.code IN ('parent', 'student', 'class_teacher', 'subject_teacher', 'academic_coordinator', 'accountant', 'clerk', 'librarian', 'transport_incharge', 'auditor')
  AND p.code = 'platform.privacy.request'
ON CONFLICT DO NOTHING;
