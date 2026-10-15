-- 0140: an opening-balance file is for the regular (school) fee or the hostel fee. The hostel file writes
-- the pupils' hostel opening balance (student_fee_profiles.opening_hostel), billed on the hostel ledger.
ALTER TABLE fee_opening_uploads
  ADD COLUMN ledger ledger_type NOT NULL DEFAULT 'school' CHECK (ledger IN ('school', 'hostel'));
