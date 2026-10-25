-- The enquiry desk answers (docs/design/43, part 3): a website enquiry is assigned to a counsellor on
-- arrival (the one with the fewest open enquiries; ties: the longest since last given one), the family
-- gets an acknowledgement with the enquiry number, and the office replies by email / SMS from the
-- enquiry, the reply kept with its follow-ups.

ALTER TABLE admission_settings
  ADD COLUMN enquiry_auto_assign BOOLEAN NOT NULL DEFAULT true,
  -- who takes website enquiries: none = everyone who may manage enquiries
  ADD COLUMN enquiry_counsellors BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN enquiry_acknowledge BOOLEAN NOT NULL DEFAULT true;

-- when the enquiry was given to its counsellor (the tie-break of the next assignment)
ALTER TABLE admission_enquiries ADD COLUMN assigned_at TIMESTAMPTZ;
UPDATE admission_enquiries SET assigned_at = created_at WHERE counsellor_user_id IS NOT NULL;
CREATE INDEX admission_enquiries_counsellor_open ON admission_enquiries (school_id, counsellor_user_id)
  WHERE status IN ('new', 'follow_up', 'interested');

-- a reply sent to the family is a follow-up of its own kind
ALTER TABLE admission_enquiry_followups DROP CONSTRAINT admission_enquiry_followups_mode_check;
ALTER TABLE admission_enquiry_followups ADD CONSTRAINT admission_enquiry_followups_mode_check
  CHECK (mode IN ('call', 'visit', 'email', 'sms', 'whatsapp', 'note', 'invite', 'system', 'reply'));
