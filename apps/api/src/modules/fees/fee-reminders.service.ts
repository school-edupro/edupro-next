import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { ENV, type Env } from '../../config/env';
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
 * day per pupil on each channel.
 */
@Injectable()
export class FeeRemindersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mis: FeeMisService,
    private readonly requests: RequestsService,
    @Inject(ENV) private readonly env: Env,
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
      // the misc fee announcement and reminder are there for a school made after they were added
      await c.query(`SELECT app.misc_fee_seed_templates(app.current_school_id())`);
      const t = await c.query<{
        id: string;
        code: string;
        channel: Channel;
        name: string | null;
        body: string;
      }>(
        `SELECT id::text, code, channel::text AS channel, name, left(regexp_replace(body, '<[^>]+>', ' ', 'g'), 240) AS body
           FROM comms_templates WHERE deleted_at IS NULL AND status = 'active' AND channel IN ('sms', 'whatsapp', 'email')
            -- WhatsApp delivers only a template approved by Meta: one without its approved name would fail for every parent
            AND (channel <> 'whatsapp' OR NULLIF(btrim(wa_template_name), '') IS NOT NULL)
          ORDER BY (code LIKE 'fee%') DESC, name, code`,
      );
      const waiting = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_templates WHERE deleted_at IS NULL AND status = 'active' AND channel = 'whatsapp'
            AND NULLIF(btrim(wa_template_name), '') IS NULL`,
      );
      const staff = await c.query<{ id: string; name: string; designation: string | null }>(
        `SELECT e.id::text, e.display_name AS name, e.designation FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND (e.mobile IS NOT NULL OR e.email IS NOT NULL)
          ORDER BY e.display_name LIMIT 2000`,
      );
      return {
        templates: t.rows,
        staff: staff.rows,
        cc: await this.ccIds(c),
        whatsappNotApproved: waiting.rows[0]!.n,
      };
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
    if (dto.misc) return this.miscPlan(c, yearId, dto);
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
    const pupils: Array<{ id: string; balance: number; miscFeeId?: string }> = [];
    let remindedToday = 0;
    let noContact = 0;
    let total = 0;
    for (const p of list) {
      // once a day on each channel: an email this morning does not stop an SMS now
      if (!dto.again && dto.channels.some((x) => p.reminded_channels.includes(x.channel))) {
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
      const inr = p.balance.toLocaleString('en-IN');
      for (const [name, mobile, email] of people)
        rows.push({
          name: name ?? 'Parent',
          mobile: mobile ?? null,
          email: email ?? null,
          vars: {
            // the blanks Communication fills for a student by itself, so any of the school's templates
            // reads the same here as when it is sent from Compose
            recipient_name: name ?? 'Parent',
            guardian_name: name ?? 'Parent',
            father_name: p.father ?? '',
            mother_name: p.mother ?? '',
            student_name: p.student,
            admission_no: p.admission_no,
            class: p.class ?? '',
            class_name: p.class_name ?? '',
            section: p.section_name ?? '',
            roll_no: p.roll_no ?? '',
            fee_due: inr,
            fee_due_heads: p.heads ?? '',
            last_paid_amount:
              p.last_paid_amount === null ? '' : p.last_paid_amount.toLocaleString('en-IN'),
            last_paid_date: p.last_paid_on ? day(p.last_paid_on) : '',
            date: day(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString()),
            // and the ones a fee reminder adds
            parent_name: name ?? 'Parent',
            name: name ?? 'Parent',
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

  /**
   * The same for announced misc fees: a message for each pupil's fee, to everyone on it (the
   * announcement) or to those who still have to pay. A paid, closed or full fee is not asked for.
   */
  private async miscPlan(c: PoolClient, yearId: string, dto: FeeReminderDto) {
    const m = dto.misc!;
    const all = await this.mis.miscDueRows(
      c,
      yearId,
      {
        miscFeeId: m.miscFeeId,
        headId: m.headId,
        classId: dto.classId,
        pay: m.pay === 'all' ? undefined : m.pay,
      },
      m.lineIds?.length ? m.lineIds : undefined,
    );
    const list = all.filter(
      (p) => m.pay === 'all' || ['Unpaid', 'Overdue', 'Part paid'].includes(p.state),
    );
    const day = (v: string) => v.slice(0, 10).split('-').reverse().join('-');
    const asOf = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const needMobile = dto.channels.some((x) => x.channel !== 'email');
    const needEmail = dto.channels.some((x) => x.channel === 'email');
    const rows: Row[] = [];
    const pupils: Array<{ id: string; balance: number; miscFeeId?: string }> = [];
    let remindedToday = 0;
    let noContact = 0;
    let total = 0;
    for (const p of list) {
      if (!dto.again && dto.channels.some((x) => p.reminded_channels.includes(x.channel))) {
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
      const inr = p.balance.toLocaleString('en-IN');
      for (const [name, mobile, email] of people)
        rows.push({
          name: name ?? 'Parent',
          mobile: mobile ?? null,
          email: email ?? null,
          vars: {
            recipient_name: name ?? 'Parent',
            guardian_name: name ?? 'Parent',
            parent_name: name ?? 'Parent',
            name: name ?? 'Parent',
            father_name: p.father ?? '',
            mother_name: p.mother ?? '',
            student_name: p.student,
            admission_no: p.admission_no,
            class: p.class ?? '',
            class_name: p.class_name ?? '',
            section: p.section_name ?? '',
            roll_no: p.roll_no ?? '',
            // the fee's own words, and the names a fee reminder template already uses
            fee_name: p.fee,
            portal_link: `${this.env.PARENT_APP_URL}/fees`,
            misc_fee: p.fee,
            fee_head: p.head,
            fee_due_heads: p.fee,
            fee_amount: p.amount.toLocaleString('en-IN'),
            fee_due: inr,
            amount,
            balance: amount,
            due_amount: amount,
            last_date: day(p.last_date),
            due_date: day(p.last_date),
            mandatory: p.mandatory ? 'Mandatory' : 'Optional',
            seats: p.seats === null ? '' : String(p.seats),
            last_paid_amount: p.paid ? p.paid.toLocaleString('en-IN') : '',
            last_paid_date: p.last_paid_on ? day(p.last_paid_on) : '',
            date: day(asOf),
            as_of: day(asOf),
            due_since: day(p.last_date),
            days_overdue: '',
            months: p.fee,
            fee_month: p.fee,
          },
        });
      pupils.push({ id: p.student_id, balance: p.balance, miscFeeId: p.fee_id });
      total += p.balance;
    }
    return { asOf, rows, pupils, total, remindedToday, noContact, listed: list.length };
  }

  /** A WhatsApp template without its approved name cannot be delivered: say so before anything is queued. */
  private async assertWhatsappReady(c: PoolClient, dto: FeeReminderDto) {
    const wa = dto.channels.find((x) => x.channel === 'whatsapp');
    if (!wa) return;
    const t = await c.query<{ name: string | null; wa: string | null; noParams: boolean }>(
      `SELECT COALESCE(name, code) AS name, NULLIF(btrim(wa_template_name), '') AS wa,
              body LIKE '%{{%' AND jsonb_array_length(COALESCE(to_jsonb(wa_params), '[]'::jsonb)) = 0 AS "noParams"
         FROM comms_templates WHERE id = $1`,
      [wa.templateId],
    );
    if (t.rows[0] && !t.rows[0].wa)
      throw new DomainError(
        'fees.reminder_whatsapp_not_approved',
        `The WhatsApp template "${t.rows[0].name ?? ''}" has no approved template name, so WhatsApp would refuse it. Choose an approved template, or add the approved name under Communication → Templates.`,
        { status: 409 },
      );
    // Meta fills its numbered blanks from the parameters, in its own order: none set, and it refuses
    if (t.rows[0]?.noParams)
      throw new DomainError(
        'fees.reminder_whatsapp_no_params',
        `The WhatsApp template "${t.rows[0].name ?? ''}" has blanks but no "Parameters in Meta's order", so WhatsApp would refuse it. Set them under Communication → Templates, in the order of the approved template ({{1}}, {{2}}, …).`,
        { status: 409 },
      );
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
      message: await this.requests.preview(
        ctx,
        this.request(dto, dto.misc ? 'Misc fee message' : 'Fee reminder', plan.rows),
      ),
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
      await this.assertWhatsappReady(c, dto);
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
    const made = await this.requests.create(
      ctx,
      this.request(dto, dto.misc ? '[Test] Misc fee message' : '[Test] Fee reminder', rows),
    );
    return { requestId: made.id, status: made.status, to: rows.map((r) => r.name) };
  }

  /**
   * The reminders go out (or wait for approval where the school's message rule asks for it). Each
   * senior on copy gets the first reminder once, and an email with the summary of the run.
   */
  async send(ctx: RequestContext, dto: FeeReminderDto) {
    const tenant = requireTenant(ctx);
    const prepared = await this.db.tenant(tenant, async (c) => {
      await this.assertWhatsappReady(c, dto);
      const plan = await this.plan(c, ctx, dto);
      if (plan.rows.length === 0)
        throw new DomainError(
          'fees.reminder_nobody',
          plan.remindedToday > 0
            ? 'Everyone in the list has already been reminded today on this channel; tick "remind again" to send it once more'
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
    const title = `${dto.misc ? (dto.misc.pay === 'all' ? 'Misc fee announcement' : 'Misc fee reminder') : 'Fee reminder'} · ${String(plan.pupils.length)} pupil${plan.pupils.length === 1 ? '' : 's'} · Rs. ${plan.total.toFixed(2)}`;
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
        for (const ch of dto.channels)
          await c.query(
            `INSERT INTO fee_reminders (school_id, student_id, balance, channel, sent_by, misc_fee_id)
             VALUES (app.current_school_id(), $1, $2, $3::comms_channel, app.current_user_id(), $4)
             ON CONFLICT DO NOTHING`,
            [p.id, p.balance.toFixed(2), ch.channel, p.miscFeeId ?? null],
          );
      await this.audit.stage(ctx, c, {
        action: dto.misc ? 'fees.misc.remind' : 'fees.defaulter.remind',
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
