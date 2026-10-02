import { Injectable, Logger } from '@nestjs/common';
import { QUEUES, decryptField, type PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { CommsSettingsService } from './comms-settings.service';

export type PushEvent =
  | 'school_message'
  | 'attendance'
  | 'fees'
  | 'transport'
  | 'queries'
  | 'notices'
  | 'homework'
  | 'approvals';

/** The event of an automatic alert, from its template code (absent_alert, fee_reminder, bus_boarded...). */
export function eventOfTemplate(code: string | null | undefined): PushEvent {
  const c = (code ?? '').toLowerCase();
  if (/absent|attendance|late|leave/.test(c)) return 'attendance';
  if (/fee|payment|receipt|due/.test(c)) return 'fees';
  if (/bus|transport|route|board|alight/.test(c)) return 'transport';
  if (/query|complaint|reply/.test(c)) return 'queries';
  if (/notice|circular/.test(c)) return 'notices';
  if (/homework|daily_work|classwork/.test(c)) return 'homework';
  return 'school_message';
}

/**
 * Push notifications to the parent / student and teacher apps through the school's Firebase (FCM)
 * project. Apps register a device token once the user turns notifications on; every event the admin
 * switched on (school messages, attendance, fees, transport, queries, notices, homework, approvals)
 * becomes one push per device, queued like any other message (channel "push", not shown in Messages).
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  constructor(
    private readonly db: DbService,
    private readonly settings: CommsSettingsService,
  ) {}

  /** What an app needs to ask for a token: Firebase web config and the VAPID key (no secrets). */
  async config(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ config: Record<string, string>; active: boolean }>(
        `SELECT config, active FROM comms_providers WHERE channel = 'push' AND provider = 'fcm'`,
      );
      const p = r.rows[0];
      if (!p?.active || !p.config.apiKey || !p.config.vapidKey) return { enabled: false as const };
      return {
        enabled: true as const,
        firebase: {
          apiKey: p.config.apiKey,
          authDomain: p.config.authDomain,
          projectId: p.config.projectId,
          messagingSenderId: p.config.messagingSenderId,
          appId: p.config.appId,
        },
        vapidKey: p.config.vapidKey,
      };
    });
  }

  async register(
    ctx: RequestContext,
    dto: { token: string; app: 'parent' | 'teacher'; userAgent?: string },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO push_devices (school_id, user_id, app, token, user_agent)
         VALUES (app.current_school_id(), app.current_user_id(), $1, $2, $3)
         ON CONFLICT (school_id, token) DO UPDATE SET user_id = EXCLUDED.user_id, app = EXCLUDED.app,
           user_agent = EXCLUDED.user_agent, last_seen = now(), revoked_at = NULL`,
        [dto.app, dto.token, dto.userAgent ?? null],
      );
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM push_devices WHERE user_id = app.current_user_id() AND revoked_at IS NULL`,
      );
      return { devices: n.rows[0]!.n };
    });
  }

  async unregister(ctx: RequestContext, token: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `UPDATE push_devices SET revoked_at = now() WHERE token = $1 AND user_id = app.current_user_id()`,
        [token],
      );
      return { ok: true as const };
    });
  }

  /** A test push to the signed-in user's own devices. */
  async testMe(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const n = await this.send(c, ctx, {
        userIds: [requireTenant(ctx).userId!],
        title: 'Test notification',
        body: 'Push notifications from your school work on this device.',
        link: '/messages',
        event: null,
      });
      if (!n)
        throw new DomainError(
          'comms.push.no_device',
          'No device is registered for you yet: open the parent or teacher app and turn on notifications',
          { status: 409 },
        );
      return { devices: n };
    });
  }

  /**
   * Queues one push per active device of the users when the event is switched on and Firebase is set
   * up. Returns how many pushes were queued. Never throws for a business transaction's sake.
   */
  async send(
    c: PoolClient,
    ctx: RequestContext,
    input: {
      userIds: string[];
      title: string;
      body: string;
      link: string;
      event: PushEvent | null;
      /** skip people who got the same push in the last 2 minutes (an alert sent by SMS and WhatsApp) */
      dedupe?: boolean;
    },
  ): Promise<number> {
    let userIds = [...new Set(input.userIds.filter(Boolean))];
    if (!userIds.length) return 0;
    try {
      const p = await c.query<{ active: boolean; secret: string | null }>(
        `SELECT active, secret FROM comms_providers WHERE channel = 'push' AND provider = 'fcm'`,
      );
      if (!p.rows[0]?.active || !p.rows[0].secret) return 0;
      const keys = JSON.parse(decryptField(p.rows[0].secret) ?? '{}') as Record<string, string>;
      if (!keys.serviceAccount) return 0;
      if (input.event) {
        const policy = await this.settings.policy(c);
        if (!policy.pushEvents.includes(input.event)) return 0;
      }
      if (input.dedupe) {
        const recent = await c.query<{ id: string }>(
          `SELECT DISTINCT recipient_user_id::text AS id FROM comms_messages
            WHERE channel = 'push' AND subject = $1 AND created_at > now() - interval '2 minutes' AND recipient_user_id = ANY($2::bigint[])`,
          [input.title.slice(0, 200), userIds],
        );
        const done = new Set(recent.rows.map((x) => x.id));
        userIds = userIds.filter((u) => !done.has(u));
        if (!userIds.length) return 0;
      }
      const devices = await c.query<{ user_id: string; token: string }>(
        `SELECT user_id::text, token FROM push_devices WHERE user_id = ANY($1::bigint[]) AND revoked_at IS NULL`,
        [userIds],
      );
      if (!devices.rows.length) return 0;
      const tenant = requireTenant(ctx);
      const ids = (
        await c.query<{ id: string }>(
          `INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, subject, body, variables, request_id, created_by)
           SELECT app.current_school_id(), 'push', x.user_id, x.token, $3, $4, $5::jsonb, app.current_request_id(), app.current_user_id()
             FROM unnest($1::bigint[], $2::text[]) AS x(user_id, token)
           RETURNING id::text`,
          [
            devices.rows.map((d) => d.user_id),
            devices.rows.map((d) => d.token),
            input.title.slice(0, 200),
            input.body.slice(0, 1000),
            JSON.stringify({ link: input.link, event: input.event }),
          ],
        )
      ).rows.map((x) => x.id);
      await c.query(
        `SELECT app.enqueue_job($1, $2::jsonb || jsonb_build_object('payload', jsonb_build_object('messageId', m.id::text)))
           FROM unnest($3::bigint[]) AS m(id)`,
        [
          QUEUES.notifications,
          JSON.stringify({
            schoolId: tenant.schoolId,
            userId: tenant.userId ?? null,
            requestId: ctx.requestId,
            kind: 'comms.message',
          }),
          ids,
        ],
      );
      return ids.length;
    } catch (error) {
      this.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'push not queued',
      );
      return 0;
    }
  }

  /** Parents' and students' logins of the students of these sections (this year). */
  async familyUsersOfSections(c: PoolClient, sectionIds: string[]): Promise<string[]> {
    if (!sectionIds.length) return [];
    const r = await c.query<{ id: string }>(
      `WITH st AS (SELECT e.student_id FROM enrolments e WHERE e.class_section_id = ANY($1::bigint[]) AND e.status = 'active')
       SELECT g.user_id::text AS id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id IN (SELECT student_id FROM st) AND g.user_id IS NOT NULL AND g.deleted_at IS NULL
       UNION SELECT s.user_id::text FROM students s WHERE s.id IN (SELECT student_id FROM st) AND s.user_id IS NOT NULL`,
      [sectionIds],
    );
    return r.rows.map((x) => x.id);
  }

  /** Who a published notice reaches: families of its classes / sections / students, staff of it. */
  async usersOfNotice(c: PoolClient, noticeId: string): Promise<string[]> {
    const n = await c.query<{ audience: string; academic_year_id: string | null }>(
      `SELECT audience::text, academic_year_id::text FROM notices WHERE id = $1`,
      [noticeId],
    );
    const notice = n.rows[0];
    if (!notice) return [];
    const t = await c.query<{ target_type: string; target_id: string }>(
      `SELECT target_type::text, target_id::text FROM notice_targets WHERE notice_id = $1`,
      [noticeId],
    );
    const of = (type: string) =>
      t.rows.filter((x) => x.target_type === type).map((x) => x.target_id);
    const familyTargets = of('class').length + of('class_section').length + of('student').length;
    const users: string[] = [];
    if (notice.audience !== 'employees') {
      const r = await c.query<{ id: string }>(
        `WITH st AS (
           SELECT e.student_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
            WHERE e.status = 'active' AND ($1::bigint IS NULL OR e.academic_year_id = $1::bigint)
              AND ($2::boolean OR cs.class_id = ANY($3::bigint[]) OR cs.id = ANY($4::bigint[]) OR e.student_id = ANY($5::bigint[])))
         SELECT g.user_id::text AS id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id IN (SELECT student_id FROM st) AND g.user_id IS NOT NULL AND g.deleted_at IS NULL
         UNION SELECT s.user_id::text FROM students s WHERE s.id IN (SELECT student_id FROM st) AND s.user_id IS NOT NULL`,
        [
          notice.academic_year_id,
          familyTargets === 0,
          of('class'),
          of('class_section'),
          of('student'),
        ],
      );
      users.push(...r.rows.map((x) => x.id));
    }
    if (notice.audience !== 'students') {
      const staff = of('employee');
      const r = await c.query<{ id: string }>(
        `SELECT user_id::text AS id FROM employees WHERE user_id IS NOT NULL AND deleted_at IS NULL AND status = 'active'
            AND ($1::boolean OR id = ANY($2::bigint[]))`,
        [t.rows.length === 0, staff],
      );
      users.push(...r.rows.map((x) => x.id));
    }
    return [...new Set(users)];
  }

  /** Users behind addresses (a parent's mobile / email, an employee's, a student's own). */
  async usersOfAddresses(c: PoolClient, addresses: string[]): Promise<string[]> {
    if (!addresses.length) return [];
    const list = addresses.map((a) =>
      a.includes('@') ? a.toLowerCase() : a.replace(/\D/g, '').slice(-10),
    );
    const r = await c.query<{ id: string }>(
      `SELECT user_id::text AS id FROM guardians WHERE user_id IS NOT NULL AND deleted_at IS NULL AND (mobile = ANY($1::text[]) OR lower(email::text) = ANY($1::text[]))
       UNION SELECT user_id::text FROM employees WHERE user_id IS NOT NULL AND deleted_at IS NULL AND (mobile = ANY($1::text[]) OR lower(email::text) = ANY($1::text[]))
       UNION SELECT user_id::text FROM students WHERE user_id IS NOT NULL AND deleted_at IS NULL
               AND (profile->>'student_own_mobile' = ANY($1::text[]) OR lower(profile->>'student_own_email') = ANY($1::text[]))`,
      [list],
    );
    return r.rows.map((x) => x.id);
  }
}
