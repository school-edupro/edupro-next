-- 0425: switching back. My children (0424) opens the family website signed in from the staff website; now also from
-- the admin website, and the family website opened that way has a button back to the website it came from (Staff
-- app / Admin app), signed in the same way:
--  * a code for the family website notes the website it came from (`from_app`); the family website's session carries
--    it, and only such a session may ask for a code back to that website (a family sign-in of its own may not: the
--    school may sign families in by other means than staff);
--  * a code for the staff or admin website is made only for someone who is staff in that school (an employee or an
--    outside member), and turned in only while that membership is active.

ALTER TABLE web_hops DROP CONSTRAINT web_hops_app_check;
ALTER TABLE web_hops ADD CONSTRAINT web_hops_app_check CHECK (app IN ('parent', 'teacher', 'admin'));
ALTER TABLE web_hops ADD COLUMN from_app TEXT CHECK (from_app IN ('parent', 'teacher', 'admin'));
COMMENT ON COLUMN web_hops.from_app IS 'the website the code was asked from (the family website''s button back goes there)';
COMMENT ON TABLE web_hops IS 'one 60-second code that opens another EduPro website signed in (My children, and the family website''s way back)';

DROP FUNCTION app.web_hop_issue(text, bigint, text, bigint, text, boolean, int);
DROP FUNCTION app.web_hop_redeem(text, text);

-- Who may be signed in where: the family website a parent or student there; the staff and admin websites staff there.
CREATE OR REPLACE FUNCTION app.web_hop_member(p_user_id bigint, p_app text, p_school_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_school_memberships m JOIN users u ON u.id = m.user_id
     WHERE m.user_id = p_user_id AND m.school_id = p_school_id AND m.status = 'active' AND m.deleted_at IS NULL
       AND u.deleted_at IS NULL AND u.status = 'active'
       AND m.person_type::text = ANY (CASE p_app WHEN 'parent' THEN ARRAY['guardian', 'student']
                                                 ELSE ARRAY['employee', 'external'] END))
$$;
REVOKE EXECUTE ON FUNCTION app.web_hop_member(bigint, text, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.web_hop_issue(p_code_hash text, p_user_id bigint, p_app text, p_from_app text,
  p_school_id bigint, p_target text, p_mfa boolean, p_seconds int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF p_app NOT IN ('parent', 'teacher', 'admin') OR NOT app.web_hop_member(p_user_id, p_app, p_school_id) THEN
    RETURN false;
  END IF;
  -- old codes of this login go (used or out of time)
  DELETE FROM web_hops WHERE user_id = p_user_id AND (used_at IS NOT NULL OR expires_at < now());
  INSERT INTO web_hops (code_hash, user_id, app, from_app, school_id, target, mfa, expires_at)
  VALUES (p_code_hash, p_user_id, p_app, p_from_app, p_school_id, left(p_target, 500), p_mfa,
          now() + make_interval(secs => p_seconds));
  RETURN true;
END
$$;
REVOKE EXECUTE ON FUNCTION app.web_hop_issue(text, bigint, text, text, bigint, text, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.web_hop_issue(text, bigint, text, text, bigint, text, boolean, int) TO edupro_app;

-- The website turns the code in (once, in time, the website it was made for, the membership still active).
CREATE OR REPLACE FUNCTION app.web_hop_redeem(p_code_hash text, p_app text)
RETURNS TABLE (user_id bigint, school_id bigint, target text, mfa boolean, from_app text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE h web_hops%ROWTYPE;
BEGIN
  SELECT * INTO h FROM web_hops w WHERE w.code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND OR h.used_at IS NOT NULL OR h.expires_at < now() OR h.app <> p_app THEN
    RETURN;
  END IF;
  UPDATE web_hops SET used_at = now() WHERE code_hash = p_code_hash;
  RETURN QUERY
    SELECT h.user_id, h.school_id, h.target, h.mfa, h.from_app
     WHERE app.web_hop_member(h.user_id, h.app, h.school_id);
END
$$;
REVOKE EXECUTE ON FUNCTION app.web_hop_redeem(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.web_hop_redeem(text, text) TO edupro_app;
