/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (SELECT lists, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { FilesService } from '../files/files.service';
import type { FileDecideDto, FileListDto, FileNoteDto } from './file-movement.dto';
import { fileNotePdf, htmlToLines } from './file-note-pdf';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const RAISE = 'files.movement.raise';
const REPORT = 'files.movement.report';
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);
const ist = (v: unknown): string =>
  v instanceof Date
    ? v.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : '';
export const FILE_STATUS: Record<string, string> = {
  pending: 'In approval',
  returned: 'Sent back',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
const NAME = (userCol: string) =>
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${userCol} AND e.deleted_at IS NULL LIMIT 1), (SELECT u.display_name FROM users u WHERE u.id = ${userCol}))`;

const NOTE = `SELECT n.id::text, COALESCE(n.number, 'FM-' || n.id::text) AS number, n.subject, n.status, n.round, n.created_by::text,
       ${NAME('n.created_by')} AS creator,
       (SELECT e.designation FROM employees e WHERE e.user_id = n.created_by AND e.deleted_at IS NULL LIMIT 1) AS creator_designation,
       n.created_at, n.submitted_at, n.closed_at, jsonb_array_length(n.file_ids) AS files_n,
       (SELECT count(*) FROM file_note_levels l WHERE l.note_id = n.id AND l.round = n.round)::int AS levels_n,
       (SELECT count(*) FROM file_note_levels l WHERE l.note_id = n.id AND l.round = n.round AND l.status = 'approved')::int AS approved_n,
       (SELECT 'L' || l.level || ' · ' || e.display_name FROM file_note_levels l JOIN employees e ON e.id = l.employee_id
         WHERE l.note_id = n.id AND l.round = n.round AND l.status = 'pending' LIMIT 1) AS waiting_on,
       EXISTS (SELECT 1 FROM file_note_levels l WHERE l.note_id = n.id AND l.round = n.round AND l.status = 'pending' AND l.user_id = app.current_user_id()) AS mine_now,
       (n.created_by = app.current_user_id()) AS mine_file
  FROM file_notes n`;

const toNote = (x: Row) => ({
  id: String(x.id),
  number: String(x.number),
  subject: String(x.subject),
  status: String(x.status) as 'pending' | 'returned' | 'approved' | 'rejected' | 'withdrawn',
  statusLabel: FILE_STATUS[String(x.status)] ?? String(x.status),
  round: Number(x.round),
  createdById: String(x.created_by),
  createdBy: text(x.creator) ?? '',
  designation: text(x.creator_designation),
  createdAt: iso(x.created_at)!,
  submittedAt: iso(x.submitted_at)!,
  closedAt: iso(x.closed_at),
  attachments: Number(x.files_n ?? 0),
  levels: Number(x.levels_n ?? 0),
  approvedLevels: Number(x.approved_n ?? 0),
  waitingOn: text(x.waiting_on),
  /** The file is with this person now. */
  mineNow: Boolean(x.mine_now),
  /** This person raised the file. */
  mineFile: Boolean(x.mine_file),
});
export type FileNote = ReturnType<typeof toNote>;

/** The note as the editor may write it: headings, emphasis, lists, quotes, links and simple tables. */
const clean = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'div',
      'span',
    ],
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
      }),
      h1: 'h2',
    },
  }).trim();

/**
 * Digital file movement (0090): a member of staff raises a file with a note, attachments and the
 * approvers they choose (level 1 to 5, by name). It moves level by level; an approver approves, sends it
 * back with a remark (the creator corrects and it starts again from level 1) or rejects it. Every step
 * is the history. An approved file comes as a PDF note sheet. The school's office sees every file on a
 * dashboard and a report.
 */
@Injectable()
export class FileMovementService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private assertHolds(ctx: RequestContext, ...any: string[]) {
    if (!any.some((p) => ctx.permissions?.has(p)))
      throw new DomainError('forbidden', 'File movement is not part of your role', {
        status: 403,
        extra: { permission: any[0] },
      });
  }

  private sees(ctx: RequestContext): boolean {
    return ctx.permissions?.has(REPORT) === true;
  }

  /** The people who can be chosen as approvers: active employees with a login, without oneself. */
  async people(ctx: RequestContext) {
    this.assertHolds(ctx, RAISE);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; name: string }>(
        `SELECT e.id::text, e.display_name || COALESCE(' · ' || e.designation, '') || ' (' || e.employee_code || ')' AS name
           FROM employees e WHERE e.status = 'active' AND e.deleted_at IS NULL AND e.user_id IS NOT NULL AND e.user_id <> app.current_user_id()
          ORDER BY e.display_name LIMIT 2000`,
      );
      return { data: r.rows };
    });
  }

  private async checkFiles(c: PoolClient, fileIds: string[], noteId?: string) {
    if (!fileIds.length) return;
    // a new attachment is the person's own upload; one already on the file stays
    const r = await c.query<{ ok: boolean }>(
      `SELECT ((f.status = 'ready' AND f.created_by = app.current_user_id() AND f.size_bytes <= 5242880
                AND f.content_type ~ '^(application/pdf|image/(png|jpeg|webp))$')
               OR EXISTS (SELECT 1 FROM file_notes n WHERE n.id = $2 AND n.file_ids ? f.id::text)) AS ok
         FROM files f WHERE f.id = ANY($1::bigint[])`,
      [fileIds, noteId ?? null],
    );
    if (r.rows.length !== new Set(fileIds).size || r.rows.some((x) => !x.ok))
      throw new DomainError(
        'validation-failed',
        'Attach your own PDF or image files of up to 5 MB',
        {
          status: 400,
          extra: { errors: { files: 'Attach your own PDF or image files of up to 5 MB' } },
        },
      );
  }

  /** The levels of a round: level 1 is asked first. */
  private async setLevels(c: PoolClient, noteId: string, round: number, approverIds: string[]) {
    const r = await c.query<{ id: string; user_id: string | null; mine: boolean }>(
      `SELECT e.id::text, e.user_id::text, (e.user_id = app.current_user_id()) AS mine FROM employees e
        WHERE e.id = ANY($1::bigint[]) AND e.status = 'active' AND e.deleted_at IS NULL`,
      [approverIds],
    );
    const fail = (message: string): never => {
      throw new DomainError('validation-failed', message, {
        status: 400,
        extra: { errors: { approverIds: message } },
      });
    };
    if (r.rows.length !== approverIds.length) fail('An approver is not an active employee');
    if (r.rows.some((x) => !x.user_id)) fail('An approver has no login yet');
    if (r.rows.some((x) => x.mine)) fail('You cannot be an approver of your own file');
    for (const [i, employeeId] of approverIds.entries())
      await c.query(
        `INSERT INTO file_note_levels (school_id, note_id, round, level, employee_id, user_id, status)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
        [
          noteId,
          round,
          i + 1,
          employeeId,
          r.rows.find((x) => x.id === employeeId)!.user_id,
          i === 0 ? 'pending' : 'waiting',
        ],
      );
  }

  private async event(
    c: PoolClient,
    noteId: string,
    round: number,
    action: string,
    level: number | null,
    remark: string | null,
  ) {
    await c.query(
      `INSERT INTO file_note_events (school_id, note_id, round, action, level, by_user, remark)
       VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), $5)`,
      [noteId, round, action, level, remark],
    );
  }

  async create(ctx: RequestContext, dto: FileNoteDto) {
    this.assertHolds(ctx, RAISE);
    const body = clean(dto.bodyHtml);
    if (!body.replace(/<[^>]+>/g, '').trim())
      throw new DomainError('validation-failed', 'Write the message', {
        status: 400,
        extra: { errors: { bodyHtml: 'Write the message' } },
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.checkFiles(c, dto.fileIds);
      const r = await c.query<{ id: string }>(
        `INSERT INTO file_notes (school_id, subject, body_html, file_ids, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, app.current_user_id()) RETURNING id::text`,
        [dto.subject, body, JSON.stringify(dto.fileIds)],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `UPDATE file_notes SET number = 'FM-' || to_char(created_at AT TIME ZONE ${TZ}, 'YYMM') || '-' || lpad(id::text, 4, '0') WHERE id = $1`,
        [id],
      );
      await this.setLevels(c, id, 1, dto.approverIds);
      await this.event(c, id, 1, 'submitted', null, null);
      await this.audit.stage(ctx, c, {
        action: 'files.movement.create',
        entityType: 'file_notes',
        entityId: id,
        after: { subject: dto.subject, approvers: dto.approverIds.length },
      });
      return this.detail(c, ctx, id);
    });
  }

  private async find(c: PoolClient, id: string): Promise<FileNote> {
    const r = await c.query<Row>(`${NOTE} WHERE n.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
    return toNote(r.rows[0]);
  }

  /** The creator, anyone who is or was an approver of it, and the office that sees every file. */
  private async assertMaySee(c: PoolClient, ctx: RequestContext, id: string) {
    if (this.sees(ctx)) return;
    const r = await c.query(
      `SELECT 1 FROM file_notes n WHERE n.id = $1 AND (n.created_by = app.current_user_id()
          OR EXISTS (SELECT 1 FROM file_note_levels l WHERE l.note_id = n.id AND l.user_id = app.current_user_id() AND l.status <> 'waiting'))`,
      [id],
    );
    if (!r.rowCount) throw new DomainError('not-found', 'File not found', { status: 404 });
  }

  private async detail(c: PoolClient, ctx: RequestContext, id: string) {
    const note = await this.find(c, id);
    const body = await c.query<{ body_html: string; file_ids: unknown[] }>(
      `SELECT body_html, file_ids FROM file_notes WHERE id = $1`,
      [id],
    );
    const fileIds = (body.rows[0]!.file_ids ?? []).map(String);
    const files = await c.query<{ id: string; name: string | null }>(
      `SELECT id::text, original_name AS name FROM files WHERE id = ANY($1::bigint[])`,
      [fileIds],
    );
    const levels = await c.query<Row>(
      `SELECT l.round, l.level, l.employee_id::text, e.display_name AS name, e.designation, l.status, l.remark, l.acted_at,
              (l.user_id = app.current_user_id()) AS mine
         FROM file_note_levels l JOIN employees e ON e.id = l.employee_id WHERE l.note_id = $1 ORDER BY l.round, l.level`,
      [id],
    );
    const events = await c.query<Row>(
      `SELECT v.round, v.action, v.level, v.remark, v.at, ${NAME('v.by_user')} AS by_name
         FROM file_note_events v WHERE v.note_id = $1 ORDER BY v.id`,
      [id],
    );
    const all = levels.rows.map((x) => ({
      round: Number(x.round),
      level: Number(x.level),
      employeeId: String(x.employee_id),
      name: String(x.name),
      designation: text(x.designation),
      status: String(x.status),
      remark: text(x.remark),
      actedAt: iso(x.acted_at),
      mine: Boolean(x.mine),
    }));
    const mine = note.mineFile;
    return {
      ...note,
      bodyHtml: body.rows[0]!.body_html,
      files: fileIds.map((f) => ({
        id: f,
        name: files.rows.find((x) => x.id === f)?.name ?? 'Attachment',
      })),
      /** The levels of the round that is running (or was the last). */
      levelsNow: all.filter((l) => l.round === note.round),
      history: events.rows.map((x) => ({
        round: Number(x.round),
        action: String(x.action),
        level: x.level === null ? null : Number(x.level),
        remark: text(x.remark),
        at: iso(x.at)!,
        by: text(x.by_name) ?? '',
      })),
      isCreator: mine,
      canDecide: note.status === 'pending' && note.mineNow,
      canResubmit: mine && note.status === 'returned',
      canWithdraw: mine && (note.status === 'pending' || note.status === 'returned'),
      canDownload: note.status === 'approved',
    };
  }

  async get(ctx: RequestContext, id: string) {
    this.assertHolds(ctx, RAISE, REPORT);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMaySee(c, ctx, id);
      return this.detail(c, ctx, id);
    });
  }

  /** The creator corrects a file that was sent back: it starts again from level 1. */
  async resubmit(ctx: RequestContext, id: string, dto: FileNoteDto) {
    this.assertHolds(ctx, RAISE);
    const body = clean(dto.bodyHtml);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM file_notes WHERE id = $1 FOR UPDATE`, [id]);
      const n = await this.find(c, id);
      if (!n.mineFile) throw new DomainError('not-found', 'File not found', { status: 404 });
      if (n.status !== 'returned')
        throw new DomainError(
          'file.not_returned',
          'Only a file that was sent back can be changed',
          {
            status: 409,
          },
        );
      await this.checkFiles(c, dto.fileIds, id);
      const round = n.round + 1;
      await c.query(
        `UPDATE file_notes SET subject = $2, body_html = $3, file_ids = $4::jsonb, status = 'pending', round = $5, submitted_at = now(), updated_at = now() WHERE id = $1`,
        [id, dto.subject, body, JSON.stringify(dto.fileIds), round],
      );
      await this.setLevels(c, id, round, dto.approverIds);
      await this.event(c, id, round, 'resubmitted', null, null);
      await this.audit.stage(ctx, c, {
        action: 'files.movement.resubmit',
        entityType: 'file_notes',
        entityId: id,
        after: { round },
      });
      return this.detail(c, ctx, id);
    });
  }

  async decide(ctx: RequestContext, id: string, dto: FileDecideDto) {
    this.assertHolds(ctx, RAISE);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM file_notes WHERE id = $1 FOR UPDATE`, [id]);
      const n = await this.find(c, id);
      const mine = await c.query<{ id: string; level: number }>(
        `SELECT id::text, level FROM file_note_levels WHERE note_id = $1 AND round = $2 AND status = 'pending' AND user_id = app.current_user_id()`,
        [id, n.round],
      );
      if (n.status !== 'pending' || !mine.rows[0])
        throw new DomainError('forbidden', 'This file is not waiting for your approval', {
          status: 403,
        });
      await c.query(
        `UPDATE file_note_levels SET status = $2, remark = $3, acted_at = now() WHERE id = $1`,
        [mine.rows[0].id, dto.outcome, dto.remark ?? null],
      );
      await this.event(c, id, n.round, dto.outcome, mine.rows[0].level, dto.remark ?? null);
      if (dto.outcome === 'approved') {
        const next = await c.query(
          `UPDATE file_note_levels SET status = 'pending' WHERE id = (
             SELECT id FROM file_note_levels WHERE note_id = $1 AND round = $2 AND status = 'waiting' ORDER BY level LIMIT 1)`,
          [id, n.round],
        );
        if (!next.rowCount)
          await c.query(
            `UPDATE file_notes SET status = 'approved', closed_at = now(), updated_at = now() WHERE id = $1`,
            [id],
          );
      } else {
        // sent back or rejected: the later levels of this round are not asked
        await c.query(
          `UPDATE file_note_levels SET status = 'void' WHERE note_id = $1 AND round = $2 AND status = 'waiting'`,
          [id, n.round],
        );
        await c.query(
          `UPDATE file_notes SET status = $2, closed_at = CASE WHEN $2 = 'rejected' THEN now() END, updated_at = now() WHERE id = $1`,
          [id, dto.outcome],
        );
      }
      await this.audit.stage(ctx, c, {
        action: `files.movement.${dto.outcome}`,
        entityType: 'file_notes',
        entityId: id,
        after: { level: mine.rows[0].level, remark: dto.remark ?? null },
      });
      return this.detail(c, ctx, id);
    });
  }

  async withdraw(ctx: RequestContext, id: string) {
    this.assertHolds(ctx, RAISE);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM file_notes WHERE id = $1 FOR UPDATE`, [id]);
      const n = await this.find(c, id);
      if (!n.mineFile) throw new DomainError('not-found', 'File not found', { status: 404 });
      if (n.status !== 'pending' && n.status !== 'returned')
        throw new DomainError('file.closed', 'This file is already closed', { status: 409 });
      await c.query(
        `UPDATE file_note_levels SET status = 'void' WHERE note_id = $1 AND round = $2 AND status IN ('pending', 'waiting')`,
        [id, n.round],
      );
      await c.query(
        `UPDATE file_notes SET status = 'withdrawn', closed_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.event(c, id, n.round, 'withdrawn', null, null);
      return this.detail(c, ctx, id);
    });
  }

  // ---- lists, the dashboard and the report ----------------------------------------------------------
  private where(ctx: RequestContext, q: FileListDto, params: unknown[]): string {
    const w: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      w.push(sql.replaceAll('?', `$${String(params.length)}`));
    };
    if (q.box === 'inbox')
      w.push(
        `n.status = 'pending' AND EXISTS (SELECT 1 FROM file_note_levels l WHERE l.note_id = n.id AND l.round = n.round AND l.status = 'pending' AND l.user_id = app.current_user_id())`,
      );
    else if (q.box === 'mine') w.push(`n.created_by = app.current_user_id()`);
    else if (q.box === 'acted')
      w.push(
        `EXISTS (SELECT 1 FROM file_note_levels l WHERE l.note_id = n.id AND l.user_id = app.current_user_id() AND l.status IN ('approved', 'returned', 'rejected'))`,
      );
    else if (!this.sees(ctx))
      // "all" without the office's permission: everything the person raised or was asked about
      w.push(
        `(n.created_by = app.current_user_id() OR EXISTS (SELECT 1 FROM file_note_levels l WHERE l.note_id = n.id AND l.user_id = app.current_user_id() AND l.status <> 'waiting'))`,
      );
    if (q.status) add(`n.status = ?`, q.status);
    if (q.from) add(`(n.created_at AT TIME ZONE ${TZ})::date >= ?::date`, q.from);
    if (q.to) add(`(n.created_at AT TIME ZONE ${TZ})::date <= ?::date`, q.to);
    if (q.creatorId)
      add(`n.created_by = (SELECT e.user_id FROM employees e WHERE e.id = ?::bigint)`, q.creatorId);
    if (q.approverId)
      add(
        `EXISTS (SELECT 1 FROM file_note_levels l WHERE l.note_id = n.id AND l.employee_id = ?::bigint)`,
        q.approverId,
      );
    if (q.q)
      add(
        `(n.subject ILIKE '%' || ? || '%' OR n.number ILIKE '%' || ? || '%' OR ${NAME('n.created_by')} ILIKE '%' || ? || '%')`,
        q.q,
      );
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }

  async list(ctx: RequestContext, q: FileListDto) {
    this.assertHolds(ctx, RAISE, REPORT);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.where(ctx, q, params);
      const r = await c.query<Row>(
        `${NOTE} ${w} ORDER BY n.submitted_at DESC, n.id DESC LIMIT 500`,
        params,
      );
      const counts = await c.query<{ inbox: number; returned: number }>(
        `SELECT (SELECT count(*) FROM file_note_levels l JOIN file_notes n ON n.id = l.note_id AND n.round = l.round AND n.status = 'pending'
                  WHERE l.status = 'pending' AND l.user_id = app.current_user_id())::int AS inbox,
                (SELECT count(*) FROM file_notes n WHERE n.created_by = app.current_user_id() AND n.status = 'returned')::int AS returned`,
      );
      return {
        data: r.rows.map(toNote),
        inbox: counts.rows[0]!.inbox,
        returned: counts.rows[0]!.returned,
        seesAll: this.sees(ctx),
      };
    });
  }

  /** The figures of the files the person may see: by status, month by month, who holds what, how long. */
  async dashboard(ctx: RequestContext) {
    this.assertHolds(ctx, RAISE, REPORT);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.where(ctx, { box: 'all' } as FileListDto, params);
      const scope = `scope AS (SELECT n.* FROM file_notes n ${w})`;
      const status = await c.query<{ status: string; n: number }>(
        `WITH ${scope} SELECT status, count(*)::int AS n FROM scope GROUP BY status`,
        params,
      );
      const months = await c.query<{
        m: string;
        raised: number;
        approved: number;
        rejected: number;
      }>(
        `WITH ${scope}
         SELECT to_char(g, 'YYYY-MM') AS m,
                (SELECT count(*) FROM scope s WHERE date_trunc('month', s.created_at AT TIME ZONE ${TZ}) = g)::int AS raised,
                (SELECT count(*) FROM scope s WHERE s.status = 'approved' AND date_trunc('month', s.closed_at AT TIME ZONE ${TZ}) = g)::int AS approved,
                (SELECT count(*) FROM scope s WHERE s.status = 'rejected' AND date_trunc('month', s.closed_at AT TIME ZONE ${TZ}) = g)::int AS rejected
           FROM generate_series(date_trunc('month', (now() AT TIME ZONE ${TZ})) - interval '5 months', date_trunc('month', (now() AT TIME ZONE ${TZ})), interval '1 month') g
          ORDER BY 1`,
        params,
      );
      const holders = await c.query<{ name: string; n: number; oldest: Date }>(
        `WITH ${scope}
         SELECT e.display_name AS name, count(*)::int AS n, min(s.submitted_at) AS oldest
           FROM scope s JOIN file_note_levels l ON l.note_id = s.id AND l.round = s.round AND l.status = 'pending'
           JOIN employees e ON e.id = l.employee_id
          WHERE s.status = 'pending' GROUP BY e.display_name ORDER BY n DESC, oldest LIMIT 12`,
        params,
      );
      const time = await c.query<{ hours: number | null; rounds: number | null }>(
        `WITH ${scope}
         SELECT round((avg(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600))::numeric, 1)::float AS hours, round(avg(round)::numeric, 2)::float AS rounds
           FROM scope WHERE status = 'approved'`,
        params,
      );
      const oldest = await c.query<Row>(
        `${NOTE} JOIN (SELECT id FROM (WITH ${scope} SELECT id, submitted_at FROM scope WHERE status = 'pending' ORDER BY submitted_at LIMIT 8) x) o ON o.id = n.id ORDER BY n.submitted_at`,
        params,
      );
      const by = Object.fromEntries(status.rows.map((x) => [x.status, x.n]));
      return {
        seesAll: this.sees(ctx),
        counts: {
          total: status.rows.reduce((n, x) => n + x.n, 0),
          pending: by.pending ?? 0,
          returned: by.returned ?? 0,
          approved: by.approved ?? 0,
          rejected: by.rejected ?? 0,
          withdrawn: by.withdrawn ?? 0,
        },
        averageHours: time.rows[0]?.hours ?? null,
        averageRounds: time.rows[0]?.rounds ?? null,
        months: months.rows,
        holders: holders.rows.map((x) => ({
          name: x.name,
          count: x.n,
          oldest: x.oldest.toISOString(),
        })),
        oldest: oldest.rows.map(toNote),
      };
    });
  }

  async export(ctx: RequestContext, q: FileListDto, format: 'xlsx' | 'pdf') {
    const list = await this.list(ctx, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const said = [
      q.box === 'all' ? (list.seesAll ? 'All files' : 'Files I raised or was asked about') : '',
      q.box === 'mine' ? 'Files I raised' : '',
      q.box === 'inbox' ? 'Waiting for my approval' : '',
      q.box === 'acted' ? 'Files I decided' : '',
      q.status ? `Status ${FILE_STATUS[q.status] ?? q.status}` : '',
      q.from || q.to ? `Raised ${q.from ?? '…'} to ${q.to ?? '…'}` : '',
      q.q ? `Search "${q.q}"` : '',
      generatedOn(),
    ].filter(Boolean);
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'File movement report',
        details: said,
        legend: `${String(list.data.length)} file(s)`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'File no.', width: 8 },
          { label: 'Subject', width: 22 },
          { label: 'Raised by', width: 12 },
          { label: 'Raised on', width: 11 },
          { label: 'Status', width: 8 },
          { label: 'Levels', width: 5 },
          { label: 'With', width: 12 },
          { label: 'Round', width: 4, right: true },
          { label: 'Closed on', width: 11 },
        ],
        rows: list.data.map((n, i) => [
          i + 1,
          n.number,
          n.subject,
          n.createdBy,
          ist(new Date(n.createdAt)),
          n.statusLabel,
          `${String(n.approvedLevels)} of ${String(n.levels)}`,
          n.waitingOn ?? '',
          n.round,
          n.closedAt ? ist(new Date(n.closedAt)) : '',
        ]),
        filename: `file-movement-${new Date().toISOString().slice(0, 10)}`,
      },
      format,
    );
  }

  /** The note sheet of an approved file. */
  async pdf(ctx: RequestContext, id: string) {
    const d = await this.get(ctx, id);
    if (d.status !== 'approved')
      throw new DomainError('file.not_approved', 'The PDF is ready once every level has approved', {
        status: 409,
      });
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const LABEL: Record<string, string> = {
      submitted: 'Submitted',
      resubmitted: 'Submitted again',
      approved: 'Approved',
      returned: 'Sent back',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
    };
    return {
      bytes: await fileNotePdf({
        school: head.name,
        address: head.address,
        number: d.number,
        subject: d.subject,
        status: d.statusLabel,
        createdBy: d.createdBy,
        designation: d.designation,
        createdAt: ist(new Date(d.createdAt)),
        closedAt: d.closedAt ? ist(new Date(d.closedAt)) : null,
        lines: htmlToLines(d.bodyHtml),
        attachments: d.files.map((f) => f.name),
        trail: d.history.map((h) => ({
          level: h.level ? `L${String(h.level)}` : h.round > 1 ? `Round ${String(h.round)}` : '-',
          who: h.by,
          decision: LABEL[h.action] ?? h.action,
          when: ist(new Date(h.at)),
          remark: h.remark ?? '',
        })),
        generated: generatedOn(),
      }),
      filename: `${d.number}.pdf`,
      contentType: 'application/pdf',
    };
  }

  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    const d = await this.get(ctx, id);
    if (!d.files.some((f) => f.id === fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }
}
