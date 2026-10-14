-- 0133: messages of the misc fee module as templates the school edits under Communication -> Templates:
-- the announcement of a misc fee and the reminder to those who have not paid, each for email, SMS and
-- WhatsApp. The email is ready to send; SMS goes out once its DLT template id is entered and WhatsApp
-- once its approved template name is entered (the wording here is what to register).
CREATE OR REPLACE FUNCTION app.misc_fee_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category, format)
  SELECT p_school, t.code, t.channel::comms_channel, t.name, t.subject, t.body, t.variables::jsonb, 'service', t.format
    FROM (VALUES
      ('misc_fee_announce', 'email', 'Misc fee: announcement', 'Miscellaneous Fees Announcement: {{fee_name}}',
       '<h2 style="color:#4caf50;text-align:center;margin:0 0 16px">Miscellaneous Fees Announcement</h2>'
       || '<p>Dear Parent,</p>'
       || '<p>This is to inform you that a Miscellaneous Fees has been announced regarding (<strong>{{fee_name}}</strong>) for your ward <strong>{{student_name}}</strong> ({{class}}, Admission No. {{admission_no}}). Kindly ensure that you complete the payment within the stipulated time to avoid any inconvenience.</p>'
       || '<p><strong>Important Details:</strong></p>'
       || '<ul><li>Head Name: <strong>{{fee_name}}</strong></li><li>Last Date of Submission: <strong>{{last_date}}</strong></li><li>Payment Amount: <strong>{{fee_amount}} (Applicable Fees)</strong></li></ul>'
       || '<p style="text-align:center;margin:20px 0"><a href="{{portal_link}}" style="background:#4caf50;color:#ffffff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold">View on Parent Portal</a></p>'
       || '<p>The fee is paid at the school fee counter. We appreciate your co-operation. For any questions or concerns, please contact the accounts department.</p>'
       || '<p>Best regards,<br>{{school}}</p>',
       '["fee_name","student_name","class","admission_no","last_date","fee_amount","portal_link","school"]', 'html'),
      ('misc_fee_due', 'email', 'Misc fee: due reminder', 'Reminder: {{fee_name}} is due by {{last_date}}',
       '<h2 style="color:#4caf50;text-align:center;margin:0 0 16px">Miscellaneous Fees Due Reminder</h2>'
       || '<p>Dear Parent,</p>'
       || '<p>This is a reminder that the Miscellaneous Fees regarding (<strong>{{fee_name}}</strong>) for your ward <strong>{{student_name}}</strong> ({{class}}, Admission No. {{admission_no}}) is still to be paid. Kindly complete the payment by the last date to avoid any inconvenience.</p>'
       || '<p><strong>Important Details:</strong></p>'
       || '<ul><li>Head Name: <strong>{{fee_name}}</strong></li><li>Last Date of Submission: <strong>{{last_date}}</strong></li><li>Amount Due: <strong>{{fee_due}}</strong></li></ul>'
       || '<p style="text-align:center;margin:20px 0"><a href="{{portal_link}}" style="background:#4caf50;color:#ffffff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:bold">View on Parent Portal</a></p>'
       || '<p>The fee is paid at the school fee counter. If you have already paid, please ignore this message. For any questions or concerns, please contact the accounts department.</p>'
       || '<p>Best regards,<br>{{school}}</p>',
       '["fee_name","student_name","class","admission_no","last_date","fee_due","portal_link","school"]', 'html'),
      ('misc_fee_announce', 'sms', 'Misc fee: announcement', NULL,
       'Dear Parent, a fee for {{fee_name}} of Rs. {{fee_amount}} has been announced for {{student_name}} ({{admission_no}}). Last date {{last_date}}. Please pay at the school fee counter. - {{school}}',
       '["fee_name","fee_amount","student_name","admission_no","last_date","school"]', 'text'),
      ('misc_fee_due', 'sms', 'Misc fee: due reminder', NULL,
       'Dear Parent, Rs. {{fee_due}} for {{fee_name}} of {{student_name}} ({{admission_no}}) is due. Last date {{last_date}}. Please pay at the school fee counter. - {{school}}',
       '["fee_due","fee_name","student_name","admission_no","last_date","school"]', 'text'),
      ('misc_fee_announce', 'whatsapp', 'Misc fee: announcement', NULL,
       'Dear Parent, a Miscellaneous Fees has been announced regarding {{fee_name}} for your ward {{student_name}} ({{admission_no}}). Payment Amount: Rs. {{fee_amount}}. Last Date of Submission: {{last_date}}. Kindly pay at the school fee counter within the stipulated time. - {{school}}',
       '["fee_name","student_name","admission_no","fee_amount","last_date","school"]', 'text'),
      ('misc_fee_due', 'whatsapp', 'Misc fee: due reminder', NULL,
       'Dear Parent, this is a reminder that Rs. {{fee_due}} for {{fee_name}} of your ward {{student_name}} ({{admission_no}}) is still to be paid. Last Date of Submission: {{last_date}}. Kindly pay at the school fee counter. - {{school}}',
       '["fee_due","fee_name","student_name","admission_no","last_date","school"]', 'text')
    ) AS t(code, channel, name, subject, body, variables, format)
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
SELECT app.misc_fee_seed_templates(id) FROM schools;
