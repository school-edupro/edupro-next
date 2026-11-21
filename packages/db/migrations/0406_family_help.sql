-- 0406: the families' Help page made the school's own (docs/design/89, "Help kept by the school"). The questions
-- were written into the parent website and the app; now each school keeps them on Helpdesk set-up:
--  * headings (each folds on the Help page) and questions under them (a question may have no heading: "Other
--    questions"), each in English with Hindi optional, for parents, students or both, shown or hidden, in the
--    school's order;
--  * a question may name the family screen it is about (`page`, a portal path such as /attendance): the Help page
--    leaves it out for a person who cannot open that screen, and shows a button that opens it;
--  * families answer "Was this helpful?" once per question (they may change it); the office sees the Yes / No
--    counts since the answer was last changed;
--  * a school starts with the standard questions (`standard_key`), put in on its first use of Help
--    (`family_help_settings`); "Restore the standard questions" puts back any it deleted.

CREATE TABLE family_help_headings (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  title         TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  title_hi      TEXT CHECK (title_hi IS NULL OR length(btrim(title_hi)) BETWEEN 1 AND 80),
  position      INT NOT NULL DEFAULT 0,
  standard_key  TEXT CHECK (standard_key IS NULL OR standard_key ~ '^[a-z_]{2,40}$'),
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX family_help_headings_standard ON family_help_headings (school_id, standard_key)
  WHERE standard_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX family_help_headings_order ON family_help_headings (school_id, position) WHERE deleted_at IS NULL;
CALL app.apply_tenant_rls('family_help_headings');

CREATE TABLE family_help_questions (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id          BIGINT NOT NULL REFERENCES schools(id),
  heading_id         BIGINT REFERENCES family_help_headings(id),
  question           TEXT NOT NULL CHECK (length(btrim(question)) BETWEEN 3 AND 200),
  question_hi        TEXT CHECK (question_hi IS NULL OR length(btrim(question_hi)) BETWEEN 3 AND 200),
  answer             TEXT NOT NULL CHECK (length(btrim(answer)) BETWEEN 3 AND 2000),
  answer_hi          TEXT CHECK (answer_hi IS NULL OR length(btrim(answer_hi)) BETWEEN 3 AND 2000),
  audience           TEXT NOT NULL DEFAULT 'both' CHECK (audience IN ('both', 'parent', 'student')),
  page               TEXT CHECK (page IS NULL OR page ~ '^/[a-z][a-z-]{1,39}$'),
  hidden             BOOLEAN NOT NULL DEFAULT false,
  position           INT NOT NULL DEFAULT 0,
  standard_key       TEXT CHECK (standard_key IS NULL OR standard_key ~ '^[a-z_]{2,40}$'),
  -- the Yes / No counts start again when the answer changes
  answer_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         BIGINT REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX family_help_questions_standard ON family_help_questions (school_id, standard_key)
  WHERE standard_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX family_help_questions_order ON family_help_questions (school_id, heading_id, position)
  WHERE deleted_at IS NULL;
CALL app.apply_tenant_rls('family_help_questions');

CREATE TABLE family_help_votes (
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  question_id  BIGINT NOT NULL REFERENCES family_help_questions(id),
  user_id      BIGINT NOT NULL REFERENCES users(id),
  helpful      BOOLEAN NOT NULL,
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);
CREATE INDEX family_help_votes_school ON family_help_votes (school_id);
CALL app.apply_tenant_rls('family_help_votes');

-- a school's row once its standard questions were put in (on its first use of Help)
CREATE TABLE family_help_settings (
  school_id  BIGINT PRIMARY KEY REFERENCES schools(id),
  seeded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('family_help_settings');
