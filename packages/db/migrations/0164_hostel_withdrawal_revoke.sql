-- 0164: revoking a completed hostel withdrawal (docs/design/27-hostel-withdrawal.md, part 5).
-- The office asks, with a reason, how the pupil comes back: 'continue' (as if never left: the same bed,
-- the stay goes on, the hostel fee of the months away is charged) or 'from_date' (a new stay from a day,
-- the same bed or another; the months away are not charged). The request goes through the hostel
-- withdrawal's own approval levels; the last approval puts the pupil back, makes the hostel fee again,
-- drops refunds still waiting, cancels unpaid damage / mess charges and voids the clearance certificate.
ALTER TABLE hostel_withdrawals DROP CONSTRAINT IF EXISTS hostel_withdrawals_status_check;
ALTER TABLE hostel_withdrawals ADD CONSTRAINT hostel_withdrawals_status_check
  CHECK (status IN ('requested', 'cleared', 'completed', 'cancelled', 'rejected', 'revoked'));
ALTER TABLE hostel_withdrawals
  ADD COLUMN revoke_status        TEXT CHECK (revoke_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN revoke_reason        TEXT CHECK (revoke_reason IS NULL OR length(revoke_reason) <= 500),
  ADD COLUMN revoke_mode          TEXT CHECK (revoke_mode IN ('continue', 'from_date')),
  ADD COLUMN revoke_from          DATE,
  ADD COLUMN revoke_bed_id        BIGINT REFERENCES hostel_beds(id),
  ADD COLUMN revoke_requested_by  BIGINT,
  ADD COLUMN revoke_requested_at  TIMESTAMPTZ,
  ADD COLUMN revoke_workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN revoked_at           TIMESTAMPTZ,
  ADD COLUMN revoked_by           BIGINT,
  ADD COLUMN revoke_note          TEXT;

-- months of a session a pupil was away from the hostel between two stays: no hostel fee for them
CREATE TABLE hostel_fee_gaps (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id         BIGINT NOT NULL REFERENCES schools(id),
  student_id        BIGINT NOT NULL REFERENCES students(id),
  academic_year_id  BIGINT NOT NULL REFERENCES academic_years(id),
  from_month        DATE NOT NULL CHECK (extract(day FROM from_month) = 1),
  to_month          DATE NOT NULL CHECK (extract(day FROM to_month) = 1 AND to_month >= from_month),
  withdrawal_id     BIGINT REFERENCES hostel_withdrawals(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hostel_fee_gaps_student ON hostel_fee_gaps (student_id, academic_year_id);
CALL app.apply_tenant_rls('hostel_fee_gaps');

-- the hostel fee window of a pupil, less the months away
CREATE OR REPLACE FUNCTION app.fee_in_hostel_stay(p_student bigint, p_year bigint, p_from date, p_to date, p_month date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.fee_in_hostel(p_from, p_to, p_month)
     AND NOT EXISTS (SELECT 1 FROM hostel_fee_gaps g WHERE g.student_id = p_student AND g.academic_year_id = p_year
                       AND p_month BETWEEN g.from_month AND g.to_month)
$$;

-- the demand generator reads the window less the gaps (0146's line, patched in place)
DO $do$
DECLARE
  v_src TEXT;
  v_old TEXT := 'app.fee_in_hostel(v_profile.hostel_from, v_profile.hostel_to, make_date(fp.year, fp.month, 1))';
BEGIN
  SELECT pg_get_functiondef('app.generate_fee_demand'::regproc) INTO v_src;
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'generate_fee_demand is not the 0146 version';
  END IF;
  EXECUTE replace(v_src, v_old,
    'app.fee_in_hostel_stay(p_student_id, p_academic_year_id, v_profile.hostel_from, v_profile.hostel_to, make_date(fp.year, fp.month, 1))');
END
$do$;
