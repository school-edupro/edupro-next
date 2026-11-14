-- 0380: fixing a wrong dated set-up row (docs/design/86, "Withdraw and correct"). The eight dated tables (rates, PF,
-- ESI, profession tax, LWF, overtime, pay-head versions, salary structures):
--  * WITHDRAWN: an approved row no approved, locked or paid run has read can be withdrawn by a checker or the payroll
--    admin with a reason; it stays in the history, no run reads it, and the rows it had ended open again. A run only
--    processed (not approved) that read it is reset to draft, to be processed again.
--  * closed_rows: what an approval ended — each earlier row and the end it had — so a withdrawal restores it exactly.
--  * End no longer hides a row: "ended" rows were left out of every run, even for the months before their end (End on
--    31-03 stopped December's run finding the rate). A row is bounded by its dates alone; the ended rows become active.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_rates', 'payroll_pf_settings', 'payroll_esi_settings', 'payroll_pt_slabs',
                           'payroll_lwf_settings', 'payroll_ot_rates', 'payroll_pay_head_versions', 'payroll_structures']
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_status_check');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN ('draft', 'active', 'ended', 'withdrawn'))$f$,
                   t, t || '_status_check');
    EXECUTE format('ALTER TABLE %I ADD COLUMN withdrawn_by BIGINT REFERENCES users(id), ADD COLUMN withdrawn_at TIMESTAMPTZ, '
                   'ADD COLUMN withdraw_reason TEXT CHECK (withdraw_reason IS NULL OR length(withdraw_reason) BETWEEN 10 AND 300), '
                   'ADD COLUMN closed_rows JSONB', t);
    -- bounded by its dates, an ended row is read for the months it covers
    EXECUTE format($f$UPDATE %I SET status = 'active' WHERE status = 'ended'$f$, t);
  END LOOP;
END $$;
