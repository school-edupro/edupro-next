-- 0369: payroll, phase B step 5 — payslips (docs/design/86; PAYROLL_RUN_SPEC.md §8). Every employee sees their own
-- payslips of locked runs (My payslips, in both apps): a baseline right of a staff record, as My leave is (the API
-- adds it to every employee; no role carries it). A payslip is e-mailed with its locked PDF only when a payroll
-- checker presses "Send pending" — nothing sends by itself; the record keeps when and which message.

INSERT INTO permissions (code, module, description, requires_mfa) VALUES
  ('payroll.own.view', 'payroll', 'See my own payslips and my tax (every employee)', false)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE payroll_records
  ADD COLUMN payslip_emailed_at  TIMESTAMPTZ,
  ADD COLUMN payslip_message_id  BIGINT REFERENCES comms_messages(id);
