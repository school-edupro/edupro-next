-- 0190: a person on two consecutive ACR levels assesses once (docs/design/32-employee-acr.md, 19 Oct 2026):
-- a level whose people are exactly those of the level before it is skipped, with a note, and the ACR
-- goes on to the next level. The skip is recomputed whenever a level's people change.
ALTER TABLE acr_reviews DROP CONSTRAINT acr_reviews_status_check;
ALTER TABLE acr_reviews ADD CONSTRAINT acr_reviews_status_check
  CHECK (status IN ('waiting', 'pending', 'done', 'skipped'));
ALTER TABLE acr_reviews ADD COLUMN skipped_note TEXT;
