import { Injectable, Logger } from '@nestjs/common';
import { QUEUES, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import {
  TEMPLATE_VARIABLES,
  resolveAudience,
  type AudienceInput,
  type AudienceRule,
  type Channel,
  type Recipient,
  type SendTo,
  type Skipped,
  type UploadRow,
} from './audience';
import { CommsSettingsService, type CommsPolicy } from './comms-settings.service';
import type { CreateRequestDto, ListRequestsQueryDto, RecipientSheetDto } from './comms.dto';
import { emailLayout, sanitizeEmailHtml } from './email-html';
import { parseMemberSheet } from './groups.service';
import { SAMPLE_VARIABLES } from './templates.service';
import {
  escapeHtml,
  extractVariables,
  htmlToText,
  renderLenient,
  smsUnits,
  textToHtml,
} from './render';

export interface RequestRow {
  id: string;
  title: string;
  category: 'service' | 'general';
  channel: string;
  channels: Array<{
    channel: Channel;
    templateId: string | null;
    custom?: boolean;
    templateName: string | null;
  }>;
  templateId: string | null;
  templateCode: string | null;
  body: string;
  bodyFormat: 'text' | 'html';
  subject: string | null;
  variables: Record<string, unknown>;
  audience: string;
  targets: Array<{ type: string; id: string }>;
  targetLabels: string[];
  rule: AudienceRule | null;
  uploadCount: number;
  sendTo: SendTo;
  attachments: Attachment[];
  needsApproval: boolean;
  status: string;
  scheduledAt: string | null;
  requestedBy: string | null;
  requestedAt: string;
  workflowInstanceId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  recipientsTotal: number;
  recipientsSkipped: number;
  dispatchedAt: string | null;
  delivery: Record<string, number>;
  deliveryByChannel: Record<string, Record<string, number>>;
}

export interface Attachment {
  fileId: string;
  name: string | null;
  contentType: string;
  size: number;
}

export interface TemplateLite {
  id: string;
  channel: Channel;
  name: string;
  subject: string | null;
  body: string;
  format: 'text' | 'html';
  wa_params: string[];
  status: string;
}

const SELECT = `SELECT r.id::text, r.title, r.category::text, r.channel::text, r.template_id::text, t.code AS template_code, r.body, r.body_format, r.subject, r.variables,
        r.audience::text, r.targets, r.rule, COALESCE(jsonb_array_length(r.upload), 0) AS upload_count, r.send_to, r.channels, r.attachments, r.needs_approval,
        r.status::text, r.scheduled_at, u.display_name AS requested_by, r.requested_at, r.workflow_instance_id::text, d.display_name AS decided_by, r.decided_at, r.decision_note,
        r.recipients_total, r.recipients_skipped, r.dispatched_at,
        COALESCE((SELECT jsonb_object_agg(s.k, s.n) FROM (SELECT m.channel::text || ':' || m.status::text AS k, count(*)::int AS n FROM comms_messages m WHERE m.message_request_id = r.id GROUP BY 1) s), '{}'::jsonb) AS delivery
   FROM message_requests r LEFT JOIN comms_templates t ON t.id = r.template_id LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users d ON d.id = r.decided_by`;

const ALLOWED_ATTACHMENTS = /^(application\/pdf|image\/(png|jpeg|webp))$/;

/**
 * Message requests (S10, v2 2026-10-02). Office staff compose once for SMS, WhatsApp and / or email to
 * an audience (everyone, students, employees, classes, sections, routes, a master-wise rule, groups,
 * individuals or an uploaded list), choosing who receives a student's message (primary contact,
 * parents, the student, or both). The approval rule decides whether the principal approves first
 * (above N recipients unless the sender holds an exempt role). Dispatch writes one message per channel
 * and address in batches, with SMS units and cost, quiet hours for general messages, attachments for
 * email and WhatsApp, and keeps every recipient decision (sent or skipped and why).
 */
@Injectable()
export class RequestsService {
  private readonly log = new Logger(RequestsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly settings: CommsSettingsService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  async list(ctx: RequestContext, q: ListRequestsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      let where = 'true';
      if (q.status) {
        params.push(q.status);
        where = `r.status = $1::message_request_status`;
      }
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- where is one of two fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM message_requests r WHERE ${where}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where is a fixed fragment; values are bound parameters
        `${SELECT} WHERE ${where} ORDER BY r.requested_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const rows = [];
      for (const x of r.rows) rows.push(await this.toRow(c, x));
      return {
        data: rows,
        page: { number: q.page, size: q.size, total: Number(total.rows[0]!.n) },
      };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.find(c, id);
      const rec = await c.query<{
        id: string;
        channel: string | null;
        name: string | null;
        address: string | null;
        student: string | null;
        skipped_reason: string | null;
        status: string | null;
        sent_at: Date | null;
        delivered_at: Date | null;
        read_at: Date | null;
        last_error: string | null;
      }>(
        `SELECT x.id::text, x.channel::text, x.name, x.address, s.display_name AS student, x.skipped_reason, m.status::text, m.sent_at, m.delivered_at, m.read_at, m.last_error
           FROM message_request_recipients x LEFT JOIN students s ON s.id = x.student_id LEFT JOIN comms_messages m ON m.id = x.message_id
          WHERE x.request_id = $1 ORDER BY x.name, x.channel LIMIT 2000`,
        [id],
      );
      return {
        ...row,
        recipients: rec.rows.map((y) => ({
          id: y.id,
          channel: y.channel,
          name: y.name,
          address: y.address ? mask(y.address) : null,
          student: y.student,
          skippedReason: y.skipped_reason,
          status: y.status,
          sentAt: y.sent_at ? y.sent_at.toISOString() : null,
          deliveredAt: y.delivered_at ? y.delivered_at.toISOString() : null,
          readAt: y.read_at ? y.read_at.toISOString() : null,
          lastError: y.last_error,
        })),
      };
    });
  }

  /**
   * An Excel list of recipients for compose: Admission No / Employee Code columns become individuals,
   * Name + Mobile / Email rows a one-time list (other columns become {{variables}}).
   */
  async readSheet(ctx: RequestContext, dto: RecipientSheetDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const parsed = await parseMemberSheet(c, dto, 'mixed');
      return {
        rows: parsed.rows,
        targets: parsed.people.map((p) => ({ type: p.type, id: p.id })),
        upload: parsed.contacts.map((x) => ({
          name: x.name,
          mobile: x.mobile,
          email: x.email,
          vars: x.extra,
        })),
        variables: [...new Set(parsed.contacts.flatMap((x) => Object.keys(x.extra)))],
        problems: parsed.problems,
      };
    });
  }

  async limits(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.settings.policy(c);
      return {
        attachmentMaxMb: p.attachmentMaxMb,
        quietFrom: p.quietFrom,
        quietTo: p.quietTo,
        approvalThreshold: p.approvalThreshold,
      };
    });
  }

  /** Counts recipients for a draft without saving anything (compose shows it before submitting). */
  async preview(ctx: RequestContext, dto: CreateRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const templates = await this.templates(c, dto);
      const policy = await this.settings.policy(c);
      await this.checkAttachments(c, dto.attachments, policy);
      const plan = await resolveAudience(c, this.input(ctx, dto, templates));
      const byChannel: Record<
        string,
        { send: number; skipped: number; units: number; cost: number }
      > = {};
      const school = await this.schoolName(c);
      for (const t of templates) {
        const send = plan.send.filter((r) => r.channel === t.channel);
        // units from the first recipient's rendered SMS; the others are close enough for an estimate
        const sample = send[0]
          ? this.render(t, send[0], dto, school).units
          : t.channel === 'sms'
            ? smsUnits(renderLenient(t.body, { body: dto.body, title: dto.title })).units
            : 1;
        byChannel[t.channel] = {
          send: send.length,
          skipped: plan.skipped.filter((r) => r.channel === t.channel).length,
          units: sample * send.length,
          cost: Number((sample * send.length * (policy.rates[t.channel] ?? 0)).toFixed(2)),
        };
      }
      const people = new Set(plan.send.map((r) => `${r.personType}:${r.personId ?? r.address}`))
        .size;
      const first = plan.send[0];
      return {
        total: plan.send.length,
        people,
        skipped: plan.skipped.length,
        skippedReasons: countBy(plan.skipped.map((s) => s.reason)),
        byChannel,
        needsApproval: await this.needsApproval(c, policy, plan.send.length),
        askValues: await this.askValues(c, templates, dto),
        switchedOff: (await this.settings.switchedOff(c)).filter((ch) =>
          templates.some((t) => t.channel === ch),
        ),
        quietHours: this.quietUntil(policy, dto)
          ? this.quietUntil(policy, dto)!.toISOString()
          : null,
        sample: plan.send.slice(0, 8).map((s) => ({
          channel: s.channel,
          name: s.name,
          address: mask(s.address),
          student: s.vars.student_name || null,
        })),
        rendered: first
          ? templates.map((t) => {
              const r = this.render(
                t,
                plan.send.find((x) => x.channel === t.channel) ?? first,
                dto,
                school,
              );
              return {
                channel: t.channel,
                subject: r.subject,
                text: r.format === 'html' ? htmlToText(r.body) : r.body,
                units: r.units,
              };
            })
          : [],
      };
    });
  }

  /**
   * "Send me a test first": the email exactly as the first recipient gets it (their values), sent to
   * the sender's own email with [Test] in the subject. Nothing is recorded on a request.
   */
  async testEmail(ctx: RequestContext, dto: CreateRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const templates = await this.templates(c, dto);
      const t = templates.find((x) => x.channel === 'email');
      if (!t)
        throw new DomainError('validation-failed', 'Tick Email to send yourself a test', {
          status: 400,
        });
      const me = await c.query<{ email: string | null }>(
        `SELECT COALESCE(NULLIF(u.email::text, ''), (SELECT e.email::text FROM employees e WHERE e.user_id = u.id AND e.email IS NOT NULL LIMIT 1)) AS email
           FROM users u WHERE u.id = app.current_user_id()`,
      );
      const to = me.rows[0]?.email;
      if (!to)
        throw new DomainError(
          'comms.test.no_email',
          'Your login has no email address; add one to your employee record or profile',
          { status: 409 },
        );
      const policy = await this.settings.policy(c);
      const attachments = await this.checkAttachments(c, dto.attachments, policy);
      const plan = await resolveAudience(c, {
        ...this.input(ctx, dto, templates),
        channels: ['email'],
      });
      const first = plan.send[0] ?? plan.skipped[0];
      const school = await this.schoolName(c);
      const out = this.render(
        t,
        { vars: first?.vars ?? { ...SAMPLE_VARIABLES, school } },
        { ...dto, body: dto.bodyFormat === 'html' ? sanitizeEmailHtml(dto.body) : dto.body },
        school,
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, variables, format, attachments, request_id, created_by)
         VALUES (app.current_school_id(), $1, 'email', app.current_user_id(), $2, $3, $4, '{}'::jsonb, $5, $6::jsonb, app.current_request_id(), app.current_user_id())
         RETURNING id::text`,
        [
          t.id || null,
          to,
          `[Test] ${out.subject ?? dto.title}`,
          out.body,
          out.format,
          JSON.stringify(attachments),
        ],
      );
      const tenant = requireTenant(ctx);
      await c.query(`SELECT app.enqueue_job($1, $2::jsonb)`, [
        QUEUES.notifications,
        JSON.stringify({
          schoolId: tenant.schoolId,
          userId: tenant.userId ?? null,
          requestId: ctx.requestId,
          kind: 'comms.message',
          payload: { messageId: r.rows[0]!.id },
        }),
      ]);
      return {
        to: mask(to),
        as: first ? first.name : 'sample values',
        messageId: r.rows[0]!.id,
      };
    });
  }

  async create(ctx: RequestContext, dto: CreateRequestDto): Promise<RequestRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const templates = await this.templates(c, dto);
      const policy = await this.settings.policy(c);
      const attachments = await this.checkAttachments(c, dto.attachments, policy);
      const off = (await this.settings.switchedOff(c)).filter((ch) =>
        templates.some((t) => t.channel === ch),
      );
      if (off.length)
        throw new DomainError(
          'comms.channel.off',
          `${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} switched off in Communication settings`,
          { status: 409 },
        );
      const plan = await resolveAudience(c, this.input(ctx, dto, templates));
      if (plan.send.length === 0)
        throw new DomainError('comms.request.no_recipients', 'Nobody would receive this message', {
          status: 409,
          extra: { skippedReasons: countBy(plan.skipped.map((s) => s.reason)) },
        });
      const needsApproval = await this.needsApproval(c, policy, plan.send.length);
      const body = dto.bodyFormat === 'html' ? sanitizeEmailHtml(dto.body) : dto.body;
      const r = await c.query<{ id: string }>(
        `INSERT INTO message_requests (school_id, title, category, channel, template_id, body, body_format, subject, variables, audience, targets, rule, upload, send_to,
                                       channels, attachments, needs_approval, status, scheduled_at, requested_by, recipients_total, recipients_skipped, request_id)
         VALUES (app.current_school_id(), $1, $2::message_category, $3::comms_channel, $4, $5, $6, $7, $8::jsonb, $9::message_audience, $10::jsonb, $11::jsonb, $12::jsonb, $13,
                 $14::jsonb, $15::jsonb, $16, $17::message_request_status, $18::timestamptz, app.current_user_id(), $19, $20, app.current_request_id()) RETURNING id::text`,
        [
          dto.title,
          dto.category,
          templates[0]!.channel,
          templates[0]!.id || null,
          body,
          dto.bodyFormat,
          dto.subject ?? null,
          JSON.stringify(dto.variables),
          dto.audience,
          JSON.stringify(dto.targets),
          dto.rule ? JSON.stringify(dto.rule) : null,
          dto.upload ? JSON.stringify(dto.upload) : null,
          dto.sendTo,
          JSON.stringify(
            templates.map((t) =>
              t.id
                ? { channel: t.channel, templateId: t.id }
                : { channel: t.channel, templateId: null, custom: true },
            ),
          ),
          JSON.stringify(attachments),
          needsApproval,
          needsApproval ? 'pending_approval' : 'approved',
          dto.scheduledAt ?? null,
          plan.send.length,
          plan.skipped.length,
        ],
      );
      const id = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'comms.request.create',
        entityType: 'message_requests',
        entityId: id,
        after: {
          title: dto.title,
          channels: templates.map((t) => t.channel),
          audience: dto.audience,
          sendTo: dto.sendTo,
          recipients: plan.send.length,
          skipped: plan.skipped.length,
          needsApproval,
        },
      });
      if (needsApproval) {
        const instance = await this.workflow.start(c, ctx, {
          definitionCode: 'message_approval',
          entityType: 'message_request',
          entityId: id,
          subject: `${dto.title} · ${templates.map((t) => t.channel).join(' + ')} · ${plan.send.length} recipients`,
          payload: {
            audience: dto.audience,
            channel: templates[0]!.channel,
            category: dto.category,
          },
        });
        await c.query(`UPDATE message_requests SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instance.id,
        ]);
      } else {
        await c.query(
          `UPDATE message_requests SET status = 'sending', decided_by = app.current_user_id(), decided_at = now(), decision_note = 'No approval needed', updated_at = now() WHERE id = $1`,
          [id],
        );
        await this.dispatch(c, ctx, id);
      }
      return this.find(c, id);
    });
  }

  async cancel(ctx: RequestContext, id: string): Promise<RequestRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!['pending_approval', 'approved'].includes(before.status))
        throw new DomainError(
          'comms.request.not_cancellable',
          `A ${before.status} request cannot be cancelled`,
          { status: 409 },
        );
      await c.query(
        `UPDATE message_requests SET status = 'cancelled', updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.request.cancel',
        entityType: 'message_requests',
        entityId: id,
        before: { status: before.status },
      });
      return this.find(c, id);
    });
  }

  /** Workflow completion: approval dispatches, rejection records the decision. Runs in the deciding transaction. */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const req = await c.query<{ status: string }>(
      `SELECT status::text FROM message_requests WHERE id = $1`,
      [instance.entityId],
    );
    if (req.rows[0]?.status !== 'pending_approval') return; // cancelled meanwhile
    const note =
      instance.steps
        .filter((s) => s.status !== 'pending')
        .map((s) => s.note)
        .filter(Boolean)
        .join(' · ') || null;
    if (outcome === 'rejected') {
      await c.query(
        `UPDATE message_requests SET status = 'rejected', decided_by = app.current_user_id(), decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
        [instance.entityId, note],
      );
      return;
    }
    await c.query(
      `UPDATE message_requests SET status = 'sending', decided_by = app.current_user_id(), decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
      [instance.entityId, note],
    );
    await this.dispatch(c, ctx, instance.entityId);
  }

  // ---- dispatch ---------------------------------------------------------------------------------
  private async dispatch(c: PoolClient, ctx: RequestContext, id: string): Promise<void> {
    const row = await this.find(c, id);
    const stored = await c.query<{ upload: UploadRow[] | null }>(
      `SELECT upload FROM message_requests WHERE id = $1`,
      [id],
    );
    const templates = [
      ...(await this.loadTemplates(
        c,
        row.channels.filter((x) => x.templateId).map((x) => x.templateId!),
      )),
      ...(row.channels.some((x) => x.custom) ? [this.ownEmail(row.subject ?? row.title)] : []),
    ];
    const policy = await this.settings.policy(c);
    const school = await this.schoolName(c);
    const dto = {
      title: row.title,
      body: row.body,
      bodyFormat: row.bodyFormat,
      subject: row.subject ?? undefined,
      variables: row.variables as Record<string, string | number | boolean>,
      category: row.category,
      scheduledAt: row.scheduledAt ?? undefined,
    };
    const plan = await resolveAudience(c, {
      yearId: this.year(ctx),
      audience: row.audience as AudienceInput['audience'],
      targets: row.targets,
      rule: row.rule,
      upload: stored.rows[0]?.upload ?? null,
      sendTo: row.sendTo,
      channels: templates.map((t) => t.channel),
      category: row.category,
    });
    const when = row.scheduledAt
      ? new Date(row.scheduledAt)
      : (this.quietUntil(policy, { category: row.category }) ?? new Date());
    await this.recordSkipped(c, id, plan.skipped);

    const tenant = requireTenant(ctx);
    const envelopeBase = {
      schoolId: tenant.schoolId,
      userId: tenant.userId ?? null,
      requestId: ctx.requestId,
      kind: 'comms.message',
    };
    const byChannel = new Map(templates.map((t) => [t.channel, t]));
    for (let i = 0; i < plan.send.length; i += 500) {
      const batch = plan.send.slice(i, i + 500);
      const rendered = batch.map((r) => ({
        r,
        out: this.render(byChannel.get(r.channel)!, r, dto, school),
      }));
      const ids = (
        await c.query<{ id: string }>(
          `SELECT nextval(pg_get_serial_sequence('comms_messages', 'id'))::text AS id FROM generate_series(1, $1)`,
          [batch.length],
        )
      ).rows.map((x) => x.id);
      await c.query(
        `INSERT INTO comms_messages (id, school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, variables, scheduled_at, request_id, created_by,
                                     message_request_id, format, units, cost, attachments, params)
         OVERRIDING SYSTEM VALUE
         SELECT x.id, app.current_school_id(), x.template_id, x.channel::comms_channel, x.user_id, x.address, x.subject, x.body, x.vars, $2::timestamptz, app.current_request_id(), app.current_user_id(),
                $3, x.format, x.units, x.cost, $4::jsonb, x.params
           FROM unnest($1::bigint[], $5::bigint[], $6::text[], $7::bigint[], $8::text[], $9::text[], $10::text[], $11::jsonb[], $12::text[], $13::int[], $14::numeric[], $15::jsonb[])
             AS x(id, template_id, channel, user_id, address, subject, body, vars, format, units, cost, params)`,
        [
          ids,
          when.toISOString(),
          id,
          JSON.stringify(row.attachments),
          rendered.map((x) => byChannel.get(x.r.channel)!.id || null),
          rendered.map((x) => x.r.channel),
          rendered.map((x) => x.r.userId),
          rendered.map((x) => x.r.address),
          rendered.map((x) => x.out.subject),
          rendered.map((x) => x.out.body),
          rendered.map((x) => JSON.stringify(x.r.vars)),
          rendered.map((x) => x.out.format),
          rendered.map((x) => x.out.units),
          rendered.map((x) => Number((x.out.units * (policy.rates[x.r.channel] ?? 0)).toFixed(4))),
          rendered.map((x) => (x.out.params ? JSON.stringify(x.out.params) : null)),
        ],
      );
      await c.query(
        `INSERT INTO message_request_recipients (school_id, request_id, channel, person_type, person_id, user_id, student_id, name, address, message_id)
         SELECT app.current_school_id(), $1, x.channel::comms_channel, x.person_type, x.person_id, x.user_id, x.student_id, x.name, x.address, x.message_id
           FROM unnest($2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7::text[], $8::text[], $9::bigint[])
             AS x(channel, person_type, person_id, user_id, student_id, name, address, message_id)`,
        [
          id,
          batch.map((r) => r.channel),
          batch.map((r) => r.personType),
          batch.map((r) => r.personId),
          batch.map((r) => r.userId),
          batch.map((r) => r.studentId),
          batch.map((r) => r.name),
          batch.map((r) => r.address),
          ids,
        ],
      );
      await c.query(
        `SELECT app.enqueue_job($4, $1::jsonb || jsonb_build_object('payload', jsonb_build_object('messageId', m.id::text)), $2::timestamptz)
           FROM unnest($3::bigint[]) AS m(id)`,
        [JSON.stringify(envelopeBase), when.toISOString(), ids, QUEUES.notifications],
      );
    }
    await c.query(
      `UPDATE message_requests SET status = 'sent', recipients_total = $2, recipients_skipped = $3, dispatched_at = now(), updated_at = now() WHERE id = $1`,
      [id, plan.send.length, plan.skipped.length],
    );
    this.log.log(
      { requestId: id, sent: plan.send.length, skipped: plan.skipped.length },
      'message request dispatched',
    );
  }

  private async recordSkipped(c: PoolClient, id: string, skipped: Skipped[]) {
    for (let i = 0; i < skipped.length; i += 1000) {
      const b = skipped.slice(i, i + 1000);
      await c.query(
        `INSERT INTO message_request_recipients (school_id, request_id, channel, person_type, person_id, user_id, student_id, name, address, skipped_reason)
         SELECT app.current_school_id(), $1, x.channel::comms_channel, x.person_type, x.person_id, x.user_id, x.student_id, x.name, x.address, x.reason
           FROM unnest($2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7::text[], $8::text[], $9::text[])
             AS x(channel, person_type, person_id, user_id, student_id, name, address, reason)`,
        [
          id,
          b.map((r) => r.channel),
          b.map((r) => r.personType),
          b.map((r) => r.personId),
          b.map((r) => r.userId),
          b.map((r) => r.studentId),
          b.map((r) => r.name),
          b.map((r) => r.address),
          b.map((r) => r.reason),
        ],
      );
    }
  }

  /**
   * One recipient's message on one channel. Email is HTML when the template or the composed text is
   * (values escaped, the school's frame around it); SMS and WhatsApp are plain text with units counted.
   */
  render(
    t: TemplateLite,
    r: Pick<Recipient, 'vars'>,
    dto: {
      title: string;
      body: string;
      bodyFormat?: 'text' | 'html';
      subject?: string;
      variables?: Record<string, unknown>;
    },
    school: string,
  ): {
    subject: string | null;
    body: string;
    format: 'text' | 'html';
    units: number;
    params: string[] | null;
  } {
    const composeHtml = dto.bodyFormat === 'html';
    const vars: Record<string, string> = {
      ...Object.fromEntries(Object.entries(dto.variables ?? {}).map(([k, v]) => [k, String(v)])),
      ...r.vars,
      title: dto.title,
      subject: dto.subject ?? dto.title,
    };
    // {{variables}} written in the compose text are filled too (escaped inside HTML)
    const own = composeHtml
      ? renderLenient(dto.body, vars, escapeHtml)
      : renderLenient(dto.body, vars);
    if (t.channel === 'email') {
      const html = t.format === 'html' || composeHtml;
      const subjectTpl = t.subject && t.subject.trim() ? t.subject : (dto.subject ?? dto.title);
      const subject = renderLenient(subjectTpl, { ...vars, body: '' });
      if (!html)
        return {
          subject,
          body: renderLenient(t.body, { ...vars, body: own }),
          format: 'text',
          units: 1,
          params: null,
        };
      const frame = t.format === 'html' ? t.body : textToHtml(t.body);
      const inner = renderLenient(
        frame.replace(/\{\{\s*body\s*\}\}/g, '\u0000BODY\u0000'),
        vars,
        escapeHtml,
      ).replace('\u0000BODY\u0000', composeHtml ? own : textToHtml(own));
      return {
        subject,
        body: emailLayout(escapeHtml(school), inner),
        format: 'html',
        units: 1,
        params: null,
      };
    }
    const text = composeHtml ? htmlToText(own) : own;
    const body = renderLenient(t.body, { ...vars, body: text });
    const params =
      t.channel === 'whatsapp'
        ? (t.wa_params ?? []).map((k) => (k === 'body' ? text : (vars[k] ?? '')))
        : null;
    return {
      subject: null,
      body,
      format: 'text',
      units: t.channel === 'sms' ? smsUnits(body).units : 1,
      params,
    };
  }

  // ---- helpers ----------------------------------------------------------------------------------
  /**
   * Variables the chosen templates use that nobody fills in: not built in, not computed, not a school
   * variable, not an Excel column. Compose asks for them once (the same value for everyone).
   */
  async askValues(
    c: PoolClient,
    templates: TemplateLite[],
    dto: { body: string; subject?: string; upload?: UploadRow[] | null },
  ): Promise<string[]> {
    const known = new Set([
      ...TEMPLATE_VARIABLES.map((v) => v.key),
      'subject',
      ...(await c.query<{ key: string }>(`SELECT key FROM comms_variables`)).rows.map((x) => x.key),
      ...(dto.upload ?? []).flatMap((r) => Object.keys(r.vars ?? {})),
    ]);
    const used = extractVariables(
      [
        ...templates.map(
          (t) =>
            `${t.subject ?? ''} ${t.body} ${(t.wa_params ?? []).map((p) => `{{${p}}}`).join(' ')}`,
        ),
        dto.body,
        dto.subject ?? '',
      ].join(' '),
    );
    return used.filter((v) => !known.has(v));
  }

  private input(
    ctx: RequestContext,
    dto: CreateRequestDto,
    templates: TemplateLite[],
  ): AudienceInput {
    return {
      yearId: this.year(ctx),
      audience: dto.audience,
      targets: dto.targets,
      rule: dto.rule ?? null,
      upload: dto.upload ?? null,
      sendTo: dto.sendTo,
      channels: templates.map((t) => t.channel),
      category: dto.category,
    };
  }

  private async schoolName(c: PoolClient): Promise<string> {
    const r = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    return r.rows[0]?.name ?? '';
  }

  /** Exempt roles never need approval; anyone else does above the threshold (0 = always). */
  private async needsApproval(c: PoolClient, policy: CommsPolicy, total: number): Promise<boolean> {
    if (policy.approvalThreshold > 0 && total <= policy.approvalThreshold) return false;
    if (!policy.approvalExemptRoles.length) return true;
    const r = await c.query(
      `SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
        WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) AND ro.code = ANY($1::text[]) LIMIT 1`,
      [policy.approvalExemptRoles],
    );
    return !r.rowCount;
  }

  /** General messages composed during quiet hours (India time) wait for the end of them. */
  private quietUntil(
    policy: CommsPolicy,
    dto: { category: string; scheduledAt?: string },
  ): Date | null {
    if (dto.category !== 'general' || dto.scheduledAt || !policy.quietFrom || !policy.quietTo)
      return null;
    const now = new Date();
    const ist = new Date(now.getTime() + 330 * 60_000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const [fh, fm] = policy.quietFrom.split(':').map(Number) as [number, number];
    const [th, tm] = policy.quietTo.split(':').map(Number) as [number, number];
    const from = fh * 60 + fm;
    const to = th * 60 + tm;
    const inQuiet = from < to ? mins >= from && mins < to : mins >= from || mins < to;
    if (!inQuiet) return null;
    const wait = (to - mins + 1440) % 1440;
    return new Date(now.getTime() + wait * 60_000);
  }

  private async checkAttachments(
    c: PoolClient,
    fileIds: string[],
    policy: CommsPolicy,
  ): Promise<Attachment[]> {
    if (!fileIds.length) return [];
    const r = await c.query<{
      id: string;
      original_name: string | null;
      content_type: string;
      size_bytes: string;
      status: string;
    }>(
      `SELECT id::text, original_name, content_type, size_bytes::text, status::text FROM files WHERE id = ANY($1::bigint[])`,
      [fileIds],
    );
    const out: Attachment[] = [];
    for (const id of fileIds) {
      const f = r.rows.find((x) => x.id === id);
      if (!f || f.status !== 'ready')
        throw new DomainError('comms.attachment.missing', 'An attachment is not uploaded yet', {
          status: 400,
        });
      if (!ALLOWED_ATTACHMENTS.test(f.content_type))
        throw new DomainError(
          'comms.attachment.type',
          'Attachments are PDF or images (PNG, JPEG, WebP)',
          { status: 400 },
        );
      if (Number(f.size_bytes) > policy.attachmentMaxMb * 1024 * 1024)
        throw new DomainError(
          'comms.attachment.size',
          `Each attachment can be at most ${String(policy.attachmentMaxMb)} MB`,
          { status: 400 },
        );
      out.push({
        fileId: f.id,
        name: f.original_name,
        contentType: f.content_type,
        size: Number(f.size_bytes),
      });
    }
    return out;
  }

  private async loadTemplates(c: PoolClient, ids: string[]): Promise<TemplateLite[]> {
    const r = await c.query<TemplateLite>(
      `SELECT id::text, channel::text AS channel, name, subject, body, format, wa_params, status::text FROM comms_templates WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [ids],
    );
    return ids
      .map((id) => r.rows.find((t) => t.id === id))
      .filter((t): t is TemplateLite => Boolean(t));
  }

  /** An email written in compose: no template, the subject and body come from the request. */
  private ownEmail(subject: string): TemplateLite {
    return {
      id: '',
      channel: 'email',
      name: 'Own email (no template)',
      subject,
      body: '{{body}}',
      format: 'html',
      wa_params: [],
      status: 'active',
    };
  }

  private async templates(c: PoolClient, dto: CreateRequestDto): Promise<TemplateLite[]> {
    const own = dto.channels?.find((w) => w.custom);
    if (own && !(dto.subject ?? '').trim())
      throw new DomainError('validation-failed', 'Write the email subject', { status: 400 });
    const wanted = (
      dto.channels?.length
        ? dto.channels.filter((w) => !w.custom)
        : [{ channel: null as Channel | null, templateId: dto.templateId! }]
    ) as Array<{ channel: Channel | null; templateId: string }>;
    const list = await this.loadTemplates(
      c,
      wanted.map((w) => w.templateId),
    );
    if (list.length !== wanted.length || list.some((t) => t.status !== 'active'))
      throw new DomainError(
        'comms.template.not_active',
        'The template does not exist or is inactive',
        { status: 409 },
      );
    for (const [i, t] of list.entries()) {
      if ((t.channel as string) === 'push')
        throw new DomainError(
          'comms.request.channel',
          'Message requests go out by SMS, WhatsApp or email',
          { status: 409 },
        );
      const w = wanted[i]!;
      if (w.channel && w.channel !== t.channel)
        throw new DomainError(
          'comms.request.channel',
          `The ${w.channel} template is a ${t.channel} template`,
          {
            status: 400,
          },
        );
    }
    if (own) list.push(this.ownEmail(dto.subject!.trim()));
    // the message box is filled only when a template has a {{body}} slot (or for an own email)
    const slot = /\{\{\s*body\s*\}\}/;
    const needsBody = list.filter(
      (t) => slot.test(`${t.subject ?? ''} ${t.body}`) || (t.wa_params ?? []).includes('body'),
    );
    if (needsBody.length && !dto.body.trim())
      throw new DomainError(
        'validation-failed',
        `Write the message: ${needsBody.map((t) => t.name).join(', ')} ${needsBody.length === 1 ? 'has' : 'have'} a place for it`,
        { status: 400 },
      );
    if (!list.length)
      throw new DomainError('validation-failed', 'Choose at least one channel', { status: 400 });
    if (new Set(list.map((t) => t.channel)).size !== list.length)
      throw new DomainError('comms.request.channel', 'One template per channel', { status: 400 });
    return list;
  }

  private async find(c: PoolClient, id: string): Promise<RequestRow> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<Record<string, unknown>>(`${SELECT} WHERE r.id = $1`, [id]);
    if (!r.rows[0])
      throw new DomainError('not-found', 'Message request not found', { status: 404 });
    return this.toRow(c, r.rows[0]);
  }

  private async toRow(c: PoolClient, x: Record<string, unknown>): Promise<RequestRow> {
    const targets = (x.targets as Array<{ type: string; id: string }>) ?? [];
    const labels: string[] = [];
    const LABEL: Record<string, string> = {
      class: `SELECT code AS label FROM classes WHERE id = $1`,
      class_section: `SELECT k.code || '-' || cs.name AS label FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
      route: `SELECT code || ' · ' || name AS label FROM transport_routes WHERE id = $1`,
      group: `SELECT name AS label FROM comms_groups WHERE id = $1`,
      student: `SELECT display_name || ' (' || admission_no || ')' AS label FROM students WHERE id = $1`,
      employee: `SELECT display_name || ' (' || employee_code || ')' AS label FROM employees WHERE id = $1`,
      guardian: `SELECT display_name AS label FROM guardians WHERE id = $1`,
      contact: `SELECT name AS label FROM comms_contacts WHERE id = $1`,
      user: `SELECT display_name AS label FROM users WHERE id = $1`,
    };
    for (const t of targets.slice(0, 20)) {
      const sql = LABEL[t.type];
      if (!sql) continue;
      const l = await c.query<{ label: string }>(sql, [t.id]);
      if (l.rows[0]) labels.push(l.rows[0].label);
    }
    if (targets.length > 20) labels.push(`and ${String(targets.length - 20)} more`);
    type Ch = { channel: Channel; templateId: string | null; custom?: boolean };
    const channels = ((x.channels as Ch[]) ?? []).length
      ? (x.channels as Ch[])
      : [{ channel: x.channel as Channel, templateId: (x.template_id as string) ?? null }];
    const names = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM comms_templates WHERE id = ANY($1::bigint[])`,
      [channels.map((ch) => ch.templateId).filter(Boolean)],
    );
    const raw = (x.delivery as Record<string, number>) ?? {};
    const delivery: Record<string, number> = {};
    const deliveryByChannel: Record<string, Record<string, number>> = {};
    for (const [k, n] of Object.entries(raw)) {
      const [ch, st] = k.split(':') as [string, string];
      delivery[st] = (delivery[st] ?? 0) + n;
      deliveryByChannel[ch] = { ...(deliveryByChannel[ch] ?? {}), [st]: n };
    }
    const d = (k: string) => (x[k] ? (x[k] as Date).toISOString() : null);
    return {
      id: x.id as string,
      title: x.title as string,
      category: x.category as 'service' | 'general',
      channel: x.channel as string,
      channels: channels.map((ch) => ({
        ...ch,
        templateName: ch.custom
          ? 'Own email (no template)'
          : (names.rows.find((n) => n.id === ch.templateId)?.name ?? null),
      })),
      templateId: (x.template_id as string) ?? null,
      templateCode: (x.template_code as string) ?? null,
      body: x.body as string,
      bodyFormat: (x.body_format as 'text' | 'html') ?? 'text',
      subject: (x.subject as string) ?? null,
      variables: (x.variables as Record<string, unknown>) ?? {},
      audience: x.audience as string,
      targets,
      targetLabels: labels,
      rule: (x.rule as AudienceRule) ?? null,
      uploadCount: Number(x.upload_count ?? 0),
      sendTo: (x.send_to as SendTo) ?? 'primary',
      attachments: (x.attachments as Attachment[]) ?? [],
      needsApproval: Boolean(x.needs_approval),
      status: x.status as string,
      scheduledAt: d('scheduled_at'),
      requestedBy: (x.requested_by as string) ?? null,
      requestedAt: d('requested_at')!,
      workflowInstanceId: (x.workflow_instance_id as string) ?? null,
      decidedBy: (x.decided_by as string) ?? null,
      decidedAt: d('decided_at'),
      decisionNote: (x.decision_note as string) ?? null,
      recipientsTotal: x.recipients_total as number,
      recipientsSkipped: x.recipients_skipped as number,
      dispatchedAt: d('dispatched_at'),
      delivery,
      deliveryByChannel,
    };
  }
}

const countBy = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
/** Masks a mobile or email for lists (the delivery log keeps the full value for those allowed to see it). */
export const mask = (address: string) =>
  address.includes('@')
    ? `${address.slice(0, 2)}***@${address.split('@')[1] ?? ''}`
    : `${'*'.repeat(Math.max(0, address.length - 4))}${address.slice(-4)}`;
