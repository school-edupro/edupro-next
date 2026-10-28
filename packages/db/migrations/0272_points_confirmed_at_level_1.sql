-- Points confirmed at Document check level 1 (docs/design/62): approving the first level of Document
-- check now confirms the registration's points as they stand (undoing it clears them). Registrations
-- already approved there get theirs confirmed now, as of that approval. The draw slips may also show the
-- candidate's merit no. and merit total.

UPDATE applications a SET points_confirmed_at = x.decided_at, points_confirmed_by = x.decided_by
  FROM (SELECT DISTINCT ON (r.application_id) r.application_id, r.decided_at, r.decided_by
          FROM admission_stage_results r JOIN admission_stages st ON st.id = r.stage_id
         WHERE st.kind = 'document_check' AND r.level = 1 AND r.decision = 'approved' AND r.undone_at IS NULL
         ORDER BY r.application_id, r.decided_at DESC) x
 WHERE a.id = x.application_id AND a.points_confirmed_at IS NULL;

ALTER TABLE admission_draw_settings DROP CONSTRAINT admission_draw_settings_fields_check;
ALTER TABLE admission_draw_settings ADD CONSTRAINT admission_draw_settings_fields_check
  CHECK (fields <@ ARRAY['photo', 'name', 'father', 'mother', 'dob', 'number', 'sno', 'points', 'merit',
                         'merit_no', 'category', 'session', 'draw']::text[]);
