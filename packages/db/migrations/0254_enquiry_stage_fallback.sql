-- A stage switched off in Admission set-up (docs/design/45): a lead that would take it (a new enquiry
-- looks for "New") now takes the first active stage of the same kind, instead of none — it had dropped
-- off the board. Leads left without a stage get theirs.

CREATE OR REPLACE FUNCTION app.enquiry_stage_of(p_school BIGINT, p_code TEXT, p_kind TEXT) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT id FROM admission_enquiry_stages
   WHERE school_id = p_school AND status = 'active' AND (code = p_code OR kind = p_kind)
   ORDER BY (code = p_code) DESC NULLS LAST, sort_order, id LIMIT 1
$$;

UPDATE admission_enquiries SET stage_id = NULL WHERE stage_id IS NULL;
