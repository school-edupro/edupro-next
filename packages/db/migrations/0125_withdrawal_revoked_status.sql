-- 0125: a completed withdrawal can be revoked (the pupil rejoins in the same session). The value is
-- used from 0126: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE withdrawal_status ADD VALUE IF NOT EXISTS 'revoked';
