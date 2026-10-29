-- Moving a registration to the other school of the group (docs/design/64). A registration made in the
-- wrong school (registered up to the admission fee paid, not admitted) is sent by that school with a
-- reason; the other school accepts it into a session and class (or refuses it). Accepting makes a fresh
-- registration there from a copy of the form, its files and the family's login, and cancels the old one
-- "Moved to <school>". The money paid goes with it, no cash: the first school closes its receipts with
-- transfer-out lines (Fees → Refunds), the other takes it in receipts of mode "transfer" against the new
-- registration fee and keeps the rest as the registration's credit, used at its admission fee.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('admissions.application.move', 'admissions', 'Move a registration to another school of the group, and accept or refuse registrations moved here', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT DISTINCT rp.role_id, 'admissions.application.move'
  FROM role_permissions rp WHERE rp.permission_code = 'admissions.application.cancel'
ON CONFLICT DO NOTHING;

CREATE TABLE admission_moves (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_school_id       BIGINT NOT NULL REFERENCES schools(id),
  to_school_id         BIGINT NOT NULL REFERENCES schools(id),
  from_application_id  BIGINT NOT NULL REFERENCES applications(id),
  status               TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'refused', 'withdrawn')),
  reason               TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  -- the candidate, class and session, the answers as kept (ID numbers encrypted), the form's fields, the
  -- files to copy, the family's login and the money paid (receipts)
  snapshot             JSONB NOT NULL,
  requested_by         BIGINT,
  requested_by_name    TEXT,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by           BIGINT,
  decided_by_name      TEXT,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  to_cycle_id          BIGINT,
  to_class_id          BIGINT,
  to_application_id    BIGINT,
  -- what the money did there: carried (all paid), to the registration fee, the difference still due, credit
  carried              NUMERIC(12, 2),
  to_registration      NUMERIC(12, 2),
  difference_due       NUMERIC(12, 2),
  credit               NUMERIC(12, 2),
  -- the answers the receiving form needed and the copy lacked (asked of the family as a correction)
  missing              TEXT[] NOT NULL DEFAULT '{}',
  CHECK (from_school_id <> to_school_id)
);
CREATE UNIQUE INDEX admission_moves_open ON admission_moves (from_application_id) WHERE status = 'requested';
CREATE INDEX admission_moves_incoming ON admission_moves (to_school_id, status);
CREATE INDEX admission_moves_to_application ON admission_moves (to_application_id) WHERE to_application_id IS NOT NULL;

ALTER TABLE admission_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_moves FORCE ROW LEVEL SECURITY;
CREATE POLICY admission_moves_both_schools ON admission_moves FOR ALL TO PUBLIC
  USING (from_school_id = app.current_school_id() OR to_school_id = app.current_school_id())
  WITH CHECK (from_school_id = app.current_school_id() OR to_school_id = app.current_school_id());
CREATE POLICY admission_moves_migrator ON admission_moves FOR ALL TO edupro_migrator USING (true) WITH CHECK (true);

-- money moved between the schools is no cash: receipts and refund lines of mode "transfer"
ALTER TABLE misc_receipts DROP CONSTRAINT misc_receipts_mode_check;
ALTER TABLE misc_receipts ADD CONSTRAINT misc_receipts_mode_check
  CHECK (mode IN ('online', 'cash', 'cheque', 'dd', 'upi', 'bank', 'card', 'transfer'));
ALTER TABLE admission_refunds DROP CONSTRAINT admission_refunds_mode_check;
ALTER TABLE admission_refunds ADD CONSTRAINT admission_refunds_mode_check
  CHECK (mode IN ('cash', 'bank', 'cheque', 'gateway', 'transfer'));

-- money carried in from the other school not used yet (the admission fee takes it)
ALTER TABLE applications ADD COLUMN transfer_credit NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (transfer_credit >= 0);

-- The first school's side of an accepted move, run inside the receiving school's transaction (its
-- office is usually no member of the first school): the old registration cancelled "Moved to …" with a
-- line in its history, an open correction closed, and each receipt carried closed by a transfer-out line
-- (paid, mode transfer). Returns the old status, or NULL when the registration can no longer move.
CREATE OR REPLACE FUNCTION app.admission_move_close(p_move BIGINT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  m        admission_moves%ROWTYPE;
  v_from   TEXT;
  v_school TEXT;
  v_no     TEXT;
  v_note   TEXT;
  r        JSONB;
BEGIN
  SELECT * INTO m FROM admission_moves
   WHERE id = p_move AND to_school_id = app.current_school_id() AND status = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'move % is not accepted by this school', p_move;
  END IF;
  SELECT status::text INTO v_from FROM applications
   WHERE id = m.from_application_id AND school_id = m.from_school_id FOR UPDATE;
  IF v_from IS NULL OR v_from IN ('draft', 'admitted', 'cancelled', 'withdrawn') THEN
    RETURN NULL;
  END IF;
  SELECT name INTO v_school FROM schools WHERE id = m.to_school_id;
  SELECT application_no INTO v_no FROM applications WHERE id = m.to_application_id;
  v_note := left(format('Moved to %s%s: %s', v_school,
                        CASE WHEN v_no IS NOT NULL THEN format(' (registration %s)', v_no) ELSE '' END, m.reason), 500);
  UPDATE applications SET status = 'cancelled', cancelled_at = now(), cancel_reason = v_note, wait_rank = NULL, updated_at = now()
   WHERE id = m.from_application_id;
  UPDATE admission_corrections SET status = 'cancelled' WHERE application_id = m.from_application_id AND status = 'open';
  INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
  VALUES (m.from_school_id, m.from_application_id, v_from::application_status, 'cancelled', v_note, app.current_user_id());
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(m.snapshot -> 'receipts', '[]'::jsonb)) LOOP
    INSERT INTO admission_refunds (school_id, application_id, receipt_id, paid_amount, amount, reason, status,
                                   requested_by, decided_by, decided_at, decision_note, mode, reference, paid_on, paid_by)
    SELECT m.from_school_id, m.from_application_id, x.id, x.amount, x.amount,
           left(format('Moved to %s: %s', v_school, m.reason), 500), 'paid',
           m.requested_by, app.current_user_id(), now(), format('Accepted by %s', v_school), 'transfer',
           format('Move %s to %s', m.id, v_school), (now() AT TIME ZONE 'Asia/Kolkata')::date, app.current_user_id()
      FROM misc_receipts x
     WHERE x.id = (r ->> 'id')::bigint AND x.school_id = m.from_school_id AND x.application_id = m.from_application_id
       AND x.status = 'posted';
  END LOOP;
  RETURN v_from;
END
$$;
