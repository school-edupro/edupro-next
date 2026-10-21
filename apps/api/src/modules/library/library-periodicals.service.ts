import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  CancelSubscriptionDto,
  DueIssuesDto,
  MissingIssueDto,
  ReceiveIssueDto,
  ReceiveManyDto,
  SpecialIssueDto,
  SubscriptionDto,
  SubscriptionListDto,
} from './library-books.dto';
import { LIBRARY } from './library.dto';

const ID = /^\d{1,18}$/;
/** What a subscription is now, from its dates and status (SQL, alias `s`). */
const STATE = `CASE WHEN s.status = 'cancelled' THEN 'cancelled'
                    WHEN s.starts_on > CURRENT_DATE THEN 'upcoming'
                    WHEN s.ends_on < CURRENT_DATE THEN 'ended'
                    WHEN s.ends_on <= CURRENT_DATE + 30 THEN 'ending'
                    ELSE 'current' END`;
/** An issue late: still expected after its grace days (SQL, aliases `i` and `s`). */
const LATE = `(i.status = 'expected' AND i.expected_on + s.grace_days < CURRENT_DATE)`;

/**
 * Periodical subscriptions (docs/design/36-library.md, part 6): a periodical taken in a library for a
 * period, its issues expected from the frequency, received or marked missing, late after the grace days;
 * the issues to receive across subscriptions; renewal, cancellation, a special issue; the late and
 * missing issues as a list to claim from the vendor.
 */
@Injectable()
export class LibraryPeriodicalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private can(ctx: RequestContext) {
    return ctx.permissions?.has(LIBRARY.manage) ?? false;
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.library_seed(app.current_school_id())`);
      const periodicals = await c.query<Record<string, unknown>>(
        `SELECT p.id::text, p.name::text, p.kind, p.frequency, p.vendor_id::text AS "vendorId", v.name AS vendor
           FROM library_periodicals p LEFT JOIN library_vendors v ON v.id = p.vendor_id
          WHERE p.status = 'active' ORDER BY p.name`,
      );
      const libraries = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM library_libraries WHERE status = 'active' ORDER BY code`,
      );
      const vendors = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM library_vendors WHERE status = 'active' ORDER BY name`,
      );
      return {
        periodicals: periodicals.rows,
        libraries: libraries.rows,
        vendors: vendors.rows,
        can: { manage: this.can(ctx) },
      };
    });
  }

  /** The subscriptions with their issues so far, and the figures at the top. */
  async list(ctx: RequestContext, q: SubscriptionListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = [];
      const args: unknown[] = [];
      const arg = (v: unknown) => {
        args.push(v);
        return `$${String(args.length)}`;
      };
      if (q.status === 'current') where.push(`${STATE} IN ('current', 'ending')`);
      else if (q.status !== 'all') where.push(`${STATE} = ${arg(q.status)}`);
      if (q.libraryId) where.push(`s.library_id = ${arg(q.libraryId)}`);
      if (q.q) where.push(`p.name ILIKE ${arg(`%${q.q}%`)}`);
      // eslint-disable-next-line no-restricted-syntax -- fixed conditions chosen above; values are bound
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments chosen above; values are bound
        `SELECT s.id::text, p.name::text AS periodical, p.kind, s.frequency, l.name AS library, v.name AS vendor,
                s.starts_on::text, s.ends_on::text, s.copies, s.cost::text, ${STATE} AS state,
                (SELECT count(*) FROM library_periodical_issues i WHERE i.subscription_id = s.id AND i.expected_on <= CURRENT_DATE)::int AS due,
                (SELECT count(*) FROM library_periodical_issues i WHERE i.subscription_id = s.id AND i.status = 'received')::int AS received,
                (SELECT count(*) FROM library_periodical_issues i WHERE i.subscription_id = s.id AND i.status = 'missing')::int AS missing,
                (SELECT count(*) FROM library_periodical_issues i WHERE i.subscription_id = s.id AND ${LATE})::int AS late,
                (SELECT count(*) FROM library_periodical_issues i WHERE i.subscription_id = s.id)::int AS issues,
                (SELECT min(i.expected_on)::text FROM library_periodical_issues i
                  WHERE i.subscription_id = s.id AND i.status = 'expected' AND i.expected_on >= CURRENT_DATE) AS next_on
           FROM library_subscriptions s
           JOIN library_periodicals p ON p.id = s.periodical_id
           JOIN library_libraries l ON l.id = s.library_id
           LEFT JOIN library_vendors v ON v.id = s.vendor_id
          ${whereSql}
          ORDER BY p.name, s.starts_on DESC LIMIT 500`,
        args,
      );
      const figures = (
        await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- the fixed STATE and LATE fragments; values are bound
          `SELECT (SELECT count(*) FROM library_subscriptions s WHERE ${STATE} IN ('current', 'ending'))::int AS current,
                  (SELECT count(*) FROM library_subscriptions s WHERE ${STATE} = 'ending')::int AS ending,
                  (SELECT count(*) FROM library_periodical_issues i JOIN library_subscriptions s ON s.id = i.subscription_id
                    WHERE s.status = 'active' AND ${LATE})::int AS late,
                  (SELECT count(*) FROM library_periodical_issues i JOIN library_subscriptions s ON s.id = i.subscription_id
                    WHERE s.status = 'active' AND i.status = 'expected' AND i.expected_on <= CURRENT_DATE)::int AS to_receive,
                  (SELECT COALESCE(sum(cost), 0) FROM library_subscriptions s WHERE ${STATE} IN ('current', 'ending'))::text AS cost`,
        )
      ).rows[0]!;
      return {
        figures: {
          current: Number(figures.current),
          ending: Number(figures.ending),
          late: Number(figures.late),
          toReceive: Number(figures.to_receive),
          cost: Number(figures.cost),
        },
        data: r.rows.map((x) => ({
          id: String(x.id),
          periodical: String(x.periodical),
          kind: x.kind as string | null,
          frequency: String(x.frequency),
          library: String(x.library),
          vendor: x.vendor as string | null,
          startsOn: String(x.starts_on),
          endsOn: String(x.ends_on),
          copies: Number(x.copies),
          cost: x.cost as string | null,
          state: String(x.state),
          due: Number(x.due),
          received: Number(x.received),
          missing: Number(x.missing),
          late: Number(x.late),
          issues: Number(x.issues),
          nextOn: x.next_on as string | null,
        })),
        can: { manage: this.can(ctx) },
      };
    });
  }

  /** One subscription and its issues, oldest first. */
  async view(ctx: RequestContext, id: string) {
    if (!ID.test(id)) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- the fixed STATE and LATE fragments; values are bound
          `SELECT s.id::text, s.periodical_id::text, p.name::text AS periodical, p.kind, p.issn, s.frequency,
                  s.library_id::text, l.name AS library, s.vendor_id::text, v.name AS vendor, s.starts_on::text,
                  s.ends_on::text, s.first_issue_on::text, s.copies, s.cost::text, s.order_no, s.bill_no,
                  s.bill_date::text, s.grace_days, s.notes, s.status, s.cancelled_on::text, s.cancel_reason,
                  s.renewed_from::text, ${STATE} AS state,
                  (SELECT x.id::text FROM library_subscriptions x WHERE x.renewed_from = s.id LIMIT 1) AS renewed_by
             FROM library_subscriptions s
             JOIN library_periodicals p ON p.id = s.periodical_id
             JOIN library_libraries l ON l.id = s.library_id
             LEFT JOIN library_vendors v ON v.id = s.vendor_id
            WHERE s.id = $1`,
          [id],
        )
      ).rows[0];
      if (!s) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
      const issues = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- the fixed STATE and LATE fragments; values are bound
        `SELECT i.id::text, i.expected_on::text, i.label, i.special, i.status, i.received_on::text, i.copies_received,
                i.volume, i.issue_no, i.remarks, i.marked_by_name, ${LATE} AS late
           FROM library_periodical_issues i JOIN library_subscriptions s ON s.id = i.subscription_id
          WHERE i.subscription_id = $1 ORDER BY i.expected_on, i.id`,
        [id],
      );
      return {
        id: String(s.id),
        periodicalId: String(s.periodical_id),
        periodical: String(s.periodical),
        kind: s.kind as string | null,
        issn: s.issn as string | null,
        frequency: String(s.frequency),
        libraryId: String(s.library_id),
        library: String(s.library),
        vendorId: s.vendor_id as string | null,
        vendor: s.vendor as string | null,
        startsOn: String(s.starts_on),
        endsOn: String(s.ends_on),
        firstIssueOn: String(s.first_issue_on),
        copies: Number(s.copies),
        cost: s.cost as string | null,
        orderNo: s.order_no as string | null,
        billNo: s.bill_no as string | null,
        billDate: s.bill_date as string | null,
        graceDays: Number(s.grace_days),
        notes: s.notes as string | null,
        status: String(s.status),
        state: String(s.state),
        cancelledOn: s.cancelled_on as string | null,
        cancelReason: s.cancel_reason as string | null,
        renewedFrom: s.renewed_from as string | null,
        renewedBy: s.renewed_by as string | null,
        issues: issues.rows.map((i) => ({
          id: String(i.id),
          expectedOn: String(i.expected_on),
          label: String(i.label),
          special: Boolean(i.special),
          status: String(i.status),
          late: Boolean(i.late),
          receivedOn: i.received_on as string | null,
          copiesReceived: i.copies_received as number | null,
          volume: i.volume as string | null,
          issueNo: i.issue_no as string | null,
          remarks: i.remarks as string | null,
          by: i.marked_by_name as string | null,
        })),
        can: { manage: this.can(ctx) },
      };
    });
  }

  /** The issues expected from the first issue to the end; an issue received or missing stays as it is. */
  private async schedule(c: PoolClient, id: string) {
    await c.query(
      `DELETE FROM library_periodical_issues WHERE subscription_id = $1 AND status = 'expected' AND NOT special`,
      [id],
    );
    await c.query(
      `INSERT INTO library_periodical_issues (school_id, subscription_id, expected_on, label)
       SELECT s.school_id, s.id, d.expected_on, d.label
         FROM library_subscriptions s, app.library_issue_dates(s.first_issue_on, s.ends_on, s.frequency) d
        WHERE s.id = $1
          AND NOT EXISTS (SELECT 1 FROM library_periodical_issues x
                           WHERE x.subscription_id = s.id AND x.expected_on = d.expected_on AND NOT x.special)`,
      [id],
    );
  }

  private async check(c: PoolClient, dto: SubscriptionDto) {
    const p = await c.query<{ frequency: string | null; vendor_id: string | null }>(
      `SELECT frequency, vendor_id::text FROM library_periodicals WHERE id = $1 AND status = 'active'`,
      [dto.periodicalId],
    );
    if (!p.rows[0])
      throw new DomainError('validation-failed', 'Periodical: not found or switched off', {
        status: 400,
      });
    const frequency = dto.frequency ?? p.rows[0].frequency;
    if (!frequency)
      throw new DomainError(
        'validation-failed',
        'Frequency: the periodical has none in Library setup; choose one',
        { status: 400 },
      );
    const lib = await c.query(
      `SELECT 1 FROM library_libraries WHERE id = $1 AND status = 'active'`,
      [dto.libraryId],
    );
    if (!lib.rowCount)
      throw new DomainError('validation-failed', 'Library: not found or switched off', {
        status: 400,
      });
    const vendorId = dto.vendorId ?? p.rows[0].vendor_id;
    if (vendorId) {
      const v = await c.query(`SELECT 1 FROM library_vendors WHERE id = $1 AND status = 'active'`, [
        vendorId,
      ]);
      if (!v.rowCount)
        throw new DomainError('validation-failed', 'Vendor: not found or switched off', {
          status: 400,
        });
    }
    if (dto.endsOn < dto.startsOn)
      throw new DomainError('validation-failed', 'The subscription ends before it starts', {
        status: 400,
      });
    const days = (Date.parse(dto.endsOn) - Date.parse(dto.startsOn)) / 86_400_000;
    if (days > 1830)
      throw new DomainError('validation-failed', 'A subscription runs at most five years', {
        status: 400,
      });
    const first = dto.firstIssueOn ?? dto.startsOn;
    if (first < dto.startsOn || first > dto.endsOn)
      throw new DomainError('validation-failed', 'The first issue falls within the subscription', {
        status: 400,
      });
    return { frequency, vendorId, first };
  }

  async create(ctx: RequestContext, dto: SubscriptionDto, renewedFrom?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.check(c, dto);
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_subscriptions (school_id, periodical_id, library_id, vendor_id, frequency, starts_on, ends_on,
                                            first_issue_on, copies, cost, order_no, bill_no, bill_date, grace_days, notes,
                                            renewed_from, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.periodicalId,
          dto.libraryId,
          x.vendorId,
          x.frequency,
          dto.startsOn,
          dto.endsOn,
          x.first,
          dto.copies,
          dto.cost ?? null,
          dto.orderNo ?? null,
          dto.billNo ?? null,
          dto.billDate ?? null,
          dto.graceDays,
          dto.notes ?? null,
          renewedFrom ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await this.schedule(c, id);
      await this.audit.stage(ctx, c, {
        action: renewedFrom ? 'library.subscription.renew' : 'library.subscription.create',
        entityType: 'library_subscriptions',
        entityId: id,
        after: { ...dto, renewedFrom },
      });
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM library_periodical_issues WHERE subscription_id = $1`,
        [id],
      );
      return { id, issues: n.rows[0]!.n };
    });
  }

  /** A subscription changed: its expected issues follow (the received and missing stay). */
  async update(ctx: RequestContext, id: string, dto: SubscriptionDto) {
    if (!ID.test(id)) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await c.query<{ status: string }>(
        `SELECT status FROM library_subscriptions WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur.rows[0])
        throw new DomainError('not-found', 'Subscription not found', { status: 404 });
      if (cur.rows[0].status === 'cancelled')
        throw new DomainError(
          'library.subscription_cancelled',
          'A cancelled subscription is not changed',
          {
            status: 409,
          },
        );
      const x = await this.check(c, dto);
      const outside = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM library_periodical_issues
          WHERE subscription_id = $1 AND status <> 'expected' AND (expected_on < $2 OR expected_on > $3)`,
        [id, dto.startsOn, dto.endsOn],
      );
      if (outside.rows[0]!.n)
        throw new DomainError(
          'validation-failed',
          'Issues received or marked missing fall outside the new dates',
          { status: 400 },
        );
      await c.query(
        `UPDATE library_subscriptions SET periodical_id = $2, library_id = $3, vendor_id = $4, frequency = $5, starts_on = $6,
                ends_on = $7, first_issue_on = $8, copies = $9, cost = $10, order_no = $11, bill_no = $12, bill_date = $13,
                grace_days = $14, notes = $15, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          dto.periodicalId,
          dto.libraryId,
          x.vendorId,
          x.frequency,
          dto.startsOn,
          dto.endsOn,
          x.first,
          dto.copies,
          dto.cost ?? null,
          dto.orderNo ?? null,
          dto.billNo ?? null,
          dto.billDate ?? null,
          dto.graceDays,
          dto.notes ?? null,
        ],
      );
      // special issues outside the dates go
      await c.query(
        `DELETE FROM library_periodical_issues
          WHERE subscription_id = $1 AND status = 'expected' AND special AND (expected_on < $2 OR expected_on > $3)`,
        [id, dto.startsOn, dto.endsOn],
      );
      await this.schedule(c, id);
      await this.audit.stage(ctx, c, {
        action: 'library.subscription.update',
        entityType: 'library_subscriptions',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  /** The next period, as long as this one, from the day after it ends; the same details. */
  async renew(ctx: RequestContext, id: string) {
    const s = await this.view(ctx, id);
    if (s.renewedBy)
      throw new DomainError('library.subscription_renewed', 'Already renewed', {
        status: 409,
        extra: { id: s.renewedBy },
      });
    const day = (d: string, n: number) =>
      new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const startsOn = day(s.endsOn, 1);
    // as many months as before when the period was whole months, else as many days
    const a = new Date(`${s.startsOn}T00:00:00Z`);
    const b = new Date(`${day(s.endsOn, 1)}T00:00:00Z`);
    const months =
      (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
    const whole = a.getUTCDate() === b.getUTCDate();
    const end = whole
      ? (() => {
          const e = new Date(b);
          e.setUTCMonth(e.getUTCMonth() + months);
          return day(e.toISOString().slice(0, 10), -1);
        })()
      : day(startsOn, (Date.parse(s.endsOn) - Date.parse(s.startsOn)) / 86_400_000);
    // the first issue keeps its place in the cycle: as far after the start as before
    const offset = (Date.parse(s.firstIssueOn) - Date.parse(s.startsOn)) / 86_400_000;
    return this.create(
      ctx,
      {
        periodicalId: s.periodicalId,
        libraryId: s.libraryId,
        ...(s.vendorId ? { vendorId: s.vendorId } : {}),
        frequency: s.frequency as SubscriptionDto['frequency'],
        startsOn,
        endsOn: end,
        firstIssueOn: day(
          startsOn,
          Math.min(offset, (Date.parse(end) - Date.parse(startsOn)) / 86_400_000),
        ),
        copies: s.copies,
        ...(s.cost ? { cost: Number(s.cost) } : {}),
        graceDays: s.graceDays,
      },
      id,
    );
  }

  /** Cancelled from a day: the issues expected after it go; those received stay. */
  async cancel(ctx: RequestContext, id: string, dto: CancelSubscriptionDto) {
    if (!ID.test(id)) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<{ status: string; starts_on: string; ends_on: string }>(
          `SELECT status, starts_on::text, ends_on::text FROM library_subscriptions WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!s) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
      if (s.status === 'cancelled')
        throw new DomainError('library.subscription_cancelled', 'Already cancelled', {
          status: 409,
        });
      if (dto.on < s.starts_on || dto.on > s.ends_on)
        throw new DomainError('validation-failed', 'Cancelled on a day within the subscription', {
          status: 400,
        });
      await c.query(
        `UPDATE library_subscriptions SET status = 'cancelled', cancelled_on = $2, cancel_reason = $3, updated_at = now(),
                updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, dto.on, dto.reason],
      );
      const gone = await c.query(
        `DELETE FROM library_periodical_issues WHERE subscription_id = $1 AND status = 'expected' AND expected_on > $2`,
        [id, dto.on],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.subscription.cancel',
        entityType: 'library_subscriptions',
        entityId: id,
        after: dto,
      });
      return { id, removed: gone.rowCount ?? 0 };
    });
  }

  async special(ctx: RequestContext, id: string, dto: SpecialIssueDto) {
    if (!ID.test(id)) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<{ status: string; starts_on: string; ends_on: string }>(
          `SELECT status, starts_on::text, ends_on::text FROM library_subscriptions WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!s) throw new DomainError('not-found', 'Subscription not found', { status: 404 });
      if (dto.expectedOn < s.starts_on || dto.expectedOn > s.ends_on)
        throw new DomainError(
          'validation-failed',
          'A special issue falls within the subscription',
          {
            status: 400,
          },
        );
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO library_periodical_issues (school_id, subscription_id, expected_on, label, special)
           VALUES (app.current_school_id(), $1, $2, $3, true) RETURNING id::text`,
          [id, dto.expectedOn, dto.label],
        );
        return { id: r.rows[0]!.id };
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('validation-failed', 'That issue is there already', {
            status: 400,
          });
        throw error;
      }
    });
  }

  private async issue(c: PoolClient, id: string) {
    if (!ID.test(id)) throw new DomainError('not-found', 'Issue not found', { status: 404 });
    const r = await c.query<{
      status: string;
      sub_status: string;
      copies: number;
      expected_on: string;
    }>(
      `SELECT i.status, s.status AS sub_status, s.copies, i.expected_on::text
         FROM library_periodical_issues i JOIN library_subscriptions s ON s.id = i.subscription_id
        WHERE i.id = $1 FOR UPDATE OF i`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Issue not found', { status: 404 });
    return r.rows[0];
  }

  async receive(ctx: RequestContext, id: string, dto: ReceiveIssueDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const i = await this.issue(c, id);
      if (i.status === 'received')
        throw new DomainError('library.issue_received', 'Received already', { status: 409 });
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      if (dto.on > today)
        throw new DomainError('validation-failed', 'Received on a day not yet come', {
          status: 400,
        });
      await c.query(
        `UPDATE library_periodical_issues SET status = 'received', received_on = $2, copies_received = $3, volume = $4,
                issue_no = $5, remarks = $6, marked_by = app.current_user_id(), marked_by_name = $7, marked_at = now()
          WHERE id = $1`,
        [
          id,
          dto.on,
          dto.copies ?? i.copies,
          dto.volume ?? null,
          dto.issueNo ?? null,
          dto.remarks ?? null,
          ctx.user.displayName,
        ],
      );
      return { id, status: 'received' };
    });
  }

  /** Many issues received on one day, each with the copies subscribed (the check-in of the morning). */
  async receiveMany(ctx: RequestContext, dto: ReceiveManyDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      if (dto.on > today)
        throw new DomainError('validation-failed', 'Received on a day not yet come', {
          status: 400,
        });
      const r = await c.query(
        `UPDATE library_periodical_issues i SET status = 'received', received_on = $2, copies_received = s.copies,
                marked_by = app.current_user_id(), marked_by_name = $3, marked_at = now()
           FROM library_subscriptions s
          WHERE s.id = i.subscription_id AND i.id = ANY($1::bigint[]) AND i.status <> 'received'`,
        [dto.ids, dto.on, ctx.user.displayName],
      );
      return { received: r.rowCount ?? 0 };
    });
  }

  async missing(ctx: RequestContext, id: string, dto: MissingIssueDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const i = await this.issue(c, id);
      if (i.status !== 'expected')
        throw new DomainError('library.issue_marked', 'Only an expected issue is marked missing', {
          status: 409,
        });
      await c.query(
        `UPDATE library_periodical_issues SET status = 'missing', remarks = $2, marked_by = app.current_user_id(),
                marked_by_name = $3, marked_at = now()
          WHERE id = $1`,
        [id, dto.remarks, ctx.user.displayName],
      );
      return { id, status: 'missing' };
    });
  }

  /** A receipt or a missing mark undone: the issue is expected again. */
  async undo(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const i = await this.issue(c, id);
      if (i.status === 'expected')
        throw new DomainError('library.issue_expected', 'Nothing to undo', { status: 409 });
      await c.query(
        `UPDATE library_periodical_issues SET status = 'expected', received_on = NULL, copies_received = NULL, volume = NULL,
                issue_no = NULL, remarks = NULL, marked_by = app.current_user_id(), marked_by_name = $2, marked_at = now()
          WHERE id = $1`,
        [id, ctx.user.displayName],
      );
      return { id, status: 'expected' };
    });
  }

  /** The issues to receive: expected by today (or a few days ahead), late ones first. */
  async due(ctx: RequestContext, q: DueIssuesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- the fixed STATE and LATE fragments; values are bound
        `SELECT i.id::text, i.expected_on::text, i.label, i.special, s.id::text AS subscription_id, p.name::text AS periodical,
                l.name AS library, v.name AS vendor, s.copies, ${LATE} AS late, (CURRENT_DATE - i.expected_on) AS days
           FROM library_periodical_issues i
           JOIN library_subscriptions s ON s.id = i.subscription_id
           JOIN library_periodicals p ON p.id = s.periodical_id
           JOIN library_libraries l ON l.id = s.library_id
           LEFT JOIN library_vendors v ON v.id = s.vendor_id
          WHERE s.status = 'active' AND i.status = 'expected' AND i.expected_on <= CURRENT_DATE + $1::int
            AND ($2::bigint IS NULL OR s.library_id = $2)
          ORDER BY ${LATE} DESC, i.expected_on, p.name LIMIT 1000`,
        [q.ahead, q.libraryId ?? null],
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          expectedOn: String(x.expected_on),
          label: String(x.label),
          special: Boolean(x.special),
          subscriptionId: String(x.subscription_id),
          periodical: String(x.periodical),
          library: String(x.library),
          vendor: x.vendor as string | null,
          copies: Number(x.copies),
          late: Boolean(x.late),
          days: Number(x.days),
        })),
      };
    });
  }

  /** The late and missing issues, by vendor, to claim (base64 .xlsx). */
  async claims(ctx: RequestContext, vendorId?: string) {
    if (vendorId && !ID.test(vendorId))
      throw new DomainError('not-found', 'Vendor not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- the fixed STATE and LATE fragments; values are bound
        `SELECT COALESCE(v.name, '(no vendor)') AS vendor, p.name::text AS periodical, p.issn, l.name AS library,
                i.label, i.expected_on, CASE WHEN i.status = 'missing' THEN 'Missing' ELSE 'Late' END AS what,
                i.remarks, s.order_no
           FROM library_periodical_issues i
           JOIN library_subscriptions s ON s.id = i.subscription_id
           JOIN library_periodicals p ON p.id = s.periodical_id
           JOIN library_libraries l ON l.id = s.library_id
           LEFT JOIN library_vendors v ON v.id = s.vendor_id
          WHERE s.status = 'active' AND (i.status = 'missing' OR ${LATE})
            AND ($1::bigint IS NULL OR s.vendor_id = $1)
          ORDER BY 1, 2, i.expected_on`,
        [vendorId ?? null],
      );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('To claim');
      ws.columns = [
        { header: 'Vendor', width: 24 },
        { header: 'Periodical', width: 30 },
        { header: 'ISSN', width: 12 },
        { header: 'Library', width: 18 },
        { header: 'Issue', width: 16 },
        { header: 'Expected on', width: 12 },
        { header: 'Late or missing', width: 12 },
        { header: 'Order no.', width: 14 },
        { header: 'Remarks', width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      for (const x of r.rows)
        ws.addRow([
          x.vendor,
          x.periodical,
          x.issn,
          x.library,
          x.label,
          x.expected_on,
          x.what,
          x.order_no,
          x.remarks,
        ]);
      ws.getColumn(6).numFmt = 'dd-mm-yyyy';
      const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      return {
        filename: `Periodicals-to-claim-${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
        rows: r.rows.length,
      };
    });
  }
}
