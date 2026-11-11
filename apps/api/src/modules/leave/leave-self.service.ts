import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from '../purchase/purchase-list-file';
import { istToday } from '../purchase/purchase-stock-core';
import { AttendanceService } from './attendance.service';
import { addDays, dmy, fail, monthStart, monthWords } from './leave-engine';
import type { MyFileDto, TeamLeaveDto } from './leave.dto';
import { LeaveService, REQ, type ReqRow } from './leave.service';

const STATUS: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * My leave as one page (the earlier module's Employee Leave / Attendance): the leave of the staff reporting
 * to me in a month, and my leave or my month's attendance to download.
 */
@Injectable()
export class LeaveSelfService {
  constructor(
    private readonly db: DbService,
    private readonly leave: LeaveService,
    private readonly att: AttendanceService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** The staff whose reporting manager I am (this year's postings). */
  private async reportees(c: PoolClient, me: string) {
    return (
      await c.query<{ id: string }>(
        `SELECT DISTINCT p.employee_id::text AS id FROM postings p JOIN employees e ON e.id = p.employee_id
          WHERE p.reports_to_employee_id = $1 AND p.academic_year_id = app.current_academic_year_id()
            AND e.status = 'active' AND e.deleted_at IS NULL`,
        [me],
      )
    ).rows.map((x) => x.id);
  }

  /** The leave of the staff reporting to me that touches the month, newest first; Excel or PDF. */
  async team(ctx: RequestContext, q: TeamLeaveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const month = q.month ? `${q.month}-01` : monthStart(istToday());
      const end = addDays(monthStart(addDays(month, 32)), -1);
      const me = await this.leave.meIn(c);
      const ids = me ? await this.reportees(c, me) : [];
      const args = [ids, month, end, q.status ?? null, q.q ? `%${q.q}%` : null];
      const where = `WHERE r.employee_id = ANY($1::bigint[]) AND r.from_date <= $3::date AND r.to_date >= $2::date
          AND ($4::text IS NULL OR r.status = $4) AND ($5::text IS NULL OR e.display_name ILIKE $5 OR e.employee_code ILIKE $5)`;
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
          `SELECT count(*)::int AS n FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id ${where}`,
          args,
        )
      ).rows[0]!.n;
      const rows = await c.query<ReqRow>(
        // eslint-disable-next-line no-restricted-syntax -- REQ and the where are fixed fragments; values are bound
        `${REQ} ${where} ORDER BY r.from_date DESC, r.id DESC LIMIT $6 OFFSET $7`,
        q.format ? [...args, LIST_LIMIT, 0] : [...args, q.size, (q.page - 1) * q.size],
      );
      const shaped = rows.rows.map((r) => this.leave.shape(r));
      if (q.format) {
        checkListSize(shaped.length, 'leave');
        return purchaseListFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          title: `Reporties’ leave — ${monthWords(month)}`,
          slug: `Reporties-leave-${month.slice(0, 7)}`,
          words: [q.status ? STATUS[q.status] : 'All', q.q ? `Search: ${q.q}` : null]
            .filter(Boolean)
            .join(' · '),
          list: {
            columns: [
              { label: 'Leave no.', width: 1.6 },
              { label: 'Employee', width: 3 },
              { label: 'Department', width: 2 },
              { label: 'Leave type', width: 2 },
              { label: 'From', type: 'date' },
              { label: 'To', type: 'date' },
              { label: 'Days', type: 'number', width: 0.8 },
              { label: 'Status', width: 1.4 },
              { label: 'Reason', width: 4 },
            ],
            rows: shaped.map((r) => [
              r.number,
              `${r.employee.name} (${r.employee.code})`,
              r.employee.department,
              `${r.leaveType.name} (${r.leaveType.code})`,
              r.from,
              r.to,
              r.days,
              STATUS[r.status] ?? r.status,
              r.reason,
            ]),
          },
        });
      }
      return {
        month,
        monthWords: monthWords(month),
        team: ids.length,
        rows: shaped,
        total,
        page: q.page,
        size: q.size,
      };
    });
  }

  /** All my leave as Excel or PDF. */
  async myLeaveFile(ctx: RequestContext, q: MyFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.leave.meIn(c);
      if (!me) fail('Your sign-in is not linked to an employee record', 404);
      const rows = await c.query<ReqRow>(
        // eslint-disable-next-line no-restricted-syntax -- REQ is a fixed fragment; values are bound
        `${REQ} WHERE r.employee_id = $1 ORDER BY r.from_date DESC, r.id DESC LIMIT $2`,
        [me, LIST_LIMIT],
      );
      checkListSize(rows.rows.length, 'leave');
      const shaped = rows.rows.map((r) => this.leave.shape(r));
      const who = shaped[0]?.employee;
      return purchaseListFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        title: 'My leave',
        slug: 'My-leave',
        words: who ? `${who.name} (${who.code})` : 'No leave yet',
        list: {
          columns: [
            { label: 'Leave no.', width: 1.6 },
            { label: 'Leave type', width: 2.4 },
            { label: 'From', type: 'date' },
            { label: 'To', type: 'date' },
            { label: 'Days', type: 'number', width: 0.8 },
            { label: 'Applied on', type: 'date' },
            { label: 'Status', width: 1.4 },
            { label: 'Reason', width: 4 },
          ],
          rows: shaped.map((r) => [
            r.number,
            `${r.leaveType.name} (${r.leaveType.code})`,
            r.from,
            r.to,
            r.days,
            r.appliedAt.slice(0, 10),
            STATUS[r.status] ?? r.status,
            r.reason,
          ]),
        },
      });
    });
  }

  /** My month's attendance, every day of it, as Excel or PDF. */
  async myAttendanceFile(ctx: RequestContext, q: MyFileDto) {
    const d = await this.att.myMonth(ctx, { month: q.month });
    if (!d.employee) fail('Your sign-in is not linked to an employee record', 404);
    const month = d.month;
    const end = addDays(monthStart(addDays(month, 32)), -1);
    const by = new Map(d.days.map((x) => [x.day, x]));
    const rows: Array<Array<string | number | null>> = [];
    for (let day = month; day <= end; day = addDays(day, 1)) {
      const x = by.get(day);
      rows.push([
        dmy(day),
        WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]!,
        x ? `${x.code}${x.words ? ` ${x.words}` : ''}` : '',
        x?.in ?? '',
        x?.out ?? '',
        x?.worked ?? null,
        [
          x?.late ? `late ${String(x.late)} min` : null,
          x?.early ? `early ${String(x.early)} min` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        x?.remark ?? '',
      ]);
    }
    return this.db.tenant(requireTenant(ctx), async (c) =>
      purchaseListFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        title: `My attendance — ${monthWords(month)}`,
        slug: `My-attendance-${month.slice(0, 7)}`,
        words: `${d.employee!.name} (${d.employee!.code})`,
        list: {
          columns: [
            { label: 'Date', width: 1.3 },
            { label: 'Day', width: 1.3 },
            { label: 'Attendance', width: 2.4 },
            { label: 'In time', width: 1 },
            { label: 'Out time', width: 1 },
            { label: 'Hours', type: 'number', width: 0.9 },
            { label: 'Late / early', width: 2 },
            { label: 'Remark', width: 3 },
          ],
          rows,
        },
      }),
    );
  }
}
