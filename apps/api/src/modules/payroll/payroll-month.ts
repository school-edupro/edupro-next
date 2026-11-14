/**
 * What the monthly payroll screens share (docs/design/86, phase B): the pay month and its window, the month's
 * roster, who a maker may not see, and the run-stage gates on the inputs.
 */
import { payWindow } from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { PAYROLL } from './payroll.dto';
import { istToday } from './payroll-setup.service';

export const bad = (message: string, status = 400): never => {
  throw new DomainError(status === 409 ? 'conflict' : 'validation-failed', message, { status });
};
export const has = (ctx: RequestContext, p: string) => ctx.permissions?.has(p) ?? false;
export function must(ctx: RequestContext, p: string, message: string) {
  if (!has(ctx, p)) throw new DomainError('permission-denied', message, { status: 403 });
}
/** what the monthly screens offer the person asking */
export const runCan = (ctx: RequestContext) => ({
  manage: has(ctx, RUN.manage),
  approve: has(ctx, RUN.approve),
  admin: has(ctx, PAYROLL.admin),
});
const camel = (col: string) => col.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
export const camelRow = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]));

/** 'YYYY-MM' → its first day */
export const firstOf = (month: string) => `${month}-01`;
/** 'YYYY-MM-DD' → 'YYYY-MM' */
export const monthOf = (day: string) => day.slice(0, 7);
/** 'June 2026' */
export function monthWords(month: string) {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}
/** the month after (or before, -1) a 'YYYY-MM' */
export function addMonths(month: string, n: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const today = istToday;

/** The days a pay month reads: the calendar month, or the school's pay cycle. */
export async function windowOf(c: PoolClient, month: string) {
  const s = (
    await c.query<{ day: number | null }>(`SELECT pay_cycle_from_day AS day FROM payroll_settings`)
  ).rows[0];
  return payWindow(firstOf(month), s?.day ?? null);
}

/** Confidential staff a maker may not see (a checker and the payroll admin see everyone). */
export async function hiddenFor(c: PoolClient, ctx: RequestContext): Promise<string[]> {
  // checkers, the payroll admin and the auditor see every employee; makers not the confidential staff
  if (
    has(ctx, RUN.approve) ||
    has(ctx, PAYROLL.approve) ||
    has(ctx, PAYROLL.admin) ||
    has(ctx, 'payroll.audit.view')
  )
    return [];
  return (
    (
      await c.query<{ ids: string[] }>(
        `SELECT confidential_employee_ids::text[] AS ids FROM payroll_settings`,
      )
    ).rows[0]?.ids ?? []
  );
}

/**
 * The month's roster: everyone employed on a day of the window — active, or left during it (a leaver is
 * paid for the days worked; the legacy dropped them) — and joined by its end (a joiner after the month is not
 * on it), whose payroll profile is not marked LEFT.
 */
export const ROSTER_SQL = `
  SELECT e.id, e.id::text AS employee_id, e.employee_code, e.display_name, e.department, e.designation,
         e.joined_on::text AS joined_on, e.left_on::text AS left_on, e.status::text AS status
    FROM employees e
    LEFT JOIN payroll_profiles p ON p.employee_id = e.id
   WHERE e.deleted_at IS NULL
     AND (e.joined_on IS NULL OR e.joined_on <= $2::date)
     AND (e.status = 'active' OR (e.left_on IS NOT NULL AND e.left_on >= $1::date))
     AND (e.left_on IS NULL OR e.left_on >= $1::date)
     AND COALESCE(p.payroll_status, 'ACTIVE') <> 'LEFT'`;

/**
 * The stages of the month's runs. The inputs are frozen while a run
 * of the month is being processed or is approved or later.
 */
export async function runStages(c: PoolClient, month: string): Promise<string[]> {
  return (
    await c.query<{ stage: string }>(
      `SELECT stage FROM payroll_runs WHERE month = $1::date AND deleted_at IS NULL`,
      [firstOf(month)],
    )
  ).rows.map((r) => r.stage);
}
export const FROZEN = ['PROCESSING', 'APPROVED', 'LOCKED', 'PAID'];
/**
 * One-off items stay open once the month is locked, as in the legacy (its E11 revision): a locked run never
 * changes, so such an item pays only through a new supplementary or bonus run of the month. Refused while a run of
 * the month is processing or approved (its figures are being made, or are committed and not yet locked).
 */
export async function mustBeOpenForTopUp(c: PoolClient, month: string, what: string) {
  const stages = await runStages(c, month);
  const s = stages.find((x) => x === 'PROCESSING' || x === 'APPROVED');
  if (s)
    bad(
      `${monthWords(month)}'s run is ${s.toLowerCase()}: ${what} cannot change now${
        s === 'PROCESSING' ? ' — wait until it is processed' : ''
      }`,
      409,
    );
  return { stages, locked: stages.some((x) => x === 'LOCKED' || x === 'PAID') };
}
export async function mustBeOpen(c: PoolClient, month: string, what: string) {
  const stages = await runStages(c, month);
  const s = stages.find((x) => FROZEN.includes(x));
  if (s)
    bad(
      `${monthWords(month)}'s run is ${s.toLowerCase()}: ${what} cannot change now${
        s === 'PROCESSING' ? ' — wait until it is processed' : ''
      }`,
      409,
    );
  return stages;
}

/** The go-live state, when the school is moving from the old payroll (docs/design/86, phase G); null otherwise. */
export async function goLiveOf(c: PoolClient) {
  const r = (
    await c.query<{ status: string; switch_month: string | null; parallel: string[] }>(
      `SELECT status, to_char(switch_month, 'YYYY-MM') AS switch_month,
              ARRAY(SELECT to_char(m, 'YYYY-MM') FROM unnest(parallel_months) m ORDER BY m) AS parallel
         FROM payroll_cutover`,
    )
  ).rows[0];
  return r ?? null;
}

/**
 * A month EduPro may run: until the switch only the parallel months (the old payroll pays them; EduPro stops at
 * Approved); after it, from the switch month on.
 */
export async function mustBeRunnable(c: PoolClient, month: string, runType: string) {
  const g = await goLiveOf(c);
  if (!g) return null;
  if (g.status !== 'SWITCHED') {
    if (!g.parallel.includes(month))
      bad(
        `Until the go-live switch the old payroll pays: EduPro runs only the parallel months${
          g.parallel.length ? ` (${g.parallel.map(monthWords).join(', ')})` : ''
        }`,
        409,
      );
    if (runType !== 'REGULAR') bad('A parallel month has only its regular run here', 409);
  } else if (g.switch_month && month < g.switch_month)
    bad(
      `${monthWords(month)} was paid by the old payroll: EduPro pays from ${monthWords(g.switch_month)}`,
      409,
    );
  return g;
}

/** What only a live month does — the lock, a bank file: refused until the switch, and for the old payroll's months. */
export async function mustBePayable(c: PoolClient, month: string, what: string) {
  const g = await goLiveOf(c);
  if (!g) return;
  if (g.status !== 'SWITCHED')
    bad(
      `Payroll is still paid by the old module: ${what} waits until the go-live is signed and switched`,
      409,
    );
  if (g.switch_month && month < g.switch_month)
    bad(`${monthWords(month)} was paid by the old payroll: ${what} is not done here`, 409);
}
