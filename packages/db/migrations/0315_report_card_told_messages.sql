-- 6 Nov 2026 (found on Alpha, docs/design/82): "told" follows the messages themselves. 0314 marked every
-- pupil of a class told whose class had queued messages, even when those messages were later cancelled
-- (release 1, VI: 15 cancelled on 1 Nov) and even pupils with no e-mail. Now each told row keeps its
-- message ids, and a family counts as told only while one of them is not cancelled or failed; the rows
-- 0314 filled are made again from the messages that exist (the release's name and the pupil's name the
-- message carries, sent to one of the pupil's guardians).
ALTER TABLE report_card_told ADD COLUMN message_ids BIGINT[] NOT NULL DEFAULT '{}';

DELETE FROM report_card_told WHERE messages = 0;

INSERT INTO report_card_told (school_id, release_id, student_id, channel, messages, message_ids, told_at)
SELECT r.school_id, r.id, s.id, m.channel, count(DISTINCT m.id)::int, array_agg(DISTINCT m.id), min(m.created_at)
  FROM report_card_releases r
  JOIN report_card_release_classes x ON x.release_id = r.id
  JOIN class_sections cs ON cs.class_id = x.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
  JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
  JOIN student_guardians sg ON sg.student_id = s.id
  JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
  JOIN comms_templates t ON t.school_id = r.school_id AND t.code = 'result_published'
  JOIN comms_messages m ON m.template_id = t.id AND m.school_id = r.school_id AND m.channel = t.channel
   AND m.variables->>'term' = r.name AND m.variables->>'name' = s.display_name
   AND m.status NOT IN ('cancelled', 'failed')
   AND ((m.channel = 'email' AND lower(btrim(m.recipient_address)) = lower(btrim(g.email::text)))
     OR (m.channel = 'sms' AND btrim(m.recipient_address) = btrim(g.mobile)))
 GROUP BY r.school_id, r.id, s.id, m.channel
ON CONFLICT (release_id, student_id, channel) DO NOTHING;
