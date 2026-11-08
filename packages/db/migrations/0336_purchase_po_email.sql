-- The Purchase Order e-mail to the vendor designed, replies to the purchase office (docs/design/83, "As
-- built — the PO e-mail; signatures; instructions from settings", 8 Nov 2026).

-- where vendors write back (the PO e-mail's reply-to, named in it)
ALTER TABLE purchase_settings
  ADD COLUMN office_email TEXT CHECK (office_email IS NULL OR (length(office_email) <= 150 AND office_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

-- a message's own reply-to (else the provider's)
ALTER TABLE comms_messages
  ADD COLUMN reply_to TEXT CHECK (reply_to IS NULL OR length(reply_to) <= 150);

-- the wording the school edits on Communication → Templates; {{order_summary}} and {{items}} are boxes
-- the system fills in
CREATE OR REPLACE FUNCTION app.purchase_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  VALUES (p_school, 'purchase_order', 'email', 'Purchase: order to the vendor',
          'Purchase Order {{number}} from {{school}}',
          E'Dear {{vendor_contact}},\n\n'
          || E'Please find attached our Purchase Order {{number}} dated {{date}} for {{amount}} (with GST). Kindly confirm that you accept it by replying to this e-mail.\n\n'
          || E'{{order_summary}}\n\n{{items}}\n\n'
          || E'Please deliver by {{delivery}} to the address above, and quote the PO number on your invoice and delivery challan. Invoices are to be made out to {{bill_to}}.\n\n'
          || E'For any question, write to {{contact}}.\n\n'
          || E'Regards,\n{{signatory}}\n{{signatory_designation}}\n{{school}}',
          '["vendor","vendor_contact","number","date","amount","delivery","address","bill_to","contact","signatory","signatory_designation","school","order_summary","items"]'::jsonb,
          'service')
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;

-- schools still on the first wording get the new one; an edited template is left as the school made it
UPDATE comms_templates
   SET body = E'Dear {{vendor_contact}},\n\n'
          || E'Please find attached our Purchase Order {{number}} dated {{date}} for {{amount}} (with GST). Kindly confirm that you accept it by replying to this e-mail.\n\n'
          || E'{{order_summary}}\n\n{{items}}\n\n'
          || E'Please deliver by {{delivery}} to the address above, and quote the PO number on your invoice and delivery challan. Invoices are to be made out to {{bill_to}}.\n\n'
          || E'For any question, write to {{contact}}.\n\n'
          || E'Regards,\n{{signatory}}\n{{signatory_designation}}\n{{school}}'
 WHERE code = 'purchase_order' AND channel = 'email'
   AND body = 'Dear {{vendor}}, please find attached our Purchase Order {{number}} dated {{date}} for {{amount}}. '
           || 'Kindly confirm that you accept it and deliver by {{delivery}} to {{address}}. '
           || 'Please quote the order number on your invoice and delivery challan. For any question, write to {{contact}}. '
           || 'Regards, {{signatory}}, {{school}}';
UPDATE comms_templates
   SET variables = '["vendor","vendor_contact","number","date","amount","delivery","address","bill_to","contact","signatory","signatory_designation","school","order_summary","items"]'::jsonb
 WHERE code = 'purchase_order' AND channel = 'email';
