-- The history of a release of test and interview results to families (docs/design/59, part 1): each
-- time it is set, moved (also after the families could see the marks), taken back, or the families are
-- told. A change made after the results were out carries its reason.

CREATE TABLE admission_result_release_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id    BIGINT NOT NULL REFERENCES classes(id),
  stage_id    BIGINT NOT NULL REFERENCES admission_stages(id) ON DELETE CASCADE,
  what        TEXT NOT NULL CHECK (what IN ('set', 'moved', 'taken_back', 'told')),
  from_at     TIMESTAMPTZ,
  to_at       TIMESTAMPTZ,
  -- the families could see the marks when this was done
  was_out     BOOLEAN NOT NULL DEFAULT false,
  told_count  INT,
  reason      TEXT CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 300),
  by_user     BIGINT REFERENCES users(id),
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admission_result_release_log_place
  ON admission_result_release_log (cycle_id, class_id, stage_id, at DESC);
CALL app.apply_tenant_rls('admission_result_release_log');
CREATE TRIGGER admission_result_release_log_audit AFTER INSERT OR UPDATE OR DELETE ON admission_result_release_log FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- the releases set so far start their history
INSERT INTO admission_result_release_log (school_id, cycle_id, class_id, stage_id, what, to_at, by_user, at)
SELECT school_id, cycle_id, class_id, stage_id, 'set', release_at, set_by, set_at FROM admission_result_releases;
INSERT INTO admission_result_release_log (school_id, cycle_id, class_id, stage_id, what, to_at, was_out, told_count, by_user, at)
SELECT school_id, cycle_id, class_id, stage_id, 'told', release_at, true, told_count, told_by, told_at
  FROM admission_result_releases WHERE told_at IS NOT NULL;
