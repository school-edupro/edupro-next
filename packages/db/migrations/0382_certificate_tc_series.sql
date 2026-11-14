-- Certificate management, phase A (docs/design/87): the TC is now numbered by the register's series of its type and
-- year (app.next_certificate_no). Each school's series of a year starts after the transfer certificates already issued in
-- that year, so a number is never given twice and the count runs on (TC/2026-27/0004 is followed by TC/2026-27/00005).
INSERT INTO certificate_series (school_id, type_code, year_code, last_serial)
SELECT t.school_id, 'TC', split_part(t.tc_no, '/', 2), max(t.serial)
  FROM transfer_certificates t
 WHERE t.tc_no ~ '^TC/[^/]+/[0-9]+$'
 GROUP BY t.school_id, split_part(t.tc_no, '/', 2)
ON CONFLICT (school_id, type_code, year_code)
  DO UPDATE SET last_serial = GREATEST(certificate_series.last_serial, EXCLUDED.last_serial);

-- the old numbering function is no longer called (the register numbers every TC)
COMMENT ON FUNCTION app.next_tc_no(TEXT) IS 'Retired by 0382: TCs are numbered by app.next_certificate_no (the certificate register).';
