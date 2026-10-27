-- 0261: admission fees at the counter (docs/design/52) take a cheque or draft date like the pupils'
-- counter does; misc receipts (admission, registration, misc fees) keep it beside the number and bank.
ALTER TABLE misc_receipts ADD COLUMN instrument_date DATE;
