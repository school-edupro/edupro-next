-- Test and interview results released to families (docs/design/57, part 4), the DPS "Adm Unlock": per
-- session, class and stage a date and time from which the candidate portal shows each part's marks, the
-- total and %. It may be changed or withdrawn until it passes; once it has passed the school may tell
-- the families (an email, SMS and WhatsApp from the admission_result template, sent by the workers).

CREATE TABLE admission_result_releases (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id   BIGINT NOT NULL REFERENCES schools(id),
  cycle_id    BIGINT NOT NULL REFERENCES admission_cycles(id) ON DELETE CASCADE,
  class_id    BIGINT NOT NULL REFERENCES classes(id),
  stage_id    BIGINT NOT NULL REFERENCES admission_stages(id) ON DELETE CASCADE,
  release_at  TIMESTAMPTZ NOT NULL,
  set_by      BIGINT REFERENCES users(id),
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- the families told (the last time), and how many
  told_at     TIMESTAMPTZ,
  told_by     BIGINT REFERENCES users(id),
  told_count  INT,
  UNIQUE (cycle_id, class_id, stage_id)
);
CALL app.apply_tenant_rls('admission_result_releases');
CREATE TRIGGER admission_result_releases_audit AFTER INSERT OR UPDATE OR DELETE ON admission_result_releases FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
