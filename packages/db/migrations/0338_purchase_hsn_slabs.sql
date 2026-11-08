-- The HSN / SAC master holds real GST rates (docs/design/83, "As built — GST follows the HSN master",
-- 8 Nov 2026): a rate is one of the GST slabs, and an exempt code has no rate. NOT VALID: rows saved
-- before are left as they are (the purchase set-up page lists them to fix); a new row, or a change to
-- an old one, must pass.
ALTER TABLE purchase_hsn
  ADD CONSTRAINT purchase_hsn_gst_slab
    CHECK (gst_rate IN (0, 0.25, 1.5, 3, 5, 12, 18, 28, 40)) NOT VALID,
  ADD CONSTRAINT purchase_hsn_exempt_no_rate
    CHECK (NOT exempt OR gst_rate = 0) NOT VALID;
