-- 0165: revoking the school withdrawal of a boarder may also put the pupil back in the hostel
-- (docs/design/27-hostel-withdrawal.md, part 6): as if never left (the same stay goes on) or back from a
-- day (a new stay; the months away not charged). Empty: the pupil rejoins the school as a day scholar.
ALTER TABLE student_withdrawals
  ADD COLUMN revoke_hostel_mode    TEXT CHECK (revoke_hostel_mode IN ('continue', 'from_date')),
  ADD COLUMN revoke_hostel_from    DATE,
  ADD COLUMN revoke_hostel_bed_id  BIGINT REFERENCES hostel_beds(id),
  ADD COLUMN revoke_hostel_note    TEXT;
