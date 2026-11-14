-- 0374: payroll, phase D step 4 — what a record's tax was made of (docs/design/86). The annual certificate (Form 16 /
-- 130, Part B) and the return's Annexure II are read from the year's last record: besides the figures phase B kept,
-- the exemptions (HRA), perquisites (with the employer's NPS), the earlier employer's salary and tax, other income, a
-- house's loss, and the working of each (HRA legs, the employer's NPS, each declared section claimed and allowed).
ALTER TABLE payroll_record_tax
  ADD COLUMN exemptions    NUMERIC(14, 2),
  ADD COLUMN perquisites   NUMERIC(14, 2),
  ADD COLUMN prev_salary   NUMERIC(14, 2),
  ADD COLUMN prev_tds      NUMERIC(14, 2),
  ADD COLUMN other_income  NUMERIC(14, 2),
  ADD COLUMN house_loss    NUMERIC(14, 2),
  ADD COLUMN working       JSONB;
