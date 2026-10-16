import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PushService } from '../comms/push.service';
import { InsightsService } from '../insights/insights.service';

/** Days from today to the next birthday (0 = today), India time; 29 Feb counts on 28 Feb in other years. */
const NEXT = `(SELECT (make_date(y, extract(month FROM dob)::int,
                         LEAST(extract(day FROM dob)::int, extract(day FROM (make_date(y, extract(month FROM dob)::int, 1) + interval '1 month - 1 day'))::int))
                - t.d)::int
            FROM (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d) t,
                 LATERAL (SELECT CASE WHEN to_char(dob, 'MMDD') >= to_char(t.d, 'MMDD') THEN extract(year FROM t.d)::int
                                      ELSE extract(year FROM t.d)::int + 1 END AS y) yy)`;

/**
 * The landing page data the API has no other endpoint for: staff and pupil birthdays (today and the next
 * days, with who was wished) and the wish itself — a push to the staff app or to the pupil's parents in
 * the portal, and SMS / WhatsApp by the template `birthday_wish` when the school has made it ready.
 * The fee widgets get the fee part of the principal's dashboard (the accountant has no insights right).
 * Every other widget reads the module's own dashboard endpoint from the admin app.
 */
@Injectable()
export class DashboardWidgetsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly push: PushService,
    private readonly insights: InsightsService,
  ) {}

  async data(ctx: RequestContext, key: string, days?: number) {
    if (key === 'birthdays_staff') return this.birthdays(ctx, 'employee', days);
    if (key === 'birthdays_students') return this.birthdays(ctx, 'student', days);
    // the fee figures of the principal's dashboard, for those who see fees but not the insights
    if (key === 'fees_today' || key === 'fees_dues')
      return (await this.insights.principal(ctx)).fees;
    throw new DomainError('not-found', 'This widget reads its module directly', { status: 404 });
  }

  async birthdays(ctx: RequestContext, kind: 'student' | 'employee', days = 7) {
    const t = requireTenant(ctx);
    return this.db.tenant(t, async (c) => {
      const r =
        kind === 'student'
          ? await c.query(
              // eslint-disable-next-line no-restricted-syntax -- NEXT is a fixed expression; values bound
              `SELECT s.id::text, s.display_name AS name, s.admission_no AS sub, s.photo_file_id::text AS "photoFileId",
                      (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                         JOIN classes k ON k.id = cs.class_id
                        WHERE e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active' LIMIT 1) AS section,
                      n.days, w.id IS NOT NULL AS wished
                 FROM students s
                 CROSS JOIN LATERAL (SELECT ${NEXT.replace(/dob/g, 's.dob')} AS days) n
                 LEFT JOIN birthday_wishes w ON w.person_kind = 'student' AND w.person_id = s.id
                      AND w.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
                WHERE s.deleted_at IS NULL AND s.status = 'active' AND s.dob IS NOT NULL AND n.days BETWEEN 0 AND $2
                  AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active')
                ORDER BY n.days, s.display_name LIMIT 200`,
              [t.academicYearId ?? null, days],
            )
          : await c.query(
              // eslint-disable-next-line no-restricted-syntax -- NEXT is a fixed expression; values bound
              `SELECT e.id::text, e.display_name AS name, COALESCE(e.designation, e.employee_code) AS sub,
                      e.photo_file_id::text AS "photoFileId", e.department AS section, n.days, w.id IS NOT NULL AS wished
                 FROM employees e
                 CROSS JOIN LATERAL (SELECT ${NEXT.replace(/dob/g, 'e.dob')} AS days) n
                 LEFT JOIN birthday_wishes w ON w.person_kind = 'employee' AND w.person_id = e.id
                      AND w.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
                WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.dob IS NOT NULL AND n.days BETWEEN 0 AND $1
                ORDER BY n.days, e.display_name LIMIT 200`,
              [days],
            );
      const rows = r.rows as Array<{ days: number }>;
      return { today: rows.filter((x) => x.days === 0), upcoming: rows.filter((x) => x.days > 0) };
    });
  }

  /** Wish one person a happy birthday today: once a day per person. */
  async wish(
    ctx: RequestContext,
    dto: { kind: 'student' | 'employee'; id: string; message?: string },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const who = (
        dto.kind === 'student'
          ? await c.query<{ name: string; birthday: boolean; users: string[]; mobiles: string[] }>(
              `SELECT s.display_name AS name,
                      to_char(s.dob, 'MMDD') = to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'MMDD') AS birthday,
                      ARRAY(SELECT g.user_id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND g.user_id IS NOT NULL) AS users,
                      ARRAY(SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                             WHERE sg.student_id = s.id AND sg.receives_notifications AND g.mobile IS NOT NULL) AS mobiles
                 FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
              [dto.id],
            )
          : await c.query<{ name: string; birthday: boolean; users: string[]; mobiles: string[] }>(
              `SELECT e.display_name AS name,
                      to_char(e.dob, 'MMDD') = to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'MMDD') AS birthday,
                      ARRAY_REMOVE(ARRAY[e.user_id::text], NULL) AS users, ARRAY_REMOVE(ARRAY[e.mobile], NULL) AS mobiles
                 FROM employees e WHERE e.id = $1 AND e.deleted_at IS NULL`,
              [dto.id],
            )
      ).rows[0];
      if (!who) throw new DomainError('not-found', 'Person not found', { status: 404 });
      if (!who.birthday)
        throw new DomainError('dashboard.not_birthday', `It is not ${who.name}'s birthday today`, {
          status: 409,
        });
      const row = await c.query<{ id: string }>(
        `INSERT INTO birthday_wishes (school_id, person_kind, person_id, on_date, wished_by)
         VALUES (app.current_school_id(), $1, $2, (now() AT TIME ZONE 'Asia/Kolkata')::date, app.current_user_id())
         ON CONFLICT DO NOTHING RETURNING id::text`,
        [dto.kind, dto.id],
      );
      if (!row.rows[0])
        throw new DomainError(
          'dashboard.already_wished',
          `${who.name} has already been wished today`,
          { status: 409 },
        );
      const school =
        (
          await c.query<{ name: string }>(
            `SELECT name FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]?.name ?? '';
      const first = who.name.split(' ')[0] ?? who.name;
      const text =
        dto.message?.trim() || `Happy birthday, ${first}! Warm wishes from all of us at ${school}.`;
      const channels: string[] = [];
      const pushed = await this.push.send(c, ctx, {
        userIds: who.users,
        title: dto.kind === 'student' ? `Happy birthday, ${first}!` : 'Happy birthday!',
        body: text,
        link: '/',
        event: null,
      });
      if (pushed) channels.push('app');
      const texted = await c.query<{ n: number }>(
        `SELECT app.template_to_mobiles('birthday_wish', $1::text[], $2::jsonb) AS n`,
        [who.mobiles, JSON.stringify({ who: first, name: who.name, school, message: text })],
      );
      if (texted.rows[0]!.n > 0) channels.push('sms/whatsapp');
      await c.query(`UPDATE birthday_wishes SET channels = $2 WHERE id = $1`, [
        row.rows[0].id,
        channels,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.birthday.wish',
        entityType: dto.kind === 'student' ? 'student' : 'employee',
        entityId: dto.id,
        after: { channels },
      });
      return { ok: true, channels };
    });
  }
}
