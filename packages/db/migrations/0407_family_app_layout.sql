-- 0407: the family app's layout kept by the school (docs/design/90). One row per school and audience (students,
-- parents): the draft the office edits on System settings → Family app layout and the published copy families get
-- (the bottom tabs between Home and More, the Home shortcuts, the Home cards, the Academics tab's list). No row, or no
-- published copy, means the app as it was (`DEFAULT_FAMILY_LAYOUT` in @edupro/menus). A person's own Home shortcuts
-- are a `user_preferences` row (`family.shortcuts.<audience>`).

CREATE TABLE family_app_layouts (
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  audience          TEXT NOT NULL CHECK (audience IN ('parent', 'student')),
  -- {tabs, shortcuts, cards, academics}: arrays of screen paths and card keys, checked by the API
  draft             JSONB NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  draft_updated_by  BIGINT REFERENCES users(id),
  draft_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  published         JSONB CHECK (published IS NULL OR jsonb_typeof(published) = 'object'),
  published_by      BIGINT REFERENCES users(id),
  published_at      TIMESTAMPTZ,
  PRIMARY KEY (school_id, audience),
  CHECK ((published IS NULL) = (published_at IS NULL))
);
CALL app.apply_tenant_rls('family_app_layouts');
