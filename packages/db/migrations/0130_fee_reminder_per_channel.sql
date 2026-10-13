-- 0130: a pupil is reminded once a day on each channel, not once a day in all. An email in the morning
-- no longer stops an SMS in the afternoon; the same channel twice in a day still needs "remind again".
ALTER TABLE fee_reminders DROP CONSTRAINT fee_reminders_student_id_sent_on_key;
ALTER TABLE fee_reminders ADD CONSTRAINT fee_reminders_student_day_channel_key UNIQUE (student_id, sent_on, channel);
