-- The rules of a class line, all on the session (25 Oct 2026): age as on and the date-of-birth range were
-- already there, the form's own copies only a fallback; the PIN codes allowed and the alumni pass-out year
-- move here from the form too, so each session and class sets its own and the form page no longer does.
-- Today's values of each form are copied to the class lines that use it.

ALTER TABLE admission_class_criteria
  ADD COLUMN pincode_prefixes TEXT[] CHECK (pincode_prefixes IS NULL OR cardinality(pincode_prefixes) <= 40),
  ADD COLUMN pass_out_before  INT CHECK (pass_out_before IS NULL OR pass_out_before BETWEEN 1950 AND 2100);

UPDATE admission_class_criteria k
   SET pincode_prefixes = ARRAY(SELECT jsonb_array_elements_text(f.def -> 'settings' -> 'pincodePrefixes'))
  FROM admission_forms f
 WHERE f.id = k.form_id
   AND jsonb_typeof(f.def -> 'settings' -> 'pincodePrefixes') = 'array'
   AND jsonb_array_length(f.def -> 'settings' -> 'pincodePrefixes') > 0
   AND k.pincode_prefixes IS NULL;

UPDATE admission_class_criteria k
   SET pass_out_before = (f.def -> 'settings' ->> 'passOutBefore')::int
  FROM admission_forms f
 WHERE f.id = k.form_id
   AND (f.def -> 'settings' ->> 'passOutBefore') ~ '^\d{4}$'
   AND k.pass_out_before IS NULL;

-- a class line without its own age date or DOB range took the form's: keep what families saw
UPDATE admission_class_criteria k
   SET age_as_on = COALESCE(k.age_as_on, NULLIF(f.def -> 'settings' ->> 'ageAsOn', '')::date),
       dob_from  = COALESCE(k.dob_from, NULLIF(f.def -> 'settings' ->> 'dobFrom', '')::date),
       dob_to    = COALESCE(k.dob_to, NULLIF(f.def -> 'settings' ->> 'dobTo', '')::date)
  FROM admission_forms f
 WHERE f.id = k.form_id
   AND ((k.age_as_on IS NULL AND (f.def -> 'settings' ->> 'ageAsOn') ~ '^\d{4}-\d{2}-\d{2}$')
     OR (k.dob_from IS NULL AND k.dob_to IS NULL
         AND (f.def -> 'settings' ->> 'dobFrom') ~ '^\d{4}-\d{2}-\d{2}$'
         AND (f.def -> 'settings' ->> 'dobTo') ~ '^\d{4}-\d{2}-\d{2}$'));
