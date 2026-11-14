import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { registerLetterhead } from '../exams/register-head';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';
import { preparedChecked } from '../leave/leave-report-file';
import { PayrollAnnualService } from './payroll-annual.service';
import { RUN } from './payroll-inputs.dto';
import { bad, has, hiddenFor, monthWords, must } from './payroll-month';
import {
  type Grid,
  type GridCol,
  type GridRow,
  gridCsv,
  gridPdf,
  gridXlsx,
  paise,
  rupees,
  subtotalsBy,
  totalOf,
} from './payroll-report-grid';
import {
  CATALOGUE,
  RECS,
  REGISTER_VIEWS,
  STAFF_TYPES,
  argsOf,
  prevMonth,
  provisionalIn,
  registerColumns,
  registerData,
  registerGrid,
  scopeLine,
  windowOf,
  type ReportDef,
  type ReportParams,
  type Scope,
} from './payroll-reports';
import { PayrollStatutoryService } from './payroll-statutory.service';
import { PAYROLL } from './payroll.dto';

export const AUDIT_VIEW = 'payroll.audit.view';
const money = (key: string, label: string): GridCol => ({ key, label, kind: 'money' });
const num = (key: string, label: string): GridCol => ({ key, label, kind: 'number', width: 0.05 });
const text = (key: string, label: string, width = 0.12): GridCol => ({
  key,
  label,
  kind: 'text',
  width,
});
const emp: GridCol[] = [text('code', 'Emp. ID', 0.07), text('name', 'Employee', 0.15)];
const typeName = (t: string | null) => (t ? (STAFF_TYPES[t] ?? t) : 'Type not set');
const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';

/**
 * Payroll reports (docs/design/86, phase F): the catalogue, each report as one grid for the screen and every download,
 * saved column presets (one's own, or shared by a checker), and a record of who ran or downloaded what.
 */
@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly statutory: PayrollStatutoryService,
    private readonly annual: PayrollAnnualService,
  ) {}

  /** a checker's reports also open to the payroll admin and the auditor */
  private checker(ctx: RequestContext) {
    return has(ctx, RUN.approve) || has(ctx, PAYROLL.admin) || has(ctx, AUDIT_VIEW);
  }

  async catalogue(ctx: RequestContext) {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    const mine = CATALOGUE.filter((d) => !d.checker || this.checker(ctx));
    return {
      reports: mine,
      groups: [...new Set(mine.map((d) => d.group))],
      can: {
        sharePresets: has(ctx, RUN.approve) || has(ctx, PAYROLL.admin),
        bonusPost: has(ctx, RUN.approve),
      },
    };
  }

  /** The filter choices of a month: its runs, departments, staff types and staff (confidential staff hidden). */
  async options(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s: Scope = {
        from: `${month}-01`,
        to: `${month}-01`,
        runId: null,
        hidden: await hiddenFor(c, ctx),
        department: null,
        staffType: null,
        employeeId: null,
      };
      const rows = (
        await c.query<{
          employee_id: string;
          code: string;
          name: string;
          department: string | null;
          staff_type: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
          `WITH ${RECS} SELECT p.employee_id::text, p.code, p.name, p.department, p.staff_type FROM people p ORDER BY p.name`,
          argsOf(s),
        )
      ).rows;
      const runs = (
        await c.query<{ id: string; run_type: string; seq: number; stage: string }>(
          `SELECT id::text, run_type, seq, stage FROM payroll_runs WHERE month = $1::date AND deleted_at IS NULL
              AND stage IN ('APPROVED', 'LOCKED', 'PAID') ORDER BY run_type <> 'REGULAR', run_type, seq`,
          [`${month}-01`],
        )
      ).rows;
      return {
        runs: runs.map((r) => ({
          id: r.id,
          label: `${r.run_type.toLowerCase()} ${String(r.seq)} · ${r.stage.toLowerCase()}`,
        })),
        departments: [
          ...new Set(rows.map((r) => r.department).filter((d): d is string => !!d)),
        ].sort(),
        staffTypes: [...new Set(rows.map((r) => r.staff_type).filter((d): d is string => !!d))].map(
          (t) => ({
            id: t,
            label: typeName(t),
          }),
        ),
        employees: rows.map((r) => ({ id: r.employee_id, label: `${r.code} · ${r.name}` })),
      };
    });
  }

  private def(ctx: RequestContext, key: string): ReportDef {
    const d = CATALOGUE.find((x) => x.key === key);
    if (!d) bad('No such report', 404);
    if (d!.checker && !this.checker(ctx)) bad('That report is for payroll checkers', 403);
    return d!;
  }

  private checkPeriod(d: ReportDef, p: ReportParams) {
    if (d.period === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month ?? ''))
      bad('Choose the month');
    if (d.period === 'fy' && !/^\d{4}-\d{2}$/.test(p.fy ?? '')) bad('Choose the financial year');
    if (d.period === 'asof' && !/^\d{4}-\d{2}-\d{2}$/.test(p.asOf ?? '')) bad('Choose the date');
  }

  /** The report, as one grid. */
  async run(ctx: RequestContext, key: string, p: ReportParams): Promise<Grid> {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    const d = this.def(ctx, key);
    this.checkPeriod(d, p);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.build(c, ctx, d, p);
      await this.audit.stage(ctx, c, {
        action: 'payroll.report.view',
        entityType: 'payroll_reports',
        entityId: key,
        after: { params: p, rows: g.rows.length },
      });
      return g;
    });
  }

  /** The same grid as a file. */
  async file(ctx: RequestContext, key: string, p: ReportParams, format: 'xlsx' | 'pdf' | 'csv') {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    const d = this.def(ctx, key);
    this.checkPeriod(d, p);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await this.build(c, ctx, d, p);
      const head = await this.head(c);
      const name = `${g.title.replace(/\W+/g, '_')}_${g.period.replace(/\W+/g, '_')}`.replace(
        /_+/g,
        '_',
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.report.download',
        entityType: 'payroll_reports',
        entityId: key,
        after: { params: p, format, rows: g.rows.length },
      });
      if (format === 'pdf')
        return {
          filename: `${name}.pdf`,
          contentType: 'application/pdf',
          base64: (
            await gridPdf(g, head, await preparedChecked(c, (k) => this.storage.read(k)))
          ).toString('base64'),
        };
      if (format === 'csv')
        return {
          filename: `${name}.csv`,
          contentType: 'text/csv; charset=utf-8',
          base64: Buffer.from(gridCsv(g, head.school), 'utf8').toString('base64'),
        };
      return {
        filename: `${name}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: (await gridXlsx(g, head.school)).toString('base64'),
      };
    });
  }

  async head(c: PoolClient) {
    const h = await registerLetterhead(c);
    let logo: LetterheadLogo | null = null;
    if (h.file)
      try {
        logo = {
          contentType: h.file.content_type,
          bytes: await this.storage.read(h.file.object_key),
        };
      } catch {
        logo = null;
      }
    return { school: h.school, address: h.address, logo };
  }

  /** Every report in one place: the scope, the PROVISIONAL line, the filters line, then the report's own grid. */
  async build(c: PoolClient, ctx: RequestContext, d: ReportDef, p: ReportParams): Promise<Grid> {
    const w = windowOf(d, p);
    const s: Scope = {
      from: w.from,
      to: w.to,
      runId: d.filters.includes('run') && p.runId ? p.runId : null,
      hidden: await hiddenFor(c, ctx),
      department: d.filters.includes('department') ? (p.department ?? null) : null,
      staffType: d.filters.includes('staffType') ? (p.staffType ?? null) : null,
      employeeId: d.filters.includes('employee') ? (p.employeeId ?? null) : null,
    };
    if (s.employeeId && s.hidden.includes(s.employeeId)) bad('Employee not found', 404);
    const names = {
      run: s.runId
        ? ((
            await c.query<{ l: string }>(
              `SELECT run_type || ' run ' || seq AS l FROM payroll_runs WHERE id = $1`,
              [s.runId],
            )
          ).rows[0]?.l ?? undefined)
        : undefined,
      employee: s.employeeId
        ? ((
            await c.query<{ l: string }>(
              `SELECT employee_code || ' · ' || display_name AS l FROM employees WHERE id = $1`,
              [s.employeeId],
            )
          ).rows[0]?.l ?? undefined)
        : undefined,
    };
    const base = {
      period: w.words,
      subtitle: scopeLine(
        { ...p, department: s.department ?? undefined, staffType: s.staffType ?? undefined },
        names,
      ),
      provisional:
        d.period === 'month' || d.period === 'fy' ? await provisionalIn(c, w.from, w.to) : null,
    };
    switch (d.key) {
      case 'register':
        return registerGrid(base, await registerData(c, s), p);
      case 'group':
        return this.group(c, s, base, p);
      case 'heads':
        return this.heads(c, s, base);
      case 'ytd':
        return this.ytd(c, s, base);
      case 'attendance':
        return this.attendance(c, s, base);
      case 'arrears':
        return this.arrears(c, s, base);
      case 'ctc':
        return this.ctc(c, s, base);
      case 'variance':
        return this.variance(c, s, base, p);
      case 'headcount':
        return this.headcount(c, s, base, p.month!);
      case 'tds':
        return this.tds(c, s, base);
      case 'pf':
      case 'esi':
      case 'pt':
      case 'lwf':
        return this.statutoryGrid(ctx, d.key, p.month!);
      case 'nps':
        return this.nps(c, s, base);
      case 'esi_coverage':
        return this.esiCoverage(c, s, base);
      case 'gratuity':
        return this.annual.liability(c, s, base, p.asOf!);
      case 'bonus':
        return this.annual.bonusGrid(c, s, base, p.fy!);
      case 'bank':
        return this.bank(c, s, base);
      case 'loans':
        return this.loans(c, s, base);
      default:
        return this.thirdParty(c, s, base);
    }
  }

  // ---- summaries ---------------------------------------------------------------------------------------------------------
  private async group(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
    p: ReportParams,
  ) {
    const by = ['department', 'designation', 'staff_type', 'category'].includes(p.groupBy ?? '')
      ? p.groupBy!
      : 'department';
    const data = await registerData(c, s);
    const label = {
      department: 'Department',
      designation: 'Designation',
      staff_type: 'Staff type',
      category: 'Category',
    }[by]!;
    const groups = new Map<string, GridRow[]>();
    for (const r of data.rows) {
      const k = String(r[by] ?? '') || '(not set)';
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const heads = registerColumns(data.heads).filter((col) => col.key.startsWith('h:'));
    const columns: GridCol[] = [
      text('group', label, 0.16),
      num('staff', 'Staff'),
      ...heads,
      money('gross', 'Gross'),
      money('deductions', 'Deductions'),
      money('net', 'Net'),
    ];
    const rows = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
      .map(([k, rs]) => {
        const t = totalOf(columns, rs);
        return { ...t, group: k, staff: rs.length };
      });
    return {
      key: 'group',
      title: `Pay by ${label.toLowerCase()}`,
      ...base,
      columns,
      rows,
      subtotals: [],
      total: rows.length ? totalOf(columns, rows) : null,
      note: 'A group of one shows that person’s pay.',
    } satisfies Grid;
  }

  private async heads(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<{
        code: string;
        name: string;
        head_type: string;
        category: string | null;
        staff: number;
        amount: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT l.code, max(l.name) AS name, max(l.head_type) AS head_type, max(h.category) AS category,
                count(DISTINCT r.employee_id)::int AS staff, sum(l.amount)::text AS amount
           FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id LEFT JOIN payroll_pay_heads h ON h.id = l.pay_head_id
          GROUP BY l.code HAVING sum(l.amount) <> 0
          ORDER BY max(l.head_type) = 'DEDUCTION', min(l.print_order), l.code`,
        argsOf(s),
      )
    ).rows.map((r) => ({ ...r, kind: r.head_type === 'DEDUCTION' ? 'Deduction' : 'Earning' }));
    const columns: GridCol[] = [
      text('code', 'Code', 0.08),
      text('name', 'Pay head', 0.22),
      text('kind', 'Type', 0.1),
      text('category', 'Category', 0.1),
      num('staff', 'Staff'),
      money('amount', 'Amount'),
    ];
    const earn = rows.filter((r) => r.kind === 'Earning');
    const ded = rows.filter((r) => r.kind === 'Deduction');
    return {
      key: 'heads',
      title: 'Head-wise summary',
      ...base,
      columns,
      rows,
      subtotals: [
        { label: 'Earnings', row: { ...totalOf(columns, earn, 'Earnings'), staff: '' } },
        { label: 'Deductions', row: { ...totalOf(columns, ded, 'Deductions'), staff: '' } },
      ],
      total: rows.length
        ? {
            code: 'Net',
            name: '',
            kind: '',
            category: '',
            staff: '',
            amount: rupees(
              earn.reduce((t, r) => t + paise(r.amount), 0n) -
                ded.reduce((t, r) => t + paise(r.amount), 0n),
            ),
          }
        : null,
    } satisfies Grid;
  }

  private async ytd(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}, ln AS (
           SELECT r.employee_id,
                  sum(l.amount) FILTER (WHERE l.code IN ('PF', 'VPF')) AS pf,
                  sum(l.amount) FILTER (WHERE l.code = 'ESI') AS esi
             FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id GROUP BY r.employee_id)
         SELECT p.code, p.name, p.designation, p.staff_type, count(DISTINCT r.month)::int AS months,
                sum(r.gross_earned)::text AS gross, COALESCE(max(ln.pf), 0)::text AS pf, COALESCE(max(ln.esi), 0)::text AS esi,
                sum(r.pt_amount)::text AS pt, sum(r.it_amount + r.cess_amount)::text AS tds,
                (sum(r.total_deductions) - COALESCE(max(ln.pf), 0) - COALESCE(max(ln.esi), 0) - sum(r.pt_amount)
                  - sum(r.it_amount + r.cess_amount))::text AS other, sum(r.net_pay)::text AS net
           FROM recs r JOIN people p ON p.employee_id = r.employee_id LEFT JOIN ln ON ln.employee_id = r.employee_id
          GROUP BY p.code, p.name, p.designation, p.staff_type ORDER BY p.name`,
        argsOf(s),
      )
    ).rows.map((r) => ({ ...r, staff_type: typeName(r.staff_type as string | null) }));
    const columns: GridCol[] = [
      ...emp,
      text('designation', 'Designation', 0.1),
      num('months', 'Months'),
      money('gross', 'Gross'),
      money('pf', 'PF'),
      money('esi', 'ESI'),
      money('pt', 'Profession tax'),
      money('tds', 'Income tax'),
      money('other', 'Other deductions'),
      money('net', 'Net'),
    ];
    return {
      key: 'ytd',
      title: 'Year to date',
      ...base,
      columns,
      rows,
      subtotals: subtotalsBy(columns, rows, 'staff_type', (t) => t),
      total: rows.length ? totalOf(columns, rows, `Total (${String(rows.length)})`) : null,
    } satisfies Grid;
  }

  private async attendance(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT p.code, p.name, p.designation, a.present_days::text AS present, a.paid_leave_days::text AS leave,
                a.lop_days::text AS lop, a.ot_hours::text AS ot, max(r.paid_days) FILTER (WHERE NOT r.is_top_up)::text AS paid,
                max(r.month_days) FILTER (WHERE NOT r.is_top_up)::text AS days, sum(r.lop_amount)::text AS lop_amount,
                sum(r.gross_earned)::text AS gross, sum(r.net_pay)::text AS net
           FROM recs r JOIN people p ON p.employee_id = r.employee_id
           LEFT JOIN payroll_attendance a ON a.employee_id = r.employee_id AND a.month = r.month
          GROUP BY p.code, p.name, p.designation, a.present_days, a.paid_leave_days, a.lop_days, a.ot_hours ORDER BY p.name`,
        argsOf(s),
      )
    ).rows;
    const columns: GridCol[] = [
      ...emp,
      text('designation', 'Designation', 0.1),
      num('days', 'Month days'),
      num('present', 'Present'),
      num('leave', 'Paid leave'),
      num('lop', 'LOP days'),
      num('paid', 'Days paid'),
      num('ot', 'OT hours'),
      money('lop_amount', 'LOP amount'),
      money('gross', 'Gross'),
      money('net', 'Net'),
    ];
    return {
      key: 'attendance',
      title: 'Attendance and salary',
      ...base,
      columns,
      rows,
      subtotals: [],
      total: rows.length ? totalOf(columns, rows) : null,
    } satisfies Grid;
  }

  private async arrears(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT p.code, p.name, to_char(a.period_month, 'YYYY-MM') AS of_month, h.code AS head, h.name AS head_name,
                CASE a.source WHEN 'REVISION' THEN 'Pay revision' WHEN 'LOP_REVERSAL' THEN 'Loss of pay given back' ELSE initcap(lower(a.source)) END AS why,
                a.amount::text AS amount
           FROM payroll_arrears a JOIN recs r ON r.id = a.paid_in_record_id JOIN people p ON p.employee_id = r.employee_id
           JOIN payroll_pay_heads h ON h.id = a.pay_head_id
          WHERE a.cancelled_at IS NULL
          ORDER BY p.name, a.period_month, h.code`,
        argsOf(s),
      )
    ).rows.map((r) => ({ ...r, of_month: monthWords(String(r.of_month)) }));
    const columns: GridCol[] = [
      ...emp,
      text('of_month', 'For the month', 0.1),
      text('head', 'Head', 0.06),
      text('head_name', 'Pay head', 0.14),
      text('why', 'Why', 0.14),
      money('amount', 'Arrear'),
    ];
    return {
      key: 'arrears',
      title: 'Arrears paid',
      ...base,
      columns,
      rows,
      subtotals: subtotalsBy(columns, rows, 'why', (t) => t),
      total: rows.length ? totalOf(columns, rows) : null,
    } satisfies Grid;
  }

  private async ctc(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT p.code, p.name, p.designation, p.staff_type, sum(r.gross_earned)::text AS gross,
                COALESCE(sum(st.er_epf), 0)::text AS epf, COALESCE(sum(st.er_eps), 0)::text AS eps,
                COALESCE(sum(COALESCE(st.edli, 0) + COALESCE(st.pf_admin, 0)), 0)::text AS edli, COALESCE(sum(st.esi_er), 0)::text AS esi,
                COALESCE(sum(st.nps_er), 0)::text AS nps, COALESCE(sum(st.lwf_er), 0)::text AS lwf,
                (sum(r.gross_earned) + COALESCE(sum(COALESCE(st.er_epf, 0) + COALESCE(st.er_eps, 0) + COALESCE(st.edli, 0) + COALESCE(st.pf_admin, 0) + COALESCE(st.esi_er, 0) + COALESCE(st.nps_er, 0) + COALESCE(st.lwf_er, 0)), 0))::text AS ctc
           FROM recs r JOIN people p ON p.employee_id = r.employee_id LEFT JOIN payroll_record_statutory st ON st.record_id = r.id
          GROUP BY p.code, p.name, p.designation, p.staff_type ORDER BY p.name`,
        argsOf(s),
      )
    ).rows.map((r) => ({ ...r, staff_type: typeName(r.staff_type as string | null) }));
    const columns: GridCol[] = [
      ...emp,
      text('designation', 'Designation', 0.1),
      money('gross', 'Gross'),
      money('epf', 'Employer EPF'),
      money('eps', 'Employer EPS'),
      money('edli', 'EDLI and admin'),
      money('esi', 'Employer ESI'),
      money('nps', 'Employer NPS'),
      money('lwf', 'Employer LWF'),
      money('ctc', 'Cost to school'),
    ];
    return {
      key: 'ctc',
      title: 'Cost to school',
      ...base,
      columns,
      rows,
      subtotals: subtotalsBy(columns, rows, 'staff_type', (t) => t),
      total: rows.length ? totalOf(columns, rows) : null,
      note: 'Gratuity is not in it: see the gratuity liability.',
    } satisfies Grid;
  }

  private async variance(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
    p: ReportParams,
  ) {
    const prev = prevMonth(p.month!);
    const atLeast = paise(p.threshold ?? '1');
    const read = async (m: string) =>
      (
        await c.query<{
          employee_id: string;
          code: string;
          name: string;
          head: string;
          head_name: string;
          amount: string;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
          `WITH ${RECS}
           SELECT p.employee_id::text, p.code, p.name, l.code AS head, max(l.name) AS head_name, sum(l.amount)::text AS amount
             FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id JOIN people p ON p.employee_id = r.employee_id
            GROUP BY p.employee_id, p.code, p.name, l.code
           UNION ALL
           SELECT p.employee_id::text, p.code, p.name, '~NET', 'Net pay', sum(r.net_pay)::text
             FROM recs r JOIN people p ON p.employee_id = r.employee_id GROUP BY p.employee_id, p.code, p.name`,
          argsOf({ ...s, from: `${m}-01`, to: `${m}-01` }),
        )
      ).rows;
    const now = await read(p.month!);
    const before = await read(prev);
    const map = new Map<
      string,
      { code: string; name: string; head: string; head_name: string; a: bigint; b: bigint }
    >();
    for (const [rows, side] of [
      [before, 'b'],
      [now, 'a'],
    ] as const)
      for (const r of rows) {
        const k = `${r.employee_id}|${r.head}`;
        const x = map.get(k) ?? {
          code: r.code,
          name: r.name,
          head: r.head,
          head_name: r.head_name,
          a: 0n,
          b: 0n,
        };
        x[side] += paise(r.amount);
        map.set(k, x);
      }
    const rows = [...map.values()]
      .filter((x) => x.a !== x.b && (x.a - x.b >= atLeast || x.b - x.a >= atLeast))
      .sort(
        (x, y) =>
          x.name.localeCompare(y.name) ||
          (x.head === '~NET' ? 1 : y.head === '~NET' ? -1 : x.head.localeCompare(y.head)),
      )
      .map((x) => ({
        code: x.code,
        name: x.name,
        head: x.head === '~NET' ? 'Net' : x.head,
        head_name: x.head_name,
        before: rupees(x.b),
        now: rupees(x.a),
        change: rupees(x.a - x.b),
        why: x.b === 0n ? 'New' : x.a === 0n ? 'Not paid now' : x.a > x.b ? 'Up' : 'Down',
      }));
    const columns: GridCol[] = [
      ...emp,
      text('head', 'Head', 0.06),
      text('head_name', 'Pay head', 0.16),
      money('before', monthWords(prev)),
      money('now', monthWords(p.month!)),
      money('change', 'Change'),
      text('why', '', 0.08),
    ];
    const nets = rows.filter((r) => r.head === 'Net');
    return {
      key: 'variance',
      title: 'Month-on-month variance',
      ...base,
      period: `${monthWords(prev)} → ${monthWords(p.month!)}`,
      subtitle: [...base.subtitle, `Changes of at least Rs. ${rupees(atLeast)}`],
      columns,
      rows,
      subtotals: [],
      total: nets.length
        ? { ...totalOf(columns, nets, 'Net pay, all staff'), head: '', head_name: '', why: '' }
        : null,
    } satisfies Grid;
  }

  private async headcount(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
    month: string,
  ) {
    const paidIn = async (m: string) =>
      new Map(
        (
          await c.query<{ employee_id: string; code: string; name: string; net: string }>(
            // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
            `WITH ${RECS} SELECT p.employee_id::text, p.code, p.name, sum(r.net_pay)::text AS net
               FROM recs r JOIN people p ON p.employee_id = r.employee_id GROUP BY p.employee_id, p.code, p.name`,
            argsOf({ ...s, runId: null, from: `${m}-01`, to: `${m}-01` }),
          )
        ).rows.map((r) => [r.employee_id, r]),
      );
    const prev = prevMonth(month);
    const now = await paidIn(month);
    const before = await paidIn(prev);
    const ids = [...new Set([...now.keys(), ...before.keys()])];
    const info = new Map(
      (
        await c.query<{
          id: string;
          joined_on: string | null;
          left_on: string | null;
          hold: string | null;
        }>(
          `SELECT e.id::text, e.joined_on::text, e.left_on::text,
                  (SELECT h.mode FROM payroll_holds h WHERE h.employee_id = e.id AND h.month = $2::date AND h.active LIMIT 1) AS hold
             FROM employees e WHERE e.id = ANY($1::bigint[])`,
          [ids, `${month}-01`],
        )
      ).rows.map((r) => [r.id, r]),
    );
    const rows: GridRow[] = [];
    for (const id of ids) {
      const a = now.get(id);
      const b = before.get(id);
      if (a && b) continue;
      const x = info.get(id);
      const who = (a ?? b)!;
      const why = a
        ? x?.joined_on && x.joined_on.slice(0, 7) >= prev
          ? `Joined ${dmy(x.joined_on)}`
          : 'Not paid last month (held or skipped then)'
        : x?.left_on && x.left_on.slice(0, 7) <= month
          ? `Left ${dmy(x.left_on)}`
          : x?.hold
            ? x.hold === 'SKIP'
              ? 'Skipped this month'
              : 'Salary held'
            : 'No pay this month yet';
      rows.push({
        code: who.code,
        name: who.name,
        status: a ? 'New this month' : 'Not paid this month',
        why,
        before: b?.net ?? '0.00',
        now: a?.net ?? '0.00',
      });
    }
    rows.sort(
      (x, y) =>
        String(x.status).localeCompare(String(y.status)) ||
        String(x.name).localeCompare(String(y.name)),
    );
    const both = [...now.keys()].filter((k) => before.has(k)).length;
    const columns: GridCol[] = [
      ...emp,
      text('status', 'Status', 0.12),
      text('why', 'Why', 0.2),
      money('before', `Net ${monthWords(prev)}`),
      money('now', `Net ${monthWords(month)}`),
    ];
    return {
      key: 'headcount',
      title: 'Headcount reconciliation',
      ...base,
      subtitle: [
        ...base.subtitle,
        `Paid in ${monthWords(prev)}: ${String(before.size)} · paid in both months: ${String(both)} · new: ${String(now.size - both)} · not paid now: ${String(before.size - both)} · paid in ${monthWords(month)}: ${String(now.size)}`,
      ],
      columns,
      rows,
      subtotals: subtotalsBy(columns, rows, 'status', (t) => t),
      total: null,
    } satisfies Grid;
  }

  // ---- statutory ---------------------------------------------------------------------------------------------------------
  private async tds(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT p.code, p.name, p.pan_masked AS pan, initcap(lower(p.tax_regime)) AS regime, sum(r.gross_earned)::text AS gross,
                sum(r.it_amount)::text AS it, sum(r.cess_amount)::text AS cess, sum(r.it_amount + r.cess_amount)::text AS tds
           FROM recs r JOIN people p ON p.employee_id = r.employee_id
          GROUP BY p.code, p.name, p.pan_masked, p.tax_regime HAVING sum(r.it_amount + r.cess_amount) > 0 ORDER BY p.name`,
        argsOf(s),
      )
    ).rows;
    const columns: GridCol[] = [
      ...emp,
      text('pan', 'PAN', 0.09),
      text('regime', 'Regime', 0.06),
      money('gross', 'Gross'),
      money('it', 'Income tax'),
      money('cess', 'Cess'),
      money('tds', 'TDS'),
    ];
    return {
      key: 'tds',
      title: 'Income tax (TDS) register',
      ...base,
      columns,
      rows,
      subtotals: [],
      total: rows.length ? totalOf(columns, rows) : null,
      note: 'The year’s working is in Income tax; the quarterly return and challans there too.',
    } satisfies Grid;
  }

  /** The PF, ESI, PT and LWF registers of phase C, as grids. */
  private async statutoryGrid(
    ctx: RequestContext,
    kind: 'pf' | 'esi' | 'pt' | 'lwf',
    month: string,
  ): Promise<Grid> {
    const t = await this.statutory.registerTable(ctx, month, kind);
    const columns: GridCol[] = t.columns.map((col, i) => ({
      key: `c${String(i)}`,
      label: col.label,
      kind: col.number
        ? /days|members|staff|count/i.test(col.label)
          ? 'number'
          : 'money'
        : 'text',
      width: col.width,
    }));
    const obj = (r: Array<string | number | null>) =>
      Object.fromEntries(r.map((v, i) => [`c${String(i)}`, v ?? '']));
    return {
      key: kind,
      title: t.title.split(' — ')[0]!,
      period: monthWords(month),
      subtitle: t.details,
      columns,
      rows: t.rows.map(obj),
      subtotals: [],
      total: obj(t.total),
      provisional: t.provisional
        ? 'PROVISIONAL — an approved run of the month is not locked yet: these figures may still change.'
        : null,
      after: t.after?.map((a) => ({
        title: a.title,
        columns: a.columns.map((col, i) => ({
          key: `c${String(i)}`,
          label: col.label,
          kind: col.right ? 'money' : 'text',
        })),
        rows: a.rows.map((r) => obj(r as Array<string | number | null>)),
      })),
    };
  }

  private async nps(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT p.code, p.name, sum(st.nps_wage)::text AS wage, sum(st.nps_ee)::text AS ee, sum(st.nps_er)::text AS er,
                sum(st.nps_ee + st.nps_er)::text AS total
           FROM recs r JOIN people p ON p.employee_id = r.employee_id JOIN payroll_record_statutory st ON st.record_id = r.id
          GROUP BY p.code, p.name HAVING sum(st.nps_ee + st.nps_er) > 0 ORDER BY p.name`,
        argsOf(s),
      )
    ).rows;
    const columns: GridCol[] = [
      ...emp,
      money('wage', 'NPS wage'),
      money('ee', 'Employee'),
      money('er', 'Employer'),
      money('total', 'Total'),
    ];
    return {
      key: 'nps',
      title: 'NPS register',
      ...base,
      columns,
      rows,
      subtotals: [],
      total: rows.length ? totalOf(columns, rows) : null,
    } satisfies Grid;
  }

  private async esiCoverage(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        `SELECT e.employee_code AS code, e.display_name AS name, to_char(v.period_start, 'YYYY-MM-DD') AS start,
                CASE WHEN v.covered THEN 'Covered' ELSE 'Not covered' END AS covered, v.wage_at_start::text AS wage
           FROM payroll_esi_coverage v JOIN employees e ON e.id = v.employee_id
          WHERE NOT (v.employee_id::text = ANY($1::text[])) AND ($2::bigint IS NULL OR v.employee_id = $2)
          ORDER BY e.display_name, v.period_start DESC`,
        [s.hidden, s.employeeId],
      )
    ).rows.map((r) => ({ ...r, start: dmy(String(r.start)) }));
    const columns: GridCol[] = [
      ...emp,
      text('start', 'Period from', 0.1),
      text('covered', 'Covered', 0.1),
      money('wage', 'Wage at the start'),
    ];
    return {
      key: 'esi_coverage',
      title: 'ESI coverage',
      ...base,
      columns,
      rows,
      subtotals: [],
      total: null,
    } satisfies Grid;
  }

  // ---- payments ----------------------------------------------------------------------------------------------------------
  private async bank(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT p.code, p.name, r.pay_mode AS mode, COALESCE(r.bank_name, '') AS bank, r.bank_ifsc AS ifsc,
                r.bank_account_masked AS account, r.net_pay::text AS net,
                CASE WHEN r.status = 'HELD' THEN 'Held' WHEN r.paid_at IS NOT NULL THEN 'Paid' ELSE '' END AS paid,
                b.seq::text AS file, b.status AS file_status, b.utr
           FROM recs r JOIN people p ON p.employee_id = r.employee_id
           LEFT JOIN LATERAL (SELECT bb.seq, bb.status, bb.utr FROM payroll_bank_batch_lines bl
                                JOIN payroll_bank_batches bb ON bb.id = bl.batch_id
                               WHERE bl.record_id = r.id ORDER BY bb.id DESC LIMIT 1) b ON true
          WHERE r.net_pay > 0
          ORDER BY r.pay_mode, COALESCE(r.bank_name, ''), p.name`,
        argsOf(s),
      )
    ).rows;
    const columns: GridCol[] = [
      ...emp,
      text('mode', 'Mode', 0.05),
      text('bank', 'Bank', 0.12),
      text('ifsc', 'IFSC', 0.08),
      text('account', 'Account', 0.09),
      money('net', 'Net'),
      text('paid', 'Paid', 0.05),
      text('file', 'Bank file', 0.05),
      text('file_status', 'File status', 0.07),
      text('utr', 'UTR', 0.1),
    ];
    const banks = new Map<string, { staff: number; net: bigint }>();
    for (const r of rows) {
      const k = `${String(r.mode)}|${String(r.bank) || '—'}`;
      const x = banks.get(k) ?? { staff: 0, net: 0n };
      x.staff += 1;
      x.net += paise(r.net);
      banks.set(k, x);
    }
    return {
      key: 'bank',
      title: 'Bank-wise payments',
      ...base,
      columns,
      rows,
      subtotals: [],
      total: rows.length ? totalOf(columns, rows) : null,
      after: [
        {
          title: 'By bank',
          columns: [
            text('mode', 'Mode', 0.1),
            text('bank', 'Bank', 0.3),
            num('staff', 'Staff'),
            money('net', 'Net'),
          ],
          rows: [...banks.entries()].map(([k, v]) => ({
            mode: k.split('|')[0]!,
            bank: k.split('|')[1]!,
            staff: v.staff,
            net: rupees(v.net),
          })),
        },
      ],
    } satisfies Grid;
  }

  private async loans(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        `SELECT e.employee_code AS code, e.display_name AS name, l.loan_type AS type, l.principal::text AS principal,
                l.emi::text AS emi, to_char(l.start_month, 'YYYY-MM') AS start,
                (l.principal - l.balance)::text AS recovered, l.balance::text AS balance,
                CASE WHEN l.emi > 0 THEN ceil(l.balance / l.emi)::int ELSE NULL END AS months_left,
                initcap(lower(l.status)) AS status
           FROM payroll_loans l JOIN employees e ON e.id = l.employee_id
          WHERE l.status IN ('ACTIVE', 'HOLD') AND l.balance > 0
            AND NOT (l.employee_id::text = ANY($1::text[])) AND ($2::bigint IS NULL OR l.employee_id = $2)
            AND ($3::text IS NULL OR e.department = $3)
          ORDER BY e.display_name, l.start_month`,
        [s.hidden, s.employeeId, s.department],
      )
    ).rows.map((r) => ({ ...r, start: monthWords(String(r.start)) }));
    const columns: GridCol[] = [
      ...emp,
      text('type', 'Loan', 0.12),
      text('start', 'From', 0.09),
      money('principal', 'Amount'),
      money('emi', 'Instalment'),
      money('recovered', 'Recovered'),
      money('balance', 'Owed'),
      num('months_left', 'Months left'),
      text('status', 'Status', 0.06),
    ];
    return {
      key: 'loans',
      title: 'Loans outstanding',
      ...base,
      period: 'Today',
      provisional: null,
      columns,
      rows,
      subtotals: [],
      total: rows.length ? { ...totalOf(columns, rows), months_left: '' } : null,
    } satisfies Grid;
  }

  private async thirdParty(
    c: PoolClient,
    s: Scope,
    base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  ) {
    const rows = (
      await c.query<GridRow>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT COALESCE(y.name, '(no payee)') AS payee, COALESCE(y.party_type, '') AS party_type, COALESCE(y.payee_account, '') AS account,
                p.code, p.name, l.code AS head, rc.reference_no AS ref, sum(l.amount)::text AS amount
           FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id JOIN people p ON p.employee_id = r.employee_id
           JOIN payroll_recurring rc ON rc.id::text = l.source_id LEFT JOIN payroll_payees y ON y.id = rc.payee_id
          WHERE l.source_kind = 'recurring'
          GROUP BY y.name, y.party_type, y.payee_account, p.code, p.name, l.code, rc.reference_no
          ORDER BY COALESCE(y.name, '(no payee)'), p.name`,
        argsOf(s),
      )
    ).rows;
    const columns: GridCol[] = [
      text('payee', 'Payee', 0.16),
      ...emp,
      text('head', 'Head', 0.06),
      text('ref', 'Reference', 0.12),
      money('amount', 'Deducted'),
    ];
    return {
      key: 'third_party',
      title: 'Third-party payout',
      ...base,
      columns,
      rows,
      subtotals: subtotalsBy(columns, rows, 'payee', (t) => t),
      total: rows.length ? totalOf(columns, rows) : null,
      note: 'What the runs actually deducted (held, failed or unpaid salaries deduct nothing).',
    } satisfies Grid;
  }

  // ---- presets -----------------------------------------------------------------------------------------------------------
  async presets(ctx: RequestContext, report: string) {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      views: report === 'register' ? REGISTER_VIEWS : [],
      rows: (
        await c.query(
          `SELECT id::text, name, columns, owner_id IS NULL AS shared, (owner_id = app.current_user_id() OR (owner_id IS NULL AND $2)) AS mine
             FROM payroll_report_presets
            WHERE report_key = $1 AND deleted_at IS NULL AND (owner_id IS NULL OR owner_id = app.current_user_id())
            ORDER BY owner_id IS NULL, lower(name)`,
          [report, has(ctx, RUN.approve) || has(ctx, PAYROLL.admin)],
        )
      ).rows,
    }));
  }

  async savePreset(
    ctx: RequestContext,
    dto: { report: string; name: string; columns: string[]; shared: boolean },
  ) {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    if (dto.shared && !(has(ctx, RUN.approve) || has(ctx, PAYROLL.admin)))
      bad('Only a payroll checker shares a preset', 403);
    if (dto.report !== 'register') bad('Only the salary register keeps column presets');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_report_presets (school_id, report_key, name, columns, owner_id, created_by)
             VALUES (app.current_school_id(), $1, $2, $3::text[], CASE WHEN $4 THEN NULL ELSE app.current_user_id() END,
                     app.current_user_id()) RETURNING id::text`,
            [dto.report, dto.name, dto.columns, dto.shared],
          )
        ).rows[0]!.id;
        return { id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          bad('A preset of that name is already there', 409);
        throw e;
      }
    });
  }

  async deletePreset(ctx: RequestContext, id: string) {
    must(ctx, RUN.view, 'Only payroll staff run payroll reports');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE payroll_report_presets SET deleted_at = now(), deleted_by = app.current_user_id()
          WHERE id = $1 AND deleted_at IS NULL AND (owner_id = app.current_user_id() OR (owner_id IS NULL AND $2))`,
        [id, has(ctx, RUN.approve) || has(ctx, PAYROLL.admin)],
      );
      if (!r.rowCount) bad('Preset not found, or not yours to remove', 404);
      return { ok: true };
    });
  }
}
