-- Examinations v2, part 4 (docs/design/65): the DPS Noida report cards. Signatures by role (principal,
-- vice principal, headmistress, coordinator, class teacher, exam in-charge) with an image, for every
-- class or some; the school seal is one more image (role seal). The class teacher's remark gains what
-- the student took part in and the class the student is promoted to (printed on the final card).

CREATE TABLE report_card_signatures (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  role         TEXT NOT NULL CHECK (role IN ('principal', 'vice_principal', 'headmistress', 'coordinator',
                                             'class_teacher', 'exam_incharge', 'seal')),
  -- printed under the line ("Principal", "Coordinator (Middle wing)")
  label        TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 60),
  person_name  TEXT CHECK (person_name IS NULL OR length(person_name) <= 80),
  file_id      BIGINT REFERENCES files(id),
  -- the classes it signs for; empty: every class (a class's own one comes first)
  class_ids    BIGINT[] NOT NULL DEFAULT '{}',
  sort_order   INT NOT NULL DEFAULT 0,
  status       row_status NOT NULL DEFAULT 'active',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT
);
CREATE INDEX report_card_signatures_by_role ON report_card_signatures (role) WHERE status = 'active';
CREATE TRIGGER report_card_signatures_audit AFTER INSERT OR UPDATE OR DELETE ON report_card_signatures
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CALL app.apply_tenant_rls('report_card_signatures');

ALTER TABLE exam_remarks ADD COLUMN participation TEXT CHECK (participation IS NULL OR length(participation) <= 300);
ALTER TABLE exam_remarks ADD COLUMN promoted_to TEXT CHECK (promoted_to IS NULL OR length(promoted_to) <= 40);
