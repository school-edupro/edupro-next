-- 0123: a refund can be kept as a draft: the accounts office fills the amounts, prints the provisional
-- refund bill for the parent, and sends it for approval only after that. (The value is used from 0124:
-- a new enum value cannot be used in the transaction that adds it.)
ALTER TYPE refund_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'requested';
