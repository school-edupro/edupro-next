-- A desk on the "whom to meet" list may name the person in charge, so that person sees the confirmed
-- appointments under "My appointments". The seeded "Principal" desk (0059) had nobody linked, so the
-- principal saw nothing: link it where the school has exactly one active employee designated Principal.
UPDATE appointment_hosts h
   SET employee_id = p.id
  FROM (
    SELECT school_id, min(id) AS id
      FROM employees
     WHERE deleted_at IS NULL AND lower(btrim(designation)) = 'principal'
     GROUP BY school_id
    HAVING count(*) = 1
  ) p
 WHERE h.school_id = p.school_id AND h.kind = 'desk' AND h.employee_id IS NULL AND lower(h.name) = 'principal';
