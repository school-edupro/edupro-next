import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { likeEscape } from './library-borrower-sql';
import { libraryFile } from './library-file';
import { LibraryReservationsService } from './library-reservations.service';

type Kind = 'student' | 'employee';
export interface PortalHistoryQuery {
  from?: string;
  to?: string;
  status?: 'all' | 'out' | 'returned' | 'late' | 'renewed' | 'fined';
  q?: string;
  page?: number;
}
const STATUS_WORDS: Record<string, string> = {
  out: 'not returned yet',
  returned: 'returned',
  late: 'late',
  renewed: 'renewed',
  fined: 'with a fine',
};
const FINE_WORDS: Record<string, string> = { paid: 'Paid', waived: 'Waived', due: 'Due' };
type Person = { kind: Kind; id: string; name: string; ref: string; place: string | null };
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The library in the portals (docs/design/36-library.md, "Library round 3", part 4): a parent sees their
 * children's, a pupil their own, a staff member their own: the books held (due, late, the fine to today),
 * the history, what is due at the fees counter, the reservations (their place in the queue, a book kept
 * for them until a day), a summary for the home; the catalogue with each book's status (on the shelf,
 * all out and when one is due back), never who has it; a reservation placed or cancelled.
 */
@Injectable()
export class LibraryPortalService {
  constructor(
    private readonly db: DbService,
    private readonly viewer: ViewerService,
    private readonly reservations: LibraryReservationsService,
  ) {}

  /** The borrowers the signed-in person may look at: their children, or themselves. */
  private async people(ctx: RequestContext): Promise<Person[]> {
    const v = await this.viewer.resolve(ctx, 'library.family.view');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (v.kind === 'family') {
        if (!ctx.permissions?.has('library.family.view'))
          throw new DomainError('forbidden', 'The library is not open to this account', {
            status: 403,
          });
        if (!v.students.length) return [];
        const r = await c.query<{ id: string; name: string; ref: string; place: string | null }>(
          `SELECT s.id::text, s.display_name AS name, s.admission_no AS ref,
                  (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                     JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.status = 'active'
                    ORDER BY e.id DESC LIMIT 1) AS place
             FROM students s WHERE s.id = ANY($1::bigint[]) ORDER BY s.display_name`,
          [v.students.map((s) => s.id)],
        );
        return r.rows.map((x) => ({ kind: 'student' as const, ...x }));
      }
      if (!v.employeeId) return [];
      const e = await c.query<{ id: string; name: string; ref: string; place: string | null }>(
        `SELECT id::text, display_name AS name, employee_code AS ref, designation AS place FROM employees WHERE id = $1`,
        [v.employeeId],
      );
      return e.rows.map((x) => ({ kind: 'employee' as const, ...x }));
    });
  }

  private async one(ctx: RequestContext, kind: string, id: string) {
    const all = await this.people(ctx);
    const p = all.find((x) => x.kind === kind && x.id === id);
    if (!p) throw new DomainError('not-found', 'Not one of your borrowers', { status: 404 });
    return p;
  }

  private async booksOf(c: PoolClient, p: Person, open: boolean) {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- a fixed order; values are bound
      `SELECT l.id::text, x.accession_no, t.id::text AS title_id, t.title, t.author, lib.name AS library,
              l.issued_on::text, l.due_on::text, l.returned_on::text, l.renewed,
              GREATEST(0, COALESCE(l.returned_on, CURRENT_DATE) - l.due_on)::int AS days_late,
              l.fine_amount, l.fine_waived
         FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN library_libraries lib ON lib.id = x.library_id
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2
          AND (l.returned_on IS NULL) = $3
        ORDER BY ${open ? 'l.due_on, l.id' : 'l.returned_on DESC, l.id DESC'} LIMIT 200`,
      [p.kind, p.id, open],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
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
      fine: round(Math.max(0, Number(x.fine_amount ?? 0) - Number(x.fine_waived ?? 0))),
    }));
  }

  private async duesOf(c: PoolClient, p: Person) {
    const r = await c.query<{ counter: string; library: string }>(
      `SELECT app.library_charges_due($1::library_borrower, $2)::text AS counter,
              app.library_fines_unsent($1::library_borrower, $2)::text AS library`,
      [p.kind, p.id],
    );
    return {
      atCounter: round(Number(r.rows[0]!.counter)),
      atLibrary: round(Number(r.rows[0]!.library)),
    };
  }

  /** The borrowers and, for each, what the home shows: books held, due soon, late, kept for them. */
  async summary(ctx: RequestContext) {
    const people = await this.people(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.reservations.tidyIn(c);
      const out = [];
      for (const p of people) {
        const now = await this.booksOf(c, p, true);
        const res = await this.reservations.ofBorrowersIn(c, [p]);
        out.push({
          ...p,
          holding: now.length,
          late: now.filter((x) => x.daysLate > 0).length,
          // due in the next three days (India time)
          dueSoon: now.filter((x) => {
            const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
            const d = (Date.parse(x.dueOn) - Date.parse(today)) / 86_400_000;
            return d >= 0 && d <= 3;
          }).length,
          nextDue: now.find((x) => x.daysLate === 0)?.dueOn ?? null,
          ready: res
            .filter((x) => x.status === 'ready')
            .map((x) => ({ title: x.title, until: x.readyUntil, library: x.library })),
          waiting: res.filter((x) => x.status === 'waiting').length,
        });
      }
      return { people: out };
    });
  }

  /** One borrower's library: held now, the history, the reservations, the dues. */
  async borrower(ctx: RequestContext, kind: string, id: string) {
    const p = await this.one(ctx, kind, id);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.reservations.tidyIn(c);
      return {
        borrower: p,
        now: await this.booksOf(c, p, true),
        history: await this.booksOf(c, p, false),
        reservations: await this.reservations.ofBorrowersIn(c, [p]),
        dues: await this.duesOf(c, p),
      };
    });
  }

  // ---- my library: figures and the history with filters (library round 4, part 3) --------------------
  /** The start of the session (the academic year in use, else 1 April). */
  private async sessionStart(c: PoolClient) {
    const r = await c.query<{ d: string | null }>(
      `SELECT COALESCE((SELECT start_date FROM academic_years WHERE id = app.current_academic_year_id()),
                       (SELECT start_date FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1))::text AS d`,
    );
    if (r.rows[0]?.d) return r.rows[0].d;
    const t = new Date(Date.now() + 330 * 60_000);
    const y = t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
    return `${String(y)}-04-01`;
  }

  /** Figures for a borrower's library page: now, this session, late returns, fines, six months. */
  private async statsOf(c: PoolClient, p: Person) {
    const from = await this.sessionStart(c);
    const r = await c.query<Record<string, unknown>>(
      `SELECT count(*) FILTER (WHERE l.returned_on IS NULL)::int AS holding,
              count(*) FILTER (WHERE l.returned_on IS NULL AND l.due_on < CURRENT_DATE)::int AS overdue,
              count(*) FILTER (WHERE l.issued_on >= $3::date)::int AS read_session,
              count(*) FILTER (WHERE l.issued_on >= date_trunc('month', CURRENT_DATE))::int AS read_month,
              count(*)::int AS read_ever,
              count(*) FILTER (WHERE l.returned_on > l.due_on AND l.issued_on >= $3::date)::int AS late_session,
              count(*) FILTER (WHERE l.returned_on IS NOT NULL AND l.returned_on <= l.due_on AND l.issued_on >= $3::date)::int AS on_time_session,
              COALESCE(round(avg(l.returned_on - l.issued_on) FILTER (WHERE l.returned_on IS NOT NULL AND l.issued_on >= $3::date), 1), 0)::float AS avg_days,
              COALESCE(sum(l.fine_amount) FILTER (WHERE l.issued_on >= $3::date), 0)::float AS fines_session,
              COALESCE(sum(l.fine_amount) FILTER (WHERE l.fine_paid_on IS NOT NULL AND l.issued_on >= $3::date), 0)::float AS fines_paid,
              COALESCE(sum(l.fine_waived) FILTER (WHERE l.issued_on >= $3::date), 0)::float AS fines_waived
         FROM library_loans l
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2`,
      [p.kind, p.id, from],
    );
    const months = await c.query<{ month: string; n: number }>(
      `SELECT to_char(g, 'YYYY-MM') AS month,
              (SELECT count(*)::int FROM library_loans l WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2
                  AND l.issued_on >= g::date AND l.issued_on < (g + interval '1 month')::date) AS n
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') g
        ORDER BY 1`,
      [p.kind, p.id],
    );
    const subjects = await c.query<{ subject: string; n: number }>(
      `SELECT COALESCE(s.name::text, m.name, 'Other') AS subject, count(*)::int AS n
         FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN library_subjects s ON s.id = t.subject_id LEFT JOIN library_material_types m ON m.id = t.material_type_id
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2 AND l.issued_on >= $3::date
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 3`,
      [p.kind, p.id, from],
    );
    const x = r.rows[0]!;
    return {
      sessionFrom: from,
      holding: Number(x.holding),
      overdue: Number(x.overdue),
      readSession: Number(x.read_session),
      readMonth: Number(x.read_month),
      readEver: Number(x.read_ever),
      lateSession: Number(x.late_session),
      onTimeSession: Number(x.on_time_session),
      avgDays: Number(x.avg_days),
      finesSession: round(Number(x.fines_session)),
      finesPaid: round(Number(x.fines_paid)),
      finesWaived: round(Number(x.fines_waived)),
      months: months.rows.map((m) => ({ month: m.month, issued: Number(m.n) })),
      subjects: subjects.rows.map((s) => ({ subject: s.subject, loans: Number(s.n) })),
    };
  }

  private historyWhere(q: PortalHistoryQuery, args: unknown[]) {
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    const where: string[] = [];
    if (q.from) where.push(`l.issued_on >= ${arg(q.from)}::date`);
    if (q.to) where.push(`l.issued_on <= ${arg(q.to)}::date`);
    if (q.status === 'out') where.push('l.returned_on IS NULL');
    if (q.status === 'returned') where.push('l.returned_on IS NOT NULL');
    if (q.status === 'late')
      where.push(
        '(l.returned_on > l.due_on OR (l.returned_on IS NULL AND l.due_on < CURRENT_DATE))',
      );
    if (q.status === 'renewed') where.push('l.renewed > 0');
    if (q.status === 'fined') where.push('l.fine_amount > 0');
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(`(t.title ILIKE ${p} OR t.author ILIKE ${p} OR x.accession_no ILIKE ${p})`);
    }
    return where.length ? `AND ${where.join(' AND ')}` : '';
  }

  private async historyRows(
    c: PoolClient,
    p: Person,
    q: PortalHistoryQuery,
    limit: number,
    offset: number,
  ) {
    const args: unknown[] = [p.kind, p.id];
    const w = this.historyWhere(q, args);
    const total = await c.query<{ n: number }>(
      // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments with numbered placeholders; values are bound
      `SELECT count(*)::int AS n FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2 ${w}`,
      args,
    );
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments with numbered placeholders; values are bound
      `SELECT l.id::text, x.accession_no, t.id::text AS title_id, t.title, t.author, lib.name AS library,
              COALESCE(s.name::text, m.name) AS subject,
              l.issued_on::text AS issued_on, l.due_on::text AS due_on, l.returned_on::text AS returned_on, l.renewed,
              GREATEST(0, COALESCE(l.returned_on, CURRENT_DATE) - l.due_on)::int AS days_late,
              COALESCE(l.returned_on, CURRENT_DATE) - l.issued_on AS days_kept,
              l.fine_amount, l.fine_waived, l.fine_paid_on::text AS fine_paid_on
         FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN library_libraries lib ON lib.id = x.library_id
         LEFT JOIN library_subjects s ON s.id = t.subject_id LEFT JOIN library_material_types m ON m.id = t.material_type_id
        WHERE l.borrower_kind = $1::library_borrower AND l.borrower_id = $2 ${w}
        ORDER BY l.issued_on DESC, l.id DESC LIMIT ${String(limit)} OFFSET ${String(offset)}`,
      args,
    );
    return {
      total: total.rows[0]?.n ?? 0,
      rows: r.rows.map((x) => {
        const fine = Number(x.fine_amount ?? 0);
        const waived = Number(x.fine_waived ?? 0);
        return {
          id: String(x.id),
          accessionNo: String(x.accession_no),
          titleId: String(x.title_id),
          title: String(x.title),
          author: x.author as string | null,
          library: x.library as string | null,
          subject: x.subject as string | null,
          issuedOn: String(x.issued_on),
          dueOn: String(x.due_on),
          returnedOn: x.returned_on as string | null,
          renewed: Number(x.renewed ?? 0),
          daysLate: Number(x.days_late ?? 0),
          daysKept: Number(x.days_kept ?? 0),
          fine: round(fine),
          waived: round(waived),
          fineStatus:
            fine <= 0 ? null : x.fine_paid_on ? 'paid' : waived >= fine ? 'waived' : 'due',
        };
      }),
    };
  }

  /** My library: the figures and one page of the history, filtered. */
  async history(ctx: RequestContext, kind: string, id: string, q: PortalHistoryQuery) {
    const p = await this.one(ctx, kind, id);
    const size = 20;
    const page = Math.max(1, q.page ?? 1);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.historyRows(c, p, q, size, (page - 1) * size);
      return {
        borrower: p,
        stats: await this.statsOf(c, p),
        rows: h.rows,
        total: h.total,
        page,
        pages: Math.max(1, Math.ceil(h.total / size)),
      };
    });
  }

  /** The history as filtered, as Excel or PDF. */
  async historyExport(
    ctx: RequestContext,
    kind: string,
    id: string,
    q: PortalHistoryQuery,
    format: 'xlsx' | 'pdf',
  ) {
    const p = await this.one(ctx, kind, id);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.historyRows(c, p, q, 5000, 0);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const dmy = (d: string | null) =>
        d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
      const words = [
        `${p.name} (${p.ref}${p.place ? `, ${p.place}` : ''})`,
        q.from || q.to
          ? `issued ${dmy(q.from ?? null) || '…'} to ${dmy(q.to ?? null) || '…'}`
          : 'every day',
        q.status && q.status !== 'all' ? STATUS_WORDS[q.status] : null,
        q.q ? `search "${q.q}"` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return libraryFile({
        format,
        name: `Library history of ${p.name}`,
        slug: `Library-history-${p.ref}`,
        school,
        by: ctx.user.displayName,
        words,
        columns: [
          { label: 'Accession no.', width: 12 },
          { label: 'Title', width: 34 },
          { label: 'Author', width: 22 },
          { label: 'Subject', width: 14 },
          { label: 'Issued', type: 'date' },
          { label: 'Due', type: 'date' },
          { label: 'Returned', type: 'date' },
          { label: 'Days kept', type: 'number' },
          { label: 'Days late', type: 'number' },
          { label: 'Renewed', type: 'number' },
          { label: 'Fine', type: 'money' },
          { label: 'Fine status', width: 10 },
        ],
        rows: h.rows.map((r) => [
          r.accessionNo,
          r.title,
          r.author,
          r.subject,
          r.issuedOn,
          r.dueOn,
          r.returnedOn ?? 'Not yet',
          r.daysKept,
          r.daysLate,
          r.renewed,
          r.fine || null,
          r.fineStatus ? FINE_WORDS[r.fineStatus] : null,
        ]),
        totals: [
          'Total',
          `${String(h.rows.length)} books`,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          round(h.rows.reduce((n, r) => n + r.fine, 0)),
          null,
        ],
      });
    });
  }

  /** The catalogue: books by title, author, subject or ISBN, each with whether a copy is on the shelf. */
  async catalogue(ctx: RequestContext, q: string, page: number) {
    await this.people(ctx);
    const text = q.trim().slice(0, 80);
    const size = 20;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.reservations.tidyIn(c);
      const r = await c.query<Record<string, unknown>>(
        `SELECT t.id::text, t.title, t.author, t.publisher, t.year, s.name::text AS subject, m.name AS material,
                (t.is_reference OR NOT COALESCE(m.issuable, true)) AS reference,
                count(x.id) FILTER (WHERE x.status IN ('available', 'issued', 'damaged'))::int AS copies,
                count(x.id) FILTER (WHERE x.status = 'available' AND NOT EXISTS (
                  SELECT 1 FROM library_reservations h WHERE h.copy_id = x.id AND h.status = 'ready'))::int AS on_shelf,
                (SELECT min(l.due_on) FROM library_loans l JOIN library_copies y ON y.id = l.copy_id
                  WHERE y.title_id = t.id AND l.returned_on IS NULL)::text AS next_back,
                (SELECT count(*) FROM library_reservations q WHERE q.title_id = t.id AND q.status = 'waiting')::int AS queue,
                (SELECT string_agg(DISTINCT lib.name, ', ') FROM library_copies z JOIN library_libraries lib ON lib.id = z.library_id
                  WHERE z.title_id = t.id AND z.status = 'available') AS libraries,
                count(*) OVER () AS __total
           FROM library_titles t
           LEFT JOIN library_subjects s ON s.id = t.subject_id
           LEFT JOIN library_material_types m ON m.id = t.material_type_id
           LEFT JOIN library_copies x ON x.title_id = t.id
          WHERE t.status = 'active'
            AND ($1::text IS NULL OR t.title ILIKE $1 OR t.author ILIKE $1 OR s.name::text ILIKE $1 OR t.isbn ILIKE $1
                 OR t.publisher ILIKE $1)
          GROUP BY t.id, s.name, m.name, m.issuable
         HAVING count(x.id) FILTER (WHERE x.status IN ('available', 'issued', 'damaged')) > 0
          ORDER BY t.title LIMIT $2 OFFSET $3`,
        [text ? likeEscape(text) : null, size, (page - 1) * size],
      );
      const total = Number(r.rows[0]?.__total ?? 0);
      return {
        rows: r.rows.map((x) => {
          const onShelf = Number(x.on_shelf);
          const reference = Boolean(x.reference);
          return {
            titleId: String(x.id),
            title: String(x.title),
            author: x.author as string | null,
            publisher: x.publisher as string | null,
            year: x.year === null ? null : Number(x.year),
            subject: x.subject as string | null,
            material: x.material as string | null,
            copies: Number(x.copies),
            onShelf,
            libraries: x.libraries as string | null,
            nextBack: onShelf ? null : (x.next_back as string | null),
            queue: Number(x.queue),
            reference,
            // reserved only when every copy is out
            canReserve: !reference && onShelf === 0,
          };
        }),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / size)),
      };
    });
  }

  async reserve(ctx: RequestContext, kind: string, id: string, titleId: string) {
    const p = await this.one(ctx, kind, id);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rid = await this.reservations.placeIn(c, ctx, p.kind, p.id, titleId);
      const mine = await this.reservations.ofBorrowersIn(c, [p]);
      return mine.find((x) => x.id === rid)!;
    });
  }

  async cancel(ctx: RequestContext, reservationId: string) {
    if (!/^\d{1,18}$/.test(reservationId))
      throw new DomainError('not-found', 'Reservation not found', { status: 404 });
    const people = await this.people(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ kind: string; bid: string }>(
        `SELECT borrower_kind::text AS kind, borrower_id::text AS bid FROM library_reservations WHERE id = $1`,
        [reservationId],
      );
      const x = r.rows[0];
      if (!x || !people.some((p) => p.kind === x.kind && p.id === x.bid))
        throw new DomainError('not-found', 'Reservation not found', { status: 404 });
      await this.reservations.cancelIn(c, ctx, reservationId, 'Cancelled by the borrower');
      return { id: reservationId, status: 'cancelled' };
    });
  }
}
