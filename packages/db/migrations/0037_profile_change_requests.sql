-- Families can request changes to student 360 profile fields (entity 'profile'); the office approves
-- and the change is applied through the profile writer (validation, encryption, completeness).
ALTER TABLE profile_change_requests DROP CONSTRAINT IF EXISTS profile_change_requests_entity_check;
ALTER TABLE profile_change_requests
  ADD CONSTRAINT profile_change_requests_entity_check CHECK (entity IN ('student', 'guardian', 'profile'));
