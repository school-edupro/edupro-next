-- 0105: the school adds its own payment modes ("NEFT", "Paytm QR", "POS machine"). Each one works like
-- one of the built-in kinds (cash, cheque, draft, UPI, card, bank transfer), so receipts, the day book,
-- bounces and deposit slips keep working; the receipt remembers the school's own name of the mode.
ALTER TABLE fee_payment_modes DROP CONSTRAINT IF EXISTS fee_payment_modes_code_check;
ALTER TABLE fee_payment_modes
  ADD COLUMN kind TEXT;
UPDATE fee_payment_modes SET kind = code;
ALTER TABLE fee_payment_modes
  ALTER COLUMN kind SET NOT NULL,
  ADD CONSTRAINT fee_payment_modes_kind_check CHECK (kind IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card')),
  ADD CONSTRAINT fee_payment_modes_code_format CHECK (code ~ '^[a-z0-9_]{2,30}$');

CREATE OR REPLACE FUNCTION app.fee_seed_payment_modes() RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO fee_payment_modes (school_id, code, kind, label, at_counter, need_instrument_no, sort_order)
  SELECT app.current_school_id(), m.code, m.code, m.label, m.at_counter, m.need_no, m.ord
    FROM (VALUES ('cash', 'Cash', true, false, 1), ('cheque', 'Cheque', true, true, 2), ('dd', 'Demand draft', true, true, 3),
                 ('upi', 'UPI', true, false, 4), ('card', 'Card', true, false, 5), ('bank', 'Bank transfer', true, false, 6),
                 ('online', 'Online (payment gateway)', false, false, 7)) AS m(code, label, at_counter, need_no, ord)
  ON CONFLICT (school_id, code) DO NOTHING
$$;

ALTER TABLE fee_payments  ADD COLUMN mode_label TEXT;
ALTER TABLE misc_receipts ADD COLUMN mode_label TEXT;
