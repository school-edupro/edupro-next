-- 0262: admission fee refunds go through approval levels set on Fees -> Approval (docs/design/54): the
-- refund keeps its workflow instance, and the family hears when it is approved and when it is paid.
ALTER TABLE admission_refunds ADD COLUMN workflow_instance_id BIGINT REFERENCES workflow_instances(id);
ALTER TABLE admission_refunds ADD COLUMN voucher_file_id BIGINT REFERENCES files(id);

-- the admission notices, with the refund one added (the rest as in 0227)
CREATE OR REPLACE FUNCTION app.admission_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category)
  SELECT p_school, t.code, ch.channel::comms_channel, t.name,
         CASE WHEN ch.channel = 'email' THEN t.subject END, t.body, t.variables::jsonb, 'service'
    FROM (VALUES
      ('admission_otp', 'Admission: sign-in code', 'Your sign-in code for {{school}} admissions',
       '{{otp}} is your code to sign in to {{school}} admissions. It is valid for {{minutes}} minutes. Do not share it.',
       '["otp","school","minutes"]'),
      ('admission_received', 'Admission: form submitted', 'Registration form submitted for {{name}}',
       'Dear parent, the registration form of {{name}} for {{class}} at {{school}} is submitted. Pay the registration fee of Rs {{amount}} to complete the registration.',
       '["name","class","school","amount"]'),
      ('admission_registered', 'Admission: registration complete', 'Registration {{number}}: {{name}}',
       'Dear parent, {{name}} is registered for {{class}} at {{school}}. Registration no {{number}}. The form and the receipt are in the admission portal.',
       '["name","class","school","number"]'),
      ('admission_correction', 'Admission: correction asked', 'Please correct the registration form of {{name}}',
       'Dear parent, {{school}} asks you to correct the registration form {{number}} of {{name}} by {{due}}: {{remark}}. Sign in to the admission portal to correct it.',
       '["name","school","number","due","remark"]'),
      ('admission_schedule', 'Admission: test / interview', '{{stage}} for {{name}} on {{when}}',
       'Dear parent, the {{stage}} of {{name}} (registration {{number}}) is on {{when}} at {{venue}}. Download the admit card from the admission portal.',
       '["name","number","stage","when","venue"]'),
      ('admission_result', 'Admission: result', 'Admission result of {{name}}',
       'Dear parent, the admission result of {{name}} (registration {{number}}) at {{school}}: {{result}}. Details are in the admission portal.',
       '["name","number","school","result"]'),
      ('admission_offer', 'Admission: offer and fee', 'Admission offer for {{name}}: pay by {{due}}',
       'Dear parent, {{name}} is offered admission to {{class}} at {{school}}. Pay the admission fee of Rs {{amount}} by {{due}} in the admission portal or at the school.',
       '["name","class","school","amount","due"]'),
      ('admission_fee_paid', 'Admission: fee received', 'Admission fee received: {{name}}',
       'Dear parent, the admission fee of Rs {{amount}} for {{name}} is received (receipt {{receipt}}). Admission no {{admission_no}}.',
       '["name","amount","receipt","admission_no"]'),
      ('admission_admitted', 'Admission: admitted', '{{name}} is admitted to {{class}}',
       'Dear parent, {{name}} is admitted to {{class}} {{section}} at {{school}}. Admission no {{admission_no}}. Sign in to the parent app with this mobile number.',
       '["name","class","section","school","admission_no"]'),
      ('admission_cancelled', 'Admission: cancelled', 'Registration {{number}} of {{name}} is cancelled',
       'Dear parent, the registration {{number}} of {{name}} at {{school}} is cancelled. {{note}}',
       '["name","number","school","note"]'),
      ('admission_message', 'Admission: message from the school', '{{subject}}',
       '{{message}}', '["subject","message","name"]'),
      ('admission_refund', 'Admission: fee refund', 'Admission fee refund of {{name}}: {{state}}',
       'Dear parent, the admission fee refund of Rs {{amount}} for {{name}} (registration {{number}}) at {{school}} is {{state}}. {{note}}',
       '["name","number","school","amount","state","note"]')
    ) AS t(code, name, subject, body, variables)
    CROSS JOIN (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
