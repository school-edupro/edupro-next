-- 0376: payroll's part of a transfer within the group (docs/design/86, phase E step 5; PAYROLL_PEOPLE_SPEC.md §6).
-- The people module copies the employee to the sister school (0182). Payroll then brings its part across, at the
-- destination, by a checker: the earlier-employer record for the tax year (so the destination's TDS counts the
-- salary and tax of the months at the source, Form 122), the payroll profile, the pay structure as drafts for another
-- checker to approve, and the loans still owed (closed at the source with a remark). The figures are read live from
-- the source when the checker looks and when they bring them, so a month the source locks after the transfer was
-- accepted still counts.

-- what was brought, once per transfer (the packet as it was read)
CREATE TABLE payroll_transfer_imports (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id     BIGINT NOT NULL REFERENCES schools(id),
  transfer_id   BIGINT NOT NULL UNIQUE REFERENCES employee_school_transfers(id),
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  packet        JSONB NOT NULL,
  -- what was written here: the earlier-employer row, the draft structures, the loans
  written       JSONB NOT NULL DEFAULT '{}',
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CALL app.apply_tenant_rls('payroll_transfer_imports');
CREATE TRIGGER payroll_transfer_imports_audit AFTER INSERT OR UPDATE OR DELETE ON payroll_transfer_imports
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- The source school's payroll for an accepted transfer into the current school: its name and TAN, the profile, the
-- structure in force on the transfer date, the loans owed, and the tax year's salary, PF, PT and tax from its locked
-- months. Runs with the owner's rights because the destination cannot read the source's rows; only an accepted
-- transfer into the current school is read, and nothing else of the source.
CREATE OR REPLACE FUNCTION app.payroll_transfer_packet(p_transfer BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app AS $$
DECLARE
  t        record;
  v_fy_from DATE;
  v_fy     TEXT;
  v_out    JSONB;
BEGIN
  SELECT * INTO t FROM employee_school_transfers WHERE id = p_transfer;
  IF NOT FOUND OR t.status <> 'accepted' OR t.to_school_id <> app.current_school_id() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'transfer.not_accepted';
  END IF;
  -- the tax year of the transfer date (April to March)
  v_fy_from := make_date(CASE WHEN extract(month FROM t.on_date) >= 4 THEN extract(year FROM t.on_date)::int
                              ELSE extract(year FROM t.on_date)::int - 1 END, 4, 1);
  v_fy := extract(year FROM v_fy_from)::int || '-' || lpad(((extract(year FROM v_fy_from)::int + 1) % 100)::text, 2, '0');
  WITH recs AS (
    SELECT r.id, r.month, r.pt_amount, r.it_amount, r.cess_amount
      FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
     WHERE r.school_id = t.from_school_id AND r.employee_id = t.from_employee_id
       AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
       AND r.month >= v_fy_from AND r.month < t.on_date)
  SELECT jsonb_build_object(
    'version', 1,
    'transferId', t.id::text,
    'onDate', t.on_date::text,
    'source', jsonb_build_object(
      'schoolId', t.from_school_id::text,
      'school', (SELECT name FROM schools WHERE id = t.from_school_id),
      'tan', (SELECT tan FROM payroll_settings WHERE school_id = t.from_school_id),
      'employeeId', t.from_employee_id::text,
      'code', (SELECT employee_code FROM employees WHERE id = t.from_employee_id),
      'lastLocked', (SELECT to_char(max(u.month), 'YYYY-MM') FROM payroll_runs u
                      WHERE u.school_id = t.from_school_id AND u.run_type = 'REGULAR'
                        AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL)),
    'profile', (SELECT to_jsonb(p) - 'school_id' - 'employee_id' - 'created_by' - 'created_at' - 'updated_by' - 'updated_at'
                  FROM payroll_profiles p WHERE p.employee_id = t.from_employee_id),
    'structures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', x.code, 'amount', x.amount::text) ORDER BY x.code)
        FROM (SELECT DISTINCT ON (s.pay_head_id) h.code, s.amount
                FROM payroll_structures s JOIN payroll_pay_heads h ON h.id = s.pay_head_id
               WHERE s.employee_id = t.from_employee_id AND s.status = 'active'
                 AND s.effective_from <= t.on_date AND (s.effective_to IS NULL OR s.effective_to >= t.on_date)
               ORDER BY s.pay_head_id, s.effective_from DESC) x), '[]'::jsonb),
    'loans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id::text, 'type', l.loan_type, 'balance', l.balance::text, 'emi', l.emi::text,
                                          'method', l.interest_method, 'rate', l.interest_rate::text) ORDER BY l.id)
        FROM payroll_loans l
       WHERE l.employee_id = t.from_employee_id AND l.status IN ('ACTIVE', 'HOLD') AND l.balance > 0), '[]'::jsonb),
    'tax', jsonb_build_object(
      'fy', v_fy,
      'from', (SELECT to_char(min(month), 'YYYY-MM-DD') FROM recs),
      'to', (t.on_date - 1)::text,
      'months', (SELECT count(DISTINCT month) FROM recs),
      'taxable', (SELECT COALESCE(sum(l.amount), 0) FROM payroll_record_lines l
                   WHERE l.record_id IN (SELECT id FROM recs) AND l.head_type = 'EARNING' AND l.is_taxable)::text,
      'pf', (SELECT COALESCE(sum(st.ee_pf + st.vpf), 0) FROM payroll_record_statutory st
              WHERE st.record_id IN (SELECT id FROM recs))::text,
      'pt', (SELECT COALESCE(sum(pt_amount), 0) FROM recs)::text,
      'tds', (SELECT COALESCE(sum(it_amount + cess_amount), 0) FROM recs)::text))
    INTO v_out;
  RETURN v_out;
END
$$;
REVOKE ALL ON FUNCTION app.payroll_transfer_packet(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payroll_transfer_packet(BIGINT) TO edupro_app;

-- The loans brought across end at the source: closed with a remark naming the destination. Only the loans of an
-- accepted transfer into the current school, once payroll has brought them (the import row is written first).
CREATE OR REPLACE FUNCTION app.payroll_transfer_close_loans(p_transfer BIGINT, p_loans BIGINT[]) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app AS $$
DECLARE t record; dst TEXT; n INT;
BEGIN
  SELECT * INTO t FROM employee_school_transfers WHERE id = p_transfer;
  IF NOT FOUND OR t.status <> 'accepted' OR t.to_school_id <> app.current_school_id()
     OR NOT EXISTS (SELECT 1 FROM payroll_transfer_imports i WHERE i.transfer_id = p_transfer AND i.school_id = t.to_school_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'transfer.not_imported';
  END IF;
  SELECT name INTO dst FROM schools WHERE id = t.to_school_id;
  UPDATE payroll_loans SET status = 'CLOSED', balance = 0,
         remarks = left(concat_ws(E'\n', remarks, 'CLOSED: carried to ' || dst || ' on transfer ' || t.id), 1000),
         updated_at = now()
   WHERE id = ANY(p_loans) AND employee_id = t.from_employee_id AND school_id = t.from_school_id AND status <> 'CLOSED';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION app.payroll_transfer_close_loans(BIGINT, BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payroll_transfer_close_loans(BIGINT, BIGINT[]) TO edupro_app;
