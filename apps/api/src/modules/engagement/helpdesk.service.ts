import { templateStatus } from './template-status';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { QUEUES, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { ViewerService, type Viewer } from '../academics/daily/viewer.service';
import { FilesService } from '../files/files.service';
import {
  HELPDESK,
  type AssignTicketDto,
  type CloseTicketDto,
  type CreateTicketDto,
  type Desk,
  type HeadDto,
  type HelpdeskReportDto,
  type HelpdeskSettingsDto,
  type ExportTicketsDto,
  type ListTicketsDto,
  type RateTicketDto,
  type ReopenTicketDto,
  type ReplyDto,
} from './helpdesk.dto';

type Row = Record<string, unknown>;
/** Most tickets one Excel or PDF of the desk list carries. */
const EXPORT_MAX = 5000;

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DESK_LABEL: Record<Desk, string> = {
  parent: 'Parent query',
  staff: 'Staff query',
  provider: 'ERP provider ticket',
};
const PREFIX: Record<Desk, string> = { parent: 'Q/', staff: 'S/', provider: 'T/' };

const SELECT = `SELECT q.id::text, q.number, q.desk, q.kind::text, q.category_code, COALESCE(k.name, q.category_code) AS head,
       q.student_id::text, s.display_name AS student_name, s.admission_no,
       (SELECT kk.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes kk ON kk.id = cs.class_id
         WHERE e.student_id = s.id AND e.academic_year_id = q.academic_year_id AND e.status = 'active' LIMIT 1) AS section,
       q.raised_by_user_id::text, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = q.raised_by_user_id LIMIT 1), ru.display_name) AS raised_by,
       q.subject, q.body, q.file_ids, q.status::text, q.provider_status, q.priority, q.module, q.level, q.due_at, q.escalated_at, q.breached_at,
       q.assigned_role, (SELECT r.name FROM roles r WHERE r.code = q.assigned_role AND (r.school_id IS NULL OR r.school_id = q.school_id) AND r.deleted_at IS NULL ORDER BY r.school_id NULLS LAST LIMIT 1) AS assigned_role_name,
       q.assigned_user_id::text, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = q.assigned_user_id LIMIT 1), au.display_name) AS assigned_to,
       q.resolution, q.rating, q.rating_comment, q.reopened_count, q.opened_at, q.first_response_at, q.closed_at,
       (q.status IN ('open', 'in_progress') AND q.due_at < now()) AS overdue
  FROM parent_queries q
  LEFT JOIN query_categories k ON k.school_id = q.school_id AND k.desk = q.desk AND k.code = q.category_code
  LEFT JOIN students s ON s.id = q.student_id
  LEFT JOIN users ru ON ru.id = q.raised_by_user_id
  LEFT JOIN users au ON au.id = q.assigned_user_id`;

export interface TicketRow {
  id: string;
  number: string;
  desk: Desk;
  head: string;
  categoryCode: string;
  studentId: string | null;
  studentName: string | null;
  admissionNo: string | null;
  section: string | null;
  raisedBy: string | null;
  raisedByUserId: string;
  subject: string;
  body: string;
  fileIds: string[];
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  providerStatus: string | null;
  priority: string;
  module: string | null;
  level: number;
  dueAt: string | null;
  escalatedAt: string | null;
  breachedAt: string | null;
  overdue: boolean;
  assignedRole: string | null;
  assignedRoleName: string | null;
  assignedUserId: string | null;
  assignedTo: string | null;
  resolution: string | null;
  rating: number | null;
  ratingComment: string | null;
  reopenedCount: number;
  openedAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
}

const toTicket = (x: Row): TicketRow => ({
  id: String(x.id),
  number: String(x.number),
  desk: x.desk as Desk,
  head: String(x.head),
  categoryCode: String(x.category_code),
  studentId: (x.student_id as string | null) ?? null,
  studentName: (x.student_name as string | null) ?? null,
  admissionNo: (x.admission_no as string | null) ?? null,
  section: (x.section as string | null) ?? null,
  raisedBy: (x.raised_by as string | null) ?? null,
  raisedByUserId: String(x.raised_by_user_id),
  subject: String(x.subject),
  body: String(x.body),
  fileIds: ((x.file_ids as unknown[]) ?? []).map(String),
  status: x.status as TicketRow['status'],
  providerStatus: (x.provider_status as string | null) ?? null,
  priority: String(x.priority),
  module: (x.module as string | null) ?? null,
  level: Number(x.level),
  dueAt: iso(x.due_at),
  escalatedAt: iso(x.escalated_at),
  breachedAt: iso(x.breached_at),
  overdue: Boolean(x.overdue),
  assignedRole: (x.assigned_role as string | null) ?? null,
  assignedRoleName: (x.assigned_role_name as string | null) ?? null,
  assignedUserId: (x.assigned_user_id as string | null) ?? null,
  assignedTo: (x.assigned_to as string | null) ?? null,
  resolution: (x.resolution as string | null) ?? null,
  rating: (x.rating as number | null) ?? null,
  ratingComment: (x.rating_comment as string | null) ?? null,
  reopenedCount: Number(x.reopened_count ?? 0),
  openedAt: iso(x.opened_at)!,
  firstResponseAt: iso(x.first_response_at),
  closedAt: iso(x.closed_at),
});

interface Me {
  userId: string;
  roles: string[];
  viewAll: boolean;
  provider: boolean;
  respond: boolean;
  /** parent desk: class-section scope from engagement.query.view (null = every section) */
  sections: string[] | null | undefined;
  family: boolean;
  childIds: string[];
}

/**
 * Helpdesk (0056): parent queries, staff queries and tickets to the ERP provider on one ticket table.
 * Heads route a ticket to its owner (class teacher / role / employee / provider); the database clock
 * (working hours) and escalation matrix move unresolved tickets up; this service is the API for raising,
 * answering, reassigning, closing, reopening and rating, the set-up and the six-month dashboard.
 */
@Injectable()
export class HelpdeskService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- who is looking -------------------------------------------------------------------------------
  /** The family / section scope comes from the viewer (its own transaction: call before db.tenant). */
  private async viewerOf(ctx: RequestContext): Promise<Viewer | null> {
    const has = (p: string) => ctx.permissions?.has(p) ?? false;
    if (!has('engagement.query.view') && !has('engagement.query.create')) return null;
    try {
      return await this.viewer.resolve(
        ctx,
        has('engagement.query.view') ? 'engagement.query.view' : 'engagement.query.create',
      );
    } catch {
      return null;
    }
  }

  private async me(ctx: RequestContext, c: PoolClient, v: Viewer | null): Promise<Me> {
    const has = (p: string) => ctx.permissions?.has(p) ?? false;
    const roles = await c.query<{ code: string }>(
      `SELECT DISTINCT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
    );
    return {
      userId: ctx.user.id,
      roles: roles.rows.map((r) => r.code),
      viewAll: has(HELPDESK.viewAll),
      provider: has(HELPDESK.provider),
      respond: has(HELPDESK.respond) || has('engagement.query.respond'),
      sections: v?.kind === 'staff' ? v.sectionIds : undefined,
      family: v?.kind === 'family',
      childIds: v?.students.map((x) => x.id) ?? [],
    };
  }

  /** The SQL condition for the tickets this person may see (fragments with numbered placeholders). */
  private visible(me: Me, params: unknown[]): string {
    if (me.viewAll) return 'true';
    if (me.family) {
      params.push(me.childIds);
      return `(q.desk = 'parent' AND q.student_id = ANY($${params.length}::bigint[]))`;
    }
    params.push(me.userId);
    const u = params.length;
    params.push(me.roles);
    const r = params.length;
    const parts = [
      `q.raised_by_user_id = $${u}`,
      `q.assigned_user_id = $${u}`,
      `(q.assigned_role IS NOT NULL AND q.assigned_role <> 'class_teacher' AND q.assigned_user_id IS NULL AND q.assigned_role = ANY($${r}::text[]))`,
      // earlier owners keep the ticket in view after it moves on
      // eslint-disable-next-line no-restricted-syntax -- placeholder number only; the user id is a bound parameter
      `EXISTS (SELECT 1 FROM query_events ev WHERE ev.query_id = q.id AND ev.kind IN ('created', 'assigned', 'escalated') AND (ev.detail ->> 'userId' = $${u}::text OR (ev.detail ->> 'role' <> 'class_teacher' AND ev.detail ->> 'role' = ANY($${r}::text[]))))`,
    ];
    if (me.provider) parts.push(`q.desk = 'provider'`);
    if (me.sections === null) parts.push(`q.desk = 'parent'`);
    else if (me.sections?.length) {
      params.push(me.sections);
      parts.push(
        // eslint-disable-next-line no-restricted-syntax -- placeholder number only; the section ids are a bound parameter
        `(q.desk = 'parent' AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = q.student_id AND e.academic_year_id = q.academic_year_id AND e.status = 'active' AND e.class_section_id = ANY($${params.length}::bigint[])))`,
      );
    }
    return `(${parts.join(' OR ')})`;
  }

  /**
   * The current owner may answer and close: the person it is assigned to; otherwise the holders of the
   * role it is with (provider support for the provider desk; a section's class teacher when no class
   * teacher was found). Seeing everything (principal / admin) is not owning: they take over first.
   */
  private isHandler(me: Me, t: TicketRow): boolean {
    if (me.family) return false;
    if (t.assignedUserId) return t.assignedUserId === me.userId;
    if (!t.assignedRole) return false;
    if (t.desk === 'provider' && t.assignedRole === 'erp_support') return me.provider;
    if (!me.respond) return false;
    if (t.assignedRole === 'class_teacher')
      return Array.isArray(me.sections) && me.sections.length > 0;
    return me.roles.includes(t.assignedRole);
  }

  /** Staff other than a plain raiser read internal notes and the full timeline. */
  private seesNotes(me: Me, t: TicketRow): boolean {
    if (me.family) return false;
    return (
      this.isHandler(me, t) ||
      me.viewAll ||
      (t.desk === 'provider' && me.provider) ||
      !this.isRaiser(me, t)
    );
  }

  /** SQL for "with me now" (the same rule as isHandler), fixed fragments with numbered placeholders. */
  private ownerSql(me: Me, params: unknown[]): string {
    params.push(me.userId);
    const u = params.length;
    params.push(me.roles);
    const r = params.length;
    const parts = [
      `q.assigned_user_id = $${u}`,
      `(q.assigned_user_id IS NULL AND q.assigned_role NOT IN ('class_teacher', 'erp_support') AND q.assigned_role = ANY($${r}::text[]))`,
    ];
    if (me.provider)
      parts.push(
        `(q.assigned_user_id IS NULL AND q.desk = 'provider' AND q.assigned_role = 'erp_support')`,
      );
    if (Array.isArray(me.sections) && me.sections.length) {
      params.push(me.sections);
      parts.push(
        // eslint-disable-next-line no-restricted-syntax -- placeholder number only; the section ids are a bound parameter
        `(q.assigned_user_id IS NULL AND q.assigned_role = 'class_teacher' AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = q.student_id AND e.academic_year_id = q.academic_year_id AND e.status = 'active' AND e.class_section_id = ANY($${params.length}::bigint[])))`,
      );
    }
    return `(${parts.join(' OR ')})`;
  }

  private isRaiser(me: Me, t: TicketRow): boolean {
    if (me.family) return t.studentId !== null && me.childIds.includes(t.studentId);
    return t.raisedByUserId === me.userId;
  }

  private async load(c: PoolClient, me: Me, id: string): Promise<TicketRow> {
    const params: unknown[] = [id];
    const cond = this.visible(me, params);
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; cond holds fixed fragments with numbered placeholders
      `${SELECT} WHERE q.id = $1 AND q.kind <> 'leave' AND ${cond}`,
      params,
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Ticket not found', { status: 404 });
    return toTicket(r.rows[0]);
  }

  /** Only the uploader's own ready PDFs / images (5 MB) may be attached. */
  async checkFiles(c: PoolClient, fileIds: string[]) {
    if (!fileIds.length) return;
    const r = await c.query<{ id: string; ok: boolean }>(
      `SELECT id::text, (status = 'ready' AND created_by = app.current_user_id() AND size_bytes <= 5242880
                         AND content_type ~ '^(application/pdf|image/(png|jpeg|webp))$') AS ok
         FROM files WHERE id = ANY($1::bigint[])`,
      [fileIds],
    );
    if (r.rows.length !== new Set(fileIds).size || r.rows.some((f) => !f.ok))
      throw new DomainError(
        'helpdesk.file_invalid',
        'Attach your own PDF or image files of up to 5 MB',
        { status: 400 },
      );
  }

  // ---- reading --------------------------------------------------------------------------------------
  /** The list filters as SQL (what I may see, desk, status, mine / assigned, query type, search). */
  private filterSql(
    me: Me,
    q: Pick<ListTicketsDto, 'desk' | 'status' | 'view' | 'head' | 'q'>,
    params: unknown[],
  ): string {
    const where = [`q.kind <> 'leave'`, this.visible(me, params)];
    if (q.desk) {
      params.push(q.desk);
      where.push(`q.desk = $${params.length}`);
    }
    if (q.status === 'active') where.push(`q.status <> 'closed'`);
    else if (q.status === 'overdue')
      where.push(`q.status IN ('open', 'in_progress') AND q.due_at < now()`);
    else if (q.status) {
      params.push(q.status);
      where.push(`q.status = $${params.length}::query_status`);
    }
    if (q.view === 'mine') {
      params.push(me.userId);
      where.push(`q.raised_by_user_id = $${params.length}`);
    } else if (q.view === 'assigned') where.push(this.ownerSql(me, params));
    if (q.head) {
      params.push(q.head);
      where.push(`q.category_code = $${params.length}`);
    }
    if (q.q) {
      params.push(q.q);
      where.push(
        `concat_ws(' ', q.number, q.subject, s.display_name, s.admission_no, ru.display_name) ILIKE '%' || $${params.length} || '%'`,
      );
    }
    return where.join(' AND ');
  }

  /** Tickets latest first, a page at a time. */
  async list(ctx: RequestContext, q: ListTicketsDto) {
    const v = await this.viewerOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const params: unknown[] = [];
      const w = this.filterSql(me, q, params);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments with numbered placeholders; values bound
        `SELECT count(*)::int AS n FROM parent_queries q LEFT JOIN students s ON s.id = q.student_id LEFT JOIN users ru ON ru.id = q.raised_by_user_id WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; values bound
        `${SELECT} WHERE ${w}
          ORDER BY q.opened_at DESC, q.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const cp: unknown[] = [];
      const counts = await c.query<{ desk: Desk; open: number; overdue: number }>(
        // eslint-disable-next-line no-restricted-syntax -- visibility fragment with numbered placeholders; values bound
        `SELECT q.desk, count(*) FILTER (WHERE q.status <> 'closed')::int AS open,
                count(*) FILTER (WHERE q.status IN ('open', 'in_progress') AND q.due_at < now())::int AS overdue
           FROM parent_queries q WHERE q.kind <> 'leave' AND ${this.visible(me, cp)} GROUP BY q.desk`,
        cp,
      );
      return {
        data: r.rows.map(toTicket),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        counts: counts.rows,
        you: { viewAll: me.viewAll, provider: me.provider, family: me.family },
      };
    });
  }

  async get(ctx: RequestContext, id: string) {
    const v = await this.viewerOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      const handler = this.isHandler(me, t);
      const raiser = this.isRaiser(me, t);
      const notes = this.seesNotes(me, t);
      const replies = await c.query<Row>(
        `SELECT x.id::text, x.author_user_id::text, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = x.author_user_id LIMIT 1), u.display_name) AS author,
                x.author_kind::text AS author_kind, x.body, x.file_ids, x.is_internal, x.created_at
           FROM query_responses x LEFT JOIN users u ON u.id = x.author_user_id
          WHERE x.query_id = $1 AND ($2 OR x.is_internal = false) ORDER BY x.created_at, x.id`,
        [id, notes],
      );
      const events = await c.query<Row>(
        `SELECT ev.kind, ev.level, ev.at, ev.detail, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ev.actor_user_id LIMIT 1), u.display_name) AS actor,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = (ev.detail ->> 'userId')::bigint LIMIT 1), (SELECT au.display_name FROM users au WHERE au.id = (ev.detail ->> 'userId')::bigint)) AS to_user,
                (SELECT r.name FROM roles r WHERE r.code = ev.detail ->> 'role' AND r.deleted_at IS NULL ORDER BY r.school_id NULLS LAST LIMIT 1) AS to_role
           FROM query_events ev LEFT JOIN users u ON u.id = ev.actor_user_id
          WHERE ev.query_id = $1 AND ($2 OR ev.kind NOT IN ('note', 'assigned', 'escalated', 'breached'))
          ORDER BY ev.at, ev.id`,
        [id, notes],
      );
      const s = await c.query<{ reopen_days: number }>(
        `SELECT reopen_days FROM helpdesk_settings WHERE school_id = app.current_school_id()`,
      );
      const reopenDays = s.rows[0]?.reopen_days ?? 7;
      const reopenUntil =
        t.closedAt !== null
          ? new Date(new Date(t.closedAt).getTime() + reopenDays * 86_400_000).toISOString()
          : null;
      return {
        ...t,
        replies: replies.rows.map((x) => ({
          id: String(x.id),
          author: (x.author as string | null) ?? null,
          authorKind: String(x.author_kind),
          mine: x.author_user_id === me.userId,
          fromRaiser:
            x.author_user_id === t.raisedByUserId ||
            x.author_kind === 'guardian' ||
            x.author_kind === 'student',
          body: String(x.body),
          fileIds: ((x.file_ids as unknown[]) ?? []).map(String),
          isInternal: Boolean(x.is_internal),
          createdAt: iso(x.created_at)!,
        })),
        events: events.rows.map((x) => ({
          kind: String(x.kind),
          level: (x.level as number | null) ?? null,
          at: iso(x.at)!,
          actor: (x.actor as string | null) ?? null,
          to: (x.to_user as string | null) ?? (x.to_role as string | null) ?? null,
          emails: ((x.detail as Row)?.emails as string[] | undefined) ?? [],
        })),
        you: {
          handler,
          raiser,
          canReply: t.status !== 'closed' && (handler || raiser),
          canAssign: (handler || me.viewAll) && t.status !== 'closed',
          canTakeOver:
            !handler &&
            !raiser &&
            t.status !== 'closed' &&
            (me.viewAll || (t.desk === 'provider' && me.provider)),
          canClose: handler && t.status !== 'closed',
          canReopen:
            raiser &&
            t.status === 'closed' &&
            reopenUntil !== null &&
            new Date(reopenUntil) > new Date(),
          canRate: raiser && t.status !== 'open' && t.status !== 'in_progress',
          reopenUntil,
        },
      };
    });
  }

  /** A file on a ticket the viewer may see, as a signed link (View opens it, Download saves it). */
  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    const v = await this.viewerOf(ctx);
    const ok = await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      if (t.fileIds.includes(fileId)) return true;
      const r = await c.query(
        `SELECT 1 FROM query_responses WHERE query_id = $1 AND file_ids ? $2 AND ($3 OR is_internal = false)`,
        [id, fileId, this.seesNotes(me, t)],
      );
      return (r.rowCount ?? 0) > 0;
    });
    if (!ok) throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }

  // ---- raising (staff and provider desks; parent queries come through the family endpoints) --------
  async create(ctx: RequestContext, dto: CreateTicketDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewerOf(ctx);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const head = await c.query<{ code: string }>(
        `SELECT code FROM query_categories WHERE desk = $1 AND code = $2 AND status = 'active'`,
        [dto.desk, dto.categoryCode],
      );
      if (!head.rows[0])
        throw new DomainError('validation-failed', 'Choose a query type', {
          status: 400,
          extra: { errors: { categoryCode: 'Choose a query type' } },
        });
      await this.checkFiles(c, dto.fileIds);
      const no = await c.query<{ n: string }>(`SELECT app.next_query_no($1) AS n`, [yearId]);
      const number = no.rows[0]!.n.replace(/^Q\//, PREFIX[dto.desk]);
      const r = await c.query<{ id: string }>(
        `INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, raised_by_user_id, subject, body, file_ids,
                                     desk, employee_id, priority, module, channel, request_id)
         VALUES (app.current_school_id(), $1, $2, 'query', $3, app.current_user_id(), $4, $5, $6::jsonb, $7,
                 (SELECT id FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1), $8, $9, 'admin', app.current_request_id())
         RETURNING id::text`,
        [
          yearId,
          number,
          dto.categoryCode,
          dto.subject,
          dto.body,
          JSON.stringify(dto.fileIds),
          dto.desk,
          dto.priority,
          dto.module ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.ticket.raise',
        entityType: 'parent_queries',
        entityId: id,
        after: { number, desk: dto.desk, head: dto.categoryCode, priority: dto.priority },
      });
      await this.notifyOwner(c, id, 'new');
      return this.load(c, await this.me(ctx, c, v), id);
    });
  }

  // ---- answering ------------------------------------------------------------------------------------
  async reply(ctx: RequestContext, id: string, dto: ReplyDto) {
    const v = await this.viewerOf(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      const handler = this.isHandler(me, t);
      const raiser = this.isRaiser(me, t);
      if (!handler && !raiser)
        throw new DomainError(
          'helpdesk.not_owner',
          `This ticket is with ${t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? 'someone else'}; take it over or hand it over first`,
          { status: 403 },
        );
      if (t.status === 'closed')
        throw new DomainError(
          'helpdesk.closed',
          'This ticket is closed; reopen it to write again',
          {
            status: 409,
          },
        );
      await this.checkFiles(c, dto.fileIds);
      const internal = handler && !raiser && dto.isInternal;
      const kind = me.family
        ? 'guardian'
        : t.desk === 'provider' && me.provider && !raiser
          ? 'provider'
          : 'staff';
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, file_ids, is_internal)
         VALUES (app.current_school_id(), $1, app.current_user_id(), $2::author_kind, $3, $4::jsonb, $5)`,
        [id, kind, dto.body, JSON.stringify(dto.fileIds), internal],
      );
      if (!internal) {
        if (handler && !raiser) {
          await c.query(
            `UPDATE parent_queries SET status = 'answered', first_response_at = COALESCE(first_response_at, now()),
                    provider_status = CASE WHEN desk = 'provider' AND provider_status = 'open' THEN 'triaged' ELSE provider_status END, updated_at = now()
              WHERE id = $1`,
            [id],
          );
          await this.notifyRaiser(c, t, `New reply on ${t.number}`, dto.body);
        } else {
          await c.query(
            `UPDATE parent_queries SET status = CASE WHEN status = 'answered' THEN 'open'::query_status ELSE status END, updated_at = now() WHERE id = $1`,
            [id],
          );
          await this.notifyOwner(c, id, 'reply', dto.body);
        }
      }
    });
    return this.get(ctx, id);
  }

  async assign(ctx: RequestContext, id: string, dto: AssignTicketDto) {
    const v = await this.viewerOf(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      if (!(this.isHandler(me, t) || me.viewAll) || t.status === 'closed')
        throw new DomainError(
          'forbidden',
          'Only the person it is with, or an administrator, can hand it over',
          { status: 403 },
        );
      if (dto.userId) {
        const u = await c.query(
          `SELECT 1 FROM user_school_memberships WHERE user_id = $1 AND school_id = app.current_school_id() AND status = 'active' AND deleted_at IS NULL AND person_type IN ('employee', 'external')`,
          [dto.userId],
        );
        if (!u.rowCount)
          throw new DomainError('validation-failed', 'Choose a staff member with a login', {
            status: 400,
          });
      } else {
        const r = await c.query(
          `SELECT 1 FROM roles WHERE code = $1 AND deleted_at IS NULL AND (school_id IS NULL OR school_id = app.current_school_id())`,
          [dto.roleCode],
        );
        if (!r.rowCount)
          throw new DomainError('validation-failed', 'Unknown role', { status: 400 });
      }
      await c.query(
        `UPDATE parent_queries SET assigned_user_id = $2, assigned_role = $3,
                status = CASE WHEN status = 'open' THEN 'in_progress'::query_status ELSE status END, updated_at = now()
          WHERE id = $1`,
        [id, dto.userId ?? null, dto.roleCode ?? null],
      );
      if (dto.note)
        await c.query(
          `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, is_internal)
           VALUES (app.current_school_id(), $1, app.current_user_id(), 'staff', $2, true)`,
          [id, dto.note],
        );
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.ticket.assign',
        entityType: 'parent_queries',
        entityId: id,
        before: { userId: t.assignedUserId, role: t.assignedRole },
        after: { userId: dto.userId ?? null, role: dto.roleCode ?? null },
      });
      await this.notifyOwner(c, id, 'assigned', dto.note);
    });
    return this.get(ctx, id);
  }

  async close(ctx: RequestContext, id: string, dto: CloseTicketDto) {
    const v = await this.viewerOf(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      if (!this.isHandler(me, t))
        throw new DomainError(
          'helpdesk.not_owner',
          `Only ${t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? 'the person it is with'} can close it; take it over first`,
          { status: 403 },
        );
      if (t.status === 'closed')
        throw new DomainError('helpdesk.closed', 'Already closed', { status: 409 });
      await this.checkFiles(c, dto.fileIds);
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, file_ids)
         VALUES (app.current_school_id(), $1, app.current_user_id(), $2::author_kind, $3, $4::jsonb)`,
        [
          id,
          t.desk === 'provider' && me.provider ? 'provider' : 'staff',
          dto.resolution,
          JSON.stringify(dto.fileIds),
        ],
      );
      await c.query(
        `UPDATE parent_queries SET status = 'closed', resolution = $2, closed_at = now(), closed_by = app.current_user_id(),
                first_response_at = COALESCE(first_response_at, now()),
                provider_status = CASE WHEN desk = 'provider' THEN 'fixed' ELSE provider_status END, updated_at = now()
          WHERE id = $1`,
        [id, dto.resolution],
      );
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.ticket.close',
        entityType: 'parent_queries',
        entityId: id,
        after: { level: t.level },
      });
      await this.notifyRaiser(c, t, `${t.number} resolved`, dto.resolution, 'helpdesk_resolved');
    });
    return this.get(ctx, id);
  }

  async reopen(ctx: RequestContext, id: string, dto: ReopenTicketDto) {
    const v = await this.viewerOf(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      if (!this.isRaiser(me, t))
        throw new DomainError('forbidden', 'Only the person who raised it can reopen', {
          status: 403,
        });
      const s = await c.query<{ ok: boolean }>(
        `SELECT q.status = 'closed' AND q.closed_at > now() - make_interval(days => COALESCE((SELECT reopen_days FROM helpdesk_settings WHERE school_id = app.current_school_id()), 7)) AS ok
           FROM parent_queries q WHERE q.id = $1`,
        [id],
      );
      if (!s.rows[0]?.ok)
        throw new DomainError(
          'helpdesk.reopen_window',
          'This ticket can no longer be reopened; raise a new one',
          { status: 409 },
        );
      await this.checkFiles(c, dto.fileIds);
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, file_ids)
         VALUES (app.current_school_id(), $1, app.current_user_id(), $2::author_kind, $3, $4::jsonb)`,
        [
          id,
          me.family ? 'guardian' : 'staff',
          `Reopened: ${dto.reason}`,
          JSON.stringify(dto.fileIds),
        ],
      );
      await c.query(
        `UPDATE parent_queries SET status = 'open', closed_at = NULL, closed_by = NULL, breached_at = NULL, reopened_count = reopened_count + 1,
                provider_status = CASE WHEN desk = 'provider' THEN 'open' ELSE provider_status END,
                due_at = app.helpdesk_add_hours(now(), app.helpdesk_level_hours(desk, category_code, level, priority)), updated_at = now()
          WHERE id = $1`,
        [id],
      );
      await this.notifyOwner(c, id, 'reopened', dto.reason);
    });
    return this.get(ctx, id);
  }

  async rate(ctx: RequestContext, id: string, dto: RateTicketDto) {
    const v = await this.viewerOf(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      if (!this.isRaiser(me, t) || t.status === 'open' || t.status === 'in_progress')
        throw new DomainError('helpdesk.not_answered', 'Rate once the ticket is answered', {
          status: 409,
        });
      await c.query(
        `UPDATE parent_queries SET rating = $2, rating_comment = $3, updated_at = now() WHERE id = $1`,
        [id, dto.rating, dto.comment ?? null],
      );
    });
    return this.get(ctx, id);
  }

  /** An administrator (or provider support on the provider desk) takes the ticket to answer it. */
  async takeOver(ctx: RequestContext, id: string) {
    const v = await this.viewerOf(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const t = await this.load(c, me, id);
      if (t.status === 'closed' || !(me.viewAll || (t.desk === 'provider' && me.provider)))
        throw new DomainError('forbidden', 'You cannot take this ticket over', { status: 403 });
      await c.query(
        `UPDATE parent_queries SET assigned_user_id = app.current_user_id(), assigned_role = CASE WHEN desk = 'provider' THEN assigned_role ELSE NULL END,
                status = CASE WHEN status = 'open' THEN 'in_progress'::query_status ELSE status END, updated_at = now()
          WHERE id = $1`,
        [id],
      );
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, is_internal)
         VALUES (app.current_school_id(), $1, app.current_user_id(), 'staff', $2, true)`,
        [id, `Taken over from ${t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? '—'}`],
      );
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.ticket.take_over',
        entityType: 'parent_queries',
        entityId: id,
        before: { userId: t.assignedUserId, role: t.assignedRole },
      });
    });
    return this.get(ctx, id);
  }

  /** "With me now": open / in-progress tickets I own, the past-due ones and the latest five. */
  async waiting(ctx: RequestContext) {
    const v = await this.viewerOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const params: unknown[] = [];
      const cond = this.ownerSql(me, params);
      const n = await c.query<{ total: number; overdue: number }>(
        // eslint-disable-next-line no-restricted-syntax -- cond holds fixed fragments; values bound
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE q.due_at < now())::int AS overdue
           FROM parent_queries q WHERE q.kind <> 'leave' AND q.status IN ('open', 'in_progress') AND ${cond}`,
        params,
      );
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; cond holds fixed fragments; values bound
        `${SELECT} WHERE q.kind <> 'leave' AND q.status IN ('open', 'in_progress') AND ${cond}
          ORDER BY (q.due_at < now()) DESC, q.due_at NULLS LAST, q.opened_at DESC LIMIT 5`,
        params,
      );
      return {
        total: n.rows[0]?.total ?? 0,
        overdue: n.rows[0]?.overdue ?? 0,
        latest: r.rows.map(toTicket),
      };
    });
  }

  /**
   * For the older query endpoints (inside the caller's transaction): only the owner answers or closes a
   * query, the owner or an administrator hands it over. Leave requests keep their own rules.
   */
  async assertCan(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    action: 'reply' | 'close' | 'assign',
  ) {
    const me = await this.me(ctx, c, null);
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is bound
      `${SELECT} WHERE q.id = $1`,
      [id],
    );
    if (!r.rows[0] || r.rows[0].kind === 'leave') return;
    const t = toTicket(r.rows[0]);
    const ok = this.isHandler(me, t) || (action === 'assign' && me.viewAll);
    if (!ok)
      throw new DomainError(
        'helpdesk.not_owner',
        `This query is with ${t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? 'someone else'}; take it over in the Helpdesk first`,
        { status: 403 },
      );
  }

  /** Runs the escalation check now (the workers service runs it every five minutes). */
  async escalateNow(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ n: number }>(`SELECT app.helpdesk_escalate_due() AS n`);
      return { escalated: r.rows[0]?.n ?? 0 };
    });
  }

  // ---- notifications --------------------------------------------------------------------------------
  /** The current owner of a ticket (person or role holders, plus the provider's support mail). */
  async notifyOwner(
    c: PoolClient,
    id: string,
    why: 'new' | 'reply' | 'assigned' | 'reopened',
    text?: string,
  ) {
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is bound
      `${SELECT} WHERE q.id = $1`,
      [id],
    );
    if (!r.rows[0]) return;
    const t = toTicket(r.rows[0]);
    const people = await c.query<{ user_id: string; email: string | null }>(
      `SELECT user_id::text, email FROM app.helpdesk_role_people($1) WHERE $2::bigint IS NULL
       UNION SELECT $2::bigint::text, app.helpdesk_user_email($2::bigint) WHERE $2::bigint IS NOT NULL`,
      [t.assignedRole ?? '', t.assignedUserId],
    );
    const s = await c.query<{ provider_email: string | null }>(
      `SELECT provider_email::text FROM helpdesk_settings WHERE school_id = app.current_school_id()`,
    );
    const emails = people.rows.map((p) => p.email).filter((e): e is string => Boolean(e));
    if (t.desk === 'provider' && s.rows[0]?.provider_email) emails.push(s.rows[0].provider_email);
    const title = {
      new: `New ${DESK_LABEL[t.desk].toLowerCase()}`,
      reply: `Reply on ${t.number}`,
      assigned: `${t.number} assigned to you`,
      reopened: `${t.number} reopened`,
    }[why];
    const html = this.mail(t, title, text);
    await c.query(`SELECT app.helpdesk_notify($1, $2, $3, $4::text[], $5::bigint[], $6, $7, $8)`, [
      id,
      `${title}: ${t.number} ${t.subject}`.slice(0, 200),
      html,
      // a family's own replies do not mail the whole role; the owner gets the app alert
      why === 'reply' && t.desk === 'parent' ? [] : emails,
      people.rows.map((p) => p.user_id),
      title,
      `${t.number} · ${t.subject}`.slice(0, 200),
      `/queries/${id}`,
    ]);
    // SMS and WhatsApp to the same people, when the school has made the template ready
    // (a family's own reply does not text the whole role, as with the mail)
    if (!(why === 'reply' && t.desk === 'parent'))
      await this.text(
        c,
        `helpdesk_${why}`,
        t,
        people.rows.map((p) => p.user_id),
      );
  }

  /** One helpdesk template on SMS and WhatsApp to people by their sign-in (0074). */
  private async text(c: PoolClient, code: string, t: TicketRow, users: string[]) {
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    await c.query(`SELECT app.template_to_users($1, $2::bigint[], $3::jsonb)`, [
      code,
      users,
      JSON.stringify({
        desk: DESK_LABEL[t.desk].toLowerCase(),
        number: t.number,
        subject: t.subject.slice(0, 80),
        due: t.dueAt
          ? new Date(t.dueAt).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        school: school.rows[0]?.name ?? '',
      }),
    ]);
  }

  /** The person who raised it (staff: mail + push; family: push, the WhatsApp reply stays with queries). */
  private async notifyRaiser(
    c: PoolClient,
    t: TicketRow,
    title: string,
    text: string,
    code: 'helpdesk_reply' | 'helpdesk_resolved' = 'helpdesk_reply',
  ) {
    const email =
      t.desk === 'parent'
        ? null
        : ((
            await c.query<{ e: string | null }>(`SELECT app.helpdesk_user_email($1) AS e`, [
              t.raisedByUserId,
            ])
          ).rows[0]?.e ?? null);
    let users = [t.raisedByUserId];
    if (t.desk === 'parent' && t.studentId) {
      // every guardian of the child with a login sees the answer
      const g = await c.query<{ id: string }>(
        `SELECT DISTINCT g.user_id::text AS id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = $1 AND g.user_id IS NOT NULL`,
        [t.studentId],
      );
      users = [...new Set([...users, ...g.rows.map((x) => x.id)])];
    }
    await c.query(`SELECT app.helpdesk_notify($1, $2, $3, $4::text[], $5::bigint[], $6, $7, $8)`, [
      t.id,
      `${title}: ${t.subject}`.slice(0, 200),
      this.mail(t, title, text),
      email ? [email] : [],
      users,
      title,
      text.slice(0, 200),
      `/queries/${t.id}`,
    ]);
    await this.text(c, code, t, users);
  }

  private mail(t: TicketRow, title: string, text?: string): string {
    const row = (k: string, v: string | null) =>
      v ? `<tr><td><strong>${k}</strong></td><td>${esc(v)}</td></tr>` : '';
    return `<p>${esc(title)}.</p><table cellpadding="4" style="border-collapse:collapse">${row('Number', t.number)}${row('Type', `${DESK_LABEL[t.desk]} · ${t.head}`)}${row('Subject', t.subject)}${row('Student', t.studentName ? `${t.studentName}${t.section ? ` (${t.section})` : ''}` : null)}${row('Raised by', t.raisedBy)}${row('Priority', t.desk === 'provider' ? t.priority : null)}${row('Due', t.dueAt ? new Date(t.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null)}</table>${text ? `<p>${esc(text.slice(0, 2000)).replace(/\n/g, '<br>')}</p>` : ''}<p>Open EduPro → Helpdesk → ${esc(t.number)} to answer.</p>`;
  }

  /** Who may use the helpdesk at all: families raising for their children, staff, the provider. */
  assertAny(ctx: RequestContext) {
    const p = ctx.permissions;
    if (
      !p ||
      ![
        HELPDESK.viewAll,
        HELPDESK.raise,
        HELPDESK.respond,
        HELPDESK.provider,
        'engagement.query.view',
        'engagement.query.create',
      ].some((x) => p.has(x))
    )
      throw new DomainError('forbidden', 'You do not have access to the helpdesk', { status: 403 });
  }

  /** The active query types of a desk, for the raise form. */
  async heads(ctx: RequestContext, desk: Desk) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const r = await c.query<{ code: string; name: string; description: string | null }>(
        `SELECT code, name, description FROM query_categories WHERE desk = $1 AND status = 'active' ORDER BY sort_order, name`,
        [desk],
      );
      return r.rows.map((x) => ({ code: x.code, name: x.name, description: x.description ?? '' }));
    });
  }

  /** Staff (with a login) and roles a ticket may be handed to. */
  async assignees(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT u.id::text, COALESCE(e.display_name, u.display_name) || COALESCE(' · ' || e.employee_code, '') AS name
           FROM user_school_memberships m JOIN users u ON u.id = m.user_id
           LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
          WHERE m.school_id = app.current_school_id() AND m.status = 'active' AND m.deleted_at IS NULL AND m.person_type IN ('employee', 'external') AND u.deleted_at IS NULL
          ORDER BY 2 LIMIT 2000`,
      );
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (code) code, name FROM roles
          WHERE deleted_at IS NULL AND status = 'active' AND (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'group_admin', 'class_teacher') ORDER BY code, school_id NULLS LAST`,
      );
      return { staff: staff.rows, roles: roles.rows };
    });
  }

  // ---- set-up ---------------------------------------------------------------------------------------
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const s = await c.query<Row>(
        `SELECT working_days, to_char(day_start, 'HH24:MI') AS day_start, to_char(day_end, 'HH24:MI') AS day_end, reopen_days,
                provider_name, provider_email::text, provider_senior_name, provider_senior_email::text, provider_sla
           FROM helpdesk_settings WHERE school_id = app.current_school_id()`,
      );
      const heads = await c.query<Row>(
        `SELECT k.id::text, k.desk, k.code, k.name, k.description, k.owner_type, k.route_to, k.owner_user_id::text, k.sla_hours::float AS sla_hours,
                k.sort_order, k.status::text,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = k.owner_user_id LIMIT 1), (SELECT u.display_name FROM users u WHERE u.id = k.owner_user_id)) AS owner_name,
                (SELECT count(*)::int FROM parent_queries q WHERE q.desk = k.desk AND q.category_code = k.code) AS used,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('level', l.level, 'hours', l.hours::float, 'assignType', l.assign_type, 'roleCode', l.role_code,
                                   'userId', l.user_id::text, 'emails', to_jsonb(l.emails),
                                   'userName', COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = l.user_id LIMIT 1), (SELECT u.display_name FROM users u WHERE u.id = l.user_id)))
                                   ORDER BY l.level) FROM helpdesk_levels l WHERE l.head_id = k.id), '[]'::jsonb) AS levels
           FROM query_categories k ORDER BY k.desk, k.sort_order, k.name`,
      );
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (code) code, name FROM roles
          WHERE deleted_at IS NULL AND status = 'active' AND (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'group_admin') ORDER BY code, school_id NULLS LAST`,
      );
      const staff = await c.query<{ id: string; name: string; email: string | null }>(
        `SELECT u.id::text, COALESCE(e.display_name, u.display_name) || COALESCE(' · ' || e.employee_code, '') AS name, COALESCE(e.email::text, u.email::text) AS email
           FROM user_school_memberships m JOIN users u ON u.id = m.user_id
           LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
          WHERE m.school_id = app.current_school_id() AND m.status = 'active' AND m.deleted_at IS NULL AND m.person_type IN ('employee', 'external') AND u.deleted_at IS NULL
          ORDER BY 2 LIMIT 2000`,
      );
      const x = s.rows[0]!;
      return {
        settings: {
          workingDays: (x.working_days as number[]) ?? [1, 2, 3, 4, 5, 6],
          dayStart: String(x.day_start),
          dayEnd: String(x.day_end),
          reopenDays: Number(x.reopen_days),
          providerName: (x.provider_name as string | null) ?? '',
          providerEmail: (x.provider_email as string | null) ?? '',
          providerSeniorName: (x.provider_senior_name as string | null) ?? '',
          providerSeniorEmail: (x.provider_senior_email as string | null) ?? '',
          providerSla: x.provider_sla as Record<string, number>,
        },
        heads: heads.rows.map((h) => ({
          id: String(h.id),
          desk: h.desk as Desk,
          code: String(h.code),
          name: String(h.name),
          description: (h.description as string | null) ?? '',
          ownerType: String(h.owner_type),
          ownerRole: h.owner_type === 'role' ? String(h.route_to) : null,
          ownerUserId: (h.owner_user_id as string | null) ?? null,
          ownerName: (h.owner_name as string | null) ?? null,
          slaHours: (h.sla_hours as number | null) ?? null,
          sortOrder: Number(h.sort_order),
          active: h.status === 'active',
          used: Number(h.used),
          levels: h.levels as Array<Record<string, unknown>>,
        })),
        roles: roles.rows,
        staff: staff.rows,
        templates: await templateStatus(c, 'helpdesk'),
      };
    });
  }

  async saveSettings(ctx: RequestContext, dto: HelpdeskSettingsDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO helpdesk_settings (school_id, working_days, day_start, day_end, reopen_days, provider_name, provider_email,
                                        provider_senior_name, provider_senior_email, provider_sla, updated_at, updated_by)
         VALUES (app.current_school_id(), $1, $2::time, $3::time, $4, $5, NULLIF($6, ''), $7, NULLIF($8, ''), $9::jsonb, now(), app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET working_days = EXCLUDED.working_days, day_start = EXCLUDED.day_start, day_end = EXCLUDED.day_end,
              reopen_days = EXCLUDED.reopen_days, provider_name = EXCLUDED.provider_name, provider_email = EXCLUDED.provider_email,
              provider_senior_name = EXCLUDED.provider_senior_name, provider_senior_email = EXCLUDED.provider_senior_email,
              provider_sla = EXCLUDED.provider_sla, updated_at = now(), updated_by = app.current_user_id()`,
        [
          [...new Set(dto.workingDays)].sort(),
          dto.dayStart,
          dto.dayEnd,
          dto.reopenDays,
          dto.providerName || null,
          dto.providerEmail ?? '',
          dto.providerSeniorName || null,
          dto.providerSeniorEmail ?? '',
          JSON.stringify(dto.providerSla),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.settings.save',
        entityType: 'helpdesk_settings',
        entityId: requireTenant(ctx).schoolId,
        after: { workingDays: dto.workingDays, dayStart: dto.dayStart, dayEnd: dto.dayEnd },
      });
    });
    return this.setup(ctx);
  }

  async saveHead(ctx: RequestContext, id: string | null, dto: HeadDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.ownerType === 'employee' || dto.levels.some((l) => l.userId)) {
        const ids = [dto.ownerUserId, ...dto.levels.map((l) => l.userId)].filter(Boolean);
        const ok = await c.query<{ n: number }>(
          `SELECT count(DISTINCT user_id)::int AS n FROM user_school_memberships WHERE user_id = ANY($1::bigint[]) AND school_id = app.current_school_id() AND status = 'active' AND deleted_at IS NULL`,
          [ids],
        );
        if ((ok.rows[0]?.n ?? 0) !== new Set(ids).size)
          throw new DomainError('validation-failed', 'Choose staff members with a login', {
            status: 400,
          });
      }
      let headId = id;
      const values = [
        dto.desk,
        dto.code,
        dto.name,
        dto.description || null,
        dto.ownerType,
        dto.ownerType === 'role'
          ? dto.ownerRole!
          : dto.ownerType === 'provider'
            ? 'erp_support'
            : dto.ownerType === 'class_teacher'
              ? 'class_teacher'
              : 'school_admin',
        dto.ownerType === 'employee' ? dto.ownerUserId! : null,
        dto.desk === 'provider' ? null : (dto.slaHours ?? null),
        dto.sortOrder,
        dto.active ? 'active' : 'inactive',
      ];
      try {
        if (headId) {
          const r = await c.query(
            `UPDATE query_categories SET desk = $2, code = $3, name = $4, description = $5, owner_type = $6, route_to = $7, owner_user_id = $8,
                    sla_hours = $9, sort_order = $10, status = $11::row_status, updated_at = now() WHERE id = $1`,
            [headId, ...values],
          );
          if (!r.rowCount)
            throw new DomainError('not-found', 'Query type not found', { status: 404 });
        } else {
          headId = (
            await c.query<{ id: string }>(
              `INSERT INTO query_categories (school_id, desk, code, name, description, owner_type, route_to, owner_user_id, sla_hours, sort_order, status)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::row_status) RETURNING id::text`,
              values,
            )
          ).rows[0]!.id;
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('validation-failed', 'This code is already used on this desk', {
            status: 409,
            extra: { errors: { code: 'Already used on this desk' } },
          });
        throw error;
      }
      await c.query(`DELETE FROM helpdesk_levels WHERE head_id = $1`, [headId]);
      for (const l of [...dto.levels].sort((a, b) => a.level - b.level))
        await c.query(
          `INSERT INTO helpdesk_levels (school_id, head_id, level, hours, assign_type, role_code, user_id, emails)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::text[])`,
          [
            headId,
            l.level,
            l.hours,
            l.assignType,
            l.assignType === 'role' ? l.roleCode : null,
            l.assignType === 'employee' ? l.userId : null,
            l.emails,
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.head.save',
        entityType: 'query_categories',
        entityId: headId!,
        after: { desk: dto.desk, code: dto.code, owner: dto.ownerType, levels: dto.levels.length },
      });
    });
    return this.setup(ctx);
  }

  // ---- dashboard ------------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext) {
    const v = await this.viewerOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const params: unknown[] = [];
      const cond = this.visible(me, params);
      const months = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- cond holds fixed fragments with numbered placeholders; values bound
        `WITH mo AS (
           SELECT to_char(g, 'YYYY-MM') AS month, (g::date::timestamp AT TIME ZONE 'Asia/Kolkata') AS starts, ((g + interval '1 month')::date::timestamp AT TIME ZONE 'Asia/Kolkata') AS ends
             FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months', date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'), interval '1 month') g),
         t AS (SELECT q.* FROM parent_queries q WHERE q.kind <> 'leave' AND ${cond})
         SELECT mo.month, d.desk,
                (SELECT count(*)::int FROM t WHERE t.desk = d.desk AND t.opened_at >= mo.starts AND t.opened_at < mo.ends) AS raised,
                (SELECT count(*)::int FROM t WHERE t.desk = d.desk AND t.closed_at >= mo.starts AND t.closed_at < mo.ends) AS resolved,
                (SELECT count(*)::int FROM t WHERE t.desk = d.desk AND t.opened_at >= mo.starts AND t.opened_at < mo.ends AND (t.level > 1 OR t.escalated_at IS NOT NULL)) AS escalated,
                (SELECT count(*)::int FROM t WHERE t.desk = d.desk AND t.opened_at >= mo.starts AND t.opened_at < mo.ends AND t.breached_at IS NOT NULL) AS breached,
                (SELECT count(*)::int FROM t WHERE t.desk = d.desk AND t.opened_at >= mo.starts AND t.opened_at < mo.ends AND t.status <> 'closed') AS open,
                (SELECT round(avg(EXTRACT(epoch FROM (t.closed_at - t.opened_at)) / 3600)::numeric, 1)::float FROM t WHERE t.desk = d.desk AND t.closed_at >= mo.starts AND t.closed_at < mo.ends) AS avg_hours,
                (SELECT round(100.0 * count(*) FILTER (WHERE t.level = 1 AND t.breached_at IS NULL AND t.escalated_at IS NULL) / NULLIF(count(*), 0), 0)::int
                   FROM t WHERE t.desk = d.desk AND t.closed_at >= mo.starts AND t.closed_at < mo.ends) AS within_sla,
                (SELECT round(avg(t.rating)::numeric, 1)::float FROM t WHERE t.desk = d.desk AND t.closed_at >= mo.starts AND t.closed_at < mo.ends AND t.rating IS NOT NULL) AS rating
           FROM mo CROSS JOIN (VALUES ('parent'), ('staff'), ('provider')) AS d(desk)
          ORDER BY mo.month, array_position(ARRAY['parent', 'staff', 'provider'], d.desk)`,
        params,
      );
      const p2: unknown[] = [];
      const cond2 = this.visible(me, p2);
      const now = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- cond2 holds fixed fragments; values bound
        `SELECT q.desk, q.level, count(*)::int AS n, count(*) FILTER (WHERE q.due_at < now() AND q.status IN ('open', 'in_progress'))::int AS overdue
           FROM parent_queries q WHERE q.kind <> 'leave' AND q.status <> 'closed' AND ${cond2} GROUP BY 1, 2 ORDER BY 1, 2`,
        p2,
      );
      const p3: unknown[] = [];
      const cond3 = this.visible(me, p3);
      const heads = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- cond3 holds fixed fragments; values bound
        `SELECT q.desk, COALESCE(k.name, q.category_code) AS head, count(*)::int AS raised, count(*) FILTER (WHERE q.status <> 'closed')::int AS open,
                count(*) FILTER (WHERE q.level > 1 OR q.escalated_at IS NOT NULL)::int AS escalated
           FROM parent_queries q LEFT JOIN query_categories k ON k.school_id = q.school_id AND k.desk = q.desk AND k.code = q.category_code
          WHERE q.kind <> 'leave' AND q.opened_at >= date_trunc('month', now()) - interval '5 months' AND ${cond3}
          GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
        p3,
      );
      const p4: unknown[] = [];
      const cond4 = this.visible(me, p4);
      const overdue = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; cond4 holds fixed fragments; values bound
        `${SELECT} WHERE q.kind <> 'leave' AND q.status IN ('open', 'in_progress') AND q.due_at < now() AND ${cond4} ORDER BY q.due_at LIMIT 10`,
        p4,
      );
      return {
        months: months.rows.map((m) => ({
          month: String(m.month),
          desk: m.desk as Desk,
          raised: Number(m.raised),
          resolved: Number(m.resolved),
          escalated: Number(m.escalated),
          breached: Number(m.breached),
          open: Number(m.open),
          avgHours: (m.avg_hours as number | null) ?? null,
          withinSla: (m.within_sla as number | null) ?? null,
          rating: (m.rating as number | null) ?? null,
        })),
        openNow: now.rows.map((x) => ({
          desk: x.desk as Desk,
          level: Number(x.level),
          open: Number(x.n),
          overdue: Number(x.overdue),
        })),
        heads: heads.rows.map((h) => ({
          desk: h.desk as Desk,
          head: String(h.head),
          raised: Number(h.raised),
          open: Number(h.open),
          escalated: Number(h.escalated),
        })),
        overdue: overdue.rows.map(toTicket),
      };
    });
  }

  /** One sheet of tickets (the dashboard counts and the desk list share it). */
  private workbook(rows: TicketRow[], title: string): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Helpdesk');
    const ist = (v: string | null) =>
      v
        ? new Date(new Date(v).getTime() + 330 * 60_000)
            .toISOString()
            .slice(0, 16)
            .replace('T', ' ')
        : '';
    ws.addRow([title]);
    ws.getRow(1).font = { bold: true, size: 13 };
    const header = ws.addRow([
      'Number',
      'Desk',
      'Query type',
      'Subject',
      'Student',
      'Class',
      'Admission no.',
      'Raised by',
      'Raised on',
      'Status',
      'Level',
      'With',
      'Due',
      'Closed',
      'Hours to close',
      'Rating',
      'Resolution',
    ]);
    header.font = { bold: true };
    for (const t of rows)
      ws.addRow([
        t.number,
        DESK_LABEL[t.desk],
        t.head,
        t.subject,
        t.studentName ?? '',
        t.section ?? '',
        t.admissionNo ?? '',
        t.raisedBy ?? '',
        ist(t.openedAt),
        t.status,
        t.level,
        t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? '',
        ist(t.dueAt),
        ist(t.closedAt),
        t.closedAt
          ? Math.round((new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 36e5)
          : '',
        t.rating ?? '',
        t.resolution ?? '',
      ]);
    [14, 18, 22, 32, 22, 9, 13, 22, 17, 11, 6, 22, 17, 17, 9, 7, 40].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    return wb;
  }

  /** The desk list as it is filtered on screen, as Excel straight away (latest first). */
  async listXlsx(
    ctx: RequestContext,
    q: ExportTicketsDto,
  ): Promise<{ bytes: Buffer; filename: string }> {
    const v = await this.viewerOf(ctx);
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const params: unknown[] = [];
      const w = this.filterSql(me, q, params);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; the limit is a number; values bound
        `${SELECT} WHERE ${w} ORDER BY q.opened_at DESC, q.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toTicket);
    });
    const wb = this.workbook(rows, this.exportTitle(q, rows.length));
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `helpdesk-${q.desk ?? 'all'}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  /**
   * The same list as a PDF through the export queue. What a person may see depends on who they are, so
   * the tickets are chosen here and the worker only prints those ids.
   */
  async listPdf(ctx: RequestContext, q: ExportTicketsDto): Promise<{ id: string }> {
    const v = await this.viewerOf(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const params: unknown[] = [];
      const w = this.filterSql(me, q, params);
      const ids = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments; the limit is a number; values bound
        `SELECT q.id::text FROM parent_queries q LEFT JOIN students s ON s.id = q.student_id LEFT JOIN users ru ON ru.id = q.raised_by_user_id
          WHERE ${w} ORDER BY q.opened_at DESC, q.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      if (!ids.rows.length)
        throw new DomainError('validation-failed', 'There are no tickets for these filters.', {
          status: 400,
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), 'helpdesk_tickets', 'pdf', $1::jsonb, $2, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [JSON.stringify({ ids: ids.rows.map((x) => x.id) }), this.exportTitle(q, ids.rows.length)],
      );
      const id = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId: id });
      await this.audit.stage(ctx, c, {
        action: 'helpdesk.ticket.list_export',
        entityType: 'exports',
        entityId: id,
        after: { format: 'pdf', tickets: ids.rows.length, desk: q.desk ?? null },
      });
      return { id };
    });
  }

  private exportTitle(q: ExportTicketsDto, n: number): string {
    const status = { active: 'not closed', overdue: 'past due' }[q.status as string] ?? q.status;
    return [
      q.desk ? DESK_LABEL[q.desk] : 'Helpdesk',
      status,
      q.view === 'mine' ? 'raised by me' : q.view === 'assigned' ? 'assigned to me' : null,
      q.q ? `"${q.q}"` : null,
      `${String(n)} tickets`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** The tickets behind a dashboard count, as Excel. */
  async report(
    ctx: RequestContext,
    q: HelpdeskReportDto,
  ): Promise<{ bytes: Buffer; filename: string }> {
    const v = await this.viewerOf(ctx);
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.me(ctx, c, v);
      const params: unknown[] = [q.month];
      const cond = this.visible(me, params);
      const inMonth = (col: string) =>
        `${col} >= ($1 || '-01')::date::timestamp AT TIME ZONE 'Asia/Kolkata' AND ${col} < (($1 || '-01')::date + interval '1 month')::date::timestamp AT TIME ZONE 'Asia/Kolkata'`;
      const bucket = {
        raised: inMonth('q.opened_at'),
        resolved: inMonth('q.closed_at'),
        escalated: `${inMonth('q.opened_at')} AND (q.level > 1 OR q.escalated_at IS NOT NULL)`,
        breached: `${inMonth('q.opened_at')} AND q.breached_at IS NOT NULL`,
        open: `${inMonth('q.opened_at')} AND q.status <> 'closed'`,
      }[q.bucket];
      if (q.desk) params.push(q.desk);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; bucket and cond are fixed fragments; values bound
        `${SELECT} WHERE q.kind <> 'leave' AND ${bucket} AND ${cond} ${q.desk ? `AND q.desk = $${params.length}` : ''} ORDER BY q.opened_at`,
        params,
      );
      return r.rows.map(toTicket);
    });
    const wb = this.workbook(
      rows,
      `Helpdesk · ${q.month} · ${q.desk ? DESK_LABEL[q.desk] : 'All desks'} · ${q.bucket} · ${String(rows.length)} tickets`,
    );
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `helpdesk-${q.month}-${q.bucket}.xlsx`,
    };
  }
}
