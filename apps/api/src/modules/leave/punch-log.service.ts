/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import { Inject, Injectable } from '@nestjs/common';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { istToday } from '../purchase/purchase-stock-core';
import { dmy, fail } from './leave-engine';
import { leaveReportFile, preparedChecked, type ReportTable } from './leave-report-file';
import {
  LEAVE_OFFICE,
  type AssignPunchIdDto,
  type DayVersionsDto,
  type PunchLogDto,
  type UnmatchedDto,
} from './leave.dto';

/** where a punch came from, in words */
const SOURCE: Record<string, string> = {
  device: 'Machine',
  central: 'Central sync',
  import: 'Sheet upload',
  manual: 'Entered by hand',
};
/** how a version of a day was set, in words */
const SET: Record<string, string> = {
  punches: 'Worked out from the punches',
  manual: 'Corrected by the office',
  bulk: 'Bulk update',
  regularisation: 'Correction approved',
  weekoff: 'Weekly off',
  holiday: 'Holiday',
  absent: 'Marked absent (no punch)',
  leave: 'Leave',
};
/** the sources a day is set by the system from (not by a person) */
const SYSTEM = new Set(['punches', 'absent', 'weekoff', 'holiday']);
const TIMING: Record<string, string> = {
  SHIFT: 'the shift',
  SPECIAL: 'a special timing',
  BUS: 'the bus-duty shift',
  BUS_SPECIAL: 'a special timing (bus duty)',
  POSTING_DAY: 'the shift posted for the day',
  DEPARTMENT: 'the department timing',
};
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
const daysIn = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
/** a stored timestamp as India time: 08:04 */
const hm = (iso: unknown) =>
  typeof iso === 'string' && iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso))
    : '';
/** India time in the rows: 12-11-2026 08:04 */
const when = (iso: string | Date | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
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
        .replace(',', '')
    : '';
/** the IST day range as a WHERE fragment on p.punched_at ($1 from, $2 to) */
const IN_RANGE = (col: string) =>
  `${col} >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND ${col} < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;

type Ver = {
  day_type?: string;
  leave_type_id?: string | number | null;
  leave_portion?: string | number | null;
  in_at?: string | null;
  out_at?: string | null;
  source?: string;
  manual?: boolean;
  remark?: string | null;
  updated_by?: string | number | null;
  updated_at?: string | null;
};

/**
 * The staff punch log (docs/design/85, "the biometric log as the old Employee / Attendance Details"): the
 * biometric machines at a glance, every raw punch of a department or of one employee, every version of an
 * employee's days (the one in force and the ones it replaced, who set each and why, how the one in force was
 * worked out), and the punches nobody could be matched to — an unknown ID can be given to an employee, whose
 * punches are then matched and days worked out. Read for the punch-log right; giving an ID, for the office.
 */
@Injectable()
export class PunchLogService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private office(ctx: RequestContext) {
    return ctx.permissions?.has(LEAVE_OFFICE) ?? false;
  }

  /** The machines (last seen, today's punches, waiting to be worked out, unknown IDs) and the other sources. */
  async overview(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = istToday();
      const devices = await c.query<{
        id: string;
        code: string;
        name: string;
        status: string;
        last_seen_at: Date | null;
        today: number;
        last_punch: Date | null;
        waiting: number;
        unknown: number;
      }>(
        `SELECT d.id::text, d.code, d.name, d.status, d.last_seen_at,
                (SELECT count(*)::int FROM punch_logs l WHERE l.device_id = d.id
                    AND (l.punched_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS today,
                (SELECT max(l.punched_at) FROM punch_logs l WHERE l.device_id = d.id) AS last_punch,
                (SELECT count(*)::int FROM staff_punches p WHERE p.source = 'device' AND p.device = d.id::text AND NOT p.read) AS waiting,
                (SELECT count(*)::int FROM punch_logs l WHERE l.device_id = d.id AND l.outcome = 'unknown_id'
                    AND l.punched_at > now() - interval '30 days') AS unknown
           FROM rfid_devices d WHERE d.kind = 'biometric' ORDER BY d.code`,
        [today],
      );
      const others = await c.query<{
        source: string;
        n: number;
        waiting: number;
        last: Date | null;
      }>(
        `SELECT source, count(*)::int AS n, count(*) FILTER (WHERE NOT read)::int AS waiting, max(punched_at) AS last
           FROM staff_punches WHERE source <> 'device' GROUP BY 1 ORDER BY 1`,
      );
      const lists = await c.query<{
        kind: string;
        id: string;
        name: string;
        code: string | null;
        bio: string | null;
      }>(
        `SELECT 'employee' AS kind, id::text, display_name AS name, employee_code AS code, biometric_id AS bio FROM employees
          WHERE deleted_at IS NULL AND status = 'active'
         UNION ALL SELECT DISTINCT 'department', department, department, NULL, NULL FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(department, '') <> ''
         ORDER BY 1, 3`,
      );
      return {
        today,
        devices: devices.rows.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          status: d.status,
          lastSeen: d.last_seen_at,
          today: d.today,
          lastPunch: d.last_punch,
          waiting: d.waiting,
          unknown: d.unknown,
        })),
        others: others.rows.map((o) => ({
          source: o.source,
          words: SOURCE[o.source] ?? o.source,
          punches: o.n,
          waiting: o.waiting,
          last: o.last,
        })),
        lists: {
          employees: lists.rows
            .filter((x) => x.kind === 'employee')
            .map((x) => ({ id: x.id, name: x.name, code: x.code, biometricId: x.bio })),
          departments: lists.rows.filter((x) => x.kind === 'department').map((x) => x.name),
        },
        can: { assign: this.office(ctx), process: this.office(ctx) },
      };
    });
  }

  /** The raw punches of a department (up to 31 days) or of one employee (up to 92), newest first. */
  async log(ctx: RequestContext, q: PunchLogDto) {
    const span = daysIn(q.from, q.to);
    if (q.department && span > 31)
      fail('A department’s punches are up to 31 days at a time: shorten the dates');
    if (q.employeeId && span > 92)
      fail('An employee’s punches are up to 92 days at a time: shorten the dates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const who = q.department ? `lower(e.department) = lower($3)` : `p.employee_id = $3::bigint`;
      const args = [q.from, q.to, q.department ?? q.employeeId!];
      const base = `FROM staff_punches p JOIN employees e ON e.id = p.employee_id WHERE ${IN_RANGE('p.punched_at')} AND ${who}`;
      const fig = (
        await c.query<{ n: number; people: number; days: number; waiting: number }>(
          `SELECT count(*)::int AS n, count(DISTINCT p.employee_id)::int AS people,
                  count(DISTINCT (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS days,
                  count(*) FILTER (WHERE NOT p.read)::int AS waiting ${base}`,
          args,
        )
      ).rows[0]!;
      if (q.format && fig.n > 20000) fail('More than 20,000 punches: shorten the dates');
      const page = q.format ? 1 : q.page;
      const size = q.format ? Math.max(fig.n, 1) : q.size;
      const got = await c.query<{
        id: string;
        emp: string;
        code: string;
        name: string;
        department: string | null;
        day: string;
        time: string;
        source: string;
        read: boolean;
        device: string;
        dev_code: string | null;
        dev_name: string | null;
        day_type: string | null;
        leave_code: string | null;
      }>(
        `SELECT p.id::text, e.id::text AS emp, e.employee_code AS code, e.display_name AS name, e.department,
                to_char(p.punched_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
                to_char(p.punched_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS time,
                p.source, p.read, p.device, d.code AS dev_code, d.name AS dev_name, a.day_type, t.code AS leave_code
           FROM staff_punches p JOIN employees e ON e.id = p.employee_id
           LEFT JOIN rfid_devices d ON p.source = 'device' AND d.id::text = p.device
           LEFT JOIN staff_attendance_days a ON a.employee_id = p.employee_id AND a.day = (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date
           LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
          WHERE ${IN_RANGE('p.punched_at')} AND ${who}
          ORDER BY p.punched_at DESC, e.display_name, p.id DESC
          LIMIT $4 OFFSET $5`,
        [...args, size, (page - 1) * size],
      );
      const rows = got.rows.map((r) => ({
        id: r.id,
        employee: { id: r.emp, code: r.code, name: r.name, department: r.department },
        day: r.day,
        weekday: weekday(r.day),
        time: r.time,
        device:
          r.source === 'device'
            ? r.dev_name
              ? `${r.dev_name} (${r.dev_code ?? ''})`
              : 'A machine no longer listed'
            : r.device || null,
        source: r.source,
        sourceWords: SOURCE[r.source] ?? r.source,
        processed: r.read,
        marked: r.day_type === 'LV' ? (r.leave_code ?? 'LV') : r.day_type,
      }));
      const words = [
        q.department ? `Department: ${q.department}` : `Employee: ${rows[0]?.employee.name ?? ''}`,
        `${dmy(q.from)} to ${dmy(q.to)}`,
      ].join(' · ');
      if (q.format) {
        const table: ReportTable = {
          columns: [
            { label: 'S. no.', type: 'number', width: 0.7 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 2.8 },
            { label: 'Department', width: 2 },
            { label: 'Date', type: 'date', width: 1.3 },
            { label: 'Day', width: 1.4 },
            { label: 'Punch time', width: 1.2, center: true },
            { label: 'Device', width: 2.6 },
            { label: 'Source', width: 1.5 },
            { label: 'Processed', width: 1.2, center: true },
            { label: 'Day marked', width: 1.1, center: true },
          ],
          rows: rows.map((r, i) => [
            i + 1,
            r.employee.code,
            r.employee.name,
            r.employee.department,
            r.day,
            r.weekday,
            r.time,
            r.device ?? '',
            r.sourceWords,
            r.processed ? 'Yes' : 'Waiting',
            r.marked ?? '',
          ]),
          pdfColumns: q.department ? [0, 1, 2, 4, 5, 6, 7, 8, 9, 10] : [0, 4, 5, 6, 7, 8, 9, 10],
          paper: { portrait: !q.department },
        };
        return leaveReportFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          name: 'Staff punch log',
          slug: 'Staff-punches',
          words,
          table,
          signs: await preparedChecked(c, (k) => this.storage.read(k)),
        });
      }
      return {
        mode: q.department ? 'department' : 'employee',
        from: q.from,
        to: q.to,
        words,
        figures: fig,
        rows,
        total: fig.n,
        page,
        size,
      };
    });
  }

  /**
   * Every version of an employee's days, up to 92 days: the one in force (Active) and the ones it replaced
   * (InActive), newest first under it — what the day was, IN and OUT, who set it, when and why; the one in
   * force with how it was worked out (the trace is kept for the day as it stands).
   */
  async versions(ctx: RequestContext, q: DayVersionsDto) {
    if (daysIn(q.from, q.to) > 92)
      fail('An employee’s days are up to 92 at a time: shorten the dates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emp = (
        await c.query<{ id: string; code: string; name: string; department: string | null }>(
          `SELECT id::text, employee_code AS code, display_name AS name, department FROM employees WHERE id = $1 AND deleted_at IS NULL`,
          [q.employeeId],
        )
      ).rows[0];
      if (!emp) return fail('No such employee', 404);
      const cur = await c.query<
        Ver & { day: string; trace: Record<string, unknown> | null; leave_code: string | null }
      >(
        `SELECT a.day::text, a.day_type, a.leave_type_id::text, a.leave_portion::text, a.in_at::text, a.out_at::text, a.source,
                a.manual, a.remark, a.trace, a.updated_by::text, a.updated_at::text, t.code AS leave_code
           FROM staff_attendance_days a LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
          WHERE a.employee_id = $1 AND a.day BETWEEN $2::date AND $3::date`,
        [q.employeeId, q.from, q.to],
      );
      const hist = await c.query<{
        day: string;
        before: Ver | null;
        after: Ver | null;
        reason: string | null;
        changed_by: string | null;
        changed_at: string;
      }>(
        `SELECT day::text, before, after, reason, changed_by::text, changed_at::text FROM staff_attendance_history
          WHERE employee_id = $1 AND day BETWEEN $2::date AND $3::date ORDER BY day, changed_at, id`,
        [q.employeeId, q.from, q.to],
      );
      const userIds = new Set<string>();
      for (const r of cur.rows) if (r.updated_by) userIds.add(String(r.updated_by));
      for (const h of hist.rows) {
        if (h.changed_by) userIds.add(h.changed_by);
        if (h.before?.updated_by) userIds.add(String(h.before.updated_by));
      }
      const names = new Map(
        (
          await c.query<{ id: string; name: string }>(
            `SELECT u.id::text, COALESCE((SELECT e.employee_code || ' — ' FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), '')
                    || u.display_name AS name FROM users u WHERE u.id = ANY($1::bigint[])`,
            [[...userIds]],
          )
        ).rows.map((u) => [u.id, u.name]),
      );
      const codes = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, code FROM staff_leave_types`,
          )
        ).rows.map((t) => [t.id, t.code]),
      );
      const what = (v: Ver) =>
        v.day_type === 'LV'
          ? `${codes.get(String(v.leave_type_id ?? '')) ?? 'LV'}${Number(v.leave_portion ?? 1) < 1 ? ' ½' : ''}`
          : (v.day_type ?? '');
      const by = (id: unknown) => (id ? (names.get(String(id)) ?? 'A user') : 'The system');
      type Row = {
        day: string;
        weekday: string;
        attendance: string;
        in: string;
        out: string;
        active: boolean;
        by: string;
        at: string | null;
        remark: string;
        trace: Array<[string, string]> | null;
      };
      const out: Row[] = [];
      const byDay = new Map<string, typeof hist.rows>();
      for (const h of hist.rows) byDay.set(h.day, [...(byDay.get(h.day) ?? []), h]);
      const curOf = new Map(cur.rows.map((r) => [r.day, r]));
      const days = [...new Set([...curOf.keys(), ...byDay.keys()])].sort();
      for (const day of days) {
        const hs = byDay.get(day) ?? [];
        // a day worked out from the punches or marked by the nightly run is the system's, whoever
        // pressed Process now
        const system = (v: Ver, reason?: string | null) =>
          SYSTEM.has(v.source ?? '') || reason === 'punches' || /^marked /.test(reason ?? '');
        const vs: Array<{ v: Ver; by: unknown; at: string | null; why: string }> = [];
        if (hs[0]?.before)
          vs.push({
            v: hs[0].before,
            by: system(hs[0].before) ? null : hs[0].before.updated_by,
            at: hs[0].before.updated_at ?? null,
            why: hs[0].before.remark ?? SET[hs[0].before.source ?? ''] ?? '',
          });
        for (const h of hs)
          if (h.after)
            vs.push({
              v: h.after,
              by: system(h.after, h.reason) ? null : h.changed_by,
              at: h.changed_at,
              why: h.reason === 'punches' ? SET.punches! : (h.reason ?? ''),
            });
        const now = curOf.get(day);
        if (now && !vs.length)
          vs.push({
            v: now,
            by: system(now) ? null : now.updated_by,
            at: now.updated_at ?? null,
            why: now.remark ?? SET[now.source ?? ''] ?? '',
          });
        // the one in force first, then the ones it replaced, newest first
        vs.reverse().forEach((x, i) => {
          const active = i === 0 && !!now;
          const v = active ? { ...x.v, ...now } : x.v;
          out.push({
            day,
            weekday: weekday(day),
            attendance: what(v),
            in: hm(v.in_at),
            out: hm(v.out_at),
            active,
            by: by(x.by),
            at: x.at,
            remark: x.why || v.remark || '',
            trace: active && now?.trace ? traceWords(now.trace) : null,
          });
        });
      }
      const words = `${emp.name} (${emp.code}) · ${dmy(q.from)} to ${dmy(q.to)}`;
      if (q.format) {
        const table: ReportTable = {
          columns: [
            { label: 'S. no.', type: 'number', width: 0.7 },
            { label: 'Date', type: 'date', width: 1.3 },
            { label: 'Day', width: 1.4 },
            { label: 'Attendance', width: 1.1, center: true },
            { label: 'In time', width: 1, center: true },
            { label: 'Out time', width: 1, center: true },
            { label: 'Status', width: 1.1, center: true },
            { label: 'Marked by', width: 2.6 },
            { label: 'Marked date-time', width: 1.8 },
            { label: 'Remark', width: 3.6 },
          ],
          rows: out.map((r, i) => [
            i + 1,
            r.day,
            r.weekday,
            r.attendance,
            r.in,
            r.out,
            r.active ? 'Active' : 'InActive',
            r.by,
            when(r.at),
            r.remark,
          ]),
          strong: out.map((r, i) => (r.active ? i : -1)).filter((i) => i >= 0),
        };
        return leaveReportFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          name: 'Attendance history',
          slug: 'Attendance-history',
          words,
          table,
          signs: await preparedChecked(c, (k) => this.storage.read(k)),
        });
      }
      return {
        employee: emp,
        from: q.from,
        to: q.to,
        words,
        rows: out.map((r) => ({ ...r, at: r.at ? new Date(r.at).toISOString() : null })),
        days: days.length,
        changed: days.filter((d) => (byDay.get(d)?.length ?? 0) > 1 || byDay.get(d)?.[0]?.before)
          .length,
      };
    });
  }

  /** The punches nobody could be matched to (an unknown ID) and the double taps the machines sent. */
  async unmatched(ctx: RequestContext, q: UnmatchedDto) {
    if (daysIn(q.from, q.to) > 366) fail('Up to a year at a time');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const got = await c.query<{
        id: string;
        outcome: string;
        dev_code: string | null;
        dev_name: string | null;
        source: string;
        n: number;
        days: number;
        first: Date;
        last: Date;
        emp: string | null;
        emp_code: string | null;
        emp_name: string | null;
        holder: string | null;
      }>(
        `SELECT l.biometric_id AS id, l.outcome, d.code AS dev_code, d.name AS dev_name, 'device' AS source,
                count(*)::int AS n, count(DISTINCT (l.punched_at AT TIME ZONE 'Asia/Kolkata')::date)::int AS days,
                min(l.punched_at) AS first, max(l.punched_at) AS last,
                max(e.id::text) AS emp, max(e.employee_code) AS emp_code, max(e.display_name) AS emp_name,
                (SELECT h.employee_code || ' — ' || h.display_name FROM employees h
                  WHERE h.biometric_id = l.biometric_id AND h.deleted_at IS NULL LIMIT 1) AS holder
           FROM punch_logs l LEFT JOIN rfid_devices d ON d.id = l.device_id LEFT JOIN employees e ON e.id = l.employee_id
          WHERE l.outcome <> 'recorded' AND ${IN_RANGE('l.punched_at')}
          GROUP BY l.biometric_id, l.outcome, d.code, d.name
         UNION ALL
         SELECT p.code, 'unknown_id', NULL, NULL, p.source, count(*)::int,
                count(DISTINCT (p.punched_at AT TIME ZONE 'Asia/Kolkata')::date)::int, min(p.punched_at), max(p.punched_at),
                NULL, NULL, NULL, NULL
           FROM staff_punches p WHERE p.employee_id IS NULL AND ${IN_RANGE('p.punched_at')}
          GROUP BY p.code, p.source
          ORDER BY 2 DESC, 6 DESC, 1`,
        [q.from, q.to],
      );
      const rows = got.rows.map((r) => ({
        id: r.id,
        kind: r.outcome === 'duplicate' ? ('double' as const) : ('unknown' as const),
        device: r.dev_name ? `${r.dev_name} (${r.dev_code ?? ''})` : (SOURCE[r.source] ?? r.source),
        punches: r.n,
        days: r.days,
        first: r.first,
        last: r.last,
        employee: r.emp ? { id: r.emp, code: r.emp_code, name: r.emp_name } : null,
        /** an unknown ID an employee holds now (given on their record since): its punches wait to be matched */
        holder: r.holder,
      }));
      return {
        from: q.from,
        to: q.to,
        rows,
        unknown: rows.filter((r) => r.kind === 'unknown').reduce((a, r) => a + r.punches, 0),
        double: rows.filter((r) => r.kind === 'double').reduce((a, r) => a + r.punches, 0),
        can: { assign: this.office(ctx) },
      };
    });
  }

  /**
   * An unknown ID given to an employee (the office): it goes on their record, the machine's punches under it
   * are matched to them, and the days those punches fall on are worked out again (not in a month locked
   * for payroll). Refused when someone else holds the ID or the employee has another one.
   */
  async assign(ctx: RequestContext, dto: AssignPunchIdDto) {
    if (!this.office(ctx)) fail('Only the leave office gives an ID to an employee', 403);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = (
        await c.query<{ id: string; code: string; name: string; bio: string | null }>(
          `SELECT id::text, employee_code AS code, display_name AS name, biometric_id AS bio FROM employees
            WHERE id = $1 AND deleted_at IS NULL AND status = 'active' FOR UPDATE`,
          [dto.employeeId],
        )
      ).rows[0];
      if (!e) return fail('No such employee', 404);
      const other = (
        await c.query<{ code: string }>(
          `SELECT employee_code AS code FROM employees WHERE biometric_id = $1 AND id <> $2 AND deleted_at IS NULL LIMIT 1`,
          [dto.biometricId, e.id],
        )
      ).rows[0];
      if (other) fail(`${other.code} already has ${dto.biometricId} on the machine`, 409);
      if (e.bio && e.bio !== dto.biometricId)
        fail(
          `${e.code} already has the ID ${e.bio}: change it on the employee's record first`,
          409,
        );
      if (!e.bio)
        await c.query(`UPDATE employees SET biometric_id = $2, updated_at = now() WHERE id = $1`, [
          e.id,
          dto.biometricId,
        ]);
      const logs = await c.query<{ id: string; device: string; at: Date }>(
        `UPDATE punch_logs SET employee_id = $2, outcome = 'recorded',
                raw = raw || jsonb_build_object('matched_by', app.current_user_id(), 'matched_at', now())
          WHERE biometric_id = $1 AND outcome = 'unknown_id'
         RETURNING id::text, device_id::text AS device, punched_at AS at`,
        [dto.biometricId, e.id],
      );
      for (const l of logs.rows)
        await c.query(
          `INSERT INTO staff_punches (school_id, employee_id, code, punched_at, source, device, ref)
           VALUES (app.current_school_id(), $1, $2, $3, 'device', $4, $5) ON CONFLICT DO NOTHING`,
          [e.id, dto.biometricId, l.at, l.device, l.id],
        );
      const loose = await c.query(
        `UPDATE staff_punches SET employee_id = $2 WHERE employee_id IS NULL AND code = $1`,
        [dto.biometricId, e.id],
      );
      const days = (
        await c.query<{ d: string }>(
          `SELECT DISTINCT (punched_at AT TIME ZONE 'Asia/Kolkata')::date::text AS d FROM staff_punches
            WHERE employee_id = $1 AND NOT read ORDER BY 1`,
          [e.id],
        )
      ).rows.map((x) => x.d);
      for (const d of days) {
        await c.query(`SELECT app.staff_day_compute($1, $2::date)`, [e.id, d]);
        await c.query(
          `UPDATE staff_punches SET read = true WHERE employee_id = $1 AND NOT read
              AND (punched_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
          [e.id, d],
        );
      }
      const punches = logs.rowCount ?? 0;
      await this.audit.stage(ctx, c, {
        action: 'leave.punch.assign_id',
        entityType: 'employees',
        entityId: e.id,
        before: { biometricId: e.bio },
        after: { biometricId: dto.biometricId, punches, loose: loose.rowCount ?? 0, days },
      });
      return {
        employee: `${e.code} — ${e.name}`,
        punches: punches + (loose.rowCount ?? 0),
        days: days.length,
      };
    });
  }
}

/** how the day in force was worked out, in words (the trace the day keeps) */
export function traceWords(t: Record<string, unknown>): Array<[string, string]> {
  const s = (k: string) =>
    t[k] === null || t[k] === undefined || t[k] === '' ? null : String(t[k]);
  const out: Array<[string, string]> = [];
  if (s('set')) {
    out.push(['Set', SET[s('set')!] ?? s('set')!]);
    if (s('reason')) out.push(['Why', s('reason')!]);
    return out;
  }
  if (s('shift'))
    out.push([
      'Timing',
      `${s('shift')!} ${s('start') ?? ''}–${s('end') ?? ''}${s('timing') ? ` (${TIMING[s('timing')!] ?? s('timing')!})` : ''}`,
    ]);
  if (s('grace')) out.push(['Grace', `${s('grace')!} min`]);
  if (s('in') || s('out')) out.push(['Punches', `IN ${s('in') ?? '—'} · OUT ${s('out') ?? '—'}`]);
  if (s('worked')) out.push(['Worked', `${s('worked')!} h`]);
  if (s('present'))
    out.push([
      'Present from',
      `${s('presentNow') ?? s('present')!} h (half day from ${s('halfNow') ?? s('half') ?? '—'} h)`,
    ]);
  if (Number(t.late ?? 0) > 0) out.push(['Late', `${s('late')!} min`]);
  if (Number(t.early ?? 0) > 0) out.push(['Early', `${s('early')!} min`]);
  if (Number(t.forgiven ?? 0) > 0) out.push(['Forgiven', `${s('forgiven')!} min (grace)`]);
  if (s('singlePunch')) out.push(['One punch only', `counted as ${s('singlePunch')!}`]);
  if (s('off')) out.push(['Off day', s('off') === 'WO' ? 'weekly off' : 'holiday']);
  if (s('rule')) out.push(['Shift rule', s('rule')!]);
  if (s('result')) out.push(['Result', s('result')!]);
  return out;
}
