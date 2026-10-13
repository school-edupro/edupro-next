-- 0128: a bounced or cancelled receipt remembers the fee lines it had paid (head, month, amount), so the
-- cheque bounce report can say whether that fee has been paid again and by which receipts. Requests
-- approved before this have no lines; the report then goes by the pupil's later receipts.
ALTER TABLE fee_adjustments ADD COLUMN lines JSONB;
COMMENT ON COLUMN fee_adjustments.lines IS 'reversal / bounce: what the receipt had paid when it was taken back, [{demandId, head, period, amount}]';
