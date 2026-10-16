-- 0160: hostel leave approval levels. Home leave and outings were approved by any warden of the pupil's
-- hostel, fixed in code. Now each has its own levels on Gate passes → Set-up (and Hostel → Set-up), like
-- pupil and staff passes: one after another or any N, a level may be compulsory, and two new kinds of
-- approver: a warden of the pupil's hostel, or its head warden. The first read of a school's set-up adds
-- one level "Warden" (any warden of the pupil's hostel) to each, so nothing changes until the school does.
ALTER TABLE gate_pass_levels DROP CONSTRAINT IF EXISTS gate_pass_levels_audience_check;
ALTER TABLE gate_pass_levels ADD CONSTRAINT gate_pass_levels_audience_check
  CHECK (audience IN ('student', 'staff', 'hostel_home', 'hostel_outing'));
ALTER TABLE gate_pass_levels DROP CONSTRAINT IF EXISTS gate_pass_levels_kind_check;
ALTER TABLE gate_pass_levels ADD CONSTRAINT gate_pass_levels_kind_check
  CHECK (kind IN ('class_teacher', 'role', 'designation', 'employee', 'hostel_warden', 'head_warden'));
ALTER TABLE gate_pass_settings
  ADD COLUMN hostel_home_mode   TEXT NOT NULL DEFAULT 'sequence' CHECK (hostel_home_mode IN ('sequence', 'any')),
  ADD COLUMN hostel_home_need   INT NOT NULL DEFAULT 1 CHECK (hostel_home_need BETWEEN 1 AND 6),
  ADD COLUMN hostel_outing_mode TEXT NOT NULL DEFAULT 'sequence' CHECK (hostel_outing_mode IN ('sequence', 'any')),
  ADD COLUMN hostel_outing_need INT NOT NULL DEFAULT 1 CHECK (hostel_outing_need BETWEEN 1 AND 6);
