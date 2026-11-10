import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from '../purchase/purchase-list-file';
import { istToday } from '../purchase/purchase-stock-core';
import { addDays, dmy, fail, monthWords } from './leave-engine';
import type {
  ShiftAssignDto,
  ShiftCalendarDto,
  ShiftClearDayDto,
  ShiftCopyDto,
  ShiftLogDto,
} from './leave.dto';

/** the colours shifts take when none is set (the order of the shift codes) */
export const SHIFT_PALETTE = [
  '#2563EB',
  '#16A34A',
  '#D97706',
  '#7C3AED',
  '#0D9488',
  '#E11D48',
  '#EA580C',
  '#4F46E5',
  '#0891B2',
  '#475569',
];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface ShiftInfo {
  id: string;
  code: string;
  name: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  colour: string;
}
/** a day of an employee: the shift, where it comes from (posted, the default shift, a posting of that day only) */
export interface ShiftCell {
  s: string | null;
  src: 'posted' | 'default' | 'day';
  wo: boolean;
  h: boolean;
}
interface Posting {
  id: string;
  shift_id: string;
  code: string;
  from_date: string;
  to_date: string | null;
}
interface Plan {
  retire: Posting[];
  move: Array<{ p: Posting; from: string }>;
  end: Array<{ p: Posting; to: string }>;
  insert: boolean;
}

/** the shifts (active), each with its colour; and the default shift (Settings, else the first one) */
export async function shiftList(c: PoolClient) {
  const r = await c.query<Omit<ShiftInfo, 'colour'> & { colour: string | null }>(
    `SELECT id::text, code, name, kind, to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at, colour
       FROM staff_shifts WHERE status = 'active' ORDER BY code`,
  );
  const shifts: ShiftInfo[] = r.rows.map((s, i) => ({
    ...s,
    colour: (s.colour ?? SHIFT_PALETTE[i % SHIFT_PALETTE.length]!).toUpperCase(),
  }));
  const d = (
    await c.query<{ id: string | null }>(
      `SELECT COALESCE(
         (SELECT h.id FROM staff_leave_settings st JOIN staff_shifts h ON h.id = st.default_shift_id AND h.status = 'active'
           WHERE st.school_id = app.current_school_id()),
         (SELECT h.id FROM staff_shifts h WHERE h.status = 'active' ORDER BY h.id LIMIT 1))::text AS id`,
    )
  ).rows[0]!.id;
  return { shifts, defaultShiftId: d };
}

/** each day of those employees from … to …: the posted shift (else the default), week-off, holiday */
export async function shiftCells(
  c: PoolClient,
  emps: string[],
  from: string,
  to: string,
  def: string | null,
) {
  const r = await c.query<{
    e: string;
    day: string;
    s: string | null;
    one: boolean | null;
    wo: boolean;
    h: boolean;
  }>(
    `SELECT e.id::text AS e, d.day::text AS day, p.shift_id::text AS s, p.one,
            app.staff_is_weekoff(e.id, d.day) AS wo, app.staff_is_holiday(e.id, d.day, false) AS h
       FROM unnest($1::bigint[]) AS e(id)
      CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS g(d)
      CROSS JOIN LATERAL (SELECT g.d::date AS day) d
       LEFT JOIN LATERAL (
         SELECT x.shift_id, x.from_date = x.to_date AS one FROM staff_shift_postings x
           JOIN staff_shifts h ON h.id = x.shift_id AND h.status = 'active'
          WHERE x.employee_id = e.id AND x.status = 'active' AND x.from_date <= d.day
            AND (x.to_date IS NULL OR x.to_date >= d.day)
          ORDER BY x.from_date DESC, x.id DESC LIMIT 1) p ON true
      ORDER BY e.id, d.day`,
    [emps, from, to],
  );
  const by = new Map<string, Map<string, ShiftCell>>();
  for (const x of r.rows) {
    let m = by.get(x.e);
    if (!m) by.set(x.e, (m = new Map()));
    m.set(x.day, {
      s: x.s ?? def,
      src: x.s ? (x.one ? 'day' : 'posted') : 'default',
      wo: x.wo,
      h: x.h,
    });
  }
  return by;
}

export const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const span = (from: string, to: string | null) =>
  to === from ? dmy(from) : `${dmy(from)} to ${to ? dmy(to) : 'until changed'}`;

/**
 * The shift calendar (Leave & attendance set-up → Shift calendar): a month of who works which shift, with
 * the week-offs and holidays; post a shift to many employees for days (or one day only), take a day back,
 * copy a month onto another; the log of every posting change (the database writes it). A change reaching
 * back into past days works them out again; a month locked for payroll is never changed.
 */
@Injectable()
export class ShiftCalendarService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private must(ctx: RequestContext, p: 'leave.setup.view' | 'leave.setup.manage') {
    if (!this.has(ctx, p))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
  }

  /** the employees of the filter (active), the where and its arguments ($1 … $6) */
  private filter(
    q: { q?: string; department?: string; shiftId?: string; unposted?: boolean },
    from: string,
    to: string,
    def: string | null,
  ) {
    const overlap = `x.employee_id = e.id AND x.status = 'active' AND x.from_date <= $6::date
                     AND (x.to_date IS NULL OR x.to_date >= $5::date)`;
    return {
      // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
      where: `e.deleted_at IS NULL AND e.status = 'active'
        AND ($1::text IS NULL OR e.display_name ILIKE $1 OR e.employee_code ILIKE $1)
        AND ($2::text IS NULL OR lower(COALESCE(e.department, '')) = lower($2))
        AND ($3::bigint IS NULL
             OR EXISTS (SELECT 1 FROM staff_shift_postings x WHERE ${overlap} AND x.shift_id = $3)
             OR $3 = $7::bigint AND NOT EXISTS (SELECT 1 FROM staff_shift_postings x WHERE ${overlap}))
        AND (NOT $4::boolean OR NOT EXISTS (SELECT 1 FROM staff_shift_postings x
              JOIN staff_shifts h ON h.id = x.shift_id AND h.status = 'active' WHERE ${overlap}))`,
      args: [
        q.q ? `%${q.q}%` : null,
        q.department ?? null,
        q.shiftId ?? null,
        q.unposted ?? false,
        from,
        to,
        def,
      ],
    };
  }

  // ---- the month -----------------------------------------------------------------------------------
  async calendar(ctx: RequestContext, q: ShiftCalendarDto) {
    this.must(ctx, 'leave.setup.view');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const month = q.month ?? istToday().slice(0, 7);
      const from = `${month}-01`;
      const to = lastDay(month);
      const { shifts, defaultShiftId } = await shiftList(c);
      const f = this.filter(q, from, to, defaultShiftId);
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
          `SELECT count(*)::int AS n FROM employees e WHERE ${f.where}`,
          f.args,
        )
      ).rows[0]!.n;
      const unposted = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
          `SELECT count(*)::int AS n FROM employees e WHERE ${
            this.filter({ unposted: true }, from, to, defaultShiftId).where
          }`,
          this.filter({ unposted: true }, from, to, defaultShiftId).args,
        )
      ).rows[0]!.n;
      const emps = await c.query<{
        id: string;
        code: string;
        name: string;
        department: string | null;
        posted: boolean;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department,
                EXISTS (SELECT 1 FROM staff_shift_postings x JOIN staff_shifts h ON h.id = x.shift_id AND h.status = 'active'
                         WHERE x.employee_id = e.id AND x.status = 'active' AND x.from_date <= $6::date
                           AND (x.to_date IS NULL OR x.to_date >= $5::date)) AS posted
           FROM employees e WHERE ${f.where}
          ORDER BY lower(e.display_name), e.employee_code LIMIT $8 OFFSET $9`,
        q.format ? [...f.args, LIST_LIMIT, 0] : [...f.args, q.size, (q.page - 1) * q.size],
      );
      const by = await shiftCells(
        c,
        emps.rows.map((e) => e.id),
        from,
        to,
        defaultShiftId,
      );
      const days: Array<{ date: string; day: number; dow: string }> = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const w = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
        days.push({ date: d, day: Number(d.slice(8)), dow: DOW[w]! });
      }
      const locked = (
        await c.query<{ l: boolean }>(
          `SELECT app.staff_month_locked(app.current_school_id(), $1::date) AS l`,
          [from],
        )
      ).rows[0]!.l;
      const rows = emps.rows.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        department: e.department,
        posted: e.posted,
        cells: days.map(
          (d) =>
            by.get(e.id)?.get(d.date) ?? { s: defaultShiftId, src: 'default', wo: false, h: false },
        ),
      }));
      if (q.format) {
        checkListSize(rows.length, 'employees');
        const code = new Map(shifts.map((s) => [s.id, s.code]));
        return purchaseListFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          title: `Shift calendar — ${monthWords(from)}`,
          slug: `Shift-calendar-${month}`,
          words: [
            q.q ? `Search: ${q.q}` : null,
            q.department ? `Department: ${q.department}` : null,
            q.shiftId ? `Shift: ${code.get(q.shiftId) ?? q.shiftId}` : null,
            q.unposted ? 'No shift posted (the default shift)' : null,
            'WO weekly off · H holiday · * that day only',
          ]
            .filter(Boolean)
            .join(' · '),
          list: {
            columns: [
              { label: 'Emp. code', width: 1.4 },
              { label: 'Employee', width: 3 },
              { label: 'Department', width: 2 },
              ...days.map((d) => ({ label: `${String(d.day)} ${d.dow.slice(0, 2)}`, width: 0.75 })),
            ],
            rows: rows.map((r) => [
              r.code,
              r.name,
              r.department,
              ...r.cells.map((x) =>
                x.h
                  ? 'H'
                  : x.wo
                    ? 'WO'
                    : `${x.s ? (code.get(x.s) ?? '') : ''}${x.src === 'day' ? '*' : ''}`,
              ),
            ]),
          },
        });
      }
      const departments = (
        await c.query<{ d: string }>(
          `SELECT DISTINCT btrim(department) AS d FROM employees
            WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(btrim(department), '') <> '' ORDER BY 1`,
        )
      ).rows.map((x) => x.d);
      return {
        month,
        days,
        departments,
        locked,
        shifts,
        defaultShiftId,
        rows,
        page: { page: q.page, size: q.size, total },
        counts: { unposted },
        today: istToday(),
        can: { manage: this.has(ctx, 'leave.setup.manage') },
      };
    });
  }

  // ---- posting -------------------------------------------------------------------------------------
  /**
   * What posting a shift from … to … does to an employee's postings: those starting inside the days give
   * way (removed, or start the day after), one running into them ends the day before (when it would be
   * overtaken for good), and the new posting is made — unless exactly that is posted already.
   */
  private plan(ps: Posting[], shiftId: string, from: string, to: string | null): Plan {
    const out: Plan = { retire: [], move: [], end: [], insert: true };
    if (ps.some((p) => p.shift_id === shiftId && p.from_date === from && p.to_date === to)) {
      const inside = ps.filter(
        (p) =>
          !(p.shift_id === shiftId && p.from_date === from) &&
          p.from_date >= from &&
          (to === null || p.from_date <= to),
      );
      if (!inside.length) return { ...out, insert: false };
    }
    for (const p of ps) {
      if (p.from_date >= from && (to === null || p.from_date <= to)) {
        if (to === null || (p.to_date !== null && p.to_date <= to)) out.retire.push(p);
        else {
          const next = addDays(to, 1);
          if (ps.some((o) => o.id !== p.id && o.shift_id === p.shift_id && o.from_date === next))
            out.retire.push(p);
          else out.move.push({ p, from: next });
        }
      } else if (
        p.from_date < from &&
        (p.to_date === null || p.to_date >= from) &&
        (to === null || (p.to_date !== null && p.to_date <= to))
      ) {
        out.end.push({ p, to: addDays(from, -1) });
      }
    }
    return out;
  }

  /** a change reaching back into past days: refused in a locked month; else those days worked out again */
  private async lockCheck(c: PoolClient, from: string, to: string | null) {
    const yesterday = addDays(istToday(), -1);
    const end = to && to < yesterday ? to : yesterday;
    if (from > end) return null;
    const locked = (
      await c.query<{ m: string }>(
        `SELECT to_char(month, 'Mon YYYY') AS m FROM staff_month_locks
          WHERE school_id = app.current_school_id() AND locked
            AND month BETWEEN date_trunc('month', $1::date) AND date_trunc('month', $2::date) ORDER BY month LIMIT 1`,
        [from, end],
      )
    ).rows[0];
    if (locked)
      fail(
        `${locked.m} is locked for payroll: a shift change cannot reach back into it — start it after that month`,
        409,
      );
    return end;
  }
  private async recompute(c: PoolClient, emps: string[], from: string, end: string | null) {
    if (!end) return 0;
    let n = 0;
    for (const e of emps)
      n += (
        await c.query<{ n: number }>(
          `SELECT app.staff_attendance_recompute($1::date, $2::date, $3) AS n`,
          [from, end, e],
        )
      ).rows[0]!.n;
    return n;
  }

  private async postings(c: PoolClient, emp: string) {
    return (
      await c.query<Posting>(
        `SELECT x.id::text, x.shift_id::text, h.code, x.from_date::text, x.to_date::text
           FROM staff_shift_postings x JOIN staff_shifts h ON h.id = x.shift_id
          WHERE x.employee_id = $1 AND x.status = 'active' ORDER BY x.from_date, x.id`,
        [emp],
      )
    ).rows;
  }

  private async apply(
    c: PoolClient,
    emp: string,
    shiftId: string,
    from: string,
    to: string | null,
    p: Plan,
  ) {
    for (const x of p.retire)
      await c.query(`UPDATE staff_shift_postings SET status = 'retired' WHERE id = $1`, [x.id]);
    for (const x of p.move)
      await c.query(`UPDATE staff_shift_postings SET from_date = $2 WHERE id = $1`, [
        x.p.id,
        x.from,
      ]);
    for (const x of p.end)
      await c.query(`UPDATE staff_shift_postings SET to_date = $2 WHERE id = $1`, [x.p.id, x.to]);
    if (p.insert)
      await c.query(
        `INSERT INTO staff_shift_postings (school_id, employee_id, shift_id, from_date, to_date, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())`,
        [emp, shiftId, from, to],
      );
  }

  /** Post a shift to employees for days (one day: that day only); dryRun shows what would change. */
  async assign(ctx: RequestContext, dto: ShiftAssignDto) {
    this.must(ctx, 'leave.setup.manage');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const to = dto.to ?? null;
      if (to && to > addDays(dto.from, 731))
        fail('Post a shift for two years at most at a time (leave To empty for "until changed")');
      const shift = (
        await c.query<{ id: string; code: string; name: string }>(
          `SELECT id::text, code, name FROM staff_shifts WHERE id = $1 AND status = 'active'`,
          [dto.shiftId],
        )
      ).rows[0];
      if (!shift) fail('Choose an active shift');
      const ids = [...new Set(dto.employeeIds)];
      const emps = (
        await c.query<{ id: string; name: string }>(
          `SELECT id::text, display_name || ' (' || employee_code || ')' AS name FROM employees
            WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'active' ORDER BY lower(display_name)`,
          [ids],
        )
      ).rows;
      if (emps.length !== ids.length) fail('Some of these employees are not active here');
      const end = await this.lockCheck(c, dto.from, to);
      const lines: Array<{ employee: string; changes: string[] }> = [];
      let same = 0;
      const changed: string[] = [];
      for (const e of emps) {
        const p = this.plan(await this.postings(c, e.id), dto.shiftId, dto.from, to);
        const words = [
          ...p.retire.map((x) => `${x.code} ${span(x.from_date, x.to_date)} removed`),
          ...p.move.map(
            (x) => `${x.p.code} ${span(x.p.from_date, x.p.to_date)} now starts ${dmy(x.from)}`,
          ),
          ...p.end.map((x) => `${x.p.code} from ${dmy(x.p.from_date)} now ends ${dmy(x.to)}`),
          ...(p.insert ? [`${shift!.code} ${span(dto.from, to)}`] : []),
        ];
        if (!p.insert && !p.retire.length && !p.move.length && !p.end.length) {
          same++;
          continue;
        }
        lines.push({ employee: e.name, changes: words });
        changed.push(e.id);
        if (!dto.dryRun) await this.apply(c, e.id, dto.shiftId, dto.from, to, p);
      }
      const worked = dto.dryRun ? 0 : await this.recompute(c, changed, dto.from, end);
      return {
        dryRun: dto.dryRun,
        shift: `${shift!.code} — ${shift!.name}`,
        changed: lines.length,
        same,
        lines,
        worked,
        pastFrom: end ? dto.from : null,
      };
    });
  }

  /** Take a day back: its own (one-day) posting removed, the day follows the shift around it again. */
  async clearDay(ctx: RequestContext, dto: ShiftClearDayDto) {
    this.must(ctx, 'leave.setup.manage');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM staff_shift_postings
            WHERE employee_id = $1 AND status = 'active' AND from_date = $2 AND to_date = $2`,
          [dto.employeeId, dto.day],
        )
      ).rows;
      if (!p.length)
        fail(
          'That day has no shift of its own: it follows a longer posting — post another shift for the day to change it',
          404,
        );
      const end = await this.lockCheck(c, dto.day, dto.day);
      for (const x of p)
        await c.query(`UPDATE staff_shift_postings SET status = 'retired' WHERE id = $1`, [x.id]);
      const worked = await this.recompute(c, [dto.employeeId], dto.day, end);
      return { cleared: p.length, worked };
    });
  }

  /**
   * Copy a month's posted shifts onto another month, date for date (a date the target month lacks is left
   * out): runs of days with the same shift become postings. Employees with a shift posted in the target
   * month already, or none posted in the source month, are left as they are. dryRun shows what it does.
   */
  async copy(ctx: RequestContext, dto: ShiftCopyDto) {
    this.must(ctx, 'leave.setup.manage');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sFrom = `${dto.source}-01`;
      const sTo = lastDay(dto.source);
      const tFrom = `${dto.target}-01`;
      const tTo = lastDay(dto.target);
      const { shifts, defaultShiftId } = await shiftList(c);
      const code = new Map(shifts.map((s) => [s.id, s.code]));
      const f = this.filter(dto, sFrom, sTo, defaultShiftId);
      const emps = (
        await c.query<{ id: string; name: string; target: boolean }>(
          // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
          `SELECT e.id::text, e.display_name || ' (' || e.employee_code || ')' AS name,
                  EXISTS (SELECT 1 FROM staff_shift_postings x WHERE x.employee_id = e.id AND x.status = 'active'
                           AND x.from_date <= $9::date AND (x.to_date IS NULL OR x.to_date >= $8::date)) AS target
             FROM employees e WHERE ${f.where} AND ($10::bigint[] IS NULL OR e.id = ANY($10::bigint[]))
            ORDER BY lower(e.display_name)`,
          [...f.args, tFrom, tTo, dto.employeeIds?.length ? dto.employeeIds : null],
        )
      ).rows;
      const free = emps.filter((e) => !e.target);
      const by = await shiftCells(
        c,
        free.map((e) => e.id),
        sFrom,
        sTo,
        null,
      );
      type Run = { s: string; from: string; to: string; one: boolean };
      const plan: Array<{ id: string; name: string; runs: Run[] }> = [];
      let nothing = 0;
      for (const e of free) {
        const runs: Run[] = [];
        for (let d = sFrom; d <= sTo; d = addDays(d, 1)) {
          const cell = by.get(e.id)?.get(d);
          const t = `${dto.target}-${d.slice(8)}`;
          if (!cell?.s || t > tTo) continue;
          const last = runs[runs.length - 1];
          const one = cell.src === 'day';
          if (last && !last.one && !one && last.s === cell.s && addDays(last.to, 1) === t)
            last.to = t;
          else runs.push({ s: cell.s, from: t, to: t, one });
        }
        if (runs.length) plan.push({ id: e.id, name: e.name, runs });
        else nothing++;
      }
      const end = plan.length ? await this.lockCheck(c, tFrom, tTo) : null;
      if (!dto.dryRun)
        for (const e of plan)
          for (const r of e.runs)
            await c.query(
              `INSERT INTO staff_shift_postings (school_id, employee_id, shift_id, from_date, to_date, created_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())`,
              [e.id, r.s, r.from, r.to],
            );
      const worked = dto.dryRun
        ? 0
        : await this.recompute(
            c,
            plan.map((e) => e.id),
            tFrom,
            end,
          );
      return {
        dryRun: dto.dryRun,
        source: monthWords(sFrom),
        target: monthWords(tFrom),
        copied: plan.length,
        postings: plan.reduce((n, e) => n + e.runs.length, 0),
        lines: plan.slice(0, 200).map((e) => ({
          employee: e.name,
          changes: e.runs.map((r) => `${code.get(r.s) ?? r.s} ${span(r.from, r.to)}`),
        })),
        skipped: emps.filter((e) => e.target).map((e) => e.name),
        nothing,
        worked,
      };
    });
  }

  // ---- the log -------------------------------------------------------------------------------------
  async log(ctx: RequestContext, q: ShiftLogDto) {
    this.must(ctx, 'leave.setup.view');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const args = [
        q.department ?? null,
        q.employeeId ?? null,
        q.q ? `%${q.q}%` : null,
        q.from ?? null,
        q.to ?? null,
      ];
      const where = `($1::text IS NULL OR lower(COALESCE(l.department, '')) = lower($1))
        AND ($2::bigint IS NULL OR l.employee_id = $2)
        AND ($3::text IS NULL OR l.subject ILIKE $3 OR l.shift ILIKE $3 OR u.display_name ILIKE $3)
        AND ($4::date IS NULL OR (l.changed_at AT TIME ZONE 'Asia/Kolkata')::date >= $4::date)
        AND ($5::date IS NULL OR (l.changed_at AT TIME ZONE 'Asia/Kolkata')::date <= $5::date)`;
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
          `SELECT count(*)::int AS n FROM staff_shift_log l LEFT JOIN users u ON u.id = l.changed_by WHERE ${where}`,
          args,
        )
      ).rows[0]!.n;
      const rows = await c.query<{
        id: string;
        subject: string;
        department: string | null;
        shift: string;
        action: string;
        from_date: string | null;
        to_date: string | null;
        changes: Array<{ field: string; old: unknown; new: unknown }>;
        by: string | null;
        at: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the where is a fixed fragment; values are bound
        `SELECT l.id::text, l.subject, l.department, l.shift, l.action, l.from_date::text, l.to_date::text, l.changes,
                u.display_name AS by, to_char(l.changed_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI') AS at
           FROM staff_shift_log l LEFT JOIN users u ON u.id = l.changed_by
          WHERE ${where} ORDER BY l.changed_at DESC, l.id DESC LIMIT $6 OFFSET $7`,
        q.format ? [...args, LIST_LIMIT, 0] : [...args, q.size, (q.page - 1) * q.size],
      );
      if (q.format) {
        checkListSize(rows.rows.length, 'changes');
        const words = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
        return purchaseListFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          title: 'Shift posting change log',
          slug: 'Shift-change-log',
          words:
            [
              q.department ? `Department: ${q.department}` : null,
              q.q ? `Search: ${q.q}` : null,
              q.from || q.to
                ? `Changed ${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'All changes',
          list: {
            columns: [
              { label: 'When', width: 1.6 },
              { label: 'By', width: 1.8 },
              { label: 'Employee', width: 2.6 },
              { label: 'Shift', width: 2 },
              { label: 'What', width: 1 },
              { label: 'Days', width: 2 },
              { label: 'Changes', width: 5 },
            ],
            rows: rows.rows.map((r) => [
              r.at,
              r.by,
              r.subject,
              r.shift,
              r.action,
              r.from_date ? span(r.from_date, r.to_date) : '',
              r.changes
                .map((x) =>
                  r.action === 'added'
                    ? `${x.field}: ${words(x.new)}`
                    : `${x.field}: ${words(x.old)} → ${words(x.new)}`,
                )
                .join('; '),
            ]),
          },
        });
      }
      return { rows: rows.rows, page: { page: q.page, size: q.size, total } };
    });
  }
}
