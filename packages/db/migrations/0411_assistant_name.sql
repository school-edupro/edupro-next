-- 0411: the assistant's name and subtitles (docs/design/92, phase A). The chat window shows the name the school gives
-- it (default MobiAI) and a subtitle per audience (students, parents, teachers, office and admin); a subtitle left
-- empty shows the standard one in the person's language.
ALTER TABLE assistant_settings
  ADD COLUMN name      TEXT NOT NULL DEFAULT 'MobiAI' CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  -- {student, parent, teacher, admin}: the school's subtitle ('' or missing: the standard one)
  ADD COLUMN subtitles JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(subtitles) = 'object');
