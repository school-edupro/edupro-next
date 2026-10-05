-- 0079: a visit that was "resting in the clinic" and then got its time out stayed "resting" for ever.
-- From now on leaving asks how the visit ended; the ones already closed that way went back to class or
-- work (a pupil sent home or referred is recorded as such when it happens).
UPDATE clinic_visits SET outcome = 'back_to_class' WHERE outcome = 'rest' AND out_at IS NOT NULL;
