-- 0132: reminders of an announced misc fee are kept apart from the reminders of fee dues. A pupil is
-- reminded once a day on each channel for fee dues, and once a day on each channel for each misc fee:
-- a trip reminder in the morning does not stop the fee reminder of the same day.
ALTER TABLE fee_reminders ADD COLUMN misc_fee_id bigint REFERENCES misc_fees(id);
ALTER TABLE fee_reminders DROP CONSTRAINT fee_reminders_student_day_channel_key;
CREATE UNIQUE INDEX fee_reminders_student_day_channel_key
    ON fee_reminders (student_id, sent_on, channel, COALESCE(misc_fee_id, 0));
