import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { SettingsService } from '../platform/settings.service';

/** Legacy list envelope: {"channel":{"items":[...]}} (s-webservices Get*.php). */
export interface LegacyChannel<T> {
  channel: { items: T[] };
}

const channel = <T>(items: T[]): LegacyChannel<T> => ({ channel: { items } });

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
    const setting = (await this.settings.current(tenant)).find((s) => s.key === 'compat.holidays');
    const list = (setting?.value ?? []) as Array<{ date: string; name: string }>;
    return channel(
      list.map((h, i) => ({
        srno: String(i + 1),
        holidaydate: h.date.split('-').reverse().join('-'), // legacy DD-MM-YYYY
        holidayname: h.name,
        datetime: h.date,
      })),
    );
  }

  async notices(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    // Notices ride on the communication log until the notice board module lands: push and WhatsApp broadcasts.
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        subject: string | null;
        body: string;
        created_at: Date;
      }>(
        `SELECT id::text, subject, body, created_at FROM comms_messages
          WHERE channel IN ('push', 'whatsapp') AND status IN ('sent', 'delivered') ORDER BY created_at DESC LIMIT 50`,
      );
      return {
        channels: channel(
          r.rows.map((n) => ({
            srno: n.id,
            noticetitle: (n.subject ?? '').replace(/\//g, 'slash'),
            notice: n.body.replace(/\//g, 'slash'),
            datetime: n.created_at.toISOString(),
          })),
        ),
      };
    });
  }

  homework() {
    return {
      status: true,
      info: 'ok',
      msg: '',
      items: [] as Array<{
        subject: string;
        homework: string;
        homeworkdate: string;
        datetime: string;
      }>,
    };
  }

  classwork() {
    return {
      channels: channel(
        [] as Array<{
          subject: string;
          classworkdate: string;
          classwork: string;
          datetime: string;
        }>,
      ),
    };
  }

  timetable() {
    return {
      channels: channel(
        [] as Array<{
          srno: string;
          sclass: string;
          subject: string;
          weekday: string;
          daytime: string;
          datetime: string;
        }>,
      ),
    };
  }

  attendance(ctx: RequestContext) {
    requireTenant(ctx);
    return {
      channels: {
        channel: {
          items: {
            year: { y: String(new Date().getFullYear()) },
            attendance: [] as Array<{
              date: string;
              attendance: string;
              month: string;
              day: string;
              month_name: string;
            }>,
          },
        },
      },
    };
  }
}
