import type { PoolClient } from '@edupro/db';
import { amountInWords } from './payroll-words';

/**
 * The cut-over's arithmetic (docs/design/86, phase G; PAYROLL_GOLIVE_SPEC.md §2.5): the old payroll module's rows, as
 * read into payroll_legacy_rows, brought here — the people whole, the history from `history_from` (the last financial
 * year's 1 April) as read-only runs. Brought again, a row updates what it became (payroll_legacy_map); history already
 * brought is never touched again. Every refusal is a problem with examples; nothing is guessed.
 */
export const ENGINE_VERSION = 'payroll-engine 0.1.0';

type Row = Record<string, unknown>;
export interface Problem {
  what: string;
  count: number;
  examples: string[];
}
export class Tally {
  counts: Record<string, number> = {};
  problems: Problem[] = [];
  add(k: string, n = 1) {
    this.counts[k] = (this.counts[k] ?? 0) + n;
  }
  problem(what: string, example?: string | null) {
    let p = this.problems.find((x) => x.what === what);
    if (!p) this.problems.push((p = { what, count: 0, examples: [] }));
    p.count += 1;
    if (example && p.examples.length < 8 && !p.examples.includes(example)) p.examples.push(example);
  }
}

export const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
export const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
export const money = (v: unknown) => (Math.round(num(v) * 100) / 100).toFixed(2);
const live = (r: Row) => !num(r.isTrash) && (r.Status === undefined || num(r.Status) === 1);
const ym = (y: unknown, m: unknown) => `${String(num(y))}-${String(num(m)).padStart(2, '0')}`;
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : null);

export async function rowsOf(c: PoolClient, tbl: string): Promise<Array<Row & { _id: string }>> {
  return (
    await c.query<{ legacy_id: string; payload: Row }>(
      `SELECT legacy_id, payload FROM payroll_legacy_rows WHERE tbl = $1 ORDER BY legacy_id::bigint`,
      [tbl],
    )
  ).rows.map((r) => ({ ...r.payload, _id: r.legacy_id }));
}
async function mapped(c: PoolClient, tbl: string, id: string) {
  return (
    await c.query<{ entity_id: string }>(
      `SELECT entity_id::text FROM payroll_legacy_map WHERE tbl = $1 AND legacy_id = $2`,
      [tbl, id],
    )
  ).rows[0]?.entity_id;
}
async function remember(c: PoolClient, tbl: string, id: string, entity: string, entityId: string) {
  await c.query(
    `INSERT INTO payroll_legacy_map (school_id, tbl, legacy_id, entity, entity_id)
     VALUES (app.current_school_id(), $1, $2, $3, $4)
     ON CONFLICT (school_id, tbl, legacy_id) DO UPDATE SET entity = EXCLUDED.entity, entity_id = EXCLUDED.entity_id`,
    [tbl, id, entity, entityId],
  );
}

/** The old employee ids (EmpId) matched to this school's employees by their code. */
export async function employeesByCode(c: PoolClient) {
  const m = new Map<string, string>();
  for (const e of (
    await c.query<{ id: string; code: string }>(
      `SELECT id::text, lower(employee_code) AS code FROM employees WHERE deleted_at IS NULL`,
    )
  ).rows)
    m.set(e.code, e.id);
  return (empId: unknown) => m.get(str(empId).toLowerCase());
}

/** The old pay heads (by srno) as codes, and this school's heads by code. */
export async function headsOf(c: PoolClient) {
  const old = new Map((await rowsOf(c, 'payroll_pay_head')).map((h) => [h._id, h]));
  const here = new Map(
    (
      await c.query<{ code: string; id: string; head_type: string; taxable: boolean | null }>(
        `SELECT h.code, h.id::text, h.head_type,
                (SELECT v.is_taxable FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id AND v.status = 'active'
                  ORDER BY v.effective_from DESC LIMIT 1) AS taxable
           FROM payroll_pay_heads h`,
      )
    ).rows.map((h) => [h.code, h]),
  );
  return { codeOf: (srno: unknown) => str(old.get(str(srno))?.Code).toUpperCase() || null, here };
}

// ---- the people --------------------------------------------------------------------------------------------------------
export async function bringPeople(c: PoolClient, t: Tally, historyFrom: string) {
  const emp = await employeesByCode(c);
  const heads = await headsOf(c);
  const fyFrom = `${historyFrom.slice(0, 4)}-${String((Number(historyFrom.slice(0, 4)) + 1) % 100).padStart(2, '0')}`;
  // profiles: today's settings of each person (PAN and bank stay on the employee record)
  for (const p of (await rowsOf(c, 'payroll_employee_profile')).filter(live)) {
    const id = emp(p.EmpId);
    if (!id) {
      t.problem('No employee here with this code: their payroll is left out', str(p.EmpId));
      continue;
    }
    await c.query(
      `INSERT INTO payroll_profiles (employee_id, school_id, pf_applicable, pf_wage_basis, eps_applicable, vpf_type, vpf_value,
                                     nps_applicable, nps_ee_rate, nps_er_rate, esi_applicable, pt_applicable, pt_exempt_reason,
                                     tax_regime, tds_mode, category, pay_level, pay_cell, contract_start, contract_end,
                                     increment_month, payroll_status, pay_mode, created_by, updated_by)
       VALUES ($1, app.current_school_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::date,
               $19::date, $20, $21, $22, app.current_user_id(), app.current_user_id())
       ON CONFLICT (employee_id) DO UPDATE SET pf_applicable = EXCLUDED.pf_applicable, pf_wage_basis = EXCLUDED.pf_wage_basis,
         eps_applicable = EXCLUDED.eps_applicable, vpf_type = EXCLUDED.vpf_type, vpf_value = EXCLUDED.vpf_value,
         nps_applicable = EXCLUDED.nps_applicable, nps_ee_rate = EXCLUDED.nps_ee_rate, nps_er_rate = EXCLUDED.nps_er_rate,
         esi_applicable = EXCLUDED.esi_applicable, pt_applicable = EXCLUDED.pt_applicable, pt_exempt_reason = EXCLUDED.pt_exempt_reason,
         tax_regime = EXCLUDED.tax_regime, tds_mode = EXCLUDED.tds_mode, category = EXCLUDED.category, pay_level = EXCLUDED.pay_level,
         pay_cell = EXCLUDED.pay_cell, contract_start = EXCLUDED.contract_start, contract_end = EXCLUDED.contract_end,
         increment_month = EXCLUDED.increment_month, payroll_status = EXCLUDED.payroll_status, pay_mode = EXCLUDED.pay_mode,
         updated_by = app.current_user_id(), updated_at = now()`,
      [
        id,
        num(p.PfApplicable) === 1,
        str(p.PfWageBasis) || 'ACTUAL',
        num(p.EpsApplicable) === 1,
        str(p.VpfType) || 'NONE',
        money(p.VpfValue),
        num(p.NpsApplicable) === 1,
        str(p.NpsEeRate) || '0.10',
        str(p.NpsErRate) || '0.14',
        num(p.EsiApplicable) === 1,
        num(p.PtApplicable) === 1,
        str(p.PtExemptReason) || null,
        str(p.TaxRegime) || 'NEW',
        str(p.TdsMode) || 'PROJECTION',
        str(p.Category) || null,
        str(p.PayLevel) || null,
        p.PayCell === null || p.PayCell === undefined || p.PayCell === '' ? null : num(p.PayCell),
        day(p.ContractStartDate),
        day(p.ContractEndDate),
        p.IncrementMonth ? num(p.IncrementMonth) : null,
        str(p.PayrollStatus) || 'ACTIVE',
        str(p.PayMode) || 'BANK',
      ],
    );
    t.add('profiles');
  }
  // structures: the active and ended rows, when the person has none of their own here
  const own = new Set(
    (
      await c.query<{ id: string }>(
        `SELECT DISTINCT s.employee_id::text AS id FROM payroll_structures s
          WHERE NOT EXISTS (SELECT 1 FROM payroll_legacy_map m WHERE m.tbl = 'payroll_structure' AND m.entity_id = s.id)`,
      )
    ).rows.map((r) => r.id),
  );
  for (const s of (await rowsOf(c, 'payroll_structure')).filter((r) => !num(r.isTrash))) {
    const status = { ACTIVE: 'active', ENDED: 'ended' }[str(s.ApprovalStatus)];
    if (!status) continue; // a draft never paid anyone
    const id = emp(s.EmpId);
    const code = heads.codeOf(s.PayHeadSrno);
    const head = code ? heads.here.get(code) : undefined;
    if (!id) continue; // said once, at the profile
    if (own.has(id)) {
      t.problem('Has a pay structure of its own here: the old one is not brought', str(s.EmpId));
      continue;
    }
    if (!head) {
      t.problem(
        'A pay head the old payroll used is not set up here: its structure rows are left out',
        code,
      );
      continue;
    }
    const was = await mapped(c, 'payroll_structure', s._id);
    const args = [money(s.Amount), day(s.EffectiveFrom), day(s.EffectiveTo), status];
    if (was)
      await c.query(
        `UPDATE payroll_structures SET amount = $2, effective_from = $3::date, effective_to = $4::date, status = $5,
                updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [was, ...args],
      );
    else {
      const nid = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, effective_to, status,
                                           reference_no, change_reason, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6, $7, 'Brought from the old payroll',
                   app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [id, head.id, ...args, str(s.ReferenceNo).slice(0, 60) || null],
        )
      ).rows[0]!.id;
      await remember(c, 'payroll_structure', s._id, 'payroll_structures', nid);
    }
    t.add('structures');
  }
  // loans: what is owed and how it is recovered (the instalments already taken are in the history brought)
  for (const l of (await rowsOf(c, 'payroll_loan')).filter((r) => !num(r.isTrash))) {
    const id = emp(l.EmpId);
    if (!id) continue;
    const status = str(l.LoanStatus) || 'ACTIVE';
    const was = await mapped(c, 'payroll_loan', l._id);
    if (was)
      await c.query(
        `UPDATE payroll_loans SET balance = $2, status = $3, emi = $4, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [was, money(l.Balance), status, money(l.Emi)],
      );
    else {
      const method = str(l.InterestMethod) || 'NONE';
      const nid = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_loans (school_id, employee_id, loan_type, principal, emi, interest_rate, interest_method, balance,
                                      start_month, status, remarks, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            id,
            (
              str(l.LoanType)
                .toUpperCase()
                .replace(/[^A-Z0-9_ ]/g, ' ')
                .trim() || 'LOAN'
            ).slice(0, 40),
            money(l.Principal),
            money(l.Emi),
            method === 'NONE' ? '0' : str(l.InterestRate) || '0',
            method,
            money(l.Balance),
            `${ym(l.StartYear, l.StartMonth)}-01`,
            status,
            `Brought from the old payroll${str(l.Remarks) ? `: ${str(l.Remarks)}` : ''}`.slice(
              0,
              1000,
            ),
          ],
        )
      ).rows[0]!.id;
      await remember(c, 'payroll_loan', l._id, 'payroll_loans', nid);
    }
    t.add('loans');
  }
  // nominees
  for (const n of (await rowsOf(c, 'payroll_nominee')).filter(live)) {
    const id = emp(n.EmpId);
    if (!id) continue;
    if (await mapped(c, 'payroll_nominee', n._id)) continue;
    const nid = (
      await c.query<{ id: string }>(
        `INSERT INTO payroll_nominees (school_id, employee_id, name, relation, dob, share_percent, purpose, guardian_name, address,
                                       created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5, $6, $7, $8, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          id,
          str(n.Name).slice(0, 150),
          str(n.Relation).slice(0, 40) || 'Not given',
          day(n.Dob),
          money(n.SharePercent),
          str(n.Purpose) || 'GENERAL',
          str(n.GuardianName) || null,
          str(n.Address) || null,
        ],
      )
    ).rows[0]!.id;
    await remember(c, 'payroll_nominee', n._id, 'payroll_nominees', nid);
    t.add('nominees');
  }
  // payees and recurring deductions
  const payee = new Map<string, string>();
  for (const p of (await rowsOf(c, 'payroll_third_party')).filter(live)) {
    let pid = await mapped(c, 'payroll_third_party', p._id);
    if (!pid) {
      pid = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_payees (school_id, name, party_type, payee_account, remarks, active, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, true, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            str(p.Name).slice(0, 150),
            str(p.PartyType) || 'OTHER',
            str(p.PayeeAccount) || null,
            str(p.Remarks) || null,
          ],
        )
      ).rows[0]!.id;
      await remember(c, 'payroll_third_party', p._id, 'payroll_payees', pid);
      t.add('payees');
    }
    payee.set(p._id, pid);
  }
  for (const r of (await rowsOf(c, 'payroll_recurring_deduction')).filter(live)) {
    const id = emp(r.EmpId);
    const code = heads.codeOf(r.PayHeadSrno);
    const head = code ? heads.here.get(code) : undefined;
    if (!id) continue;
    if (!head) {
      t.problem(
        'A pay head the old payroll used is not set up here: its recurring deductions are left out',
        code,
      );
      continue;
    }
    if (await mapped(c, 'payroll_recurring_deduction', r._id)) continue;
    const nid = (
      await c.query<{ id: string }>(
        `INSERT INTO payroll_recurring (school_id, employee_id, pay_head_id, payee_id, amount, reference_no, start_month, end_month,
                                        status, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date, $7::date, $8, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          id,
          head.id,
          payee.get(str(r.ThirdPartySrno)) ?? null,
          money(r.Amount),
          str(r.ReferenceNo) || null,
          `${ym(r.StartYear, r.StartMonth)}-01`,
          num(r.EndYear) ? `${ym(r.EndYear, r.EndMonth || 12)}-01` : null,
          str(r.RdStatus) || 'ACTIVE',
        ],
      )
    ).rows[0]!.id;
    await remember(c, 'payroll_recurring_deduction', r._id, 'payroll_recurring', nid);
    t.add('recurring');
  }
  // ESI coverage periods
  for (const v of (await rowsOf(c, 'payroll_esi_coverage')).filter(live)) {
    const id = emp(v.EmpId);
    if (!id || !day(v.PeriodStart)) continue;
    await c.query(
      `INSERT INTO payroll_esi_coverage (school_id, employee_id, period_start, covered, wage_at_start)
       VALUES (app.current_school_id(), $1, $2::date, $3, $4)
       ON CONFLICT (employee_id, period_start) DO UPDATE SET covered = EXCLUDED.covered, wage_at_start = EXCLUDED.wage_at_start`,
      [id, day(v.PeriodStart), num(v.Covered) === 1, money(v.WageAtStart)],
    );
    t.add('esiCoverage');
  }
  // the tax of the years brought: earlier employers, declarations, challans
  for (const x of (await rowsOf(c, 'payroll_prev_employer_income')).filter(live)) {
    const id = emp(x.EmpId);
    if (!id || str(x.Fy) < fyFrom) continue;
    if (await mapped(c, 'payroll_prev_employer_income', x._id)) continue;
    const there = (
      await c.query(
        `SELECT 1 FROM payroll_prev_employment WHERE employee_id = $1 AND fy = $2 AND deleted_at IS NULL`,
        [id, str(x.Fy)],
      )
    ).rowCount;
    if (there) {
      t.problem(
        'An earlier employer of that year is already here: the old one is not brought',
        `${str(x.EmpId)} ${str(x.Fy)}`,
      );
      continue;
    }
    const tan = str(x.EmployerTan).toUpperCase();
    const nid = (
      await c.query<{ id: string }>(
        `INSERT INTO payroll_prev_employment (school_id, employee_id, fy, employer_name, employer_tan, gross, exempt, pf, pt, tds,
                                              status, entered_for, created_by, decided_by, decided_at)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, app.current_user_id(),
                 CASE WHEN $10 = 'VERIFIED' THEN app.current_user_id() END, CASE WHEN $10 = 'VERIFIED' THEN now() END)
         RETURNING id::text`,
        [
          id,
          str(x.Fy),
          (str(x.EmployerName) || 'Earlier employer').slice(0, 150),
          /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan) ? tan : null,
          money(x.GrossSalary),
          money(x.ExemptAllowances),
          money(x.PfDeducted),
          money(x.PtDeducted),
          money(x.TdsDeducted),
          num(x.Verified) === 1 ? 'VERIFIED' : 'SUBMITTED',
        ],
      )
    ).rows[0]!.id;
    await remember(c, 'payroll_prev_employer_income', x._id, 'payroll_prev_employment', nid);
    t.add('earlierEmployers');
  }
  const labels = new Set(
    (
      await c.query<{ code: string }>(`SELECT DISTINCT line_code AS code FROM payroll_tax_labels`)
    ).rows.map((r) => r.code),
  );
  for (const d of (await rowsOf(c, 'payroll_investment_declaration')).filter(live)) {
    const id = emp(d.EmpId);
    if (!id || str(d.Fy) < fyFrom) continue;
    const code = str(d.Section).toUpperCase();
    if (!labels.has(code)) {
      t.problem(
        'A tax section the old payroll used is not known here: its declarations are left out',
        code,
      );
      continue;
    }
    if (await mapped(c, 'payroll_investment_declaration', d._id)) continue;
    const status =
      { DECLARED: 'SUBMITTED', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' }[str(d.DeclStatus)] ??
      'SUBMITTED';
    try {
      await c.query('SAVEPOINT decl');
      const nid = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_declarations (school_id, employee_id, fy, line_code, declared, verified, status, reject_reason,
                                             entered_for, created_by, decided_by, decided_at)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, true, app.current_user_id(),
                   CASE WHEN $6 <> 'SUBMITTED' THEN app.current_user_id() END, CASE WHEN $6 <> 'SUBMITTED' THEN now() END)
           RETURNING id::text`,
          [
            id,
            str(d.Fy),
            code,
            money(d.Declared),
            status === 'SUBMITTED' ? null : money(d.Verified),
            status,
            status === 'REJECTED' ? 'Rejected in the old payroll' : null,
          ],
        )
      ).rows[0]!.id;
      await c.query('RELEASE SAVEPOINT decl');
      await remember(c, 'payroll_investment_declaration', d._id, 'payroll_declarations', nid);
      t.add('declarations');
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT decl');
      t.problem(
        'A declaration of that section and year is already here: the old one is not brought',
        `${str(d.EmpId)} ${code}`,
      );
    }
  }
  for (const ch of (await rowsOf(c, 'payroll_tds_challan')).filter(live)) {
    if (str(ch.Fy) < fyFrom) continue;
    if (await mapped(c, 'payroll_tds_challan', ch._id)) continue;
    let months: number[] = [];
    try {
      const m =
        typeof ch.MonthsCovered === 'string'
          ? (JSON.parse(ch.MonthsCovered) as unknown)
          : ch.MonthsCovered;
      months = Array.isArray(m) ? m.map(Number).filter((x) => x >= 1 && x <= 12) : [];
    } catch {
      months = [];
    }
    const nid = (
      await c.query<{ id: string }>(
        `INSERT INTO payroll_tds_challans (school_id, fy, quarter, bsr_code, challan_no, deposited_on, amount, interest, months, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7, $8::int[], app.current_user_id())
         ON CONFLICT DO NOTHING RETURNING id::text`,
        [
          str(ch.Fy),
          num(ch.Quarter),
          str(ch.BsrCode),
          str(ch.ChallanNo),
          day(ch.DepositDate),
          money(ch.Amount),
          money(ch.Interest),
          months,
        ],
      )
    ).rows[0]?.id;
    if (nid) {
      await remember(c, 'payroll_tds_challan', ch._id, 'payroll_tds_challans', nid);
      t.add('challans');
    }
  }
}

// ---- the history ---------------------------------------------------------------------------------------------------------
/** The months a list of runs pays, and the run's records with their lines and side lines. */
export async function legacyMonth(c: PoolClient) {
  const runs = (await rowsOf(c, 'payroll_run')).filter(
    (r) => !num(r.isTrash) && ['LOCKED', 'PAID'].includes(str(r.RunStage).toUpperCase()),
  );
  const records = (await rowsOf(c, 'payroll_salary_record')).filter(
    (r) => !num(r.isTrash) && str(r.RecStatus) !== 'FAILED',
  );
  const lines = new Map<string, Row[]>();
  for (const l of (await rowsOf(c, 'payroll_salary_record_line')).filter((r) => !num(r.isTrash))) {
    const k = str(l.RecordSrno);
    lines.set(k, [...(lines.get(k) ?? []), l]);
  }
  const side = async (tbl: string) =>
    new Map(
      (await rowsOf(c, tbl)).filter((r) => !num(r.isTrash)).map((r) => [str(r.RecordSrno), r]),
    );
  return {
    runs,
    records,
    lines,
    pf: await side('payroll_pf_line'),
    nps: await side('payroll_nps_line'),
    lwf: await side('payroll_lwf_line'),
  };
}

const STATUTORY = ['PF', 'VPF', 'ESI', 'PT', 'TDS', 'LWF', 'NPS'];
export function kindOf(l: Row, category: string | null) {
  if (num(l.IsStructure)) return 'structure';
  if (num(l.IsArrear)) return 'arrear';
  if (STATUTORY.includes(str(l.HeadCode).toUpperCase())) return 'engine';
  if (category === 'LOAN') return 'loan';
  return 'adhoc';
}

export async function bringHistory(
  c: PoolClient,
  t: Tally,
  historyFrom: string,
  until: string | null,
) {
  const emp = await employeesByCode(c);
  const heads = await headsOf(c);
  const cats = new Map(
    (
      await c.query<{ code: string; category: string }>(
        `SELECT code, category FROM payroll_pay_heads`,
      )
    ).rows.map((r) => [r.code, r.category]),
  );
  const L = await legacyMonth(c);
  const esiRate = Number(
    (
      await c.query<{ r: string }>(
        `SELECT er_rate::text AS r FROM payroll_esi_settings WHERE status = 'active' ORDER BY effective_from DESC LIMIT 1`,
      )
    ).rows[0]?.r ?? '0.0325',
  );
  for (const run of L.runs) {
    const month = `${ym(run.PayYear, run.PayMonth)}-01`;
    if (month < historyFrom || (until && month >= until)) continue;
    if (await mapped(c, 'payroll_run', run._id)) continue; // history brought stays as it is
    const recs = L.records.filter((r) => str(r.RunSrno) === run._id);
    const people = recs.map((r) => ({ r, id: emp(r.EmpId) }));
    for (const p of people.filter((x) => !x.id))
      t.problem('No employee here with this code: their history is left out', str(p.r.EmpId));
    const type = str(run.RunType).toUpperCase();
    const runType = type === 'REGULAR' || type === 'BONUS' ? type : 'SUPPLEMENTARY';
    const ids = people.filter((x) => x.id).map((x) => x.id!);
    if (runType === 'SUPPLEMENTARY' && !ids.length) continue;
    let runId: string;
    try {
      await c.query('SAVEPOINT run');
      runId = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_runs (school_id, month, run_type, seq, employee_ids, stage, emp_count, gross_total, deduction_total,
                                     net_total, remark, purpose, approved_at, locked_at, imported, created_by, updated_by)
           VALUES (app.current_school_id(), $1::date, $2,
                   -- the next number of the month (a removed parallel run keeps its own)
                   (SELECT COALESCE(max(seq), 0) + 1 FROM payroll_runs WHERE month = $1::date AND run_type = $2),
                   $3::bigint[], $4, $5, $6, $7, $8, 'The old payroll', $9, $10::timestamptz, $11::timestamptz, true,
                   app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            month,
            runType,
            runType === 'SUPPLEMENTARY' ? ids : null,
            str(run.RunStage).toUpperCase() === 'PAID' ? 'PAID' : 'LOCKED',
            ids.length,
            money(run.GrossTotal),
            money(run.DeductionTotal),
            money(run.NetTotal),
            type === 'FNF' ? 'FNF' : null,
            str(run.ApprovedAt) || null,
            str(run.LockedAt) || null,
          ],
        )
      ).rows[0]!.id;
      await c.query('RELEASE SAVEPOINT run');
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT run');
      t.problem(
        'EduPro already has its own run of that month: the old one is not brought',
        `${month.slice(0, 7)} ${type}`,
      );
      continue;
    }
    await remember(c, 'payroll_run', run._id, 'payroll_runs', runId);
    t.add('runs');
    for (const { r, id } of people) {
      if (!id) continue;
      const net = money(r.NetPay);
      const recId = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_records (school_id, run_id, employee_id, month, status, is_top_up, employee_code, employee_name,
                                        designation, department, pan_masked, uan, pf_number, pay_mode, bank_ifsc, bank_account_masked,
                                        month_days, paid_days, lop_days, gross_fixed, gross_earned, lop_amount, pf_wage, esi_wage,
                                        pt_amount, it_amount, cess_amount, total_deductions, net_pay, net_in_words, engine_version, trace)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, 'legacy', $30::jsonb)
           RETURNING id::text`,
          [
            runId,
            id,
            month,
            ['COMPUTED', 'HELD', 'RELEASED', 'PAID'].includes(str(r.RecStatus))
              ? str(r.RecStatus)
              : 'PAID',
            runType !== 'REGULAR',
            str(r.EmpId),
            str(r.EmpName) || str(r.EmpId),
            str(r.Designation) || null,
            str(r.Department) || null,
            str(r.PanMasked) || null,
            str(r.Uan) || null,
            str(r.PfNumber) || null,
            str(r.PayMode) || 'BANK',
            str(r.BankIfsc) || null,
            str(r.BankAccountMasked) || null,
            money(r.MonthDays),
            money(r.PaidDays),
            money(r.LopDays),
            money(r.GrossFixed),
            money(r.GrossEarned),
            money(r.LopAmount),
            money(r.PfWage),
            money(r.EsiWage),
            money(r.PtAmount),
            money(r.ItAmount),
            money(r.CessAmount),
            money(r.TotalDeductions),
            net,
            amountInWords(net),
            JSON.stringify({
              legacy: { record: r._id, engine: str(r.EngineVersion), seed: str(r.SeedVersion) },
            }),
          ],
        )
      ).rows[0]!.id;
      await remember(c, 'payroll_salary_record', r._id, 'payroll_records', recId);
      t.add('records');
      let order = 0;
      let esiEe = 0;
      for (const l of L.lines.get(r._id) ?? []) {
        const code = str(l.HeadCode).toUpperCase() || heads.codeOf(l.PayHeadSrno) || 'OTHER';
        const head = heads.here.get(code);
        if (!head)
          t.problem(
            'A pay head of the history is not set up here: its lines come with no head',
            code,
          );
        if (code === 'ESI') esiEe += num(l.EarnedAmount);
        await c.query(
          `INSERT INTO payroll_record_lines (school_id, record_id, pay_head_id, code, name, head_type, rate, amount, is_arrear,
                                             is_structure, is_taxable, calc_order, print_order, show_if_zero, source_kind, source_id)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13, $14)`,
          [
            recId,
            head?.id ?? null,
            code.slice(0, 20),
            str(l.HeadName) || code,
            str(l.HeadType) === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING',
            money(l.RateAmount),
            money(l.EarnedAmount),
            num(l.IsArrear) === 1,
            num(l.IsStructure) === 1,
            head?.taxable ?? str(l.HeadType) !== 'DEDUCTION',
            (order += 1),
            num(l.PrintOrder),
            kindOf(l, cats.get(code) ?? null),
            `legacy:${l._id}`,
          ],
        );
      }
      const pf = L.pf.get(r._id);
      const nps = L.nps.get(r._id);
      const lwf = L.lwf.get(r._id);
      const esiWage = num(r.EsiWage);
      await c.query(
        `INSERT INTO payroll_record_statutory (record_id, school_id, pf_wage, eps_wage, edli_wage, ee_pf, vpf, er_eps, er_epf, edli,
                                               pf_admin, ncp_days, nps_wage, nps_ee, nps_er, esi_covered, esi_wage, esi_ee, esi_er,
                                               lwf_state, lwf_ee, lwf_er)
         VALUES ($1, app.current_school_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          recId,
          money(pf?.PfWage),
          money(pf?.EpsWage),
          money(pf?.EdliWage),
          money(pf?.EePf),
          money(pf?.Vpf),
          money(pf?.ErEps),
          money(pf?.ErEpf),
          money(pf?.EdliCharges),
          money(pf?.AdminCharges),
          money(pf?.NcpDays),
          money(nps?.NpsWage),
          money(nps?.EeNps),
          money(nps?.ErNps),
          esiWage > 0,
          money(esiWage),
          money(esiEe),
          // the old module never stored the employer's ESI: its reports worked it out so (rounded up to the rupee)
          money(esiWage > 0 ? Math.ceil(esiWage * esiRate) : 0),
          str(lwf?.StateCode) || null,
          money(lwf?.EeLwf),
          money(lwf?.ErLwf),
        ],
      );
    }
  }
  // the attendance as it was paid, for the months brought (EduPro's own months stay)
  for (const a of (await rowsOf(c, 'payroll_attendance_summary')).filter(
    (r) => !num(r.isTrash) && num(r.Finalised) === 1,
  )) {
    const month = `${ym(a.PayYear, a.PayMonth)}-01`;
    if (month < historyFrom || (until && month >= until)) continue;
    const id = emp(a.EmpId);
    if (!id) continue;
    const r = await c.query(
      `INSERT INTO payroll_attendance (school_id, employee_id, month, window_from, window_to, month_days, present_days,
                                       paid_leave_days, lop_days, paid_days, ot_hours, source, reason, finalised, finalised_by,
                                       finalised_at, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2::date, $2::date, ($2::date + interval '1 month' - interval '1 day')::date, $3, $4, $5,
               $6, $7, $8, 'import', 'The old payroll', true, app.current_user_id(), now(), app.current_user_id(), app.current_user_id())
       ON CONFLICT (employee_id, month) DO NOTHING`,
      [
        id,
        month,
        money(a.MonthDays),
        money(a.PresentDays),
        money(a.PaidLeaveDays),
        money(a.LopDays),
        money(a.PaidDays),
        money(a.OtHours),
      ],
    );
    if (r.rowCount) t.add('attendance');
  }
}
