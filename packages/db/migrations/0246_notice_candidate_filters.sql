-- Notices for candidates chosen like Communication → Compose (docs/design/43, part 2): the admission
-- session as a target, the classes sought, and the registration statuses (none: every registration).
-- A notice with classes only keeps matching the open sessions by class, as before.

ALTER TYPE notice_target_type ADD VALUE IF NOT EXISTS 'admission_cycle';

ALTER TABLE notices
  ADD COLUMN candidate_statuses TEXT[]
    CHECK (candidate_statuses IS NULL OR cardinality(candidate_statuses) BETWEEN 1 AND 20);
