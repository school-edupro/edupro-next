import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { SettingsService } from '../platform/settings.service';

/** Legacy list envelope: {"channel":{"items":[...]}} (s-webservices Get*.php). */
export interface LegacyChannel<T> {
  channel: { items: T[] };
}

const channel = <T>(items: T[]): LegacyChannel<T> => ({ channel: { items } });
/** yyyy-mm-dd or dd-mm-yyyy → dd-mm-yyyy, the format the current apps render. */
const legacyDate = (v: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('-') : v;

/**
 * Compatibility read endpoints (S5-07). Where the new module exists (people, settings) the data is live;
 * where it does not yet (homework, classwork, attendance, timetable, notices) the endpoint answers with the
 * legacy shape and an empty list, so the current apps render "no records" instead of failing. Each one is
 * swapped for live data when its module lands (Sprints 6 to 11).
 */
@Injectable()
export class CompatReadsService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly viewer: ViewerService,
  ) {}

  async directory(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        empid: string;
        name: string;
        designation: string | null;
        department: string | null;
        mobile: string | null;
        email: string | null;
      }>(
        `SELECT em.employee_code AS empid, em.display_name AS name, coalesce(p.designation, em.designation) AS designation,
                coalesce(p.department, em.department) AS department, em.mobile, em.email::text
           FROM employees em LEFT JOIN postings p ON p.employee_id = em.id AND p.academic_year_id = app.current_academic_year_id()
          WHERE em.deleted_at IS NULL AND em.status = 'active' ORDER BY em.display_name`,
      );
      return channel(
        r.rows.map((e) => ({
          EmpId: e.empid,
          Name: e.name,
          Designation: e.designation ?? '',
          Department: e.department ?? '',
          MobileNo: e.mobile ?? '',
          Email_Id: e.email ?? '',
        })),
      );
    });
  }

  async holidays(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const live = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string; name: string; starts_on: string; ends_on: string }>(
        `SELECT id::text, name, starts_on::text, ends_on::text FROM holidays WHERE academic_year_id = app.current_academic_year_id() AND kind <> 'working_day' ORDER BY starts_on`,
      );
      return r.rows;
    });
    if (live.length)
      return channel(
        live.map((h) => ({
          srno: h.id,
          holidaydate: legacyDate(h.starts_on),
          holidayname: h.name,
          holidayenddate: legacyDate(h.ends_on),
          datetime: `${h.starts_on}T00:00:00.000Z`,
        })),
      );
    const setting = (await this.settings.current(tenant)).find((s) => s.key === 'compat.holidays');
    const list = (setting?.value ?? []) as Array<{ date: string; name: string }>;
    return channel(
      list.map((h, i) => ({
        srno: String(i + 1),
        holidaydate: legacyDate(h.date),
        holidayname: h.name,
        holidayenddate: legacyDate(h.date),
        datetime: new Date().toISOString(),
      })),
    );
  }

  /** GetNotice (live since Sprint 11): published notices visible to the caller's audience. */
  async notices(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const { ids } = await this.sections(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        title: string;
        body: string;
        publish_from: string;
        published_at: Date;
      }>(
        `SELECT n.id::text, n.title, n.body, n.publish_from::text, n.published_at FROM notices n
          WHERE n.deleted_at IS NULL AND n.published_at IS NOT NULL AND (n.publish_until IS NULL OR n.publish_until >= CURRENT_DATE)
            AND ($1::bigint[] IS NULL OR NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id)
                 OR EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id AND t.target_type = 'class_section' AND t.target_id = ANY($1::bigint[])))
          ORDER BY n.is_pinned DESC, n.publish_from DESC LIMIT 50`,
        [ids],
      );
      return {
        channels: channel(
          r.rows.map((n) => ({
            srno: n.id,
            noticetitle: n.title.replace(/\//g, 'slash'),
            notice: n.body.replace(/\//g, 'slash'),
            datetime: n.published_at.toISOString(),
          })),
        ),
      };
    });
  }

  /** Sections the caller may read: a family's children's sections, or a staff member's scope (null = all). */
  private async sections(
    ctx: RequestContext,
  ): Promise<{ ids: string[] | null; studentIds: string[] }> {
    const v = await this.viewer.resolve(ctx, 'academics.daily_work.view');
    if (v.kind === 'family')
      return {
        ids: v.students.map((s) => s.classSectionId).filter((x): x is string => !!x),
        studentIds: v.students.map((s) => s.id),
      };
    return { ids: v.sectionIds, studentIds: [] };
  }

  private async dailyWork(ctx: RequestContext, kind: 'homework' | 'classwork') {
    const tenant = requireTenant(ctx);
    const { ids } = await this.sections(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        subject: string | null;
        title: string;
        body: string;
        assigned_on: string;
        created_at: Date;
      }>(
        `SELECT s.name AS subject, d.title, d.body, d.assigned_on::text, d.created_at
           FROM daily_work d LEFT JOIN subjects s ON s.id = d.subject_id
          WHERE d.deleted_at IS NULL AND d.kind = $1::daily_work_kind AND d.assigned_on >= CURRENT_DATE - 60
            AND ($2::bigint[] IS NULL OR d.class_section_id = ANY($2::bigint[]))
          ORDER BY d.assigned_on DESC, d.created_at DESC LIMIT 100`,
        [kind, ids],
      );
      return r.rows.map((x) => ({
        subject: x.subject ?? '',
        text: `${x.title}${x.body ? `: ${x.body}` : ''}`,
        date: x.assigned_on,
        datetime: x.created_at.toISOString(),
      }));
    });
  }

  /** GetHomework (live since Sprint 11): `{status, info, msg, items:[{subject, homework, homeworkdate, datetime}]}`. */
  async homework(ctx: RequestContext) {
    const rows = await this.dailyWork(ctx, 'homework');
    return {
      status: true,
      info: 'ok',
      msg: '',
      items: rows.map((x) => ({
        subject: x.subject,
        homework: x.text,
        homeworkdate: x.date,
        datetime: x.datetime,
      })),
    };
  }

  /** GetClasswork (live since Sprint 11). */
  async classwork(ctx: RequestContext) {
    const rows = await this.dailyWork(ctx, 'classwork');
    return {
      channels: channel(
        rows.map((x) => ({
          subject: x.subject,
          classworkdate: x.date,
          classwork: x.text,
          datetime: x.datetime,
        })),
      ),
    };
  }

  /** GetTimetable (live since Sprint 11): the first readable section's week. */
  async timetable(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const { ids } = await this.sections(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        sclass: string;
        subject: string | null;
        weekday: number;
        starts_at: string;
        ends_at: string;
        created_at: Date;
      }>(
        `SELECT ts.id::text, k.code || '-' || cs.name AS sclass, s.name AS subject, ts.weekday, p.starts_at::text, p.ends_at::text, ts.created_at
           FROM timetable_slots ts JOIN class_sections cs ON cs.id = ts.class_section_id JOIN classes k ON k.id = cs.class_id
           JOIN timetable_periods p ON p.id = ts.period_id LEFT JOIN subjects s ON s.id = ts.subject_id
          WHERE ts.academic_year_id = app.current_academic_year_id()
            AND ts.class_section_id = COALESCE((SELECT min(x) FROM unnest($1::bigint[]) x), ts.class_section_id)
          ORDER BY ts.weekday, p.number LIMIT 200`,
        [ids && ids.length ? ids : null],
      );
      const days = [
        '',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ];
      return {
        channels: channel(
          r.rows.map((x) => ({
            srno: x.id,
            sclass: x.sclass,
            subject: x.subject ?? '',
            weekday: days[x.weekday] ?? String(x.weekday),
            daytime: `${x.starts_at.slice(0, 5)}-${x.ends_at.slice(0, 5)}`,
            datetime: x.created_at.toISOString(),
          })),
        ),
      };
    });
  }

  /** GetAttendance (live since Sprint 11): the first child's day marks of the working year. */
  async attendance(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const { studentIds } = await this.sections(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = studentIds.length
        ? await c.query<{ date: string; code: string }>(
            `SELECT a.on_date::text AS date, m.code::text AS code FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
              WHERE m.student_id = $1 AND a.kind = 'day' AND a.academic_year_id = app.current_academic_year_id() ORDER BY a.on_date DESC LIMIT 366`,
            [studentIds[0]],
          )
        : { rows: [] as Array<{ date: string; code: string }> };
      const months = [
        '',
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      return {
        channels: {
          channel: {
            items: {
              year: { y: String(new Date().getFullYear()) },
              attendance: r.rows.map((x) => {
                const [y, m, d] = x.date.split('-').map(Number) as [number, number, number];
                void y;
                return {
                  date: x.date,
                  attendance: x.code,
                  month: String(m),
                  day: String(d),
                  month_name: months[m] ?? '',
                };
              }),
            },
          },
        },
      };
    });
  }
}
