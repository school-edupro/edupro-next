import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { codeWages, gratuity, serviceLength } from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { registerGeneratedOn, registerLetterhead } from '../exams/register-head';
import { RUN } from './payroll-inputs.dto';
import {
  bad,
  firstOf,
  has,
  hiddenFor,
  monthWords,
  must,
  mustBeOpenForTopUp,
} from './payroll-month';
import {
  type Grid,
  type GridCol,
  type GridRow,
  paise,
  rupees,
  totalOf,
} from './payroll-report-grid';
import { STAFF_TYPES, type Scope } from './payroll-reports';
import { PAYROLL } from './payroll.dto';

type Base = Pick<Grid, 'period' | 'subtitle' | 'provisional'>;
const money = (key: string, label: string): GridCol => ({ key, label, kind: 'money' });
const num = (key: string, label: string): GridCol => ({ key, label, kind: 'number', width: 0.05 });
const text = (key: string, label: string, width = 0.12): GridCol => ({
  key,
  label,
  kind: 'text',
  width,
});
const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';

export interface BonusRule {
  kind: 'PERCENT' | 'FIXED' | 'STATUTORY';
  rate: string | null;
  amount: string | null;
  prorate: boolean;
  minMonths: number;
  minDays: string;
  maxWage: string | null;
  wageCap: string | null;
  note: string | null;
}
/** The Code on Wages' formula, offered as a start (schools are outside it, s.41(1)(e), unless they choose it). */
export const STATUTORY_BONUS: BonusRule = {
  kind: 'STATUTORY',
  rate: '0.0833',
  amount: null,
  prorate: true,
  minMonths: 0,
  minDays: '30',
  maxWage: '21000',
  wageCap: '7000',
  note: null,
};

/**
 * The year's figures (docs/design/86, phase F): the gratuity liability as of a date — what it would be if every
 * employee left that day, by the same rule as a settlement — with the file an actuary values it from (the accounts'
 * figure under AS 15 / Ind AS 19 is the actuary's); and the bonus by the school's own rule for the year, one line per
 * employee, posted by a checker as one-off items of a month's bonus run.
 */
@Injectable()
export class PayrollAnnualService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- gratuity liability -----------------------------------------------------------------------------------------------
  private async liabilityRows(c: PoolClient, s: Scope, asOf: string) {
    const st = (
      await c.query<{ cap: string; tax_free: string }>(
        `SELECT gratuity_cap::text AS cap, gratuity_tax_free_cap::text AS tax_free FROM payroll_settings`,
      )
    ).rows[0];
    if (!st) bad('Open Payroll set-up first', 409);
    const codeRule =
      Number(
        (
          await c.query<{ v: string }>(
            `SELECT rate_value::text AS v FROM payroll_rates WHERE rate_code = 'LABOUR_CODE_WAGES' AND status = 'active'
                AND effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
              ORDER BY effective_from DESC LIMIT 1`,
            [asOf],
          )
        ).rows[0]?.v ?? 0,
      ) >= 1;
    const staff = (
      await c.query<{
        id: string;
        code: string;
        name: string;
        designation: string | null;
        department: string | null;
        staff_type: string | null;
        gender: string | null;
        dob: string | null;
        joined_on: string | null;
        basis: string | null;
        pay: string | null;
        month: string | null;
      }>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department,
                e.employee_type::text AS staff_type, e.gender::text, e.dob::text, e.joined_on::text, w.basis, w.pay, w.month
           FROM employees e
           LEFT JOIN payroll_profiles pp ON pp.employee_id = e.id
           LEFT JOIN LATERAL (
             SELECT to_char(r.month, 'YYYY-MM') AS month,
                    (SELECT COALESCE(sum(l.rate), 0) FROM payroll_record_lines l WHERE l.record_id = r.id AND l.is_structure
                        AND NOT l.is_arrear AND l.code IN ('BASIC', 'DA'))::text AS basis,
                    (SELECT COALESCE(sum(l.rate), 0) FROM payroll_record_lines l WHERE l.record_id = r.id AND l.is_structure
                        AND NOT l.is_arrear AND l.head_type = 'EARNING')::text AS pay
               FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
              WHERE r.employee_id = e.id AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
                AND NOT r.is_top_up AND r.month <= $1::date
              ORDER BY r.month DESC, r.id DESC LIMIT 1) w ON true
          WHERE e.deleted_at IS NULL AND (e.left_on IS NULL OR e.left_on > $1::date) AND e.status = 'active'
            AND COALESCE(pp.payroll_status, 'ACTIVE') <> 'LEFT'
            AND (e.joined_on IS NULL OR e.joined_on <= $1::date)
            AND NOT (e.id::text = ANY($2::text[])) AND ($3::text IS NULL OR e.department = $3)
            AND ($4::text IS NULL OR e.employee_type::text = $4)
          ORDER BY e.display_name`,
        [asOf, s.hidden, s.department, s.staffType],
      )
    ).rows;
    const done: Array<GridRow & { _service: number }> = [];
    const missing: GridRow[] = [];
    for (const e of staff) {
      if (!e.joined_on) {
        missing.push({
          code: e.code,
          name: e.name,
          why: 'No date of joining on the employee record',
        });
        continue;
      }
      if (!e.basis || paise(e.basis) <= 0n) {
        missing.push({ code: e.code, name: e.name, why: 'No locked month with basic and DA yet' });
        continue;
      }
      const basis = paise(e.basis);
      const wage = codeRule ? codeWages(basis, paise(e.pay)) : basis;
      const rule = {
        minYears: e.staff_type === 'contract' ? 1 : 5,
        daysPerYear: 15,
        divisor: 26,
        cap: paise(st!.cap),
        taxFreeCap: paise(st!.tax_free),
      };
      const g = gratuity({ monthlyWage: wage, from: e.joined_on, to: asOf, rule });
      // what has accrued for the years served, due or not yet
      const accrued = gratuity({
        monthlyWage: wage,
        from: e.joined_on,
        to: asOf,
        rule,
        anyService: true,
      });
      const sv = serviceLength(e.joined_on, asOf);
      done.push({
        code: e.code,
        name: e.name,
        designation: e.designation,
        staff_type: e.staff_type ? (STAFF_TYPES[e.staff_type] ?? e.staff_type) : '',
        gender: e.gender,
        dob: e.dob,
        joined: dmy(e.joined_on),
        joined_iso: e.joined_on,
        service: `${String(sv.years)} y ${String(sv.months)} m`,
        years: g.years,
        wage: rupees(wage),
        basis: rupees(basis),
        month: e.month,
        due: g.eligible ? 'Yes' : 'Not yet',
        payable: rupees(g.amount),
        accrued: rupees(accrued.amount),
        _service: Math.round((sv.totalDays / 365.25) * 100) / 100,
      });
    }
    return { rows: done, missing, codeRule };
  }

  async liability(c: PoolClient, s: Scope, base: Base, asOf: string): Promise<Grid> {
    const { rows, missing, codeRule } = await this.liabilityRows(c, s, asOf);
    const columns: GridCol[] = [
      text('code', 'Emp. ID', 0.07),
      text('name', 'Employee', 0.15),
      text('designation', 'Designation', 0.1),
      text('joined', 'Joined', 0.08),
      text('service', 'Service', 0.07),
      num('years', 'Years counted'),
      money('wage', 'Monthly wage'),
      text('due', 'Due', 0.05),
      money('payable', 'Payable if all left'),
      money('accrued', 'Accrued for the years'),
    ];
    const clean = rows.map(({ _service: _s, ...r }) => r);
    return {
      key: 'gratuity',
      title: 'Gratuity liability',
      ...base,
      provisional: null,
      subtitle: [
        ...base.subtitle,
        `15 days’ wages (${codeRule ? 'the labour codes’ wages' : 'basic + DA'} ÷ 26) for each year, a part year above six months counted; due after 5 years (1 for contract staff); capped by the school’s limit.`,
      ],
      columns,
      rows: clean,
      subtotals: [],
      total: clean.length
        ? { ...totalOf(columns, clean, `Total (${String(clean.length)})`), years: '' }
        : null,
      after: missing.length
        ? [
            {
              title: 'Not worked out',
              columns: [
                text('code', 'Emp. ID', 0.1),
                text('name', 'Employee', 0.3),
                text('why', 'Why', 0.6),
              ],
              rows: missing,
            },
          ]
        : undefined,
      note: 'The figure for the accounts (AS 15 / Ind AS 19) is the actuary’s valuation: give them the actuary’s file.',
    };
  }

  /** The file an actuary values the liability from: the staff, the leavers of the year, the rule. */
  async actuaryFile(ctx: RequestContext, asOf: string) {
    must(ctx, RUN.view, 'Only payroll staff see the gratuity liability');
    if (!(has(ctx, RUN.approve) || has(ctx, PAYROLL.admin) || has(ctx, 'payroll.audit.view')))
      bad('The actuary’s file is a payroll checker’s', 403);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s: Scope = {
        from: asOf,
        to: asOf,
        runId: null,
        hidden: [],
        department: null,
        staffType: null,
        employeeId: null,
      };
      const { rows, missing, codeRule } = await this.liabilityRows(c, s, asOf);
      const fyStart = `${String(Number(asOf.slice(5, 7)) >= 4 ? Number(asOf.slice(0, 4)) : Number(asOf.slice(0, 4)) - 1)}-04-01`;
      const leavers = (
        await c.query<{
          code: string;
          name: string;
          last_day: string;
          reason: string;
          gratuity: string;
          status: string;
        }>(
          `SELECT e.employee_code AS code, e.display_name AS name, s.last_day::text, s.reason, s.gratuity::text, s.status
             FROM payroll_settlements s JOIN employees e ON e.id = s.employee_id
            WHERE s.last_day BETWEEN $1::date AND $2::date AND s.status <> 'CANCELLED' ORDER BY s.last_day`,
          [fyStart, asOf],
        )
      ).rows;
      const head = await registerLetterhead(c);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Staff');
      ws.addRow([head.school]).font = { bold: true, size: 13 };
      ws.addRow([`Gratuity — data for the actuarial valuation as of ${dmy(asOf)}`]).font = {
        bold: true,
      };
      ws.addRow([`Generated on ${registerGeneratedOn()}`]);
      ws.addRow([]);
      ws.addRow([
        'Emp. ID',
        'Name',
        'Gender',
        'Date of birth',
        'Date of joining',
        'Staff type',
        'Monthly wage for gratuity',
        'Basic + DA',
        'Service (years)',
        'Years counted',
        'Due now',
        'Payable if leaving',
        'Wage month',
      ]).font = { bold: true };
      for (const r of rows)
        ws.addRow([
          r.code,
          r.name,
          r.gender ?? '',
          r.dob ?? '',
          r.joined_iso ?? '',
          r.staff_type,
          Number(r.wage),
          Number(r.basis),
          r._service,
          r.years,
          r.due,
          Number(r.payable),
          r.month ?? '',
        ]);
      [12, 26, 9, 12, 14, 14, 16, 14, 12, 12, 9, 16, 11].forEach(
        (w, i) => (ws.getColumn(i + 1).width = w),
      );
      const lv = wb.addWorksheet('Leavers this year');
      lv.addRow(['Emp. ID', 'Name', 'Last day', 'Reason', 'Gratuity', 'Settlement']).font = {
        bold: true,
      };
      for (const l of leavers)
        lv.addRow([l.code, l.name, l.last_day, l.reason, Number(l.gratuity), l.status]);
      const rule = wb.addWorksheet('The rule');
      for (const line of [
        [
          'Formula',
          `15 / 26 of the monthly wage for each completed year; a part year above six months counts`,
        ],
        [
          'Monthly wage',
          codeRule
            ? 'The labour codes’ wages (allowances above half of the pay count)'
            : 'Basic + DA',
        ],
        [
          'Due after',
          '5 years’ service (1 year for contract staff); at once on death or disablement',
        ],
        [
          'Cap',
          (await c.query<{ v: string }>(`SELECT gratuity_cap::text AS v FROM payroll_settings`))
            .rows[0]?.v ?? '',
        ],
        [
          'Not worked out',
          missing.map((m) => `${String(m.code)} (${String(m.why)})`).join('; ') || 'None',
        ],
        [
          'Assumptions',
          'Discount rate, salary escalation, attrition and mortality are the actuary’s',
        ],
      ])
        rule.addRow(line);
      rule.getColumn(1).width = 18;
      rule.getColumn(2).width = 90;
      await this.audit.stage(ctx, c, {
        action: 'payroll.report.download',
        entityType: 'payroll_reports',
        entityId: 'gratuity_actuary',
        after: { asOf, staff: rows.length },
      });
      return {
        filename: `Gratuity_actuary_data_${asOf}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    });
  }

  // ---- the bonus ---------------------------------------------------------------------------------------------------------
  private async ruleOf(c: PoolClient, fy: string): Promise<BonusRule | null> {
    const r = (
      await c.query<{
        kind: BonusRule['kind'];
        rate: string | null;
        amount: string | null;
        prorate: boolean;
        min_months: number;
        min_days: string;
        max_wage: string | null;
        wage_cap: string | null;
        note: string | null;
      }>(
        `SELECT kind, rate::text, amount::text, prorate, min_months, min_days::text, max_wage::text, wage_cap::text, note
           FROM payroll_bonus_rules WHERE fy = $1`,
        [fy],
      )
    ).rows[0];
    return r
      ? {
          kind: r.kind,
          rate: r.rate,
          amount: r.amount,
          prorate: r.prorate,
          minMonths: r.min_months,
          minDays: r.min_days,
          maxWage: r.max_wage,
          wageCap: r.wage_cap,
          note: r.note,
        }
      : null;
  }

  async rule(ctx: RequestContext, fy: string) {
    must(ctx, RUN.view, 'Only payroll staff see the bonus');
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      rule: await this.ruleOf(c, fy),
      statutory: STATUTORY_BONUS,
      can: { set: has(ctx, RUN.manage), post: has(ctx, RUN.approve) },
    }));
  }

  async saveRule(ctx: RequestContext, fy: string, r: BonusRule) {
    must(ctx, RUN.manage, 'Only payroll staff set the bonus rule');
    if (r.kind === 'FIXED' ? !r.amount : !r.rate)
      bad(r.kind === 'FIXED' ? 'The sum for each employee' : 'The rate');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const posted = (
        await c.query(`SELECT 1 FROM payroll_bonus_postings WHERE fy = $1 LIMIT 1`, [fy])
      ).rowCount;
      if (posted) bad('The year’s bonus is already posted: the rule stays as it was', 409);
      await c.query(
        `INSERT INTO payroll_bonus_rules (school_id, fy, kind, rate, amount, prorate, min_months, min_days, max_wage, wage_cap, note, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, app.current_user_id())
         ON CONFLICT (school_id, fy) DO UPDATE SET kind = EXCLUDED.kind, rate = EXCLUDED.rate, amount = EXCLUDED.amount,
           prorate = EXCLUDED.prorate, min_months = EXCLUDED.min_months, min_days = EXCLUDED.min_days, max_wage = EXCLUDED.max_wage,
           wage_cap = EXCLUDED.wage_cap, note = EXCLUDED.note, updated_by = app.current_user_id(), updated_at = now()`,
        [
          fy,
          r.kind,
          r.kind === 'FIXED' ? null : r.rate,
          r.kind === 'FIXED' ? r.amount : null,
          r.prorate,
          r.minMonths,
          r.minDays,
          r.maxWage,
          r.wageCap,
          r.note,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.bonus.rule',
        entityType: 'payroll_bonus_rules',
        entityId: fy,
        after: { ...r },
      });
      return { ok: true };
    });
  }

  /** One line per employee: the months and days of the year, the wage counted, the bonus, why not, where posted. */
  private async bonusRows(c: PoolClient, s: Scope, fy: string) {
    const rule = await this.ruleOf(c, fy);
    if (!rule) bad(`Set the bonus rule of ${fy} first`, 409);
    const y = Number(fy.slice(0, 4));
    const months = (
      await c.query<{
        employee_id: string;
        code: string;
        name: string;
        designation: string | null;
        month: string;
        basis: string;
        days: string;
      }>(
        `SELECT r.employee_id::text, max(e.employee_code) AS code, max(e.display_name) AS name, max(e.designation) AS designation,
                to_char(r.month, 'YYYY-MM') AS month,
                COALESCE(sum((SELECT COALESCE(sum(l.amount), 0) FROM payroll_record_lines l WHERE l.record_id = r.id
                  AND l.is_structure AND l.code IN ('BASIC', 'DA'))), 0)::text AS basis,
                COALESCE(max(r.paid_days) FILTER (WHERE NOT r.is_top_up), 0)::text AS days
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id JOIN employees e ON e.id = r.employee_id
          WHERE u.stage IN ('APPROVED', 'LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
            AND u.run_type <> 'BONUS' AND r.month BETWEEN $1::date AND $2::date
            AND NOT (r.employee_id::text = ANY($3::text[])) AND ($4::text IS NULL OR e.department = $4)
            AND ($5::text IS NULL OR e.employee_type::text = $5)
          GROUP BY r.employee_id, r.month ORDER BY max(e.display_name), r.month`,
        [`${String(y)}-04-01`, `${String(y + 1)}-03-01`, s.hidden, s.department, s.staffType],
      )
    ).rows;
    const posted = new Map(
      (
        await c.query<{ employee_id: string; month: string; amount: string }>(
          `SELECT employee_id::text, to_char(month, 'YYYY-MM') AS month, amount::text FROM payroll_adhoc
            WHERE ref_module = 'BONUS' AND ref_id LIKE $1 AND deleted_at IS NULL`,
          [`BONUS/${fy}/%`],
        )
      ).rows.map((r) => [r.employee_id, r]),
    );
    const people = new Map<string, typeof months>();
    for (const m of months) people.set(m.employee_id, [...(people.get(m.employee_id) ?? []), m]);
    const rows: Array<GridRow & { employee_id: string; _bonus: string }> = [];
    for (const [id, ms] of people) {
      const first = ms[0]!;
      let eligible = 0;
      let high = 0;
      let wage = 0n;
      let days = 0;
      for (const m of ms) {
        const b = paise(m.basis);
        days += Number(m.days);
        if (b <= 0n) continue;
        if (rule!.maxWage && b > paise(rule!.maxWage)) {
          high += 1;
          continue;
        }
        eligible += 1;
        wage += rule!.wageCap && b > paise(rule!.wageCap) ? paise(rule!.wageCap) : b;
      }
      let why = '';
      if (!eligible)
        why = high ? 'Basic + DA above the limit every month' : 'No month with basic and DA';
      else if (eligible < rule!.minMonths)
        why = `${String(eligible)} month(s): fewer than ${String(rule!.minMonths)}`;
      else if (days < Number(rule!.minDays))
        why = `${String(days)} day(s) worked: fewer than ${rule!.minDays}`;
      const half = (x: bigint) => ((x + 50n) / 100n) * 100n; // to the nearest rupee
      const bonus = why
        ? 0n
        : rule!.kind === 'FIXED'
          ? half(
              rule!.prorate ? (paise(rule!.amount) * BigInt(eligible)) / 12n : paise(rule!.amount),
            )
          : half((wage * BigInt(Math.round(Number(rule!.rate) * 1_000_000))) / 1_000_000n);
      const p = posted.get(id);
      rows.push({
        employee_id: id,
        code: first.code,
        name: first.name,
        designation: first.designation,
        months: ms.length,
        eligible,
        days,
        wage: rupees(wage),
        bonus: rupees(bonus),
        why,
        posted: p ? `${monthWords(p.month)} (Rs. ${p.amount})` : '',
        _bonus: rupees(bonus),
      });
    }
    return { rule: rule!, rows };
  }

  async bonusGrid(c: PoolClient, s: Scope, base: Base, fy: string): Promise<Grid> {
    const { rule, rows } = await this.bonusRows(c, s, fy);
    const columns: GridCol[] = [
      text('code', 'Emp. ID', 0.07),
      text('name', 'Employee', 0.15),
      text('designation', 'Designation', 0.1),
      num('months', 'Months paid'),
      num('eligible', 'Months counted'),
      num('days', 'Days'),
      money('wage', 'Wage counted'),
      money('bonus', 'Bonus'),
      text('why', 'Not due because', 0.16),
      text('posted', 'Posted', 0.1),
    ];
    const clean = rows.map(({ _bonus: _b, employee_id: _e, ...r }) => r);
    const ruleWords =
      rule.kind === 'FIXED'
        ? `Rs. ${rule.amount ?? ''} each${rule.prorate ? ', by the months counted' : ''}`
        : `${String(Math.round(Number(rule.rate) * 10000) / 100)} % of basic + DA${rule.wageCap ? ` (at most Rs. ${rule.wageCap} a month)` : ''}`;
    return {
      key: 'bonus',
      title: 'Bonus register',
      ...base,
      subtitle: [
        ...base.subtitle,
        `${rule.kind === 'STATUTORY' ? 'The Code on Wages’ formula' : 'The school’s rule'}: ${ruleWords}${
          rule.maxWage ? `; months with basic + DA above Rs. ${rule.maxWage} not counted` : ''
        }${rule.minMonths ? `; at least ${String(rule.minMonths)} month(s)` : ''}${Number(rule.minDays) ? `; at least ${rule.minDays} days` : ''}.`,
      ],
      columns,
      rows: clean,
      subtotals: [],
      total: clean.length
        ? {
            ...totalOf(columns, clean, `Total (${String(clean.length)})`),
            months: '',
            eligible: '',
            days: '',
          }
        : null,
    };
  }

  /** The year's bonus posted as one-off items of a month (once per employee); a dry run says what it would do. */
  async post(ctx: RequestContext, fy: string, month: string, dryRun: boolean) {
    must(ctx, RUN.approve, 'Only a payroll checker posts the bonus');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s: Scope = {
        from: '',
        to: '',
        runId: null,
        hidden: await hiddenFor(c, ctx),
        department: null,
        staffType: null,
        employeeId: null,
      };
      const { rule, rows } = await this.bonusRows(c, s, fy);
      const due = rows.filter((r) => paise(r._bonus) > 0n && !r.posted);
      const total = due.reduce((t, r) => t + paise(r._bonus), 0n);
      if (dryRun)
        return {
          dryRun: true,
          count: due.length,
          total: rupees(total),
          message: `${String(due.length)} bonus item(s) for ${monthWords(month)}, Rs. ${rupees(total)} in all.`,
        };
      if (!due.length) bad('Nothing to post: every bonus due is posted already', 409);
      const { locked } = await mustBeOpenForTopUp(c, month, 'the bonus');
      const head = (
        await c.query<{ id: string }>(`SELECT id::text FROM payroll_pay_heads WHERE code = 'BONUS'`)
      ).rows[0];
      if (!head) bad('The BONUS pay head is missing (open Payroll set-up once)', 409);
      for (const r of due)
        await c.query(
          `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, remarks, ref_module, ref_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, 'BONUS', $6, app.current_user_id(), app.current_user_id())`,
          [
            r.employee_id,
            firstOf(month),
            head!.id,
            r._bonus,
            `Bonus ${fy}`,
            `BONUS/${fy}/${r.employee_id}`,
          ],
        );
      await c.query(
        `INSERT INTO payroll_bonus_postings (school_id, fy, month, rule, posted, total, created_by)
         VALUES (app.current_school_id(), $1, $2::date, $3::jsonb, $4, $5, app.current_user_id())`,
        [fy, firstOf(month), JSON.stringify(rule), due.length, rupees(total)],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.bonus.post',
        entityType: 'payroll_bonus_postings',
        entityId: fy,
        after: { month, count: due.length, total: rupees(total) },
      });
      return {
        dryRun: false,
        count: due.length,
        total: rupees(total),
        message: locked
          ? `${String(due.length)} bonus item(s) posted to ${monthWords(month)}: make the month’s bonus run to pay them.`
          : `${String(due.length)} bonus item(s) posted to ${monthWords(month)}: the month’s run pays them (or a bonus run once it is locked).`,
      };
    });
  }
}
