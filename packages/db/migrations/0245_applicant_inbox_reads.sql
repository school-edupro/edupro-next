-- Candidate portal redesign, part 4 of docs/design/42: what a family has read in its Messages.
-- A notice or a message the family opened (or marked read) is kept here, so the portal can mark the rest
-- unread and count them in the top bar.

CREATE TABLE applicant_inbox_reads (
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  applicant_id  BIGINT NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  -- 'notice' (notices.id) or 'message' (comms_messages.id)
  kind          TEXT NOT NULL CHECK (kind IN ('notice', 'message')),
  item_id       BIGINT NOT NULL,
  read_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (applicant_id, kind, item_id)
);
CALL app.apply_tenant_rls('applicant_inbox_reads');
