-- 0080: a visit recorded as back to class / work, sent home or referred is over; only someone resting is
-- still in the clinic. Visits saved that way without a time out showed as "in the clinic" for ever.
UPDATE clinic_visits SET out_at = in_at WHERE out_at IS NULL AND outcome <> 'rest';
