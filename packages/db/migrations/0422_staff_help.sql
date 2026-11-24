-- 0422: Help for staff kept by the school, as Help for families (0406). The staff website's Help was a fixed list
-- written into the page; now each school keeps it on Helpdesk set-up beside the families' Help:
--  * the same headings and questions tables, each row for the families' Help or the staff's (`app`); a staff
--    question's heading is a staff heading, and its `page` a screen of the staff menu (the staff app opens it);
--  * staff questions are for every staff member (`audience` stays 'both'); one about a screen the person cannot open
--    is left out for them, as for families;
--  * "Was this helpful?" works the same (family_help_votes);
--  * a school starts with the standard staff questions (the staff website's old list) on its first use of Help for
--    staff (`staff_help_settings`); "Restore the standard questions" puts back any it deleted.

ALTER TABLE family_help_headings
  ADD COLUMN app TEXT NOT NULL DEFAULT 'family' CHECK (app IN ('family', 'staff'));
ALTER TABLE family_help_questions
  ADD COLUMN app TEXT NOT NULL DEFAULT 'family' CHECK (app IN ('family', 'staff'));

COMMENT ON COLUMN family_help_headings.app IS 'whose Help: family (parents and students) or staff';
COMMENT ON COLUMN family_help_questions.app IS 'whose Help: family (parents and students) or staff';

DROP INDEX family_help_headings_order;
CREATE INDEX family_help_headings_order ON family_help_headings (school_id, app, position) WHERE deleted_at IS NULL;
DROP INDEX family_help_questions_order;
CREATE INDEX family_help_questions_order ON family_help_questions (school_id, app, heading_id, position)
  WHERE deleted_at IS NULL;

-- a school's row once its standard staff questions were put in (on its first use of Help for staff)
CREATE TABLE staff_help_settings (
  school_id  BIGINT PRIMARY KEY REFERENCES schools(id),
  seeded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('staff_help_settings');
COMMENT ON TABLE staff_help_settings IS 'a school''s standard staff Help questions were put in (once, on first use)';
