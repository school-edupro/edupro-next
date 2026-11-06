-- 6 Nov 2026 (asked, docs/design/81): the families' "report card published" message names the exam and
-- the pupil's class, and its e-mail is a letter on the school's letterhead with a "View report card"
-- button to the parent app's Results. New words sent with every message: {{exam}} (the release's
-- exams), {{class}} (the pupil's section, "I-A") and {{link}}; {{term}} (the release's name) stays.
-- Only the templates still on the old default words change: a school's own wording is kept, and an SMS
-- whose DLT template id is given keeps its registered words.

-- the default words, for new schools and for the update below
CREATE OR REPLACE FUNCTION app.exam_result_defaults()
RETURNS TABLE (channel TEXT, subject TEXT, body TEXT, format TEXT) LANGUAGE sql IMMUTABLE AS $fn$
  VALUES
    ('sms', NULL::text,
     'Dear parent, the {{exam}} report card of {{name}} ({{class}}) at {{school}} is published. See it in the parent app.',
     'text'),
    ('email', '{{exam}} report card of {{name}} is published',
     $html$<!doctype html><html><body style="margin:0;padding:0;background:#F3F5F9"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:24px 0"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;font-family:Segoe UI,Arial,Helvetica,sans-serif"><tr><td style="background:#00265D;color:#FFFFFF;padding:16px 24px;font-size:16px;font-weight:600">{{school}}</td></tr><tr><td style="padding:24px 24px 8px"><div style="font-size:20px;font-weight:700;color:#00265D">Report card published</div><p style="margin:10px 0 0;color:#2B3545;font-size:15px;line-height:1.5">Dear parent, the {{exam}} report card of <strong>{{name}}</strong> (class {{class}}) is now published.</p></td></tr><tr><td style="padding:16px 24px 8px"><a href="{{link}}" style="display:inline-block;background:#00265D;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px">View report card</a><div style="color:#5B6676;font-size:12px;margin-top:10px;word-break:break-all">Or open: {{link}}</div></td></tr><tr><td style="padding:8px 24px 4px;color:#2B3545;font-size:14px;line-height:1.5">You can also see it in the EduPro parent app under Results.</td></tr><tr><td style="padding:16px 24px 22px;color:#8791A0;font-size:12px;line-height:1.5">This is an automatic message from {{school}}. Please do not reply to it.</td></tr></table></td></tr></table></body></html>$html$,
     'html')
$fn$;

-- the e-mail still on the old default words becomes the letter (its subject too, when not reworded)
UPDATE comms_templates t
   SET body = d.body, format = d.format,
       subject = CASE WHEN t.subject = 'The {{term}} result of {{name}} is published' THEN d.subject ELSE t.subject END,
       variables = '["name","exam","class","school","link","term"]'::jsonb, updated_at = now()
  FROM app.exam_result_defaults() d
 WHERE d.channel = 'email' AND t.code = 'result_published' AND t.channel = 'email' AND t.format = 'text'
   AND t.body = 'Dear parent, the {{term}} result of {{name}} at {{school}} is published. See the report card in the parent app.';

-- the SMS on the old default words, not registered yet (no DLT template id)
UPDATE comms_templates t
   SET body = d.body, variables = '["name","exam","class","school"]'::jsonb, updated_at = now()
  FROM app.exam_result_defaults() d
 WHERE d.channel = 'sms' AND t.code = 'result_published' AND t.channel = 'sms'
   AND COALESCE(btrim(t.dlt_template_id), '') = ''
   AND t.body = 'Dear parent, the {{term}} result of {{name}} at {{school}} is published. See the report card in the parent app.';

-- new schools get the new words at once
CREATE OR REPLACE FUNCTION app.exam_seed_templates(p_school BIGINT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comms_templates (school_id, code, channel, name, subject, body, variables, category, format)
  SELECT p_school, 'result_published', d.channel::comms_channel, 'Exams: result published', d.subject, d.body,
         CASE WHEN d.channel = 'email' THEN '["name","exam","class","school","link","term"]'
              ELSE '["name","exam","class","school"]' END::jsonb,
         'service', d.format
    FROM app.exam_result_defaults() d
  ON CONFLICT (school_id, code, channel) DO NOTHING
$$;
