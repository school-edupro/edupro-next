import { Injectable } from '@nestjs/common';
import {
  datesBetween,
  daysString,
  daysToHundredths,
  deriveAttendance,
  type RegisterDay,
} from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  RUN,
  type AttendanceImportDto,
  type AttendanceListDto,
  type HoldDto,
  type LiftDto,
  type ManualAttendanceDto,
  type MarkPresentDto,
  type PullDto,
  type TdsManualDto,
  type UnfinaliseDto,
} from './payroll-inputs.dto';
import {
  bad,
  camelRow,
  firstOf,
  hiddenFor,
  monthOf,
  monthWords,
  must,
  mustBeOpen,
  ROSTER_SQL,
  runCan,
  runStages,
  today,
  windowOf,
} from './payroll-month';
import { PayrollSetupService } from './payroll-setup.service';
import { PAYROLL } from './payroll.dto';

interface Roster {
  employee_id: string;
  employee_code: string;
  display_name: string;
  department: string | null;
  designation: string | null;
  joined_on: string | null;
  left_on: string | null;
  status: string;
}
const H = (d: string | number | null | undefined) => daysToHundredths(String(d ?? '0'));
const S = daysString;

/**
 * The monthly inputs, attendance side (docs/design/86, phase B step 1; PAYROLL_RUN_SPEC.md §7.1–7.6, 7.12):
 * attendance for payroll pulled from the attendance register, corrected by hand or marked present, explained,
 * finalised by a checker; salary hold; a month's income tax typed by hand.
 */
@Injectable()
export class PayrollAttendanceService {
  static readonly SHEET = ['Employee code', 'Loss of pay days', 'Reason'];
  static readonly SHEET_OPTIONAL = ['Paid leave days', 'Present days', 'OT hours'];

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async roster(c: PoolClient, from: string, to: string, hidden: string[]) {
    return (
      await c.query<Roster>(
        // eslint-disable-next-line no-restricted-syntax -- ROSTER_SQL is a fixed fragment; values are bound
        `${ROSTER_SQL} AND NOT (e.id::text = ANY($3::text[])) ORDER BY e.employee_code`,
        [from, to, hidden],
      )
    ).rows;
  }
  private async limits(c: PoolClient) {
    const s = (
      await c.query<{ ot: string; unmarked: 'present' | 'absent' }>(
        `SELECT ot_hours_limit::text AS ot, unmarked_as AS unmarked FROM payroll_settings`,
      )
    ).rows[0];
    return { otLimit: s?.ot ?? '744', unmarkedAs: s?.unmarked ?? 'present' };
  }
  /** The register months the window touches that are over and not locked (a pull is refused), and the running one. */
  private async registerLocks(c: PoolClient, from: string, to: string) {
    const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
    const locked = new Set(
      (
        await c.query<{ m: string }>(
          `SELECT to_char(month, 'YYYY-MM') AS m FROM staff_month_locks WHERE locked AND month = ANY($1::date[])`,
          [months.map(firstOf)],
        )
      ).rows.map((r) => r.m),
    );
    const now = today().slice(0, 7);
    return {
      unlocked: months.filter((m) => m < now && !locked.has(m)),
      running: months.filter((m) => m >= now),
      locked: months.filter((m) => locked.has(m)),
    };
  }

  // ---- the month at a glance and its list ------------------------------------------------------------------
  async month(ctx: RequestContext, q: AttendanceListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const { from, to } = await windowOf(c, q.month);
      const hidden = await hiddenFor(c, ctx);
      const roster = await this.roster(c, from, to, hidden);
      const rows = new Map(
        (
          await c.query<Record<string, unknown>>(
            `SELECT a.employee_id::text, a.month_days::text, a.present_days::text, a.paid_leave_days::text, a.lop_days::text,
                    a.pre_join_days::text, a.post_leave_days::text, a.paid_days::text, a.ot_hours::text, a.unmarked_days,
                    a.source, a.reason, a.finalised, a.finalised_at, a.updated_at,
                    COALESCE(jsonb_array_length(a.detail->'warnings'), 0) AS warnings
               FROM payroll_attendance a WHERE a.month = $1::date`,
            [firstOf(q.month)],
          )
        ).rows.map((r) => [r.employee_id as string, camelRow(r)]),
      );
      const holds = new Map(
        (
          await c.query<{ employee_id: string; id: string; mode: string; reason: string }>(
            `SELECT employee_id::text, id::text, mode, reason FROM payroll_holds WHERE month = $1::date AND active`,
            [firstOf(q.month)],
          )
        ).rows.map((r) => [r.employee_id, { id: r.id, mode: r.mode, reason: r.reason }]),
      );
      const all = roster.map((e) => ({
        employee: {
          id: e.employee_id,
          code: e.employee_code,
          name: e.display_name,
          department: e.department,
          designation: e.designation,
          joinedOn: e.joined_on,
          leftOn: e.left_on,
        },
        attendance: rows.get(e.employee_id) ?? null,
        hold: holds.get(e.employee_id) ?? null,
      }));
      const text = (q.q ?? '').toLowerCase();
      const shown = all.filter((r) => {
        if (text && !`${r.employee.code} ${r.employee.name}`.toLowerCase().includes(text))
          return false;
        const a = r.attendance as Record<string, unknown> | null;
        switch (q.show) {
          case 'missing':
            return !a && r.hold?.mode !== 'SKIP';
          case 'open':
            return !!a && !a.finalised;
          case 'finalised':
            return !!a && !!a.finalised;
          case 'manual':
            return !!a && a.source !== 'register';
          case 'warnings':
            return !!a && Number(a.warnings) > 0;
          default:
            return true;
        }
      });
      const skip = all.filter((r) => r.hold?.mode === 'SKIP').length;
      const counted = all.filter((r) => r.hold?.mode !== 'SKIP');
      const locks = await this.registerLocks(c, from, to);
      return {
        month: q.month,
        monthWords: monthWords(q.month),
        window: { from, to },
        register: locks,
        figures: {
          staff: all.length,
          pulled: counted.filter((r) => r.attendance).length,
          missing: counted.filter((r) => !r.attendance).length,
          finalised: counted.filter(
            (r) => (r.attendance as { finalised?: boolean } | null)?.finalised,
          ).length,
          manual: counted.filter(
            (r) => r.attendance && (r.attendance as { source: string }).source !== 'register',
          ).length,
          held: all.filter((r) => r.hold?.mode === 'HOLD').length,
          skipped: skip,
        },
        runs: await runStages(c, q.month),
        rows: shown.slice((q.page - 1) * q.size, q.page * q.size),
        total: shown.length,
        page: q.page,
        size: q.size,
        can: runCan(ctx),
      };
    });
  }

  // ---- pull from the attendance register --------------------------------------------------------------------
  async pull(ctx: RequestContext, dto: PullDto) {
    must(ctx, RUN.manage, 'Only payroll makers pull attendance');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'attendance');
      const { from, to } = await windowOf(c, dto.month);
      const locks = await this.registerLocks(c, from, to);
      if (locks.unlocked.length)
        bad(
          `Lock ${locks.unlocked.map(monthWords).join(' and ')} in the attendance register first (Attendance register → Lock the month): payroll reads only a locked month`,
          409,
        );
      const hidden = await hiddenFor(c, ctx);
      let roster = await this.roster(c, from, to, hidden);
      if (dto.employeeIds?.length) {
        const pick = new Set(dto.employeeIds);
        roster = roster.filter((r) => pick.has(r.employee_id));
      }
      const skips = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT employee_id::text AS id FROM payroll_holds WHERE month = $1::date AND active AND mode = 'SKIP'`,
            [firstOf(dto.month)],
          )
        ).rows.map((r) => r.id),
      );
      const existing = new Map(
        (
          await c.query<{
            employee_id: string;
            finalised: boolean;
            ot_hours: string;
            ot_typed: boolean;
          }>(
            `SELECT employee_id::text, finalised, ot_hours::text, COALESCE((detail->>'otTyped')::boolean, false) AS ot_typed
               FROM payroll_attendance WHERE month = $1::date`,
            [firstOf(dto.month)],
          )
        ).rows.map((r) => [r.employee_id, r]),
      );
      const todo = roster.filter(
        (r) => !skips.has(r.employee_id) && !existing.get(r.employee_id)?.finalised,
      );
      const days = await c.query<{
        employee_id: string;
        day: string;
        day_type: RegisterDay['type'];
        leave_portion: string | null;
        code: string | null;
        loss_of_pay: boolean | null;
        pay_percent: string | null;
        ot_hours: string;
      }>(
        `SELECT d.employee_id::text, d.day::text, d.day_type, d.leave_portion::text, t.code, t.loss_of_pay, t.pay_percent::text,
                d.ot_hours::text
           FROM staff_attendance_days d LEFT JOIN staff_leave_types t ON t.id = d.leave_type_id
          WHERE d.day BETWEEN $1::date AND $2::date AND d.employee_id::text = ANY($3::text[])`,
        [from, to, todo.map((r) => r.employee_id)],
      );
      const byEmp = new Map<string, Map<string, RegisterDay>>();
      const ot = new Map<string, bigint>();
      for (const d of days.rows) {
        const m = byEmp.get(d.employee_id) ?? new Map<string, RegisterDay>();
        m.set(d.day, {
          type: d.day_type,
          ...(d.leave_portion ? { portion: Number(d.leave_portion) < 1 ? 50 : 100 } : {}),
          ...(d.code ? { leaveCode: d.code } : {}),
          ...(d.loss_of_pay ? { lossOfPay: true } : {}),
          ...(d.pay_percent !== null ? { payPercent: Number(d.pay_percent) } : {}),
        } as RegisterDay);
        byEmp.set(d.employee_id, m);
        ot.set(d.employee_id, (ot.get(d.employee_id) ?? 0n) + H(d.ot_hours));
      }
      const { otLimit, unmarkedAs } = await this.limits(c);
      const limit = H(otLimit);
      const now = today();
      let warned = 0;
      for (const e of todo) {
        const f = deriveAttendance({
          from,
          to,
          days: byEmp.get(e.employee_id) ?? new Map(),
          joinedOn: e.joined_on,
          leftOn: e.left_on,
          today: now,
          unmarkedAs,
        });
        const prev = existing.get(e.employee_id);
        let hours = ot.get(e.employee_id) ?? 0n;
        const warnings = [...f.detail.warnings];
        if (prev?.ot_typed) hours = H(prev.ot_hours);
        else if (hours > limit) {
          warnings.push(`Overtime ${S(hours)} h is above the monthly limit: ${S(limit)} h taken`);
          hours = limit;
        }
        if (warnings.length) warned += 1;
        const detail = {
          counts: Object.fromEntries(Object.entries(f.detail.counts).map(([k, v]) => [k, S(v)])),
          leave: Object.fromEntries(
            Object.entries(f.detail.leave).map(([k, v]) => [
              k,
              { days: S(v.days), paid: S(v.paid), lop: S(v.lop) },
            ]),
          ),
          lop: Object.fromEntries(Object.entries(f.detail.lopBreakdown).map(([k, v]) => [k, S(v)])),
          futureDays: f.detail.futureDays,
          unmarkedAs,
          otRegister: S(ot.get(e.employee_id) ?? 0n),
          otTyped: prev?.ot_typed ?? false,
          joinedOn: e.joined_on,
          leftOn: e.left_on,
          registerLocked: locks.locked,
          warnings,
        };
        await c.query(
          `INSERT INTO payroll_attendance (school_id, employee_id, month, window_from, window_to, month_days, present_days,
                                           paid_leave_days, lop_days, pre_join_days, post_leave_days, paid_days, ot_hours,
                                           unmarked_days, source, reason, detail, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   'register', NULL, $14::jsonb, app.current_user_id(), app.current_user_id())
           ON CONFLICT (employee_id, month) DO UPDATE SET
             window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to, month_days = EXCLUDED.month_days,
             present_days = EXCLUDED.present_days, paid_leave_days = EXCLUDED.paid_leave_days, lop_days = EXCLUDED.lop_days,
             pre_join_days = EXCLUDED.pre_join_days, post_leave_days = EXCLUDED.post_leave_days, paid_days = EXCLUDED.paid_days,
             ot_hours = EXCLUDED.ot_hours, unmarked_days = EXCLUDED.unmarked_days, source = 'register', reason = NULL,
             detail = EXCLUDED.detail, updated_by = app.current_user_id(), updated_at = now()
           WHERE NOT payroll_attendance.finalised`,
          [
            e.employee_id,
            firstOf(dto.month),
            from,
            to,
            S(f.monthDays),
            S(f.present),
            S(f.paidLeave),
            S(f.lop),
            S(f.preJoin),
            S(f.postLeave),
            S(f.paid),
            S(hours),
            f.unmarked,
            JSON.stringify(detail),
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.attendance.pull',
        entityType: 'payroll_attendance',
        entityId: dto.month,
        after: { pulled: todo.length, window: { from, to } },
      });
      return {
        pulled: todo.length,
        finalisedKept: [...existing.values()].filter((r) => r.finalised).length,
        skipped: roster.filter((r) => skips.has(r.employee_id)).length,
        withWarnings: warned,
        notes: locks.running.length
          ? [
              `${locks.running.map(monthWords).join(' and ')} is still running: pull again once it is over and locked`,
            ]
          : [],
      };
    });
  }

  // ---- one employee: explain, correct by hand -------------------------------------------------------------------
  async explain(ctx: RequestContext, employeeId: string, month: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await hiddenFor(c, ctx)).includes(employeeId)) bad('Not found', 404);
      const e = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, employee_code AS code, display_name AS name, department, designation, joined_on::text, left_on::text
             FROM employees WHERE id = $1 AND deleted_at IS NULL`,
          [employeeId],
        )
      ).rows[0];
      if (!e) bad('Employee not found', 404);
      const a = (
        await c.query<Record<string, unknown>>(
          `SELECT a.*, a.window_from::text AS window_from, a.window_to::text AS window_to, a.month::text AS month,
                  a.month_days::text AS month_days, a.present_days::text AS present_days, a.paid_leave_days::text AS paid_leave_days,
                  a.lop_days::text AS lop_days, a.pre_join_days::text AS pre_join_days, a.post_leave_days::text AS post_leave_days,
                  a.paid_days::text AS paid_days, a.ot_hours::text AS ot_hours,
                  u.display_name AS updated_by_name, f.display_name AS finalised_by_name
             FROM payroll_attendance a LEFT JOIN users u ON u.id = a.updated_by LEFT JOIN users f ON f.id = a.finalised_by
            WHERE a.employee_id = $1 AND a.month = $2::date`,
          [employeeId, firstOf(month)],
        )
      ).rows[0];
      const hold = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, mode, reason FROM payroll_holds WHERE employee_id = $1 AND month = $2::date AND active`,
          [employeeId, firstOf(month)],
        )
      ).rows[0];
      return {
        employee: camelRow(e!),
        month,
        attendance: a
          ? (() => {
              const r = camelRow(a);
              delete r.schoolId;
              delete r.createdBy;
              delete r.updatedBy;
              delete r.finalisedBy;
              return r;
            })()
          : null,
        hold: hold ? camelRow(hold) : null,
        can: runCan(ctx),
      };
    });
  }

  async setManual(ctx: RequestContext, employeeId: string, dto: ManualAttendanceDto) {
    must(ctx, RUN.manage, 'Only payroll makers correct attendance');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'attendance');
      if ((await hiddenFor(c, ctx)).includes(employeeId)) bad('Not found', 404);
      const r = await this.writeManual(c, employeeId, dto.month, {
        lop: dto.lopDays,
        paidLeave: dto.paidLeaveDays ?? null,
        present: dto.presentDays ?? null,
        ot: dto.otHours ?? null,
        reason: dto.reason,
        source: 'manual',
      });
      await this.audit.stage(ctx, c, {
        action: 'payroll.attendance.manual',
        entityType: 'payroll_attendance',
        entityId: `${employeeId}/${dto.month}`,
        before: r.before,
        after: r.after,
      });
      return r.after;
    });
  }

  /** One employee-month written by hand (manual entry, the sheet, mark present): checked, paid days worked out. */
  private async writeManual(
    c: PoolClient,
    employeeId: string,
    month: string,
    v: {
      lop: string | null;
      paidLeave: string | null;
      present: string | null;
      ot: string | null;
      reason: string;
      source: 'manual' | 'import' | 'quick_fill';
    },
  ) {
    const { from, to } = await windowOf(c, month);
    const e = (
      await c.query<{ joined_on: string | null; left_on: string | null }>(
        `SELECT joined_on::text, left_on::text FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [employeeId],
      )
    ).rows[0];
    if (!e) bad('Employee not found', 404);
    const before = (
      await c.query<Record<string, string | boolean | null>>(
        `SELECT finalised, lop_days::text AS lop, paid_leave_days::text AS paid_leave, present_days::text AS present,
                ot_hours::text AS ot, source, detail FROM payroll_attendance WHERE employee_id = $1 AND month = $2::date`,
        [employeeId, firstOf(month)],
      )
    ).rows[0];
    if (before?.finalised)
      bad(
        `${monthWords(month)} is finalised for this employee: a payroll admin un-finalises it first`,
        409,
      );
    const dates = datesBetween(from, to);
    const monthDays = BigInt(dates.length) * 100n;
    const pre = BigInt(dates.filter((d) => e!.joined_on && d < e!.joined_on).length) * 100n;
    const post = BigInt(dates.filter((d) => e!.left_on && d > e!.left_on).length) * 100n;
    const room = monthDays - pre - post;
    const lop = v.lop === null ? H(before?.lop as string | null) : H(v.lop);
    const paidLeave =
      v.paidLeave === null ? H((before?.paid_leave as string | null) ?? '0') : H(v.paidLeave);
    if (lop > room)
      bad(
        `Loss of pay ${S(lop)} is more than the ${S(room)} day(s) employed in ${monthWords(month)}`,
      );
    if (lop + paidLeave > room)
      bad('Loss of pay and paid leave together are more than the days employed');
    const present = v.present === null ? room - lop - paidLeave : H(v.present);
    if (present + lop + paidLeave > room)
      bad('Present, paid leave and loss of pay together are more than the days employed');
    const { otLimit } = await this.limits(c);
    const otTyped = v.ot !== null;
    const ot = otTyped ? H(v.ot) : H((before?.ot as string | null) ?? '0');
    if (ot > H(otLimit))
      bad(`Overtime is more than the monthly limit of ${otLimit} hours (payroll settings)`);
    const prevDetail = (before?.detail as unknown as Record<string, unknown> | undefined) ?? {};
    const detail = {
      ...prevDetail,
      otTyped: otTyped || prevDetail.otTyped === true,
      manual: { at: new Date().toISOString(), reason: v.reason, source: v.source },
      warnings:
        pre || post
          ? [`Days before joining (${S(pre)}) and after leaving (${S(post)}) are not paid`]
          : [],
    };
    const after = {
      monthDays: S(monthDays),
      presentDays: S(present),
      paidLeaveDays: S(paidLeave),
      lopDays: S(lop),
      preJoinDays: S(pre),
      postLeaveDays: S(post),
      paidDays: S(room - lop),
      otHours: S(ot),
      source: v.source,
      reason: v.reason,
    };
    await c.query(
      `INSERT INTO payroll_attendance (school_id, employee_id, month, window_from, window_to, month_days, present_days,
                                       paid_leave_days, lop_days, pre_join_days, post_leave_days, paid_days, ot_hours,
                                       unmarked_days, source, reason, detail, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2::date, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14,
               $15::jsonb, app.current_user_id(), app.current_user_id())
       ON CONFLICT (employee_id, month) DO UPDATE SET
         window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to, month_days = EXCLUDED.month_days,
         present_days = EXCLUDED.present_days, paid_leave_days = EXCLUDED.paid_leave_days, lop_days = EXCLUDED.lop_days,
         pre_join_days = EXCLUDED.pre_join_days, post_leave_days = EXCLUDED.post_leave_days, paid_days = EXCLUDED.paid_days,
         ot_hours = EXCLUDED.ot_hours, unmarked_days = 0, source = EXCLUDED.source, reason = EXCLUDED.reason,
         detail = EXCLUDED.detail, updated_by = app.current_user_id(), updated_at = now()`,
      [
        employeeId,
        firstOf(month),
        from,
        to,
        after.monthDays,
        after.presentDays,
        after.paidLeaveDays,
        after.lopDays,
        after.preJoinDays,
        after.postLeaveDays,
        after.paidDays,
        after.otHours,
        v.source,
        v.reason,
        JSON.stringify(detail),
      ],
    );
    return { before: before ?? null, after };
  }

  // ---- mark the month present (a checker): everyone not finalised, the exceptions as given -----------------------
  async markPresent(ctx: RequestContext, dto: MarkPresentDto) {
    must(ctx, RUN.approve, 'Only a payroll checker marks the month present');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'attendance');
      const { from, to } = await windowOf(c, dto.month);
      const roster = await this.roster(c, from, to, []);
      const on = new Set(roster.map((r) => r.employee_id));
      const skips = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT employee_id::text AS id FROM payroll_holds WHERE month = $1::date AND active AND mode = 'SKIP'`,
            [firstOf(dto.month)],
          )
        ).rows.map((r) => r.id),
      );
      const finalised = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT employee_id::text AS id FROM payroll_attendance WHERE month = $1::date AND finalised`,
            [firstOf(dto.month)],
          )
        ).rows.map((r) => r.id),
      );
      const seen = new Set<string>();
      for (const x of dto.exceptions) {
        if (seen.has(x.employeeId)) bad('An employee is listed twice in the exceptions');
        seen.add(x.employeeId);
        if (!on.has(x.employeeId)) bad('An exception is not on this month’s roster');
        if (skips.has(x.employeeId)) bad('An exception is skipped this month (salary hold: SKIP)');
        if (!x.lopDays && !x.paidLeaveDays && !x.otHours) bad('An exception gives no figure');
      }
      const ex = new Map(dto.exceptions.map((x) => [x.employeeId, x]));
      const todo = roster.filter((r) => !skips.has(r.employee_id) && !finalised.has(r.employee_id));
      if (!dto.dryRun) {
        for (const r of todo) {
          const x = ex.get(r.employee_id);
          await this.writeManual(c, r.employee_id, dto.month, {
            lop: x?.lopDays ?? '0',
            paidLeave: x?.paidLeaveDays ?? '0',
            present: null,
            ot: x?.otHours ?? '0',
            reason: dto.reason,
            source: 'quick_fill',
          });
        }
        await this.audit.stage(ctx, c, {
          action: 'payroll.attendance.mark_present',
          entityType: 'payroll_attendance',
          entityId: dto.month,
          after: { written: todo.length, exceptions: dto.exceptions.length, reason: dto.reason },
        });
      }
      return {
        dryRun: dto.dryRun,
        presentWholeMonth: todo.filter((r) => !ex.has(r.employee_id)).length,
        exceptions: todo.filter((r) => ex.has(r.employee_id)).length,
        finalisedKept: finalised.size,
        skipped: skips.size,
      };
    });
  }

  // ---- the sheet: the month's figures typed in Excel -----------------------------------------------------------------
  async sheetFormat(ctx: RequestContext, month: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { from, to } = await windowOf(c, month);
      const roster = await this.roster(c, from, to, await hiddenFor(c, ctx));
      const rows = new Map(
        (
          await c.query<{ id: string; lop: string; leave: string; present: string; ot: string }>(
            `SELECT employee_id::text AS id, lop_days::text AS lop, paid_leave_days::text AS leave, present_days::text AS present,
                    ot_hours::text AS ot FROM payroll_attendance WHERE month = $1::date`,
            [firstOf(month)],
          )
        ).rows.map((r) => [r.id, r]),
      );
      const buffer = await templateSheet({
        sheet: `Attendance ${month}`,
        columns: [
          { header: 'Employee code', width: 16, required: true, format: 'text' },
          { header: 'Employee', width: 28 },
          { header: 'Loss of pay days', width: 16, required: true, format: 'number', check: true },
          { header: 'Paid leave days', width: 16, format: 'number', check: true },
          { header: 'Present days', width: 14, format: 'number', check: true },
          { header: 'OT hours', width: 12, format: 'number', check: true },
          { header: 'Reason', width: 30, required: true },
        ],
        guide: [
          `${monthWords(month)}: one row per employee, the days as payroll should pay them.`,
          'Paid days = the month’s days − loss of pay − days before joining and after leaving.',
          'Leave Present days empty to work it out; leave OT hours empty to keep what is there.',
          'Rows already finalised are refused. Employees not in the file are not changed.',
        ],
        rows: roster.map((e) => {
          const a = rows.get(e.employee_id);
          return [
            e.employee_code,
            e.display_name,
            a ? Number(a.lop) : null,
            a ? Number(a.leave) : null,
            null,
            a ? Number(a.ot) : null,
            null,
          ];
        }),
        hideLists: true,
      });
      return { filename: `payroll-attendance-${month}.xlsx`, base64: buffer.toString('base64') };
    });
  }

  async importSheet(ctx: RequestContext, dto: AttendanceImportDto) {
    must(ctx, RUN.manage, 'Only payroll makers upload attendance');
    const sheet = await readSheet(
      dto.file,
      PayrollAttendanceService.SHEET,
      PayrollAttendanceService.SHEET_OPTIONAL,
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'attendance');
      const { from, to } = await windowOf(c, dto.month);
      const hidden = await hiddenFor(c, ctx);
      const roster = new Map(
        (await this.roster(c, from, to, hidden)).map((r) => [r.employee_code.toUpperCase(), r]),
      );
      const num = (v: string) => (v === '' ? null : /^\d{1,2}(\.\d{1,2})?$/.test(v) ? v : 'bad');
      const seen = new Set<string>();
      const out: Array<{
        row: number;
        code: string;
        status: 'ok' | 'error';
        error: string | null;
      }> = [];
      let saved = 0;
      for (const r of sheet) {
        const code = r.cells['Employee code']!.trim().toUpperCase();
        const e = roster.get(code);
        const lop = num(r.cells['Loss of pay days']!.trim());
        const leave = num((r.cells['Paid leave days'] ?? '').trim());
        const present = num((r.cells['Present days'] ?? '').trim());
        const otRaw = (r.cells['OT hours'] ?? '').trim();
        const ot = otRaw === '' ? null : /^\d{1,4}(\.\d{1,2})?$/.test(otRaw) ? otRaw : 'bad';
        let error: string | null = null;
        if (!e) error = 'Not an employee on this month’s roster';
        else if (seen.has(code)) error = 'The employee is in the file twice';
        else if (lop === null || lop === 'bad')
          error = 'Loss of pay days: a number of days (0 when none)';
        else if (leave === 'bad' || present === 'bad' || ot === 'bad')
          error = 'A figure is not a number';
        seen.add(code);
        if (!error) {
          await c.query('SAVEPOINT att_row');
          try {
            await this.writeManual(c, e!.employee_id, dto.month, {
              lop,
              paidLeave: leave,
              present,
              ot,
              reason: r.cells.Reason?.trim() || dto.reason,
              source: 'import',
            });
            if (dto.dryRun) await c.query('ROLLBACK TO SAVEPOINT att_row');
            else {
              await c.query('RELEASE SAVEPOINT att_row');
              saved += 1;
            }
          } catch (err) {
            await c.query('ROLLBACK TO SAVEPOINT att_row');
            error = err instanceof Error ? err.message : 'Refused';
          }
        }
        out.push({ row: r.row, code, status: error ? 'error' : 'ok', error });
      }
      if (!dto.dryRun && saved)
        await this.audit.stage(ctx, c, {
          action: 'payroll.attendance.import',
          entityType: 'payroll_attendance',
          entityId: dto.month,
          after: { rows: saved },
        });
      return {
        rows: out,
        counts: {
          ok: out.filter((x) => x.status === 'ok').length,
          error: out.filter((x) => x.status === 'error').length,
        },
        saved,
      };
    });
  }

  // ---- finalise (a checker) and un-finalise (the payroll admin) ------------------------------------------------------
  async finalise(ctx: RequestContext, month: string) {
    must(ctx, RUN.approve, 'Only a payroll checker finalises attendance');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, month, 'attendance');
      const { from, to } = await windowOf(c, month);
      const roster = await this.roster(c, from, to, []);
      const missing = (
        await c.query<{ code: string; name: string }>(
          // eslint-disable-next-line no-restricted-syntax -- ROSTER_SQL is a fixed fragment; values are bound
          `SELECT r.employee_code AS code, r.display_name AS name FROM (${ROSTER_SQL}) r
            WHERE NOT EXISTS (SELECT 1 FROM payroll_attendance a WHERE a.employee_id = r.id AND a.month = $3::date)
              AND NOT EXISTS (SELECT 1 FROM payroll_holds h WHERE h.employee_id = r.id AND h.month = $3::date AND h.active AND h.mode = 'SKIP')
            ORDER BY r.employee_code`,
          [from, to, firstOf(month)],
        )
      ).rows;
      if (!roster.length) bad(`Nobody is on ${monthWords(month)}'s roster`);
      if (missing.length)
        bad(
          `${String(missing.length)} employee(s) have no attendance for ${monthWords(month)}: pull it first (${missing
            .slice(0, 10)
            .map((m) => m.code)
            .join(', ')}${missing.length > 10 ? ' …' : ''})`,
          409,
        );
      const r = await c.query(
        `UPDATE payroll_attendance SET finalised = true, finalised_by = app.current_user_id(), finalised_at = now(),
                updated_by = app.current_user_id(), updated_at = now()
          WHERE month = $1::date AND NOT finalised`,
        [firstOf(month)],
      );
      const locks = await this.registerLocks(c, from, to);
      await this.audit.stage(ctx, c, {
        action: 'payroll.attendance.finalise',
        entityType: 'payroll_attendance',
        entityId: month,
        after: { finalised: r.rowCount },
      });
      return {
        finalised: r.rowCount ?? 0,
        notes: locks.running.length
          ? [
              `${locks.running.map(monthWords).join(' and ')} is not over yet: the register can still change`,
            ]
          : [],
      };
    });
  }

  async unfinalise(ctx: RequestContext, dto: UnfinaliseDto) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin un-finalises attendance');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stages = await runStages(c, dto.month);
      const beyond = stages.find((s) => s !== 'DRAFT');
      if (beyond)
        bad(
          ['LOCKED', 'PAID'].includes(beyond)
            ? `${monthWords(dto.month)} is paid by a locked run: correct it with a loss-of-pay reversal or a supplementary run`
            : `${monthWords(dto.month)}'s run is ${beyond.toLowerCase()}: send it back to draft first`,
          409,
        );
      const r = await c.query(
        `UPDATE payroll_attendance SET finalised = false, finalised_by = NULL, finalised_at = NULL,
                updated_by = app.current_user_id(), updated_at = now()
          WHERE month = $1::date AND finalised`,
        [firstOf(dto.month)],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.attendance.unfinalise',
        entityType: 'payroll_attendance',
        entityId: dto.month,
        after: { rows: r.rowCount, reason: dto.reason },
      });
      return { unfinalised: r.rowCount ?? 0 };
    });
  }

  // ---- salary hold (a checker) --------------------------------------------------------------------------------
  async holds(ctx: RequestContext, month: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT h.id::text, h.employee_id::text, e.employee_code AS code, e.display_name AS name, e.department, h.mode,
                  h.reason, h.active, h.updated_at, u.display_name AS by_name
             FROM payroll_holds h JOIN employees e ON e.id = h.employee_id LEFT JOIN users u ON u.id = h.updated_by
            WHERE h.month = $1::date AND NOT (h.employee_id::text = ANY($2::text[]))
            ORDER BY h.active DESC, e.employee_code`,
          [firstOf(month), hidden],
        )
      ).rows.map(camelRow);
      return { month, rows, runs: await runStages(c, month), can: runCan(ctx) };
    });
  }

  async setHold(ctx: RequestContext, dto: HoldDto) {
    must(ctx, RUN.approve, 'Only a payroll checker holds or skips a salary');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stages = await mustBeOpen(c, dto.month, 'salary holds');
      const ok = (
        await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
          dto.employeeId,
        ])
      ).rowCount;
      if (!ok) bad('Employee not found', 404);
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_holds (school_id, employee_id, month, mode, reason, active, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::date, $3, $4, true, app.current_user_id(), app.current_user_id())
         ON CONFLICT (employee_id, month) DO UPDATE SET mode = EXCLUDED.mode, reason = EXCLUDED.reason, active = true,
           updated_by = app.current_user_id(), updated_at = now()
         RETURNING id::text`,
        [dto.employeeId, firstOf(dto.month), dto.mode, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.hold.set',
        entityType: 'payroll_holds',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return {
        id: r.rows[0]!.id,
        message: stages.length
          ? 'Saved. A run of this month exists: process it again for the hold to count.'
          : dto.mode === 'HOLD'
            ? 'Saved: the salary is worked out but not paid until a checker releases it.'
            : 'Saved: the employee is left out of this month.',
      };
    });
  }

  async liftHold(ctx: RequestContext, id: string, dto: LiftDto) {
    must(ctx, RUN.approve, 'Only a payroll checker lifts a salary hold');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = (
        await c.query<{ month: string }>(
          `SELECT month::text FROM payroll_holds WHERE id = $1 AND active`,
          [id],
        )
      ).rows[0];
      if (!h) bad('Not found', 404);
      await mustBeOpen(c, monthOf(h!.month), 'salary holds');
      await c.query(
        `UPDATE payroll_holds SET active = false, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.hold.lift',
        entityType: 'payroll_holds',
        entityId: id,
        after: { reason: dto.reason },
      });
      return { ok: true };
    });
  }

  // ---- a month's income tax typed by hand -----------------------------------------------------------------------------
  async tds(ctx: RequestContext, month: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT t.id::text, t.employee_id::text, e.employee_code AS code, e.display_name AS name, t.it_amount::text,
                  t.cess_amount::text, t.reason, t.updated_at, u.display_name AS by_name
             FROM payroll_tds_manual t JOIN employees e ON e.id = t.employee_id LEFT JOIN users u ON u.id = t.updated_by
            WHERE t.month = $1::date AND NOT (t.employee_id::text = ANY($2::text[])) ORDER BY e.employee_code`,
          [firstOf(month), hidden],
        )
      ).rows.map(camelRow);
      return { month, rows, can: runCan(ctx) };
    });
  }

  async setTds(ctx: RequestContext, dto: TdsManualDto) {
    must(ctx, RUN.manage, 'Only payroll makers type a month’s tax');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'the month’s tax');
      if ((await hiddenFor(c, ctx)).includes(dto.employeeId)) bad('Not found', 404);
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_tds_manual (school_id, employee_id, month, it_amount, cess_amount, reason, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, app.current_user_id(), app.current_user_id())
         ON CONFLICT (employee_id, month) DO UPDATE SET it_amount = EXCLUDED.it_amount, cess_amount = EXCLUDED.cess_amount,
           reason = EXCLUDED.reason, updated_by = app.current_user_id(), updated_at = now()
         RETURNING id::text`,
        [dto.employeeId, firstOf(dto.month), dto.itAmount, dto.cessAmount, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.tds.manual',
        entityType: 'payroll_tds_manual',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async deleteTds(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll makers remove a typed tax');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = (
        await c.query<{ month: string }>(
          `SELECT month::text FROM payroll_tds_manual WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!t) bad('Not found', 404);
      await mustBeOpen(c, monthOf(t!.month), 'the month’s tax');
      await c.query(`DELETE FROM payroll_tds_manual WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'payroll.tds.manual_delete',
        entityType: 'payroll_tds_manual',
        entityId: id,
      });
      return { ok: true };
    });
  }
}
