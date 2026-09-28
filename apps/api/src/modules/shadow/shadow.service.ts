import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import {
  feeReceiptLineStep,
  feeReceiptStep,
  type FeeReceiptLineRecord,
  type FeeReceiptRecord,
  type RawFeeReceipt,
  type RawFeeReceiptLine,
} from '@edupro/etl';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { parseCsv } from '../payments/settlements.service';
import type { DecideVarianceDto, FeedDto, VariancesQueryDto } from './shadow.dto';

export interface FeedResult {
  id: string;
  kind: string;
  rows: number;
  accepted: number;
  posted: number;
  skipped: number;
  rejected: number;
  rejects: Array<{ legacyKey?: string; column?: string; reason: string }>;
}

export interface ShadowRun {
  id: string;
  runDate: string;
  fromDate: string;
  toDate: string;
  legacyReceipts: number;
  legacyAmount: string;
  newReceipts: number;
  newAmount: string;
  matched: number;
  variances: number;
  openVariances: number;
  varianceAmount: string;
  balancesCompared: number;
  balanceVariances: number;
  status: 'zero' | 'variance';
  ranAt: string;
}

type Row = Record<string, unknown>;

const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const shift = (d: string, days: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
};

/** CSV text → objects keyed by the header cells (the legacy export's own column names). */
function csvRows(csv: string): Row[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * Sprint 16: the shadow run. Legacy receipts are validated with the ETL transforms, kept in
 * shadow_legacy_receipts and dual-posted through app.post_receipt (legacy number as reference); cancelled
 * legacy receipts reverse the posting. app.run_shadow_reconcile compares the two ledgers for a window.
 */
@Injectable()
export class ShadowService {
  private readonly logger = new Logger(ShadowService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- feeds -------------------------------------------------------------------------------------
  async feed(
    ctx: RequestContext,
    dto: FeedDto,
    who: { serviceKeyId?: string } = {},
  ): Promise<FeedResult> {
    const tenant = requireTenant(ctx);
    const rows: Row[] = dto.rows ?? (dto.csv ? csvRows(dto.csv) : []);
    const lines: Row[] = dto.lines ?? [];
    if (rows.length === 0)
      throw new DomainError('shadow.feed_empty', 'The feed has no rows', { status: 400 });
    return this.db.tenant(tenant, async (c) => {
      const f = await c.query<{ id: string }>(
        `INSERT INTO shadow_feeds (school_id, kind, source, file_name, rows, received_by, service_key_id, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), $5, app.current_request_id()) RETURNING id::text`,
        [dto.kind, dto.source, dto.fileName ?? null, rows.length, who.serviceKeyId ?? null],
      );
      const feedId = f.rows[0]!.id;
      const out =
        dto.kind === 'receipts'
          ? await this.feedReceipts(c, feedId, rows, lines)
          : await this.feedBalances(c, feedId, rows);
      await c.query(
        `UPDATE shadow_feeds SET accepted = $2, posted = $3, skipped = $4, rejected = $5, rejects = $6::jsonb WHERE id = $1`,
        [
          feedId,
          out.accepted,
          out.posted,
          out.skipped,
          out.rejects.length,
          JSON.stringify(out.rejects.slice(0, 500)),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.shadow.feed',
        entityType: 'shadow_feeds',
        entityId: feedId,
        after: {
          kind: dto.kind,
          source: dto.source,
          rows: rows.length,
          ...out,
          rejects: out.rejects.length,
        },
      });
      return {
        id: feedId,
        kind: dto.kind,
        rows: rows.length,
        rejected: out.rejects.length,
        ...out,
      };
    });
  }

  private async feedReceipts(c: PoolClient, feedId: string, rows: Row[], extraLines: Row[]) {
    const rejects: FeedResult['rejects'] = [];
    // lines: nested under each header (`lines`) or flat, keyed by ReceiptNo
    const lineByNo = new Map<string, FeeReceiptLineRecord>();
    const rawLines: Row[] = [...extraLines];
    for (const r of rows) if (Array.isArray(r.lines)) rawLines.push(...(r.lines as Row[]));
    for (const l of rawLines) {
      const t = feeReceiptLineStep.transform(l as RawFeeReceiptLine);
      if (Array.isArray(t)) {
        for (const x of t)
          rejects.push({ legacyKey: x.legacyKey, column: x.column, reason: x.reason });
        continue;
      }
      lineByNo.set(t.legacyKey, t.row);
    }
    let accepted = 0;
    let posted = 0;
    let skipped = 0;
    for (const r of rows) {
      const t = feeReceiptStep.transform(r as RawFeeReceipt);
      if (Array.isArray(t)) {
        for (const x of t)
          rejects.push({ legacyKey: x.legacyKey, column: x.column, reason: x.reason });
        continue;
      }
      const h: FeeReceiptRecord = t.row;
      const line = lineByNo.get(h.receiptNo);
      const lateFee = line ? Number(line.lateFee) : 0;
      const student = await c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE admission_no = $1 AND deleted_at IS NULL`,
        [h.admissionNo],
      );
      const up = await c.query<{
        id: string;
        payment_id: string | null;
        cancelled: boolean;
        reversed_at: Date | null;
      }>(
        `INSERT INTO shadow_legacy_receipts (school_id, feed_id, legacy_receipt_no, admission_no, student_id, received_on, amount, late_fee, mode, instrument_no, bank_name, reference, cancelled, legacy_year, lines)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
         ON CONFLICT (school_id, legacy_receipt_no) DO UPDATE SET cancelled = EXCLUDED.cancelled, amount = EXCLUDED.amount, received_on = EXCLUDED.received_on, feed_id = EXCLUDED.feed_id
         RETURNING id::text, payment_id::text, cancelled, reversed_at`,
        [
          feedId,
          h.receiptNo,
          h.admissionNo,
          student.rows[0]?.id ?? null,
          h.receivedOn,
          h.amount,
          lateFee.toFixed(2),
          h.mode,
          h.instrumentNo,
          h.bankName,
          h.reference,
          h.cancelled,
          h.legacyYear,
          JSON.stringify(line ?? {}),
        ],
      );
      accepted += 1;
      const row = up.rows[0]!;
      if (!student.rows[0]) {
        await c.query(
          `UPDATE shadow_legacy_receipts SET post_error = 'student_unknown' WHERE id = $1`,
          [row.id],
        );
        rejects.push({
          legacyKey: h.receiptNo,
          column: 'sadmission',
          reason: 'shadow.student_unknown',
        });
        continue;
      }
      if (h.cancelled) {
        if (row.payment_id && !row.reversed_at) {
          try {
            await c.query(`SAVEPOINT shadow_rev`);
            await c.query(`SELECT app.reverse_fee_payment($1, 'reversed', $2)`, [
              row.payment_id,
              `shadow: legacy ${h.receiptNo} cancelled`,
            ]);
            await c.query(`RELEASE SAVEPOINT shadow_rev`);
            await c.query(
              `UPDATE shadow_legacy_receipts SET reversed_at = now(), post_error = NULL WHERE id = $1`,
              [row.id],
            );
          } catch (error) {
            await c.query(`ROLLBACK TO SAVEPOINT shadow_rev`);
            await c.query(`UPDATE shadow_legacy_receipts SET post_error = $2 WHERE id = $1`, [
              row.id,
              (error as Error).message.slice(0, 200),
            ]);
          }
        } else skipped += 1;
        continue;
      }
      if (row.payment_id) {
        skipped += 1;
        continue;
      }
      const year = await c.query<{ id: string }>(
        `SELECT id::text FROM academic_years WHERE start_date <= $1::date AND end_date >= $1::date ORDER BY start_date DESC LIMIT 1`,
        [h.receivedOn],
      );
      if (!year.rows[0]) {
        await c.query(
          `UPDATE shadow_legacy_receipts SET post_error = 'no_academic_year' WHERE id = $1`,
          [row.id],
        );
        rejects.push({
          legacyKey: h.receiptNo,
          column: 'ReceiptDate',
          reason: 'shadow.no_academic_year',
        });
        continue;
      }
      try {
        await c.query(`SAVEPOINT shadow_post`);
        const p = await c.query<{ o_payment_id: string }>(
          `SELECT o_payment_id::text FROM app.post_receipt($1, $2, $3, $4::date, $5, $6, $7, $8, $9::date, $10, NULL, 'school', $11, false)`,
          [
            student.rows[0].id,
            year.rows[0].id,
            h.amount,
            h.receivedOn,
            h.mode,
            h.receiptNo,
            `shadow: legacy ${h.receiptNo}`,
            h.instrumentNo,
            h.instrumentDate,
            h.bankName,
            lateFee > 0,
          ],
        );
        await c.query(`RELEASE SAVEPOINT shadow_post`);
        await c.query(
          `UPDATE shadow_legacy_receipts SET payment_id = $2, posted_at = now(), post_error = NULL WHERE id = $1`,
          [row.id, p.rows[0]!.o_payment_id],
        );
        posted += 1;
      } catch (error) {
        await c.query(`ROLLBACK TO SAVEPOINT shadow_post`);
        const msg = (error as Error).message.slice(0, 200);
        await c.query(`UPDATE shadow_legacy_receipts SET post_error = $2 WHERE id = $1`, [
          row.id,
          msg,
        ]);
        rejects.push({ legacyKey: h.receiptNo, reason: `shadow.post_failed: ${msg}` });
      }
    }
    return { accepted, posted, skipped, rejects };
  }

  private async feedBalances(c: PoolClient, feedId: string, rows: Row[]) {
    const rejects: FeedResult['rejects'] = [];
    let accepted = 0;
    const str = (v: unknown) =>
      typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    for (const r of rows) {
      const adm = str(r.sadmission ?? r.admission_no ?? r.admissionNo).toUpperCase();
      const asOf = str(r.as_of ?? r.asOf ?? r.date);
      const bal = Number(str(r.balance ?? r.balance_amt ?? r.due).replace(/[₹,\s]/g, ''));
      if (!adm || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(bal)) {
        rejects.push({ legacyKey: adm || undefined, reason: 'shadow.balance_invalid' });
        continue;
      }
      await c.query(
        `INSERT INTO shadow_legacy_balances (school_id, feed_id, as_of, admission_no, student_id, balance)
         VALUES (app.current_school_id(), $1, $2::date, $3, (SELECT id FROM students WHERE admission_no = $3 AND deleted_at IS NULL LIMIT 1), $4)
         ON CONFLICT (school_id, as_of, admission_no) DO UPDATE SET balance = EXCLUDED.balance, feed_id = EXCLUDED.feed_id`,
        [feedId, asOf, adm, bal.toFixed(2)],
      );
      accepted += 1;
    }
    return { accepted, posted: 0, skipped: 0, rejects };
  }

  async feeds(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT f.id::text, f.kind, f.source, f.file_name, f.rows, f.accepted, f.posted, f.skipped, f.rejected, f.received_at,
                COALESCE(u.display_name, k.name, 'service') AS received_by
           FROM shadow_feeds f LEFT JOIN users u ON u.id = f.received_by LEFT JOIN service_keys k ON k.id = f.service_key_id
          ORDER BY f.received_at DESC LIMIT 100`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        source: x.source,
        fileName: x.file_name,
        rows: x.rows,
        accepted: x.accepted,
        posted: x.posted,
        skipped: x.skipped,
        rejected: x.rejected,
        receivedBy: x.received_by,
        receivedAt: (x.received_at as Date).toISOString(),
      }));
    });
  }

  // ---- reconciliation ----------------------------------------------------------------------------
  async reconcile(ctx: RequestContext, from?: string, to?: string): Promise<ShadowRun> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const run = await this.reconcileWith(c, from, to);
      await this.audit.stage(ctx, c, {
        action: 'fees.shadow.reconcile',
        entityType: 'shadow_runs',
        entityId: run.id,
        after: {
          from: run.fromDate,
          to: run.toDate,
          status: run.status,
          openVariances: run.openVariances,
        },
      });
      return run;
    });
  }

  /** Shared with the workers job: runs the function for the window (default: yesterday to today). */
  async reconcileWith(c: PoolClient, from?: string, to?: string): Promise<ShadowRun> {
    const toDate = to ?? ist();
    const fromDate = from ?? shift(toDate, -1);
    const r = await c.query(`SELECT * FROM app.run_shadow_reconcile($1::date, $2::date)`, [
      fromDate,
      toDate,
    ]);
    return toRun(r.rows[0]!);
  }

  async runs(ctx: RequestContext, days = 400): Promise<ShadowRun[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT * FROM shadow_runs WHERE run_date >= CURRENT_DATE - $1::int ORDER BY run_date DESC`,
        [days],
      );
      return r.rows.map(toRun);
    });
  }

  async variances(ctx: RequestContext, q: VariancesQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where = [
        `($1::bigint IS NULL OR v.run_id = $1::bigint)`,
        `($2::text IS NULL OR v.status = $2)`,
        `($3::text IS NULL OR v.kind = $3)`,
      ];
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments with bound parameters only
        `SELECT v.id::text, v.run_id::text, r.run_date::text, v.kind, v.ref, v.legacy, v.current, v.delta::text, v.status, v.explanation,
                u.display_name AS decided_by, v.decided_at, count(*) OVER () AS total
           FROM shadow_variances v JOIN shadow_runs r ON r.id = v.run_id LEFT JOIN users u ON u.id = v.decided_by
          WHERE ${where.join(' AND ')}
          ORDER BY v.status = 'open' DESC, r.run_date DESC, abs(v.delta) DESC, v.id
          LIMIT $4 OFFSET $5`,
        [q.runId ?? null, q.status ?? null, q.kind ?? null, q.size, (q.page - 1) * q.size],
      );
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          runId: x.run_id,
          runDate: x.run_date,
          kind: x.kind,
          ref: x.ref,
          legacy: x.legacy,
          current: x.current,
          delta: x.delta,
          status: x.status,
          explanation: x.explanation,
          decidedBy: x.decided_by,
          decidedAt: x.decided_at ? (x.decided_at as Date).toISOString() : null,
        })),
        total: Number(r.rows[0]?.total ?? 0),
      };
    });
  }

  async decide(ctx: RequestContext, id: string, dto: DecideVarianceDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.status !== 'open' && !dto.explanation)
        throw new DomainError('validation-failed', 'An explanation is required', { status: 400 });
      const r = await c.query<{ id: string; run_id: string; kind: string; ref: string }>(
        `UPDATE shadow_variances SET status = $2, explanation = $3, decided_by = CASE WHEN $2 = 'open' THEN NULL ELSE app.current_user_id() END,
                decided_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END
          WHERE id = $1 RETURNING id::text, run_id::text, kind, ref`,
        [id, dto.status, dto.explanation ?? null],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Variance not found', { status: 404 });
      await c.query(
        `UPDATE shadow_runs SET open_variances = (SELECT count(*) FROM shadow_variances v WHERE v.run_id = $1 AND v.status = 'open'),
                variance_amount = COALESCE((SELECT sum(abs(v.delta)) FROM shadow_variances v WHERE v.run_id = $1 AND v.status = 'open'), 0),
                status = CASE WHEN EXISTS (SELECT 1 FROM shadow_variances v WHERE v.run_id = $1 AND v.status = 'open') THEN 'variance' ELSE 'zero' END
          WHERE id = $1`,
        [r.rows[0].run_id],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.shadow.variance_decide',
        entityType: 'shadow_variances',
        entityId: id,
        after: {
          kind: r.rows[0].kind,
          ref: r.rows[0].ref,
          status: dto.status,
          explanation: dto.explanation,
        },
      });
      return { ok: true };
    });
  }

  tenantOf(ctx: RequestContext): TenantContext {
    return requireTenant(ctx);
  }
}

function toRun(x: Record<string, unknown>): ShadowRun {
  const d = (v: unknown) =>
    v instanceof Date
      ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      : String(v);
  return {
    id: String(x.id),
    runDate: d(x.run_date),
    fromDate: d(x.from_date),
    toDate: d(x.to_date),
    legacyReceipts: Number(x.legacy_receipts),
    legacyAmount: String(x.legacy_amount),
    newReceipts: Number(x.new_receipts),
    newAmount: String(x.new_amount),
    matched: Number(x.matched),
    variances: Number(x.variances),
    openVariances: Number(x.open_variances),
    varianceAmount: String(x.variance_amount),
    balancesCompared: Number(x.balances_compared),
    balanceVariances: Number(x.balance_variances),
    status: x.status as 'zero' | 'variance',
    ranAt: (x.ran_at as Date).toISOString(),
  };
}
