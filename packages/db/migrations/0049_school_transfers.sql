-- School transfer (2026-10-02): a student leaves one school of the group for another. The source school
-- completes the withdrawal and sends a transfer with a snapshot of the profile, photos and documents;
-- the target school accepts it into a class and section, which creates the student there (new admission
-- number) and links the parents' and the student's logins. Both schools see the transfer row.
INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('people.transfer.manage', 'people', 'Send students to another school of the group and accept incoming transfers', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'people.transfer.manage'
  FROM role_permissions rp WHERE rp.permission_code = 'people.withdrawal.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE school_transfers (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_school_id       BIGINT NOT NULL REFERENCES schools(id),
  to_school_id         BIGINT NOT NULL REFERENCES schools(id),
  from_student_id      BIGINT NOT NULL REFERENCES students(id),
  withdrawal_id        BIGINT REFERENCES student_withdrawals(id),
  status               TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'rejected', 'cancelled')),
  -- name, class, profile values (ID numbers encrypted), photos and documents to copy, logins to link
  snapshot             JSONB NOT NULL,
  note                 TEXT,
  requested_by         BIGINT,
  requested_by_name    TEXT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by           BIGINT,
  decided_by_name      TEXT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  to_student_id        BIGINT,
  to_class_section_id  BIGINT,
  CHECK (from_school_id <> to_school_id)
);
CREATE UNIQUE INDEX school_transfers_open ON school_transfers (from_student_id) WHERE status = 'requested';
CREATE INDEX school_transfers_incoming ON school_transfers (to_school_id, status);

ALTER TABLE school_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY school_transfers_both_schools ON school_transfers FOR ALL TO PUBLIC
  USING (from_school_id = app.current_school_id() OR to_school_id = app.current_school_id())
  WITH CHECK (from_school_id = app.current_school_id() OR to_school_id = app.current_school_id());
CREATE POLICY school_transfers_migrator ON school_transfers FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- The other active schools of the working school's group (a transfer's possible targets). Runs with the
-- owner's rights because a sender is usually not a member of the target school.
CREATE OR REPLACE FUNCTION app.transfer_targets()
RETURNS TABLE (id BIGINT, code TEXT, name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app AS $$
  SELECT s.id, s.code, s.name FROM schools s
   WHERE s.status = 'active' AND s.id <> app.current_school_id()
     AND s.group_id IS NOT NULL
     AND s.group_id = (SELECT group_id FROM schools WHERE id = app.current_school_id())
   ORDER BY s.name
$$;
