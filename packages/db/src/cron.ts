/**
 * Minimal five-field cron (minute hour day-of-month month day-of-week) for scheduled reports:
 * numbers, `*`, lists (`1,15`), ranges (`1-5`) and steps (`*\/15`). Times are interpreted in the
 * given UTC offset (IST by default). Deliberately small: schedules are "every Monday 07:00" shaped.
 */
const IST_OFFSET_MIN = 330;

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let lo = min;
    let hi = max;
    if (rangePart !== '*' && rangePart !== undefined && rangePart !== '') {
      const [a, b] = rangePart.split('-');
      lo = Number(a);
      hi = b !== undefined ? Number(b) : stepPart ? max : Number(a);
    }
    if (
      !Number.isInteger(lo) ||
      !Number.isInteger(hi) ||
      !Number.isInteger(step) ||
      step < 1 ||
      lo < min ||
      hi > max ||
      lo > hi
    )
      throw new Error(`bad cron field "${spec}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  if (out.size === 0) throw new Error(`empty cron field "${spec}"`);
  return out;
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron needs five fields');
  return {
    minutes: field(parts[0]!, 0, 59),
    hours: field(parts[1]!, 0, 23),
    days: field(parts[2]!, 1, 31),
    months: field(parts[3]!, 1, 12),
    weekdays: field(parts[4]!, 0, 6),
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

/** The next fire time strictly after `from` (UTC Date), evaluated in the offset's wall clock; null within two years. */
export function nextCronRun(expr: string, from: Date, offsetMinutes = IST_OFFSET_MIN): Date | null {
  const c = parseCron(expr);
  // walk minute by minute from the next whole minute, in wall-clock terms
  let t = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const limit = t.getTime() + 2 * 366 * 24 * 60 * 60_000;
  while (t.getTime() <= limit) {
    const wall = new Date(t.getTime() + offsetMinutes * 60_000);
    const month = wall.getUTCMonth() + 1;
    const day = wall.getUTCDate();
    const dow = wall.getUTCDay();
    const hour = wall.getUTCHours();
    const minute = wall.getUTCMinutes();
    if (!c.months.has(month)) {
      // jump to the first of next month
      t = new Date(
        Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1) - offsetMinutes * 60_000,
      );
      continue;
    }
    if (!c.days.has(day) || !c.weekdays.has(dow)) {
      t = new Date(
        Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), day + 1) - offsetMinutes * 60_000,
      );
      continue;
    }
    if (!c.hours.has(hour)) {
      t = new Date(t.getTime() + (60 - minute) * 60_000);
      continue;
    }
    if (!c.minutes.has(minute)) {
      t = new Date(t.getTime() + 60_000);
      continue;
    }
    return t;
  }
  return null;
}
