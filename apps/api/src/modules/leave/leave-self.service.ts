import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from '../purchase/purchase-list-file';
import { WorkflowService } from '../workflow/workflow.service';
import { AttendanceService } from './attendance.service';
import { addDays, dmy, fail, monthStart, monthWords } from './leave-engine';
import { leaveReportFile, preparedChecked } from './leave-report-file';
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

/** A leave or its cancellation with a step at my approval level (as on Leave waiting for me). */
const mineOf = (entity: 'staff_leave' | 'staff_leave_cancel') =>
  // eslint-disable-next-line no-restricted-syntax -- the entity is one of two literals; MAY_ACT is a fixed fragment
  `EXISTS (SELECT 1 FROM workflow_instances i JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
            WHERE i.entity_id = r.id AND i.entity_type = '${entity}' AND i.status = 'pending' AND ${WorkflowService.MAY_ACT})`;
const WAITS_ON_ME = `(${mineOf('staff_leave')} OR ${mineOf('staff_leave_cancel')})`;

type Shaped = ReturnType<LeaveService['shape']>;
/** dd-mm-yyyy hh:mm (India time) */
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, '-')
    .replace(',', '');
const halfWords = (r: Pick<Shaped, 'halfDay' | 'session'>) =>
  r.halfDay ? (r.session === 'first' ? 'First half' : 'Second half') : 'No';
/** Yes (the office entered it), System (late marks, missing punches, absence), Imported, or No */
const onBehalfWords = (source: Shaped['source']) =>
  source === 'on_behalf'
    ? 'Yes'
    : source === 'import'
      ? 'Imported'
      : source.startsWith('auto')
        ? 'System'
        : 'No';
const statusWords = (r: Pick<Shaped, 'status' | 'waitingWith' | 'cancelStatus'>) =>
  [
    STATUS[r.status] ?? r.status,
    r.status === 'pending' && r.waitingWith ? `with ${r.waitingWith}` : null,
    r.cancelStatus === 'pending' ? 'cancellation waiting' : null,
  ]
    .filter(Boolean)
    .join(' · ');

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

  /**
   * Reporties leave (the old screen's approval queue, docs/design/85 "the three tabs as the old screen"):
   * `waiting` is every leave or cancellation waiting at my approval level, anyone's; any other status, or
   * none, is my reportees' leave and what waits on me. Filters: employee, leave type, status, the leave
   * touching From–To (or the month); a page at a time, or all of it as Excel or PDF.
   */
  async team(ctx: RequestContext, q: TeamLeaveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.leave.meIn(c);
      const ids = me ? await this.reportees(c, me) : [];
      const from = q.from ?? (q.month ? `${q.month}-01` : null);
      const to = q.to ?? (q.month ? addDays(monthStart(addDays(`${q.month}-01`, 32)), -1) : null);
      const args = [
        ids,
        from,
        to,
        q.status ?? null,
        q.employeeId ?? null,
        q.leaveTypeId ?? null,
        q.q ? `%${q.q}%` : null,
      ];
      // eslint-disable-next-line no-restricted-syntax -- WAITS_ON_ME is a fixed fragment; values are bound
      const where = `WHERE (r.employee_id = ANY($1::bigint[]) OR ${WAITS_ON_ME})
          AND ($2::date IS NULL OR r.to_date >= $2::date) AND ($3::date IS NULL OR r.from_date <= $3::date)
          AND ($4::text IS NULL OR ($4 = 'waiting' AND ${WAITS_ON_ME}) OR r.status = $4)
          AND ($5::bigint IS NULL OR r.employee_id = $5) AND ($6::bigint IS NULL OR r.leave_type_id = $6)
          AND ($7::text IS NULL OR e.display_name ILIKE $7 OR e.employee_code ILIKE $7)`;
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
          `SELECT count(*)::int AS n FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id ${where}`,
          args,
        )
      ).rows[0]!.n;
      const rows = await c.query<ReqRow & { mine_leave: boolean; mine_cancel: boolean }>(
        // eslint-disable-next-line no-restricted-syntax -- REQ and the where are fixed fragments; values are bound
        `${REQ.replace('FROM staff_leave_requests r', `, ${mineOf('staff_leave')} AS mine_leave, ${mineOf('staff_leave_cancel')} AS mine_cancel FROM staff_leave_requests r`)}
          ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT $8 OFFSET $9`,
        q.format ? [...args, LIST_LIMIT, 0] : [...args, q.size, (q.page - 1) * q.size],
      );
      const shaped = rows.rows.map((r) => ({
        ...this.leave.shape(r),
        what: r.mine_cancel ? ('cancellation' as const) : ('leave' as const),
        can: { decide: r.mine_leave && r.status === 'pending', decideCancel: r.mine_cancel },
      }));
      const types = (
        await c.query<{ id: string; code: string; name: string }>(
          `SELECT id::text, code, name FROM staff_leave_types WHERE status = 'active' ORDER BY sort_order, code`,
        )
      ).rows;
      const rangeWords =
        from || to ? `${from ? dmy(from) : '…'} to ${to ? dmy(to) : '…'}` : 'All dates';
      if (q.format) {
        checkListSize(shaped.length, 'leave');
        const emp = q.employeeId
          ? (
              await c.query<{ n: string }>(
                `SELECT display_name || ' (' || employee_code || ')' AS n FROM employees WHERE id = $1`,
                [q.employeeId],
              )
            ).rows[0]?.n
          : null;
        const type = q.leaveTypeId ? types.find((t) => t.id === q.leaveTypeId) : null;
        return leaveReportFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          name: 'Reporties leave',
          slug: 'Reporties-leave',
          words: [
            q.status ? (q.status === 'waiting' ? 'Waiting with me' : STATUS[q.status]) : 'All',
            emp ? `Employee: ${emp}` : null,
            type ? `Leave type: ${type.name} (${type.code})` : null,
            q.q ? `Search: ${q.q}` : null,
            rangeWords,
          ]
            .filter(Boolean)
            .join(' · '),
          table: {
            columns: [
              { label: 'Sr. no.', type: 'number', width: 0.6 },
              { label: 'Leave Id', width: 2.2 },
              { label: 'Employee', width: 2.4 },
              { label: 'Applied date', width: 1.4 },
              { label: 'Attachment', width: 1.4, center: true },
              { label: 'From', type: 'date', width: 1.1 },
              { label: 'To', type: 'date', width: 1.1 },
              { label: 'Days', type: 'number', width: 0.7 },
              { label: 'Is half day', width: 1.1 },
              { label: 'Leave type', width: 1.8 },
              { label: 'On behalf?', width: 0.9, center: true },
              { label: 'On behalf created by', width: 1.6 },
              { label: 'Reason', width: 2.6 },
              { label: 'Status', width: 2 },
            ],
            rows: shaped.map((r, i) => [
              i + 1,
              r.number,
              `${r.employee.name} (${r.employee.code})`,
              when(r.appliedAt),
              r.documentFileId ? 'Yes' : 'No',
              r.from,
              r.to,
              r.days,
              halfWords(r),
              `${r.leaveType.name} (${r.leaveType.code})`,
              onBehalfWords(r.source),
              r.source === 'on_behalf' ? (r.appliedBy ?? '') : '',
              r.reason,
              statusWords(r),
            ]),
            paper: { fontSize: 7 },
          },
          signs: await preparedChecked(c, (k) => this.storage.read(k)),
        });
      }
      const employees = (
        await c.query<{ id: string; name: string; code: string }>(
          // eslint-disable-next-line no-restricted-syntax -- WAITS_ON_ME is a fixed fragment; values are bound
          `SELECT e.id::text, e.display_name AS name, e.employee_code AS code FROM employees e
            WHERE e.id = ANY($1::bigint[])
               OR EXISTS (SELECT 1 FROM staff_leave_requests r WHERE r.employee_id = e.id AND ${WAITS_ON_ME})
            ORDER BY e.display_name, e.employee_code`,
          [ids],
        )
      ).rows;
      const waiting = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- WAITS_ON_ME is a fixed fragment
          `SELECT count(*)::int AS n FROM staff_leave_requests r WHERE ${WAITS_ON_ME}`,
        )
      ).rows[0]!.n;
      return {
        from,
        to,
        status: q.status ?? null,
        team: ids.length,
        waiting,
        rows: shaped,
        total,
        page: q.page,
        size: q.size,
        filters: { employees, types },
      };
    });
  }

  /** My leave touching From–To (or all of it), as on the My Leave tab, as Excel or PDF. */
  async myLeaveFile(ctx: RequestContext, q: MyFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.leave.meIn(c);
      if (!me) fail('Your sign-in is not linked to an employee record', 404);
      const rows = await c.query<ReqRow>(
        // eslint-disable-next-line no-restricted-syntax -- REQ is a fixed fragment; values are bound
        `${REQ} WHERE r.employee_id = $1 AND ($2::date IS NULL OR r.to_date >= $2::date) AND ($3::date IS NULL OR r.from_date <= $3::date)
          ORDER BY r.from_date DESC, r.id DESC LIMIT $4`,
        [me, q.from ?? null, q.to ?? null, LIST_LIMIT],
      );
      checkListSize(rows.rows.length, 'leave');
      const shaped = rows.rows.map((r) => this.leave.shape(r));
      const who = (
        await c.query<{ n: string }>(
          `SELECT display_name || ' (' || employee_code || ')' AS n FROM employees WHERE id = $1`,
          [me],
        )
      ).rows[0]!.n;
      return leaveReportFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        name: 'My leave',
        slug: 'My-leave',
        words: [
          who,
          q.from || q.to
            ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}`
            : 'All dates',
        ].join(' · '),
        table: {
          columns: [
            { label: 'Sr. no.', type: 'number', width: 0.6 },
            { label: 'Leave Id', width: 2.2 },
            { label: 'Leave type', width: 1.8 },
            { label: 'From', type: 'date', width: 1.1 },
            { label: 'To', type: 'date', width: 1.1 },
            { label: 'Days', type: 'number', width: 0.7 },
            { label: 'Attachment', width: 1.4, center: true },
            { label: 'Is half day', width: 1.1 },
            { label: 'Reason', width: 2.6 },
            { label: 'Applied date', width: 1.4 },
            { label: 'Action by', width: 1.6 },
            { label: 'Action date', width: 1.4 },
            { label: 'Status', width: 2 },
          ],
          rows: shaped.map((r, i) => [
            i + 1,
            r.number,
            `${r.leaveType.name} (${r.leaveType.code})`,
            r.from,
            r.to,
            r.days,
            r.documentFileId ? 'Yes' : 'No',
            halfWords(r),
            r.reason,
            when(r.appliedAt),
            r.decidedBy ?? (r.decidedAt ? 'System' : ''),
            r.decidedAt ? when(r.decidedAt) : '',
            statusWords(r),
          ]),
          paper: { fontSize: 7 },
        },
        signs: await preparedChecked(c, (k) => this.storage.read(k)),
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
