-- 0013_sprint4_compat_lookup.sql
-- Sprint 4: identity lookup for the compatibility handshake (S4-05). The current apps identify a person by
-- the legacy id or mobile number before any tenant context exists, so this is SECURITY DEFINER with a
-- narrow surface (returns ids and display data only), recorded with app.invite_user as an ADR-006 exception.

CREATE OR REPLACE FUNCTION app.compat_lookup(p_school_ref TEXT, p_legacy_ref TEXT, p_mobile TEXT)
RETURNS TABLE (o_user_id BIGINT, o_oneauth_sub TEXT, o_display_name TEXT, o_school_id BIGINT, o_person_type TEXT, o_school_name TEXT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, app AS $$
  SELECT u.id, u.oneauth_sub, u.display_name, m.school_id, m.person_type::text, s.name
    FROM users u
    JOIN user_school_memberships m ON m.user_id = u.id AND m.status = 'active' AND m.deleted_at IS NULL
    JOIN schools s ON s.id = m.school_id AND s.status = 'active'
   WHERE u.deleted_at IS NULL AND u.status = 'active'
     AND (s.id::text = p_school_ref OR s.legacy_ref = p_school_ref)
     AND (u.legacy_ref = p_legacy_ref OR (p_mobile IS NOT NULL AND p_mobile <> '' AND u.mobile = p_mobile))
   ORDER BY CASE WHEN u.legacy_ref = p_legacy_ref THEN 0 ELSE 1 END,
            CASE m.person_type WHEN 'student' THEN 0 WHEN 'employee' THEN 1 ELSE 2 END
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION app.compat_lookup(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.compat_lookup(TEXT, TEXT, TEXT) TO edupro_app;
