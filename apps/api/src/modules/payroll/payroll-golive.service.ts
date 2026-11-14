import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import { calculate, type CalcResult } from '@edupro/payroll-engine';
import { QUEUES, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { loadEmployee, monthContext } from './payroll-calc-input';
import {
  ENGINE_VERSION,
  Tally,
  bringHistory,
  bringPeople,
  employeesByCode,
  legacyMonth,
  num,
  rowsOf,
  str,
} from './payroll-golive';
import { RUN } from './payroll-inputs.dto';
import { addMonths, bad, firstOf, has, monthWords, must } from './payroll-month';
import { istToday } from './payroll-setup.service';
import { PAYROLL } from './payroll.dto';

const COUNTERSIGN = 'payroll.golive.countersign';
const STATUTORY = ['PF', 'VPF', 'NPS', 'ESI', 'PT', 'LWF', 'TDS'];
const AUDIT_VIEW = 'payroll.audit.view';
const P = (v: unknown): bigint => {
  const s = String(v ?? '0').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0n;
  const neg = s.startsWith('-');
  const [r, f = ''] = s.replace('-', '').split('.');
  const abs = BigInt(r || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -abs : abs;
};
const S = (p: bigint) => {
  const neg = p < 0n;
  const s = (neg ? -p : p).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
};
const fyStart = (day: string) => {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 4 ? y : y - 1;
};
type Figures = Map<string, bigint>;
export const CODES = [
  'ROUNDING',
  'LEGACY_DEFECT',
  'LABOUR_CODE',
  'SETUP_GAP',
  'MISSING_INPUT',
  'OTHER',
] as const;

/** A legacy record's figures: each head, the totals, TDS, the employer's shares. */
function legacyFigures(
  recs: Array<Record<string, unknown> & { _id: string }>,
  L: Awaited<ReturnType<typeof legacyMonth>>,
): Figures {
  const f: Figures = new Map();
  const add = (k: string, v: unknown) => f.set(k, (f.get(k) ?? 0n) + P(v));
  for (const r of recs) {
    for (const l of L.lines.get(r._id) ?? [])
      add(str(l.HeadCode).toUpperCase() || 'OTHER', l.EarnedAmount);
    add('GROSS', r.GrossEarned);
    add('DEDUCTIONS', r.TotalDeductions);
    add('NET', r.NetPay);
    add('TDS', num(r.ItAmount) + num(r.CessAmount));
    const pf = L.pf.get(r._id);
    add('ER_EPF', pf?.ErEpf);
    add('ER_EPS', pf?.ErEps);
    add('EDLI', pf?.EdliCharges);
    add('PF_ADMIN', pf?.AdminCharges);
    add('NPS_ER', L.nps.get(r._id)?.ErNps);
    add('LWF_ER', L.lwf.get(r._id)?.ErLwf);
    add('ESI_WAGE', r.EsiWage);
  }
  return f;
}
/** EduPro's figures from a worked-out month. */
function calcFigures(r: CalcResult): Figures {
  const f: Figures = new Map();
  const add = (k: string, v: bigint) => f.set(k, (f.get(k) ?? 0n) + v);
  for (const l of r.lines) add(l.code, l.earned);
  add('GROSS', r.grossEarned);
  add('DEDUCTIONS', r.totalDeductions);
  add('NET', r.netPay);
  add('TDS', r.itAmount + r.cessAmount);
  add('ER_EPF', r.pf?.erEpf ?? 0n);
  add('ER_EPS', r.pf?.erEps ?? 0n);
  add('EDLI', r.pf?.edli ?? 0n);
  add('PF_ADMIN', r.pf?.admin ?? 0n);
  add('NPS_ER', r.nps?.er ?? 0n);
  add('LWF_ER', r.lwf?.er ?? 0n);
  add('ESI_WAGE', r.esi?.covered ? r.esi.wage : 0n);
  return f;
}

/**
 * The go-live (docs/design/86, phase G): moving from the old payroll module. The payroll admin starts it and asks for
 * the old database to be read; previews what would come; prepares it; a second person commits it. Parity replays the
 * old locked months through EduPro's engine; the parallel months compare EduPro's approved runs with what the old module
 * paid; every difference stays open until a person explains it. A checker signs the second parallel month, the
 * principal countersigns; the payroll admin switches (and may switch back until the first live lock).
 */
@Injectable()
export class PayrollGoLiveService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private admin(ctx: RequestContext) {
    must(ctx, PAYROLL.admin, 'The payroll admin runs the go-live');
  }
  private checkerOrAdmin(ctx: RequestContext) {
    if (!(has(ctx, RUN.approve) || has(ctx, PAYROLL.admin)))
      bad('A payroll checker or the payroll admin does this', 403);
  }
  private viewer(ctx: RequestContext) {
    if (!(
      has(ctx, RUN.approve) ||
      has(ctx, PAYROLL.admin) ||
      has(ctx, AUDIT_VIEW) ||
      has(ctx, COUNTERSIGN)
    ))
      bad('The go-live is for the payroll admin, checkers, the principal and the auditor', 403);
  }

  private async row(c: PoolClient) {
    const r = (
      await c.query<{
        status: string;
        history_from: string;
        parallel: string[];
        switch_month: string | null;
        read_requested_at: Date | null;
        read_started_at: Date | null;
        read_at: Date | null;
        read_id: string | null;
        read_counts: Record<string, number> | null;
        read_error: string | null;
        prepared: {
          counts: Record<string, number>;
          problems: unknown[];
          checksum: string;
          readId: string | null;
          until: string | null;
        } | null;
        prepared_by: string | null;
        prepared_mine: boolean;
        prepared_at: Date | null;
        committed_at: Date | null;
        signoff_id: string | null;
        first_live_lock_at: Date | null;
      }>(
        `SELECT status, history_from::text, ARRAY(SELECT to_char(m, 'YYYY-MM') FROM unnest(parallel_months) m ORDER BY m) AS parallel,
                to_char(switch_month, 'YYYY-MM') AS switch_month, read_requested_at, read_started_at, read_at, read_id::text,
                read_counts, read_error, prepared, prepared_by::text, (prepared_by = app.current_user_id()) AS prepared_mine,
                prepared_at, committed_at, signoff_id::text, first_live_lock_at
           FROM payroll_cutover`,
      )
    ).rows[0];
    return r ?? null;
  }
  private async must(c: PoolClient) {
    const r = await this.row(c);
    if (!r) bad('Start the move from the old payroll first', 409);
    return r!;
  }

  async overview(ctx: RequestContext) {
    this.viewer(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c);
      const staged = (
        await c.query<{ tbl: string; n: number }>(
          `SELECT tbl, count(*)::int AS n FROM payroll_legacy_rows GROUP BY tbl ORDER BY tbl`,
        )
      ).rows;
      const batches = (
        await c.query(
          `SELECT b.id::text, b.kind, ARRAY(SELECT to_char(m, 'YYYY-MM') FROM unnest(b.months) m) AS months, b.counts, b.created_at,
                  u.display_name AS by, (SELECT count(*)::int FROM payroll_parity_results x WHERE x.batch_id = b.id AND x.status = 'OPEN') AS open
             FROM payroll_parity_batches b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC LIMIT 20`,
        )
      ).rows;
      const signoff = r?.signoff_id
        ? (
            await c.query(
              `SELECT s.id::text, s.batch_id::text, s.checksum, s.engine_version, s.signed_at, su.display_name AS signed_by,
                      s.countersigned_at, cu.display_name AS countersigned_by
                 FROM payroll_golive_signoffs s JOIN users su ON su.id = s.signed_by LEFT JOIN users cu ON cu.id = s.countersigned_by
                WHERE s.id = $1`,
              [r.signoff_id],
            )
          ).rows[0]
        : (
            await c.query(
              `SELECT s.id::text, s.batch_id::text, s.checksum, s.engine_version, s.signed_at, su.display_name AS signed_by,
                      NULL AS countersigned_at, NULL AS countersigned_by, (s.signed_by = app.current_user_id()) AS mine
                 FROM payroll_golive_signoffs s JOIN users su ON su.id = s.signed_by
                WHERE s.countersigned_by IS NULL ORDER BY s.id DESC LIMIT 1`,
            )
          ).rows[0];
      return {
        cutover: r,
        staged,
        batches,
        signoff: signoff ?? null,
        can: {
          admin: has(ctx, PAYROLL.admin),
          check: has(ctx, RUN.approve) || has(ctx, PAYROLL.admin),
          countersign: has(ctx, COUNTERSIGN),
          commit:
            !!r?.prepared && !r.prepared_mine && (has(ctx, PAYROLL.admin) || has(ctx, RUN.approve)),
        },
      };
    });
  }

  async start(ctx: RequestContext, historyFrom?: string) {
    this.admin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (await this.row(c)) bad('The move from the old payroll is already started', 409);
      if (!(await c.query(`SELECT 1 FROM payroll_settings`)).rowCount)
        bad('Open Payroll set-up first', 409);
      const from = historyFrom ?? `${String(fyStart(istToday()) - 1)}-04-01`;
      await c.query(
        `INSERT INTO payroll_cutover (school_id, history_from) VALUES (app.current_school_id(), $1::date)`,
        [from],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.start',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: { historyFrom: from },
      });
      return { ok: true, historyFrom: from };
    });
  }

  async read(ctx: RequestContext) {
    this.admin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (r.status === 'SWITCHED' && r.first_live_lock_at)
        bad('EduPro pays now: the old payroll is not read again', 409);
      await c.query(`UPDATE payroll_cutover SET read_requested_at = now(), updated_at = now()`);
      await this.outbox.enqueue(c, ctx, QUEUES.maintenance, 'payroll.legacy_read', {
        schoolIds: [requireTenant(ctx).schoolId],
      });
      return { requested: true };
    });
  }

  /** The months the history brought stops before: the first parallel month, or after the switch, the switch month. */
  private until(r: NonNullable<Awaited<ReturnType<PayrollGoLiveService['row']>>>) {
    if (r.status === 'SWITCHED' && r.switch_month) return firstOf(r.switch_month);
    return r.parallel[0] ? firstOf(r.parallel[0]) : null;
  }

  private async bring(
    c: PoolClient,
    r: NonNullable<Awaited<ReturnType<PayrollGoLiveService['row']>>>,
  ) {
    const t = new Tally();
    await bringPeople(c, t, r.history_from);
    await bringHistory(c, t, r.history_from, this.until(r));
    return t;
  }

  private async checksum(c: PoolClient) {
    return (
      (
        await c.query<{ h: string | null }>(
          `SELECT md5(string_agg(tbl || ':' || legacy_id || ':' || md5(payload::text), ',' ORDER BY tbl, legacy_id)) AS h FROM payroll_legacy_rows`,
        )
      ).rows[0]?.h ?? ''
    );
  }

  /** Everything brought and rolled back: what would come, and what cannot (and why). */
  async preview(ctx: RequestContext) {
    this.viewer(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (!r.read_at) bad('The old payroll is not read yet', 409);
      await c.query('SAVEPOINT golive_preview');
      try {
        const t = await this.bring(c, r);
        return { counts: t.counts, problems: t.problems, until: this.until(r) };
      } finally {
        await c.query('ROLLBACK TO SAVEPOINT golive_preview');
      }
    });
  }

  /** The payroll admin prepares: the preview kept with a checksum of the rows read; a second person commits it. */
  async prepare(ctx: RequestContext) {
    this.admin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (!r.read_at) bad('The old payroll is not read yet', 409);
      await c.query('SAVEPOINT golive_prepare');
      let t: Tally;
      try {
        t = await this.bring(c, r);
      } finally {
        await c.query('ROLLBACK TO SAVEPOINT golive_prepare');
      }
      const prepared = {
        counts: t.counts,
        problems: t.problems,
        checksum: await this.checksum(c),
        readId: r.read_id,
        until: this.until(r),
      };
      await c.query(
        `UPDATE payroll_cutover SET prepared = $1::jsonb, prepared_by = app.current_user_id(), prepared_at = now(), updated_at = now()`,
        [JSON.stringify(prepared)],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.prepare',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: prepared,
      });
      return prepared;
    });
  }

  async commit(ctx: RequestContext) {
    if (!(has(ctx, PAYROLL.admin) || has(ctx, RUN.approve)))
      bad('The payroll admin or a checker commits the move', 403);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (!r.prepared) bad('Nothing is prepared: the payroll admin prepares it first', 409);
      if (r.prepared_mine) bad('You prepared it: a second person commits it', 403);
      if ((await this.checksum(c)) !== r.prepared!.checksum || r.read_id !== r.prepared!.readId)
        bad('The old payroll was read again since it was prepared: prepare it again', 409);
      const t = await this.bring(c, r);
      await c.query(
        `UPDATE payroll_cutover SET status = CASE WHEN status = 'SETUP' THEN 'BROUGHT' ELSE status END, prepared = NULL,
                committed_by = app.current_user_id(), committed_at = now(), updated_at = now()`,
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.commit',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: { counts: t.counts, problems: t.problems.length },
      });
      return { counts: t.counts, problems: t.problems };
    });
  }

  /** The older years, not brought, as a file: each table's rows before the history's start (CSV in a ZIP). */
  async archive(ctx: RequestContext) {
    this.checkerOrAdmin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      const L = await legacyMonth(c);
      const old = new Set(
        (await rowsOf(c, 'payroll_run'))
          .filter(
            (x) =>
              `${String(num(x.PayYear))}-${String(num(x.PayMonth)).padStart(2, '0')}-01` <
              r.history_from,
          )
          .map((x) => x._id),
      );
      const recs = L.records.filter((x) => old.has(str(x.RunSrno)));
      const recIds = new Set(recs.map((x) => x._id));
      const csv = (rows: Array<Record<string, unknown>>) => {
        if (!rows.length) return 'none\r\n';
        const cols = [...new Set(rows.flatMap((x) => Object.keys(x)))].filter((k) => k !== '_id');
        const cell = (v: unknown) => {
          const s =
            v === null || v === undefined
              ? ''
              : typeof v === 'object'
                ? JSON.stringify(v)
                : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return `﻿${[cols.join(','), ...rows.map((x) => cols.map((k) => cell(x[k])).join(','))].join('\r\n')}\r\n`;
      };
      const zip = new JSZip();
      zip.file(
        'payroll_run.csv',
        csv((await rowsOf(c, 'payroll_run')).filter((x) => old.has(x._id))),
      );
      zip.file('payroll_salary_record.csv', csv(recs));
      zip.file(
        'payroll_salary_record_line.csv',
        csv([...L.lines.entries()].filter(([k]) => recIds.has(k)).flatMap(([, v]) => v)),
      );
      zip.file(
        'payroll_pf_line.csv',
        csv([...L.pf.entries()].filter(([k]) => recIds.has(k)).map(([, v]) => v)),
      );
      zip.file(
        'README.txt',
        `The old payroll's runs before ${r.history_from}, as read on ${new Date().toISOString()}. PAN and bank numbers are not in it.\r\n`,
      );
      const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.archive',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: { runs: old.size, records: recs.length },
      });
      return {
        filename: `Old_payroll_before_${r.history_from}.zip`,
        contentType: 'application/zip',
        base64: body.toString('base64'),
      };
    });
  }

  async setParallel(ctx: RequestContext, months: string[]) {
    this.admin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (!['BROUGHT', 'PARALLEL'].includes(r.status))
        bad('Bring the old payroll first (or the switch is done)', 409);
      const [a, b] = [...months].sort();
      if (!a || !b || addMonths(a, 1) !== b) bad('Two months one after the other');
      const runs = (
        await c.query(
          `SELECT 1 FROM payroll_runs WHERE deleted_at IS NULL AND NOT imported AND month >= $1::date LIMIT 1`,
          [firstOf(a!)],
        )
      ).rowCount;
      if (r.status === 'PARALLEL' && runs)
        bad('EduPro has runs of the parallel months already: they stay as they are', 409);
      await c.query(
        `UPDATE payroll_cutover SET status = 'PARALLEL', parallel_months = ARRAY[$1::date, $2::date], updated_at = now()`,
        [firstOf(a!), firstOf(b!)],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.parallel',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: { months: [a, b] },
      });
      return { ok: true };
    });
  }

  // ---- parity --------------------------------------------------------------------------------------------------------
  private async explanations(c: PoolClient, kind: string) {
    return new Map(
      (
        await c.query<{ k: string; diff: string }>(
          `SELECT employee_id || '|' || to_char(month, 'YYYY-MM') || '|' || component AS k, diff::text FROM payroll_parity_explanations WHERE kind = $1`,
          [kind],
        )
      ).rows.map((x) => [x.k, P(x.diff)]),
    );
  }

  private async write(
    c: PoolClient,
    batchId: string,
    employeeId: string,
    month: string,
    legacy: Figures | null,
    ours: Figures | null,
    explained: Map<string, bigint>,
    note?: string,
  ) {
    const counts = { match: 0, open: 0, explained: 0 };
    const keys = new Set([...(legacy?.keys() ?? []), ...(ours?.keys() ?? [])]);
    const rows: unknown[][] = [];
    if (!legacy || !ours) {
      rows.push([employeeId, month, 'CALC', null, null, '0.00', 'OPEN', note ?? 'Not worked out']);
      counts.open += 1;
    } else
      for (const k of keys) {
        const l = legacy.get(k) ?? 0n;
        const o = ours.get(k) ?? 0n;
        const d = o - l;
        const ex = explained.get(`${employeeId}|${month}|${k}`);
        const status = d === 0n ? 'MATCH' : ex !== undefined && ex === d ? 'EXPLAINED' : 'OPEN';
        if (status === 'MATCH' && l === 0n) continue; // nothing either side
        counts[status === 'MATCH' ? 'match' : status === 'OPEN' ? 'open' : 'explained'] += 1;
        rows.push([
          employeeId,
          month,
          k.slice(0, 30),
          S(l),
          S(o),
          S(d),
          status,
          ex !== undefined && ex !== d && d !== 0n
            ? 'The difference changed since it was explained'
            : null,
        ]);
      }
    for (const x of rows)
      await c.query(
        `INSERT INTO payroll_parity_results (school_id, batch_id, employee_id, month, component, legacy, ours, diff, status, note)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, $7, $8, $9)`,
        [batchId, x[0], firstOf(String(x[1])), ...x.slice(2)],
      );
    return counts;
  }

  /** Replay: each old locked regular month worked out again here from its own inputs, compared to the paisa. */
  async replay(ctx: RequestContext, months: string[]) {
    this.checkerOrAdmin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (r.status === 'SETUP')
        bad('Bring the old payroll first: the replay works on what is brought', 409);
      const emp = await employeesByCode(c);
      const L = await legacyMonth(c);
      const explained = await this.explanations(c, 'REPLAY');
      const cats = new Map(
        (
          await c.query<{ code: string; category: string }>(
            `SELECT code, category FROM payroll_pay_heads`,
          )
        ).rows.map((x) => [x.code, x.category]),
      );
      const batchId = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_parity_batches (school_id, kind, months, engine_version, created_by)
           VALUES (app.current_school_id(), 'REPLAY', $1::date[], $2, app.current_user_id()) RETURNING id::text`,
          [months.map(firstOf), ENGINE_VERSION],
        )
      ).rows[0]!.id;
      const total = { match: 0, open: 0, explained: 0, records: 0, unknown: 0 };
      for (const m of [...months].sort()) {
        const ctxm = await monthContext(c, m);
        const runIds = new Set(
          L.runs
            .filter(
              (x) =>
                str(x.RunType).toUpperCase() === 'REGULAR' &&
                `${String(num(x.PayYear))}-${String(num(x.PayMonth)).padStart(2, '0')}` === m,
            )
            .map((x) => x._id),
        );
        for (const rec of L.records.filter((x) => runIds.has(str(x.RunSrno)))) {
          const id = emp(rec.EmpId);
          if (!id) {
            total.unknown += 1;
            continue;
          }
          total.records += 1;
          const legacy = legacyFigures([rec], L);
          const l = await loadEmployee(c, ctxm, id, { topUp: null, needAttendance: true });
          let ours: Figures | null = null;
          let note: string | undefined;
          if (!l.ok) note = `Not worked out: ${l.reason}`;
          else {
            // the month as the old payroll had it: its loan instalments, one-off items and arrears as paid (today's loan
            // balances and this school's inputs are not that month's), so the replay tests the arithmetic
            const input = structuredClone(l.input);
            const lines = (L.lines.get(rec._id) ?? []).map((x) => ({
              id: `legacy-${str(x._id)}`,
              code: str(x.HeadCode).toUpperCase(),
              amount: P(x.EarnedAmount),
              structure: num(x.IsStructure) === 1,
              arrear: num(x.IsArrear) === 1,
            }));
            const isLoan = (code: string) => code === 'ADV' || cats.get(code) === 'LOAN';
            input.loans = lines
              .filter((x) => isLoan(x.code) && x.amount > 0n)
              .map((x) => ({
                id: x.id,
                terms: { principal: x.amount, emi: x.amount, rate: '0', method: 'NONE' as const },
                balance: x.amount,
              }));
            input.recurring = [];
            input.adhoc = lines
              .filter(
                (x) =>
                  !x.structure &&
                  !x.arrear &&
                  !STATUTORY.includes(x.code) &&
                  !isLoan(x.code) &&
                  ctxm.heads[x.code],
              )
              .map((x) => ({ id: x.id, code: x.code, amount: x.amount, refModule: null }));
            input.arrears = lines
              .filter((x) => x.arrear && ctxm.heads[x.code]?.version)
              .map((x) => ({
                id: x.id,
                code: x.code,
                amount: x.amount,
                pf: ctxm.heads[x.code]!.version!.pfWage,
                taxable: ctxm.heads[x.code]!.version!.isTaxable,
              }));
            const out = calculate(input);
            if (out.ok) ours = calcFigures(out);
            else note = `Not worked out: ${out.reason}`;
          }
          const n = await this.write(c, batchId, id, m, legacy, ours, explained, note);
          total.match += n.match;
          total.open += n.open;
          total.explained += n.explained;
        }
      }
      await c.query(`UPDATE payroll_parity_batches SET counts = $2::jsonb WHERE id = $1`, [
        batchId,
        JSON.stringify(total),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.replay',
        entityType: 'payroll_parity_batches',
        entityId: batchId,
        after: total,
      });
      return { batchId, ...total };
    });
  }

  /** The parallel months: EduPro's approved runs against what the old module locked and paid, per employee. */
  async parallel(ctx: RequestContext) {
    this.checkerOrAdmin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (r.parallel.length !== 2) bad('Set the two parallel months first', 409);
      const emp = await employeesByCode(c);
      const L = await legacyMonth(c);
      const explained = await this.explanations(c, 'PARALLEL');
      const batchId = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_parity_batches (school_id, kind, months, engine_version, created_by)
           VALUES (app.current_school_id(), 'PARALLEL', $1::date[], $2, app.current_user_id()) RETURNING id::text`,
          [r.parallel.map(firstOf), ENGINE_VERSION],
        )
      ).rows[0]!.id;
      const total = {
        match: 0,
        open: 0,
        explained: 0,
        employees: 0,
        unknown: 0,
        monthsWithoutOld: [] as string[],
      };
      for (const m of r.parallel) {
        const runIds = new Set(
          L.runs
            .filter(
              (x) => `${String(num(x.PayYear))}-${String(num(x.PayMonth)).padStart(2, '0')}` === m,
            )
            .map((x) => x._id),
        );
        if (!runIds.size) total.monthsWithoutOld.push(m);
        const legacyBy = new Map<string, Array<Record<string, unknown> & { _id: string }>>();
        for (const rec of L.records.filter((x) => runIds.has(str(x.RunSrno)))) {
          const id = emp(rec.EmpId);
          if (!id) {
            total.unknown += 1;
            continue;
          }
          legacyBy.set(id, [...(legacyBy.get(id) ?? []), rec]);
        }
        // EduPro's own runs of the month (approved or later), per employee
        const ours = new Map<string, Figures>();
        for (const x of (
          await c.query<{ employee_id: string; code: string; amount: string }>(
            `SELECT r.employee_id::text, l.code, sum(l.amount)::text AS amount
               FROM payroll_record_lines l JOIN payroll_records r ON r.id = l.record_id JOIN payroll_runs u ON u.id = r.run_id
              WHERE u.month = $1::date AND NOT u.imported AND u.deleted_at IS NULL AND u.stage IN ('APPROVED', 'LOCKED', 'PAID')
                AND r.status <> 'FAILED'
              GROUP BY r.employee_id, l.code`,
            [firstOf(m)],
          )
        ).rows) {
          const f = ours.get(x.employee_id) ?? new Map<string, bigint>();
          f.set(x.code, (f.get(x.code) ?? 0n) + P(x.amount));
          ours.set(x.employee_id, f);
        }
        for (const x of (
          await c.query<Record<string, string>>(
            `SELECT r.employee_id::text, sum(r.gross_earned)::text AS gross, sum(r.total_deductions)::text AS ded, sum(r.net_pay)::text AS net,
                    sum(r.it_amount + r.cess_amount)::text AS tds, COALESCE(sum(st.er_epf), 0)::text AS er_epf,
                    COALESCE(sum(st.er_eps), 0)::text AS er_eps, COALESCE(sum(st.edli), 0)::text AS edli,
                    COALESCE(sum(st.pf_admin), 0)::text AS pf_admin, COALESCE(sum(st.nps_er), 0)::text AS nps_er,
                    COALESCE(sum(st.lwf_er), 0)::text AS lwf_er,
                    COALESCE(sum(CASE WHEN st.esi_covered THEN st.esi_wage ELSE 0 END), 0)::text AS esi_wage
               FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id LEFT JOIN payroll_record_statutory st ON st.record_id = r.id
              WHERE u.month = $1::date AND NOT u.imported AND u.deleted_at IS NULL AND u.stage IN ('APPROVED', 'LOCKED', 'PAID')
                AND r.status <> 'FAILED'
              GROUP BY r.employee_id`,
            [firstOf(m)],
          )
        ).rows) {
          const f = ours.get(x.employee_id!) ?? new Map<string, bigint>();
          for (const [k, col] of [
            ['GROSS', 'gross'],
            ['DEDUCTIONS', 'ded'],
            ['NET', 'net'],
            ['TDS', 'tds'],
            ['ER_EPF', 'er_epf'],
            ['ER_EPS', 'er_eps'],
            ['EDLI', 'edli'],
            ['PF_ADMIN', 'pf_admin'],
            ['NPS_ER', 'nps_er'],
            ['LWF_ER', 'lwf_er'],
            ['ESI_WAGE', 'esi_wage'],
          ] as const)
            f.set(k, P(x[col]));
          ours.set(x.employee_id!, f);
        }
        for (const id of new Set([...legacyBy.keys(), ...ours.keys()])) {
          total.employees += 1;
          const n = await this.write(
            c,
            batchId,
            id,
            m,
            legacyBy.has(id) ? legacyFigures(legacyBy.get(id)!, L) : new Map(),
            ours.get(id) ?? new Map(),
            explained,
          );
          total.match += n.match;
          total.open += n.open;
          total.explained += n.explained;
        }
      }
      await c.query(`UPDATE payroll_parity_batches SET counts = $2::jsonb WHERE id = $1`, [
        batchId,
        JSON.stringify(total),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.parallel_compare',
        entityType: 'payroll_parity_batches',
        entityId: batchId,
        after: total,
      });
      return { batchId, ...total };
    });
  }

  /** A batch's results (filtered) and its scoreboard: each component's totals, matched, explained, open. */
  async results(
    ctx: RequestContext,
    batchId: string,
    q: { status?: string; component?: string; month?: string; page: number; size: number },
  ) {
    this.viewer(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = (
        await c.query<{ kind: string; months: string[]; counts: Record<string, unknown> }>(
          `SELECT kind, ARRAY(SELECT to_char(m, 'YYYY-MM') FROM unnest(months) m) AS months, counts FROM payroll_parity_batches WHERE id = $1`,
          [batchId],
        )
      ).rows[0];
      if (!b) bad('Not found', 404);
      const args = [
        batchId,
        q.status ?? null,
        q.component ?? null,
        q.month ? firstOf(q.month) : null,
      ];
      const where = `WHERE x.batch_id = $1 AND ($2::text IS NULL OR x.status = $2) AND ($3::text IS NULL OR x.component = $3)
                       AND ($4::date IS NULL OR x.month = $4)`;
      const total = Number(
        (
          await c.query<{ n: string }>(
            // eslint-disable-next-line no-restricted-syntax -- the filter is a fixed fragment; values are bound
            `SELECT count(*)::text AS n FROM payroll_parity_results x ${where}`,
            args,
          )
        ).rows[0]?.n ?? 0,
      );
      const rows = (
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- the filter is a fixed fragment; values are bound
          `SELECT x.id::text, e.employee_code AS code, e.display_name AS name, x.employee_id::text, to_char(x.month, 'YYYY-MM') AS month,
                  x.component, x.legacy::text, x.ours::text, x.diff::text, x.status, x.note,
                  ex.code AS explanation_code, ex.note AS explanation, eu.display_name AS explained_by
             FROM payroll_parity_results x JOIN employees e ON e.id = x.employee_id
             LEFT JOIN payroll_parity_explanations ex ON ex.kind = $5 AND ex.employee_id = x.employee_id AND ex.month = x.month AND ex.component = x.component
             LEFT JOIN users eu ON eu.id = ex.explained_by
             ${where}
            ORDER BY x.status = 'MATCH', x.status = 'EXPLAINED', e.display_name, x.month, x.component LIMIT $6 OFFSET $7`,
          [...args, b!.kind, q.size, (q.page - 1) * q.size],
        )
      ).rows;
      const scoreboard = (
        await c.query(
          `SELECT component, sum(COALESCE(legacy, 0))::text AS legacy, sum(COALESCE(ours, 0))::text AS ours,
                  count(*) FILTER (WHERE status = 'MATCH')::int AS match, count(*) FILTER (WHERE status = 'EXPLAINED')::int AS explained,
                  count(*) FILTER (WHERE status = 'OPEN')::int AS open
             FROM payroll_parity_results WHERE batch_id = $1 GROUP BY component
            ORDER BY count(*) FILTER (WHERE status = 'OPEN') DESC, component`,
          [batchId],
        )
      ).rows;
      const byMonth = (
        await c.query(
          `SELECT to_char(month, 'YYYY-MM') AS month, count(*) FILTER (WHERE status = 'OPEN')::int AS open,
                  count(*) FILTER (WHERE status = 'EXPLAINED')::int AS explained, count(*) FILTER (WHERE status = 'MATCH')::int AS match
             FROM payroll_parity_results WHERE batch_id = $1 GROUP BY month ORDER BY month`,
          [batchId],
        )
      ).rows;
      return { batch: { id: batchId, ...b! }, rows, total, scoreboard, byMonth };
    });
  }

  /** A person explains differences (each with the difference it explains); an explanation lasts while the difference does. */
  async explain(
    ctx: RequestContext,
    batchId: string,
    dto: {
      resultIds: string[];
      code: (typeof CODES)[number];
      defect?: string | null;
      note: string;
    },
  ) {
    this.checkerOrAdmin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const kind = (
        await c.query<{ kind: string }>(`SELECT kind FROM payroll_parity_batches WHERE id = $1`, [
          batchId,
        ])
      ).rows[0]?.kind;
      if (!kind) bad('Not found', 404);
      const rows = (
        await c.query<{
          id: string;
          employee_id: string;
          month: string;
          component: string;
          diff: string;
          status: string;
        }>(
          `SELECT id::text, employee_id::text, month::text, component, diff::text, status FROM payroll_parity_results
            WHERE batch_id = $1 AND id = ANY($2::bigint[])`,
          [batchId, dto.resultIds],
        )
      ).rows.filter((x) => x.status !== 'MATCH');
      if (!rows.length) bad('No difference chosen', 400);
      const note =
        dto.code === 'LEGACY_DEFECT' && dto.defect ? `${dto.defect}: ${dto.note}` : dto.note;
      for (const x of rows) {
        await c.query(
          `INSERT INTO payroll_parity_explanations (school_id, kind, employee_id, month, component, code, diff, note, explained_by)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, $7, app.current_user_id())
           ON CONFLICT (school_id, kind, employee_id, month, component) DO UPDATE SET code = EXCLUDED.code, diff = EXCLUDED.diff,
             note = EXCLUDED.note, explained_by = app.current_user_id(), explained_at = now()`,
          [kind, x.employee_id, x.month, x.component, dto.code, x.diff, note.slice(0, 500)],
        );
        await c.query(
          `UPDATE payroll_parity_results SET status = 'EXPLAINED', note = NULL WHERE id = $1`,
          [x.id],
        );
      }
      return { explained: rows.length };
    });
  }

  // ---- the sign-off and the switch -------------------------------------------------------------------------------------
  async signoff(ctx: RequestContext, batchId: string) {
    must(ctx, RUN.approve, 'A payroll checker signs the go-live');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (r.status !== 'PARALLEL') bad('The parallel months come first', 409);
      const b = (
        await c.query<{ kind: string; months: string[] }>(
          `SELECT kind, ARRAY(SELECT to_char(m, 'YYYY-MM') FROM unnest(months) m) AS months FROM payroll_parity_batches WHERE id = $1`,
          [batchId],
        )
      ).rows[0];
      if (!b || b.kind !== 'PARALLEL') bad('Sign a comparison of the parallel months', 409);
      const second = r.parallel[1]!;
      const counts = (
        await c.query<{ open: number; all: number }>(
          `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*)::int AS all FROM payroll_parity_results
            WHERE batch_id = $1 AND month = $2::date`,
          [batchId, firstOf(second)],
        )
      ).rows[0]!;
      if (!counts.all)
        bad(
          `${monthWords(second)} has nothing compared yet: compare once both payrolls have it`,
          409,
        );
      if (counts.open)
        bad(
          `${String(counts.open)} difference(s) of ${monthWords(second)} are open: explain them first`,
          409,
        );
      const results = (
        await c.query<{ k: string }>(
          `SELECT employee_id || '|' || month || '|' || component || '|' || COALESCE(legacy, 0) || '|' || COALESCE(ours, 0) || '|' || status AS k
             FROM payroll_parity_results WHERE batch_id = $1 ORDER BY employee_id, month, component`,
          [batchId],
        )
      ).rows.map((x) => x.k);
      const checksum = createHash('sha256').update(results.join('\n')).digest('hex');
      const scoreboard = (
        await c.query(
          `SELECT component, sum(COALESCE(legacy, 0))::text AS legacy, sum(COALESCE(ours, 0))::text AS ours,
                  count(*) FILTER (WHERE status = 'EXPLAINED')::int AS explained, count(*) FILTER (WHERE status = 'OPEN')::int AS open
             FROM payroll_parity_results WHERE batch_id = $1 GROUP BY component ORDER BY component`,
          [batchId],
        )
      ).rows;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_golive_signoffs (school_id, batch_id, months, scoreboard, engine_version, checksum, signed_by)
           VALUES (app.current_school_id(), $1, $2::date[], $3::jsonb, $4, $5, app.current_user_id()) RETURNING id::text`,
          [batchId, r.parallel.map(firstOf), JSON.stringify(scoreboard), ENGINE_VERSION, checksum],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.sign',
        entityType: 'payroll_golive_signoffs',
        entityId: id,
        after: { batchId, checksum },
      });
      return { id, checksum };
    });
  }

  async countersign(ctx: RequestContext, id: string) {
    must(ctx, COUNTERSIGN, 'The principal countersigns the go-live');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<{
          mine: boolean;
          countersigned_by: string | null;
          checksum: string;
          batch_id: string;
        }>(
          `SELECT (signed_by = app.current_user_id()) AS mine, countersigned_by::text, checksum, batch_id::text
             FROM payroll_golive_signoffs WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!s) bad('Not found', 404);
      if (s!.countersigned_by) bad('Already countersigned', 409);
      if (s!.mine) bad('You signed it: another person countersigns', 403);
      const open = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_parity_results WHERE batch_id = $1 AND status = 'OPEN'`,
          [s!.batch_id],
        )
      ).rows[0]!.n;
      await c.query(
        `UPDATE payroll_golive_signoffs SET countersigned_by = app.current_user_id(), countersigned_at = now() WHERE id = $1`,
        [id],
      );
      await c.query(
        `UPDATE payroll_cutover SET status = 'SIGNED', signoff_id = $1, updated_at = now()`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.countersign',
        entityType: 'payroll_golive_signoffs',
        entityId: id,
        after: { openInFirstMonth: open },
      });
      return { ok: true };
    });
  }

  /** The switch: EduPro pays from the month; the old payroll is read-only; EduPro's parallel runs are removed. */
  async switchOver(ctx: RequestContext, month: string) {
    this.admin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (r.status !== 'SIGNED')
        bad('The go-live is switched once it is signed and countersigned', 409);
      if (month <= r.parallel[1]!)
        bad(`EduPro pays from a month after ${monthWords(r.parallel[1]!)}`);
      const removed = await c.query(
        `UPDATE payroll_runs SET deleted_at = now(), updated_by = app.current_user_id()
          WHERE NOT imported AND deleted_at IS NULL AND month < $1::date AND stage NOT IN ('LOCKED', 'PAID')`,
        [firstOf(month)],
      );
      await c.query(
        `UPDATE payroll_cutover SET status = 'SWITCHED', switch_month = $1::date, switched_by = app.current_user_id(), switched_at = now(),
                rollback_reason = NULL, updated_at = now()`,
        [firstOf(month)],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.switch',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: { month, removedRuns: removed.rowCount },
      });
      return {
        ok: true,
        message: `EduPro pays from ${monthWords(month)}. Bring the old payroll's months up to it as history (read it again, prepare, commit), and set the old payroll read-only.`,
      };
    });
  }

  async rollback(ctx: RequestContext, reason: string) {
    this.admin(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.must(c);
      if (r.status !== 'SWITCHED') bad('Only a switch is rolled back', 409);
      if (r.first_live_lock_at) bad('EduPro has locked a live month: the switch stays', 409);
      await c.query(
        `UPDATE payroll_cutover SET status = 'SIGNED', switch_month = NULL, rollback_reason = $1, rolled_back_by = app.current_user_id(),
                rolled_back_at = now(), updated_at = now()`,
        [reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.golive.rollback',
        entityType: 'payroll_cutover',
        entityId: 'golive',
        after: { reason },
      });
      return { ok: true };
    });
  }
}
