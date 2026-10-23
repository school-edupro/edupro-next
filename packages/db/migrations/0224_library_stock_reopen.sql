-- 0224: a closed stock cycle may be reopened, within the school's days (setting
-- library.stock_reopen_days, default 7) by someone with library.stock.close, with a reason, when no later
-- cycle has taken its books: the outcomes set at the close go back to pending and copies the close marked
-- lost get their earlier status back. When it closed (to the minute) and each reopening are kept.
ALTER TABLE library_stock_checks
  ADD COLUMN closed_at     TIMESTAMPTZ,
  ADD COLUMN reopened      INT NOT NULL DEFAULT 0,
  ADD COLUMN reopen_log    JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE library_stock_checks SET closed_at = finished_on::timestamp AT TIME ZONE 'Asia/Kolkata'
 WHERE status = 'closed' AND closed_at IS NULL AND finished_on IS NOT NULL;
