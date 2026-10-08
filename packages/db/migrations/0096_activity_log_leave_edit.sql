-- 0096: the daily activity log knows a day of leave, and a submitted day may be corrected until it is
-- reviewed. An employee (or the office for them) marks the day as leave, full or half, with its type
-- and reason; reports count it as leave, not as "not filled".
ALTER TABLE activity_logs
  ADD COLUMN leave_kind   TEXT CHECK (leave_kind IN ('full', 'half')),
  ADD COLUMN leave_type   TEXT,
  ADD COLUMN leave_reason TEXT,
  ADD COLUMN leave_by     BIGINT,
  -- when a submitted day was last changed by the employee
  ADD COLUMN edited_at    TIMESTAMPTZ;
