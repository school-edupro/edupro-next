-- docs/design/65 (1 Nov 2026): a report-card release is published and revoked class by class. A row per
-- class of a release once it has been published; the families of a class see the release only while
-- its row is 'released'. Publishing the whole release writes a row for every class it carries.
CREATE TABLE report_card_release_classes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id        BIGINT NOT NULL REFERENCES schools(id),
  release_id       BIGINT NOT NULL REFERENCES report_card_releases(id) ON DELETE CASCADE,
  class_id         BIGINT NOT NULL REFERENCES classes(id),
  status           TEXT NOT NULL CHECK (status IN ('released', 'withdrawn')),
  released_at      TIMESTAMPTZ,
  released_by      BIGINT,
  withdrawn_at     TIMESTAMPTZ,
  withdrawn_by     BIGINT,
  withdrawn_reason TEXT CHECK (withdrawn_reason IS NULL OR length(btrim(withdrawn_reason)) BETWEEN 3 AND 300),
  notified_count   INT NOT NULL DEFAULT 0,
  UNIQUE (release_id, class_id)
);
CREATE INDEX report_card_release_classes_class ON report_card_release_classes (class_id, status);
CREATE TRIGGER report_card_release_classes_audit AFTER INSERT OR UPDATE OR DELETE ON report_card_release_classes
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('report_card_release_classes');

-- releases published before: every class they carry stays open to its families
INSERT INTO report_card_release_classes (school_id, release_id, class_id, status, released_at, released_by)
SELECT DISTINCT r.school_id, r.id, ec.class_id, 'released', r.released_at, r.released_by
  FROM report_card_releases r
  JOIN exam_classes ec ON ec.exam_id = ANY (r.exam_ids)
 WHERE r.status = 'released'
ON CONFLICT (release_id, class_id) DO NOTHING;
