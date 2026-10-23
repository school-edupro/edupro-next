import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { borrowerLateral, likeEscape } from './library-borrower-sql';
import { LibraryService } from './library.service';

const ID = /^\d{1,18}$/;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;
type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/**
 * Library overview (library round 4, part 2): check one book — a copy found by its accession number or
 * barcode (an old corrected number too), or titles found by name, author or ISBN — with where it is, who
 * has it, the fine so far, the reservations, the other copies and its whole history; and the library
 * dashboard: today's figures, six months of issues and returns, the most read, what is overdue and the
 * periodicals due. Library staff tied to libraries see their own libraries only (row-level security).
 */
@Injectable()
export class LibraryOverviewService {
  constructor(
    private readonly db: DbService,
    private readonly library: LibraryService,
  ) {}

  // ---- check one book --------------------------------------------------------------------------------
  async check(ctx: RequestContext, q: string) {
    const text = q.trim();
    if (text.length < 1) return { kind: 'none' as const, titles: [] };
    const found = await this.db.tenant(requireTenant(ctx), async (c) => {
      const copy = await c.query<{ id: string | null }>(
        `SELECT app.library_copy_by_number($1)::text AS id`,
        [text],
      );
      return copy.rows[0]?.id ?? null;
    });
    if (found) return { kind: 'copy' as const, copyId: found };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = likeEscape(text);
      const r = await c.query<Row>(
        `SELECT t.id::text, t.title, t.subtitle, t.author, t.isbn, t.call_no, m.name AS material, t.is_reference,
                count(x.id) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
                count(x.id) FILTER (WHERE x.status = 'available')::int AS available,
                count(x.id) FILTER (WHERE x.status = 'issued')::int AS on_loan,
                (SELECT count(*)::int FROM library_reservations rv WHERE rv.title_id = t.id AND rv.status IN ('waiting', 'ready')) AS reserved,
                (SELECT min(l.due_on)::text FROM library_loans l JOIN library_copies y ON y.id = l.copy_id
                  WHERE y.title_id = t.id AND l.returned_on IS NULL) AS next_due,
                min(x.accession_no) AS first_accession
           FROM library_titles t
           JOIN library_copies x ON x.title_id = t.id
           LEFT JOIN library_material_types m ON m.id = t.material_type_id
          WHERE t.status = 'active'
            AND (t.title ILIKE $1 OR t.author ILIKE $1 OR t.isbn ILIKE $1 OR x.accession_no ILIKE $1 OR x.barcode ILIKE $1 OR t.call_no ILIKE $1)
          GROUP BY t.id, m.name
          ORDER BY (lower(t.title) = lower($2)) DESC, t.title
          LIMIT 25`,
        [p, text],
      );
      return {
        kind: 'titles' as const,
        titles: r.rows.map((x) => ({
          id: String(x.id),
          title: String(x.title),
          subtitle: str(x.subtitle),
          author: str(x.author),
          isbn: str(x.isbn),
          callNo: str(x.call_no),
          material: str(x.material),
          reference: Boolean(x.is_reference),
          copies: Number(x.copies),
          available: Number(x.available),
          onLoan: Number(x.on_loan),
          reserved: Number(x.reserved),
          nextDue: str(x.next_due),
          firstAccession: str(x.first_accession),
        })),
      };
    });
  }

  /** One copy: where it is, who has it, the fine so far, holds, charges, the other copies, its history. */
  async copy(ctx: RequestContext, id: string) {
    if (!ID.test(id)) throw new DomainError('not-found', 'Book not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT x.id::text, x.accession_no, x.barcode, x.status::text AS status, x.status_on::text AS status_on, x.status_reason,
                x.price, x.acquisition, x.donor, x.bill_no, x.bill_date::text AS bill_date, x.accessioned_on::text AS accessioned_on,
                x.last_verified_on::text AS last_verified_on, x.rack, x.remarks,
                l.name AS library, sh.code AS shelf, sh.name AS shelf_name, v.name AS vendor,
                t.id::text AS title_id, t.title, t.subtitle, t.author, t.isbn, t.call_no, t.edition, t.year, t.is_reference,
                m.name AS material, s.name::text AS subject, pb.name::text AS publisher, lg.name::text AS language,
                (SELECT string_agg(a.old_no, ', ' ORDER BY a.id) FROM library_accession_changes a WHERE a.copy_id = x.id) AS former_nos
           FROM library_copies x
           JOIN library_titles t ON t.id = x.title_id
           JOIN library_libraries l ON l.id = x.library_id
           LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
           LEFT JOIN library_vendors v ON v.id = x.vendor_id
           LEFT JOIN library_material_types m ON m.id = t.material_type_id
           LEFT JOIN library_subjects s ON s.id = t.subject_id
           LEFT JOIN library_publishers pb ON pb.id = t.publisher_id
           LEFT JOIN library_languages lg ON lg.id = t.language_id
          WHERE x.id = $1`,
        [id],
      );
      const x = r.rows[0];
      if (!x) throw new DomainError('not-found', 'Book not found', { status: 404 });
      const loan = await this.openLoan(c, id);
      const hold = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
        `SELECT rv.id::text, rv.ready_until::text AS ready_until, b.name, b.ref, b.place
           FROM library_reservations rv ${borrowerLateral('rv.borrower_kind::text', 'rv.borrower_id')}
          WHERE rv.copy_id = $1 AND rv.status = 'ready'`,
        [id],
      );
      const queue = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
        `SELECT rv.placed_at, b.name, b.ref, b.place
           FROM library_reservations rv ${borrowerLateral('rv.borrower_kind::text', 'rv.borrower_id')}
          WHERE rv.title_id = $1 AND rv.status = 'waiting' ORDER BY rv.placed_at LIMIT 10`,
        [x.title_id],
      );
      const others = await c.query<Row>(
        `SELECT y.id::text, y.accession_no, y.status::text AS status, l.name AS library,
                (SELECT ll.due_on::text FROM library_loans ll WHERE ll.copy_id = y.id AND ll.returned_on IS NULL LIMIT 1) AS due_on
           FROM library_copies y JOIN library_libraries l ON l.id = y.library_id
          WHERE y.title_id = $1 AND y.id <> $2 ORDER BY y.accession_no LIMIT 50`,
        [x.title_id, id],
      );
      const charges = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
        `SELECT ch.kind, ch.on_date::text AS on_date, ch.amount, ch.reason, b.name, b.ref
           FROM library_charges ch ${borrowerLateral('ch.borrower_kind::text', 'ch.borrower_id')}
          WHERE ch.copy_id = $1 ORDER BY ch.on_date DESC`,
        [id],
      );
      const history = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
        `SELECT h.on_date::text AS on_day, h.* FROM (
           SELECT l.issued_on AS on_date, 1 AS ord, 'issued' AS what, b.name, b.ref, b.place,
                  'due ' || to_char(l.due_on, 'DD-MM-YYYY') AS detail, NULL::numeric AS amount
             FROM library_loans l ${borrowerLateral('l.borrower_kind::text', 'l.borrower_id')} WHERE l.copy_id = $1
           UNION ALL
           SELECT l.returned_on, 2, 'returned', b.name, b.ref, b.place,
                  CASE WHEN l.returned_on > l.due_on THEN (l.returned_on - l.due_on)::text || ' days late' ELSE 'on time' END,
                  NULLIF(l.fine_amount, 0)
             FROM library_loans l ${borrowerLateral('l.borrower_kind::text', 'l.borrower_id')} WHERE l.copy_id = $1 AND l.returned_on IS NOT NULL
           UNION ALL
           SELECT e.on_date, 3, e.what, e.by_name, NULL, NULL,
                  concat_ws(' · ', CASE WHEN e.to_status IS NOT NULL THEN 'to ' || e.to_status END, e.reason), e.amount
             FROM library_copy_events e WHERE e.copy_id = $1
           UNION ALL
           SELECT k.finished_on, 4, 'stock check', i.found_by_name, NULL, NULL,
                  k.name || ': ' || i.outcome, NULL
             FROM library_stock_check_items i JOIN library_stock_checks k ON k.id = i.check_id
            WHERE i.copy_id = $1 AND k.status = 'closed') h
          WHERE h.on_date IS NOT NULL
          ORDER BY h.on_date DESC, h.ord DESC LIMIT 80`,
        [id],
      );
      return {
        copy: {
          id: String(x.id),
          accessionNo: String(x.accession_no),
          barcode: str(x.barcode),
          formerNos: str(x.former_nos),
          status: String(x.status),
          statusOn: str(x.status_on),
          statusReason: str(x.status_reason),
          library: String(x.library),
          shelf: x.shelf
            ? `${String(x.shelf)}${x.shelf_name ? ` (${String(x.shelf_name)})` : ''}`
            : null,
          rack: str(x.rack),
          price: x.price === null ? null : Number(x.price),
          acquisition: str(x.acquisition),
          vendor: str(x.vendor),
          donor: str(x.donor),
          billNo: str(x.bill_no),
          billDate: str(x.bill_date),
          accessionedOn: str(x.accessioned_on),
          lastVerifiedOn: str(x.last_verified_on),
          remarks: str(x.remarks),
        },
        title: {
          id: String(x.title_id),
          title: String(x.title),
          subtitle: str(x.subtitle),
          author: str(x.author),
          isbn: str(x.isbn),
          callNo: str(x.call_no),
          edition: str(x.edition),
          year: x.year === null ? null : Number(x.year),
          reference: Boolean(x.is_reference),
          material: str(x.material),
          subject: str(x.subject),
          publisher: str(x.publisher),
          language: str(x.language),
        },
        loan,
        hold: hold.rows[0]
          ? {
              until: str(hold.rows[0].ready_until),
              name: str(hold.rows[0].name),
              ref: str(hold.rows[0].ref),
              place: str(hold.rows[0].place),
            }
          : null,
        queue: queue.rows.map((q) => ({
          since: (q.placed_at as Date).toISOString(),
          name: str(q.name),
          ref: str(q.ref),
          place: str(q.place),
        })),
        others: others.rows.map((o) => ({
          id: String(o.id),
          accessionNo: String(o.accession_no),
          status: String(o.status),
          library: String(o.library),
          dueOn: str(o.due_on),
        })),
        charges: charges.rows.map((ch) => ({
          kind: String(ch.kind),
          on: String(ch.on_date),
          amount: Number(ch.amount),
          reason: str(ch.reason),
          name: str(ch.name),
          ref: str(ch.ref),
        })),
        history: history.rows.map((h) => ({
          on: String(h.on_day),
          what: String(h.what),
          name: str(h.name),
          ref: str(h.ref),
          place: str(h.place),
          detail: str(h.detail),
          amount: h.amount === null ? null : Number(h.amount),
        })),
      };
    });
  }

  private async openLoan(c: PoolClient, copyId: string) {
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
      `SELECT l.id::text, l.borrower_kind::text AS kind, l.borrower_id::text AS borrower_id, l.issued_on::text AS issued_on,
              l.due_on::text AS due_on, l.renewed, b.name, b.ref, b.place
         FROM library_loans l ${borrowerLateral('l.borrower_kind::text', 'l.borrower_id')}
        WHERE l.copy_id = $1 AND l.returned_on IS NULL`,
      [copyId],
    );
    const l = r.rows[0];
    if (!l) return null;
    const late = Math.max(
      0,
      Math.round((Date.parse(today()) - Date.parse(String(l.due_on))) / 86_400_000),
    );
    const rule = await this.library.ruleFor(
      c,
      l.kind as 'student' | 'employee',
      String(l.borrower_id),
    );
    const fine = round(
      Math.min(Math.max(0, late - rule.graceDays) * rule.finePerDay, rule.maxFine ?? Infinity),
    );
    return {
      id: String(l.id),
      borrowerKind: String(l.kind),
      borrowerId: String(l.borrower_id),
      name: str(l.name),
      ref: str(l.ref),
      place: str(l.place),
      issuedOn: String(l.issued_on),
      dueOn: String(l.due_on),
      renewed: Number(l.renewed ?? 0),
      daysLate: late,
      fineSoFar: fine,
    };
  }

  // ---- dashboard -----------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext, libraryId?: string) {
    const lib = libraryId && ID.test(libraryId) ? libraryId : null;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const libs = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM library_libraries WHERE status = 'active' ORDER BY name`,
      );
      const figures = await c.query<Row>(
        `WITH x AS (SELECT * FROM library_copies WHERE ($1::bigint IS NULL OR library_id = $1)),
              ol AS (SELECT l.* FROM library_loans l JOIN x ON x.id = l.copy_id WHERE l.returned_on IS NULL)
         SELECT (SELECT count(DISTINCT title_id)::int FROM x WHERE status NOT IN ('withdrawn', 'sold')) AS titles,
                (SELECT count(*)::int FROM x WHERE status NOT IN ('withdrawn', 'sold')) AS copies,
                (SELECT count(*)::int FROM x WHERE status = 'available') AS available,
                (SELECT count(*)::int FROM ol) AS on_loan,
                (SELECT count(*)::int FROM ol WHERE due_on < CURRENT_DATE) AS overdue,
                (SELECT count(*)::int FROM ol WHERE due_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 3) AS due_soon,
                (SELECT count(*)::int FROM x WHERE status = 'lost') AS lost,
                (SELECT count(*)::int FROM x WHERE status = 'damaged') AS damaged,
                (SELECT count(*)::int FROM library_reservations rv WHERE rv.status = 'waiting'
                   AND ($1::bigint IS NULL OR EXISTS (SELECT 1 FROM x WHERE x.title_id = rv.title_id))) AS reserved_waiting,
                (SELECT count(*)::int FROM library_reservations rv JOIN x ON x.id = rv.copy_id WHERE rv.status = 'ready') AS reserved_ready,
                (SELECT count(*)::int FROM library_loans l JOIN x ON x.id = l.copy_id WHERE l.issued_on = CURRENT_DATE) AS issued_today,
                (SELECT count(*)::int FROM library_loans l JOIN x ON x.id = l.copy_id WHERE l.returned_on = CURRENT_DATE) AS returned_today,
                (SELECT COALESCE(sum(l.fine_amount - COALESCE(l.fine_waived, 0)), 0)::float FROM library_loans l JOIN x ON x.id = l.copy_id
                  WHERE l.fine_amount - COALESCE(l.fine_waived, 0) > 0 AND l.fine_paid_on IS NULL) AS fines_unpaid,
                (SELECT count(*)::int FROM x WHERE accessioned_on >= date_trunc('month', CURRENT_DATE)) AS added_this_month`,
        [lib],
      );
      const months = await c.query<Row>(
        `WITH mo AS (SELECT to_char(g, 'YYYY-MM') AS month, g::date AS starts, (g + interval '1 month')::date AS ends
                       FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') g)
         SELECT mo.month,
                (SELECT count(*)::int FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
                  WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.issued_on >= mo.starts AND l.issued_on < mo.ends) AS issued,
                (SELECT count(*)::int FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
                  WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.returned_on >= mo.starts AND l.returned_on < mo.ends) AS returned,
                (SELECT count(*)::int FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
                  WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.returned_on >= mo.starts AND l.returned_on < mo.ends AND l.returned_on > l.due_on) AS late,
                (SELECT count(*)::int FROM library_copies x
                  WHERE ($1::bigint IS NULL OR x.library_id = $1) AND x.accessioned_on >= mo.starts AND x.accessioned_on < mo.ends) AS added
           FROM mo ORDER BY mo.month`,
        [lib],
      );
      const popular = await c.query<Row>(
        `SELECT t.id::text, t.title, t.author, count(*)::int AS loans
           FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
          WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.issued_on >= CURRENT_DATE - interval '6 months'
          GROUP BY t.id ORDER BY 4 DESC, t.title LIMIT 8`,
        [lib],
      );
      const readers = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
        `SELECT l.borrower_kind::text AS kind, l.borrower_id::text AS id, b.name, b.ref, b.place, count(*)::int AS loans
           FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
           ${borrowerLateral('l.borrower_kind::text', 'l.borrower_id')}
          WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.issued_on >= CURRENT_DATE - interval '6 months'
          GROUP BY l.borrower_kind, l.borrower_id, b.name, b.ref, b.place ORDER BY 6 DESC, b.name LIMIT 8`,
        [lib],
      );
      const overdue = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- borrowerLateral is a fixed fragment of the row's own columns; values are bound
        `SELECT x.id::text AS copy_id, x.accession_no, t.title, l.due_on::text AS due_on, CURRENT_DATE - l.due_on AS days,
                l.borrower_kind::text AS kind, l.borrower_id::text AS borrower_id, b.name, b.ref, b.place
           FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
           ${borrowerLateral('l.borrower_kind::text', 'l.borrower_id')}
          WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.returned_on IS NULL AND l.due_on < CURRENT_DATE
          ORDER BY l.due_on LIMIT 10`,
        [lib],
      );
      const byLibrary = await c.query<Row>(
        `SELECT lb.id::text, lb.name,
                count(x.id) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
                count(x.id) FILTER (WHERE x.status = 'available')::int AS available,
                count(x.id) FILTER (WHERE x.status = 'issued')::int AS on_loan,
                (SELECT count(*)::int FROM library_loans l JOIN library_copies y ON y.id = l.copy_id
                  WHERE y.library_id = lb.id AND l.returned_on IS NULL AND l.due_on < CURRENT_DATE) AS overdue
           FROM library_libraries lb LEFT JOIN library_copies x ON x.library_id = lb.id
          WHERE lb.status = 'active' AND ($1::bigint IS NULL OR lb.id = $1)
          GROUP BY lb.id ORDER BY lb.name`,
        [lib],
      );
      const periodicals = await c.query<Row>(
        `SELECT count(*) FILTER (WHERE i.status = 'expected' AND i.expected_on = CURRENT_DATE)::int AS due_today,
                count(*) FILTER (WHERE i.status = 'expected' AND i.expected_on + s.grace_days < CURRENT_DATE)::int AS late,
                count(*) FILTER (WHERE i.status = 'missing')::int AS missing,
                count(DISTINCT s.id) FILTER (WHERE s.status <> 'cancelled' AND s.starts_on <= CURRENT_DATE AND s.ends_on >= CURRENT_DATE)::int AS current
           FROM library_subscriptions s LEFT JOIN library_periodical_issues i ON i.subscription_id = s.id
          WHERE ($1::bigint IS NULL OR s.library_id = $1)`,
        [lib],
      );
      // the "total books in school" table: each library and the total
      const matrix = await c.query<Row>(
        `WITH x AS (SELECT * FROM library_copies),
              per AS (
                SELECT lb.id, lb.name, lb.code,
                       count(DISTINCT x.title_id) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS titles,
                       count(x.id) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
                       count(x.id) FILTER (WHERE x.status = 'available')::int AS available,
                       count(x.id) FILTER (WHERE x.status = 'issued')::int AS on_loan,
                       count(x.id) FILTER (WHERE x.status = 'lost')::int AS lost,
                       count(x.id) FILTER (WHERE x.status = 'damaged')::int AS damaged,
                       count(x.id) FILTER (WHERE x.status IN ('withdrawn', 'sold'))::int AS withdrawn,
                       COALESCE(sum(x.price) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold')), 0)::float AS value,
                       (SELECT count(*)::int FROM library_loans l JOIN library_copies y ON y.id = l.copy_id
                         WHERE y.library_id = lb.id AND l.returned_on IS NULL AND l.due_on < CURRENT_DATE) AS overdue,
                       (SELECT count(*)::int FROM library_reservations rv JOIN library_copies y ON y.id = rv.copy_id
                         WHERE y.library_id = lb.id AND rv.status = 'ready') AS reserved_ready
                  FROM library_libraries lb LEFT JOIN x ON x.library_id = lb.id
                 WHERE lb.status = 'active' GROUP BY lb.id)
         SELECT * FROM per ORDER BY name`,
      );
      const totalTitles = await c.query<{ n: number }>(
        `SELECT count(DISTINCT title_id)::int AS n FROM library_copies WHERE status NOT IN ('withdrawn', 'sold')`,
      );
      const waiting = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM library_reservations WHERE status = 'waiting'`,
      );
      const byStatus = await c.query<{ status: string; n: number }>(
        `SELECT status::text AS status, count(*)::int AS n FROM library_copies
          WHERE ($1::bigint IS NULL OR library_id = $1) GROUP BY 1 ORDER BY 2 DESC`,
        [lib],
      );
      const byMaterial = await c.query<Row>(
        `SELECT COALESCE(m.name, 'Other') AS name, count(*) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
                count(*) FILTER (WHERE x.status = 'issued')::int AS on_loan
           FROM library_copies x JOIN library_titles t ON t.id = x.title_id
           LEFT JOIN library_material_types m ON m.id = t.material_type_id
          WHERE ($1::bigint IS NULL OR x.library_id = $1)
          GROUP BY 1 HAVING count(*) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold')) > 0 ORDER BY 2 DESC LIMIT 10`,
        [lib],
      );
      const bySubject = await c.query<Row>(
        `SELECT COALESCE(s.name::text, 'No subject') AS name, count(*) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
                count(*) FILTER (WHERE x.status = 'issued')::int AS on_loan
           FROM library_copies x JOIN library_titles t ON t.id = x.title_id
           LEFT JOIN library_subjects s ON s.id = t.subject_id
          WHERE ($1::bigint IS NULL OR x.library_id = $1)
          GROUP BY 1 HAVING count(*) FILTER (WHERE x.status NOT IN ('withdrawn', 'sold')) > 0 ORDER BY 2 DESC LIMIT 10`,
        [lib],
      );
      // issues per month of this session and the last (April to March)
      const year = await c.query<Row>(
        `WITH s AS (SELECT make_date(CASE WHEN extract(month FROM CURRENT_DATE) >= 4 THEN extract(year FROM CURRENT_DATE)::int
                                          ELSE extract(year FROM CURRENT_DATE)::int - 1 END, 4, 1) AS starts),
              mo AS (SELECT g::date AS m FROM s, generate_series(s.starts, s.starts + interval '11 months', interval '1 month') g)
         SELECT to_char(mo.m, 'YYYY-MM') AS month,
                (SELECT count(*)::int FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
                  WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.issued_on >= mo.m AND l.issued_on < (mo.m + interval '1 month')::date) AS this_year,
                (SELECT count(*)::int FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
                  WHERE ($1::bigint IS NULL OR x.library_id = $1) AND l.issued_on >= (mo.m - interval '1 year')::date
                    AND l.issued_on < (mo.m - interval '1 year' + interval '1 month')::date) AS last_year,
                mo.m <= CURRENT_DATE AS so_far
           FROM mo ORDER BY mo.m`,
        [lib],
      );
      // each class: pupils on roll and how many borrowed this session
      const byClass = await c.query<Row>(
        `WITH s AS (SELECT make_date(CASE WHEN extract(month FROM CURRENT_DATE) >= 4 THEN extract(year FROM CURRENT_DATE)::int
                                          ELSE extract(year FROM CURRENT_DATE)::int - 1 END, 4, 1) AS starts)
         SELECT k.id::text, k.name, k.display_order,
                count(DISTINCT e.student_id)::int AS pupils,
                count(DISTINCT e.student_id) FILTER (WHERE EXISTS (
                  SELECT 1 FROM library_loans l JOIN library_copies x ON x.id = l.copy_id, s
                   WHERE l.borrower_kind = 'student' AND l.borrower_id = e.student_id AND l.issued_on >= s.starts
                     AND ($1::bigint IS NULL OR x.library_id = $1)))::int AS borrowed
           FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE e.status = 'active' AND e.academic_year_id = COALESCE(app.current_academic_year_id(),
                (SELECT id FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1))
          GROUP BY k.id ORDER BY k.display_order, k.name`,
        [lib],
      );
      const f = figures.rows[0]!;
      const p = periodicals.rows[0] ?? {};
      return {
        libraries: libs.rows,
        libraryId: lib,
        figures: {
          titles: Number(f.titles),
          copies: Number(f.copies),
          available: Number(f.available),
          onLoan: Number(f.on_loan),
          overdue: Number(f.overdue),
          dueSoon: Number(f.due_soon),
          lost: Number(f.lost),
          damaged: Number(f.damaged),
          reservedWaiting: Number(f.reserved_waiting),
          reservedReady: Number(f.reserved_ready),
          issuedToday: Number(f.issued_today),
          returnedToday: Number(f.returned_today),
          finesUnpaid: Number(f.fines_unpaid),
          addedThisMonth: Number(f.added_this_month),
          periodicalsDueToday: Number(p.due_today ?? 0),
          periodicalsLate: Number(p.late ?? 0),
          periodicalsMissing: Number(p.missing ?? 0),
          subscriptions: Number(p.current ?? 0),
        },
        months: months.rows.map((m) => ({
          month: String(m.month),
          issued: Number(m.issued),
          returned: Number(m.returned),
          late: Number(m.late),
          added: Number(m.added),
        })),
        popular: popular.rows.map((x) => ({
          id: String(x.id),
          title: String(x.title),
          author: str(x.author),
          loans: Number(x.loans),
        })),
        readers: readers.rows.map((x) => ({
          kind: String(x.kind),
          id: String(x.id),
          name: str(x.name),
          ref: str(x.ref),
          place: str(x.place),
          loans: Number(x.loans),
        })),
        overdue: overdue.rows.map((x) => ({
          copyId: String(x.copy_id),
          accessionNo: String(x.accession_no),
          title: String(x.title),
          dueOn: String(x.due_on),
          days: Number(x.days),
          kind: String(x.kind),
          borrowerId: String(x.borrower_id),
          name: str(x.name),
          ref: str(x.ref),
          place: str(x.place),
        })),
        matrix: {
          libraries: matrix.rows.map((x) => ({
            id: String(x.id),
            name: String(x.name),
            titles: Number(x.titles),
            copies: Number(x.copies),
            available: Number(x.available),
            onLoan: Number(x.on_loan),
            overdue: Number(x.overdue),
            lost: Number(x.lost),
            damaged: Number(x.damaged),
            withdrawn: Number(x.withdrawn),
            reservedReady: Number(x.reserved_ready),
            value: Number(x.value),
          })),
          titles: totalTitles.rows[0]?.n ?? 0,
          reservedWaiting: waiting.rows[0]?.n ?? 0,
        },
        byStatus: byStatus.rows.map((x) => ({ status: x.status, copies: Number(x.n) })),
        byMaterial: byMaterial.rows.map((x) => ({
          name: String(x.name),
          copies: Number(x.copies),
          onLoan: Number(x.on_loan),
        })),
        bySubject: bySubject.rows.map((x) => ({
          name: String(x.name),
          copies: Number(x.copies),
          onLoan: Number(x.on_loan),
        })),
        year: year.rows.map((x) => ({
          month: String(x.month),
          thisYear: Number(x.this_year),
          lastYear: Number(x.last_year),
          soFar: Boolean(x.so_far),
        })),
        byClass: byClass.rows
          .map((x) => ({
            id: String(x.id),
            name: String(x.name),
            pupils: Number(x.pupils),
            borrowed: Number(x.borrowed),
          }))
          .filter((x) => x.pupils > 0),
        byLibrary: byLibrary.rows.map((x) => ({
          id: String(x.id),
          name: String(x.name),
          copies: Number(x.copies),
          available: Number(x.available),
          onLoan: Number(x.on_loan),
          overdue: Number(x.overdue),
        })),
      };
    });
  }
}
