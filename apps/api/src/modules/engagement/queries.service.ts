import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService, type Viewer } from '../academics/daily/viewer.service';
import type { SendMessageDto } from '../comms/comms.dto';
import { MessagesService } from '../comms/messages.service';
import { HelpdeskService } from './helpdesk.service';
import {
  DEFAULT_QUERY_CATEGORIES,
  type AssignDto,
  type CloseDto,
  type CreateQueryDto,
  type ListQueriesDto,
  type RateDto,
  type RespondDto,
} from './engagement.dto';

export interface QueryRow {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryCode: string;
  categoryName: string;
  studentId: string;
  studentName: string;
  section: string | null;
  raisedBy: string | null;
  raisedByUserId: string;
  subject: string;
  body: string;
  fileIds: string[];
  leaveFrom: string | null;
  leaveTo: string | null;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  assignedRole: string | null;
  assignedTo: string | null;
  assignedUserId: string | null;
  decision: string | null;
  rating: number | null;
  ratingComment: string | null;
  openedAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
  responses?: Array<{
    id: string;
    author: string | null;
    authorKind: 'guardian' | 'student' | 'staff';
    body: string;
    fileIds: string[];
    isInternal: boolean;
    createdAt: string;
  }>;
}

const SELECT = `SELECT q.id::text, q.number, q.kind::text, q.category_code, COALESCE(qc.name, q.category_code) AS category_name, q.student_id::text, s.display_name AS student_name,
        (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.academic_year_id = q.academic_year_id AND e.status = 'active' LIMIT 1) AS section,
        u.display_name AS raised_by, q.raised_by_user_id::text, q.subject, q.body, q.file_ids, q.leave_from::text, q.leave_to::text, q.status::text, q.assigned_role, COALESCE((SELECT emp.display_name FROM employees emp WHERE emp.user_id = a.id LIMIT 1), a.display_name) AS assigned_to, q.assigned_user_id::text,
        q.decision, q.rating, q.rating_comment, q.opened_at, q.first_response_at, q.closed_at
   FROM parent_queries q JOIN students s ON s.id = q.student_id LEFT JOIN users u ON u.id = q.raised_by_user_id LEFT JOIN users a ON a.id = q.assigned_user_id
   LEFT JOIN query_categories qc ON qc.school_id = q.school_id AND qc.desk = q.desk AND qc.code = q.category_code`;

/**
 * Parent queries, complaints and leave requests (S10, legacy parent_query + parent_query_responses +
 * Student_Leave_Transaction). Families raise for their own children; staff see them through the same
 * class-section scopes as attendance, answer, assign, close; families rate the handling.
 */
@Injectable()
export class QueriesService {
  private readonly log = new Logger(QueriesService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly messages: MessagesService,
    private readonly helpdesk: HelpdeskService,
  ) {}

  async categories(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const r = await c.query<{ code: string; name: string; route_to: string }>(
        `SELECT code, name, route_to FROM query_categories WHERE desk = 'parent' AND status = 'active' ORDER BY sort_order, name`,
      );
      if (r.rows.length)
        return r.rows.map((x) => ({ code: x.code, name: x.name, routeTo: x.route_to }));
      return DEFAULT_QUERY_CATEGORIES;
    });
  }

  async create(ctx: RequestContext, dto: CreateQueryDto): Promise<QueryRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, 'engagement.query.create');
    if (v.kind === 'family' && !v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    const categories = await this.categories(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.helpdesk.checkFiles(c, dto.fileIds);
      const cat =
        categories.find((k) => k.code === dto.categoryCode) ??
        categories.find((k) => k.code === 'other')!;
      const no = await c.query<{ n: string }>(`SELECT app.next_query_no($1) AS n`, [yearId]);
      const r = await c.query<{ id: string }>(
        `INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, student_id, raised_by_user_id, subject, body, file_ids, leave_from, leave_to, assigned_role, request_id)
         VALUES (app.current_school_id(), $1, $2, $3::query_kind, $4, $5, app.current_user_id(), $6, $7, $8::jsonb, $9::date, $10::date, $11, app.current_request_id()) RETURNING id::text`,
        [
          yearId,
          no.rows[0]!.n,
          dto.kind,
          cat.code,
          dto.studentId,
          dto.subject,
          dto.body,
          JSON.stringify(dto.fileIds),
          dto.leaveFrom ?? null,
          dto.leaveTo ?? null,
          cat.routeTo,
        ],
      );
      const id = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'engagement.query.create',
        entityType: 'parent_queries',
        entityId: id,
        after: {
          number: no.rows[0]!.n,
          kind: dto.kind,
          category: cat.code,
          studentId: dto.studentId,
        },
      });
      // the class teacher / owner hears of it at once (app alert, mail for roles)
      if (dto.kind !== 'leave') await this.helpdesk.notifyOwner(c, id, 'new');
      return this.find(c, id, true);
    });
  }

  async list(ctx: RequestContext, q: ListQueriesDto) {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, 'engagement.query.view');
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [];
      const where: string[] = [];
      this.visibility(v, where, params);
      if (q.status) {
        params.push(q.status);
        where.push(`q.status = $${params.length}::query_status`);
      }
      if (q.kind) {
        params.push(q.kind);
        where.push(`q.kind = $${params.length}::query_kind`);
      }
      if (q.categoryCode) {
        params.push(q.categoryCode);
        where.push(`q.category_code = $${params.length}`);
      }
      if (q.studentId) {
        params.push(q.studentId);
        where.push(`q.student_id = $${params.length}`);
      }
      const whereSql = where.length ? where.join(' AND ') : 'true';
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql holds fixed fragments with numbered placeholders; values are bound parameters
        `SELECT count(*)::text AS n FROM parent_queries q WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY (q.status IN ('open', 'in_progress')) DESC, q.opened_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: r.rows.map(toRow),
        page: { number: q.page, size: q.size, total: Number(total.rows[0]!.n) },
      };
    });
  }

  async get(ctx: RequestContext, id: string, permission: string): Promise<QueryRow> {
    const v = await this.viewer.resolve(ctx, permission);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.find(c, id, v.kind === 'family');
      this.assertVisible(v, row);
      return row;
    });
  }

  async respond(
    ctx: RequestContext,
    id: string,
    dto: RespondDto,
    permission: string,
  ): Promise<QueryRow> {
    const v = await this.viewer.resolve(ctx, permission);
    const staff = v.kind === 'staff';
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id, !staff);
      this.assertVisible(v, before);
      if (before.status === 'closed')
        throw new DomainError('engagement.query.closed', 'This query is closed', { status: 409 });
      await this.helpdesk.checkFiles(c, dto.fileIds);
      await c.query(
        `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body, file_ids, is_internal) VALUES (app.current_school_id(), $1, app.current_user_id(), $2::author_kind, $3, $4::jsonb, $5)`,
        [
          id,
          staff
            ? 'staff'
            : v.students.some((s) => s.id === before.studentId && s.id === ctx.user.id)
              ? 'student'
              : 'guardian',
          dto.body,
          JSON.stringify(dto.fileIds),
          staff && dto.isInternal,
        ],
      );
      if (staff && !dto.isInternal) {
        await c.query(
          `UPDATE parent_queries SET status = 'answered', first_response_at = COALESCE(first_response_at, now()), assigned_user_id = COALESCE(assigned_user_id, app.current_user_id()), updated_at = now() WHERE id = $1`,
          [id],
        );
        await this.notify(c, ctx, before, dto.body);
      } else if (!staff) {
        await c.query(
          `UPDATE parent_queries SET status = 'open', updated_at = now() WHERE id = $1`,
          [id],
        );
        if (before.kind !== 'leave') await this.helpdesk.notifyOwner(c, id, 'reply', dto.body);
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.query.respond',
        entityType: 'parent_queries',
        entityId: id,
        after: { staff, internal: staff && dto.isInternal },
      });
      return this.find(c, id, !staff);
    });
  }

  async assign(ctx: RequestContext, id: string, dto: AssignDto): Promise<QueryRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.find(c, id, false);
      await c.query(
        `UPDATE parent_queries SET assigned_user_id = $2, status = CASE WHEN status = 'open' THEN 'in_progress'::query_status ELSE status END, updated_at = now() WHERE id = $1`,
        [id, dto.userId],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.query.assign',
        entityType: 'parent_queries',
        entityId: id,
        after: { userId: dto.userId },
      });
      return this.find(c, id, false);
    });
  }

  async close(ctx: RequestContext, id: string, dto: CloseDto): Promise<QueryRow> {
    const v = await this.viewer.resolve(ctx, 'engagement.query.respond');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id, false);
      this.assertVisible(v, before);
      if (before.kind === 'leave' && !dto.decision)
        throw new DomainError('validation-failed', 'A leave request is closed with a decision', {
          status: 400,
        });
      if (dto.note)
        await c.query(
          `INSERT INTO query_responses (school_id, query_id, author_user_id, author_kind, body) VALUES (app.current_school_id(), $1, app.current_user_id(), 'staff', $2)`,
          [id, dto.note],
        );
      await c.query(
        `UPDATE parent_queries SET status = 'closed', decision = $2, closed_at = now(), closed_by = app.current_user_id(), first_response_at = COALESCE(first_response_at, now()), updated_at = now() WHERE id = $1`,
        [id, dto.decision ?? null],
      );
      await this.notify(
        c,
        ctx,
        before,
        dto.note ??
          (dto.decision
            ? `Your ${before.kind} request was ${dto.decision}.`
            : 'Your query has been closed.'),
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.query.close',
        entityType: 'parent_queries',
        entityId: id,
        after: { decision: dto.decision ?? null },
      });
      return this.find(c, id, false);
    });
  }

  async rate(ctx: RequestContext, id: string, dto: RateDto): Promise<QueryRow> {
    const v = await this.viewer.resolve(ctx, 'engagement.query.create');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id, true);
      this.assertVisible(v, before);
      if (!['answered', 'closed'].includes(before.status))
        throw new DomainError(
          'engagement.query.not_answered',
          'Rate the handling once the query is answered',
          { status: 409 },
        );
      await c.query(
        `UPDATE parent_queries SET rating = $2, rating_comment = $3, updated_at = now() WHERE id = $1`,
        [id, dto.rating, dto.comment ?? null],
      );
      return this.find(c, id, true);
    });
  }

  /** Staff see their scope (class teachers: their sections); families see their own children's queries. */
  private visibility(v: Viewer, where: string[], params: unknown[]) {
    if (v.kind === 'family') {
      params.push(v.students.map((s) => s.id));
      where.push(`q.student_id = ANY($${params.length}::bigint[])`);
    } else if (v.sectionIds) {
      params.push(v.sectionIds);
      where.push(
        // eslint-disable-next-line no-restricted-syntax -- placeholder number only; the section ids are a bound parameter
        `EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = q.student_id AND e.academic_year_id = q.academic_year_id AND e.status = 'active' AND e.class_section_id = ANY($${params.length}::bigint[]))`,
      );
    }
  }

  private assertVisible(v: Viewer, row: QueryRow) {
    if (v.kind === 'family' && !v.students.some((s) => s.id === row.studentId))
      throw new DomainError('not-found', 'Query not found', { status: 404 });
  }

  private async notify(c: PoolClient, ctx: RequestContext, q: QueryRow, text: string) {
    const g = await c.query<{ mobile: string | null }>(
      `SELECT g.mobile FROM guardians g WHERE g.user_id = $1 LIMIT 1`,
      [q.raisedByUserId],
    );
    if (!g.rows[0]?.mobile) return;
    try {
      await this.messages.sendWith(c, ctx, {
        templateCode: 'query_reply',
        channel: 'whatsapp',
        recipientUserId: q.raisedByUserId,
        recipientAddress: g.rows[0].mobile,
        variables: { query_no: q.number, student_name: q.studentName, reply: text.slice(0, 500) },
      } as SendMessageDto);
    } catch (error) {
      if (error instanceof DomainError && error.type === 'comms.template.not_found') {
        this.log.warn({ queryId: q.id }, 'query_reply template missing; no notification sent');
        return;
      }
      throw error;
    }
  }

  private async find(c: PoolClient, id: string, hideInternal: boolean): Promise<QueryRow> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
    const r = await c.query<Record<string, unknown>>(`${SELECT} WHERE q.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Query not found', { status: 404 });
    const row = toRow(r.rows[0]);
    const resp = await c.query<{
      id: string;
      author: string | null;
      author_kind: QueryRow['responses'] extends Array<infer T>
        ? T extends { authorKind: infer K }
          ? K
          : never
        : never;
      body: string;
      file_ids: string[];
      is_internal: boolean;
      created_at: Date;
    }>(
      `SELECT x.id::text, COALESCE((SELECT emp.display_name FROM employees emp WHERE emp.user_id = u.id LIMIT 1), u.display_name) AS author, x.author_kind::text AS author_kind, x.body, x.file_ids, x.is_internal, x.created_at
         FROM query_responses x LEFT JOIN users u ON u.id = x.author_user_id WHERE x.query_id = $1 AND ($2 = false OR x.is_internal = false) ORDER BY x.created_at`,
      [id, hideInternal],
    );
    row.responses = resp.rows.map((x) => ({
      id: x.id,
      author: x.author,
      authorKind: x.author_kind,
      body: x.body,
      fileIds: x.file_ids ?? [],
      isInternal: x.is_internal,
      createdAt: x.created_at.toISOString(),
    }));
    return row;
  }
}

const toRow = (x: Record<string, unknown>): QueryRow => {
  const d = (k: string) => (x[k] ? (x[k] as Date).toISOString() : null);
  return {
    id: x.id as string,
    number: x.number as string,
    kind: x.kind as QueryRow['kind'],
    categoryCode: x.category_code as string,
    categoryName: x.category_name as string,
    studentId: x.student_id as string,
    studentName: x.student_name as string,
    section: (x.section as string) ?? null,
    raisedBy: (x.raised_by as string) ?? null,
    raisedByUserId: x.raised_by_user_id as string,
    subject: x.subject as string,
    body: x.body as string,
    fileIds: (x.file_ids as string[]) ?? [],
    leaveFrom: (x.leave_from as string) ?? null,
    leaveTo: (x.leave_to as string) ?? null,
    status: x.status as QueryRow['status'],
    assignedRole: (x.assigned_role as string) ?? null,
    assignedTo: (x.assigned_to as string) ?? null,
    assignedUserId: (x.assigned_user_id as string) ?? null,
    decision: (x.decision as string) ?? null,
    rating: (x.rating as number) ?? null,
    ratingComment: (x.rating_comment as string) ?? null,
    openedAt: d('opened_at')!,
    firstResponseAt: d('first_response_at'),
    closedAt: d('closed_at'),
  };
};
