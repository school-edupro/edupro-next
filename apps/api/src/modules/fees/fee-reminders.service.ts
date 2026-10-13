import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { CreateRequestSchema, type CreateRequestDto } from '../comms/comms.dto';
import { RequestsService } from '../comms/requests.service';
import { FeeMisService } from './fee-mis.service';
import type { FeeReminderDto } from './fees.dto';

type Channel = 'sms' | 'whatsapp' | 'email';
interface Row {
  name: string;
  mobile: string | null;
  email: string | null;
  vars: Record<string, string>;
}

/**
 * Fee reminders to the parents of defaulters. The message is a template chosen for each channel, as on
 * Communication -> Compose, and it goes out through the same request engine: the same preview, the
 * same approval rule, the same delivery and the same record under Communication -> Requests. What this
 * adds is who is reached (father, mother, both or the contact marked for notices), each pupil's own
 * dues as the values of the template, a test to the sender and the seniors on copy, and one reminder a
 * day per pupil.
 */
@Injectable()
export class FeeRemindersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mis: FeeMisService,
    private readonly requests: RequestsService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private async ccIds(c: PoolClient): Promise<string[]> {
    const r = await c.query<{ v: unknown }>(`SELECT app.setting('fees.reminder_cc') AS v`);
    return Array.isArray(r.rows[0]?.v) ? (r.rows[0]!.v as unknown[]).map(String) : [];
  }

  private async people(c: PoolClient, employeeIds: string[]) {
    const r = await c.query<{
      id: string;
      name: string;
      designation: string | null;
      mobile: string | null;
      email: string | null;
    }>(
      `SELECT e.id::text, e.display_name AS name, e.designation, e.mobile, e.email::text AS email
         FROM employees e WHERE e.id = ANY($1::bigint[]) AND e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name`,
      [employeeIds],
    );
    return r.rows;
  }

  /** The templates to choose from, the staff who can be put on copy, and the copy list kept by the school. */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await c.query<{
        id: string;
        code: string;
        channel: Channel;
        name: string | null;
        body: string;
      }>(
        `SELECT id::text, code, channel::text AS channel, name, left(regexp_replace(body, '<[^>]+>', ' ', 'g'), 240) AS body
           FROM comms_templates WHERE deleted_at IS NULL AND status = 'active' AND channel IN ('sms', 'whatsapp', 'email')
          ORDER BY (code LIKE 'fee%') DESC, name, code`,
      );
      const staff = await c.query<{ id: string; name: string; designation: string | null }>(
        `SELECT e.id::text, e.display_name AS name, e.designation FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND (e.mobile IS NOT NULL OR e.email IS NOT NULL)
          ORDER BY e.display_name LIMIT 2000`,
      );
      return { templates: t.rows, staff: staff.rows, cc: await this.ccIds(c) };
    });
  }

  /** The school's usual copy list (the seniors who see each reminder run). */
  async saveCc(ctx: RequestContext, employeeIds: string[]) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = (await this.people(c, [...new Set(employeeIds)])).map((p) => p.id);
      await c.query(
        `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
          WHERE key = 'fees.reminder_cc' AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
      );
      await c.query(
        `DELETE FROM school_settings WHERE key = 'fees.reminder_cc' AND valid_from = CURRENT_DATE`,
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), 'fees.reminder_cc', $1::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
        [JSON.stringify(ids)],
      );
      return { cc: ids };
    });
  }

  /** Who gets the reminder and with which values: one row per parent reached. */
  private async plan(c: PoolClient, ctx: RequestContext, dto: FeeReminderDto) {
    const yearId = this.year(ctx);
    const { asOf, rows: list } = await this.mis.defaulterRows(
      c,
      yearId,
      {
        asOf: dto.asOf,
        classId: dto.classId,
        discountId: dto.discountId,
        minBalance: dto.minBalance,
        ledger: dto.ledger,
      },
      dto.studentIds?.length ? dto.studentIds : undefined,
    );
    const day = (v: string) => v.slice(0, 10).split('-').reverse().join('-');
    const needMobile = dto.channels.some((x) => x.channel !== 'email');
    const needEmail = dto.channels.some((x) => x.channel === 'email');
    const rows: Row[] = [];
    const pupils: Array<{ id: string; balance: number }> = [];
    let remindedToday = 0;
    let noContact = 0;
    let total = 0;
    for (const p of list) {
      if (p.reminded_today && !dto.again) {
        remindedToday += 1;
        continue;
      }
      const people = (
        dto.to === 'father'
          ? [[p.father, p.father_mobile, p.father_email]]
          : dto.to === 'mother'
            ? [[p.mother, p.mother_mobile, p.mother_email]]
            : dto.to === 'both'
              ? [
                  [p.father, p.father_mobile, p.father_email],
                  [p.mother, p.mother_mobile, p.mother_email],
                ]
              : [[p.contact, p.contact_mobile, p.contact_email]]
      ).filter(([, mobile, email]) => (needMobile && mobile) || (needEmail && email));
      if (people.length === 0) {
        noContact += 1;
        continue;
      }
      const amount = p.balance.toFixed(2);
      for (const [name, mobile, email] of people)
        rows.push({
          name: name ?? 'Parent',
          mobile: mobile ?? null,
          email: email ?? null,
          vars: {
            guardian_name: name ?? 'Parent',
            parent_name: name ?? 'Parent',
            name: name ?? 'Parent',
            student_name: p.student,
            admission_no: p.admission_no,
            class: p.class ?? '',
            section: p.class ?? '',
            amount,
            balance: amount,
            due_amount: amount,
            as_of: day(asOf),
            due_since: day(p.oldest_due),
            days_overdue: String(p.days_overdue),
            months: p.months ?? '',
            fee_month: p.months ?? '',
          },
        });
      pupils.push({ id: p.student_id, balance: p.balance });
      total += p.balance;
    }
    return { asOf, rows, pupils, total, remindedToday, noContact, listed: list.length };
  }

  private request(dto: FeeReminderDto, title: string, upload: Row[]): CreateRequestDto {
    return CreateRequestSchema.parse({
      title,
      // a due reminder is a service message: it does not wait on a consent for circulars
      category: 'service',
      channels: dto.channels,
      body: '',
      variables: dto.variables ?? {},
      audience: 'upload',
      upload,
      sendTo: 'primary',
      attachments: [],
    }) as CreateRequestDto;
  }

  /** What would go out: how many parents on each channel, the cost, the first message as it reads. */
  async preview(ctx: RequestContext, dto: FeeReminderDto) {
    const plan = await this.db.tenant(requireTenant(ctx), (c) => this.plan(c, ctx, dto));
    const base = {
      pupils: plan.pupils.length,
      listed: plan.listed,
      totalDue: plan.total.toFixed(2),
      remindedToday: plan.remindedToday,
      noContact: plan.noContact,
    };
    if (plan.rows.length === 0) return { ...base, message: null };
    return {
      ...base,
      message: await this.requests.preview(ctx, this.request(dto, 'Fee reminder', plan.rows)),
    };
  }

  /** The sender and the people on copy, as recipients carrying one pupil's values. */
  private async copies(
    c: PoolClient,
    ctx: RequestContext,
    dto: FeeReminderDto,
    vars: Record<string, string>,
    withMe: boolean,
  ): Promise<Row[]> {
    const out: Row[] = [];
    if (withMe) {
      const me = await c.query<{ name: string; mobile: string | null; email: string | null }>(
        `SELECT u.display_name AS name,
                COALESCE(NULLIF(u.mobile::text, ''), (SELECT e.mobile FROM employees e WHERE e.user_id = u.id AND e.mobile IS NOT NULL LIMIT 1)) AS mobile,
                COALESCE(NULLIF(u.email::text, ''), (SELECT e.email::text FROM employees e WHERE e.user_id = u.id AND e.email IS NOT NULL LIMIT 1)) AS email
           FROM users u WHERE u.id = $1`,
        [ctx.user.id],
      );
      if (me.rows[0])
        out.push({
          name: me.rows[0].name,
          mobile: me.rows[0].mobile,
          email: me.rows[0].email,
          vars,
        });
    }
    for (const p of await this.people(c, dto.cc ?? []))
      out.push({ name: p.name, mobile: p.mobile, email: p.email, vars });
    // one person, one copy: the sender may also be on the copy list
    const seen = new Set<string>();
    return out.filter((r) => {
      const k = `${r.mobile ?? ''}|${r.email ?? ''}`;
      if ((!r.mobile && !r.email) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** A test: the first reminder exactly as its parent would get it, sent to the sender and those on copy. */
  async test(ctx: RequestContext, dto: FeeReminderDto) {
    const { rows } = await this.db.tenant(requireTenant(ctx), async (c) => {
      const plan = await this.plan(c, ctx, { ...dto, again: true });
      const first = plan.rows[0];
      if (!first)
        throw new DomainError(
          'fees.reminder_nobody',
          'Nobody in the list can be reached on the channels chosen',
          { status: 409 },
        );
      return { rows: await this.copies(c, ctx, dto, first.vars, true) };
    });
    if (rows.length === 0)
      throw new DomainError(
        'fees.reminder_no_test_address',
        'Your login has no mobile number or email to send the test to',
        { status: 409 },
      );
    const made = await this.requests.create(ctx, this.request(dto, '[Test] Fee reminder', rows));
    return { requestId: made.id, status: made.status, to: rows.map((r) => r.name) };
  }

  /**
   * The reminders go out (or wait for approval where the school's message rule asks for it). Each
   * senior on copy gets the first reminder once, and an email with the summary of the run.
   */
  async send(ctx: RequestContext, dto: FeeReminderDto) {
    const tenant = requireTenant(ctx);
    const prepared = await this.db.tenant(tenant, async (c) => {
      const plan = await this.plan(c, ctx, dto);
      if (plan.rows.length === 0)
        throw new DomainError(
          'fees.reminder_nobody',
          plan.remindedToday > 0
            ? 'Everyone in the list has already been reminded today'
            : 'Nobody in the list can be reached on the channels chosen',
          { status: 409 },
        );
      const copies = await this.copies(c, ctx, dto, plan.rows[0]!.vars, false);
      const who = await c.query<{ name: string }>(
        `SELECT display_name AS name FROM users WHERE id = $1`,
        [ctx.user.id],
      );
      return { plan, copies, sender: who.rows[0]?.name ?? '' };
    });
    const { plan, copies, sender } = prepared;
    const title = `Fee reminder · ${String(plan.pupils.length)} pupil${plan.pupils.length === 1 ? '' : 's'} · Rs. ${plan.total.toFixed(2)}`;
    const made = await this.requests.create(
      ctx,
      this.request(dto, title, [...plan.rows, ...copies]),
    );
    // the seniors also get the summary of the run, by email (an SMS or WhatsApp template has fixed words)
    const mailTo = copies.filter((x) => x.email);
    let summaryId: string | null = null;
    if (mailTo.length > 0) {
      const summary = await this.requests.create(
        ctx,
        CreateRequestSchema.parse({
          title: `Fee reminder sent: ${String(plan.pupils.length)} pupils`,
          category: 'service',
          channels: [{ channel: 'email', custom: true }],
          subject: `Fee reminder sent to ${String(plan.rows.length)} parent(s) of ${String(plan.pupils.length)} pupil(s)`,
          body: [
            `A fee reminder was sent by ${sender}.`,
            `Pupils: ${String(plan.pupils.length)}. Parents reached: ${String(plan.rows.length)}.`,
            `Total overdue: Rs. ${plan.total.toFixed(2)}, as on ${plan.asOf.split('-').reverse().join('-')}.`,
            `Channels: ${dto.channels.map((x) => x.channel).join(', ')}.`,
            plan.remindedToday > 0
              ? `Left out, already reminded today: ${String(plan.remindedToday)}.`
              : '',
            plan.noContact > 0 ? `Left out, no contact to reach: ${String(plan.noContact)}.` : '',
            'You also receive the first reminder once, as its parent sees it.',
          ]
            .filter(Boolean)
            .join('\n'),
          bodyFormat: 'text',
          audience: 'upload',
          upload: mailTo.map((x) => ({ name: x.name, email: x.email, mobile: null })),
          sendTo: 'primary',
          attachments: [],
        }) as CreateRequestDto,
      );
      summaryId = summary.id;
    }
    await this.db.tenant(tenant, async (c) => {
      for (const p of plan.pupils)
        await c.query(
          `INSERT INTO fee_reminders (school_id, student_id, balance, channel, sent_by)
           VALUES (app.current_school_id(), $1, $2, $3::comms_channel, app.current_user_id())
           ON CONFLICT (student_id, sent_on) DO NOTHING`,
          [p.id, p.balance.toFixed(2), dto.channels[0]!.channel],
        );
      await this.audit.stage(ctx, c, {
        action: 'fees.defaulter.remind',
        entityType: 'message_requests',
        entityId: made.id,
        after: {
          pupils: plan.pupils.length,
          parents: plan.rows.length,
          totalDue: plan.total.toFixed(2),
          channels: dto.channels.map((x) => x.channel),
          to: dto.to,
          copies: copies.length,
          summaryRequestId: summaryId,
        },
      });
    });
    return {
      requestId: made.id,
      status: made.status,
      pupils: plan.pupils.length,
      parents: plan.rows.length,
      copies: copies.length,
      totalDue: plan.total.toFixed(2),
      remindedToday: plan.remindedToday,
      noContact: plan.noContact,
    };
  }
}
