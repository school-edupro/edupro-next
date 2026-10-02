import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';
import { htmlToText } from './render';

export interface InboxItem {
  id: string;
  /** message ids behind this item (one per channel) */
  messageIds: string[];
  title: string;
  channels: string[];
  subject: string | null;
  text: string;
  html: string | null;
  student: { id: string | null; name: string } | null;
  sentAt: string;
  status: Record<string, string>;
  readOnPhone: boolean;
  unread: boolean;
  attachments: Array<{ name: string; contentType: string; url: string; saveUrl: string }>;
}

interface Row {
  id: string;
  message_request_id: string | null;
  channel: string;
  subject: string | null;
  body: string;
  format: string;
  status: string;
  read_at: Date | null;
  created_at: Date;
  title: string | null;
  template_name: string | null;
  student_id: string | null;
  student_name: string | null;
  attachments: Array<{ fileId: string; name: string | null; contentType: string }>;
  seen: boolean;
}

/**
 * The Messages inbox of the parent, student and teacher apps (communication v2): every SMS, WhatsApp
 * and email the school sent to the signed-in person, whichever module sent it (circulars, fee
 * reminders, attendance and transport alerts). A message reaches the inbox when it went to the
 * person's login, to their own mobile or email, to them as a parent, or to the family contact of one
 * of their children. Copies on several channels show as one item.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async scope(c: PoolClient) {
    const r = await c.query<{ addresses: string[]; guardians: string[]; children: string[] }>(
      `WITH me AS (SELECT app.current_user_id() AS id),
            g AS (SELECT id, mobile, email::text AS email FROM guardians WHERE user_id = (SELECT id FROM me) AND deleted_at IS NULL),
            st AS (SELECT id, profile->>'student_own_mobile' AS mobile, profile->>'student_own_email' AS email FROM students WHERE user_id = (SELECT id FROM me) AND deleted_at IS NULL),
            em AS (SELECT mobile, email::text AS email FROM employees WHERE user_id = (SELECT id FROM me) AND deleted_at IS NULL),
            u AS (SELECT mobile, email::text AS email FROM users WHERE id = (SELECT id FROM me))
       SELECT
         ARRAY(SELECT DISTINCT lower(a) FROM (
                 SELECT mobile AS a FROM g UNION ALL SELECT email FROM g UNION ALL SELECT mobile FROM st UNION ALL SELECT email FROM st
                 UNION ALL SELECT mobile FROM em UNION ALL SELECT email FROM em UNION ALL SELECT mobile FROM u UNION ALL SELECT email FROM u) x
               WHERE a IS NOT NULL AND a <> '') AS addresses,
         ARRAY(SELECT id::text FROM g) AS guardians,
         ARRAY(SELECT sg.student_id::text FROM student_guardians sg WHERE sg.guardian_id IN (SELECT id FROM g)
               UNION SELECT id::text FROM st) AS children`,
    );
    const x = r.rows[0]!;
    // stored mobiles are ten digits; a profile may hold +91 or spaces
    const addresses = x.addresses.map((a) =>
      a.includes('@') ? a : a.replace(/\D/g, '').slice(-10),
    );
    return { addresses, guardians: x.guardians, children: x.children };
  }

  private async rows(
    c: PoolClient,
    opts: { studentId?: string; limit: number; offset: number; onlyUnread?: boolean },
  ) {
    const s = await this.scope(c);
    if (opts.studentId && !s.children.includes(opts.studentId))
      throw new DomainError('not-found', 'Not one of your children', { status: 404 });
    const r = await c.query<Row>(
      `SELECT m.id::text, m.message_request_id::text, m.channel::text, m.subject, m.body, m.format, m.status::text, m.read_at, m.created_at,
              q.title, t.name AS template_name, x.student_id::text,
              COALESCE(s.display_name, NULLIF(m.variables->>'student_name', '')) AS student_name, m.attachments,
              EXISTS (SELECT 1 FROM comms_inbox_reads ir WHERE ir.user_id = app.current_user_id() AND ir.message_id = m.id) AS seen
         FROM comms_messages m
         LEFT JOIN message_request_recipients x ON x.message_id = m.id
         LEFT JOIN message_requests q ON q.id = m.message_request_id
         LEFT JOIN comms_templates t ON t.id = m.template_id
         LEFT JOIN students s ON s.id = x.student_id
        WHERE m.status <> 'cancelled' AND m.channel <> 'push'
          AND (m.recipient_user_id = app.current_user_id()
               OR lower(m.recipient_address) = ANY($1::text[])
               OR (x.person_type = 'guardian' AND x.person_id = ANY($2::bigint[]))
               OR (x.person_type = 'student' AND x.student_id = ANY($3::bigint[]) AND q.send_to = 'primary'))
          AND ($4::bigint IS NULL OR x.student_id = $4::bigint)
          AND (NOT $7::boolean OR NOT EXISTS (SELECT 1 FROM comms_inbox_reads ir WHERE ir.user_id = app.current_user_id() AND ir.message_id = m.id))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $5 OFFSET $6`,
      [
        s.addresses,
        s.guardians,
        s.children,
        opts.studentId ?? null,
        opts.limit,
        opts.offset,
        Boolean(opts.onlyUnread),
      ],
    );
    return r.rows;
  }

  async list(ctx: RequestContext, q: { studentId?: string; page: number; size: number }) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      // read a little extra so copies on other channels land in the same page
      const rows = await this.rows(c, {
        studentId: q.studentId,
        limit: q.size * 3 + 3,
        offset: (q.page - 1) * q.size * 3,
      });
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        const key = r.message_request_id
          ? `r${r.message_request_id}:${r.student_id ?? ''}`
          : `m${r.id}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      const items: InboxItem[] = [];
      for (const [key, list] of [...groups.entries()].slice(0, q.size)) {
        const textual =
          list.find((x) => x.channel === 'whatsapp') ?? list.find((x) => x.channel === 'sms');
        const email = list.find((x) => x.channel === 'email');
        const first = list[0]!;
        const atts = first.attachments ?? [];
        const files = atts.length
          ? (
              await c.query<{
                id: string;
                object_key: string;
                content_type: string;
                original_name: string | null;
              }>(
                `SELECT id::text, object_key, content_type, original_name FROM files WHERE id = ANY($1::bigint[]) AND status = 'ready'`,
                [atts.map((a) => a.fileId)],
              )
            ).rows
          : [];
        const attachments = [];
        for (const f of files) {
          const name = f.original_name ?? `attachment-${f.id}`;
          const t = await this.storage.createDownloadUrl(
            f.object_key,
            name,
            f.content_type,
            f.id,
            tenant.schoolId,
          );
          attachments.push({ name, contentType: f.content_type, url: t.url, saveUrl: t.saveUrl });
        }
        items.push({
          id: key,
          messageIds: list.map((x) => x.id),
          title: first.title ?? email?.subject ?? first.template_name ?? 'Message from school',
          channels: [...new Set(list.map((x) => x.channel))],
          subject: email?.subject ?? null,
          text:
            textual?.body ??
            (email ? (email.format === 'html' ? htmlToText(email.body) : email.body) : first.body),
          html: email && email.format === 'html' ? email.body : null,
          student: first.student_name ? { id: first.student_id, name: first.student_name } : null,
          sentAt: first.created_at.toISOString(),
          status: Object.fromEntries(list.map((x) => [x.channel, x.status])),
          readOnPhone: list.some((x) => x.read_at),
          unread: list.every((x) => !x.seen),
          attachments,
        });
      }
      const children = await c.query<{ id: string; name: string }>(
        `SELECT s.id::text, s.display_name AS name FROM students s WHERE s.id = ANY($1::bigint[]) ORDER BY s.display_name`,
        [(await this.scope(c)).children],
      );
      return {
        data: items,
        children: children.rows,
        page: { number: q.page, size: q.size, more: groups.size > q.size },
      };
    });
  }

  async unread(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await this.rows(c, { limit: 200, offset: 0, onlyUnread: true });
      const keys = new Set(
        rows.map((r) =>
          r.message_request_id ? `r${r.message_request_id}:${r.student_id ?? ''}` : `m${r.id}`,
        ),
      );
      return { unread: keys.size };
    });
  }

  /** Marks messages read for this user; only messages of their own inbox are accepted. */
  async markRead(ctx: RequestContext, ids: string[]) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const mine = new Set((await this.rows(c, { limit: 1000, offset: 0 })).map((r) => r.id));
      const ok = ids.filter((id) => mine.has(id));
      if (ok.length)
        await c.query(
          `INSERT INTO comms_inbox_reads (school_id, user_id, message_id)
           SELECT app.current_school_id(), app.current_user_id(), x FROM unnest($1::bigint[]) AS x
           ON CONFLICT DO NOTHING`,
          [ok],
        );
      return { marked: ok.length };
    });
  }
}
