-- Per-user screen preferences (the students list view: columns, filters, sort, page size) kept on the
-- server for the signed-in user of the school, so a shared computer never shows one user's view to
-- another. And a photo on the father / mother / guardian record for the student profile printout.

CREATE TABLE user_preferences (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id  BIGINT NOT NULL REFERENCES schools(id),
  user_id    BIGINT NOT NULL REFERENCES users(id),
  pref_key   TEXT NOT NULL CHECK (pref_key ~ '^[a-z0-9_.-]{2,60}$'),
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id, pref_key)
);
CALL app.apply_tenant_rls('user_preferences');

ALTER TABLE guardians ADD COLUMN photo_file_id BIGINT REFERENCES files(id);
