-- Gate pass: (1) the front desk's remark at hand-over (required when someone not on the pupil's record
-- collects); (2) in "any N are enough" mode a level can be mandatory: the pass is approved only when N
-- have approved and every mandatory level has, and a mandatory level's rejection ends it at once.
ALTER TABLE gate_passes ADD COLUMN handover_remark TEXT;
ALTER TABLE gate_pass_levels ADD COLUMN mandatory BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gate_pass_approvals ADD COLUMN mandatory BOOLEAN NOT NULL DEFAULT false;
