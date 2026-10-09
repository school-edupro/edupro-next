-- 0108: a receipt remembers the school bank account the money goes into (cheque, draft, UPI, card, bank
-- transfer). One account for a fee type is taken by itself; with several the cashier chooses.
ALTER TABLE fee_payments ADD COLUMN bank_account_id BIGINT REFERENCES school_bank_accounts(id);
