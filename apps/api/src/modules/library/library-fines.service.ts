import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { borrowerLateral, likeEscape } from './library-borrower-sql';
import { libraryFile, type FileColumn, type FileCell } from './library-file';
import { WAITING_WITH } from '../fees/fee-approval';
import type {
  FinesExportDto,
  FinesQueryDto,
  WaiverRequestsExportDto,
  WaiverRequestsQueryDto,
} from './library.dto';

type Tab = 'outstanding' | 'collected' | 'waived';
type Row = Record<string, string | number | null>;
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Each tab's rows before the borrower and the filters: the day the row is dated by, the loan, the
 * borrower, the amount and what the tab says of it.
 */
const SOURCES: Record<Tab, string> = {
  // late fines at the fees counter not yet paid, and old fines never sent there (before 0217)
  outstanding: `
    SELECT ch.on_date AS day, ch.loan_id, ch.borrower_kind::text AS bkind, ch.borrower_id, ch.id::text AS charge_id,
           ch.amount AS fine, ml.paid, (ml.amount - ml.paid) AS due,
           CASE WHEN EXISTS (SELECT 1 FROM misc_fee_requests q WHERE q.misc_fee_id = ch.misc_fee_id AND q.status = 'pending')
                THEN 'The fees office is deciding a waiver' ELSE 'Due at the fees counter' END AS state,
           NULL::text AS receipt_no, NULL::text AS mode, NULL::text AS by_name, NULL::text AS reason, 'counter' AS how
      FROM library_charges ch JOIN misc_fee_students ml ON ml.id = ch.misc_line_id JOIN misc_fees f ON f.id = ch.misc_fee_id
     WHERE ch.kind = 'late' AND ml.status = 'open' AND f.status = 'announced' AND ml.amount > ml.paid
    UNION ALL
    SELECT COALESCE(l.returned_on, l.due_on), l.id, l.borrower_kind::text, l.borrower_id, NULL,
           (l.fine_amount - l.fine_waived), 0, (l.fine_amount - l.fine_waived), 'Not sent to the fees counter (an old fine)',
           NULL, NULL, NULL, NULL, 'library'
      FROM library_loans l
     WHERE l.fine_amount > l.fine_waived AND l.fine_paid_on IS NULL AND l.fine_receipt_id IS NULL AND l.returned_on IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM library_charges ch WHERE ch.loan_id = l.id AND ch.kind = 'late')`,
  // the fees counter's receipts for late fines, and old fines collected at the library
  collected: `
    SELECT m.received_on AS day, ch.loan_id, ch.borrower_kind::text AS bkind, ch.borrower_id, ch.id::text AS charge_id,
           ch.amount AS fine, (m.amount - m.refunded) AS paid, 0::numeric AS due, 'Paid at the fees counter' AS state,
           m.receipt_no, m.mode, u.display_name AS by_name, NULL::text AS reason, 'counter' AS how
      FROM misc_receipts m JOIN library_charges ch ON ch.misc_line_id = m.misc_fee_student_id AND ch.kind = 'late'
      LEFT JOIN users u ON u.id = m.received_by
     WHERE m.status = 'posted' AND m.amount > m.refunded
    UNION ALL
    SELECT l.fine_paid_on, l.id, l.borrower_kind::text, l.borrower_id, NULL,
           l.fine_amount, (l.fine_amount - l.fine_waived), 0, 'Collected at the library (an old fine)',
           COALESCE(mr.receipt_no, CASE WHEN l.note LIKE 'paid · %' THEN substr(l.note, 8) END), mr.mode, ru.display_name,
           NULL, 'library'
      FROM library_loans l LEFT JOIN misc_receipts mr ON mr.id = l.fine_receipt_id
      LEFT JOIN users ru ON ru.id = mr.received_by
     WHERE l.fine_paid_on IS NOT NULL AND l.fine_amount > l.fine_waived`,
  // waived at the desk (who, why) and brought down by the fees office
  waived: `
    SELECT w.waived_on AS day, w.loan_id, l.borrower_kind::text AS bkind, l.borrower_id, NULL::text AS charge_id,
           l.fine_amount AS fine, w.amount AS paid, 0::numeric AS due, 'Waived at the library' AS state,
           NULL::text AS receipt_no, NULL::text AS mode, w.by_name, w.reason, 'library' AS how
      FROM library_fine_waivers w JOIN library_loans l ON l.id = w.loan_id
    UNION ALL
    SELECT r.decided_at::date, ch.loan_id, ch.borrower_kind::text, ch.borrower_id, ch.id::text,
           ch.amount,
           CASE WHEN r.kind = 'pupil_change'
                THEN COALESCE((r.payload->>'fromAmount')::numeric, ch.amount) - (r.payload->>'amount')::numeric
                ELSE GREATEST(ml.amount - ml.paid, 0) END,
           0, 'Waived by the fees office', NULL, NULL, du.display_name, r.reason, 'counter'
      FROM misc_fee_requests r JOIN library_charges ch ON ch.misc_fee_id = r.misc_fee_id AND ch.kind = 'late'
      JOIN misc_fee_students ml ON ml.id = ch.misc_line_id
      LEFT JOIN users du ON du.id = r.decided_by
     WHERE r.status = 'approved' AND r.kind IN ('pupil_change', 'close')`,
};
const COLUMNS = `s.day::text AS day, s.loan_id, s.bkind, s.borrower_id, s.charge_id, s.fine, s.paid, s.due, s.state, s.receipt_no,
  s.mode, s.by_name, s.reason, s.how`;
const DAY_WORD: Record<Tab, string> = {
  outstanding: 'Returned on',
  collected: 'Paid on',
  waived: 'Waived on',
};
const TITLE: Record<Tab, string> = {
  outstanding: 'Library fines outstanding',
  collected: 'Library fines collected',
  waived: 'Library fines waived',
};

/**
 * The Fines page (docs/design/36-library.md, "Library reports", part 1): late fines outstanding (at the
 * fees counter, or old ones never sent), collected (the fees counter's receipts, old collections at the
 * library) and waived (at the desk with who and why, or by the fees office), between two days, by pupils
 * or staff, a class or section, a search; the totals; the tab as Excel or PDF.
 */
@Injectable()
export class LibraryFinesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private sql(tab: Tab, q: FinesQueryDto, args: unknown[]) {
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    const where: string[] = [];
    if (q.from) where.push(`s.day >= ${arg(q.from)}::date`);
    if (q.to) where.push(`s.day <= ${arg(q.to)}::date`);
    if (q.borrower) where.push(`s.bkind = ${arg(q.borrower)}`);
    if (q.classId) where.push(`b.class_id = ${arg(q.classId)}::bigint`);
    if (q.sectionId) where.push(`b.section_id = ${arg(q.sectionId)}::bigint`);
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(
        `(b.name ILIKE ${p} OR b.ref ILIKE ${p} OR t.title ILIKE ${p} OR x.accession_no ILIKE ${p})`,
      );
    }
    const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
    // eslint-disable-next-line no-restricted-syntax -- the fixed sources of this service; values are bound
    return `SELECT ${COLUMNS}, b.name, b.ref, b.place, t.title, x.accession_no, l.due_on::text AS due_on,
                   l.returned_on::text AS returned_on, GREATEST(0, COALESCE(l.returned_on, CURRENT_DATE) - l.due_on) AS days_late
              FROM (${SOURCES[tab]}) s
              JOIN library_loans l ON l.id = s.loan_id
              JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
              ${borrowerLateral('s.bkind', 's.borrower_id')}
             ${filter}`;
  }

  private async rows(c: PoolClient, q: FinesQueryDto, limit: number, offset = 0) {
    const args: unknown[] = [];
    const inner = this.sql(q.tab, q, args);
    const n = args.length;
    const r = await c.query<Row & { __total: string; __sum: string; __due: string }>(
      // eslint-disable-next-line no-restricted-syntax -- the inner query is this service's own; values are bound
      `SELECT z.*, count(*) OVER () AS __total, sum(z.paid) OVER () AS __sum, sum(z.due) OVER () AS __due
         FROM (${inner}) z ORDER BY z.day DESC, z.loan_id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, limit, offset],
    );
    return {
      rows: r.rows.map(({ __total: _t, __sum: _s, __due: _d, ...x }) => ({
        day: x.day ? String(x.day).slice(0, 10) : null,
        loanId: String(x.loan_id),
        chargeId: x.charge_id as string | null,
        borrowerKind: String(x.bkind),
        borrower: String(x.name ?? ''),
        ref: String(x.ref ?? ''),
        place: x.place as string | null,
        title: String(x.title),
        accessionNo: String(x.accession_no),
        dueOn: x.due_on as string | null,
        returnedOn: x.returned_on as string | null,
        daysLate: Number(x.days_late ?? 0),
        fine: round(Number(x.fine ?? 0)),
        // collected: the amount received; waived: the amount waived; outstanding: what is paid
        amount: round(Number(x.paid ?? 0)),
        due: round(Number(x.due ?? 0)),
        state: String(x.state),
        receiptNo: x.receipt_no as string | null,
        mode: x.mode as string | null,
        by: x.by_name as string | null,
        reason: x.reason as string | null,
        how: String(x.how),
      })),
      total: Number(r.rows[0]?.__total ?? 0),
      sum: round(Number(r.rows[0]?.__sum ?? 0)),
      dueSum: round(Number(r.rows[0]?.__due ?? 0)),
    };
  }

  async report(ctx: RequestContext, q: FinesQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const page = await this.rows(c, q, q.size, (q.page - 1) * q.size);
      // old fines (before 0217) still at the library, whatever the filters: for "send them all"
      const unsent = (
        await c.query<{ n: string; amount: string }>(
          `SELECT count(*)::text AS n, COALESCE(sum(l.fine_amount - l.fine_waived), 0)::text AS amount
             FROM library_loans l
            WHERE l.fine_amount > l.fine_waived AND l.fine_paid_on IS NULL AND l.fine_receipt_id IS NULL
              AND l.returned_on IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM library_charges ch WHERE ch.loan_id = l.id AND ch.kind = 'late')`,
        )
      ).rows[0]!;
      return {
        ...page,
        unsent: { count: Number(unsent.n), amount: round(Number(unsent.amount)) },
        page: q.page,
        pages: Math.max(1, Math.ceil(page.total / q.size)),
        totals: {
          rows: page.total,
          // outstanding: what is due; collected: received; waived: waived
          amount: q.tab === 'outstanding' ? page.dueSum : page.sum,
        },
      };
    });
  }

  /** The tab as filtered, as Excel or PDF. */
  async export(ctx: RequestContext, q: FinesExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows, sum, dueSum } = await this.rows(c, q, 20000);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const base: FileColumn[] = [
        { label: DAY_WORD[q.tab], type: 'date' },
        { label: 'Borrower' },
        { label: 'Adm./emp. no.', width: 1.6 },
        { label: 'Class / designation', width: 1.8 },
        { label: 'Book' },
        { label: 'Book no.', width: 1.4 },
      ];
      const pick = (r: (typeof rows)[number]): FileCell[] => [
        r.day,
        r.borrower,
        r.ref,
        r.place,
        r.title,
        r.accessionNo,
      ];
      let columns: FileColumn[];
      let cells: FileCell[][];
      let totals: FileCell[];
      if (q.tab === 'outstanding') {
        columns = [
          ...base,
          { label: 'Due on', type: 'date' },
          { label: 'Days late', type: 'number', width: 1 },
          { label: 'Fine (₹)', type: 'money' },
          { label: 'Paid (₹)', type: 'money' },
          { label: 'Due (₹)', type: 'money' },
          { label: 'State', width: 2.4 },
        ];
        cells = rows.map((r) => [
          ...pick(r),
          r.dueOn,
          r.daysLate,
          r.fine,
          r.amount,
          r.due,
          r.state,
        ]);
        totals = ['Total', '', '', '', '', '', '', '', '', '', dueSum, ''];
      } else if (q.tab === 'collected') {
        columns = [
          ...base,
          { label: 'Amount (₹)', type: 'money' },
          { label: 'Receipt no.', width: 1.6 },
          { label: 'Mode', width: 1 },
          { label: 'Received by', width: 1.8 },
          { label: 'Where', width: 2 },
        ];
        cells = rows.map((r) => [
          ...pick(r),
          r.amount,
          r.receiptNo,
          r.mode?.toUpperCase(),
          r.by,
          r.state,
        ]);
        totals = ['Total', '', '', '', '', '', sum, '', '', '', ''];
      } else {
        columns = [
          ...base,
          { label: 'Waived (₹)', type: 'money' },
          { label: 'Reason', width: 3 },
          { label: 'By', width: 1.8 },
          { label: 'Where', width: 2 },
        ];
        cells = rows.map((r) => [...pick(r), r.amount, r.reason, r.by, r.state]);
        totals = ['Total', '', '', '', '', '', sum, '', '', ''];
      }
      const words =
        [
          q.from || q.to ? `${DAY_WORD[q.tab]} ${q.from ?? '…'} to ${q.to ?? '…'}` : null,
          q.borrower ? (q.borrower === 'student' ? 'Pupils' : 'Staff') : null,
          q.classId || q.sectionId ? 'one class or section' : null,
          q.q ? `search "${q.q}"` : null,
        ]
          .filter(Boolean)
          .join('; ') || 'Every fine';
      await this.audit.stage(ctx, c, {
        action: 'library.fines.export',
        entityType: 'library_loans',
        entityId: requireTenant(ctx).schoolId,
        after: { tab: q.tab, format: q.format, rows: rows.length, words },
      });
      return libraryFile({
        format: q.format,
        name: TITLE[q.tab],
        slug: `Library-fines-${q.tab}`,
        school,
        by: ctx.user.displayName,
        words,
        columns,
        rows: cells,
        totals,
      });
    });
  }

  // ---- the waivers asked of the fees office ----------------------------------------------------------
  private async requestRows(c: PoolClient, q: WaiverRequestsQueryDto, limit: number, offset = 0) {
    const args: unknown[] = [];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    const where: string[] = [`r.kind IN ('pupil_change', 'close')`];
    if (q.status !== 'all') where.push(`r.status = ${arg(q.status)}`);
    if (q.from) where.push(`r.requested_at::date >= ${arg(q.from)}::date`);
    if (q.to) where.push(`r.requested_at::date <= ${arg(q.to)}::date`);
    if (q.borrower) where.push(`ch.borrower_kind = ${arg(q.borrower)}::library_borrower`);
    if (q.classId) where.push(`b.class_id = ${arg(q.classId)}::bigint`);
    if (q.sectionId) where.push(`b.section_id = ${arg(q.sectionId)}::bigint`);
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(
        `(b.name ILIKE ${p} OR b.ref ILIKE ${p} OR t.title ILIKE ${p} OR x.accession_no ILIKE ${p} OR r.reason ILIKE ${p})`,
      );
    }
    const n = args.length;
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments of this service; values are bound
      `SELECT r.id::text, r.requested_at::date::text AS asked_on, r.status, r.kind, r.reason, r.decision_note,
              r.decided_at::date::text AS decided_on, du.display_name AS decided_by, ru.display_name AS asked_by,
              ${WAITING_WITH('r.workflow_instance_id')} AS waiting_with, ch.id::text AS charge_id, ch.amount AS fine,
              CASE WHEN r.kind = 'pupil_change'
                   THEN COALESCE((r.payload->>'fromAmount')::numeric, ch.amount) - (r.payload->>'amount')::numeric
                   ELSE GREATEST(ch.amount - COALESCE(ml.paid, 0), 0) END AS waive,
              ch.loan_id::text, ch.borrower_kind::text AS bkind, b.name, b.ref, b.place, t.title, x.accession_no,
              count(*) OVER () AS __total,
              count(*) FILTER (WHERE r.status = 'pending') OVER () AS __pending
         FROM misc_fee_requests r
         JOIN library_charges ch ON ch.misc_fee_id = r.misc_fee_id AND ch.kind = 'late'
         LEFT JOIN misc_fee_students ml ON ml.id = ch.misc_line_id
         JOIN library_copies x ON x.id = ch.copy_id JOIN library_titles t ON t.id = x.title_id
         ${borrowerLateral('ch.borrower_kind::text', 'ch.borrower_id')}
         LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by
        WHERE ${where.join(' AND ')}
        ORDER BY r.requested_at DESC, r.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, limit, offset],
    );
    return {
      rows: r.rows.map((x) => ({
        id: String(x.id),
        askedOn: String(x.asked_on),
        askedBy: x.asked_by as string | null,
        status: String(x.status) as 'pending' | 'approved' | 'rejected',
        reason: String(x.reason),
        waitingWith: x.waiting_with as string | null,
        decidedOn: x.decided_on as string | null,
        decidedBy: x.decided_by as string | null,
        decisionNote: x.decision_note as string | null,
        chargeId: String(x.charge_id),
        loanId: String(x.loan_id),
        borrowerKind: String(x.bkind),
        borrower: String(x.name ?? ''),
        ref: String(x.ref ?? ''),
        place: x.place as string | null,
        title: String(x.title),
        accessionNo: String(x.accession_no),
        fine: round(Number(x.fine ?? 0)),
        waive: round(Number(x.waive ?? 0)),
      })),
      total: Number(r.rows[0]?.__total ?? 0),
      pending: Number(r.rows[0]?.__pending ?? 0),
    };
  }

  async requests(ctx: RequestContext, q: WaiverRequestsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const page = await this.requestRows(c, q, q.size, (q.page - 1) * q.size);
      // the pending ones whatever the filters, for the page's figure
      const pending = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM misc_fee_requests r
           JOIN library_charges ch ON ch.misc_fee_id = r.misc_fee_id AND ch.kind = 'late'
          WHERE r.kind IN ('pupil_change', 'close') AND r.status = 'pending'`,
      );
      return {
        rows: page.rows,
        total: page.total,
        page: q.page,
        pages: Math.max(1, Math.ceil(page.total / q.size)),
        pending: Number(pending.rows[0]!.n),
      };
    });
  }

  async requestsExport(ctx: RequestContext, q: WaiverRequestsExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows } = await this.requestRows(c, q, 20000);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const STATUS: Record<string, string> = {
        pending: 'Waiting',
        approved: 'Approved',
        rejected: 'Rejected',
      };
      const words =
        [
          q.status !== 'all' ? STATUS[q.status] : null,
          q.from || q.to ? `Asked ${q.from ?? '…'} to ${q.to ?? '…'}` : null,
          q.borrower ? (q.borrower === 'student' ? 'Pupils' : 'Staff') : null,
          q.classId || q.sectionId ? 'one class or section' : null,
          q.q ? `search "${q.q}"` : null,
        ]
          .filter(Boolean)
          .join('; ') || 'Every request';
      await this.audit.stage(ctx, c, {
        action: 'library.fines.requests.export',
        entityType: 'misc_fee_requests',
        entityId: requireTenant(ctx).schoolId,
        after: { format: q.format, rows: rows.length, words },
      });
      return libraryFile({
        format: q.format,
        name: 'Library fine waiver requests',
        slug: 'Library-fine-waiver-requests',
        school,
        by: ctx.user.displayName,
        words,
        columns: [
          { label: 'Asked on', type: 'date' },
          { label: 'Borrower' },
          { label: 'Adm./emp. no.', width: 1.6 },
          { label: 'Book' },
          { label: 'Book no.', width: 1.4 },
          { label: 'Fine (₹)', type: 'money' },
          { label: 'To waive (₹)', type: 'money' },
          { label: 'Reason', width: 2.6 },
          { label: 'Asked by', width: 1.6 },
          { label: 'State', width: 1.2 },
          { label: 'Waiting with / decided by', width: 2.2 },
          { label: 'Decided on', type: 'date' },
          { label: 'Decision note', width: 2.2 },
        ],
        rows: rows.map((r): FileCell[] => [
          r.askedOn,
          r.borrower,
          r.ref,
          r.title,
          r.accessionNo,
          r.fine,
          r.waive,
          r.reason,
          r.askedBy,
          STATUS[r.status] ?? r.status,
          r.status === 'pending' ? r.waitingWith : r.decidedBy,
          r.decidedOn,
          r.decisionNote,
        ]),
      });
    });
  }
}
