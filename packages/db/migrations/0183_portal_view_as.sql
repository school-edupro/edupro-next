-- 0183: open a portal as someone (docs/design/31-portal-view-as.md). From a student's page the school
-- admin opens the parent portal as the student or a parent, from an employee's page the teacher app as
-- that employee: a short, reasoned, audited impersonation session (0014) that says how far it goes
-- (view only, or acting as them except money) and which app it is for. A one-time code (60 seconds,
-- used once) carries the session into the other app. People with no login are given one first.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('access.portal.view_as', 'access', 'Open the parent portal or teacher app as a student, parent or employee (view only)', false),
  ('access.portal.act_as', 'access', 'Open the parent portal or teacher app as a student, parent or employee and act for them (no payments)', false)
ON CONFLICT (code) DO NOTHING;
-- view: the school's and the group's admins; act: the school admin (any other role is given either in Access)
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'access.portal.view_as' FROM roles r
 WHERE r.school_id IS NULL AND r.code IN ('school_admin', 'group_admin') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'access.portal.act_as' FROM roles r
 WHERE r.school_id IS NULL AND r.code = 'school_admin' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 'full': the admin app's own impersonation (as before); 'view' / 'act': a portal opened as someone
ALTER TABLE impersonation_sessions
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'full' CHECK (mode IN ('full', 'view', 'act')),
  ADD COLUMN app  TEXT NOT NULL DEFAULT 'admin' CHECK (app IN ('admin', 'parent', 'teacher')),
  -- whom it was opened for: the student, the parent, the employee (for the record and the page it came from)
  ADD COLUMN person_type TEXT CHECK (person_type IN ('student', 'guardian', 'employee')),
  ADD COLUMN person_ref_id BIGINT;

CREATE TABLE portal_handoffs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  session_id  BIGINT NOT NULL REFERENCES impersonation_sessions(id),
  app         TEXT NOT NULL CHECK (app IN ('parent', 'teacher')),
  -- sha-256 of the code; the code itself is never stored
  code_hash   TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE portal_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_handoffs_school ON portal_handoffs FOR ALL TO PUBLIC
  USING (school_id = app.current_school_id()) WITH CHECK (school_id = app.current_school_id());
CREATE POLICY portal_handoffs_migrator ON portal_handoffs FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- The other app hands the code in before anyone is signed in there: taken once, for that app, in time,
-- while the session is open. Owner's rights because no school is known yet.
CREATE OR REPLACE FUNCTION app.portal_handoff_take(p_hash TEXT, p_app TEXT)
RETURNS TABLE (o_session_id BIGINT, o_school_id BIGINT, o_sub TEXT, o_target_name TEXT, o_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  h record;
BEGIN
  UPDATE portal_handoffs SET used_at = now()
   WHERE code_hash = p_hash AND app = p_app AND used_at IS NULL AND expires_at > now()
  RETURNING session_id, school_id INTO h;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.id, s.school_id, u.oneauth_sub, u.display_name, s.expires_at
      FROM impersonation_sessions s JOIN users u ON u.id = s.target_user_id
     WHERE s.id = h.session_id AND s.ended_at IS NULL AND s.expires_at > now() AND s.app = p_app;
END
$$;
REVOKE ALL ON FUNCTION app.portal_handoff_take(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.portal_handoff_take(TEXT, TEXT) TO edupro_app;

-- The session check now also says how far the session goes and for which app.
DROP FUNCTION app.impersonation_check(BIGINT);
CREATE FUNCTION app.impersonation_check(p_id BIGINT)
RETURNS TABLE (o_school_id BIGINT, o_actor_user_id BIGINT, o_target_user_id BIGINT, o_actor_name TEXT,
               o_expires_at TIMESTAMPTZ, o_ended_at TIMESTAMPTZ, o_mode TEXT, o_app TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, app AS $$
  SELECT s.school_id, s.actor_user_id, s.target_user_id, u.display_name, s.expires_at, s.ended_at, s.mode, s.app
    FROM impersonation_sessions s JOIN users u ON u.id = s.actor_user_id
   WHERE s.id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION app.impersonation_check(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.impersonation_check(BIGINT) TO edupro_app;

-- A parent login, as the first sign-in by code makes one (0137): an account already holding the same
-- email (or, when only one does, the same mobile) is the same person and is linked; else a new one.
-- The parent membership and role; the guardian record points at it.
CREATE OR REPLACE FUNCTION app.guardian_create_login(p_guardian BIGINT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  g       record;
  v_uid   bigint;
  v_role  bigint;
  v_ids   bigint[];
  v_digit text;
BEGIN
  SELECT id, school_id, user_id, email::text AS email, mobile, display_name INTO g
    FROM guardians WHERE id = p_guardian AND school_id = app.current_school_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'guardian.not_found'; END IF;
  IF g.user_id IS NOT NULL THEN RETURN g.user_id; END IF;
  v_digit := right(regexp_replace(COALESCE(g.mobile, ''), '\D', '', 'g'), 10);
  IF NULLIF(g.email, '') IS NULL AND length(v_digit) < 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guardian.no_contact';
  END IF;
  IF NULLIF(g.email, '') IS NOT NULL THEN
    SELECT id INTO v_uid FROM users WHERE deleted_at IS NULL AND lower(email) = lower(g.email) ORDER BY id LIMIT 1;
  END IF;
  IF v_uid IS NULL AND length(v_digit) = 10 THEN
    SELECT array_agg(id) INTO v_ids FROM users
     WHERE deleted_at IS NULL AND right(regexp_replace(COALESCE(mobile, ''), '\D', '', 'g'), 10) = v_digit;
    IF cardinality(v_ids) = 1 THEN v_uid := v_ids[1]; END IF;
  END IF;
  IF v_uid IS NULL THEN
    INSERT INTO users (oneauth_sub, email, mobile, display_name)
    VALUES ('guardian:' || g.school_id || ':' || g.id, NULLIF(g.email, ''), NULLIF(v_digit, ''), g.display_name)
    RETURNING id INTO v_uid;
  END IF;
  INSERT INTO user_school_memberships (school_id, user_id, person_type, person_ref_id, status)
  VALUES (g.school_id, v_uid, 'guardian', g.id, 'active')
  ON CONFLICT (school_id, user_id, person_type)
  DO UPDATE SET status = 'active', deleted_at = NULL, updated_at = now();
  SELECT id INTO v_role FROM roles WHERE school_id IS NULL AND code = 'parent';
  IF v_role IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM user_roles WHERE school_id = g.school_id AND user_id = v_uid AND role_id = v_role AND revoked_at IS NULL) THEN
    INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES (g.school_id, v_uid, v_role, 'login made by the school');
  END IF;
  UPDATE guardians SET user_id = v_uid, updated_at = now() WHERE id = g.id;
  RETURN v_uid;
END
$$;
REVOKE ALL ON FUNCTION app.guardian_create_login(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_create_login(BIGINT) TO edupro_app;

-- A student login: the student membership and role; signs in once a contact is set (One Auth or a code).
CREATE OR REPLACE FUNCTION app.student_create_login(p_student BIGINT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  s      record;
  v_uid  bigint;
  v_role bigint;
BEGIN
  SELECT id, school_id, user_id, display_name INTO s
    FROM students WHERE id = p_student AND school_id = app.current_school_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'student.not_found'; END IF;
  IF s.user_id IS NOT NULL THEN RETURN s.user_id; END IF;
  INSERT INTO users (oneauth_sub, display_name)
  VALUES ('student:' || s.school_id || ':' || s.id, s.display_name)
  RETURNING id INTO v_uid;
  INSERT INTO user_school_memberships (school_id, user_id, person_type, person_ref_id, status)
  VALUES (s.school_id, v_uid, 'student', s.id, 'active')
  ON CONFLICT (school_id, user_id, person_type)
  DO UPDATE SET status = 'active', deleted_at = NULL, person_ref_id = EXCLUDED.person_ref_id, updated_at = now();
  SELECT id INTO v_role FROM roles WHERE school_id IS NULL AND code = 'student';
  IF v_role IS NOT NULL THEN
    INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES (s.school_id, v_uid, v_role, 'login made by the school');
  END IF;
  UPDATE students SET user_id = v_uid, updated_at = now() WHERE id = s.id;
  RETURN v_uid;
END
$$;
REVOKE ALL ON FUNCTION app.student_create_login(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.student_create_login(BIGINT) TO edupro_app;
