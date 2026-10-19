-- 0189: ACR assessors per employee (docs/design/32-employee-acr.md, 19 Oct 2026). The office assigns each
-- employee's HOD and reviewer on one screen (as the earlier ERP's ACR Master did, by employee code);
-- the levels read the employee's record. The reviewer level ('acr_reviewer') falls back to a designation
-- (the Principal) when nobody is set on the record.
ALTER TABLE acr_levels DROP CONSTRAINT acr_levels_kind_check;
ALTER TABLE acr_levels ADD CONSTRAINT acr_levels_kind_check
  CHECK (kind IN ('acr_hod', 'acr_reviewer', 'approver_l1', 'approver_l2', 'approver_l3', 'role', 'designation', 'employee'));

-- the seeded "Principal" level becomes per employee; the designation stays as the fallback
UPDATE acr_levels SET kind = 'acr_reviewer' WHERE kind = 'designation' AND lower(designation) = 'principal';

-- new schools start the same way: the seed's second level reads the record first
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('app.acr_seed(bigint)'::regprocedure) INTO def;
  def := replace(def, '''Principal'', ''designation'', ''Principal'', ''review''',
                      '''Principal'', ''acr_reviewer'', ''Principal'', ''review''');
  EXECUTE def;
END $$;
