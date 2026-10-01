-- Family Gross Annual Income becomes a drop-down using the Income list. Amounts already typed in rupees
-- move to the matching band; anything that is not a plain number is left for the office to choose.
UPDATE students
   SET profile = jsonb_set(profile, '{family_income}', to_jsonb(
         CASE
           WHEN v < 100000 THEN 'Below 1 Lakh'
           WHEN v < 500000 THEN '1-5 Lakh'
           WHEN v < 1000000 THEN '5-10 Lakh'
           WHEN v < 2500000 THEN '10-25 Lakh'
           WHEN v < 5000000 THEN '25-50 Lakh'
           ELSE 'Above 50 Lakh'
         END))
  FROM (SELECT id AS sid, replace(profile->>'family_income', ',', '')::numeric AS v
          FROM students
         WHERE replace(coalesce(profile->>'family_income', ''), ',', '') ~ '^[0-9]+(\.[0-9]+)?$') n
 WHERE students.id = n.sid;
