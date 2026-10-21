import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { AccessionApplyDto, AccessionChangeDto } from './library-books.dto';

/** At most this many copies in one correction. */
const MOST = 500;
const VALID = /^[A-Z0-9/-]{1,30}$/;
/** An accession number split into its prefix and its number (B00125 → B, 125, 5 digits). */
const split = (s: string) => {
  const m = /^(.*?)(\d+)$/.exec(s);
  return m ? { prefix: m[1]!, n: Number(m[2]!), digits: m[2]!.length } : null;
};
const bad = (message: string) => new DomainError('validation-failed', message, { status: 400 });

export interface AccessionPlanRow {
  copyId: string;
  titleId: string;
  title: string;
  status: string;
  old: string;
  new: string;
  problem: string | null;
}

/**
 * Correcting a wrong accession number (docs/design/36-library.md, part 2): one copy, or a range typed
 * wrong (B00101–B00150 that should be B00201–B00250) moved in one go, the same order kept. A preview
 * first: each copy's old and new number, and why a number cannot be given (another copy has it, a copy
 * had it before, two copies would get it). Applied, the old numbers are retired (0214): never given to
 * another copy, and they still find the copy at the desk, in a stock check and in a search.
 */
@Injectable()
export class LibraryAccessionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The copies a correction moves and the number each gets, with what stands in the way. */
  private async plan(
    c: PoolClient,
    dto: AccessionChangeDto,
    lock = false,
  ): Promise<AccessionPlanRow[]> {
    type Hit = {
      id: string;
      title_id: string;
      title: string;
      status: string;
      accession_no: string;
    };
    const cols = `x.id::text, x.title_id::text, t.title, x.status::text, x.accession_no`;
    const forUpdate = lock ? ' FOR UPDATE OF x' : '';
    let pairs: Array<{ hit: Hit; to: string }>;
    if (!dto.to || dto.to === dto.from) {
      // one copy: the number given becomes the new one as typed
      const r = await c.query<Hit>(
        // eslint-disable-next-line no-restricted-syntax -- fixed column list and lock clause; values are bound
        `SELECT ${cols} FROM library_copies x JOIN library_titles t ON t.id = x.title_id
          WHERE x.accession_no = $1${forUpdate}`,
        [dto.from],
      );
      if (!r.rows[0]) {
        const now = await c.query<{ n: string }>(
          `SELECT x.accession_no AS n FROM library_copies x WHERE x.id = app.library_copy_by_number($1)`,
          [dto.from],
        );
        throw new DomainError(
          'not-found',
          now.rows[0]
            ? `${dto.from} is no longer a copy's number: it was changed to ${now.rows[0].n}`
            : `No copy has the accession number ${dto.from}`,
          { status: 404 },
        );
      }
      pairs = [{ hit: r.rows[0], to: dto.start }];
    } else {
      const a = split(dto.from);
      const b = split(dto.to);
      const s = split(dto.start);
      if (!a || !b)
        throw bad('A range runs between two numbers that end in digits, e.g. B00101 to B00150');
      if (a.prefix !== b.prefix)
        throw bad(`${dto.from} and ${dto.to} start differently: one range has one prefix`);
      if (b.n < a.n) throw bad(`${dto.to} comes before ${dto.from}`);
      if (b.n - a.n + 1 > MOST) throw bad(`At most ${String(MOST)} numbers in one correction`);
      if (!s) throw bad(`The new numbers count on from ${dto.start}: it must end in digits`);
      const r = await c.query<Hit & { k: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed column list and lock clause; values are bound
        `SELECT ${cols}, substring(x.accession_no FROM '[0-9]+$') AS k
           FROM library_copies x JOIN library_titles t ON t.id = x.title_id
          WHERE x.accession_no ~ '[0-9]+$'
            AND regexp_replace(x.accession_no, '[0-9]+$', '') = $1
            AND substring(x.accession_no FROM '[0-9]+$')::numeric BETWEEN $2 AND $3
          ORDER BY substring(x.accession_no FROM '[0-9]+$')::numeric, x.accession_no${forUpdate}`,
        [a.prefix, a.n, b.n],
      );
      if (!r.rows.length) throw bad(`No copy is numbered from ${dto.from} to ${dto.to}`);
      pairs = r.rows.map((hit) => ({
        hit,
        to: `${s.prefix}${String(s.n + Number(hit.k) - a.n).padStart(s.digits, '0')}`,
      }));
    }
    const moving = new Map(pairs.map((p) => [p.hit.accession_no.toUpperCase(), p.hit.id]));
    const wanted = pairs.map((p) => p.to.toUpperCase());
    // who has each new number now, and who had it before
    const holders = new Map(
      (
        await c.query<{ n: string; id: string; title: string }>(
          `SELECT upper(x.accession_no) AS n, x.id::text, t.title FROM library_copies x
             JOIN library_titles t ON t.id = x.title_id WHERE upper(x.accession_no) = ANY($1::text[])`,
          [wanted],
        )
      ).rows.map((x) => [x.n, x]),
    );
    const retired = new Map(
      (
        await c.query<{ n: string; copy_id: string }>(
          `SELECT upper(old_no) AS n, copy_id::text FROM library_accession_changes WHERE upper(old_no) = ANY($1::text[])`,
          [wanted],
        )
      ).rows.map((x) => [x.n, x.copy_id]),
    );
    const count = new Map<string, number>();
    for (const w of wanted) count.set(w, (count.get(w) ?? 0) + 1);
    return pairs.map(({ hit, to }) => {
      const key = to.toUpperCase();
      const holder = holders.get(key);
      const had = retired.get(key);
      let problem: string | null = null;
      if (!VALID.test(to))
        problem = `${to} is not an accession number (letters and digits, 30 at most)`;
      else if (key === hit.accession_no.toUpperCase()) problem = 'Already this number';
      else if ((count.get(key) ?? 0) > 1) problem = `Two copies would get ${to}`;
      else if (holder && moving.has(key))
        problem = `${to} is another copy's number in this correction: an old number is not given out again`;
      else if (holder) problem = `${to} is the number of a copy of ${holder.title}`;
      else if (had && had !== hit.id) problem = `${to} was used before and is retired`;
      return {
        copyId: hit.id,
        titleId: hit.title_id,
        title: hit.title,
        status: hit.status,
        old: hit.accession_no,
        new: to,
        problem,
      };
    });
  }

  async preview(ctx: RequestContext, dto: AccessionChangeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await this.plan(c, dto);
      return { rows, copies: rows.length, problems: rows.filter((r) => r.problem).length };
    });
  }

  /** Applied when nothing stands in the way; the old numbers retired, each change in the copy's history. */
  async apply(ctx: RequestContext, dto: AccessionApplyDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await this.plan(c, dto, true);
      const blocked = rows.filter((r) => r.problem);
      if (blocked.length)
        throw new DomainError(
          'library.accession_blocked',
          `Nothing was changed: ${blocked
            .slice(0, 5)
            .map((r) => `${r.old}: ${r.problem!}`)
            .join('; ')}${blocked.length > 5 ? ` and ${String(blocked.length - 5)} more` : ''}`,
          { status: 409 },
        );
      for (const r of rows) {
        await c.query(
          `UPDATE library_copies SET accession_no = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [r.copyId, r.new],
        );
        await c.query(
          `INSERT INTO library_accession_changes (school_id, copy_id, old_no, new_no, reason, changed_by, changed_by_name)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), $5)`,
          [r.copyId, r.old, r.new, dto.reason, ctx.user.displayName],
        );
        await c.query(
          `INSERT INTO library_copy_events (school_id, copy_id, what, on_date, reason, by_user, by_name)
           VALUES (app.current_school_id(), $1, 'renumbered', CURRENT_DATE, $2, app.current_user_id(), $3)`,
          [r.copyId, `From ${r.old} to ${r.new}: ${dto.reason}`, ctx.user.displayName],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'library.accession.change',
        entityType: 'library_copies',
        entityId: rows[0]!.copyId,
        after: {
          reason: dto.reason,
          changes: rows.map((r) => ({ copy: r.copyId, from: r.old, to: r.new })),
        },
      });
      return { changed: rows.length, numbers: rows.map((r) => r.new) };
    });
  }

  /** The latest corrections, newest first. */
  async changes(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        old_no: string;
        new_no: string;
        now_no: string;
        title_id: string;
        title: string;
        reason: string;
        changed_by_name: string | null;
        changed_at: Date;
      }>(
        `SELECT h.old_no, h.new_no, x.accession_no AS now_no, t.id::text AS title_id, t.title, h.reason,
                h.changed_by_name, h.changed_at
           FROM library_accession_changes h
           JOIN library_copies x ON x.id = h.copy_id JOIN library_titles t ON t.id = x.title_id
          ORDER BY h.changed_at DESC, h.id DESC LIMIT 100`,
      );
      return r.rows.map((x) => ({
        old: x.old_no,
        new: x.new_no,
        now: x.now_no,
        titleId: x.title_id,
        title: x.title,
        reason: x.reason,
        by: x.changed_by_name,
        at: x.changed_at.toISOString(),
      }));
    });
  }
}
