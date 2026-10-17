-- 0162: the hostel incident register with a follow-up. An incident is open, in follow-up or closed; the
-- warden (or the office) adds dated follow-up notes, each of which may move it on, and closes it with a
-- closing remark. Photos and documents (file service ids) can go with the incident and each note.
-- A minor incident may be closed when recorded; a serious one stays open until closed with a remark.
ALTER TABLE hostel_incidents
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'follow_up', 'closed')),
  ADD COLUMN closed_at       TIMESTAMPTZ,
  ADD COLUMN closed_by       BIGINT,
  ADD COLUMN closing_remark  TEXT CHECK (closing_remark IS NULL OR length(closing_remark) <= 1000),
  ADD COLUMN file_ids        BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();
-- what was recorded before: a minor incident is taken as dealt with, a serious one stays open
UPDATE hostel_incidents SET status = 'closed', closed_at = created_at, closed_by = recorded_by,
       closing_remark = 'Recorded before the follow-up register'
 WHERE severity = 'minor';
ALTER TABLE hostel_incidents ADD CONSTRAINT hostel_incidents_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL));
CREATE INDEX hostel_incidents_open ON hostel_incidents (school_id, status) WHERE status <> 'closed';

CREATE TABLE hostel_incident_notes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id    BIGINT NOT NULL REFERENCES schools(id),
  incident_id  BIGINT NOT NULL REFERENCES hostel_incidents(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 2 AND 1000),
  -- the status the note moved the incident to (none: a note only)
  status_to    TEXT CHECK (status_to IN ('open', 'follow_up', 'closed')),
  file_ids     BIGINT[] NOT NULL DEFAULT '{}',
  by_user      BIGINT NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hostel_incident_notes_by_incident ON hostel_incident_notes (incident_id, at);
CALL app.apply_tenant_rls('hostel_incident_notes');
