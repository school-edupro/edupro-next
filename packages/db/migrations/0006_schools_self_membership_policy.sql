-- 0006_schools_self_membership_policy.sql
-- At login the API resolves the caller and their memberships before any school is selected, so
-- app.allowed_school_ids is still empty. Let a user read the schools they hold an active membership in,
-- independent of the allowed list. Found by the reference-module e2e test (Sprint 0 first build).

CREATE POLICY schools_self_membership ON schools FOR SELECT TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM user_school_memberships m
      WHERE m.school_id = schools.id
        AND m.user_id = app.current_user_id()
        AND m.status = 'active'
        AND m.deleted_at IS NULL
    )
  );
