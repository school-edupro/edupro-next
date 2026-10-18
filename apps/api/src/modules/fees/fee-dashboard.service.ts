import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

export type DashLedger = 'all' | 'school' | 'hostel' | 'misc';
/** how the year is cut for projection vs collection: quarters (default), months or the fee terms */
export type DashBy = 'quarter' | 'month' | 'term';
interface Bucket {
  key: string;
  label: string;
  start: string;
  end: string;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** first day of the month n months after a YYYY-MM-DD date, as YYYY-MM-DD */
const addMonths = (d: string, n: number) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy)}-${String(mm + 1).padStart(2, '0')}-01`;
};
const dayBefore = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
const mon = (d: string) => MON[Number(d.slice(5, 7)) - 1]!;
const yy = (d: string) => d.slice(2, 4);
type Row = Record<string, unknown>;

/*
 * The money in and owed for the year, live from the ledgers (not the nightly marts), with the same rules
 * as the marts: a receipt counts unless reversed or bounced; a demand unless cancelled, carried or waived
 * away; a misc fee once announced, its lines unless cancelled. School and hostel fees share fee_demands /
 * fee_payments (by `ledger`); misc fees have misc_fee_students / misc_receipts. $1 is the year, $2 the
 * ledger chosen ('all' takes every one), $3 today in India.
 */
const COLL = `coll AS (
  SELECT p.ledger::text AS ledger, p.amount, p.received_on, p.mode::text AS mode, p.received_by, p.status::text AS status, p.cleared_on, p.deposit_slip_id, p.intent_id
    FROM fee_payments p WHERE p.academic_year_id = $1 AND ($2 = 'all' OR p.ledger::text = $2)
  UNION ALL
  SELECT 'misc', r.amount, r.received_on, r.mode::text, r.received_by, r.status::text, r.cleared_on, r.deposit_slip_id, NULL
    FROM misc_receipts r WHERE r.academic_year_id = $1 AND $2 IN ('all', 'misc'))`;
const DUES = `dues AS (
  SELECT d.ledger::text AS ledger, d.student_id, d.net, d.paid, d.due_on FROM fee_demands d
   WHERE d.academic_year_id = $1 AND d.status IN ('pending', 'partial', 'paid') AND ($2 = 'all' OR d.ledger::text = $2)
  UNION ALL
  SELECT 'misc', l.student_id, l.amount, l.paid, COALESCE(l.last_date, f.last_date, f.created_at::date)
    FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id
   WHERE f.academic_year_id = $1 AND f.status IN ('announced', 'closed') AND l.status <> 'cancelled' AND $2 IN ('all', 'misc'))`;
/** a receipt that counts as money in */
const IN = `status NOT IN ('reversed', 'bounced')`;
const BUCKET = `CASE WHEN $3::date <= due_on THEN 'current' WHEN $3::date - due_on <= 30 THEN '1-30'
  WHEN $3::date - due_on <= 60 THEN '31-60' WHEN $3::date - due_on <= 90 THEN '61-90' ELSE '90+' END`;

@Injectable()
export class FeeDashboardService {
  constructor(private readonly db: DbService) {}

  async dashboard(
    ctx: RequestContext,
    ledger: DashLedger,
    yearId?: string,
    by: DashBy = 'quarter',
  ) {
    const t = requireTenant(ctx);
    return this.db.tenant(t, async (c) => {
      const year = await this.year(c, yearId ?? t.academicYearId ?? undefined);
      const today = (
        await c.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)
      ).rows[0]!.d;
      // inside the year: today, else the year's last day (a past year), else its first (a future one)
      const asOf = today < year.start ? year.start : today > year.end ? year.end : today;
      const p = [year.id, ledger, asOf];
      // each query binds only the placeholders it uses ($1 year, $2 ledger, $3 as of)
      const q = async <T extends Row>(sql: string, params: unknown[] = p) => {
        const used = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
        return (await c.query<T>(sql, params.slice(0, used))).rows;
      };

      // ---- collected vs due --------------------------------------------------------------------
      const byLedger = await q<{
        ledger: string;
        today: string;
        month: string;
        year: string;
        receipts_today: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${COLL}
         SELECT ledger, COALESCE(sum(amount) FILTER (WHERE received_on = $3::date), 0)::text AS today,
                COALESCE(sum(amount) FILTER (WHERE received_on >= date_trunc('month', $3::date) AND received_on <= $3::date), 0)::text AS month,
                COALESCE(sum(amount), 0)::text AS year,
                count(*) FILTER (WHERE received_on = $3::date)::int AS receipts_today
           FROM coll WHERE ${IN} GROUP BY ledger`,
      );
      const dueByLedger = await q<{
        ledger: string;
        demand: string;
        due: string;
        paid_due: string;
        outstanding: string;
        overdue: string;
        students: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${DUES}
         SELECT ledger, sum(GREATEST(net, 0))::text AS demand,
                COALESCE(sum(GREATEST(net, 0)) FILTER (WHERE due_on <= $3::date), 0)::text AS due,
                COALESCE(sum(LEAST(GREATEST(paid, 0), GREATEST(net, 0))) FILTER (WHERE due_on <= $3::date), 0)::text AS paid_due,
                sum(GREATEST(net - paid, 0))::text AS outstanding,
                COALESCE(sum(GREATEST(net - paid, 0)) FILTER (WHERE due_on < $3::date), 0)::text AS overdue,
                count(DISTINCT student_id) FILTER (WHERE net > paid AND due_on < $3::date)::int AS students
           FROM dues GROUP BY ledger`,
      );
      const LEDGERS = ['school', 'hostel', 'misc'].filter((l) => ledger === 'all' || l === ledger);
      const split = LEDGERS.map((l) => {
        const a = byLedger.find((x) => x.ledger === l);
        const d = dueByLedger.find((x) => x.ledger === l);
        return {
          ledger: l,
          collectedToday: Number(a?.today ?? 0),
          collectedMonth: Number(a?.month ?? 0),
          collectedYear: Number(a?.year ?? 0),
          receiptsToday: a?.receipts_today ?? 0,
          demand: Number(d?.demand ?? 0),
          dueTillDate: Number(d?.due ?? 0),
          paidOfDue: Number(d?.paid_due ?? 0),
          outstanding: Number(d?.outstanding ?? 0),
          overdue: Number(d?.overdue ?? 0),
          defaulters: d?.students ?? 0,
        };
      });
      const sum = (k: keyof (typeof split)[number]) =>
        split.reduce((n, x) => n + (typeof x[k] === 'number' ? x[k] : 0), 0);
      const totals = {
        collectedToday: sum('collectedToday'),
        collectedMonth: sum('collectedMonth'),
        collectedYear: sum('collectedYear'),
        receiptsToday: sum('receiptsToday'),
        demand: sum('demand'),
        dueTillDate: sum('dueTillDate'),
        paidOfDue: sum('paidOfDue'),
        outstanding: sum('outstanding'),
        overdue: sum('overdue'),
        // a pupil owing on two ledgers counts once
        defaulters: (
          await q<{ n: number }>(
            // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
            `WITH ${DUES} SELECT count(DISTINCT student_id)::int AS n FROM dues WHERE net > paid AND due_on < $3::date`,
          )
        )[0]!.n,
      };

      const byClass = await q<{ class_name: string; due: string; paid: string; overdue: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${DUES}
         SELECT COALESCE(k.name, 'No class') AS class_name,
                COALESCE(sum(GREATEST(d.net, 0)) FILTER (WHERE d.due_on <= $3::date), 0)::text AS due,
                COALESCE(sum(LEAST(GREATEST(d.paid, 0), GREATEST(d.net, 0))) FILTER (WHERE d.due_on <= $3::date), 0)::text AS paid,
                COALESCE(sum(GREATEST(d.net - d.paid, 0)) FILTER (WHERE d.due_on < $3::date), 0)::text AS overdue
           FROM dues d
           LEFT JOIN enrolments e ON e.student_id = d.student_id AND e.academic_year_id = $1 AND e.status = 'active'
           LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
          GROUP BY k.name, k.display_order ORDER BY k.display_order NULLS LAST, k.name`,
      );

      // ---- dues ageing -------------------------------------------------------------------------
      const ageing = await q<{ bucket: string; ledger: string; amount: string; students: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${DUES}
         SELECT ${BUCKET} AS bucket, ledger, sum(net - paid)::text AS amount, count(DISTINCT student_id)::int AS students
           FROM dues WHERE net > paid GROUP BY 1, 2`,
      );

      // ---- modes, cheques, cash to deposit -----------------------------------------------------
      const modes = await q<{ mode: string; month: string; year: string; receipts: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${COLL}
         SELECT mode, COALESCE(sum(amount) FILTER (WHERE received_on >= date_trunc('month', $3::date) AND received_on <= $3::date), 0)::text AS month,
                sum(amount)::text AS year, count(*)::int AS receipts
           FROM coll WHERE ${IN} GROUP BY mode ORDER BY sum(amount) DESC`,
      );
      const instruments = (
        await q<{
          cheques_waiting: number;
          cheques_waiting_amount: string;
          bounced: number;
          bounced_amount: string;
          cash_to_deposit: string;
          cash_receipts: number;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
          `WITH ${COLL}
           SELECT count(*) FILTER (WHERE mode IN ('cheque', 'dd') AND status = 'posted' AND cleared_on IS NULL)::int AS cheques_waiting,
                  COALESCE(sum(amount) FILTER (WHERE mode IN ('cheque', 'dd') AND status = 'posted' AND cleared_on IS NULL), 0)::text AS cheques_waiting_amount,
                  count(*) FILTER (WHERE status = 'bounced')::int AS bounced,
                  COALESCE(sum(amount) FILTER (WHERE status = 'bounced'), 0)::text AS bounced_amount,
                  COALESCE(sum(amount) FILTER (WHERE mode = 'cash' AND ${IN} AND deposit_slip_id IS NULL), 0)::text AS cash_to_deposit,
                  count(*) FILTER (WHERE mode = 'cash' AND ${IN} AND deposit_slip_id IS NULL)::int AS cash_receipts
             FROM coll`,
        )
      )[0]!;

      // ---- trend: this month by day; the year by month against the year before -----------------
      const daily = await q<{ date: string; amount: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${COLL}
         SELECT g.d::date::text AS date, COALESCE(sum(coll.amount), 0)::text AS amount
           FROM generate_series(date_trunc('month', $3::date), $3::date, interval '1 day') g(d)
           LEFT JOIN coll ON coll.received_on = g.d::date AND coll.${IN}
          GROUP BY g.d ORDER BY g.d`,
      );
      const prev = await c.query<{ id: string }>(
        `SELECT id::text FROM academic_years WHERE start_date < $1::date ORDER BY start_date DESC LIMIT 1`,
        [year.start],
      );
      const monthly = await q<{ month: string; amount: string; last_year: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${COLL},
           prev AS (
             SELECT p.amount, p.received_on FROM fee_payments p
              WHERE p.academic_year_id = $5 AND ($2 = 'all' OR p.ledger::text = $2) AND p.status::text NOT IN ('reversed', 'bounced')
             UNION ALL
             SELECT r.amount, r.received_on FROM misc_receipts r
              WHERE r.academic_year_id = $5 AND $2 IN ('all', 'misc') AND r.status::text NOT IN ('reversed', 'bounced'))
         SELECT to_char(g.m, 'Mon YY') AS month,
                (SELECT COALESCE(sum(amount), 0) FROM coll WHERE ${IN} AND date_trunc('month', received_on) = g.m)::text AS amount,
                (SELECT COALESCE(sum(amount), 0) FROM prev WHERE date_trunc('month', received_on) = g.m - interval '1 year')::text AS last_year
           FROM generate_series(date_trunc('month', $4::date), date_trunc('month', $3::date), interval '1 month') g(m)
          ORDER BY g.m`,
        [year.id, ledger, asOf, year.start, prev.rows[0]?.id ?? '0'],
      );

      // ---- who owes most -----------------------------------------------------------------------
      const defaulters = await q<{
        student_id: string;
        name: string;
        admission_no: string;
        section: string | null;
        mobile: string | null;
        balance: string;
        days: number;
        ledgers: string[];
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${DUES}
         SELECT d.student_id::text, s.display_name AS name, s.admission_no,
                (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = d.student_id AND e.academic_year_id = $1 AND e.status = 'active' LIMIT 1) AS section,
                (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = d.student_id AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC LIMIT 1) AS mobile,
                sum(d.net - d.paid)::text AS balance, max($3::date - d.due_on)::int AS days, array_agg(DISTINCT d.ledger) AS ledgers
           FROM dues d JOIN students s ON s.id = d.student_id
          WHERE d.net > d.paid AND d.due_on < $3::date
          GROUP BY d.student_id, s.display_name, s.admission_no ORDER BY sum(d.net - d.paid) DESC LIMIT 15`,
      );

      // ---- refunds and concessions -------------------------------------------------------------
      const refunds = (
        await q<{ paid: string; paid_n: number; waiting: string; waiting_n: number }>(
          `SELECT COALESCE(sum(r.amount) FILTER (WHERE r.status::text = 'paid'), 0)::text AS paid,
                  count(*) FILTER (WHERE r.status::text = 'paid')::int AS paid_n,
                  COALESCE(sum(r.amount) FILTER (WHERE r.status::text IN ('draft', 'requested', 'approved')), 0)::text AS waiting,
                  count(*) FILTER (WHERE r.status::text IN ('draft', 'requested', 'approved'))::int AS waiting_n
             FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id
            WHERE COALESCE(r.academic_year_id, p.academic_year_id) = $1 AND ($2 = 'all' OR COALESCE(p.ledger::text, 'school') = $2)
              AND $3::date IS NOT NULL`,
        )
      )[0]!;
      const concessions = (
        await q<{ discounts: string; waivers: string; waivers_n: number; waiting_n: number }>(
          `SELECT (SELECT COALESCE(sum(d.discount), 0) FROM fee_demands d
                    WHERE d.academic_year_id = $1 AND d.status IN ('pending', 'partial', 'paid') AND ($2 = 'all' OR d.ledger::text = $2))::text AS discounts,
                  COALESCE(sum(a.amount) FILTER (WHERE a.status = 'approved'), 0)::text AS waivers,
                  count(*) FILTER (WHERE a.status = 'approved')::int AS waivers_n,
                  count(*) FILTER (WHERE a.status = 'pending')::int AS waiting_n
             FROM fee_adjustments a LEFT JOIN fee_demands dd ON dd.id = a.demand_id
            WHERE a.academic_year_id = $1 AND a.kind = 'waiver' AND ($2 = 'all' OR COALESCE(dd.ledger::text, 'school') = $2)
              AND $3::date IS NOT NULL`,
        )
      )[0]!;

      // ---- online payments ---------------------------------------------------------------------
      const online = await q<{ provider: string; status: string; n: number; amount: string }>(
        `SELECT i.provider::text AS provider, i.status::text, count(*)::int AS n, COALESCE(sum(i.amount), 0)::text AS amount
           FROM payment_intents i
          WHERE i.created_at >= $4::date AND i.created_at < $5::date + 1 AND ($2 = 'all' OR i.ledger::text = $2)
            AND $1::bigint IS NOT NULL AND $3::date IS NOT NULL
          GROUP BY 1, 2 ORDER BY 1, 2`,
        [year.id, ledger, asOf, year.start, year.end],
      );
      const unsettled = (
        await q<{ n: number; amount: string }>(
          `SELECT count(*)::int AS n, COALESCE(sum(p.amount), 0)::text AS amount FROM fee_payments p
            WHERE p.academic_year_id = $1 AND ($2 = 'all' OR p.ledger::text = $2) AND p.intent_id IS NOT NULL
              AND p.settlement_line_id IS NULL AND p.status::text NOT IN ('reversed', 'bounced') AND $3::date IS NOT NULL`,
        )
      )[0]!;

      // ---- the counters today ------------------------------------------------------------------
      const cashiers = await q<{
        user_id: string | null;
        name: string;
        amount: string;
        cash: string;
        receipts: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${COLL}
         SELECT coll.received_by::text AS user_id,
                COALESCE(u.display_name, CASE WHEN coll.intent_id IS NOT NULL THEN 'Online' ELSE 'Not recorded' END) AS name,
                sum(coll.amount)::text AS amount,
                COALESCE(sum(coll.amount) FILTER (WHERE coll.mode = 'cash'), 0)::text AS cash, count(*)::int AS receipts
           FROM coll LEFT JOIN users u ON u.id = coll.received_by
          WHERE coll.received_on = $3::date AND coll.${IN}
          GROUP BY coll.received_by, u.display_name, coll.intent_id IS NOT NULL ORDER BY sum(coll.amount) DESC`,
      );

      // ---- projection (demand due) vs realised (paid of it) and received, by period -------------
      const buckets = await this.buckets(c, year, by);
      const per = await q<{ k: string; projection: string; realised: string; received: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${DUES}, ${COLL}, b AS (SELECT * FROM unnest($4::date[], $5::date[], $6::text[]) AS b(s, e, k))
         SELECT b.k,
                (SELECT COALESCE(sum(GREATEST(net, 0)), 0) FROM dues WHERE due_on BETWEEN b.s AND b.e)::text AS projection,
                (SELECT COALESCE(sum(LEAST(GREATEST(paid, 0), GREATEST(net, 0))), 0) FROM dues WHERE due_on BETWEEN b.s AND b.e)::text AS realised,
                (SELECT COALESCE(sum(amount), 0) FROM coll WHERE ${IN} AND received_on BETWEEN b.s AND b.e AND received_on <= $3::date)::text AS received
           FROM b`,
        [...p, buckets.map((x) => x.start), buckets.map((x) => x.end), buckets.map((x) => x.key)],
      );
      const periods = buckets.map((b) => {
        const r = per.find((x) => x.k === b.key);
        const projection = Number(r?.projection ?? 0);
        const realised = Number(r?.realised ?? 0);
        return {
          ...b,
          current: b.start <= asOf && asOf <= b.end,
          past: b.end < asOf,
          projection,
          realised,
          received: Number(r?.received ?? 0),
          balance: Math.max(0, projection - realised),
        };
      });

      const num = (s: string) => Number(s);
      return {
        year: { id: year.id, code: year.code },
        asOf,
        ledger,
        by,
        periods,
        totals,
        split,
        byClass: byClass.map((x) => ({
          name: x.class_name,
          due: num(x.due),
          paid: num(x.paid),
          overdue: num(x.overdue),
        })),
        ageing: ['current', '1-30', '31-60', '61-90', '90+'].map((b) => ({
          bucket: b,
          amount: ageing.filter((x) => x.bucket === b).reduce((n, x) => n + num(x.amount), 0),
          students: Math.max(0, ...ageing.filter((x) => x.bucket === b).map((x) => x.students)),
          byLedger: ageing
            .filter((x) => x.bucket === b)
            .map((x) => ({ ledger: x.ledger, amount: num(x.amount) })),
        })),
        modes: modes.map((x) => ({
          mode: x.mode,
          month: num(x.month),
          year: num(x.year),
          receipts: x.receipts,
        })),
        instruments: {
          chequesWaiting: instruments.cheques_waiting,
          chequesWaitingAmount: num(instruments.cheques_waiting_amount),
          bounced: instruments.bounced,
          bouncedAmount: num(instruments.bounced_amount),
          cashToDeposit: num(instruments.cash_to_deposit),
          cashReceipts: instruments.cash_receipts,
        },
        daily: daily.map((x) => ({ date: x.date, amount: num(x.amount) })),
        monthly: monthly.map((x) => ({
          month: x.month,
          amount: num(x.amount),
          lastYear: num(x.last_year),
        })),
        defaulters: defaulters.map((x) => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          section: x.section,
          mobile: x.mobile,
          balance: num(x.balance),
          days: x.days,
          ledgers: x.ledgers,
        })),
        refunds: {
          paid: num(refunds.paid),
          paidCount: refunds.paid_n,
          waiting: num(refunds.waiting),
          waitingCount: refunds.waiting_n,
        },
        concessions: {
          discounts: num(concessions.discounts),
          waivers: num(concessions.waivers),
          waiversCount: concessions.waivers_n,
          waitingCount: concessions.waiting_n,
        },
        online: {
          byGateway: online.map((x) => ({
            provider: x.provider,
            status: x.status,
            count: x.n,
            amount: num(x.amount),
          })),
          unsettled: { count: unsettled.n, amount: num(unsettled.amount) },
        },
        cashiers: cashiers.map((x) => ({
          userId: x.user_id,
          name: x.name,
          amount: num(x.amount),
          cash: num(x.cash),
          receipts: x.receipts,
        })),
      };
    });
  }

  /** The year cut into quarters (from its first month), months, or the fee terms (instalments). */
  private async buckets(
    c: PoolClient,
    year: { id: string; start: string; end: string },
    by: DashBy,
  ): Promise<Bucket[]> {
    const first = `${year.start.slice(0, 7)}-01`;
    if (by === 'term') {
      const t = await c.query<{ instalment: number; s: string; e: string }>(
        `SELECT instalment, min(make_date(year, month, 1))::text AS s, max(make_date(year, month, 1))::text AS e
           FROM fee_periods WHERE academic_year_id = $1 GROUP BY instalment ORDER BY min(make_date(year, month, 1))`,
        [year.id],
      );
      // a term runs from its first month until the next term begins (the last one: the year's end)
      if (t.rows.length)
        return t.rows.map((x, i) => {
          const next = t.rows[i + 1];
          const end = next ? dayBefore(next.s) : year.end;
          return {
            key: `t${String(x.instalment)}`,
            label: `Term ${String(x.instalment)} (${mon(x.s)}${x.s.slice(0, 7) === end.slice(0, 7) ? '' : `–${mon(end)}`} ${yy(end)})`,
            start: i === 0 && x.s > year.start ? year.start : x.s,
            end,
          };
        });
      // no fee terms set: quarters
    }
    const step = by === 'month' ? 1 : 3;
    const out: Bucket[] = [];
    for (let i = 0; i < 12; i += step) {
      const s = addMonths(first, i);
      const e = dayBefore(addMonths(first, i + step));
      out.push({
        key: by === 'month' ? s.slice(0, 7) : `q${String(i / 3 + 1)}`,
        label:
          by === 'month'
            ? `${mon(s)} ${yy(s)}`
            : `Q${String(i / 3 + 1)} ${mon(s)}–${mon(e)} ${yy(e)}`,
        start: s,
        end: e,
      });
    }
    return out;
  }

  /**
   * The transport fee by period: demand due on the transport heads (projection), paid of it (realised),
   * money received for it (receipts split onto those demands), and the bus list (monthly fare x months
   * riding) against what was billed, with riders not billed; the current period by route; who owes most.
   */
  async transport(ctx: RequestContext, by: DashBy = 'quarter') {
    const t = requireTenant(ctx);
    return this.db.tenant(t, async (c) => {
      const year = await this.year(c, t.academicYearId ?? undefined);
      const today = (
        await c.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)
      ).rows[0]!.d;
      const asOf = today < year.start ? year.start : today > year.end ? year.end : today;
      const buckets = await this.buckets(c, year, by);
      const TD = `tdues AS (
        SELECT d.id, d.student_id, d.net, d.paid, d.due_on FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id AND h.kind = 'transport'
         WHERE d.academic_year_id = $1 AND d.status IN ('pending', 'partial', 'paid'))`;
      // a rider's route and stop this year (pick-up, else drop)
      const RIDE = `ride AS (
        SELECT DISTINCT ON (t.student_id) t.student_id, COALESCE(t.pick_route_id, t.drop_route_id) AS route_id,
               COALESCE(t.pick_stop_id, t.drop_stop_id) AS stop_id
          FROM student_transport t WHERE t.academic_year_id = $1 AND t.status <> 'cancelled'
         ORDER BY t.student_id, (t.status = 'active') DESC, t.created_at DESC)`;
      const per = await c.query<{
        k: string;
        projection: string;
        realised: string;
        received: string;
        expected: string;
        riders: number;
        unbilled: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${TD}, b AS (SELECT * FROM unnest($2::date[], $3::date[], $4::text[]) AS b(s, e, k))
         SELECT b.k,
                (SELECT COALESCE(sum(GREATEST(net, 0)), 0) FROM tdues WHERE due_on BETWEEN b.s AND b.e)::text AS projection,
                (SELECT COALESCE(sum(LEAST(GREATEST(paid, 0), GREATEST(net, 0))), 0) FROM tdues WHERE due_on BETWEEN b.s AND b.e)::text AS realised,
                (SELECT COALESCE(sum(a.amount), 0) FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id
                   JOIN tdues d ON d.id = a.demand_id
                  WHERE p.status::text NOT IN ('reversed', 'bounced') AND p.received_on BETWEEN b.s AND b.e AND p.received_on <= $5::date)::text AS received,
                (SELECT COALESCE(sum(t.monthly_amount), 0) FROM student_transport t
                   CROSS JOIN generate_series(date_trunc('month', b.s), date_trunc('month', b.e), interval '1 month') m
                  WHERE t.academic_year_id = $1 AND t.status <> 'cancelled' AND m::date BETWEEN t.from_month AND t.to_month)::text AS expected,
                (SELECT count(DISTINCT t.student_id) FROM student_transport t
                  WHERE t.academic_year_id = $1 AND t.status <> 'cancelled' AND t.from_month <= b.e AND t.to_month >= date_trunc('month', b.s))::int AS riders,
                (SELECT count(DISTINCT t.student_id) FROM student_transport t
                  WHERE t.academic_year_id = $1 AND t.status <> 'cancelled' AND t.from_month <= b.e AND t.to_month >= date_trunc('month', b.s)
                    AND b.s <= $5::date
                    AND NOT EXISTS (SELECT 1 FROM tdues d WHERE d.student_id = t.student_id AND d.due_on BETWEEN b.s AND b.e))::int AS unbilled
           FROM b`,
        [
          year.id,
          buckets.map((x) => x.start),
          buckets.map((x) => x.end),
          buckets.map((x) => x.key),
          asOf,
        ],
      );
      const periods = buckets.map((b) => {
        const r = per.rows.find((x) => x.k === b.key);
        const projection = Number(r?.projection ?? 0);
        const realised = Number(r?.realised ?? 0);
        return {
          ...b,
          current: b.start <= asOf && asOf <= b.end,
          past: b.end < asOf,
          projection,
          realised,
          received: Number(r?.received ?? 0),
          balance: Math.max(0, projection - realised),
          expected: Number(r?.expected ?? 0),
          riders: r?.riders ?? 0,
          unbilled: r?.unbilled ?? 0,
        };
      });
      const cur = periods.find((x) => x.current) ?? periods.at(-1)!;
      const routes = await c.query<{
        route: string;
        riders: number;
        projection: string;
        realised: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${TD}, ${RIDE}
         SELECT COALESCE(r.code || ' · ' || r.name, 'No route') AS route, count(DISTINCT d.student_id)::int AS riders,
                sum(GREATEST(d.net, 0))::text AS projection, sum(LEAST(GREATEST(d.paid, 0), GREATEST(d.net, 0)))::text AS realised
           FROM tdues d LEFT JOIN ride ON ride.student_id = d.student_id LEFT JOIN transport_routes r ON r.id = ride.route_id
          WHERE d.due_on BETWEEN $2::date AND $3::date
          GROUP BY r.code, r.name ORDER BY r.code NULLS LAST`,
        [year.id, cur.start, cur.end],
      );
      const defaulters = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        section: string | null;
        route: string | null;
        stop: string | null;
        balance: string;
        days: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed CTE constants; values are bound parameters
        `WITH ${TD}, ${RIDE}
         SELECT d.student_id::text, s.display_name AS name, s.admission_no,
                (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = d.student_id AND e.academic_year_id = $1 AND e.status = 'active' LIMIT 1) AS section,
                max(r.code || ' · ' || r.name) AS route, max(st.name) AS stop,
                sum(d.net - d.paid)::text AS balance, max($2::date - d.due_on)::int AS days
           FROM tdues d JOIN students s ON s.id = d.student_id
           LEFT JOIN ride ON ride.student_id = d.student_id LEFT JOIN transport_routes r ON r.id = ride.route_id
           LEFT JOIN transport_stops st ON st.id = ride.stop_id
          WHERE d.net > d.paid AND d.due_on < $2::date
          GROUP BY d.student_id, s.display_name, s.admission_no ORDER BY sum(d.net - d.paid) DESC LIMIT 15`,
        [year.id, asOf],
      );
      return {
        year: { id: year.id, code: year.code },
        asOf,
        by,
        periods,
        current: { key: cur.key, label: cur.label },
        routes: routes.rows.map((x) => ({
          route: x.route,
          riders: x.riders,
          projection: Number(x.projection),
          realised: Number(x.realised),
        })),
        defaulters: defaulters.rows.map((x) => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          section: x.section,
          route: x.route,
          stop: x.stop,
          balance: Number(x.balance),
          days: x.days,
        })),
      };
    });
  }

  private async year(c: PoolClient, id: string | undefined) {
    const r = await c.query<{ id: string; code: string; start: string; end: string }>(
      `SELECT id::text, code, start_date::text AS start, end_date::text AS "end" FROM academic_years
        WHERE ($1::bigint IS NULL AND status = 'active') OR id = $1::bigint ORDER BY id = $1::bigint DESC NULLS LAST LIMIT 1`,
      [id ?? null],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'No academic year', { status: 404 });
    return r.rows[0];
  }
}
