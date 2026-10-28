-- Draw of lots slips (docs/design/60, part 2): the slips' settings per session, a class may have its
-- own (heading, details shown, draw date and venue, footer, slips per A4 page), and twins found for one
-- shared slip (the same date of birth and family mobile in a class), confirmed or split by the office.

CREATE TABLE admission_draw_settings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  -- none: the session's settings
  class_id    BIGINT REFERENCES classes(id),
  heading     TEXT NOT NULL CHECK (length(btrim(heading)) BETWEEN 1 AND 160),
  fields      TEXT[] NOT NULL CHECK (fields <@ ARRAY['photo', 'name', 'father', 'mother', 'dob', 'number', 'sno',
                                                     'points', 'category', 'session', 'draw']::text[]),
  draw_at     TIMESTAMPTZ,
  venue       TEXT CHECK (venue IS NULL OR length(venue) <= 160),
  footer      TEXT CHECK (footer IS NULL OR length(footer) <= 300),
  per_page    INT NOT NULL DEFAULT 4 CHECK (per_page IN (2, 4, 6, 8)),
  show_logo   BOOLEAN NOT NULL DEFAULT true,
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admission_draw_settings_place ON admission_draw_settings (cycle_id, COALESCE(class_id, 0));
CALL app.apply_tenant_rls('admission_draw_settings');
CREATE TRIGGER admission_draw_settings_audit AFTER INSERT OR UPDATE OR DELETE ON admission_draw_settings FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

CREATE TABLE admission_twin_pairs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id    BIGINT NOT NULL REFERENCES classes(id),
  app_a       BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  app_b       BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  state       TEXT NOT NULL CHECK (state IN ('paired', 'split')),
  set_by      BIGINT REFERENCES users(id),
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (app_a < app_b),
  UNIQUE (app_a, app_b)
);
CREATE INDEX admission_twin_pairs_place ON admission_twin_pairs (cycle_id, class_id);
CALL app.apply_tenant_rls('admission_twin_pairs');
CREATE TRIGGER admission_twin_pairs_audit AFTER INSERT OR UPDATE OR DELETE ON admission_twin_pairs FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
