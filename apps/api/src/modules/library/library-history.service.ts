import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { borrowerLateral, likeEscape } from './library-borrower-sql';
import { libraryFile, type FileCell, type FileColumn, type FileSheet } from './library-file';
import type {
  BorrowerHistoryDto,
  BorrowerHistoryExportDto,
  BorrowersExportDto,
  BorrowersQueryDto,
  CirculationExportDto,
  CirculationQueryDto,
} from './library.dto';

type What = CirculationQueryDto['what'];
const round = (n: number) => Math.round(n * 100) / 100;
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;

/** What happened on a day: a book issued, returned or renewed; or out (overdue) now, dated by its issue. */
const EVENTS: Record<'issued' | 'returned' | 'renewed' | 'out' | 'overdue', string> = {
  issued: `SELECT l.issued_on AS day, 'issued' AS what, l.id AS loan_id, iu.display_name AS by_name,
                  NULL::date AS from_due, NULL::date AS to_due
             FROM library_loans l LEFT JOIN users iu ON iu.id = l.issued_by`,
  returned: `SELECT l.returned_on AS day, 'returned' AS what, l.id AS loan_id, ru.display_name AS by_name,
                    NULL::date AS from_due, NULL::date AS to_due
               FROM library_loans l LEFT JOIN users ru ON ru.id = l.returned_by WHERE l.returned_on IS NOT NULL`,
  renewed: `SELECT r.renewed_on AS day, 'renewed' AS what, r.loan_id, r.by_name, r.from_due, r.to_due
              FROM library_loan_renewals r`,
  out: `SELECT l.issued_on AS day, 'out' AS what, l.id AS loan_id, iu.display_name AS by_name,
               NULL::date AS from_due, NULL::date AS to_due
          FROM library_loans l LEFT JOIN users iu ON iu.id = l.issued_by WHERE l.returned_on IS NULL`,
  overdue: `SELECT l.issued_on AS day, 'overdue' AS what, l.id AS loan_id, iu.display_name AS by_name,
                   NULL::date AS from_due, NULL::date AS to_due
              FROM library_loans l LEFT JOIN users iu ON iu.id = l.issued_by
             WHERE l.returned_on IS NULL AND l.due_on < CURRENT_DATE`,
};
const SOURCE: Record<What, string> = {
  all: [EVENTS.issued, EVENTS.returned, EVENTS.renewed].join('\nUNION ALL\n'),
  issued: EVENTS.issued,
  returned: EVENTS.returned,
  renewed: EVENTS.renewed,
  out: EVENTS.out,
  overdue: EVENTS.overdue,
};
const WHAT_WORD: Record<string, string> = {
  issued: 'Issued',
  returned: 'Returned',
  renewed: 'Renewed',
  out: 'Out',
  overdue: 'Overdue',
};
const TITLE: Record<What, string> = {
  all: 'Library circulation',
  issued: 'Library books issued',
  returned: 'Library books returned',
  renewed: 'Library books renewed',
  out: 'Library books out now',
  overdue: 'Library books overdue now',
};

/** A loan's late fine in words: where it is now. */
const FINE_STATE = `CASE
  WHEN l.fine_amount = 0 THEN NULL
  WHEN lc.id IS NOT NULL THEN CASE
    WHEN lml.status = 'cancelled' OR lf.status = 'closed' THEN 'Waived by the fees office'
    WHEN lml.paid >= lml.amount THEN 'Paid at the fees counter'
    ELSE 'Due at the fees counter' END
  WHEN l.fine_waived >= l.fine_amount THEN 'Waived at the library'
  WHEN l.fine_paid_on IS NOT NULL OR l.fine_receipt_id IS NOT NULL THEN 'Collected at the library'
  WHEN l.returned_on IS NOT NULL THEN 'Not sent to the fees counter (an old fine)'
  END`;
/** How the loan ended: lost or damaged (charged), returned, or still out (overdue). */
const OUTCOME = `CASE
  WHEN cc.kind = 'lost' THEN 'Lost'
  WHEN cc.kind = 'damaged' THEN 'Returned damaged'
  WHEN l.returned_on IS NOT NULL THEN 'Returned'
  WHEN l.due_on < CURRENT_DATE THEN 'Overdue'
  ELSE 'Out' END`;
/** The loan's late fine and lost/damaged charge, for FINE_STATE and OUTCOME. */
const LOAN_CHARGES = `
  LEFT JOIN library_charges lc ON lc.loan_id = l.id AND lc.kind = 'late'
  LEFT JOIN misc_fee_students lml ON lml.id = lc.misc_line_id
  LEFT JOIN misc_fees lf ON lf.id = lc.misc_fee_id
  LEFT JOIN library_charges cc ON cc.loan_id = l.id AND cc.kind IN ('lost', 'damaged')`;

/**
 * Library reports, part 2 (docs/design/36-library.md, "Library reports"): circulation between two days
 * (issues, returns, renewals; the books out and overdue now), pupils or staff by what they borrowed and
 * hold, one borrower's books between two days; each as Excel or PDF.
 */
@Injectable()
export class LibraryHistoryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async school(c: PoolClient) {
    return (
      await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = app.current_school_id()`)
    ).rows[0]!.name;
  }

  // ---- circulation -------------------------------------------------------------------------------
  private circulationSql(q: CirculationQueryDto, args: unknown[]) {
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    const where: string[] = [];
    // out and overdue are now: the days do not apply
    const now = q.what === 'out' || q.what === 'overdue';
    if (q.from && !now) where.push(`s.day >= ${arg(q.from)}::date`);
    if (q.to && !now) where.push(`s.day <= ${arg(q.to)}::date`);
    if (q.borrower) where.push(`l.borrower_kind = ${arg(q.borrower)}::library_borrower`);
    if (q.classId) where.push(`b.class_id = ${arg(q.classId)}::bigint`);
    if (q.sectionId) where.push(`b.section_id = ${arg(q.sectionId)}::bigint`);
    if (q.libraryId) where.push(`x.library_id = ${arg(q.libraryId)}::bigint`);
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(
        `(b.name ILIKE ${p} OR b.ref ILIKE ${p} OR t.title ILIKE ${p} OR x.accession_no ILIKE ${p} OR t.author ILIKE ${p})`,
      );
    }
    const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
    // eslint-disable-next-line no-restricted-syntax -- the fixed sources of this service; values are bound
    return `SELECT s.day::text AS day, s.what, s.loan_id::text AS loan_id, s.by_name, s.from_due::text AS from_due,
                   s.to_due::text AS to_due, l.borrower_kind::text AS bkind, l.borrower_id::text AS borrower_id,
                   b.name, b.ref, b.place, x.accession_no, t.id::text AS title_id, t.title, t.author, lib.name AS library,
                   l.issued_on::text AS issued_on, l.due_on::text AS due_on, l.returned_on::text AS returned_on, l.renewed,
                   GREATEST(0, COALESCE(l.returned_on, CURRENT_DATE) - l.due_on) AS days_late, l.fine_amount
              FROM (${SOURCE[q.what]}) s
              JOIN library_loans l ON l.id = s.loan_id
              JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
              LEFT JOIN library_libraries lib ON lib.id = x.library_id
              ${borrowerLateral('l.borrower_kind::text', 'l.borrower_id')}
             ${filter}`;
  }

  private async circulationRows(c: PoolClient, q: CirculationQueryDto, limit: number, offset = 0) {
    const args: unknown[] = [];
    const inner = this.circulationSql(q, args);
    const n = args.length;
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- the inner query is this service's own; values are bound
      `SELECT z.*, count(*) OVER () AS __total
         FROM (${inner}) z ORDER BY z.day DESC, z.loan_id DESC, z.what LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, limit, offset],
    );
    return {
      rows: r.rows.map((x) => ({
        day: String(x.day),
        what: String(x.what),
        loanId: String(x.loan_id),
        borrowerKind: String(x.bkind),
        borrowerId: String(x.borrower_id),
        borrower: String(x.name ?? ''),
        ref: String(x.ref ?? ''),
        place: x.place as string | null,
        accessionNo: String(x.accession_no),
        titleId: String(x.title_id),
        title: String(x.title),
        author: x.author as string | null,
        library: x.library as string | null,
        issuedOn: String(x.issued_on),
        dueOn: String(x.due_on),
        returnedOn: x.returned_on as string | null,
        renewed: Number(x.renewed ?? 0),
        daysLate: Number(x.days_late ?? 0),
        fine: round(Number(x.fine_amount ?? 0)),
        fromDue: x.from_due as string | null,
        toDue: x.to_due as string | null,
        by: x.by_name as string | null,
      })),
      total: Number(r.rows[0]?.__total ?? 0),
    };
  }

  /** How many issued, returned and renewed between the days (the other filters too), and out now. */
  private async circulationCounts(c: PoolClient, q: CirculationQueryDto) {
    const counts: Record<string, number> = {};
    for (const what of ['issued', 'returned', 'renewed', 'out', 'overdue'] as const) {
      const args: unknown[] = [];
      const inner = this.circulationSql({ ...q, what }, args);
      counts[what] = Number(
        (
          await c.query<{ n: string }>(
            // eslint-disable-next-line no-restricted-syntax -- the inner query is this service's own; values are bound
            `SELECT count(*)::text AS n FROM (${inner}) z`,
            args,
          )
        ).rows[0]!.n,
      );
    }
    return counts as Record<'issued' | 'returned' | 'renewed' | 'out' | 'overdue', number>;
  }

  async circulation(ctx: RequestContext, q: CirculationQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const page = await this.circulationRows(c, q, q.size, (q.page - 1) * q.size);
      return {
        ...page,
        page: q.page,
        pages: Math.max(1, Math.ceil(page.total / q.size)),
        counts: await this.circulationCounts(c, q),
      };
    });
  }

  async circulationExport(ctx: RequestContext, q: CirculationExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows } = await this.circulationRows(c, q, 20000);
      const now = q.what === 'out' || q.what === 'overdue';
      const columns: FileColumn[] = [
        { label: now ? 'Issued on' : 'Day', type: 'date' },
        ...(q.what === 'all' ? [{ label: 'What', width: 1.2 }] : []),
        { label: 'Book no.', width: 1.4 },
        { label: 'Book' },
        { label: 'Author', width: 2 },
        { label: 'Borrower' },
        { label: 'Adm./emp. no.', width: 1.6 },
        { label: 'Class / designation', width: 1.8 },
        ...(now ? [] : [{ label: 'Issued on', type: 'date' as const }]),
        { label: 'Due on', type: 'date' },
        { label: 'Returned on', type: 'date' },
        { label: 'Renewed', type: 'number', width: 1.4 },
        { label: 'Days late', type: 'number', width: 1 },
        { label: 'Fine (₹)', type: 'money' },
        { label: 'By', width: 1.8 },
      ];
      const cells = rows.map((r): FileCell[] => [
        r.day,
        ...(q.what === 'all' ? [WHAT_WORD[r.what] ?? r.what] : []),
        r.accessionNo,
        r.title,
        r.author,
        r.borrower,
        r.ref,
        r.place,
        ...(now ? [] : [r.issuedOn]),
        r.what === 'renewed' && r.toDue ? r.toDue : r.dueOn,
        r.returnedOn,
        r.renewed,
        r.daysLate || null,
        r.fine || null,
        r.by,
      ]);
      const words =
        [
          !now && (q.from || q.to)
            ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}`
            : null,
          q.borrower ? (q.borrower === 'student' ? 'Pupils' : 'Staff') : null,
          q.classId || q.sectionId ? 'one class or section' : null,
          q.libraryId ? 'one library' : null,
          q.q ? `search "${q.q}"` : null,
        ]
          .filter(Boolean)
          .join('; ') || (now ? 'Every book out now' : 'Every day');
      await this.audit.stage(ctx, c, {
        action: 'library.circulation.export',
        entityType: 'library_loans',
        entityId: requireTenant(ctx).schoolId,
        after: { what: q.what, format: q.format, rows: rows.length, words },
      });
      return libraryFile({
        format: q.format,
        name: TITLE[q.what],
        slug: `Library-circulation-${q.what}`,
        school: await this.school(c),
        by: ctx.user.displayName,
        words,
        columns,
        rows: cells,
      });
    });
  }

  // ---- pupils or staff, by what they borrowed and hold ---------------------------------------------
  private borrowersSql(q: BorrowersQueryDto, args: unknown[]) {
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    const kind = arg(q.kind);
    const from = arg(q.from ?? null);
    const to = arg(q.to ?? null);
    const inRange = (col: string) =>
      `${col} BETWEEN COALESCE(${from}::date, '-infinity'::date) AND COALESCE(${to}::date, 'infinity'::date)`;
    const where: string[] = [];
    if (q.show === 'active') where.push('(a.borrowed > 0 OR a.returned > 0 OR a.holding > 0)');
    if (q.show === 'holding') where.push('a.holding > 0');
    if (q.show === 'overdue') where.push('a.overdue > 0');
    if (q.classId) where.push(`b.class_id = ${arg(q.classId)}::bigint`);
    if (q.sectionId) where.push(`b.section_id = ${arg(q.sectionId)}::bigint`);
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(`(b.name ILIKE ${p} OR b.ref ILIKE ${p})`);
    }
    const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
    // eslint-disable-next-line no-restricted-syntax -- fixed expressions of this service; values are bound
    return `SELECT a.*, b.name, b.ref, b.place, b.roll_no, b.class_order
              FROM (
                SELECT l.borrower_id::text AS borrower_id, l.borrower_kind::text AS bkind,
                       count(*) FILTER (WHERE ${inRange('l.issued_on')}) AS borrowed,
                       count(*) FILTER (WHERE l.returned_on IS NOT NULL AND ${inRange('l.returned_on')}) AS returned,
                       count(*) FILTER (WHERE l.returned_on IS NULL) AS holding,
                       count(*) FILTER (WHERE l.returned_on IS NULL AND l.due_on < CURRENT_DATE) AS overdue,
                       count(*) FILTER (WHERE l.returned_on IS NOT NULL AND l.returned_on > l.due_on AND ${inRange('l.returned_on')}) AS late,
                       COALESCE(sum(l.fine_amount) FILTER (WHERE l.returned_on IS NOT NULL AND ${inRange('l.returned_on')}), 0) AS fines,
                       count(*) AS ever, max(l.issued_on)::text AS last_issued
                  FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
                 WHERE l.borrower_kind = ${kind}::library_borrower
                 GROUP BY l.borrower_id, l.borrower_kind) a
              ${borrowerLateral('a.bkind', 'a.borrower_id::bigint')}
             ${filter}`;
  }

  private async borrowersRows(c: PoolClient, q: BorrowersQueryDto, limit: number, offset = 0) {
    const args: unknown[] = [];
    const inner = this.borrowersSql(q, args);
    const n = args.length;
    const order =
      q.sort === 'holding'
        ? 'z.holding DESC, z.overdue DESC, z.name'
        : q.sort === 'borrowed'
          ? 'z.borrowed DESC, z.name'
          : q.kind === 'student'
            ? 'z.class_order NULLS LAST, z.place NULLS LAST, z.roll_no NULLS LAST, z.name'
            : 'z.name';
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- the inner query and the order are this service's own
      `SELECT z.*, count(*) OVER () AS __total, sum(z.borrowed) OVER () AS __borrowed, sum(z.returned) OVER () AS __returned,
              sum(z.holding) OVER () AS __holding, sum(z.overdue) OVER () AS __overdue, sum(z.fines) OVER () AS __fines
         FROM (${inner}) z ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, limit, offset],
    );
    const top = r.rows[0];
    return {
      rows: r.rows.map((x) => ({
        kind: String(x.bkind),
        id: String(x.borrower_id),
        name: String(x.name ?? ''),
        ref: String(x.ref ?? ''),
        place: x.place as string | null,
        rollNo: x.roll_no === null || x.roll_no === undefined ? null : Number(x.roll_no),
        borrowed: Number(x.borrowed),
        returned: Number(x.returned),
        holding: Number(x.holding),
        overdue: Number(x.overdue),
        late: Number(x.late),
        fines: round(Number(x.fines)),
        ever: Number(x.ever),
        lastIssued: x.last_issued as string | null,
      })),
      total: Number(top?.__total ?? 0),
      totals: {
        borrowed: Number(top?.__borrowed ?? 0),
        returned: Number(top?.__returned ?? 0),
        holding: Number(top?.__holding ?? 0),
        overdue: Number(top?.__overdue ?? 0),
        fines: round(Number(top?.__fines ?? 0)),
      },
    };
  }

  async borrowers(ctx: RequestContext, q: BorrowersQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const page = await this.borrowersRows(c, q, q.size, (q.page - 1) * q.size);
      return { ...page, page: q.page, pages: Math.max(1, Math.ceil(page.total / q.size)) };
    });
  }

  async borrowersExport(ctx: RequestContext, q: BorrowersExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows, totals } = await this.borrowersRows(c, q, 50000);
      const pupils = q.kind === 'student';
      const SHOW: Record<BorrowersQueryDto['show'], string> = {
        active: 'borrowed or returned between the days, or holding now',
        holding: 'holding books now',
        overdue: 'with books overdue now',
        all: 'every borrower',
      };
      const words = [
        q.from || q.to ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}` : 'Every day',
        SHOW[q.show],
        q.classId || q.sectionId ? 'one class or section' : null,
        q.q ? `search "${q.q}"` : null,
      ]
        .filter(Boolean)
        .join('; ');
      await this.audit.stage(ctx, c, {
        action: 'library.borrowers.export',
        entityType: 'library_loans',
        entityId: requireTenant(ctx).schoolId,
        after: { kind: q.kind, format: q.format, rows: rows.length, words },
      });
      // Excel: a second sheet with each person's books held between the days, a heading row each
      const more = q.format === 'xlsx' ? [await this.booksSheet(c, q, rows, pupils)] : undefined;
      return libraryFile({
        more,
        format: q.format,
        name: pupils ? 'Library: pupils and their books' : 'Library: staff and their books',
        slug: `Library-${pupils ? 'pupils' : 'staff'}-books`,
        school: await this.school(c),
        by: ctx.user.displayName,
        words,
        columns: [
          { label: pupils ? 'Pupil' : 'Staff member' },
          { label: pupils ? 'Adm. no.' : 'Emp. code', width: 1.6 },
          { label: pupils ? 'Class' : 'Designation', width: 1.8 },
          ...(pupils ? [{ label: 'Roll no.', type: 'number' as const, width: 1 }] : []),
          { label: 'Borrowed', type: 'number', width: 1.2 },
          { label: 'Returned', type: 'number', width: 1.2 },
          { label: 'Returned late', type: 'number', width: 1.2 },
          { label: 'Holding now', type: 'number', width: 1.2 },
          { label: 'Overdue now', type: 'number', width: 1.2 },
          { label: 'Late fines (₹)', type: 'money' },
          { label: 'Last issued', type: 'date' },
          { label: 'Loans ever', type: 'number', width: 1.2 },
        ],
        rows: rows.map((r): FileCell[] => [
          r.name,
          r.ref,
          r.place,
          ...(pupils ? [r.rollNo] : []),
          r.borrowed,
          r.returned,
          r.late,
          r.holding,
          r.overdue,
          r.fines,
          r.lastIssued,
          r.ever,
        ]),
        totals: [
          'Total',
          '',
          '',
          ...(pupils ? [''] : []),
          totals.borrowed,
          totals.returned,
          '',
          totals.holding,
          totals.overdue,
          totals.fines,
          '',
          '',
        ],
      });
    });
  }

  /** Each listed person's books held between the days (every loan when none), under a heading row. */
  private async booksSheet(
    c: PoolClient,
    q: BorrowersQueryDto,
    people: Array<{ id: string; name: string; ref: string; place: string | null }>,
    pupils: boolean,
  ): Promise<FileSheet> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed expressions of this service; values are bound
      `SELECT l.borrower_id::text AS bid, x.accession_no, t.title, t.author, l.issued_on::text AS issued_on,
              l.due_on::text AS due_on, l.renewed, l.returned_on::text AS returned_on,
              GREATEST(0, COALESCE(l.returned_on, CURRENT_DATE) - l.due_on) AS days_late,
              l.fine_amount, ${FINE_STATE} AS fine_state, ${OUTCOME} AS outcome
         FROM library_loans l
         JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
         ${LOAN_CHARGES}
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = ANY($2::bigint[])
          AND ($3::date IS NULL OR l.returned_on IS NULL OR l.returned_on >= $3::date)
          AND ($4::date IS NULL OR l.issued_on <= $4::date)
        ORDER BY l.issued_on, l.id`,
      [q.kind, people.map((p) => p.id), q.from ?? null, q.to ?? null],
    );
    const byPerson = new Map<string, Array<Record<string, unknown>>>();
    for (const x of r.rows)
      byPerson.set(String(x.bid), [...(byPerson.get(String(x.bid)) ?? []), x]);
    const rows: FileCell[][] = [];
    const headings: number[] = [];
    for (const p of people) {
      const loans = byPerson.get(p.id) ?? [];
      if (!loans.length) continue;
      headings.push(rows.length);
      rows.push([
        `${p.name} · ${p.ref}${p.place ? ` · ${p.place}` : ''} · ${String(loans.length)} book${loans.length === 1 ? '' : 's'}`,
      ]);
      for (const x of loans)
        rows.push([
          x.accession_no as string,
          x.title as string,
          x.author as string | null,
          x.issued_on as string,
          x.due_on as string,
          Number(x.renewed ?? 0) || null,
          x.returned_on as string | null,
          Number(x.days_late ?? 0) || null,
          x.outcome as string,
          Number(x.fine_amount ?? 0) || null,
          x.fine_state as string | null,
        ]);
    }
    return {
      name: pupils ? 'Books by pupil' : 'Books by staff member',
      columns: [
        { label: 'Book no.', width: 1.4 },
        { label: 'Book' },
        { label: 'Author', width: 2 },
        { label: 'Issued on', type: 'date' },
        { label: 'Due on', type: 'date' },
        { label: 'Renewed', type: 'number', width: 1.4 },
        { label: 'Returned on', type: 'date' },
        { label: 'Days late', type: 'number', width: 1.2 },
        { label: 'How it ended', width: 1.8 },
        { label: 'Fine (₹)', type: 'money' },
        { label: 'Fine now', width: 2.4 },
      ],
      rows,
      headings,
    };
  }

  // ---- one borrower ------------------------------------------------------------------------------
  private async borrowerRows(c: PoolClient, kind: string, id: string, q: BorrowerHistoryDto) {
    if (kind !== 'student' && kind !== 'employee')
      throw new DomainError('not-found', 'Borrower not found', { status: 404 });
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Borrower not found', { status: 404 });
    const who = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- a fixed join of this service; values are bound
      `SELECT b.* FROM (SELECT $1::text AS bkind, $2::bigint AS bid) s ${borrowerLateral('s.bkind', 's.bid')}
        WHERE b.name IS NOT NULL`,
      [kind, id],
    );
    if (!who.rows[0]) throw new DomainError('not-found', 'Borrower not found', { status: 404 });
    // the books held at any time between the days: issued by the last day, not back before the first
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed expressions of this service; values are bound
      `SELECT l.id::text, x.accession_no, t.id::text AS title_id, t.title, t.author, l.issued_on::text AS issued_on,
              l.due_on::text AS due_on, l.returned_on::text AS returned_on, l.renewed,
              GREATEST(0, COALESCE(l.returned_on, CURRENT_DATE) - l.due_on) AS days_late,
              l.fine_amount, l.fine_waived, ${FINE_STATE} AS fine_state, ${OUTCOME} AS outcome,
              cc.amount AS charged, iu.display_name AS issued_by, ru.display_name AS returned_by
         FROM library_loans l
         JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
         ${LOAN_CHARGES}
         LEFT JOIN users iu ON iu.id = l.issued_by LEFT JOIN users ru ON ru.id = l.returned_by
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2
          AND ($3::date IS NULL OR l.returned_on IS NULL OR l.returned_on >= $3::date)
          AND ($4::date IS NULL OR l.issued_on <= $4::date)
        ORDER BY l.issued_on DESC, l.id DESC`,
      [kind, id, q.from ?? null, q.to ?? null],
    );
    const rows = r.rows.map((x) => ({
      loanId: String(x.id),
      accessionNo: String(x.accession_no),
      titleId: String(x.title_id),
      title: String(x.title),
      author: x.author as string | null,
      issuedOn: String(x.issued_on),
      dueOn: String(x.due_on),
      returnedOn: x.returned_on as string | null,
      renewed: Number(x.renewed ?? 0),
      daysLate: Number(x.days_late ?? 0),
      fine: round(Number(x.fine_amount ?? 0)),
      fineState: x.fine_state as string | null,
      outcome: String(x.outcome),
      charged: x.charged === null ? null : round(Number(x.charged)),
      issuedBy: x.issued_by as string | null,
      returnedBy: x.returned_by as string | null,
    }));
    const b = who.rows[0];
    return {
      borrower: {
        kind,
        id,
        name: String(b.name),
        ref: String(b.ref ?? ''),
        place: b.place as string | null,
      },
      rows,
      totals: {
        loans: rows.length,
        out: rows.filter((x) => !x.returnedOn && x.outcome !== 'Lost').length,
        late: rows.filter((x) => x.daysLate > 0).length,
        fines: round(rows.reduce((n, x) => n + x.fine, 0)),
      },
    };
  }

  async borrower(ctx: RequestContext, kind: string, id: string, q: BorrowerHistoryDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.borrowerRows(c, kind, id, q));
  }

  async borrowerExport(ctx: RequestContext, kind: string, id: string, q: BorrowerHistoryExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { borrower: b, rows, totals } = await this.borrowerRows(c, kind, id, q);
      const words = [
        `${b.name} (${b.ref}${b.place ? `, ${b.place}` : ''})`,
        q.from || q.to
          ? `books held ${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}`
          : 'every loan',
      ].join('; ');
      await this.audit.stage(ctx, c, {
        action: 'library.borrower.export',
        entityType: kind === 'student' ? 'students' : 'employees',
        entityId: id,
        after: { format: q.format, rows: rows.length },
      });
      return libraryFile({
        format: q.format,
        name: `Library history: ${b.name}`,
        slug: `Library-history-${b.ref.replace(/[^A-Za-z0-9-]+/g, '') || id}`,
        school: await this.school(c),
        by: ctx.user.displayName,
        words,
        columns: [
          { label: 'Book no.', width: 1.4 },
          { label: 'Book' },
          { label: 'Author', width: 2 },
          { label: 'Issued on', type: 'date' },
          { label: 'Due on', type: 'date' },
          { label: 'Renewed', type: 'number', width: 1.4 },
          { label: 'Returned on', type: 'date' },
          { label: 'Days late', type: 'number', width: 1 },
          { label: 'Outcome', width: 1.6 },
          { label: 'Fine (₹)', type: 'money' },
          { label: 'Fine now', width: 2.2 },
          { label: 'Charged (₹)', type: 'money' },
          { label: 'Issued by', width: 1.6 },
        ],
        rows: rows.map((r): FileCell[] => [
          r.accessionNo,
          r.title,
          r.author,
          r.issuedOn,
          r.dueOn,
          r.renewed,
          r.returnedOn,
          r.daysLate || null,
          r.outcome,
          r.fine || null,
          r.fineState,
          r.charged,
          r.issuedBy,
        ]),
        totals: [
          `Total · ${String(totals.loans)}`,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          totals.fines,
          '',
          '',
          '',
        ],
      });
    });
  }
}
