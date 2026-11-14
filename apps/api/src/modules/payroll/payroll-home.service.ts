import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PayrollAnnualService } from './payroll-annual.service';
import { RUN } from './payroll-inputs.dto';
import { addMonths, has, hiddenFor, monthWords, must } from './payroll-month';
import { paise, rupees } from './payroll-report-grid';
import { RECS, argsOf, provisionalIn, type Scope } from './payroll-reports';
import { istToday } from './payroll-setup.service';
import { PAYROLL } from './payroll.dto';

const STATUTORY = ['PF', 'VPF', 'ESI', 'PT', 'TDS', 'LWF', 'NPS'];

/**
 * The payroll home (docs/design/86, phase F): a month's six figures first — cost to school, net paid, staff paid
 * (persons), the average cost, the statutory outgo, loss of pay — then the work waiting, then small charts. PROVISIONAL
 * while a run of the month is approved but not locked. Makers see it without the confidential staff.
 */
@Injectable()
export class PayrollHomeService {
  constructor(
    private readonly db: DbService,
    private readonly annual: PayrollAnnualService,
  ) {}

  private async sums(c: PoolClient, s: Scope) {
    const r = (
      await c.query<{
        gross: string;
        net: string;
        staff: number;
        lop_days: string;
        lop_amount: string;
        employer: string;
        statutory: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `WITH ${RECS}
         SELECT COALESCE(sum(r.gross_earned), 0)::text AS gross, COALESCE(sum(r.net_pay), 0)::text AS net,
                count(DISTINCT r.employee_id)::int AS staff,
                COALESCE(sum(r.lop_days) FILTER (WHERE NOT r.is_top_up), 0)::text AS lop_days,
                COALESCE(sum(r.lop_amount), 0)::text AS lop_amount,
                COALESCE((SELECT sum(COALESCE(st.er_epf, 0) + COALESCE(st.er_eps, 0) + COALESCE(st.edli, 0) + COALESCE(st.pf_admin, 0) + COALESCE(st.esi_er, 0) + COALESCE(st.nps_er, 0) + COALESCE(st.lwf_er, 0))
                            FROM payroll_record_statutory st WHERE st.record_id IN (SELECT id FROM recs)), 0)::text AS employer,
                COALESCE((SELECT sum(l.amount) FROM payroll_record_lines l
                           WHERE l.record_id IN (SELECT id FROM recs) AND l.head_type = 'DEDUCTION' AND l.code = ANY($8::text[])), 0)::text AS statutory
           FROM recs r`,
        [...argsOf(s), STATUTORY],
      )
    ).rows[0]!;
    return r;
  }

  async home(ctx: RequestContext, month?: string) {
    must(ctx, RUN.view, 'Only payroll staff see the payroll home');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const months = (
        await c.query<{ m: string; stage: string }>(
          `SELECT to_char(month, 'YYYY-MM') AS m,
                  CASE WHEN bool_or(stage = 'APPROVED') THEN 'PROVISIONAL' ELSE 'FINAL' END AS stage
             FROM payroll_runs WHERE stage IN ('APPROVED', 'LOCKED', 'PAID') AND deleted_at IS NULL
            GROUP BY month ORDER BY month DESC LIMIT 24`,
        )
      ).rows;
      const sel = months.find((m) => m.m === month)?.m ?? months[0]?.m ?? null;
      const scope = (m: string): Scope => ({
        from: `${m}-01`,
        to: `${m}-01`,
        runId: null,
        hidden,
        department: null,
        staffType: null,
        employeeId: null,
      });
      // the work waiting, of every month
      const work = (
        await c.query<{ k: string; n: number }>(
          `SELECT 'review' AS k, count(*)::int AS n FROM payroll_runs WHERE stage IN ('PROCESSING', 'REVIEW') AND deleted_at IS NULL
           UNION ALL SELECT 'lock', count(*)::int FROM payroll_runs WHERE stage = 'APPROVED' AND deleted_at IS NULL
           UNION ALL SELECT 'pay', count(*)::int FROM payroll_runs WHERE stage = 'LOCKED' AND deleted_at IS NULL
           UNION ALL SELECT 'settlements', count(*)::int FROM payroll_settlements WHERE status IN ('DRAFT', 'COMPUTED', 'APPROVED')
           UNION ALL SELECT 'revisions', count(*)::int FROM payroll_revisions WHERE status = 'DRAFT'
           UNION ALL SELECT 'declarations', count(*)::int FROM payroll_declarations WHERE status = 'SUBMITTED'
           UNION ALL SELECT 'drafts', ((SELECT count(*) FROM payroll_structures WHERE status = 'draft')
                + (SELECT count(*) FROM payroll_rates WHERE status = 'draft')
                + (SELECT count(*) FROM payroll_pay_head_versions WHERE status = 'draft'))::int
           UNION ALL SELECT 'overdue', count(*)::int FROM payroll_compliance WHERE done_at IS NULL AND due_on < $1::date
           UNION ALL SELECT 'due', count(*)::int FROM payroll_compliance WHERE done_at IS NULL AND due_on BETWEEN $1::date AND $1::date + 15`,
          [istToday()],
        )
      ).rows;
      const due = (
        await c.query<{ item: string; month: string; due_on: string }>(
          `SELECT item, to_char(month, 'YYYY-MM') AS month, due_on::text FROM payroll_compliance
            WHERE done_at IS NULL AND due_on <= $1::date + 15 ORDER BY due_on LIMIT 8`,
          [istToday()],
        )
      ).rows;
      let liability: { amount: string; due: number; staff: number } | null = null;
      try {
        const g = await this.annual.liability(
          c,
          scope(istToday().slice(0, 7)),
          { period: '', subtitle: [], provisional: null },
          istToday(),
        );
        liability = {
          amount: String(g.total?.payable ?? '0.00'),
          due: g.rows.filter((r) => r.due === 'Yes').length,
          staff: g.rows.length,
        };
      } catch {
        liability = null; // payroll not set up yet
      }
      if (!sel)
        return {
          months: [],
          month: null,
          provisional: null,
          figures: null,
          previous: null,
          work,
          due,
          liability,
          charts: null,
          can: this.can(ctx),
        };
      const now = await this.sums(c, scope(sel));
      const before = await this.sums(c, scope(addMonths(sel, -1)));
      const fig = (x: typeof now) => {
        const cost = paise(x.gross) + paise(x.employer);
        return {
          cost: rupees(cost),
          gross: x.gross,
          employer: x.employer,
          net: x.net,
          staff: x.staff,
          average: x.staff ? rupees(cost / BigInt(x.staff)) : '0.00',
          statutory: rupees(paise(x.statutory) + paise(x.employer)),
          statutoryStaff: x.statutory,
          lopDays: x.lop_days,
          lopAmount: x.lop_amount,
        };
      };
      // twelve months to the one shown
      const trend = [];
      for (let i = 11; i >= 0; i -= 1) {
        const m = addMonths(sel, -i);
        const x = await this.sums(c, scope(m));
        trend.push({
          month: m,
          label: monthWords(m),
          gross: x.gross,
          net: x.net,
          employer: x.employer,
          staff: x.staff,
        });
      }
      const args = argsOf(scope(sel));
      const byDept = (
        await c.query<{ k: string; staff: number; gross: string }>(
          // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
          `WITH ${RECS} SELECT COALESCE(NULLIF(p.department, ''), 'Not set') AS k, count(DISTINCT r.employee_id)::int AS staff,
                  sum(r.gross_earned)::text AS gross
             FROM recs r JOIN people p ON p.employee_id = r.employee_id GROUP BY 1 ORDER BY sum(r.gross_earned) DESC`,
          args,
        )
      ).rows;
      const mix = async (type: 'EARNING' | 'DEDUCTION') =>
        (
          await c.query<{ k: string; amount: string }>(
            // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
            `WITH ${RECS} SELECT max(l.name) AS k, sum(l.amount)::text AS amount
               FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id WHERE l.head_type = $8
              GROUP BY l.code HAVING sum(l.amount) > 0 ORDER BY sum(l.amount) DESC`,
            [...args, type],
          )
        ).rows;
      const bands = (
        await c.query<{ k: string; staff: number }>(
          // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
          `WITH ${RECS}, g AS (SELECT employee_id, sum(gross_earned) AS gross FROM recs GROUP BY employee_id)
           SELECT CASE WHEN gross < 25000 THEN '1|Below 25,000' WHEN gross < 50000 THEN '2|25,000–50,000'
                       WHEN gross < 100000 THEN '3|50,000–1 lakh' WHEN gross < 200000 THEN '4|1–2 lakh' ELSE '5|2 lakh and above' END AS k,
                  count(*)::int AS staff
             FROM g GROUP BY 1 ORDER BY 1`,
          args,
        )
      ).rows.map((b) => ({ k: b.k.split('|')[1]!, staff: b.staff }));
      const top = <T extends { k: string }>(rows: T[], n: number, sum: (a: T[]) => T) =>
        rows.length > n ? [...rows.slice(0, n), sum(rows.slice(n))] : rows;
      return {
        months: months.map((m) => ({
          month: m.m,
          label: monthWords(m.m),
          provisional: m.stage === 'PROVISIONAL',
        })),
        month: sel,
        provisional: await provisionalIn(c, `${sel}-01`, `${sel}-01`),
        figures: fig(now),
        previous: { month: addMonths(sel, -1), ...fig(before) },
        work,
        due,
        liability,
        charts: {
          trend,
          byDepartment: top(byDept, 8, (rest) => ({
            k: `Other (${String(rest.length)})`,
            staff: rest.reduce((t, r) => t + r.staff, 0),
            gross: rupees(rest.reduce((t, r) => t + paise(r.gross), 0n)),
          })),
          earnings: top(await mix('EARNING'), 7, (rest) => ({
            k: 'Other',
            amount: rupees(rest.reduce((t, r) => t + paise(r.amount), 0n)),
          })),
          deductions: top(await mix('DEDUCTION'), 7, (rest) => ({
            k: 'Other',
            amount: rupees(rest.reduce((t, r) => t + paise(r.amount), 0n)),
          })),
          bands,
        },
        can: this.can(ctx),
      };
    });
  }

  private can(ctx: RequestContext) {
    return {
      approve: has(ctx, RUN.approve),
      manage: has(ctx, RUN.manage),
      admin: has(ctx, PAYROLL.admin),
      audit: has(ctx, 'payroll.audit.view'),
    };
  }
}
