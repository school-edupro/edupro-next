-- Caste details are sensitive personal data (DPDP): Sub-Caste starts hidden on the portal. Schools whose
-- saved portal policy still carries the old default ('view') move to 'hidden'; a deliberate edit level stays.
UPDATE profile_portal_policies
   SET fields = jsonb_set(fields, '{parent,sub_caste}', '"hidden"')
 WHERE fields #>> '{parent,sub_caste}' = 'view';
UPDATE profile_portal_policies
   SET fields = jsonb_set(fields, '{student,sub_caste}', '"hidden"')
 WHERE fields #>> '{student,sub_caste}' = 'view';
