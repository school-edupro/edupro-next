import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { schoolHead } from '../attendance/register-file';
import { HOSTEL_H3 } from './hostel.dto';
import type {
  CheckoutDto,
  CheckoutItemsDto,
  DeclineExitDto,
  ExitRequestDto,
  ExitRequestsQueryDto,
} from './hostel-withdrawal.dto';
import { clearancePdf } from './hostel-clearance-pdf';
import { HostelService } from './hostel.service';

type Row = Record<string, unknown>;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const dmy = (d: string | null | undefined) =>
  d ? d.slice(0, 10).split('-').reverse().join('-') : '';
const REASON: Record<string, string> = {
  parent_request: "Parent's request",
  discipline: 'Discipline',
  health: 'Health',
  other: 'Other',
};
const DEFAULT_ITEMS = [
  'Bed',
  'Mattress',
  'Pillow',
  'Bedsheet and blanket',
  'Cupboard / almirah',
  'Study table',
  'Chair',
  'Room key',
  'Cupboard key',
];

/**
 * Hostel withdrawal, part 4 (0163): the parent's request to take the child out of the hostel (the office
 * starts the withdrawal from it or declines it), the room check-out list (the school's items with a
 * charge each; at a withdrawal each is marked ok, missing or damaged and the total is the damage charge),
 * and the hostel clearance certificate of a completed withdrawal (for the office and the family).
 */
@Injectable()
export class HostelExitService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly hostel: HostelService,
  ) {}

  private async familyChild(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
  }

  // ---- the parent's request --------------------------------------------------------------------------------
  /** The child's requests and hostel withdrawals (with the certificate once completed). */
  async familyList(ctx: RequestContext, studentId: string) {
    await this.familyChild(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const boarder = await c.query<{ hostel: string | null }>(
        `SELECT (SELECT name FROM hostels WHERE id = app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS hostel`,
        [studentId],
      );
      const requests = await c.query<Row>(
        `SELECT r.id::text, r.leaving_on::text AS "leavingOn", r.reason, r.note, r.status, r.decline_note AS "declineNote",
                r.created_at AS "createdAt", r.decided_at AS "decidedAt", r.withdrawal_id::text AS "withdrawalId"
           FROM hostel_exit_requests r WHERE r.student_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
        [studentId],
      );
      const withdrawals = await c.query<Row>(
        `SELECT w.id::text, w.leaving_on::text AS "leavingOn", w.status, w.completed_at AS "completedAt"
           FROM hostel_withdrawals w WHERE w.student_id = $1 ORDER BY w.created_at DESC LIMIT 20`,
        [studentId],
      );
      return {
        hostel: boarder.rows[0]?.hostel ?? null,
        requests: requests.rows,
        withdrawals: withdrawals.rows,
      };
    });
  }

  /** A parent asks for the child to leave the hostel (one waiting request at a time; a boarder only). */
  async familyRequest(ctx: RequestContext, dto: ExitRequestDto) {
    await this.familyChild(ctx, dto.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.leavingOn < istToday())
        throw new DomainError(
          'validation-failed',
          'The last day in the hostel cannot be in the past',
          {
            status: 400,
          },
        );
      const b = await c.query<{ hostel: string | null; open: boolean }>(
        `SELECT app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS hostel,
                EXISTS (SELECT 1 FROM hostel_withdrawals WHERE student_id = $1 AND status IN ('requested', 'cleared')) AS open`,
        [dto.studentId],
      );
      if (!b.rows[0]?.hostel)
        throw new DomainError('hostel.not_boarder', 'Your child holds no hostel bed', {
          status: 409,
        });
      if (b.rows[0].open)
        throw new DomainError(
          'hostel.withdrawal_open',
          'The hostel office has already started the withdrawal',
          { status: 409 },
        );
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO hostel_exit_requests (school_id, student_id, leaving_on, reason, note, requested_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, app.current_user_id()) RETURNING id::text`,
          [dto.studentId, dto.leavingOn, dto.reason, dto.note || null],
        );
        await this.audit.stage(ctx, c, {
          action: 'hostel.exit_request.create',
          entityType: 'hostel_exit_requests',
          entityId: r.rows[0]!.id,
          after: dto,
        });
        return { id: r.rows[0]!.id, status: 'pending' };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError('hostel.exit_request_open', 'A request is already waiting', {
            status: 409,
          });
        throw e;
      }
    });
  }

  /** The parent takes back a request the office has not acted on. */
  async familyWithdraw(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ student_id: string; status: string }>(
        `SELECT student_id::text, status FROM hostel_exit_requests WHERE id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Request not found', { status: 404 });
      await this.familyChild(ctx, r.rows[0].student_id);
      if (r.rows[0].status !== 'pending')
        throw new DomainError(
          'hostel.exit_request_not_pending',
          'The office has already acted on it',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE hostel_exit_requests SET status = 'withdrawn', decided_at = now() WHERE id = $1`,
        [id],
      );
      return { id, status: 'withdrawn' };
    });
  }

  /** The requests the office sees (the hostels the person sees). */
  async requests(ctx: RequestContext, q: ExitRequestsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query<Row>(
        `SELECT r.id::text, r.student_id::text AS "studentId", s.display_name AS pupil, s.admission_no AS "admissionNo",
                h.id::text AS "hostelId", h.name AS hostel, r.leaving_on::text AS "leavingOn", r.reason, r.note, r.status,
                r.decline_note AS "declineNote", r.created_at::date::text AS "requestedOn", r.created_at AS "createdAt",
                r.withdrawal_id::text AS "withdrawalId",
                COALESCE((SELECT trim(concat_ws(' ', g.first_name, g.last_name)) FROM guardians g WHERE g.user_id = r.requested_by LIMIT 1),
                         (SELECT u.display_name FROM users u WHERE u.id = r.requested_by)) AS "requestedBy"
           FROM hostel_exit_requests r JOIN students s ON s.id = r.student_id
           LEFT JOIN hostels h ON h.id = app.hostel_of(r.student_id, (now() AT TIME ZONE 'Asia/Kolkata')::date)
          WHERE ($1 = 'all' OR r.status = $1) AND ($2::bigint[] IS NULL OR h.id = ANY ($2::bigint[]))
          ORDER BY r.created_at DESC LIMIT 200`,
        [q.status, only],
      );
      return r.rows;
    });
  }

  async decline(ctx: RequestContext, id: string, dto: DeclineExitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query<{ status: string; hostel: string | null }>(
        `SELECT status, app.hostel_of(student_id, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS hostel
           FROM hostel_exit_requests WHERE id = $1`,
        [id],
      );
      const x = r.rows[0];
      if (!x || (only && !only.includes(x.hostel ?? '')))
        throw new DomainError('not-found', 'Request not found', { status: 404 });
      if (x.status !== 'pending')
        throw new DomainError(
          'hostel.exit_request_not_pending',
          'This request is no longer waiting',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE hostel_exit_requests SET status = 'declined', decline_note = $2, decided_by = app.current_user_id(), decided_at = now()
          WHERE id = $1`,
        [id, dto.note],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.exit_request.decline',
        entityType: 'hostel_exit_requests',
        entityId: id,
        after: dto,
      });
      return { id, status: 'declined' };
    });
  }

  // ---- the room check-out list -------------------------------------------------------------------------------
  private async items(c: PoolClient) {
    await c.query(
      `INSERT INTO hostel_checkout_items (school_id, name, sort_order)
       SELECT app.current_school_id(), x.name, x.n FROM unnest($1::text[]) WITH ORDINALITY AS x(name, n)
        WHERE NOT EXISTS (SELECT 1 FROM hostel_checkout_items)`,
      [DEFAULT_ITEMS],
    );
    const r = await c.query<{
      id: string;
      name: string;
      charge: string;
      active: boolean;
      used: number;
    }>(
      `SELECT i.id::text, i.name, i.charge::text, i.active,
              (SELECT count(*)::int FROM hostel_withdrawal_checkout k WHERE k.item_id = i.id) AS used
         FROM hostel_checkout_items i ORDER BY i.sort_order, i.name`,
    );
    return r.rows.map((x) => ({ ...x, charge: Number(x.charge) }));
  }

  async checkoutItems(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ data: await this.items(c) }));
  }

  /** The school's check-out items: one used at a withdrawal is switched off rather than removed. */
  async saveCheckoutItems(ctx: RequestContext, dto: CheckoutItemsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.items(c);
      for (const old of before.filter((b) => !dto.items.some((x) => x.id === b.id)))
        if (old.used)
          await c.query(`UPDATE hostel_checkout_items SET active = false WHERE id = $1`, [old.id]);
        else await c.query(`DELETE FROM hostel_checkout_items WHERE id = $1`, [old.id]);
      try {
        for (const [i, x] of dto.items.entries())
          if (x.id && before.some((b) => b.id === x.id))
            await c.query(
              `UPDATE hostel_checkout_items SET name = $2, charge = $3, active = $4, sort_order = $5 WHERE id = $1`,
              [x.id, x.name, x.charge.toFixed(2), x.active, i + 1],
            );
          else
            await c.query(
              `INSERT INTO hostel_checkout_items (school_id, name, charge, active, sort_order)
               VALUES (app.current_school_id(), $1, $2, $3, $4)`,
              [x.name, x.charge.toFixed(2), x.active, i + 1],
            );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError('validation-failed', 'Each item needs its own name', {
            status: 409,
          });
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.checkout_items.save',
        entityType: 'hostel_checkout_items',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
      return { data: await this.items(c) };
    });
  }

  /** The withdrawal's hostel, checked against the person's hostels. */
  private async withdrawalOf(ctx: RequestContext, c: PoolClient, id: string) {
    const r = await c.query<{ status: string; hostel_id: string; checked_out_at: string | null }>(
      `SELECT w.status, rm.hostel_id::text, w.checked_out_at::text
         FROM hostel_withdrawals w JOIN hostel_allotments a ON a.id = w.allotment_id JOIN hostel_beds b ON b.id = a.bed_id
         JOIN hostel_rooms rm ON rm.id = b.room_id WHERE w.id = $1`,
      [id],
    );
    const w = r.rows[0];
    const only = await this.hostel.scope(ctx, c);
    if (!w || (only && !only.includes(w.hostel_id)))
      throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
    return w;
  }

  /** The check-out of a withdrawal: the school's items with what was marked (none yet: all ok). */
  async checkout(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.checkoutWith(ctx, c, id));
  }

  private async checkoutWith(ctx: RequestContext, c: PoolClient, id: string) {
    const w = await this.withdrawalOf(ctx, c, id);
    const items = (await this.items(c)).filter((i) => i.active);
    const saved = await c.query<Row>(
      `SELECT item_id::text AS "itemId", item_name AS name, condition, charge::float AS charge, note,
                (SELECT u.display_name FROM users u WHERE u.id = checked_by) AS "checkedBy", checked_at AS "checkedAt"
           FROM hostel_withdrawal_checkout WHERE withdrawal_id = $1 ORDER BY id`,
      [id],
    );
    const rows = saved.rows.length
      ? saved.rows
      : items.map((i) => ({
          itemId: i.id,
          name: i.name,
          condition: 'ok',
          charge: 0,
          note: null,
        }));
    return {
      status: w.status,
      checkedOutAt: w.checked_out_at,
      /** the charge for one missing or damaged, by item */
      charges: Object.fromEntries(items.map((i) => [i.name, i.charge])),
      items: rows,
      total: rows.reduce((n, x) => n + (x.condition === 'ok' ? 0 : Number(x.charge)), 0),
    };
  }

  /** Marks the room check-out; the total of what is missing or damaged becomes the damage charge. */
  async saveCheckout(ctx: RequestContext, id: string, dto: CheckoutDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.withdrawalOf(ctx, c, id);
      if (w.status !== 'requested')
        throw new DomainError(
          'hostel.withdrawal_not_open',
          'The check-out can be changed only while the withdrawal waits for approval',
          { status: 409 },
        );
      await c.query(`DELETE FROM hostel_withdrawal_checkout WHERE withdrawal_id = $1`, [id]);
      let total = 0;
      for (const x of dto.items) {
        const charge = x.condition === 'ok' ? 0 : x.charge;
        total += charge;
        await c.query(
          `INSERT INTO hostel_withdrawal_checkout (school_id, withdrawal_id, item_id, item_name, condition, charge, note, checked_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())`,
          [id, x.itemId ?? null, x.name, x.condition, charge.toFixed(2), x.note || null],
        );
      }
      const lost = dto.items.filter((x) => x.condition !== 'ok');
      await c.query(
        `UPDATE hostel_withdrawals SET damage_charge = $2, checked_out_at = now(), checked_out_by = app.current_user_id(),
                charge_remarks = CASE WHEN $3::text = '' THEN charge_remarks ELSE $3 END, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          total.toFixed(2),
          lost.length
            ? `Room check-out: ${lost.map((x) => `${x.name} ${x.condition}${x.note ? ` (${x.note})` : ''}`).join(', ')}`.slice(
                0,
                500,
              )
            : '',
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.checkout',
        entityType: 'hostel_withdrawals',
        entityId: id,
        after: { total, items: dto.items.length, lost: lost.length },
      });
      return this.checkoutWith(ctx, c, id);
    });
  }

  // ---- the clearance certificate --------------------------------------------------------------------------------
  private async sheet(c: PoolClient, id: string) {
    const r = await c.query<Row>(
      `SELECT w.id::text, w.student_id::text AS sid, w.status, w.leaving_on::text AS leaving, w.reason, w.fee_choice, w.fee_note,
              w.fee_until::text AS fee_until, w.damage_charge::float AS damage, w.mess_charge::float AS mess, w.notice_short,
              w.completed_at, s.display_name AS pupil, s.admission_no,
              (SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                 JOIN classes k ON k.id = cs.class_id WHERE en.student_id = s.id AND en.academic_year_id = w.academic_year_id LIMIT 1) AS section,
              h.name AS hostel, rm.room_no || '/' || b.label AS room, a.from_date::text AS stay_from,
              COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = w.completed_by LIMIT 1),
                       (SELECT u.display_name FROM users u WHERE u.id = w.completed_by)) AS approved_by
         FROM hostel_withdrawals w JOIN students s ON s.id = w.student_id JOIN hostel_allotments a ON a.id = w.allotment_id
         JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
        WHERE w.id = $1`,
      [id],
    );
    const w = r.rows[0];
    if (!w) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
    if (w.status === 'revoked')
      throw new DomainError(
        'hostel.withdrawal_revoked',
        'This hostel withdrawal was revoked (the pupil is back in the hostel): the clearance certificate is no longer valid',
        { status: 409 },
      );
    if (w.status !== 'completed')
      throw new DomainError(
        'hostel.withdrawal_not_completed',
        'The clearance certificate is ready once the withdrawal is approved and completed',
        { status: 409 },
      );
    const checkout = await c.query<{ name: string; condition: string; charge: number }>(
      `SELECT item_name AS name, condition, charge::float AS charge FROM hostel_withdrawal_checkout WHERE withdrawal_id = $1 ORDER BY id`,
      [id],
    );
    const head = await schoolHead(c);
    const rs = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const settlement: Array<[string, string]> = [
      [
        'Hostel fee',
        String(
          w.fee_note ?? (w.fee_until ? `Charged up to ${dmy(String(w.fee_until))}` : 'Settled'),
        ),
      ],
      [
        'Paid later months',
        w.fee_choice === 'refund' ? 'Refunded on request' : 'Carried forward to the school fee',
      ],
      ['Damage charge', Number(w.damage) ? rs(Number(w.damage)) : 'None'],
      ['Mess dues', Number(w.mess) ? rs(Number(w.mess)) : 'None'],
    ];
    if (w.notice_short) settlement.push(['Notice', 'Short notice: the next month was charged']);
    return {
      studentId: String(w.sid),
      pdf: await clearancePdf({
        school: head.name,
        address: head.address,
        number: `HC/${String(w.id).padStart(5, '0')}`,
        issuedOn: dmy(w.completed_at instanceof Date ? w.completed_at.toISOString() : istToday()),
        pupil: String(w.pupil),
        admissionNo: String(w.admission_no ?? ''),
        section: String(w.section ?? ''),
        hostel: String(w.hostel),
        room: String(w.room ?? ''),
        stayFrom: dmy(String(w.stay_from)),
        lastDay: dmy(String(w.leaving)),
        reason: REASON[String(w.reason)] ?? String(w.reason),
        settlement,
        checkout: checkout.rows.map((x) => [
          x.name,
          x.condition === 'ok' ? 'In order' : x.condition === 'missing' ? 'Missing' : 'Damaged',
          x.charge ? rs(x.charge) : '-',
        ]),
        approvedBy: String(w.approved_by ?? '-'),
      }),
    };
  }

  async certificate(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.withdrawalOf(ctx, c, id);
      const s = await this.sheet(c, id);
      return {
        filename: `hostel-clearance-${id}.pdf`,
        contentType: 'application/pdf',
        bytes: s.pdf,
      };
    });
  }

  /** The family's copy of the certificate (their own child's completed withdrawal). */
  async familyCertificate(ctx: RequestContext, id: string) {
    const sid = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ sid: string }>(
        `SELECT student_id::text AS sid FROM hostel_withdrawals WHERE id = $1`,
        [id],
      );
      return r.rows[0]?.sid;
    });
    if (!sid) throw new DomainError('not-found', 'Not found', { status: 404 });
    await this.familyChild(ctx, sid);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.sheet(c, id);
      return {
        filename: `hostel-clearance-${id}.pdf`,
        contentType: 'application/pdf',
        bytes: s.pdf,
      };
    });
  }
}
