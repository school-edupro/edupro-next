-- 0410: Assistant set-up per school (docs/design/91, phase C). The office turns the chatbot on or off for each
-- audience (students, parents, teachers, office and admin staff), sets how many questions a person may ask a day,
-- switches topics off per audience (e.g. no fee questions for students), and chooses the starter questions shown on the
-- chat's start screen. No row: everything on, 30 questions a day, no topic off, the standard starters.
CREATE TABLE assistant_settings (
  school_id    BIGINT PRIMARY KEY REFERENCES schools(id),
  -- {student, parent, teacher, admin}: true / false
  audiences    JSONB NOT NULL DEFAULT '{"student": true, "parent": true, "teacher": true, "admin": true}'::jsonb
               CHECK (jsonb_typeof(audiences) = 'object'),
  daily_limit  INT NOT NULL DEFAULT 30 CHECK (daily_limit BETWEEN 1 AND 500),
  -- {audience: [department, …]}: topics switched off
  topics_off   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(topics_off) = 'object'),
  -- {audience: [query id, …]}: the starter questions in order (none: the standard ones)
  starters     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(starters) = 'object'),
  updated_by   BIGINT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('assistant_settings');
