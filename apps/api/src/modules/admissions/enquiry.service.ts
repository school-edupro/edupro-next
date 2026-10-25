import { messageTag } from './message-tag';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { enquiryTokenHash } from './enquiry-engine';
import type {
  EnquiryDto,
  EnquiryQueryDto,
  EnquiryReportQueryDto,
  EnquiryUpdateDto,
  FollowUpDto,
  EnquiryDeskDto,
  InviteDto,
  PublicEnquiryDto,
  ReplyDto,
  SourcesDto,
} from './enquiry.dto';
import { publicTenant } from './public/otp.service';

const DEFAULT_SOURCES = [
  'Walk-in',
  'Phone call',
  'Website',
  'Newspaper',
  'Social media',
  'Hoarding or banner',
  'Parent referral',
  'School event',
  'Other',
];
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export const ENQUIRY_MANAGE = 'admissions.enquiry.manage';

/** The number a family is given for its enquiry (docs/design/43, part 3). */
export const enquiryNo = (id: string) => `ENQ-${id.padStart(6, '0')}`;

/** Who may take enquiries in the school: the users holding the enquiry permission. */
const COUNSELLORS = `SELECT DISTINCT u.id, u.display_name AS name FROM users u
   JOIN user_roles ur ON ur.user_id = u.id AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
   JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_code = 'admissions.enquiry.manage'
  WHERE u.deleted_at IS NULL`;

/**
 * The enquiry desk (docs/design/39, part 8): enquiries from a walk-in, a phone call, the website or a
 * campaign; a counsellor; follow-ups with the next date (the desk shows what is due today and overdue);
 * an invitation to register by email / SMS / WhatsApp with a link that fills the form; the conversion to
 * registration and admission by source and class.
 */
@Injectable()
export class AdmissionEnquiryService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async sourcesWith(c: PoolClient) {
    const n = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admission_enquiry_sources`,
    );
    if (!n.rows[0]?.n)
      for (const [i, name] of DEFAULT_SOURCES.entries())
        await c.query(
          `INSERT INTO admission_enquiry_sources (school_id, name, sort_order) VALUES (app.current_school_id(), $1, $2)`,
          [name, i],
        );
    const r = await c.query<{ id: string; name: string; status: string; used: number }>(
      `SELECT s.id::text, s.name, s.status, (SELECT count(*)::int FROM admission_enquiries e WHERE e.source_id = s.id) AS used
         FROM admission_enquiry_sources s ORDER BY s.sort_order, s.id`,
    );
    return r.rows;
  }

  /** What the desk offers: sources, sessions and classes, counsellors. */
  async meta(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sources = await this.sourcesWith(c);
      const cycles = await c.query<{ id: string; name: string; status: string }>(
        `SELECT id::text, name, status::text FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC LIMIT 10`,
      );
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
      );
      const counsellors = await c.query<{ id: string; name: string }>(
        // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
        `SELECT id::text, name FROM (${COUNSELLORS}) k ORDER BY name LIMIT 300`,
      );
      return {
        sources,
        cycles: cycles.rows,
        classes: classes.rows,
        counsellors: counsellors.rows,
        desk: await this.deskWith(c),
      };
    });
  }

  /** How website enquiries are taken: assigned on arrival (to whom) and acknowledged. */
  private async deskWith(c: PoolClient) {
    await c.query(
      `INSERT INTO admission_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    const r = await c.query<{
      enquiry_auto_assign: boolean;
      enquiry_counsellors: string[];
      enquiry_acknowledge: boolean;
      signin_channels: string[];
    }>(
      `SELECT enquiry_auto_assign, enquiry_counsellors::text[] AS enquiry_counsellors, enquiry_acknowledge, signin_channels
         FROM admission_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0]!;
    return {
      autoAssign: x.enquiry_auto_assign,
      counsellors: x.enquiry_counsellors,
      acknowledge: x.enquiry_acknowledge,
      channels: x.signin_channels,
    };
  }

  async saveDesk(ctx: RequestContext, dto: EnquiryDeskDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.deskWith(c);
      if (dto.counsellors.length) {
        const ok = await c.query<{ id: string }>(
          // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
          `SELECT id::text FROM (${COUNSELLORS}) k WHERE id = ANY($1::bigint[])`,
          [dto.counsellors],
        );
        if (ok.rows.length !== new Set(dto.counsellors).size)
          throw new DomainError(
            'validation-failed',
            'A counsellor chosen cannot take enquiries (no enquiry permission)',
            { status: 400 },
          );
      }
      await c.query(
        `UPDATE admission_settings SET enquiry_auto_assign = $1, enquiry_counsellors = $2::bigint[], enquiry_acknowledge = $3,
                updated_at = now(), updated_by = $4 WHERE school_id = app.current_school_id()`,
        [dto.autoAssign, [...new Set(dto.counsellors)], dto.acknowledge, ctx.user.id],
      );
      const after = await this.deskWith(c);
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.desk',
        entityType: 'admission_settings',
        entityId: ctx.tenant!.schoolId,
        before,
        after,
      });
      return after;
    });
  }

  /**
   * A website enquiry given to a counsellor on arrival: among those chosen (or everyone who takes
   * enquiries), the one with the fewest open enquiries; ties go to the one given an enquiry longest ago.
   */
  private async assign(c: PoolClient, id: string, chosen: string[]): Promise<string | null> {
    const k = await c.query<{ id: string; name: string }>(
      // eslint-disable-next-line no-restricted-syntax -- COUNSELLORS is a fixed fragment
      `SELECT k.id::text, k.name FROM (${COUNSELLORS}) k
        WHERE cardinality($1::bigint[]) = 0 OR k.id = ANY($1::bigint[])
        ORDER BY (SELECT count(*) FROM admission_enquiries e WHERE e.counsellor_user_id = k.id AND e.status IN ('new', 'follow_up', 'interested')),
                 (SELECT max(e.assigned_at) FROM admission_enquiries e WHERE e.counsellor_user_id = k.id) ASC NULLS FIRST, k.id
        LIMIT 1`,
      [chosen],
    );
    const who = k.rows[0];
    if (!who) return null;
    await c.query(
      `UPDATE admission_enquiries SET counsellor_user_id = $2, assigned_at = now() WHERE id = $1`,
      [id, who.id],
    );
    await c.query(
      `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome) VALUES (app.current_school_id(), $1, 'system', $2)`,
      [id, `Assigned to ${who.name} on arrival`],
    );
    return who.name;
  }

  async saveSources(ctx: RequestContext, dto: SourcesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.sourcesWith(c);
      const kept = new Set(dto.sources.map((s) => s.id).filter(Boolean));
      for (const old of before)
        if (!kept.has(old.id)) {
          if (old.used)
            await c.query(
              `UPDATE admission_enquiry_sources SET status = 'inactive' WHERE id = $1`,
              [old.id],
            );
          else await c.query(`DELETE FROM admission_enquiry_sources WHERE id = $1`, [old.id]);
        }
      for (const [i, s] of dto.sources.entries())
        if (s.id && before.some((b) => b.id === s.id))
          await c.query(
            `UPDATE admission_enquiry_sources SET name = $2, status = $3, sort_order = $4 WHERE id = $1`,
            [s.id, s.name, s.status, i],
          );
        else
          await c.query(
            `INSERT INTO admission_enquiry_sources (school_id, name, status, sort_order) VALUES (app.current_school_id(), $1, $2, $3)`,
            [s.name, s.status, i],
          );
      return this.sourcesWith(c);
    });
  }

  async list(ctx: RequestContext, q: EnquiryQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replaceAll('?', `$${params.length}`));
      };
      if (q.status === 'open') where.push(`e.status IN ('new', 'follow_up', 'interested')`);
      else if (q.status) add('e.status = ?', q.status);
      if (q.sourceId) add('e.source_id = ?', q.sourceId);
      if (q.classId) add('e.class_id = ?', q.classId);
      if (q.cycleId) add('e.cycle_id = ?', q.cycleId);
      if (q.counsellor === 'me') add('e.counsellor_user_id = ?', ctx.user.id);
      else if (q.counsellor === 'none') where.push('e.counsellor_user_id IS NULL');
      else if (q.counsellor) add('e.counsellor_user_id = ?', q.counsellor);
      if (q.due === 'today')
        add(
          `e.status IN ('new', 'follow_up', 'interested') AND e.next_follow_up_on = ?::date`,
          today(),
        );
      if (q.due === 'overdue')
        add(
          `e.status IN ('new', 'follow_up', 'interested') AND e.next_follow_up_on < ?::date`,
          today(),
        );
      if (q.due === 'upcoming')
        add(
          `e.status IN ('new', 'follow_up', 'interested') AND e.next_follow_up_on > ?::date`,
          today(),
        );
      if (q.q)
        add(
          `(e.parent_name ILIKE ? OR e.child_name ILIKE ? OR e.mobile ILIKE ? OR e.email::text ILIKE ?)`,
          `%${q.q}%`,
        );
      const w = where.join(' AND ');
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments; values are bound parameters
        `SELECT count(*)::int AS n FROM admission_enquiries e WHERE ${w}`,
        params,
      );
      const counts = await c.query<{
        open: number;
        fresh: number;
        due_today: number;
        overdue: number;
        converted_month: number;
        mine: number;
      }>(
        `SELECT count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested'))::int AS open,
                count(*) FILTER (WHERE status = 'new')::int AS fresh,
                count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested') AND next_follow_up_on = $1::date)::int AS due_today,
                count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested') AND next_follow_up_on < $1::date)::int AS overdue,
                count(*) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now()))::int AS converted_month,
                count(*) FILTER (WHERE status IN ('new', 'follow_up', 'interested') AND counsellor_user_id = $2)::int AS mine
           FROM admission_enquiries`,
        [today(), ctx.user.id],
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<{
        id: string;
        parent_name: string;
        child_name: string | null;
        class_name: string | null;
        source: string | null;
        campaign: string | null;
        mobile: string | null;
        email: string | null;
        status: string;
        next_follow_up_on: string | null;
        counsellor: string | null;
        created_at: Date;
        last_contact_at: Date | null;
        from_website: boolean;
        application_no: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments; values are bound parameters
        `SELECT e.id::text, e.parent_name, e.child_name, cl.name AS class_name, s.name AS source, e.campaign, e.mobile, e.email::text,
                e.status, e.next_follow_up_on::text, u.display_name AS counsellor, e.created_at, e.last_contact_at, e.from_website,
                a.application_no
           FROM admission_enquiries e LEFT JOIN classes cl ON cl.id = e.class_id LEFT JOIN admission_enquiry_sources s ON s.id = e.source_id
           LEFT JOIN users u ON u.id = e.counsellor_user_id LEFT JOIN applications a ON a.id = e.application_id
          WHERE ${w}
          ORDER BY CASE WHEN e.status IN ('new', 'follow_up', 'interested') THEN 0 ELSE 1 END, e.next_follow_up_on NULLS LAST, e.created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const k = counts.rows[0]!;
      return {
        total: total.rows[0]?.n ?? 0,
        counts: {
          open: k.open,
          new: k.fresh,
          dueToday: k.due_today,
          overdue: k.overdue,
          convertedThisMonth: k.converted_month,
          mine: k.mine,
        },
        data: r.rows.map((x) => ({
          id: x.id,
          parentName: x.parent_name,
          childName: x.child_name,
          className: x.class_name,
          source: x.source,
          campaign: x.campaign,
          mobile: x.mobile,
          email: x.email,
          status: x.status,
          nextFollowUpOn: x.next_follow_up_on,
          counsellor: x.counsellor,
          createdAt: x.created_at.toISOString(),
          lastContactAt: x.last_contact_at?.toISOString() ?? null,
          fromWebsite: x.from_website,
          registrationNo: x.application_no,
        })),
      };
    });
  }

  private async row(c: PoolClient, id: string) {
    const r = await c.query<{
      id: string;
      cycle_id: string | null;
      class_id: string | null;
      source_id: string | null;
      campaign: string | null;
      parent_name: string;
      child_name: string | null;
      child_dob: string | null;
      mobile: string | null;
      email: string | null;
      locality: string | null;
      previous_school: string | null;
      notes: string | null;
      status: string;
      counsellor_user_id: string | null;
      next_follow_up_on: string | null;
      invited_at: Date | null;
      application_id: string | null;
      converted_at: Date | null;
      from_website: boolean;
      created_at: Date;
      created_by: string | null;
    }>(
      `SELECT e.id::text, e.cycle_id::text, e.class_id::text, e.source_id::text, e.campaign, e.parent_name, e.child_name, e.child_dob::text,
              e.mobile, e.email::text, e.locality, e.previous_school, e.notes, e.status, e.counsellor_user_id::text, e.next_follow_up_on::text,
              e.invited_at, e.application_id::text, e.converted_at, e.from_website, e.created_at, u.display_name AS created_by
         FROM admission_enquiries e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Enquiry not found', { status: 404 });
    return r.rows[0];
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      const followups = await c.query<{
        id: string;
        mode: string;
        outcome: string;
        next_on: string | null;
        status_after: string | null;
        by: string | null;
        at: Date;
      }>(
        `SELECT f.id::text, f.mode, f.outcome, f.next_on::text, f.status_after, u.display_name AS by, f.at
           FROM admission_enquiry_followups f LEFT JOIN users u ON u.id = f.by_user_id WHERE f.enquiry_id = $1 ORDER BY f.at DESC, f.id DESC`,
        [id],
      );
      const app = e.application_id
        ? (
            await c.query<{ number: string | null; status: string; candidate: string | null }>(
              `SELECT application_no AS number, status::text, candidate_name AS candidate FROM applications WHERE id = $1`,
              [e.application_id],
            )
          ).rows[0]
        : null;
      return {
        id: e.id,
        number: enquiryNo(e.id),
        cycleId: e.cycle_id,
        classId: e.class_id,
        sourceId: e.source_id,
        campaign: e.campaign,
        parentName: e.parent_name,
        childName: e.child_name,
        childDob: e.child_dob,
        mobile: e.mobile,
        email: e.email,
        locality: e.locality,
        previousSchool: e.previous_school,
        notes: e.notes,
        status: e.status,
        counsellorUserId: e.counsellor_user_id,
        nextFollowUpOn: e.next_follow_up_on,
        invitedAt: e.invited_at?.toISOString() ?? null,
        fromWebsite: e.from_website,
        createdAt: e.created_at.toISOString(),
        createdBy: e.created_by,
        application: e.application_id && app ? { id: e.application_id, ...app } : null,
        convertedAt: e.converted_at?.toISOString() ?? null,
        followups: followups.rows.map((f) => ({
          id: f.id,
          mode: f.mode,
          outcome: f.outcome,
          nextOn: f.next_on,
          statusAfter: f.status_after,
          by: f.by,
          at: f.at.toISOString(),
        })),
      };
    });
  }

  private values(dto: EnquiryDto) {
    return [
      dto.cycleId ?? null,
      dto.classId ?? null,
      dto.sourceId ?? null,
      dto.campaign ?? null,
      dto.parentName,
      dto.childName ?? null,
      dto.childDob ?? null,
      dto.mobile ?? null,
      dto.email?.toLowerCase() ?? null,
      dto.locality ?? null,
      dto.previousSchool ?? null,
      dto.notes ?? null,
      dto.counsellorUserId ?? null,
      dto.nextFollowUpOn ?? null,
    ];
  }

  async create(ctx: RequestContext, dto: EnquiryDto) {
    const id = await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.sourcesWith(c);
      const r = await c.query<{ id: string }>(
        `INSERT INTO admission_enquiries (school_id, cycle_id, class_id, source_id, campaign, parent_name, child_name, child_dob, mobile, email,
                                          locality, previous_school, notes, counsellor_user_id, next_follow_up_on, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, $15::bigint), COALESCE($14::date, CURRENT_DATE), $15)
         RETURNING id::text`,
        [...this.values(dto), ctx.user.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.enquiry.create',
        entityType: 'admission_enquiries',
        entityId: r.rows[0]!.id,
        after: { source: dto.sourceId ?? null, classId: dto.classId ?? null },
      });
      return r.rows[0]!.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: string, dto: EnquiryUpdateDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.row(c, id);
      if (dto.status === 'converted' && !before.application_id)
        throw new DomainError(
          'validation-failed',
          'An enquiry becomes converted when the family registers',
          { status: 400 },
        );
      await c.query(
        `UPDATE admission_enquiries SET cycle_id = $1, class_id = $2, source_id = $3, campaign = $4, parent_name = $5, child_name = $6, child_dob = $7,
                mobile = $8, email = $9, locality = $10, previous_school = $11, notes = $12, counsellor_user_id = $13, next_follow_up_on = $14,
                status = COALESCE($16, status), updated_at = now(),
                assigned_at = CASE WHEN $13::bigint IS DISTINCT FROM counsellor_user_id THEN now() ELSE assigned_at END
          WHERE id = $15`,
        [...this.values(dto), id, dto.status ?? null],
      );
      if (dto.counsellorUserId && dto.counsellorUserId !== before.counsellor_user_id)
        await c.query(
          `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id)
           SELECT app.current_school_id(), $1, 'note', 'Counsellor: ' || u.display_name, $3 FROM users u WHERE u.id = $2`,
          [id, dto.counsellorUserId, ctx.user.id],
        );
    });
    return this.get(ctx, id);
  }

  /** A call, a visit, a message or a note: the outcome, the next date and the status after it. */
  async followUp(ctx: RequestContext, id: string, dto: FollowUpDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      if (['converted', 'closed'].includes(e.status) && dto.status !== 'follow_up')
        throw new DomainError(
          'admissions.enquiry_closed',
          'This enquiry is closed; reopen it with a follow-up status',
          { status: 409 },
        );
      const next =
        dto.status === 'not_interested' || dto.status === 'closed' ? null : (dto.nextOn ?? null);
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, next_on, status_after, by_user_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
        [id, dto.mode, dto.outcome, next, dto.status ?? null, ctx.user.id],
      );
      await c.query(
        `UPDATE admission_enquiries SET status = COALESCE($2, CASE WHEN status = 'new' THEN 'follow_up' ELSE status END), next_follow_up_on = $3,
                last_contact_at = now(), counsellor_user_id = COALESCE(counsellor_user_id, $4), updated_at = now() WHERE id = $1`,
        [id, dto.status ?? null, next, ctx.user.id],
      );
    });
    return this.get(ctx, id);
  }

  /**
   * A reply to the family (docs/design/43, part 3): the message by email and / or SMS (and WhatsApp
   * where the school sends it), kept with the follow-ups; the enquiry counts as contacted.
   */
  async reply(ctx: RequestContext, id: string, dto: ReplyDto) {
    const sent = await this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      const email = dto.email ? e.email : null;
      const mobile = dto.mobile ? e.mobile : null;
      if (!email && !mobile)
        throw new DomainError(
          'validation-failed',
          dto.email && !dto.mobile
            ? 'The enquiry has no email'
            : !dto.email && dto.mobile
              ? 'The enquiry has no mobile'
              : 'The enquiry has no email or mobile',
          { status: 400 },
        );
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const n = await c.query<{ n: number }>(
        `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8) AS n`,
        [
          'admission_message',
          mobile,
          email,
          JSON.stringify({
            ...messageTag('enquiry_reply', { applicationId: e.application_id }),
            subject: `Your enquiry ${enquiryNo(id)} at ${school.rows[0]!.name}`,
            message: dto.message,
            name: e.child_name ?? '',
          }),
          'About your enquiry',
          dto.message,
          JSON.stringify([['Enquiry no.', enquiryNo(id)]]),
          'Reply to this by calling the school office, or send a new enquiry from the admission page.',
        ],
      );
      const count = n.rows[0]?.n ?? 0;
      if (!count)
        throw new DomainError(
          'admissions.reply_not_sent',
          'Nothing could be sent: check the address and the admission message templates',
          { status: 409 },
        );
      const by = [email ? 'email' : '', mobile ? 'SMS' : ''].filter(Boolean).join(' and ');
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id)
         VALUES (app.current_school_id(), $1, 'reply', $2, $3)`,
        [id, `Reply by ${by}: ${dto.message}`, ctx.user.id],
      );
      await c.query(
        `UPDATE admission_enquiries SET status = CASE WHEN status = 'new' THEN 'follow_up' ELSE status END, last_contact_at = now(),
                counsellor_user_id = COALESCE(counsellor_user_id, $2),
                assigned_at = CASE WHEN counsellor_user_id IS NULL THEN now() ELSE assigned_at END, updated_at = now()
          WHERE id = $1`,
        [id, ctx.user.id],
      );
      return count;
    });
    return { sent, enquiry: await this.get(ctx, id) };
  }

  /** The invitation to register: a link that fills the form from the enquiry, by email, SMS and WhatsApp. */
  async invite(ctx: RequestContext, id: string, dto: InviteDto) {
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.row(c, id);
      if (e.application_id)
        throw new DomainError('admissions.enquiry_converted', 'The family has registered already', {
          status: 409,
        });
      const cycleId = dto.cycleId ?? e.cycle_id;
      const cyc = await c.query<{
        code: string;
        name: string;
        school: string;
        school_code: string;
      }>(
        `SELECT y.code, y.name, s.name AS school, lower(s.code) AS school_code FROM admission_cycles y JOIN schools s ON s.id = y.school_id
          WHERE ($1::bigint IS NULL OR y.id = $1::bigint) AND y.status = 'open' AND y.deleted_at IS NULL ORDER BY y.opens_at DESC LIMIT 1`,
        [cycleId],
      );
      if (!cyc.rows[0])
        throw new DomainError(
          'admissions.no_open_session',
          'No admission session is open to register in',
          { status: 409 },
        );
      const token = randomBytes(24).toString('base64url');
      const link = `${this.env.PUBLIC_APP_URL}/${cyc.rows[0].school_code}/admission?session=${encodeURIComponent(cyc.rows[0].code)}&enquiry=${token}`;
      await c.query(
        `UPDATE admission_enquiries SET invite_token_hash = $2, invited_at = now(), updated_at = now() WHERE id = $1`,
        [id, enquiryTokenHash(token)],
      );
      const message =
        dto.message?.trim() ||
        `Dear ${e.parent_name}, thank you for your interest in ${cyc.rows[0].school}. Registrations for ${cyc.rows[0].name} are open: register ${e.child_name ?? 'your ward'} online at ${link}`;
      const n = await c.query<{ n: number }>(
        `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8) AS n`,
        [
          'admission_message',
          e.mobile,
          e.email,
          JSON.stringify({
            ...messageTag('enquiry_invite'),
            subject: `Register for admission at ${cyc.rows[0].school}`,
            message,
            name: e.child_name ?? '',
          }),
          'Registrations are open',
          message,
          JSON.stringify([
            ['Session', cyc.rows[0].name],
            ['Register at', link],
          ]),
          'Sign in with your mobile number or email; the form starts with the details you gave us.',
        ],
      );
      await c.query(
        `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome, by_user_id) VALUES (app.current_school_id(), $1, 'invite', $2, $3)`,
        [
          id,
          `Invited to register (${n.rows[0]?.n ?? 0} message${(n.rows[0]?.n ?? 0) === 1 ? '' : 's'} sent)`,
          ctx.user.id,
        ],
      );
      await c.query(
        `UPDATE admission_enquiries SET status = CASE WHEN status = 'new' THEN 'follow_up' ELSE status END, last_contact_at = now() WHERE id = $1`,
        [id],
      );
      return { link, sent: n.rows[0]?.n ?? 0 };
    });
    return { ...out, enquiry: await this.get(ctx, id) };
  }

  /** The enquiry form of the school's website. */
  async publicCreate(schoolId: string, dto: PublicEnquiryDto) {
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const sources = await this.sourcesWith(c);
      const web = sources.find((s) => s.name.toLowerCase() === 'website');
      if (dto.classId) {
        const ok = await c.query(`SELECT 1 FROM classes WHERE id = $1 AND deleted_at IS NULL`, [
          dto.classId,
        ]);
        if (!ok.rows.length)
          throw new DomainError('validation-failed', 'Unknown class', { status: 400 });
      }
      const open = await c.query<{ id: string }>(
        `SELECT id::text FROM admission_cycles WHERE status = 'open' AND deleted_at IS NULL ORDER BY opens_at DESC LIMIT 1`,
      );
      const made = await c.query<{ id: string }>(
        `INSERT INTO admission_enquiries (school_id, cycle_id, class_id, source_id, parent_name, child_name, child_dob, mobile, email, locality, notes,
                                          next_follow_up_on, from_website)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, true)
         RETURNING id::text`,
        [
          open.rows[0]?.id ?? null,
          dto.classId ?? null,
          web?.id ?? null,
          dto.parentName,
          dto.childName ?? null,
          dto.childDob ?? null,
          dto.mobile ?? null,
          dto.email?.toLowerCase() ?? null,
          dto.locality ?? null,
          dto.message ?? null,
        ],
      );
      const id = made.rows[0]!.id;
      const desk = await this.deskWith(c);
      if (desk.autoAssign) await this.assign(c, id, desk.counsellors);
      // the family's acknowledgement with its number, by the channels the school signs families in with
      let acknowledged = 0;
      if (desk.acknowledge) {
        const school = await c.query<{ name: string; phone: string | null }>(
          `SELECT name, NULLIF(btrim(contact->>'phone'), '') AS phone FROM schools WHERE id = app.current_school_id()`,
        );
        const s = school.rows[0]!;
        const message = `Dear ${dto.parentName}, we have your admission enquiry ${enquiryNo(id)} at ${s.name}. The admission office will get back to you soon.`;
        const n = await c.query<{ n: number }>(
          `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9) AS n`,
          [
            'admission_message',
            desk.channels.some((x) => x === 'sms' || x === 'whatsapp')
              ? (dto.mobile ?? null)
              : null,
            desk.channels.includes('email') ? (dto.email?.toLowerCase() ?? null) : null,
            JSON.stringify({
              ...messageTag('enquiry_ack'),
              subject: `We have your enquiry ${enquiryNo(id)}`,
              message,
              name: dto.childName ?? '',
            }),
            'We have your enquiry',
            message,
            enquiryNo(id),
            JSON.stringify([
              ['Enquiry no.', enquiryNo(id)],
              ...(dto.childName ? [['Child', dto.childName]] : []),
            ]),
            s.phone ? `Quote the enquiry number when you call the school at ${s.phone}.` : null,
          ],
        );
        acknowledged = n.rows[0]?.n ?? 0;
        if (acknowledged)
          await c.query(
            `INSERT INTO admission_enquiry_followups (school_id, enquiry_id, mode, outcome) VALUES (app.current_school_id(), $1, 'system', $2)`,
            [
              id,
              `Acknowledgement sent (${String(acknowledged)} message${acknowledged === 1 ? '' : 's'})`,
            ],
          );
      }
      return { received: true, enquiryNo: enquiryNo(id) };
    });
  }

  /** Enquiry → registration → admission, by source and by class (a session and / or dates). */
  async report(ctx: RequestContext, q: EnquiryReportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params = [q.cycleId ?? null, q.from ?? null, q.to ?? null];
      const base = `FROM admission_enquiries e LEFT JOIN applications a ON a.id = e.application_id
        WHERE ($1::bigint IS NULL OR e.cycle_id = $1::bigint OR a.cycle_id = $1::bigint)
          AND ($2::date IS NULL OR (e.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $2::date)
          AND ($3::date IS NULL OR (e.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $3::date)`;
      const cols = `count(*)::int AS enquiries,
        count(*) FILTER (WHERE e.status IN ('new', 'follow_up', 'interested'))::int AS open,
        count(*) FILTER (WHERE a.application_no IS NOT NULL)::int AS registered,
        count(*) FILTER (WHERE a.status::text IN ('fee_paid', 'admitted'))::int AS admitted,
        count(*) FILTER (WHERE e.status IN ('not_interested', 'closed'))::int AS lost`;
      const bySource = await c.query<{
        name: string;
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- base and cols are constants; values are bound parameters
        `SELECT COALESCE(s.name, 'Not given') AS name, ${cols} ${base.replace('LEFT JOIN applications a', 'LEFT JOIN admission_enquiry_sources s ON s.id = e.source_id LEFT JOIN applications a')}
          GROUP BY 1 ORDER BY 2 DESC`,
        params,
      );
      const byClass = await c.query<{
        name: string;
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- base and cols are constants; values are bound parameters
        `SELECT COALESCE(cl.name, 'Not given') AS name, ${cols} ${base.replace('LEFT JOIN applications a', 'LEFT JOIN classes cl ON cl.id = e.class_id LEFT JOIN applications a')}
          GROUP BY 1, cl.display_order ORDER BY cl.display_order NULLS LAST, 1`,
        params,
      );
      const total = await c.query<{
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- base and cols are constants; values are bound parameters
        `SELECT ${cols} ${base}`,
        params,
      );
      // registrations of the session that came with no enquiry: the other side of the funnel
      const direct = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM applications a WHERE a.application_no IS NOT NULL AND a.enquiry_id IS NULL AND ($1::bigint IS NULL OR a.cycle_id = $1::bigint)`,
        [q.cycleId ?? null],
      );
      const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : 0);
      const shape = (r: {
        name?: string;
        enquiries: number;
        open: number;
        registered: number;
        admitted: number;
        lost: number;
      }) => ({
        ...r,
        toRegistration: pct(r.registered, r.enquiries),
        toAdmission: pct(r.admitted, r.enquiries),
      });
      return {
        total: shape(total.rows[0]!),
        bySource: bySource.rows.map(shape),
        byClass: byClass.rows.map(shape),
        registeredWithoutEnquiry: direct.rows[0]?.n ?? 0,
      };
    });
  }
}
