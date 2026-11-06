-- 6 Nov 2026 (asked, docs/design/82): publishing a report card sends nothing; the principal sends the
-- message to parents afterwards, when they choose, and only to the families not told yet. Who was told
-- is kept per release, pupil and channel, so nobody gets the same message twice and the SMS can follow
-- the e-mail later (once its DLT id is given).
CREATE TABLE report_card_told (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  release_id  BIGINT NOT NULL REFERENCES report_card_releases(id) ON DELETE CASCADE,
  student_id  BIGINT NOT NULL REFERENCES students(id),
  channel     comms_channel NOT NULL,
  -- the messages queued for the pupil's family on this channel (0: told before this was kept)
  messages    INT NOT NULL DEFAULT 0,
  told_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  told_by     BIGINT,
  UNIQUE (release_id, student_id, channel)
);
CREATE INDEX report_card_told_student ON report_card_told (student_id);
CALL app.apply_tenant_rls('report_card_told');

-- the families told before (their class published with messages queued) stay told: each pupil of such
-- a class who was not held or withheld for fees, on the channels the school's template was ready on
INSERT INTO report_card_told (school_id, release_id, student_id, channel, messages, told_at, told_by)
SELECT DISTINCT r.school_id, r.id, s.id, t.channel, 0, COALESCE(x.released_at, now()), x.released_by
  FROM report_card_releases r
  JOIN report_card_release_classes x ON x.release_id = r.id AND x.notified_count > 0
  JOIN class_sections cs ON cs.class_id = x.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
  JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
  JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
  JOIN comms_templates t ON t.school_id = r.school_id AND t.code = 'result_published' AND t.deleted_at IS NULL
   AND t.status = 'active' AND t.channel IN ('email', 'sms')
   AND (t.channel <> 'sms' OR COALESCE(btrim(t.dlt_template_id), '') <> '')
 WHERE NOT EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = s.id)
ON CONFLICT (release_id, student_id, channel) DO NOTHING;
