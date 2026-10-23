-- Online admission, part 5 (docs/design/39): candidates as an audience of Compose and of Notices, and
-- their messages and notices in the admission portal.

-- Compose: "Candidates" (registrations of a session, by class, status and stage; the rule carries the filter)
ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'candidates';

-- Notices: a notice for candidates, to everyone registering or to the classes sought
ALTER TYPE audience_kind ADD VALUE IF NOT EXISTS 'candidates';
ALTER TYPE notice_target_type ADD VALUE IF NOT EXISTS 'admission_class';

-- the family's inbox reads its messages by registration
CREATE INDEX IF NOT EXISTS message_request_recipients_candidate
  ON message_request_recipients (person_id) WHERE person_type = 'candidate';
