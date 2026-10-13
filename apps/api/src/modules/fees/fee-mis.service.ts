import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import type { FeeMisQueryDto } from './fees.dto';

export type MisReportId =
  | 'mode_daywise'
  | 'head_receipts'
  | 'cheque_bounce'
  | 'daybook_grouped'
  | 'period_headwise'
  | 'yearly_projection';

export interface MisColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  /** A heading over this and the neighbouring columns of the same group (Payable, Paid). */
  group?: string;
  width: number;
}
export interface MisRow {
  /** group: a heading across the table; subtotal and total print in bold. */
  kind: 'row' | 'group' | 'subtotal' | 'total';
  label?: string;
  cells: Record<string, string | number | null>;
}
export interface MisReport {
  report: MisReportId;
  title: string;
  /** What was chosen, in words (for the head of the file). */
  filters: string[];
  /** The rule the figures follow. */
  note: string;
  columns: MisColumn[];
  rows: MisRow[];
}

/** A receipt that counts as money received: a cancelled or bounced one does not. */
const COUNTED = `p.status IN ('posted', 'partly_refunded', 'refunded')`;
const dmy = (v: string | null | undefined) =>
  v ? String(v).slice(0, 10).split('-').reverse().join('-') : '';
const text = (key: string, label: string, width = 14, group?: string): MisColumn => ({
  key,
  label,
  type: 'text',
  width,
  group,
});
const num = (key: string, label: string, group?: string, width = 11): MisColumn => ({
  key,
  label,
  type: 'number',
  width,
  group,
});
const STATUS: Record<string, string> = {
  posted: 'Posted',
  partly_refunded: 'Partly refunded',
  refunded: 'Refunded',
  bounced: 'Bounced',
  reversed: 'Cancelled',
};

interface ReceiptRow {
  id: string;
  on_date: string;
  receipt_no: string | null;
  admission_no: string;
  student: string;
  grade: string | null;
  section: string | null;
  fee_group: string | null;
  student_status: string;
  mode: string;
  gateway: string | null;
  bank_name: string | null;
  reference: string | null;
  instrument_no: string | null;
  instrument_date: string | null;
  amount: number;
  late_fee: number;
  refunded: number;
  status: string;
  route: string | null;
  slab: string | null;
}

/**
 * The fee MIS reports that are pivots (a column per fee head, per payment mode or per month), which a
 * fixed list of columns cannot hold. One rule for all of them, so they agree with each other: a
 * cancelled or bounced receipt is not counted; a refund shows on the day it was paid and reduces the
 * day's figure. Screens, Excel and PDF are made from the same table.
 */
@Injectable()
export class FeeMisService {
  constructor(private readonly db: DbService) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private range(q: FeeMisQueryDto): { from: string; to: string } {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const from = q.from ?? q.to ?? today;
    const to = q.to ?? q.from ?? today;
    if (from > to)
      throw new DomainError('validation-failed', 'The first date is after the last', {
        status: 400,
      });
    return { from, to };
  }

  async report(ctx: RequestContext, id: MisReportId, q: FeeMisQueryDto): Promise<MisReport> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) => {
      if (id === 'mode_daywise') return this.modeDaywise(c, q);
      if (id === 'head_receipts') return this.headReceipts(c, q, false);
      if (id === 'daybook_grouped') return this.headReceipts(c, q, true);
      if (id === 'cheque_bounce') return this.chequeBounce(c, q);
      if (id === 'period_headwise') return this.pupilWise(c, yearId, q, 'head');
      return this.pupilWise(c, yearId, q, 'month');
    });
  }

  // ---- mode-wise collection, one row per day -----------------------------------------------------------
  private async modeDaywise(c: PoolClient, q: FeeMisQueryDto): Promise<MisReport> {
    const { from, to } = this.range(q);
    const modes = await c.query<{ code: string; kind: string; label: string }>(
      `SELECT code, kind, label FROM fee_payment_modes ORDER BY sort_order, code`,
    );
    const label = new Map(modes.rows.map((m) => [m.code, m.label]));
    const got = await c.query<{
      on_date: string;
      mode: string;
      principal: number;
      late_fee: number;
      amount: number;
      bounced: number;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment; values are bound parameters
      `SELECT p.received_on::text AS on_date, COALESCE(p.mode_label, (SELECT pm.label FROM fee_payment_modes pm WHERE pm.code = p.mode::text), p.mode::text) AS mode,
              COALESCE(sum(p.amount - p.late_fee) FILTER (WHERE ${COUNTED}), 0)::float AS principal,
              COALESCE(sum(p.late_fee) FILTER (WHERE ${COUNTED}), 0)::float AS late_fee,
              COALESCE(sum(p.amount) FILTER (WHERE ${COUNTED}), 0)::float AS amount,
              COALESCE(sum(p.amount) FILTER (WHERE p.status = 'bounced'), 0)::float AS bounced
         FROM fee_payments p
        WHERE p.received_on BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR p.ledger::text = $3)
        GROUP BY 1, 2`,
      [from, to, q.ledger ?? null],
    );
    // a refund leaves by its own mode: bank, cheque, cash or the gateway that collected the money
    const back = await c.query<{ on_date: string; mode: string; amount: number }>(
      `SELECT r.paid_on::text AS on_date, r.mode, sum(r.amount)::float AS amount
         FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id
        WHERE r.status = 'paid' AND r.paid_on BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR COALESCE(p.ledger::text, 'school') = $3)
        GROUP BY 1, 2`,
      [from, to, q.ledger ?? null],
    );
    const refundMode = (m: string) =>
      label.get(m === 'gateway' ? 'online' : m) ?? (m === 'gateway' ? 'Online' : m);
    const days = new Map<
      string,
      { paid: number; dr: number; late: number; bounced: number; modes: Map<string, number> }
    >();
    const day = (d: string) => {
      const x = days.get(d) ?? { paid: 0, dr: 0, late: 0, bounced: 0, modes: new Map() };
      days.set(d, x);
      return x;
    };
    for (const r of got.rows) {
      const x = day(r.on_date);
      x.paid += r.principal;
      x.late += r.late_fee;
      x.bounced += r.bounced;
      if (r.amount) x.modes.set(r.mode, (x.modes.get(r.mode) ?? 0) + r.amount);
    }
    for (const r of back.rows) {
      const x = day(r.on_date);
      x.dr += r.amount;
      const m = refundMode(r.mode);
      x.modes.set(m, (x.modes.get(m) ?? 0) - r.amount);
    }
    const seen = new Set([...days.values()].flatMap((d) => [...d.modes.keys()]));
    const order = [
      ...modes.rows.map((m) => m.label).filter((l) => seen.has(l)),
      ...[...seen].filter((l) => !modes.rows.some((m) => m.label === l)).sort(),
    ];
    const columns: MisColumn[] = [
      num('sr', 'Sr No', undefined, 5),
      text('date', 'Date', 10),
      num('paid', 'Amt. Paid'),
      num('dr', 'Dr Amount'),
      num('late', 'Late Fee'),
      num('bounced', 'Cheque Bounce Amount'),
      num('final', 'Final Amount'),
      ...order.map((m, i) => num(`m${String(i)}`, m)),
      num('final2', 'Final Amount'),
    ];
    const total: Record<string, number> = {};
    const add = (k: string, v: number) => (total[k] = (total[k] ?? 0) + v);
    const rows: MisRow[] = [...days.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, x], i) => {
        const cells: Record<string, string | number | null> = {
          sr: i + 1,
          date: dmy(d),
          paid: x.paid,
          dr: x.dr,
          late: x.late,
          bounced: x.bounced,
          final: x.paid + x.late - x.dr,
        };
        let byMode = 0;
        order.forEach((m, k) => {
          const v = x.modes.get(m) ?? 0;
          cells[`m${String(k)}`] = v;
          byMode += v;
        });
        cells.final2 = byMode;
        for (const [k, v] of Object.entries(cells))
          if (typeof v === 'number' && k !== 'sr') add(k, v);
        return { kind: 'row' as const, cells };
      });
    rows.push({ kind: 'total', cells: { sr: null, date: 'Total :', ...total } });
    return {
      report: 'mode_daywise',
      title: 'Day-wise fee collection (mode-wise)',
      filters: [`${dmy(from)} to ${dmy(to)}`, q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers'],
      note: 'Bounced and cancelled receipts are not counted. A refund shows as Dr Amount on the day it was paid and is taken off the mode it was paid by. Cheque Bounce Amount is the value of cheques received that day which bounced later; it is shown for information and is not part of Final Amount.',
      columns,
      rows,
    };
  }

  // ---- one row per receipt with every fee head as a column ---------------------------------------------
  private async receipts(c: PoolClient, q: FeeMisQueryDto, all: boolean): Promise<ReceiptRow[]> {
    const { from, to } = this.range(q);
    const r = await c.query<ReceiptRow>(
      // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment; values are bound parameters
      `SELECT p.id::text, p.received_on::text AS on_date, p.receipt_no, s.admission_no, s.display_name AS student, en.grade, en.section,
              COALESCE(fp.fee_group, 'general') AS fee_group, s.status::text AS student_status,
              COALESCE(p.mode_label, (SELECT pm.label FROM fee_payment_modes pm WHERE pm.code = p.mode::text), p.mode::text) AS mode, i.provider AS gateway, p.bank_name, p.reference, p.instrument_no, p.instrument_date::text,
              p.amount::float, p.late_fee::float, p.refunded::float, p.status::text,
              (SELECT rt.code || ' ' || rt.name FROM student_route_assignments ra JOIN transport_routes rt ON rt.id = ra.route_id
                WHERE ra.student_id = p.student_id AND ra.academic_year_id = p.academic_year_id LIMIT 1) AS route,
              sl.name AS slab
         FROM fee_payments p JOIN students s ON s.id = p.student_id
         LEFT JOIN payment_intents i ON i.id = p.intent_id
         LEFT JOIN student_fee_profiles fp ON fp.student_id = p.student_id AND fp.academic_year_id = p.academic_year_id
         LEFT JOIN transport_slabs sl ON sl.id = fp.transport_slab_id
         LEFT JOIN LATERAL (SELECT k.code AS grade, cs.name AS section, cs.class_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                              JOIN classes k ON k.id = cs.class_id
                             WHERE e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true
        WHERE p.received_on BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR p.ledger::text = $3)
          AND ($4::bigint IS NULL OR en.class_id = $4) AND (${all ? 'true' : COUNTED})
        ORDER BY p.received_on, COALESCE(p.mode_label, (SELECT pm.label FROM fee_payment_modes pm WHERE pm.code = p.mode::text), p.mode::text), p.receipt_no NULLS LAST, p.id
        LIMIT 20000`,
      [from, to, q.ledger ?? null, q.classId ?? null],
    );
    return r.rows;
  }

  private async headReceipts(
    c: PoolClient,
    q: FeeMisQueryDto,
    grouped: boolean,
  ): Promise<MisReport> {
    const { from, to } = this.range(q);
    // the head-wise tally lists every receipt with its status; the grouped day book only what counts
    const list = await this.receipts(c, q, !grouped);
    const ids = list.map((r) => r.id);
    const alloc = await c.query<{ payment_id: string; head: string; amount: number }>(
      `SELECT a.payment_id::text,
              CASE WHEN EXISTS (SELECT 1 FROM fee_adjustments j WHERE j.charge_demand_id = d.id) THEN 'bounce'
                   WHEN h.kind = 'opening_balance' THEN 'opening' ELSE h.id::text END AS head,
              sum(a.amount)::float AS amount
         FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id
        WHERE a.payment_id = ANY($1::bigint[]) GROUP BY 1, 2`,
      [ids],
    );
    const heads = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM fee_heads WHERE deleted_at IS NULL ORDER BY sort_order, id`,
    );
    const by = new Map<string, Map<string, number>>();
    const used = new Set<string>();
    for (const a of alloc.rows) {
      const m = by.get(a.payment_id) ?? new Map<string, number>();
      m.set(a.head, a.amount);
      by.set(a.payment_id, m);
      used.add(a.head);
    }
    const headCols = heads.rows.filter((h) => used.has(h.id));
    const money: MisColumn[] = [
      num('total', 'Total'),
      num('opening', 'Opening Dr.'),
      ...headCols.map((h) => num(`h${h.id}`, h.name)),
      num('advance', 'Advance kept'),
      num('fine', 'Fine'),
      num('bounce', 'Bounce Charge'),
    ];
    const columns: MisColumn[] = grouped
      ? [
          num('sr', 'Sr. No.', undefined, 5),
          text('admission_no', 'Admission Number', 11),
          text('student', 'Student Full Name', 20),
          text('grade', 'Grade', 7),
          text('section', 'Section', 6),
          text('fee_group', 'Fee Category', 9),
          text('student_status', 'Student Status', 8),
          text('receipt_no', 'Receipt Number', 15),
          text('date', 'Receipt Date', 9),
          text('mode', 'Payment Mode', 10),
          text('gateway', 'Gateway Name', 9),
          text('bank_name', 'Bank Name', 12),
          text('reference', 'Reference Number', 14),
          text('instrument_date', 'Payment Mode Date', 9),
          ...money,
        ]
      : [
          num('sr', 'Sr No', undefined, 5),
          text('date', 'Date', 9),
          text('receipt_no', 'Receipt no.', 15),
          text('admission_no', 'Admission no.', 10),
          text('student', 'Student name', 20),
          text('class', 'Class', 8),
          text('route', 'Route', 14),
          text('slab', 'Slab', 11),
          text('mode', 'Mode', 10),
          text('status', 'Payment status', 11),
          ...money,
        ];
    const keys = money.map((m) => m.key);
    const sums = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
    const grand = sums();
    const rows: MisRow[] = [];
    let dateSum = sums();
    let modeSum = sums();
    let curDate = '';
    let curMode = '';
    let sr = 0;
    const close = (what: 'mode' | 'date') => {
      if (!grouped) return;
      if (curMode && (what === 'mode' || what === 'date'))
        rows.push({ kind: 'subtotal', label: `Subtotal — ${curMode}`, cells: { ...modeSum } });
      if (what === 'date' && curDate)
        rows.push({
          kind: 'subtotal',
          label: `Date Total — ${dmy(curDate)}`,
          cells: { ...dateSum },
        });
    };
    for (const r of list) {
      const counts = ['posted', 'partly_refunded', 'refunded'].includes(r.status);
      if (grouped && r.on_date !== curDate) {
        close('date');
        curDate = r.on_date;
        curMode = '';
        dateSum = sums();
        sr = 0;
        rows.push({ kind: 'group', label: `Receipt Dates: ${dmy(r.on_date)}`, cells: {} });
      }
      if (grouped && r.mode !== curMode) {
        if (curMode)
          rows.push({ kind: 'subtotal', label: `Subtotal — ${curMode}`, cells: { ...modeSum } });
        curMode = r.mode;
        modeSum = sums();
        rows.push({ kind: 'group', label: `Payment Mode: ${r.mode}`, cells: {} });
      }
      const m = by.get(r.id) ?? new Map<string, number>();
      const allocated = [...m.values()].reduce((a, v) => a + v, 0);
      const figures: Record<string, number> = sums();
      if (counts) {
        figures.total = r.amount;
        figures.opening = m.get('opening') ?? 0;
        for (const h of headCols) figures[`h${h.id}`] = m.get(h.id) ?? 0;
        figures.fine = r.late_fee;
        figures.bounce = m.get('bounce') ?? 0;
        // what the receipt holds beyond fee and fine, less what went back as a refund
        figures.advance = Math.max(
          Number((r.amount - r.late_fee - allocated - r.refunded).toFixed(2)),
          0,
        );
      }
      for (const k of keys) {
        grand[k]! += figures[k]!;
        dateSum[k]! += figures[k]!;
        modeSum[k]! += figures[k]!;
      }
      sr += 1;
      rows.push({
        kind: 'row',
        cells: {
          sr,
          date: dmy(r.on_date),
          receipt_no: r.receipt_no,
          admission_no: r.admission_no,
          student: r.student,
          grade: r.grade,
          section: r.section,
          class: r.grade ? `${r.grade}-${r.section ?? ''}` : '',
          fee_group: r.fee_group,
          student_status: r.student_status,
          route: r.route,
          slab: r.slab,
          mode: r.mode,
          gateway: r.gateway,
          bank_name: r.bank_name,
          reference: r.reference,
          instrument_date: dmy(r.instrument_date),
          status: counts
            ? (STATUS[r.status] ?? r.status)
            : `${STATUS[r.status] ?? r.status} (not counted)`,
          ...figures,
        },
      });
    }
    close('date');
    rows.push({ kind: 'total', label: 'Grand Total', cells: { ...grand } });
    return {
      report: grouped ? 'daybook_grouped' : 'head_receipts',
      title: grouped
        ? 'Day book (grouped by date and payment mode)'
        : 'Head-wise tally (receipt-wise)',
      filters: [`${dmy(from)} to ${dmy(to)}`, q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers'],
      note: grouped
        ? 'Bounced and cancelled receipts are not listed. Each head shows what the receipt is set against today (a refund with the fee kept due takes the amount off the head). Advance kept is money on the receipt not yet set against any fee.'
        : 'A bounced or cancelled receipt is listed with its status and counts as zero. Each head shows what the receipt is set against today. Advance kept is money on the receipt not yet set against any fee.',
      columns,
      rows,
    };
  }

  // ---- cheque bounce, with what happened after ---------------------------------------------------------
  private async chequeBounce(c: PoolClient, q: FeeMisQueryDto): Promise<MisReport> {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const to = q.to ?? today;
    const from =
      q.from ??
      new Date(new Date(`${to}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const b = await c.query<{
      id: string;
      bounced_on: string;
      decided_at: Date;
      student_id: string;
      ledger: string;
      received_on: string;
      receipt_no: string | null;
      admission_no: string;
      student: string;
      class: string | null;
      mode: string;
      instrument_no: string | null;
      instrument_date: string | null;
      bank_name: string | null;
      amount: number;
      charge: number;
      charge_paid: number;
      reason: string;
      approved_by: string | null;
      lines: Array<{ demandId: string; head: string; period: string; amount: string }> | null;
    }>(
      `SELECT a.id::text, (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date::text AS bounced_on, a.decided_at, p.student_id::text, p.ledger::text,
              p.received_on::text, p.receipt_no, s.admission_no, s.display_name AS student,
              (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS class,
              COALESCE(p.mode_label, (SELECT pm.label FROM fee_payment_modes pm WHERE pm.code = p.mode::text), p.mode::text) AS mode, p.instrument_no, p.instrument_date::text, p.bank_name, p.amount::float, a.charge::float,
              COALESCE(cd.paid, 0)::float AS charge_paid, a.reason, u.display_name AS approved_by, a.lines
         FROM fee_adjustments a JOIN fee_payments p ON p.id = a.payment_id JOIN students s ON s.id = p.student_id
         LEFT JOIN fee_demands cd ON cd.id = a.charge_demand_id LEFT JOIN users u ON u.id = a.decided_by
        WHERE a.kind = 'bounce' AND a.status = 'approved'
          AND (a.decided_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR p.ledger::text = $3)
        ORDER BY a.decided_at, a.id`,
      [from, to, q.ledger ?? null],
    );
    // every counted receipt of these pupils after their first bounce: what can have paid the fee again
    const later = await c.query<{
      id: string;
      student_id: string;
      ledger: string;
      created_at: Date;
      received_on: string;
      receipt_no: string | null;
      mode: string;
      amount: number;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment; values are bound parameters
      `SELECT p.id::text, p.student_id::text, p.ledger::text, p.created_at, p.received_on::text, p.receipt_no, COALESCE(p.mode_label, (SELECT pm.label FROM fee_payment_modes pm WHERE pm.code = p.mode::text), p.mode::text) AS mode,
              (p.amount - p.refunded)::float AS amount
         FROM fee_payments p WHERE p.student_id = ANY($1::bigint[]) AND ${COUNTED} ORDER BY p.created_at, p.id`,
      [[...new Set(b.rows.map((x) => x.student_id))]],
    );
    const receiptById = new Map(later.rows.map((r) => [r.id, r]));
    const demandIds = [...new Set(b.rows.flatMap((x) => (x.lines ?? []).map((l) => l.demandId)))];
    const demands = await c.query<{ id: string; paid: number; payments: string[] }>(
      `SELECT d.id::text, d.paid::float,
              COALESCE((SELECT array_agg(DISTINCT a.payment_id::text) FROM fee_payment_allocations a WHERE a.demand_id = d.id), '{}') AS payments
         FROM fee_demands d WHERE d.id = ANY($1::bigint[])`,
      [demandIds],
    );
    const demand = new Map(demands.rows.map((d) => [d.id, d]));
    // without the remembered lines: the pupil's later receipts pay the bounced amounts, the oldest bounce first
    const pool = new Map<string, Array<{ r: (typeof later.rows)[number]; left: number }>>();
    for (const r of later.rows) {
      const k = `${r.student_id}:${r.ledger}`;
      pool.set(k, [...(pool.get(k) ?? []), { r, left: r.amount }]);
    }
    const describe = (r: (typeof later.rows)[number], amount?: number) =>
      `${r.receipt_no ?? r.id} · ${dmy(r.received_on)} · ${r.mode}${amount === undefined ? '' : ` · ${amount.toLocaleString('en-IN')}`}`;
    const rows: MisRow[] = [];
    const total = { amount: 0, charge: 0, charge_paid: 0, repaid: 0 };
    b.rows.forEach((x, i) => {
      let repaid = 0;
      let papers: string[] = [];
      let was = '';
      if (x.lines && x.lines.length > 0) {
        const pay = new Set<string>();
        for (const l of x.lines) {
          const d = demand.get(l.demandId);
          if (!d) continue;
          repaid += Math.min(Number(l.amount), Math.max(d.paid, 0));
          for (const p of d.payments) pay.add(p);
        }
        papers = [...pay]
          .map((p) => receiptById.get(p))
          .filter((r): r is (typeof later.rows)[number] => !!r)
          .map((r) => describe(r));
        const months = [...new Set(x.lines.map((l) => l.period.split(' ')[0]!.slice(0, 3)))];
        was =
          months.length > 4 ? `${months[0]!} to ${months[months.length - 1]!}` : months.join(', ');
      } else {
        let need = x.amount;
        for (const slot of pool.get(`${x.student_id}:${x.ledger}`) ?? []) {
          if (need <= 0) break;
          if (slot.left <= 0 || slot.r.created_at <= x.decided_at) continue;
          const take = Math.min(slot.left, need);
          slot.left -= take;
          need -= take;
          repaid += take;
          papers.push(describe(slot.r, take));
        }
        was = 'by later receipts';
      }
      repaid = Number(Math.min(repaid, x.amount).toFixed(2));
      total.amount += x.amount;
      total.charge += x.charge;
      total.charge_paid += x.charge_paid;
      total.repaid += repaid;
      rows.push({
        kind: 'row',
        cells: {
          sr: i + 1,
          bounced_on: dmy(x.bounced_on),
          received_on: dmy(x.received_on),
          receipt_no: x.receipt_no,
          admission_no: x.admission_no,
          student: x.student,
          class: x.class,
          mode: x.mode,
          instrument_no: x.instrument_no,
          instrument_date: dmy(x.instrument_date),
          bank_name: x.bank_name,
          amount: x.amount,
          cheque_status: 'Bounced',
          reason: x.reason,
          charge: x.charge,
          charge_paid: x.charge_paid,
          fee_of: was,
          repaid,
          balance: Number((x.amount - repaid).toFixed(2)),
          repay_status: repaid >= x.amount - 0.005 ? 'Paid' : repaid > 0 ? 'Part paid' : 'Not paid',
          repay_by: papers.join('; '),
          approved_by: x.approved_by,
        },
      });
    });
    rows.push({
      kind: 'total',
      label: 'Total',
      cells: { ...total, balance: Number((total.amount - total.repaid).toFixed(2)) },
    });
    return {
      report: 'cheque_bounce',
      title: 'Cheque bounce report',
      filters: [
        `Bounced ${dmy(from)} to ${dmy(to)}`,
        q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers',
      ],
      note: 'Paid again is worked out from the fee the cheque had paid: how much of those fee lines is paid today, and by which receipts. For a bounce recorded before this was kept (shown as "by later receipts"), the pupil’s receipts after the bounce are counted against it, the oldest bounce first.',
      columns: [
        num('sr', 'Sr No', undefined, 5),
        text('bounced_on', 'Bounced on', 9),
        text('received_on', 'Receipt date', 9),
        text('receipt_no', 'Receipt no.', 15),
        text('admission_no', 'Admission no.', 10),
        text('student', 'Student', 18),
        text('class', 'Class', 7),
        text('mode', 'Mode', 8),
        text('instrument_no', 'Cheque / DD no.', 9),
        text('instrument_date', 'Cheque date', 9),
        text('bank_name', 'Bank', 13),
        num('amount', 'Amount'),
        text('cheque_status', 'Cheque status', 8),
        text('reason', 'Reason', 18),
        num('charge', 'Bounce charge'),
        num('charge_paid', 'Charge paid'),
        text('fee_of', 'Fee it had paid', 12, 'Paid again'),
        num('repaid', 'Amount', 'Paid again'),
        num('balance', 'Still due', 'Paid again'),
        text('repay_status', 'Status', 8, 'Paid again'),
        text('repay_by', 'Receipt · date · mode', 30, 'Paid again'),
        text('approved_by', 'Approved by', 12),
      ],
      rows,
    };
  }

  // ---- one row per pupil: payable and paid by fee head, or by month ------------------------------------
  private async pupilWise(
    c: PoolClient,
    yearId: string,
    q: FeeMisQueryDto,
    by: 'head' | 'month',
  ): Promise<MisReport> {
    const periods = await c.query<{ id: string; sequence: number; name: string }>(
      `SELECT id::text, sequence, name FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
      [yearId],
    );
    if (periods.rows.length === 0)
      throw new DomainError('fees.no_periods', 'The fee months of this session are not set up', {
        status: 409,
      });
    const first = q.fromSeq ?? periods.rows[0]!.sequence;
    const last = q.toSeq ?? periods.rows[periods.rows.length - 1]!.sequence;
    if (first > last)
      throw new DomainError('validation-failed', 'The first month is after the last', {
        status: 400,
      });
    const months = periods.rows.filter((p) => p.sequence >= first && p.sequence <= last);
    const pupils = await c.query<Record<string, string | null>>(
      `SELECT s.id::text, s.admission_no, s.display_name AS student, k.code || '-' || cs.name AS class, s.gender::text, s.status::text, s.category::text,
              COALESCE(fp.student_type::text, '') AS student_type,
              (SELECT fd.name FROM fee_discounts fd WHERE fd.id = fp.discount_id) AS discount,
              (SELECT rt.code || ' ' || rt.name FROM student_route_assignments ra JOIN transport_routes rt ON rt.id = ra.route_id
                WHERE ra.student_id = s.id AND ra.academic_year_id = $1 LIMIT 1) AS route,
              (SELECT sl.name FROM transport_slabs sl WHERE sl.id = fp.transport_slab_id) AS slab,
              g.name AS father, g.mobile
         FROM students s
         JOIN LATERAL (SELECT e.class_section_id FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $1
                        ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true
         JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
         LEFT JOIN student_fee_profiles fp ON fp.student_id = s.id AND fp.academic_year_id = $1
         LEFT JOIN LATERAL (SELECT gu.display_name AS name, gu.mobile FROM student_guardians sg JOIN guardians gu ON gu.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND gu.deleted_at IS NULL ORDER BY (sg.relation = 'father') DESC, sg.is_primary DESC, sg.id LIMIT 1) g ON true
        WHERE s.deleted_at IS NULL AND ($2::bigint IS NULL OR cs.class_id = $2)
          AND EXISTS (SELECT 1 FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1)
        ORDER BY k.display_order, cs.name, s.display_name
        LIMIT 5000`,
      [yearId, q.classId ?? null],
    );
    const ids = pupils.rows.map((p) => p.id!);
    const dem = await c.query<{
      student_id: string;
      col: string;
      gross: number;
      discount: number;
      net: number;
      paid: number;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- the grouping column is one of two fixed fragments; values are bound parameters
      `SELECT d.student_id::text,
              ${
                by === 'month'
                  ? `fp.sequence::text`
                  : `CASE WHEN EXISTS (SELECT 1 FROM fee_adjustments j WHERE j.charge_demand_id = d.id) THEN 'bounce'
                          WHEN h.kind = 'opening_balance' THEN CASE WHEN d.net < 0 THEN 'opening_cr' ELSE 'opening_dr' END ELSE h.id::text END`
              } AS col,
              sum(d.gross)::float AS gross, sum(d.discount)::float AS discount, sum(d.net)::float AS net, sum(d.paid)::float AS paid
         FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id JOIN fee_heads h ON h.id = d.head_id
        WHERE d.academic_year_id = $1 AND d.student_id = ANY($2::bigint[]) AND d.status <> 'cancelled' AND fp.sequence BETWEEN $3 AND $4
        GROUP BY 1, 2`,
      [yearId, ids, first, last],
    );
    const extra = await c.query<{
      student_id: string;
      late: number;
      bounce: number;
      waived: number;
      refunded: number;
    }>(
      `SELECT s.id::text AS student_id,
              COALESCE((SELECT sum(l.amount) FROM fee_late_fee_postings l JOIN fee_payments p ON p.id = l.payment_id
                         WHERE p.student_id = s.id AND p.academic_year_id = $1 AND p.status IN ('posted', 'partly_refunded', 'refunded')), 0)::float AS late,
              COALESCE((SELECT sum(a.charge) FROM fee_adjustments a WHERE a.student_id = s.id AND a.academic_year_id = $1 AND a.kind = 'bounce' AND a.status = 'approved'), 0)::float AS bounce,
              COALESCE((SELECT sum(a.amount) FROM fee_adjustments a WHERE a.student_id = s.id AND a.academic_year_id = $1 AND a.kind = 'waiver' AND a.status = 'approved' AND a.undone_at IS NULL), 0)::float AS waived,
              COALESCE((SELECT sum(r.amount) FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id
                         WHERE COALESCE(r.student_id, p.student_id) = s.id AND COALESCE(r.academic_year_id, p.academic_year_id) = $1 AND r.status = 'paid'), 0)::float AS refunded
         FROM students s WHERE s.id = ANY($2::bigint[])`,
      [yearId, ids],
    );
    const more = new Map(extra.rows.map((x) => [x.student_id, x]));
    const cell = new Map<string, Map<string, (typeof dem.rows)[number]>>();
    const used = new Set<string>();
    for (const d of dem.rows) {
      const m = cell.get(d.student_id) ?? new Map<string, (typeof dem.rows)[number]>();
      m.set(d.col, d);
      cell.set(d.student_id, m);
      used.add(d.col);
    }
    let cols: Array<{ key: string; label: string }>;
    if (by === 'month')
      cols = months.map((p) => ({ key: String(p.sequence), label: p.name.split(' ')[0]! }));
    else {
      const heads = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM fee_heads WHERE deleted_at IS NULL ORDER BY sort_order, id`,
      );
      cols = [
        ...(used.has('opening_dr') ? [{ key: 'opening_dr', label: 'Opening Dr.' }] : []),
        ...heads.rows.filter((h) => used.has(h.id)).map((h) => ({ key: h.id, label: h.name })),
        ...(used.has('bounce') ? [{ key: 'bounce', label: 'Bounce charge' }] : []),
        ...(used.has('opening_cr') ? [{ key: 'opening_cr', label: 'Opening Credit Balance' }] : []),
      ];
    }
    const identity: MisColumn[] = [
      num('sr', 'Sr No', undefined, 5),
      text('admission_no', 'Admission', 10),
      text('student', 'Name', 20),
      text('class', 'Class', 7),
      text('father', 'Father Name', 18),
      text('mobile', 'Mobile No', 11),
      text('discount', 'Discount Type', 12),
      text('route', 'Route', 13),
      text('slab', 'Slab', 10),
      text('student_type', 'Student Type', 8),
      text('gender', 'Gender', 6),
      text('status', 'Status', 7),
      text('category', 'Student Category', 8),
    ];
    const columns: MisColumn[] = [
      ...identity,
      ...cols.map((x) => num(`due_${x.key}`, x.label, 'Payable')),
      num('concession', 'Concession', 'Payable'),
      num('due', 'Total Due', 'Payable'),
      ...cols.map((x) => num(`paid_${x.key}`, x.label, 'Paid')),
      num('refunded', 'Refunded', 'Paid'),
      num('paid', 'Total Paid', 'Paid'),
      num('balance', 'Balance'),
      num('late', 'Total Late Fee'),
      num('bounce', 'Total Bounce Charge'),
      ...(by === 'head' ? [num('waived', 'Waive Off')] : []),
    ];
    const total: Record<string, number> = {};
    const cleared: Record<string, number> = {};
    const rows: MisRow[] = pupils.rows.map((p, i) => {
      const m = cell.get(p.id!) ?? new Map<string, (typeof dem.rows)[number]>();
      const x = more.get(p.id!);
      const figures: Record<string, number> = {};
      let due = 0;
      let paid = 0;
      let concession = 0;
      for (const col of cols) {
        const d = m.get(col.key);
        // the head as charged; the concession on it is one column, so heads less concession is the total due
        figures[`due_${col.key}`] = by === 'head' ? (d?.gross ?? 0) : (d?.net ?? 0);
        figures[`paid_${col.key}`] = d?.paid ?? 0;
        due += d?.net ?? 0;
        paid += d?.paid ?? 0;
        concession += d?.discount ?? 0;
        if (d && d.net > 0 && d.paid >= d.net - 0.005)
          cleared[col.key] = (cleared[col.key] ?? 0) + 1;
      }
      figures.concession = concession;
      figures.due = due;
      figures.refunded = x?.refunded ?? 0;
      figures.paid = paid;
      figures.balance = Number((due - paid).toFixed(2));
      figures.late = x?.late ?? 0;
      figures.bounce = x?.bounce ?? 0;
      if (by === 'head') figures.waived = x?.waived ?? 0;
      for (const [k, v] of Object.entries(figures)) total[k] = (total[k] ?? 0) + v;
      return {
        kind: 'row' as const,
        cells: {
          sr: i + 1,
          admission_no: p.admission_no ?? '',
          student: p.student ?? '',
          class: p.class ?? '',
          father: p.father ?? '',
          mobile: p.mobile ?? '',
          discount: p.discount ?? '',
          route: p.route ?? '',
          slab: p.slab ?? '',
          student_type: p.student_type ?? '',
          gender: p.gender ?? '',
          status: p.status ?? '',
          category: p.category ?? '',
          ...figures,
        },
      };
    });
    rows.push({ kind: 'total', label: 'Total', cells: { ...total } });
    if (by === 'month')
      rows.push({
        kind: 'subtotal',
        label: 'Pupils who have paid the month in full',
        // a count of pupils, not money: written as it is
        cells: Object.fromEntries(cols.map((x) => [`paid_${x.key}`, String(cleared[x.key] ?? 0)])),
      });
    const span = `${months[0]?.name ?? ''} to ${months[months.length - 1]?.name ?? ''}`;
    return {
      report: by === 'head' ? 'period_headwise' : 'yearly_projection',
      title:
        by === 'head' ? 'Period fee, head-wise (pupil-wise)' : 'Yearly fee projection (month-wise)',
      filters: [
        span,
        q.classId ? 'One class' : 'All classes',
        `${String(pupils.rows.length)} pupil(s)`,
      ],
      note:
        by === 'head'
          ? 'Payable shows each head as charged for the months chosen; Concession is the discount and waiver on them; Total Due is heads less concession. Paid is what receipts hold against each head today. Late fee, bounce charge, waive-off and refunds are for the whole session.'
          : 'Payable is the fee of each month after concession; Paid is what receipts hold against that month today. Late fee, bounce charge and refunds are for the whole session. The last row counts the pupils whose month is paid in full.',
      columns,
      rows,
    };
  }

  /** The report as Excel or PDF, laid out as on the screen. */
  async file(ctx: RequestContext, id: MisReportId, q: FeeMisQueryDto, format: 'xlsx' | 'pdf') {
    const r = await this.report(ctx, id, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const first = r.columns[0]!.key;
    // a heading or a total writes its words in the first text column
    const words = r.columns.find((x) => x.type === 'text')?.key ?? first;
    const strong: number[] = [];
    const rows = r.rows.map((row, i) => {
      if (row.kind !== 'row') strong.push(i);
      return r.columns.map((col) => {
        if (row.kind !== 'row' && col.key === words && row.label) return row.label;
        const v = row.cells[col.key];
        if (v === null || v === undefined) return '';
        return col.type === 'number' && typeof v === 'number' ? Number(v.toFixed(2)) : v;
      });
    });
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: r.title,
        details: [r.filters.join(' · '), generatedOn()],
        legend: r.note,
        columns: r.columns.map((col) => ({
          label: col.label,
          width: col.width,
          right: col.type === 'number',
          group: col.group,
        })),
        rows,
        strong,
        fontSize:
          r.columns.length > 40
            ? 4.5
            : r.columns.length > 28
              ? 5.5
              : r.columns.length > 18
                ? 6.5
                : 8,
        filename: r.report.replace(/_/g, '-'),
      },
      format,
    );
  }
}
