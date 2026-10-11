-- 0127: an approved fee waiver can be taken back (approved by mistake, or the reason no longer holds).
-- The request rides the fee approval levels; on approval the waived amount is put back on the fee line
-- and is due again. The lines of one waiver request are taken back together.
ALTER TABLE fee_adjustments
  ADD COLUMN undo_status TEXT CHECK (undo_status IS NULL OR undo_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN undo_reason TEXT,
  ADD COLUMN undo_requested_by BIGINT,
  ADD COLUMN undo_requested_at TIMESTAMPTZ,
  ADD COLUMN undo_workflow_instance_id BIGINT REFERENCES workflow_instances(id),
  ADD COLUMN undone_at TIMESTAMPTZ,
  ADD COLUMN undone_by BIGINT;

-- Puts a waived amount back on a fee line: no more than the line was reduced by.
CREATE OR REPLACE FUNCTION app.unwaive_demand(p_demand_id bigint, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $$
DECLARE
  d      fee_demands%ROWTYPE;
  v_back NUMERIC;
BEGIN
  PERFORM app.assert_context();
  SELECT * INTO d FROM fee_demands WHERE id = p_demand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;   -- the line was rebuilt by a later bill run: nothing to put back
  PERFORM app.assert_year_open(d.academic_year_id, 'fees');
  v_back := LEAST(p_amount, GREATEST(d.discount, 0));
  IF v_back <= 0 THEN RETURN 0; END IF;
  UPDATE fee_demands SET discount = discount - v_back, net = net + v_back,
         status = CASE WHEN paid >= net + v_back THEN 'paid' WHEN paid > 0 THEN 'partial' ELSE 'pending' END::fee_demand_status,
         updated_at = now()
   WHERE id = p_demand_id;
  RETURN v_back;
END
$$;
