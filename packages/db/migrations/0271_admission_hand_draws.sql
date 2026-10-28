-- A draw of lots made by hand with the printed slips (docs/design/60, part 3): the registration numbers
-- in the order the slips were drawn; the first seats offered (twins on one slip both), the rest
-- wait-listed in that order; who recorded it and when.

CREATE TABLE admission_hand_draws (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  cycle_id     BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id     BIGINT NOT NULL REFERENCES classes(id),
  category_id  BIGINT REFERENCES admission_fee_categories(id),
  points       NUMERIC(9, 2) NOT NULL,
  seats        INT NOT NULL CHECK (seats >= 1),
  -- each slip drawn, in order: [{ rank, ids, numbers, names, outcome }]
  slips        JSONB NOT NULL,
  offered      INT NOT NULL,
  waitlisted   INT NOT NULL,
  -- seats used beyond those asked (a twin slip at the boundary)
  extra_seats  INT NOT NULL DEFAULT 0,
  drawn_by     BIGINT REFERENCES users(id),
  drawn_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admission_hand_draws_place ON admission_hand_draws (cycle_id, class_id, drawn_at DESC);
CALL app.apply_tenant_rls('admission_hand_draws');
CREATE TRIGGER admission_hand_draws_audit AFTER INSERT OR UPDATE OR DELETE ON admission_hand_draws FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
