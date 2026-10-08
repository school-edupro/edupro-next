-- 0104: a discount type is only its code and name; what it takes off is kept head by head
-- (fee_discount_lines). Discounts that still carry the old single percentage / amount are turned into
-- lines with the same effect: on their own head, or on every regular and misc head when they named none,
-- and on the transport head when they applied to transport.
ALTER TABLE fee_discounts ALTER COLUMN percent SET DEFAULT 0;

INSERT INTO fee_discount_lines (school_id, discount_id, head_id, percent, amount)
SELECT d.school_id, d.id, h.id, d.percent, d.amount
  FROM fee_discounts d
  JOIN fee_heads h ON h.school_id = d.school_id AND h.deleted_at IS NULL
   AND ((d.head_id IS NOT NULL AND h.id = d.head_id)
     OR (d.head_id IS NULL AND h.kind IN ('regular', 'misc'))
     OR (d.applies_to_transport AND h.kind = 'transport'))
 WHERE (COALESCE(d.percent, 0) > 0 OR COALESCE(d.amount, 0) > 0)
   AND NOT EXISTS (SELECT 1 FROM fee_discount_lines l WHERE l.discount_id = d.id)
ON CONFLICT DO NOTHING;
