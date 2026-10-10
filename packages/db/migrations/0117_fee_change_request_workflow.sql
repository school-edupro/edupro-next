-- 0117: a late-fee waiver and a sibling transfer of a receipt go through the approval levels set under
-- Fee setup -> Approval levels (the same levels as a fee change of a pupil), instead of one person
-- approving on the requests page. The request remembers its approval.
ALTER TABLE fee_change_requests ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id);
