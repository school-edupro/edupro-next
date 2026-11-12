/**
 * A month's attendance for payroll (`payroll_inputs_lib.php: pr_att_derive`, the attendance-register source):
 * the register's days turned into month days, present, paid leave, loss of pay, days before joining and after
 * leaving, and the paid days the pay is prorated on. All counts are hundredths of a day (bigint), never
 * floating point. Fixed from the legacy: days before joining and after leaving are neither "unmarked" nor
 * charged as loss of pay (they were counted twice or raised a false warning), and a joiner after the month or a
 * leaver before it is paid nothing. There is no leave map: a loss-of-pay leave type is unpaid, a part-pay type
 * (half-pay leave) pays its per cent of the day.
 */

/** One day of the attendance register (staff_attendance_days). */
export interface RegisterDay {
  /** P present, HD half day, A absent, WO weekly off, H holiday, LV leave, HOLD salary hold */
  type: 'P' | 'HD' | 'A' | 'WO' | 'H' | 'LV' | 'HOLD';
  /** a leave's share of the day: 1 or 0.5 (as hundredths: 100 or 50) */
  portion?: 100 | 50;
  /** the leave type's code (for the breakdown) */
  leaveCode?: string;
  /** the leave type is loss of pay */
  lossOfPay?: boolean;
  /** the leave type's pay per cent when below 100 (half-pay leave: 50) */
  payPercent?: number | null;
}

export interface AttendanceInput {
  /** the days read, inclusive (YYYY-MM-DD) */
  from: string;
  to: string;
  /** the register's days by date (missing = nothing marked) */
  days: ReadonlyMap<string, RegisterDay>;
  joinedOn?: string | null;
  leftOn?: string | null;
  /** today (IST): days after it are still to come and counted paid, with a warning */
  today: string;
  /** a past day with nothing marked: present (the legacy default) or absent */
  unmarkedAs: 'present' | 'absent';
}

export interface AttendanceFigures {
  monthDays: bigint;
  present: bigint;
  paidLeave: bigint;
  lop: bigint;
  preJoin: bigint;
  postLeave: bigint;
  paid: bigint;
  unmarked: number;
  detail: {
    counts: Record<string, bigint>;
    leave: Record<string, { days: bigint; paid: bigint; lop: bigint }>;
    lopBreakdown: {
      absent: bigint;
      halfDay: bigint;
      lossOfPayLeave: bigint;
      partPayLeave: bigint;
      hold: bigint;
      unmarked: bigint;
    };
    futureDays: number;
    warnings: string[];
  };
}

/** Each date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Hundredths of a day as a plain string ('29.50'). */
export const daysString = (h: bigint) => {
  const sign = h < 0n ? '-' : '';
  const a = h < 0n ? -h : h;
  return `${sign}${String(a / 100n)}.${String(a % 100n).padStart(2, '0')}`;
};

export function deriveAttendance(i: AttendanceInput): AttendanceFigures {
  const dates = datesBetween(i.from, i.to);
  const counts: Record<string, bigint> = { P: 0n, HD: 0n, A: 0n, WO: 0n, H: 0n, LV: 0n, HOLD: 0n };
  const leave: AttendanceFigures['detail']['leave'] = {};
  const lb = {
    absent: 0n,
    halfDay: 0n,
    lossOfPayLeave: 0n,
    partPayLeave: 0n,
    hold: 0n,
    unmarked: 0n,
  };
  let present = 0n;
  let paidLeave = 0n;
  let lop = 0n;
  let preJoin = 0n;
  let postLeave = 0n;
  let unmarked = 0;
  let future = 0;
  for (const day of dates) {
    if (i.joinedOn && day < i.joinedOn) {
      preJoin += 100n;
      continue;
    }
    if (i.leftOn && day > i.leftOn) {
      postLeave += 100n;
      continue;
    }
    const d = i.days.get(day);
    if (!d) {
      if (day > i.today) {
        future += 1;
        present += 100n;
      } else if (i.unmarkedAs === 'present') {
        unmarked += 1;
        present += 100n;
      } else {
        unmarked += 1;
        lop += 100n;
        lb.unmarked += 100n;
      }
      continue;
    }
    counts[d.type] = counts[d.type]! + 100n;
    switch (d.type) {
      case 'P':
        present += 100n;
        break;
      case 'HD':
        present += 50n;
        lop += 50n;
        lb.halfDay += 50n;
        break;
      case 'A':
        lop += 100n;
        lb.absent += 100n;
        break;
      case 'WO':
      case 'H':
        break;
      case 'HOLD':
        lop += 100n;
        lb.hold += 100n;
        break;
      case 'LV': {
        const p = BigInt(d.portion ?? 100);
        // the other half of a half-day leave is worked
        present += 100n - p;
        const code = d.leaveCode ?? 'LV';
        const row = (leave[code] ??= { days: 0n, paid: 0n, lop: 0n });
        row.days += p;
        let unpaid = 0n;
        if (d.lossOfPay) {
          unpaid = p;
          lb.lossOfPayLeave += p;
        } else if (d.payPercent !== null && d.payPercent !== undefined && d.payPercent < 100) {
          unpaid = (p * BigInt(100 - Math.max(0, Math.round(d.payPercent)))) / 100n;
          lb.partPayLeave += unpaid;
        }
        lop += unpaid;
        paidLeave += p - unpaid;
        row.paid += p - unpaid;
        row.lop += unpaid;
        break;
      }
    }
  }
  const monthDays = BigInt(dates.length) * 100n;
  // loss of pay is only ever counted on days employed, so it never exceeds them
  const room = monthDays - preJoin - postLeave;
  const warnings: string[] = [];
  if (unmarked)
    warnings.push(
      `${String(unmarked)} past day(s) had nothing marked in the register: counted ${i.unmarkedAs}`,
    );
  if (future) warnings.push(`${String(future)} day(s) are still to come: counted paid`);
  if (room === 0n) warnings.push('Not employed on any day of this month: nothing is paid');
  return {
    monthDays,
    present,
    paidLeave,
    lop,
    preJoin,
    postLeave,
    paid: room - lop,
    unmarked,
    detail: { counts, leave, lopBreakdown: lb, futureDays: future, warnings },
  };
}

/**
 * The days read for a pay month: the calendar month, or the school's pay cycle — from its day of the month
 * before to the day before it in the pay month (a cycle from the 26th: 26 May – 25 June for June).
 */
export function payWindow(
  month: string,
  cycleFromDay?: number | null,
): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (!cycleFromDay) return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
  return { from: iso(y, m - 1, cycleFromDay), to: iso(y, m, cycleFromDay - 1) };
}
