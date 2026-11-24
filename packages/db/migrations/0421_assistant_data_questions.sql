-- 0421: the school's switch "Data questions with the AI model" (docs/design/103, phase B): office and admin staff's
-- questions EduPro's own rules cannot answer may be answered by the AI model writing one query over the nlq views
-- (only the views their rights cover). Off until the school turns it on; needs the AI model on for all schools.
ALTER TABLE assistant_settings ADD COLUMN nlq BOOLEAN NOT NULL DEFAULT false;
