-- 0387: the award certificates (docs/design/87, phase E) are issued by the office from the awards, never asked for
-- in the apps: their request settings are closed (a school can still open them on the type's page).
UPDATE certificate_types
   SET request = '{"open": {"parent": false, "student": false, "staff": false}, "purposes": [], "maxCopies": 1,
                   "fee": null, "levels": [{"kind": "office"}]}'::jsonb
 WHERE code IN ('ACHIEVEMENT', 'MERIT', 'PARTICIPATION', 'AWARD') AND request = '{}'::jsonb;
