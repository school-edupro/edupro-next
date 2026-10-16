-- Hostel withdrawal: the last day in the hostel may be any day from the start of the stay (a pupil who left
-- months ago and was never recorded), not only up to 31 days before the request. The service checks the
-- stay's start.
ALTER TABLE hostel_withdrawals DROP CONSTRAINT IF EXISTS hostel_withdrawals_check;
