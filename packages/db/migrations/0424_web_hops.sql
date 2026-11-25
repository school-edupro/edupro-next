-- 0424: a staff member who is also a parent here opens the family website from the staff website without signing in
-- again ("My children", docs/design/89 "Staff who are parents here"). Each website keeps its own sign-in, so the
-- family website asked them to sign in. Now the staff website asks the API for a one-time code (60 seconds, used
-- once, kept only as a hash), opens the family website with it, and the family website turns it in for its own
-- session. As the phone's hand-over to a web page (0400), without a phone session:
--  * a code is made only for someone who is a parent (or a student) in the school the staff website is working in;
--  * it is turned in only once, in time, for the family website, while that membership is still active.

CREATE TABLE web_hops (
  code_hash   TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  app         TEXT NOT NULL CHECK (app IN ('parent')),
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  target      TEXT NOT NULL,
  mfa         BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE web_hops IS 'one 60-second code that opens the family website signed in from the staff website (a staff member who is also a parent)';
CREATE INDEX web_hops_user ON web_hops (user_id, created_at);
ALTER TABLE web_hops ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_hops FORCE ROW LEVEL SECURITY;
CREATE POLICY web_hops_migrator ON web_hops FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- A code for the family website: only for a login that is a parent (or a student) in that school now.
CREATE OR REPLACE FUNCTION app.web_hop_issue(p_code_hash text, p_user_id bigint, p_app text, p_school_id bigint,
  p_target text, p_mfa boolean, p_seconds int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
BEGIN
  IF p_app <> 'parent' OR NOT EXISTS (
       SELECT 1 FROM user_school_memberships m
        WHERE m.user_id = p_user_id AND m.school_id = p_school_id AND m.person_type IN ('guardian', 'student')
          AND m.status = 'active' AND m.deleted_at IS NULL) THEN
    RETURN false;
  END IF;
  -- old codes of this login go (used or out of time)
  DELETE FROM web_hops WHERE user_id = p_user_id AND (used_at IS NOT NULL OR expires_at < now());
  INSERT INTO web_hops (code_hash, user_id, app, school_id, target, mfa, expires_at)
  VALUES (p_code_hash, p_user_id, p_app, p_school_id, left(p_target, 500), p_mfa, now() + make_interval(secs => p_seconds));
  RETURN true;
END
$$;
REVOKE EXECUTE ON FUNCTION app.web_hop_issue(text, bigint, text, bigint, text, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.web_hop_issue(text, bigint, text, bigint, text, boolean, int) TO edupro_app;

-- The family website turns the code in (once, in time, for the app it was made for, the membership still active).
CREATE OR REPLACE FUNCTION app.web_hop_redeem(p_code_hash text, p_app text)
RETURNS TABLE (user_id bigint, school_id bigint, target text, mfa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE h web_hops%ROWTYPE;
BEGIN
  SELECT * INTO h FROM web_hops w WHERE w.code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND OR h.used_at IS NOT NULL OR h.expires_at < now() OR h.app <> p_app THEN
    RETURN;
  END IF;
  UPDATE web_hops SET used_at = now() WHERE code_hash = p_code_hash;
  RETURN QUERY
    SELECT h.user_id, h.school_id, h.target, h.mfa
     WHERE EXISTS (
       SELECT 1 FROM user_school_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.user_id = h.user_id AND m.school_id = h.school_id AND m.person_type IN ('guardian', 'student')
          AND m.status = 'active' AND m.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status = 'active');
END
$$;
REVOKE EXECUTE ON FUNCTION app.web_hop_redeem(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.web_hop_redeem(text, text) TO edupro_app;
