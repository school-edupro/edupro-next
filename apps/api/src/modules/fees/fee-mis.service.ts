import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { datasetOrNull } from '@edupro/db';
import { schoolHead } from '../attendance/register-file';
import { misPdf, misXlsx } from './mis-file';
import type { FeeMisQueryDto } from './fees.dto';

export type MisReportId =
  | 'defaulters'
  | 'day_book'
  | 'forecast'
  | 'check'
  | 'mode_daywise'
  | 'head_receipts'
  | 'cheque_bounce'
  | 'daybook_grouped'
  | 'period_headwise'
  | 'yearly_projection'
  | 'misc_dues';

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
  /** 1 = the outer grouping (a date), 2 = the inner one (a payment mode). */
  level?: 1 | 2;
  label?: string;
  cells: Record<string, string | number | null>;
}
/** A small table under the main one: totals by mode, by ledger. */
export interface MisBlock {
  title: string;
  columns: MisColumn[];
  rows: MisRow[];
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
  blocks?: MisBlock[];
  /** The name of the Excel sheet. */
  sheet?: string;
  /** Every column the report has, for the column chooser: which are left out, which cannot be. */
  choice?: {
    columns: Array<{ key: string; label: string; group?: string; fixed: boolean; hidden: boolean }>;
    /** Whose choice is in force: the user's own, the school's default, or none (all columns). */
    source: 'user' | 'school' | 'all';
    schoolHidden: string[];
  };
  /** The columns left out, by name, for the line under the table and in the file. */
  hidden?: string[];
}

/** Columns that always stay: they name the row, or they are the totals the other reports agree with. */
const FIXED = new Set([
  'sr',
  'date',
  'receipt_no',
  'admission_no',
  'student',
  'payer',
  'name',
  'total',
  'due',
  'paid',
  'balance',
  'amount',
  'final',
  'final2',
  'e_all',
  'c_all',
  'b_all',
]);
/** The check is not laid out by choice: every line of it matters. */
const NO_CHOICE: MisReportId[] = ['check'];
const prefKey = (id: MisReportId) => `fees.report.${id}`;
const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

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
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.build(c, yearId, id, q);
      return NO_CHOICE.includes(id) ? r : this.laidOut(r, await this.layout(c, ctx, id));
    });
  }

  private build(c: PoolClient, yearId: string, id: MisReportId, q: FeeMisQueryDto) {
    if (id === 'defaulters') return this.defaulters(c, yearId, q);
    if (id === 'day_book') return this.dayBook(c, q);
    if (id === 'forecast') return this.forecast(c, yearId, q);
    if (id === 'check') return this.check(c, yearId, q);
    if (id === 'mode_daywise') return this.modeDaywise(c, q);
    if (id === 'head_receipts') return this.headReceipts(c, q, false);
    if (id === 'daybook_grouped') return this.headReceipts(c, q, true);
    if (id === 'cheque_bounce') return this.chequeBounce(c, q);
    if (id === 'period_headwise') return this.pupilWise(c, yearId, q, 'head');
    if (id === 'misc_dues') return this.miscDues(c, yearId, q);
    return this.pupilWise(c, yearId, q, 'month');
  }

  // ---- which columns a report shows: the user's own choice, else the school's default ---------------
  private async layout(c: PoolClient, ctx: RequestContext, id: MisReportId) {
    const mine = await c.query<{ value: { hidden?: unknown } | null }>(
      `SELECT value FROM user_preferences WHERE user_id = $1 AND pref_key = $2`,
      [ctx.user.id, prefKey(id)],
    );
    const school = await c.query<{ v: Record<string, unknown> | null }>(
      `SELECT app.setting('fees.report_columns') AS v`,
    );
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
    return {
      user: mine.rows[0] ? list(mine.rows[0].value?.hidden) : null,
      school: list(school.rows[0]?.v?.[id]) ?? [],
    };
  }

  /** The report with the chosen columns left out. The figures are not touched: totals stay full. */
  private laidOut(r: MisReport, lay: { user: string[] | null; school: string[] }): MisReport {
    const chosen = new Set(lay.user ?? lay.school);
    const isHidden = (c: MisColumn) => !FIXED.has(c.key) && chosen.has(c.key);
    const gone = r.columns.filter(isHidden);
    return {
      ...r,
      columns: r.columns.filter((c) => !isHidden(c)),
      choice: {
        columns: r.columns.map((c) => ({
          key: c.key,
          label: c.label,
          group: c.group,
          fixed: FIXED.has(c.key),
          hidden: isHidden(c),
        })),
        source: lay.user ? 'user' : lay.school.length ? 'school' : 'all',
        schoolHidden: lay.school,
      },
      hidden: gone.map((c) => (c.group ? `${c.group}: ${c.label}` : c.label)),
    };
  }

  /** The user's own columns for a report, or (with the right) the school's default for everyone. */
  async saveColumns(
    ctx: RequestContext,
    id: MisReportId,
    dto: { hidden: string[]; scope: 'user' | 'school' },
  ) {
    if (NO_CHOICE.includes(id))
      throw new DomainError('validation-failed', 'This report has a fixed layout', { status: 400 });
    const hidden = [...new Set(dto.hidden)].filter((k) => !FIXED.has(k));
    if (dto.scope === 'school' && !ctx.permissions?.has('fees.master.manage'))
      throw new DomainError(
        'permission-denied',
        'Setting the school default needs the right to manage fee masters',
        { status: 403, extra: { permission: 'fees.master.manage' } },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.scope === 'user') {
        await c.query(
          `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb)
           ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [ctx.user.id, prefKey(id), JSON.stringify({ hidden })],
        );
        return { scope: 'user', hidden };
      }
      const cur = await c.query<{ v: Record<string, string[]> | null }>(
        `SELECT app.setting('fees.report_columns') AS v`,
      );
      const next = { ...(cur.rows[0]?.v ?? {}), [id]: hidden };
      // as SettingsService.set: close the open row, replace today's, insert the new value
      await c.query(
        `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
          WHERE key = 'fees.report_columns' AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
      );
      await c.query(
        `DELETE FROM school_settings WHERE key = 'fees.report_columns' AND valid_from = CURRENT_DATE`,
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), 'fees.report_columns', $1::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
        [JSON.stringify(next)],
      );
      // the one who sets the default sees it at once: their own choice for this report is dropped
      await c.query(`DELETE FROM user_preferences WHERE user_id = $1 AND pref_key = $2`, [
        ctx.user.id,
        prefKey(id),
      ]);
      return { scope: 'school', hidden };
    });
  }

  /** Back to the school's default: the user's own choice for the report is dropped. */
  async resetColumns(ctx: RequestContext, id: MisReportId) {
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(`DELETE FROM user_preferences WHERE user_id = $1 AND pref_key = $2`, [
        ctx.user.id,
        prefKey(id),
      ]),
    );
    return { reset: true };
  }

  // ---- defaulters: who owes fee that is past its due date, with the parents to reach -------------------
  /** One row per pupil with overdue fee; `ids` narrows it to chosen pupils (for a reminder). */
  async defaulterRows(c: PoolClient, yearId: string, q: FeeMisQueryDto, ids?: string[]) {
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const asOf = q.asOf ?? today;
    const r = await c.query<{
      student_id: string;
      admission_no: string;
      student: string;
      class: string | null;
      section: string | null;
      gender: string | null;
      status: string;
      father: string | null;
      father_mobile: string | null;
      father_email: string | null;
      mother: string | null;
      mother_mobile: string | null;
      mother_email: string | null;
      contact: string | null;
      contact_mobile: string | null;
      contact_email: string | null;
      route: string | null;
      slab: string | null;
      discount: string | null;
      oldest_due: string;
      days_overdue: number;
      /** Fee that has fallen due by the date, what is paid of it, and what is left. */
      due: number;
      paid: number;
      balance: number;
      months: string | null;
      last_reminded_on: string | null;
      reminded_today: boolean;
      /** The channels the pupil was already reminded on today. */
      reminded_channels: string[];
      heads: string | null;
      section_name: string | null;
      class_name: string | null;
      roll_no: string | null;
      last_paid_on: string | null;
      last_paid_amount: number | null;
    }>(
      `WITH due AS (
         SELECT d.student_id, sum(d.net)::float AS due, sum(d.paid)::float AS paid, sum(d.net - d.paid)::float AS balance,
                min(d.due_on) FILTER (WHERE d.net > d.paid) AS oldest,
                (SELECT string_agg(DISTINCT h.name, ', ') FROM fee_demands d2 JOIN fee_heads h ON h.id = d2.head_id
                  WHERE d2.student_id = d.student_id AND d2.academic_year_id = $1 AND d2.status IN ('pending', 'partial') AND d2.net > d2.paid AND d2.due_on < $2::date) AS heads,
                string_agg(DISTINCT lpad(fp.sequence::text, 2, '0') || ':' || to_char(make_date(fp.year, fp.month, 1), 'Mon'), ',')
                  FILTER (WHERE d.net > d.paid) AS months
           FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
          -- every fee line that has fallen due, paid or not: so Due, Paid and Balance can be shown
          WHERE d.academic_year_id = $1 AND d.status IN ('pending', 'partial', 'paid') AND d.net > 0 AND d.due_on < $2::date
            AND ($7::text IS NULL OR d.ledger::text = $7)
          GROUP BY d.student_id
         HAVING sum(d.net - d.paid) > 0)
       SELECT s.id::text AS student_id, s.admission_no, s.display_name AS student, k.code || '-' || cs.name AS class, cs.name AS section,
              s.gender::text, s.status::text,
              f.name AS father, f.mobile AS father_mobile, f.email AS father_email,
              m.name AS mother, m.mobile AS mother_mobile, m.email AS mother_email,
              n.name AS contact, n.mobile AS contact_mobile, n.email AS contact_email,
              (SELECT rt.code || ' ' || rt.name FROM student_route_assignments ra JOIN transport_routes rt ON rt.id = ra.route_id
                WHERE ra.student_id = s.id AND ra.academic_year_id = $1 LIMIT 1) AS route,
              (SELECT sl.name FROM transport_slabs sl WHERE sl.id = fp.transport_slab_id) AS slab,
              COALESCE((SELECT fd.name FROM fee_discounts fd WHERE fd.id = fp.discount_id),
                       (SELECT string_agg(DISTINCT fd.name, ', ') FROM student_fee_discounts sd JOIN fee_discounts fd ON fd.id = sd.discount_id
                         WHERE sd.student_id = s.id AND sd.academic_year_id = $1 AND sd.status = 'active')) AS discount,
              due.oldest::text AS oldest_due, ($2::date - due.oldest)::int AS days_overdue, due.due, due.paid, due.balance, due.months, due.heads,
              cs.name AS section_name, k.name AS class_name,
              (SELECT e.roll_no::text FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $1 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS roll_no,
              lp.received_on::text AS last_paid_on, lp.amount::float AS last_paid_amount,
              (SELECT max(fr.sent_on)::text FROM fee_reminders fr WHERE fr.student_id = s.id AND fr.misc_fee_id IS NULL) AS last_reminded_on,
              EXISTS (SELECT 1 FROM fee_reminders fr WHERE fr.student_id = s.id AND fr.misc_fee_id IS NULL AND fr.sent_on = CURRENT_DATE) AS reminded_today,
              COALESCE((SELECT array_agg(DISTINCT fr.channel::text) FROM fee_reminders fr WHERE fr.student_id = s.id AND fr.misc_fee_id IS NULL AND fr.sent_on = CURRENT_DATE), '{}') AS reminded_channels
         FROM due JOIN students s ON s.id = due.student_id AND s.deleted_at IS NULL
         LEFT JOIN LATERAL (SELECT e.class_section_id FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $1
                             ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true
         LEFT JOIN class_sections cs ON cs.id = en.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
         LEFT JOIN student_fee_profiles fp ON fp.student_id = s.id AND fp.academic_year_id = $1
         LEFT JOIN LATERAL (SELECT p.received_on, p.amount FROM fee_payments p
                             WHERE p.student_id = s.id AND p.status IN ('posted', 'partly_refunded', 'refunded') ORDER BY p.received_on DESC, p.id DESC LIMIT 1) lp ON true
         LEFT JOIN LATERAL (SELECT g.display_name AS name, g.mobile, g.email::text AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.relation = 'father' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) f ON true
         LEFT JOIN LATERAL (SELECT g.display_name AS name, g.mobile, g.email::text AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.relation = 'mother' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) m ON true
         LEFT JOIN LATERAL (SELECT g.display_name AS name, g.mobile, g.email::text AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.receives_notifications AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) n ON true
        WHERE due.balance >= $3::numeric
          AND ($4::bigint IS NULL OR cs.class_id = $4)
          AND ($5::text IS NULL
               OR ($5 = 'none' AND fp.discount_id IS NULL AND NOT EXISTS (SELECT 1 FROM student_fee_discounts sd WHERE sd.student_id = s.id AND sd.academic_year_id = $1 AND sd.status = 'active'))
               OR ($5 <> 'none' AND (fp.discount_id::text = $5 OR EXISTS (SELECT 1 FROM student_fee_discounts sd WHERE sd.student_id = s.id AND sd.academic_year_id = $1 AND sd.status = 'active' AND sd.discount_id::text = $5))))
          AND ($6::bigint[] IS NULL OR s.id = ANY($6::bigint[]))
        ORDER BY k.display_order NULLS LAST, cs.name, s.display_name
        LIMIT 10000`,
      [
        yearId,
        asOf,
        Math.max(q.minBalance ?? 1, 0.01),
        q.classId ?? null,
        q.discountId ?? null,
        ids ?? null,
        q.ledger ?? null,
      ],
    );
    // the months in the order of the session: "Jul, Aug" or, for a longer run, "Jul to Dec"
    const inOrder = (raw: string | null) => {
      const names = (raw ?? '')
        .split(',')
        .filter(Boolean)
        .sort()
        .map((x) => x.slice(3));
      return names.length > 3 ? `${names[0]!} to ${names[names.length - 1]!}` : names.join(', ');
    };
    return { asOf, rows: r.rows.map((x) => ({ ...x, months: inOrder(x.months) })) };
  }

  private async defaulters(c: PoolClient, yearId: string, q: FeeMisQueryDto): Promise<MisReport> {
    const { asOf, rows: list } = await this.defaulterRows(c, yearId, q);
    const total = list.reduce((a, x) => a + x.balance, 0);
    const rows: MisRow[] = list.map((x, i) => ({
      kind: 'row',
      cells: {
        // not a column: the screen ticks pupils by it
        student_id: x.student_id,
        sr: i + 1,
        admission_no: x.admission_no,
        student: x.student,
        class: x.class ?? '',
        gender: x.gender ?? '',
        status: x.status,
        father: x.father ?? '',
        father_mobile: x.father_mobile ?? '',
        mother: x.mother ?? '',
        mother_mobile: x.mother_mobile ?? '',
        route: x.route ?? '',
        slab: x.slab ?? '',
        discount: x.discount ?? '',
        months: x.months ?? '',
        oldest_due: dmy(x.oldest_due),
        days_overdue: String(x.days_overdue),
        due: x.due,
        paid: x.paid,
        balance: x.balance,
        last_reminded: x.last_reminded_on ? dmy(x.last_reminded_on) : 'Never',
      },
    }));
    rows.push({
      kind: 'total',
      label: `Total · ${String(list.length)} pupil(s)`,
      cells: {
        due: list.reduce((a, x) => a + x.due, 0),
        paid: list.reduce((a, x) => a + x.paid, 0),
        balance: total,
      },
    });
    return {
      report: 'defaulters',
      title: 'Fee defaulters',
      filters: [
        `Overdue as on ${dmy(asOf)}`,
        q.classId ? 'One class' : 'All classes',
        q.discountId
          ? q.discountId === 'none'
            ? 'No discount'
            : 'One discount type'
          : 'All discount types',
        ...(q.minBalance ? [`Balance of Rs. ${String(q.minBalance)} or more`] : []),
        ...(q.ledger ? [`Ledger: ${q.ledger}`] : []),
      ],
      note: 'A pupil is listed when fee past its due date is unpaid on the date chosen. Due is the fee that has fallen due by that date, Paid is what has been received against it, Balance is the rest; fee not yet due and late fee are not counted. Worked out from the bills at the moment the report is opened.',
      columns: [
        num('sr', 'Sr No', undefined, 5),
        text('admission_no', 'Admission no.', 10),
        text('student', 'Student', 20),
        text('class', 'Class', 8),
        text('gender', 'Gender', 6),
        text('status', 'Status', 7),
        text('father', 'Father', 18),
        text('father_mobile', 'Father mobile', 11),
        text('mother', 'Mother', 18),
        text('mother_mobile', 'Mother mobile', 11),
        text('route', 'Route', 13),
        text('slab', 'Slab', 10),
        text('discount', 'Discount type', 13),
        text('months', 'Months due', 14),
        text('oldest_due', 'Oldest due', 9),
        text('days_overdue', 'Days overdue', 7),
        num('due', 'Due', undefined, 12),
        num('paid', 'Paid', undefined, 12),
        num('balance', 'Balance', undefined, 12),
        text('last_reminded', 'Last reminded', 9),
      ],
      rows,
    };
  }

  // ---- misc fees announced to pupils: who has paid and who has not --------------------------------------
  /** A row for each pupil of each announced misc fee; the reminder screen reads the same rows. */
  async miscDueRows(c: PoolClient, yearId: string, q: FeeMisQueryDto, lineIds?: string[]) {
    const r = await c.query<{
      line_id: string;
      fee_id: string;
      student_id: string;
      admission_no: string;
      student: string;
      class: string | null;
      class_name: string | null;
      section_name: string | null;
      roll_no: string | null;
      father: string | null;
      father_mobile: string | null;
      father_email: string | null;
      mother: string | null;
      mother_mobile: string | null;
      mother_email: string | null;
      contact: string | null;
      contact_mobile: string | null;
      contact_email: string | null;
      fee: string;
      head: string;
      mandatory: boolean;
      seats: number | null;
      last_date: string;
      amount: number;
      paid: number;
      balance: number;
      state: string;
      receipts: string | null;
      last_paid_on: string | null;
      reminded_channels: string[];
      last_reminded_on: string | null;
    }>(
      `SELECT l.id::text AS line_id, mf.id::text AS fee_id, s.id::text AS student_id, s.admission_no, s.display_name AS student, k.code || '-' || cs.name AS class,
              k.name AS class_name, cs.name AS section_name, en.roll_no::text AS roll_no,
              f.name AS father, f.mobile AS father_mobile, f.email AS father_email,
              m.name AS mother, m.mobile AS mother_mobile, m.email AS mother_email,
              n.name AS contact, n.mobile AS contact_mobile, n.email AS contact_email,
              mf.title AS fee, h.name AS head, mf.mandatory, mf.seats, COALESCE(l.last_date, mf.last_date)::text AS last_date,
              l.amount::float AS amount, l.paid::float AS paid, (l.amount - l.paid)::float AS balance,
              CASE WHEN l.paid >= l.amount THEN 'Paid'
                   WHEN mf.status = 'closed' OR (NOT mf.mandatory AND COALESCE(l.last_date, mf.last_date) < CURRENT_DATE) THEN 'Closed'
                   WHEN mf.seats IS NOT NULL AND l.paid = 0 AND (SELECT count(*) FROM misc_fee_students x WHERE x.misc_fee_id = mf.id AND x.status = 'paid') >= mf.seats THEN 'Seats full'
                   WHEN l.paid > 0 THEN 'Part paid'
                   WHEN COALESCE(l.last_date, mf.last_date) < CURRENT_DATE THEN 'Overdue' ELSE 'Unpaid' END AS state,
              (SELECT string_agg(r.receipt_no, ', ' ORDER BY r.id) FROM misc_receipts r WHERE r.misc_fee_student_id = l.id AND r.status = 'posted') AS receipts,
              (SELECT max(r.received_on)::text FROM misc_receipts r WHERE r.misc_fee_student_id = l.id AND r.status = 'posted') AS last_paid_on,
              COALESCE((SELECT array_agg(DISTINCT fr.channel::text) FROM fee_reminders fr WHERE fr.student_id = s.id AND fr.misc_fee_id = mf.id AND fr.sent_on = CURRENT_DATE), '{}') AS reminded_channels,
              (SELECT max(fr.sent_on)::text FROM fee_reminders fr WHERE fr.student_id = s.id AND fr.misc_fee_id = mf.id) AS last_reminded_on
         FROM misc_fee_students l JOIN misc_fees mf ON mf.id = l.misc_fee_id JOIN fee_heads h ON h.id = mf.head_id
         JOIN students s ON s.id = l.student_id AND s.deleted_at IS NULL
         LEFT JOIN LATERAL (SELECT e.class_section_id, e.roll_no FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $1
                             ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true
         LEFT JOIN class_sections cs ON cs.id = en.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
         LEFT JOIN LATERAL (SELECT g.display_name AS name, g.mobile, g.email::text AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.relation = 'father' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) f ON true
         LEFT JOIN LATERAL (SELECT g.display_name AS name, g.mobile, g.email::text AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.relation = 'mother' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) m ON true
         LEFT JOIN LATERAL (SELECT g.display_name AS name, g.mobile, g.email::text AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.receives_notifications AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) n ON true
        WHERE mf.academic_year_id = $1 AND mf.status IN ('announced', 'closed') AND l.status <> 'cancelled'
          AND ($2::bigint IS NULL OR mf.id = $2) AND ($3::bigint IS NULL OR mf.head_id = $3) AND ($4::bigint IS NULL OR cs.class_id = $4)
          AND ($5::text IS NULL OR ($5 = 'paid' AND l.paid >= l.amount) OR ($5 = 'due' AND l.paid < l.amount)
               OR ($5 = 'unpaid' AND l.paid = 0 AND l.amount > 0) OR ($5 = 'part' AND l.paid > 0 AND l.paid < l.amount))
          AND ($6::date IS NULL OR COALESCE(l.last_date, mf.last_date) >= $6::date) AND ($7::date IS NULL OR COALESCE(l.last_date, mf.last_date) <= $7::date)
          AND ($8::bigint[] IS NULL OR l.id = ANY($8::bigint[]))
        ORDER BY mf.id DESC, k.display_order NULLS LAST, cs.name, s.display_name
        LIMIT 20000`,
      [
        yearId,
        q.miscFeeId ?? null,
        q.headId ?? null,
        q.classId ?? null,
        q.pay ?? null,
        q.from ?? null,
        q.to ?? null,
        lineIds ?? null,
      ],
    );
    return r.rows;
  }

  private async miscDues(c: PoolClient, yearId: string, q: FeeMisQueryDto): Promise<MisReport> {
    const list = await this.miscDueRows(c, yearId, q);
    const rows: MisRow[] = list.map((x, i) => ({
      kind: 'row',
      cells: {
        // not columns: the screen ticks pupils by the line
        line_id: x.line_id,
        student_id: x.student_id,
        sr: i + 1,
        admission_no: x.admission_no,
        student: x.student,
        class: x.class ?? '',
        father: x.father ?? '',
        father_mobile: x.father_mobile ?? '',
        mother: x.mother ?? '',
        mother_mobile: x.mother_mobile ?? '',
        fee: x.fee,
        head: x.head,
        mandatory: x.mandatory ? 'Mandatory' : 'Optional',
        last_date: dmy(x.last_date),
        due: x.amount,
        paid: x.paid,
        balance: x.balance,
        pay_status: x.state,
        receipts: x.receipts ?? '',
        last_paid: x.last_paid_on ? dmy(x.last_paid_on) : '',
        last_reminded: x.last_reminded_on ? dmy(x.last_reminded_on) : 'Never',
      },
    }));
    rows.push({
      kind: 'total',
      label: `Total · ${String(list.length)} row(s)`,
      cells: {
        due: list.reduce((a, x) => a + x.amount, 0),
        paid: list.reduce((a, x) => a + x.paid, 0),
        balance: list.reduce((a, x) => a + x.balance, 0),
      },
    });
    const pay = { due: 'Unpaid and part paid', unpaid: 'Unpaid', part: 'Part paid', paid: 'Paid' };
    return {
      report: 'misc_dues',
      title: 'Misc fee dues',
      sheet: 'Misc fee dues',
      filters: [
        q.miscFeeId ? `Fee: ${list[0]?.fee ?? 'one fee'}` : 'All misc fees',
        q.classId ? 'One class' : 'All classes',
        q.pay ? pay[q.pay] : 'Paid and unpaid',
        ...(q.from || q.to
          ? [`Last date ${q.from ? dmy(q.from) : 'start'} to ${q.to ? dmy(q.to) : 'end'}`]
          : []),
      ],
      note: 'A row for each pupil of each announced misc fee. Due is the amount set for the pupil, Paid is what misc receipts hold against it after cancelled, bounced and refunded receipts are taken off. An optional fee past its last date shows Closed and is not asked for again.',
      columns: [
        num('sr', 'Sr No', undefined, 5),
        text('admission_no', 'Admission no.', 10),
        text('student', 'Student', 20),
        text('class', 'Class', 8),
        text('father', 'Father', 18),
        text('father_mobile', 'Father mobile', 11),
        text('mother', 'Mother', 18),
        text('mother_mobile', 'Mother mobile', 11),
        text('fee', 'Misc fee', 20),
        text('head', 'Head', 13),
        text('mandatory', 'Mandatory', 9),
        text('last_date', 'Last date', 9),
        num('due', 'Due', undefined, 11),
        num('paid', 'Paid', undefined, 11),
        num('balance', 'Balance', undefined, 11),
        text('pay_status', 'Status', 9),
        text('receipts', 'Receipt no.', 14),
        text('last_paid', 'Paid on', 9),
        text('last_reminded', 'Last reminded', 9),
      ],
      rows,
    };
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
      ...order.map((m) => num(`m_${slug(m)}`, m)),
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
        order.forEach((m) => {
          const v = x.modes.get(m) ?? 0;
          cells[`m_${slug(m)}`] = v;
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
      // the school's sheet calls the credit carried on a receipt "Opening Cr."
      num('advance', grouped ? 'Opening Cr.' : 'Advance kept'),
      num('fine', 'Fine'),
      num('bounce', 'Bounce Charge'),
    ];
    const columns: MisColumn[] = grouped
      ? [
          num('sr', 'Sr. No.', undefined, 6),
          text('admission_no', 'Admission Number', 13),
          text('student', 'Student Full Name', 20),
          text('grade', 'Grade', 9),
          text('section', 'Section', 7),
          text('fee_group', 'Fee Category', 10),
          text('student_status', 'Student Status', 10),
          text('receipt_no', 'Receipt Number', 16),
          text('date', 'Receipt Dates', 10),
          text('mode', 'Payment Mode', 11),
          text('gateway', 'Gateway Name', 10),
          text('date2', 'Payment Date', 10),
          text('bank_name', 'Bank Name', 13),
          text('reference', 'Reference Number', 16),
          text('instrument_date', 'Payment Mode Date', 11),
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
        rows.push({
          kind: 'subtotal',
          level: 2,
          label: `Subtotal — ${curMode}`,
          cells: { ...modeSum },
        });
      if (what === 'date' && curDate)
        rows.push({
          kind: 'subtotal',
          level: 1,
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
        rows.push({
          kind: 'group',
          level: 1,
          label: `Receipt Dates: ${dmy(r.on_date)}`,
          cells: {},
        });
      }
      if (grouped && r.mode !== curMode) {
        if (curMode)
          rows.push({
            kind: 'subtotal',
            level: 2,
            label: `Subtotal — ${curMode}`,
            cells: { ...modeSum },
          });
        curMode = r.mode;
        modeSum = sums();
        rows.push({ kind: 'group', level: 2, label: `Payment Mode: ${r.mode}`, cells: {} });
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
          date2: dmy(r.on_date),
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
      sheet: grouped ? 'Day Book' : undefined,
      title: grouped
        ? 'Day book (grouped by date and payment mode)'
        : 'Head-wise tally (receipt-wise)',
      filters: [`${dmy(from)} to ${dmy(to)}`, q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers'],
      note: grouped
        ? 'Bounced and cancelled receipts are not listed. Each head shows what the receipt is set against today (a refund with the fee kept due takes the amount off the head). Opening Cr. is money on the receipt not yet set against any fee (credit carried forward).'
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

  /** The report as Excel or PDF, laid out as on the screen, in the style of the school's own sheets. */
  async file(ctx: RequestContext, id: MisReportId, q: FeeMisQueryDto, format: 'xlsx' | 'pdf') {
    const r = await this.report(ctx, id, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const name = r.report.replace(/_/g, '-');
    return format === 'pdf'
      ? { bytes: await misPdf(r, head), filename: `${name}.pdf`, contentType: 'application/pdf' }
      : {
          bytes: await misXlsx(r, head),
          filename: `${name}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
  }

  // ---- the day book: every receipt, misc receipt and refund of the dates, with its summary --------------
  private async dayBook(c: PoolClient, q: FeeMisQueryDto): Promise<MisReport> {
    const { from, to } = this.range(q);
    const def = datasetOrNull('fee_day_book')!;
    const query = def.query({ from, to, ledger: q.ledger, mode: q.mode });
    const got = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- the text is the day book dataset's own fixed query; values are bound
      `${query.text} LIMIT 50000`,
      query.values,
    );
    const day = (v: unknown) =>
      v instanceof Date
        ? `${String(v.getDate()).padStart(2, '0')}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getFullYear())}`
        : dmy(v as string | null);
    const KIND: Record<string, string> = {
      receipt: 'Receipt',
      misc: 'Misc receipt',
      refund: 'Refund',
      misc_refund: 'Misc refund',
    };
    const list = got.rows;
    // a bounced cheque and a cancelled misc receipt are listed with their status and counted nowhere
    const counted = list.filter((r) => r.status !== 'bounced' && r.status !== 'reversed');
    const sum = (rows: Array<Record<string, unknown>>, key: string) =>
      rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    const rows: MisRow[] = list.map((r, i) => ({
      kind: 'row',
      cells: {
        sr: i + 1,
        date: day(r.received_on),
        kind: KIND[str(r.kind)] ?? str(r.kind),
        ledger: str(r.ledger),
        receipt_no: str(r.receipt_no),
        admission_no: str(r.admission_no),
        payer: str(r.payer),
        section: str(r.section),
        mode: str(r.mode),
        instrument_no: str(r.instrument_no),
        bank_name: str(r.bank_name),
        reference: str(r.reference),
        principal: Number(r.principal ?? 0),
        late_fee: Number(r.late_fee ?? 0),
        amount: Number(r.amount ?? 0),
        status:
          r.status === 'bounced'
            ? 'Bounced (not counted)'
            : r.status === 'reversed'
              ? 'Cancelled (not counted)'
              : r.status === 'refund'
                ? 'Refund paid'
                : (STATUS[str(r.status)] ?? str(r.status)),
        received_by: str(r.received_by),
        cleared_on: day(r.cleared_on),
      },
    }));
    rows.push({
      kind: 'total',
      label: 'Total (bounced and cancelled not counted)',
      cells: {
        principal: sum(counted, 'principal'),
        late_fee: sum(counted, 'late_fee'),
        amount: sum(counted, 'amount'),
      },
    });
    const table = (title: string, first: string, key: string): MisBlock => {
      const names = [...new Set(counted.map((r) => str(r[key])))].sort();
      return {
        title,
        columns: [
          text('name', first, 22),
          num('count', 'Entries', undefined, 9),
          num('principal', 'Fee'),
          num('late_fee', 'Late fee'),
          num('amount', 'Amount', undefined, 13),
        ],
        rows: [
          ...names.map((nm): MisRow => {
            const of = counted.filter((r) => str(r[key]) === nm);
            return {
              kind: 'row',
              cells: {
                name: nm,
                count: of.length,
                principal: sum(of, 'principal'),
                late_fee: sum(of, 'late_fee'),
                amount: sum(of, 'amount'),
              },
            };
          }),
          {
            kind: 'total',
            label: 'Grand total',
            cells: {
              count: counted.length,
              principal: sum(counted, 'principal'),
              late_fee: sum(counted, 'late_fee'),
              amount: sum(counted, 'amount'),
            },
          },
        ],
      };
    };
    const isRefund = (r: Record<string, unknown>) =>
      r.kind === 'refund' || r.kind === 'misc_refund';
    const refunds = list.filter(isRefund);
    const bounced = list.filter((r) => r.status === 'bounced');
    const cancelled = list.filter((r) => r.status === 'reversed');
    const receipts = list.filter((r) => !isRefund(r));
    const ledgers = [...new Set(receipts.map((r) => str(r.ledger)))].sort();
    return {
      report: 'day_book',
      title: 'Fee day book',
      sheet: 'Day Book',
      filters: [
        `${dmy(from)} to ${dmy(to)}`,
        q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers',
        ...(q.mode ? [`Mode: ${q.mode}`] : []),
      ],
      note: 'A cancelled fee receipt is not listed. A bounced cheque and a cancelled misc receipt are listed with their status and are not counted in any total. A refund (of a fee or a misc receipt) is a minus line on the day it was paid, so the totals are net of refunds.',
      columns: [
        num('sr', 'Sr No', undefined, 5),
        text('date', 'Date', 9),
        text('kind', 'Kind', 9),
        text('ledger', 'Ledger', 7),
        text('receipt_no', 'Receipt no.', 16),
        text('admission_no', 'Admission no.', 10),
        text('payer', 'Payer', 20),
        text('section', 'Class', 8),
        text('mode', 'Mode', 10),
        text('instrument_no', 'Cheque / DD no.', 10),
        text('bank_name', 'Bank', 14),
        text('reference', 'Reference', 14),
        num('principal', 'Fee'),
        num('late_fee', 'Late fee'),
        num('amount', 'Amount', undefined, 12),
        text('status', 'Status', 13),
        text('received_by', 'Received by', 13),
        text('cleared_on', 'Bank cleared', 9),
      ],
      rows,
      blocks: [
        table('Summary: totals by mode', 'Mode', 'mode'),
        table('Summary: totals by ledger', 'Ledger', 'ledger'),
        {
          title: 'Summary: other figures',
          columns: [
            text('name', 'Item', 34),
            num('count', 'Entries', undefined, 9),
            num('amount', 'Amount', undefined, 13),
          ],
          rows: [
            {
              kind: 'row',
              cells: {
                name: 'Refunds paid (already taken off the totals)',
                count: refunds.length,
                amount: -sum(refunds, 'amount'),
              },
            },
            {
              kind: 'row',
              cells: {
                name: 'Bounced cheques (listed, not counted)',
                count: bounced.length,
                amount: sum(bounced, 'amount'),
              },
            },
            {
              kind: 'row',
              cells: {
                name: 'Cancelled misc receipts (listed, not counted)',
                count: cancelled.length,
                amount: sum(cancelled, 'amount'),
              },
            },
            ...ledgers.map((l): MisRow => {
              const nos = receipts
                .filter((r) => str(r.ledger) === l && r.receipt_no)
                .map((r) => str(r.receipt_no))
                .sort();
              return {
                kind: 'row',
                cells: {
                  name: `Receipt numbers, ${l}: ${nos[0] ?? '—'} to ${nos[nos.length - 1] ?? '—'}`,
                  count: nos.length,
                  amount: null,
                },
              };
            }),
          ],
        },
      ],
    };
  }

  // ---- forecast: what is billed, collected and still to come, by month or quarter -----------------------
  private async forecast(c: PoolClient, yearId: string, q: FeeMisQueryDto): Promise<MisReport> {
    const byHead = q.by === 'head';
    const quarterly = q.view === 'quarter';
    const periods = await c.query<{ sequence: number; name: string }>(
      `SELECT sequence, name FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
      [yearId],
    );
    if (periods.rows.length === 0)
      throw new DomainError('fees.no_periods', 'The fee months of this session are not set up', {
        status: 409,
      });
    const short = (nm: string) => nm.split(' ')[0]!.slice(0, 3);
    // a column block per month, or per three months of the session in their order
    const buckets: Array<{ key: string; label: string; seqs: number[] }> = quarterly
      ? Array.from({ length: Math.ceil(periods.rows.length / 3) }, (_, i) => {
          const part = periods.rows.slice(i * 3, i * 3 + 3);
          return {
            key: `q${String(i + 1)}`,
            label: `Q${String(i + 1)} (${short(part[0]!.name)}–${short(part[part.length - 1]!.name)})`,
            seqs: part.map((p) => p.sequence),
          };
        })
      : periods.rows.map((p) => ({
          key: `m${String(p.sequence)}`,
          label: p.name,
          seqs: [p.sequence],
        }));
    const bucketOf = new Map<number, string>();
    for (const b of buckets) for (const sq of b.seqs) bucketOf.set(sq, b.key);
    const CLASS_OF = `LEFT JOIN LATERAL (SELECT cs.class_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                             WHERE e.student_id = d.student_id AND e.academic_year_id = d.academic_year_id ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) en ON true`;
    const WHERE = `d.academic_year_id = $1 AND d.status <> 'cancelled' AND ($2::text IS NULL OR d.ledger::text = $2) AND ($3::bigint IS NULL OR en.class_id = $3)`;
    const got = await c.query<{
      id: string;
      name: string;
      sort: number;
      sequence: number;
      net: number;
      paid: number;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- the row key and the joins are fixed fragments; values are bound parameters
      `SELECT ${byHead ? `h.id::text AS id, h.name AS name, h.sort_order AS sort` : `COALESCE(k.id::text, '0') AS id, COALESCE(k.name, k.code, 'No class') AS name, COALESCE(k.display_order, 9999) AS sort`},
              fp.sequence, sum(d.net)::float AS net, sum(d.paid)::float AS paid
         FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id JOIN fee_heads h ON h.id = d.head_id
         ${CLASS_OF} LEFT JOIN classes k ON k.id = en.class_id
        WHERE ${WHERE}
        GROUP BY 1, 2, 3, fp.sequence`,
      [yearId, q.ledger ?? null, q.classId ?? null],
    );
    const pupilsOf = await c.query<{ id: string; pupils: number }>(
      // eslint-disable-next-line no-restricted-syntax -- the row key and the joins are fixed fragments; values are bound parameters
      `SELECT ${byHead ? `d.head_id::text` : `COALESCE(en.class_id::text, '0')`} AS id, count(DISTINCT d.student_id)::int AS pupils
         FROM fee_demands d ${CLASS_OF}
        WHERE ${WHERE}
        GROUP BY 1`,
      [yearId, q.ledger ?? null, q.classId ?? null],
    );
    const pupils = new Map(pupilsOf.rows.map((x) => [x.id, x.pupils]));
    const lines = new Map<string, { name: string; sort: number; cells: Record<string, number> }>();
    for (const g of got.rows) {
      const b = bucketOf.get(g.sequence);
      if (!b) continue;
      const l = lines.get(g.id) ?? { name: g.name, sort: g.sort, cells: {} };
      l.cells[`e_${b}`] = (l.cells[`e_${b}`] ?? 0) + g.net;
      l.cells[`c_${b}`] = (l.cells[`c_${b}`] ?? 0) + g.paid;
      lines.set(g.id, l);
    }
    const columns: MisColumn[] = [
      num('sr', 'Sr No', undefined, 5),
      text('name', byHead ? 'Fee head' : 'Class', 16),
      // a count of pupils, not money
      text('count', 'Pupils', 7),
      ...buckets.flatMap((b) => [
        num(`e_${b.key}`, 'Expected', b.label),
        num(`c_${b.key}`, 'Collected', b.label),
        num(`b_${b.key}`, 'Balance', b.label),
      ]),
      num('e_all', 'Expected', 'Session total', 13),
      num('c_all', 'Collected', 'Session total', 13),
      num('b_all', 'Balance', 'Session total', 13),
      text('pct', 'Collected %', 8, 'Session total'),
    ];
    const total: Record<string, number> = {};
    const pct = (cv: number, ev: number) => (ev > 0 ? `${((cv / ev) * 100).toFixed(1)}%` : '—');
    const rows: MisRow[] = [...lines.entries()]
      .sort((a, b) => a[1].sort - b[1].sort || a[1].name.localeCompare(b[1].name))
      .map(([id, l], i) => {
        const cells: Record<string, string | number | null> = {
          sr: i + 1,
          name: l.name,
          count: String(pupils.get(id) ?? 0),
        };
        let ev = 0;
        let cv = 0;
        for (const b of buckets) {
          const e1 = l.cells[`e_${b.key}`] ?? 0;
          const c1 = l.cells[`c_${b.key}`] ?? 0;
          cells[`e_${b.key}`] = e1;
          cells[`c_${b.key}`] = c1;
          cells[`b_${b.key}`] = Number((e1 - c1).toFixed(2));
          ev += e1;
          cv += c1;
        }
        cells.e_all = ev;
        cells.c_all = cv;
        cells.b_all = Number((ev - cv).toFixed(2));
        cells.pct = pct(cv, ev);
        for (const [k, v] of Object.entries(cells))
          if (typeof v === 'number' && k !== 'sr') total[k] = (total[k] ?? 0) + v;
        return { kind: 'row' as const, cells };
      });
    rows.push({
      kind: 'total',
      label: 'Total',
      cells: { ...total, pct: pct(total.c_all ?? 0, total.e_all ?? 0) },
    });
    return {
      report: 'forecast',
      title: `Fee forecast, ${quarterly ? 'quarter-wise' : 'month-wise'}, by ${byHead ? 'fee head' : 'class'}`,
      filters: [
        quarterly ? 'Quarter-wise' : 'Month-wise',
        byHead ? 'By fee head' : 'By class',
        q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers',
      ],
      note: 'Expected is the fee billed for the month after concession and waiver, for every pupil billed. Collected is what receipts hold against that month today, whenever it was paid. Balance is the difference. A quarter is three fee months of the session in their order.',
      columns,
      rows,
    };
  }

  // ---- report check: the same figures reached two ways must agree --------------------------------------
  private async check(c: PoolClient, yearId: string, q: FeeMisQueryDto): Promise<MisReport> {
    const year = await c.query<{ from: string; to: string }>(
      `SELECT start_date::text AS "from", end_date::text AS "to" FROM academic_years WHERE id = $1`,
      [yearId],
    );
    const from = q.from ?? year.rows[0]!.from;
    const to = q.to ?? year.rows[0]!.to;
    const span: FeeMisQueryDto = { ledger: q.ledger, from, to };
    const L = q.ledger ?? null;
    const one = async (sql: string, params: unknown[]) =>
      Number((await c.query<{ v: string | null }>(sql, params)).rows[0]?.v ?? 0);
    const totalOf = (r: MisReport, key: string) =>
      Number(r.rows.find((x) => x.kind === 'total')?.cells[key] ?? 0);
    // counted receipts of the dates, from the books
    // eslint-disable-next-line no-restricted-syntax -- COUNTED is a fixed fragment written in this file
    const RECEIPTS = `FROM fee_payments p WHERE ${COUNTED} AND p.received_on BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR p.ledger::text = $3)`;
    const r3 = [from, to, L];
    /* eslint-disable no-restricted-syntax -- RECEIPTS and COUNTED are fixed fragments written here; values are bound parameters */
    const base = {
      amount: await one(`SELECT sum(p.amount) AS v ${RECEIPTS}`, r3),
      late: await one(`SELECT sum(p.late_fee) AS v ${RECEIPTS}`, r3),
      refundedOn: await one(`SELECT sum(p.refunded) AS v ${RECEIPTS}`, r3),
      allocated: await one(
        `SELECT sum((SELECT COALESCE(sum(a.amount), 0) FROM fee_payment_allocations a WHERE a.payment_id = p.id)) AS v ${RECEIPTS}`,
        r3,
      ),
      latePosted: await one(
        `SELECT sum((SELECT COALESCE(sum(l.amount), 0) FROM fee_late_fee_postings l WHERE l.payment_id = p.id)) AS v ${RECEIPTS}`,
        r3,
      ),
      refundsOfThem: await one(
        `SELECT sum((SELECT COALESCE(sum(r.amount), 0) FROM fee_refunds r WHERE r.payment_id = p.id AND r.status IN ('paid', 'approved'))) AS v ${RECEIPTS}`,
        r3,
      ),
      overdrawn: await one(
        `SELECT count(*) AS v ${RECEIPTS} AND p.amount - p.late_fee - p.refunded - COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0) < -0.005`,
        r3,
      ),
      allAllocated: await one(
        `SELECT sum(a.amount) AS v FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id JOIN fee_payments p ON p.id = a.payment_id
          WHERE d.academic_year_id = $1 AND ${COUNTED} AND ($2::text IS NULL OR d.ledger::text = $2)`,
        [yearId, L],
      ),
      /* eslint-enable no-restricted-syntax */
      refundsPaid: await one(
        `SELECT sum(r.amount) AS v FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id
          WHERE r.status = 'paid' AND r.paid_on BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR COALESCE(p.ledger::text, 'school') = $3)`,
        r3,
      ),
      billNet: await one(
        `SELECT sum(d.net) AS v FROM fee_demands d WHERE d.academic_year_id = $1 AND d.status <> 'cancelled' AND ($2::text IS NULL OR d.ledger::text = $2)`,
        [yearId, L],
      ),
      billPaid: await one(
        `SELECT sum(d.paid) AS v FROM fee_demands d WHERE d.academic_year_id = $1 AND d.status <> 'cancelled' AND ($2::text IS NULL OR d.ledger::text = $2)`,
        [yearId, L],
      ),
      allPaid: await one(
        `SELECT sum(d.paid) AS v FROM fee_demands d WHERE d.academic_year_id = $1 AND ($2::text IS NULL OR d.ledger::text = $2)`,
        [yearId, L],
      ),
      deadAllocations: await one(
        `SELECT count(*) AS v FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id
          WHERE d.academic_year_id = $1 AND p.status IN ('bounced', 'reversed')`,
        [yearId],
      ),
      overpaid: await one(
        `SELECT count(*) AS v FROM fee_demands d WHERE d.academic_year_id = $1 AND d.status <> 'cancelled' AND d.net >= 0 AND d.paid > d.net + 0.005`,
        [yearId],
      ),
      wrongStatus: await one(
        `SELECT count(*) AS v FROM fee_demands d WHERE d.academic_year_id = $1 AND d.net > 0
            AND ((d.status = 'paid' AND d.paid < d.net - 0.005) OR (d.status = 'pending' AND d.paid > 0.005)
              OR (d.status = 'partial' AND (d.paid <= 0.005 OR d.paid >= d.net - 0.005)))`,
        [yearId],
      ),
    };
    // the same figures as the reports print them
    const mode = await this.modeDaywise(c, span);
    const book = await this.dayBook(c, span);
    const heads = await this.headReceipts(c, span, false);
    const grouped = await this.headReceipts(c, span, true);
    const period = await this.pupilWise(c, yearId, {}, 'head');
    const yearly = await this.pupilWise(c, yearId, {}, 'month');
    const fore = await this.forecast(c, yearId, { ledger: q.ledger });
    const partsOf = (r: MisReport) =>
      Object.entries(r.rows.find((x) => x.kind === 'total')?.cells ?? {})
        .filter(([k]) => k !== 'total')
        .reduce((a, [, v]) => a + Number(v ?? 0), 0);
    // misc receipts are in the day book only: they are taken out to compare it with the fee reports
    const miscInBook = book.rows
      .filter(
        (x) =>
          x.kind === 'row' &&
          (x.cells.kind === 'Misc receipt' || x.cells.kind === 'Misc refund') &&
          !String(x.cells.status).includes('not counted'),
      )
      .reduce((a, x) => a + Number(x.cells.amount ?? 0), 0);
    type Check = [
      group: string,
      what: string,
      a: [string, number],
      b: [string, number],
      count?: boolean,
    ];
    const checks: Check[] = [
      [
        'Receipts',
        'No receipt is set against more fee than it holds',
        ['Receipts over-used', base.overdrawn],
        ['Should be', 0],
        true,
      ],
      [
        'Receipts',
        'Late fee on receipts = late fee postings',
        ['On receipts', base.late],
        ['Postings', base.latePosted],
      ],
      [
        'Receipts',
        'Refunded on receipts = refund vouchers approved for them',
        ['On receipts', base.refundedOn],
        ['Refund vouchers', base.refundsOfThem],
      ],
      [
        'Receipts',
        'No bounced or cancelled receipt still holds fee',
        ['Lines still held', base.deadAllocations],
        ['Should be', 0],
        true,
      ],
      [
        'Bills',
        'Paid on the bills = what receipts hold against them',
        ['Paid on fee lines', base.allPaid],
        ['Held by receipts', base.allAllocated],
      ],
      [
        'Bills',
        'No fee line is paid more than it charges',
        ['Lines over-paid', base.overpaid],
        ['Should be', 0],
        true,
      ],
      [
        'Bills',
        'Every fee line has the right status (pending, part paid, paid)',
        ['Lines with a wrong status', base.wrongStatus],
        ['Should be', 0],
        true,
      ],
      [
        'Reports',
        'Mode-wise collection: Final Amount = Amt. Paid + Late Fee − Dr Amount',
        ['Final Amount', totalOf(mode, 'final')],
        ['Worked out', totalOf(mode, 'paid') + totalOf(mode, 'late') - totalOf(mode, 'dr')],
      ],
      [
        'Reports',
        'Mode-wise collection: the modes add up to Final Amount',
        ['Final Amount', totalOf(mode, 'final')],
        ['Sum of the modes', totalOf(mode, 'final2')],
      ],
      [
        'Reports',
        'Mode-wise collection = receipts less refunds paid, from the books',
        ['Final Amount', totalOf(mode, 'final')],
        ['Books', base.amount - base.refundsPaid],
      ],
      [
        'Reports',
        'Day book total (fee receipts only) = mode-wise Final Amount',
        ['Day book less misc receipts', totalOf(book, 'amount') - miscInBook],
        ['Mode-wise', totalOf(mode, 'final')],
      ],
      [
        'Reports',
        'Head-wise tally total = receipts received, from the books',
        ['Head-wise tally', totalOf(heads, 'total')],
        ['Books', base.amount],
      ],
      [
        'Reports',
        'Head-wise tally: heads + fine + advance + refunded = Total',
        ['Columns + refunded', partsOf(heads) + base.refundedOn],
        ['Total', totalOf(heads, 'total')],
      ],
      [
        'Reports',
        'Day book (grouped) Grand Total = head-wise tally',
        ['Day book (grouped)', totalOf(grouped, 'total')],
        ['Head-wise tally', totalOf(heads, 'total')],
      ],
      [
        'Reports',
        'Period fee head-wise: Total Due = fee billed, from the books',
        ['Report', totalOf(period, 'due')],
        ['Books', base.billNet],
      ],
      [
        'Reports',
        'Period fee head-wise: Total Paid = paid on the bills',
        ['Report', totalOf(period, 'paid')],
        ['Books', base.billPaid],
      ],
      [
        'Reports',
        'Yearly projection: Total Due = period fee head-wise',
        ['Yearly projection', totalOf(yearly, 'due')],
        ['Period fee head-wise', totalOf(period, 'due')],
      ],
      [
        'Reports',
        'Yearly projection: Total Paid = period fee head-wise',
        ['Yearly projection', totalOf(yearly, 'paid')],
        ['Period fee head-wise', totalOf(period, 'paid')],
      ],
      [
        'Reports',
        'Forecast: Expected = fee billed, from the books',
        ['Forecast', totalOf(fore, 'e_all')],
        ['Books', base.billNet],
      ],
      [
        'Reports',
        'Forecast: Collected = paid on the bills',
        ['Forecast', totalOf(fore, 'c_all')],
        ['Books', base.billPaid],
      ],
    ];
    const rows: MisRow[] = [];
    let group = '';
    let bad = 0;
    checks.forEach(([g, what, a, b, count], i) => {
      if (g !== group) {
        group = g;
        rows.push({ kind: 'group', level: 1, label: g, cells: {} });
      }
      const diff = Number((a[1] - b[1]).toFixed(2));
      const ok = Math.abs(diff) < 0.01;
      if (!ok) bad += 1;
      rows.push({
        kind: 'row',
        cells: {
          sr: i + 1,
          what,
          a_name: a[0],
          a: count ? String(a[1]) : a[1],
          b_name: b[0],
          b: count ? String(b[1]) : b[1],
          diff: count ? String(diff) : diff,
          result: ok ? 'Agrees' : 'DOES NOT AGREE',
        },
      });
    });
    rows.push({
      kind: 'total',
      label:
        bad === 0
          ? `All ${String(checks.length)} checks agree`
          : `${String(bad)} of ${String(checks.length)} checks do not agree`,
      cells: {},
    });
    return {
      report: 'check',
      title: 'Report check',
      filters: [
        `Receipts ${dmy(from)} to ${dmy(to)}`,
        'Bills of the whole session',
        q.ledger ? `Ledger: ${q.ledger}` : 'All ledgers',
      ],
      note: 'Each line reaches one figure two ways (from the books, and as a report prints it) and shows the difference. Receipts are checked for the dates chosen; bills for the whole session. A difference means an entry needs to be looked at; nothing is corrected from here.',
      columns: [
        num('sr', 'Sr No', undefined, 5),
        text('what', 'What is checked', 44),
        text('a_name', 'First figure', 26),
        num('a', 'Amount', undefined, 14),
        text('b_name', 'Second figure', 26),
        num('b', 'Amount', undefined, 14),
        num('diff', 'Difference', undefined, 12),
        text('result', 'Result', 12),
      ],
      rows,
    };
  }
}
