import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import type { CreateRequestDto, ListRequestsQueryDto, SendMessageDto } from './comms.dto';
import { MessagesService } from './messages.service';

export interface RequestRow {
  id: string;
  title: string;
  category: 'service' | 'general';
  channel: string;
  templateId: string;
  templateCode: string | null;
  body: string;
  variables: Record<string, unknown>;
  audience: string;
  targets: Array<{ type: string; id: string }>;
  targetLabels: string[];
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
}

interface Candidate {
  userId: string | null;
  studentId: string | null;
  name: string;
  address: string | null;
  section: string | null;
  studentName: string | null;
}

const SELECT = `SELECT r.id::text, r.title, r.category::text, r.channel::text, r.template_id::text, t.code AS template_code, r.body, r.variables, r.audience::text, r.targets,
        r.status::text, r.scheduled_at, u.display_name AS requested_by, r.requested_at, r.workflow_instance_id::text, d.display_name AS decided_by, r.decided_at, r.decision_note,
        r.recipients_total, r.recipients_skipped, r.dispatched_at,
        COALESCE((SELECT jsonb_object_agg(s.status, s.n) FROM (SELECT m.status::text AS status, count(*)::int AS n FROM message_request_recipients x JOIN comms_messages m ON m.id = x.message_id WHERE x.request_id = r.id GROUP BY m.status) s), '{}'::jsonb) AS delivery
   FROM message_requests r LEFT JOIN comms_templates t ON t.id = r.template_id LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users d ON d.id = r.decided_by`;

/**
 * Message requests (S10): staff compose to an audience, the principal approves through the workflow engine
 * (`message_approval`), and approval dispatches one message per recipient through the delivery log with
 * consent applied to general messages. Every recipient decision (sent or skipped and why) is kept.
 */
@Injectable()
export class RequestsService {
  private readonly log = new Logger(RequestsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly messages: MessagesService,
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
        name: string | null;
        address: string | null;
        student: string | null;
        skipped_reason: string | null;
        status: string | null;
        sent_at: Date | null;
        last_error: string | null;
      }>(
        `SELECT x.id::text, x.name, x.address, s.display_name AS student, x.skipped_reason, m.status::text, m.sent_at, m.last_error
           FROM message_request_recipients x LEFT JOIN students s ON s.id = x.student_id LEFT JOIN comms_messages m ON m.id = x.message_id
          WHERE x.request_id = $1 ORDER BY x.name LIMIT 1000`,
        [id],
      );
      return {
        ...row,
        recipients: rec.rows.map((y) => ({
          id: y.id,
          name: y.name,
          address: y.address ? mask(y.address) : null,
          student: y.student,
          skippedReason: y.skipped_reason,
          status: y.status,
          sentAt: y.sent_at ? y.sent_at.toISOString() : null,
          lastError: y.last_error,
        })),
      };
    });
  }

  /** Counts recipients for a draft without saving anything (the compose screen shows it before submitting). */
  async preview(ctx: RequestContext, dto: CreateRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const template = await this.template(c, dto.templateId);
      const plan = await this.plan(
        c,
        this.year(ctx),
        dto.audience,
        dto.targets,
        template.channel,
        dto.category,
      );
      return {
        total: plan.send.length,
        skipped: plan.skipped.length,
        skippedReasons: countBy(plan.skipped.map((s) => s.reason)),
        sample: plan.send
          .slice(0, 5)
          .map((s) => ({ name: s.name, address: mask(s.address!), student: s.studentName })),
      };
    });
  }

  async create(ctx: RequestContext, dto: CreateRequestDto): Promise<RequestRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const template = await this.template(c, dto.templateId);
      const plan = await this.plan(
        c,
        this.year(ctx),
        dto.audience,
        dto.targets,
        template.channel,
        dto.category,
      );
      if (plan.send.length === 0)
        throw new DomainError('comms.request.no_recipients', 'Nobody would receive this message', {
          status: 409,
          extra: { skippedReasons: countBy(plan.skipped.map((s) => s.reason)) },
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO message_requests (school_id, title, category, channel, template_id, body, variables, audience, targets, status, scheduled_at, requested_by, recipients_total, recipients_skipped, request_id)
         VALUES (app.current_school_id(), $1, $2::message_category, $3::comms_channel, $4, $5, $6::jsonb, $7::message_audience, $8::jsonb, 'pending_approval', $9::timestamptz, app.current_user_id(), $10, $11, app.current_request_id()) RETURNING id::text`,
        [
          dto.title,
          dto.category,
          template.channel,
          dto.templateId,
          dto.body,
          JSON.stringify(dto.variables),
          dto.audience,
          JSON.stringify(dto.targets),
          dto.scheduledAt ?? null,
          plan.send.length,
          plan.skipped.length,
        ],
      );
      const id = r.rows[0]!.id;
      const instance = await this.workflow.start(c, ctx, {
        definitionCode: 'message_approval',
        entityType: 'message_request',
        entityId: id,
        subject: `${dto.title} · ${template.channel} · ${plan.send.length} recipients`,
        payload: { audience: dto.audience, channel: template.channel, category: dto.category },
      });
      await c.query(`UPDATE message_requests SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instance.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'comms.request.create',
        entityType: 'message_requests',
        entityId: id,
        after: {
          title: dto.title,
          channel: template.channel,
          audience: dto.audience,
          recipients: plan.send.length,
          skipped: plan.skipped.length,
        },
      });
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

  private async dispatch(c: PoolClient, ctx: RequestContext, id: string): Promise<void> {
    const row = await this.find(c, id);
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    const plan = await this.plan(
      c,
      this.year(ctx),
      row.audience as CreateRequestDto['audience'],
      row.targets as CreateRequestDto['targets'],
      row.channel as 'sms' | 'whatsapp' | 'email' | 'push',
      row.category,
    );
    for (const s of plan.skipped)
      await c.query(
        `INSERT INTO message_request_recipients (school_id, request_id, user_id, student_id, name, address, skipped_reason) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
        [id, s.userId, s.studentId, s.name, s.address, s.reason],
      );
    let sent = 0;
    for (const r of plan.send) {
      const variables: Record<string, string | number | boolean> = {
        ...(row.variables as Record<string, string | number | boolean>),
        title: row.title,
        body: row.body,
        school: school.rows[0]?.name ?? '',
        recipient_name: r.name,
        guardian_name: r.name,
        student_name: r.studentName ?? '',
        class: r.section ?? '',
      };
      const message = await this.messages.sendWith(c, ctx, {
        templateId: row.templateId,
        recipientUserId: r.userId ?? undefined,
        recipientAddress: r.address!,
        variables,
        scheduledAt: row.scheduledAt ?? undefined,
      } as SendMessageDto);
      await c.query(
        `INSERT INTO message_request_recipients (school_id, request_id, user_id, student_id, name, address, message_id) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
        [id, r.userId, r.studentId, r.name, r.address, message.id],
      );
      sent++;
    }
    await c.query(
      `UPDATE message_requests SET status = 'sent', recipients_total = $2, recipients_skipped = $3, dispatched_at = now(), updated_at = now() WHERE id = $1`,
      [id, sent, plan.skipped.length],
    );
    this.log.log(
      { requestId: id, sent, skipped: plan.skipped.length },
      'message request dispatched',
    );
  }

  // ---- audience expansion -------------------------------------------------------------------------
  private async plan(
    c: PoolClient,
    yearId: string,
    audience: CreateRequestDto['audience'],
    targets: CreateRequestDto['targets'],
    channel: string,
    category: 'service' | 'general',
  ): Promise<{ send: Candidate[]; skipped: Array<Candidate & { reason: string }> }> {
    const ids = (type: string) => targets.filter((t) => t.type === type).map((t) => t.id);
    const addr = channel === 'email' ? 'email' : 'mobile';
    const candidates: Candidate[] = [];
    const guardiansOf = async (filter: string, params: unknown[]) => {
      params = [...params, yearId];
      const r = await c.query<Candidate>(
        // eslint-disable-next-line no-restricted-syntax -- addr is one of two column names; filter is a fixed fragment chosen by the audience; values are bound parameters
        `SELECT DISTINCT ON (s.id) g.user_id::text AS "userId", s.id::text AS "studentId", g.display_name AS name, g.${addr} AS address, k.code || '-' || cs.name AS section, s.display_name AS "studentName"
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL AND s.status = 'active'
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
           JOIN student_guardians sg ON sg.student_id = s.id AND sg.receives_notifications
           JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
          WHERE e.academic_year_id = $${params.length}::bigint AND e.status = 'active' AND ${filter}
          ORDER BY s.id, sg.is_primary DESC, g.id`,
        params,
      );
      candidates.push(...r.rows);
    };
    const employees = async () => {
      const r = await c.query<Candidate>(
        // eslint-disable-next-line no-restricted-syntax -- addr is one of two column names
        `SELECT e.user_id::text AS "userId", NULL::text AS "studentId", e.display_name AS name, e.${addr} AS address, NULL::text AS section, NULL::text AS "studentName"
           FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name`,
      );
      candidates.push(...r.rows);
    };
    const users = async (filter: string, params: unknown[]) => {
      const r = await c.query<Candidate>(
        // eslint-disable-next-line no-restricted-syntax -- addr is one of two column names; filter is a fixed fragment; values are bound parameters
        `SELECT u.id::text AS "userId", NULL::text AS "studentId", u.display_name AS name, u.${addr} AS address, NULL::text AS section, NULL::text AS "studentName"
           FROM users u JOIN user_school_memberships m ON m.user_id = u.id AND m.school_id = app.current_school_id() AND m.deleted_at IS NULL
          WHERE u.deleted_at IS NULL AND ${filter} ORDER BY u.display_name`,
        params,
      );
      candidates.push(...r.rows);
    };
    switch (audience) {
      case 'everyone':
        await guardiansOf('true', []);
        await employees();
        break;
      case 'students':
        await guardiansOf('true', []);
        break;
      case 'employees':
        await employees();
        break;
      case 'class':
        await guardiansOf('k.id = ANY($1::bigint[])', [ids('class')]);
        break;
      case 'class_section':
        await guardiansOf('cs.id = ANY($1::bigint[])', [ids('class_section')]);
        break;
      case 'route':
        await guardiansOf(
          'EXISTS (SELECT 1 FROM student_route_assignments ra WHERE ra.student_id = s.id AND ra.academic_year_id = e.academic_year_id AND ra.route_id = ANY($1::bigint[]))',
          [ids('route')],
        );
        break;
      case 'group':
        await users(
          'EXISTS (SELECT 1 FROM comms_group_members gm WHERE gm.user_id = u.id AND gm.group_id = ANY($1::bigint[]))',
          [ids('group')],
        );
        break;
      case 'individuals':
        await users('u.id = ANY($1::bigint[])', [ids('user')]);
        break;
    }
    // guardians without a login cannot be matched to a membership; only pass user ids that are members
    const members = new Set(
      (
        await c.query<{ id: string }>(
          `SELECT m.user_id::text AS id FROM user_school_memberships m WHERE m.school_id = app.current_school_id() AND m.deleted_at IS NULL`,
        )
      ).rows.map((x) => x.id),
    );
    const withdrawn = new Set<string>();
    if (category === 'general') {
      const purpose = `comms.${channel}`;
      const w = await c.query<{ id: string }>(
        `SELECT DISTINCT x.user_id::text AS id FROM consents x WHERE x.purpose_code = $1 AND x.status = (SELECT status FROM consents y WHERE y.user_id = x.user_id AND y.purpose_code = $1 ORDER BY y.recorded_at DESC, y.id DESC LIMIT 1) AND x.status = 'withdrawn'`,
        [purpose],
      );
      for (const x of w.rows) withdrawn.add(x.id);
    }
    const seen = new Set<string>();
    const send: Candidate[] = [];
    const skipped: Array<Candidate & { reason: string }> = [];
    for (const cand of candidates) {
      const item: Candidate = {
        ...cand,
        userId: cand.userId && members.has(cand.userId) ? cand.userId : null,
      };
      if (!item.address) skipped.push({ ...item, reason: 'no_address' });
      else if (cand.userId && withdrawn.has(cand.userId))
        skipped.push({ ...item, reason: 'consent_withdrawn' });
      else if (seen.has(item.address)) skipped.push({ ...item, reason: 'duplicate' });
      else {
        seen.add(item.address);
        send.push(item);
      }
    }
    return { send, skipped };
  }

  private async template(
    c: PoolClient,
    id: string,
  ): Promise<{ id: string; channel: 'sms' | 'whatsapp' | 'email' | 'push' }> {
    const t = await c.query<{
      id: string;
      channel: 'sms' | 'whatsapp' | 'email' | 'push';
      status: string;
    }>(
      `SELECT id::text, channel::text AS channel, status::text FROM comms_templates WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!t.rows[0] || t.rows[0].status !== 'active')
      throw new DomainError(
        'comms.template.not_active',
        'The template does not exist or is inactive',
        { status: 409 },
      );
    if (t.rows[0].channel === 'push')
      throw new DomainError(
        'comms.request.channel',
        'Message requests go out by SMS, WhatsApp or email',
        { status: 409 },
      );
    return t.rows[0];
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
    for (const t of targets) {
      const sql =
        t.type === 'class'
          ? `SELECT code AS label FROM classes WHERE id = $1`
          : t.type === 'class_section'
            ? `SELECT k.code || '-' || cs.name AS label FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`
            : t.type === 'route'
              ? `SELECT code || ' · ' || name AS label FROM transport_routes WHERE id = $1`
              : t.type === 'group'
                ? `SELECT name AS label FROM comms_groups WHERE id = $1`
                : `SELECT display_name AS label FROM users WHERE id = $1`;
      const l = await c.query<{ label: string }>(sql, [t.id]);
      if (l.rows[0]) labels.push(l.rows[0].label);
    }
    const d = (k: string) => (x[k] ? (x[k] as Date).toISOString() : null);
    return {
      id: x.id as string,
      title: x.title as string,
      category: x.category as 'service' | 'general',
      channel: x.channel as string,
      templateId: x.template_id as string,
      templateCode: (x.template_code as string) ?? null,
      body: x.body as string,
      variables: (x.variables as Record<string, unknown>) ?? {},
      audience: x.audience as string,
      targets,
      targetLabels: labels,
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
      delivery: (x.delivery as Record<string, number>) ?? {},
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
