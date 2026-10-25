-- Counsellor pools by role (docs/design/46, part 2): a rule's pool names roles as well as people. A lead
-- goes in turn among the people named and whoever holds one of its roles when the lead arrives (none of
-- either: everyone who takes enquiries), so a new counsellor takes leads without editing the rule.

ALTER TABLE admission_enquiry_rules ADD COLUMN pool_roles TEXT[] NOT NULL DEFAULT '{}';
