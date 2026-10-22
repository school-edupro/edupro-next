import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { likeEscape } from './library-borrower-sql';
import { withEveryLibrary } from './library-staff.service';

type Kind = 'student' | 'employee';
/** A copy kept for someone: who and until when (the desk says so). */
export interface Hold {
  reservationId: string;
  borrowerKind: Kind;
  borrowerId: string;
  borrower: string;
  ref: string;
  until: string;
}
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const WHO = `COALESCE(st.display_name, e.display_name) AS borrower, COALESCE(st.admission_no, e.employee_code) AS ref
  FROM library_reservations r
  LEFT JOIN students st ON r.borrower_kind = 'student' AND st.id = r.borrower_id
  LEFT JOIN employees e ON r.borrower_kind = 'employee' AND e.id = r.borrower_id`;
/**
 * The reservations a librarian sees (r, and x its kept copy): those of titles with a copy in their
 * libraries, not kept at another library. The copies' row limit does the work; untied staff see all.
 */
const MINE = `EXISTS (SELECT 1 FROM library_copies z WHERE z.title_id = r.title_id)
  AND (r.copy_id IS NULL OR x.id IS NOT NULL)`;

/**
 * Books reserved (docs/design/36-library.md, "Library round 3", part 4): a pupil or a staff member
 * reserves a title when every copy is out (setting library.reservations_per_borrower at a time); a copy
 * that comes back is kept for the first in line for library.hold_days days, then lapses to the next;
 * issuing the title to them collects it; they or the library may cancel. Told in the portal only.
 */
@Injectable()
export class LibraryReservationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async setting(c: PoolClient, key: string, fallback: number) {
    const r = await c.query<{ v: string | null }>(`SELECT app.setting($1) #>> '{}' AS v`, [key]);
    const n = Number(r.rows[0]?.v);
    return r.rows[0]?.v !== null && r.rows[0]?.v !== undefined && Number.isFinite(n) ? n : fallback;
  }

  /** The copy kept for someone, if it is. */
  async heldIn(c: PoolClient, copyId: string): Promise<Hold | null> {
    const r = await c.query<Record<string, string>>(
      // eslint-disable-next-line no-restricted-syntax -- WHO is a fixed fragment; values are bound
      `SELECT r.id::text, r.borrower_kind::text AS kind, r.borrower_id::text AS bid, r.ready_until::text AS until, ${WHO}
        WHERE r.copy_id = $1 AND r.status = 'ready'`,
      [copyId],
    );
    const x = r.rows[0];
    return x
      ? {
          reservationId: x.id!,
          borrowerKind: x.kind as Kind,
          borrowerId: x.bid!,
          borrower: x.borrower ?? '',
          ref: x.ref ?? '',
          until: x.until!,
        }
      : null;
  }

  /**
   * A copy on the shelf offered to the first in line for its title: kept for them for the hold days.
   * Nothing when it is kept already, or nobody waits. The copy may be of a library not mine (taken back
   * here, or a hold lapsed while I look), so the limit to my libraries is off for it.
   */
  offerIn(c: PoolClient, copyId: string): Promise<Hold | null> {
    return withEveryLibrary(c, () => this.offerHere(c, copyId));
  }

  private async offerHere(c: PoolClient, copyId: string): Promise<Hold | null> {
    const copy = await c.query<{ title_id: string; status: string }>(
      `SELECT title_id::text, status::text FROM library_copies WHERE id = $1`,
      [copyId],
    );
    if (copy.rows[0]?.status !== 'available') return null;
    if (await this.heldIn(c, copyId)) return null;
    const days = await this.setting(c, 'library.hold_days', 3);
    const next = await c.query<{ id: string }>(
      `UPDATE library_reservations SET status = 'ready', copy_id = $2, ready_at = now(),
              ready_until = CURRENT_DATE + $3::int
        WHERE id = (SELECT id FROM library_reservations WHERE title_id = $1 AND status = 'waiting'
                     ORDER BY placed_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id::text`,
      [copy.rows[0].title_id, copyId, days],
    );
    return next.rows[0] ? this.heldIn(c, copyId) : null;
  }

  /** Holds past their day lapse; each copy goes to the next in line (or back to the shelf). */
  async tidyIn(c: PoolClient) {
    const lapsed = await c.query<{ copy_id: string }>(
      `UPDATE library_reservations SET status = 'lapsed', ended_at = now(),
              end_reason = 'Not collected by ' || to_char(ready_until, 'DD-MM-YYYY')
        WHERE status = 'ready' AND ready_until < CURRENT_DATE
        RETURNING copy_id::text`,
    );
    for (const x of lapsed.rows) if (x.copy_id) await this.offerIn(c, x.copy_id);
  }

  /** Before an issue: a copy kept for someone else is not issued. */
  async beforeIssueIn(c: PoolClient, copyId: string, kind: Kind, borrowerId: string) {
    await this.tidyIn(c);
    const held = await this.heldIn(c, copyId);
    if (held && !(held.borrowerKind === kind && held.borrowerId === borrowerId))
      throw new DomainError(
        'library.copy_held',
        `Kept for ${held.borrower} (${held.ref}), who reserved it, until ${dmy(held.until)}`,
        { status: 409 },
      );
  }

  /** After an issue: the borrower's reservation of the title is collected; another copy kept for it is let go. */
  async collectIn(
    c: PoolClient,
    titleId: string,
    copyId: string,
    kind: Kind,
    borrowerId: string,
    loanId: string,
  ) {
    const r = await c.query<{ copy_id: string | null }>(
      `UPDATE library_reservations SET status = 'collected', loan_id = $4, ended_at = now(), end_reason = 'Issued'
        WHERE title_id = $1 AND borrower_kind = $2::library_borrower AND borrower_id = $3 AND status IN ('waiting', 'ready')
        RETURNING copy_id::text`,
      [titleId, kind, borrowerId, loanId],
    );
    const other = r.rows[0]?.copy_id;
    if (other && other !== copyId) await this.offerIn(c, other);
  }

  /** How many wait for a title (a renewal is refused while anyone does). */
  async waitingIn(c: PoolClient, titleId: string) {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM library_reservations WHERE title_id = $1 AND status = 'waiting'`,
      [titleId],
    );
    return Number(r.rows[0]!.n);
  }

  /** A reservation placed for a borrower (the portal checks who may). */
  async placeIn(
    c: PoolClient,
    ctx: RequestContext,
    kind: Kind,
    borrowerId: string,
    titleId: string,
  ) {
    await this.tidyIn(c);
    const limit = await this.setting(c, 'library.reservations_per_borrower', 2);
    if (limit <= 0)
      throw new DomainError('library.reservations_off', 'The library takes no reservations', {
        status: 409,
      });
    const t = await c.query<{
      title: string;
      reference: boolean;
      in_stock: string;
      free: string;
    }>(
      `SELECT t.title, (t.is_reference OR NOT COALESCE(m.issuable, true)) AS reference,
              count(x.id) FILTER (WHERE x.status IN ('available', 'issued', 'damaged'))::text AS in_stock,
              count(x.id) FILTER (WHERE x.status = 'available' AND NOT EXISTS (
                SELECT 1 FROM library_reservations h WHERE h.copy_id = x.id AND h.status = 'ready'))::text AS free
         FROM library_titles t LEFT JOIN library_material_types m ON m.id = t.material_type_id
         LEFT JOIN library_copies x ON x.title_id = t.id
        WHERE t.id = $1 AND t.status = 'active' GROUP BY t.id, m.issuable`,
      [titleId],
    );
    const x = t.rows[0];
    if (!x) throw new DomainError('not-found', 'Book not found', { status: 404 });
    if (x.reference)
      throw new DomainError('library.reference_only', 'Reference only: read in the library', {
        status: 409,
      });
    if (Number(x.in_stock) === 0)
      throw new DomainError(
        'library.not_in_stock',
        'The library has no copy of this book to lend',
        {
          status: 409,
        },
      );
    if (Number(x.free) > 0)
      throw new DomainError(
        'library.on_shelf',
        'A copy is on the shelf: borrow it at the library, no need to reserve',
        { status: 409 },
      );
    const holding = await c.query(
      `SELECT 1 FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
        WHERE x.title_id = $1 AND l.borrower_kind = $2::library_borrower AND l.borrower_id = $3 AND l.returned_on IS NULL`,
      [titleId, kind, borrowerId],
    );
    if (holding.rowCount)
      throw new DomainError('library.holding', 'This book is with them already', { status: 409 });
    const open = await c.query<{ title_id: string }>(
      `SELECT title_id::text FROM library_reservations
        WHERE borrower_kind = $1::library_borrower AND borrower_id = $2 AND status IN ('waiting', 'ready')`,
      [kind, borrowerId],
    );
    if (open.rows.some((r) => r.title_id === titleId))
      throw new DomainError('library.reserved_already', 'Reserved already', { status: 409 });
    if (open.rows.length >= limit)
      throw new DomainError(
        'library.reservation_limit',
        `${String(limit)} book${limit === 1 ? '' : 's'} may be reserved at a time: cancel one first`,
        { status: 409 },
      );
    const r = await c.query<{ id: string }>(
      `INSERT INTO library_reservations (school_id, title_id, borrower_kind, borrower_id, placed_by)
       VALUES (app.current_school_id(), $1, $2::library_borrower, $3, app.current_user_id()) RETURNING id::text`,
      [titleId, kind, borrowerId],
    );
    await this.audit.stage(ctx, c, {
      action: 'library.reservation.place',
      entityType: 'library_reservations',
      entityId: r.rows[0]!.id,
      after: { titleId, kind, borrowerId, title: x.title },
    });
    return r.rows[0]!.id;
  }

  /** A reservation cancelled (by its borrower or the library); a copy kept for it goes to the next. */
  async cancelIn(c: PoolClient, ctx: RequestContext, id: string, reason: string) {
    const r = await c.query<{ copy_id: string | null }>(
      `UPDATE library_reservations SET status = 'cancelled', ended_at = now(), end_reason = $2, ended_by_name = $3
        WHERE id = $1 AND status IN ('waiting', 'ready') RETURNING copy_id::text`,
      [id, reason, ctx.user.displayName],
    );
    if (!r.rowCount)
      throw new DomainError('library.reservation_closed', 'This reservation is not open', {
        status: 409,
      });
    if (r.rows[0]!.copy_id) await this.offerIn(c, r.rows[0]!.copy_id);
    await this.audit.stage(ctx, c, {
      action: 'library.reservation.cancel',
      entityType: 'library_reservations',
      entityId: id,
      after: { reason },
    });
  }

  /** The reservations of borrowers (their portal), open first, with each one's place in the queue. */
  async ofBorrowersIn(c: PoolClient, people: Array<{ kind: Kind; id: string }>) {
    if (!people.length) return [];
    const r = await c.query<Record<string, unknown>>(
      `SELECT r.id::text, r.borrower_kind::text AS kind, r.borrower_id::text AS bid, r.status, r.placed_at::date::text AS placed_on,
              r.ready_until::text AS ready_until, r.end_reason, r.ended_at::date::text AS ended_on, t.id::text AS title_id,
              t.title, t.author, x.accession_no, l.name AS library,
              CASE WHEN r.status = 'waiting' THEN (SELECT count(*) FROM library_reservations q
                    WHERE q.title_id = r.title_id AND q.status = 'waiting'
                      AND (q.placed_at, q.id) <= (r.placed_at, r.id))::int END AS place
         FROM library_reservations r JOIN library_titles t ON t.id = r.title_id
         LEFT JOIN library_copies x ON x.id = r.copy_id LEFT JOIN library_libraries l ON l.id = x.library_id
         JOIN unnest($1::text[], $2::bigint[]) AS p(kind, id) ON p.kind = r.borrower_kind::text AND p.id = r.borrower_id
        WHERE r.status IN ('waiting', 'ready') OR r.ended_at > now() - interval '60 days'
        ORDER BY (r.status IN ('waiting', 'ready')) DESC, r.placed_at DESC LIMIT 50`,
      [people.map((p) => p.kind), people.map((p) => p.id)],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      borrowerKind: String(x.kind) as Kind,
      borrowerId: String(x.bid),
      status: String(x.status),
      placedOn: String(x.placed_on),
      readyUntil: x.ready_until as string | null,
      endReason: x.end_reason as string | null,
      endedOn: x.ended_on as string | null,
      titleId: String(x.title_id),
      title: String(x.title),
      author: x.author as string | null,
      accessionNo: x.accession_no as string | null,
      library: x.library as string | null,
      place: x.place === null || x.place === undefined ? null : Number(x.place),
    }));
  }

  /** The library's list: open reservations (or all), by title or borrower. */
  async list(ctx: RequestContext, q: { status?: string; q?: string }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.tidyIn(c);
      const status = ['waiting', 'ready', 'open', 'ended'].includes(q.status ?? '')
        ? q.status!
        : 'open';
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- WHO is a fixed fragment; values are bound
        `SELECT r.id::text, r.status, r.borrower_kind::text AS kind, r.placed_at::date::text AS placed_on,
                r.ready_until::text AS ready_until, r.end_reason, r.ended_at::date::text AS ended_on, r.ended_by_name,
                t.id::text AS title_id, t.title, t.author, x.accession_no, lib.name AS library,
                CASE WHEN r.status = 'waiting' THEN (SELECT count(*) FROM library_reservations q
                      WHERE q.title_id = r.title_id AND q.status = 'waiting'
                        AND (q.placed_at, q.id) <= (r.placed_at, r.id))::int END AS place,
                ${WHO}
           JOIN library_titles t ON t.id = r.title_id
           LEFT JOIN library_copies x ON x.id = r.copy_id LEFT JOIN library_libraries lib ON lib.id = x.library_id
          WHERE CASE $1 WHEN 'open' THEN r.status IN ('waiting', 'ready') WHEN 'ended' THEN r.status NOT IN ('waiting', 'ready')
                        ELSE r.status = $1 END
            AND ${MINE}
            AND ($2::text IS NULL OR t.title ILIKE $2 OR COALESCE(st.display_name, e.display_name) ILIKE $2
                 OR COALESCE(st.admission_no, e.employee_code) ILIKE $2)
          ORDER BY (r.status = 'ready') DESC, r.ready_until NULLS LAST, r.placed_at LIMIT 500`,
        [status, q.q ? likeEscape(q.q) : null],
      );
      const counts = await c.query<{ waiting: string; ready: string }>(
        // eslint-disable-next-line no-restricted-syntax -- MINE is a fixed fragment
        `SELECT count(*) FILTER (WHERE r.status = 'waiting')::text AS waiting,
                count(*) FILTER (WHERE r.status = 'ready')::text AS ready
           FROM library_reservations r LEFT JOIN library_copies x ON x.id = r.copy_id
          WHERE r.status IN ('waiting', 'ready') AND ${MINE}`,
      );
      return {
        status,
        counts: { waiting: Number(counts.rows[0]!.waiting), ready: Number(counts.rows[0]!.ready) },
        rows: r.rows.map((x) => ({
          id: String(x.id),
          status: String(x.status),
          borrowerKind: String(x.kind),
          borrower: String(x.borrower ?? ''),
          ref: String(x.ref ?? ''),
          placedOn: String(x.placed_on),
          readyUntil: x.ready_until as string | null,
          endReason: x.end_reason as string | null,
          endedOn: x.ended_on as string | null,
          endedBy: x.ended_by_name as string | null,
          titleId: String(x.title_id),
          title: String(x.title),
          author: x.author as string | null,
          accessionNo: x.accession_no as string | null,
          library: x.library as string | null,
          place: x.place === null || x.place === undefined ? null : Number(x.place),
        })),
      };
    });
  }

  /** The library cancels one (with the reason). */
  async cancelByLibrary(ctx: RequestContext, id: string, reason: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Reservation not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const seen = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- MINE is a fixed fragment
        `SELECT 1 FROM library_reservations r LEFT JOIN library_copies x ON x.id = r.copy_id WHERE r.id = $1 AND ${MINE}`,
        [id],
      );
      if (!seen.rowCount)
        throw new DomainError('not-found', 'Reservation not found', { status: 404 });
      await this.cancelIn(c, ctx, id, reason);
      return { id, status: 'cancelled' };
    });
  }
}
