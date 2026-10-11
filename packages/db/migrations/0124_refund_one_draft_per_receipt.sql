-- 0124: one draft refund per receipt (a new draft replaces the old one).
CREATE UNIQUE INDEX fee_refunds_draft ON fee_refunds (payment_id) WHERE status = 'draft' AND payment_id IS NOT NULL;
