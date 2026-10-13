-- 0129: a deposit slip says whether its cheques are drawn on the school's own bank (transfer) or on
-- other banks (clearing): banks take the two on separate slips. Older slips carry no kind.
ALTER TABLE fee_deposit_slips ADD COLUMN kind TEXT CHECK (kind IN ('transfer', 'clearing'));
COMMENT ON COLUMN fee_deposit_slips.kind IS 'transfer = cheques of the same bank as the account; clearing = other banks; NULL = not separated';
