import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { registerGeneratedOn } from '../exams/register-head';
import { RUN } from './payroll-inputs.dto';
import { bad, has, monthWords } from './payroll-month';
import { gridCsv } from './payroll-report-grid';
import { CATALOGUE, type ReportParams } from './payroll-reports';
import { AUDIT_VIEW, PayrollReportsService } from './payroll-reports.service';
import { PAYROLL } from './payroll.dto';

/** what belongs to payroll in the audit log: its tables' rows, its events, and role changes of its roles */
const SCOPE = `(a.entity_type LIKE 'payroll\\_%' OR a.action LIKE 'payroll.%'
  OR (a.action LIKE 'access.%' AND (COALESCE(a.before::text, '') ILIKE '%payroll%' OR COALESCE(a.after::text, '') ILIKE '%payroll%')))`;
const READS = [
  'payroll.report.view',
  'payroll.report.download',
  'payroll.profile.reveal',
  'payroll.audit.view',
  'payroll.audit.export',
];
const KIND_SQL = `CASE WHEN a.action IN ('insert', 'update', 'delete') THEN 'Change'
  WHEN a.action = ANY('{${READS.join(',')}}'::text[]) OR a.action LIKE '%.download' THEN 'Read' ELSE 'Event' END`;

export interface AuditQuery {
  from?: string;
  to?: string;
  kind?: 'Change' | 'Event' | 'Read';
  table?: string;
  action?: string;
  who?: string;
  record?: string;
  contains?: string;
  page: number;
  size: number;
}
// eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
const where = `WHERE ${SCOPE}
  AND ($1::date IS NULL OR a.occurred_at >= $1::date) AND ($2::date IS NULL OR a.occurred_at < $2::date + 1)
  AND ($3::text IS NULL OR ${KIND_SQL} = $3) AND ($4::text IS NULL OR a.entity_type = $4)
  AND ($5::text IS NULL OR a.action LIKE $5 || '%')
  AND ($6::text IS NULL OR u.display_name ILIKE '%' || $6 || '%')
  AND ($7::text IS NULL OR a.entity_id = $7)
  AND ($8::text IS NULL OR a.before::text ILIKE '%' || $8 || '%' OR a.after::text ILIKE '%' || $8 || '%')`;
const argsOf = (q: Partial<AuditQuery>) => [
  q.from ?? null,
  q.to ?? null,
  q.kind ?? null,
  q.table ?? null,
  q.action ?? null,
  q.who ?? null,
  q.record ?? null,
  q.contains ?? null,
];

/** the fields a change touched: the keys whose values differ between before and after */
function changed(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter(
    (k) =>
      !['updated_at', 'updated_by'].includes(k) &&
      JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
  );
}

/**
 * The payroll audit trail and the auditor pack (docs/design/86, phase F): every payroll change (each table's row images),
 * each event (runs, approvals, settings and roles, bank files), and each read (reports run and downloaded, reveals), with
 * the fields before and after; kept as long as the audit log is (the app never purges it). Seeing the trail is itself
 * recorded. The yearly pack for the auditors: the registers month by month, TDS and its challans, the filings, the
 * year's trail with before and after, and a manifest of SHA-256 checksums.
 */
@Injectable()
export class PayrollAuditService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: PayrollReportsService,
  ) {}

  private may(ctx: RequestContext) {
    if (!has(ctx, AUDIT_VIEW))
      bad('The payroll audit trail is for checkers, the payroll admin and the auditor', 403);
  }

  async list(ctx: RequestContext, q: AuditQuery) {
    this.may(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const args = argsOf(q);
      const total = Number(
        (
          await c.query<{ n: string }>(
            // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
            `SELECT count(*)::text AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where}`,
            args,
          )
        ).rows[0]?.n ?? 0,
      );
      const rows = (
        await c.query<{
          id: string;
          at: Date;
          who: string | null;
          kind: string;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
          `SELECT a.id::text, a.occurred_at AS at, u.display_name AS who, ${KIND_SQL} AS kind, a.action, a.entity_type,
                  a.entity_id, a.before, a.after
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where}
            ORDER BY a.occurred_at DESC, a.id DESC LIMIT $9 OFFSET $10`,
          [...args, q.size, (q.page - 1) * q.size],
        )
      ).rows.map(({ before, after, ...r }) => ({
        ...r,
        changed: changed(before, after).slice(0, 8),
        // the payroll admin (or the Payroll SPOC) approved what they made themselves
        self: after?.selfApproved === true,
      }));
      const tables = (
        await c.query<{ t: string }>(
          `SELECT DISTINCT a.entity_type AS t FROM audit_logs a WHERE a.entity_type LIKE 'payroll\\_%' ORDER BY 1`,
        )
      ).rows.map((r) => r.t);
      await this.audit.stage(ctx, c, {
        action: 'payroll.audit.view',
        entityType: 'audit_logs',
        entityId: 'payroll',
        after: { filters: { ...q }, rows: rows.length },
      });
      return { rows, total, tables };
    });
  }

  async get(ctx: RequestContext, id: string) {
    this.may(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{
          id: string;
          at: Date;
          who: string | null;
          kind: string;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
          ip: string | null;
          request_id: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
          `SELECT a.id::text, a.occurred_at AS at, u.display_name AS who, ${KIND_SQL} AS kind, a.action, a.entity_type, a.entity_id,
                  a.before, a.after, a.ip::text, a.request_id::text
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.id = $1 AND ${SCOPE}`,
          [id],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      const keys = [...new Set([...Object.keys(r!.before ?? {}), ...Object.keys(r!.after ?? {})])];
      const diff = changed(r!.before, r!.after);
      return {
        entry: { ...r!, before: undefined, after: undefined },
        fields: keys.map((k) => ({
          field: k,
          before: r!.before?.[k] ?? null,
          after: r!.after?.[k] ?? null,
          changed: diff.includes(k),
        })),
      };
    });
  }

  private async rowsFor(c: PoolClient, q: Partial<AuditQuery>, limit: number) {
    return (
      await c.query<{
        at: Date;
        who: string | null;
        kind: string;
        action: string;
        entity_type: string | null;
        entity_id: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
        `SELECT a.occurred_at AS at, u.display_name AS who, ${KIND_SQL} AS kind, a.action, a.entity_type, a.entity_id, a.before, a.after
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where}
          ORDER BY a.occurred_at, a.id LIMIT $9`,
        [...argsOf(q), limit],
      )
    ).rows;
  }

  /** The trail as Excel, with the filters used and each change's fields before and after. */
  async exportXlsx(ctx: RequestContext, q: AuditQuery) {
    this.may(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await this.rowsFor(c, q, 50_000);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Payroll audit trail');
      ws.addRow(['Payroll audit trail']).font = { bold: true, size: 13 };
      ws.addRow([`Generated on ${registerGeneratedOn()}`]);
      ws.addRow([
        `Filters: ${JSON.stringify(Object.fromEntries(Object.entries(q).filter(([k, v]) => v && !['page', 'size'].includes(k))))}`,
      ]);
      ws.addRow([]);
      ws.addRow([
        'When',
        'Who',
        'Kind',
        'Action',
        'Table',
        'Record',
        'Fields changed',
        'Before',
        'After',
      ]).font = { bold: true };
      for (const r of rows)
        ws.addRow([
          r.at.toISOString(),
          r.who ?? '',
          r.kind,
          r.action,
          r.entity_type ?? '',
          r.entity_id ?? '',
          changed(r.before, r.after).join(', '),
          r.before ? JSON.stringify(r.before) : '',
          r.after ? JSON.stringify(r.after) : '',
        ]);
      [22, 20, 8, 26, 24, 12, 30, 50, 50].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.views = [{ state: 'frozen', ySplit: 5 }];
      await this.audit.stage(ctx, c, {
        action: 'payroll.audit.export',
        entityType: 'audit_logs',
        entityId: 'payroll',
        after: { filters: { ...q }, rows: rows.length },
      });
      return {
        filename: `Payroll_audit_trail_${new Date().toISOString().slice(0, 10)}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    });
  }

  /** The auditor pack of a financial year: a ZIP with the registers, the tax, the filings, the trail and a manifest. */
  async auditorPack(ctx: RequestContext, fy: string) {
    if (!(has(ctx, RUN.approve) || has(ctx, PAYROLL.admin)))
      bad('A payroll checker builds the auditor pack', 403);
    const y = Number(fy.slice(0, 4));
    const from = `${String(y)}-04-01`;
    const to = `${String(y + 1)}-03-31`;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const months = (
        await c.query<{ m: string }>(
          `SELECT DISTINCT to_char(month, 'YYYY-MM') AS m FROM payroll_runs
            WHERE stage IN ('APPROVED', 'LOCKED', 'PAID') AND deleted_at IS NULL AND month BETWEEN $1::date AND $2::date ORDER BY 1`,
          [from, to],
        )
      ).rows.map((r) => r.m);
      if (!months.length) bad(`No month of ${fy} is paid yet`, 409);
      const head = await this.reports.head(c);
      const files: Array<{ path: string; body: Buffer; rows: number }> = [];
      const add = (path: string, text: string, rows: number) =>
        files.push({ path, body: Buffer.from(text, 'utf8'), rows });
      const grid = async (key: string, p: ReportParams) => {
        try {
          return await this.reports.build(
            c,
            ctx,
            CATALOGUE.find((d) => d.key === key)!,
            p,
          );
        } catch {
          return null; // a register the school does not have (no PF, say) is left out
        }
      };
      for (const m of months) {
        for (const [key, name] of [
          ['register', 'salary_register'],
          ['tds', 'tds_register'],
          ['pf', 'pf_register'],
          ['esi', 'esi_statement'],
          ['pt', 'pt_register'],
        ] as const) {
          const g = await grid(key, { month: m });
          if (g && g.rows.length)
            add(`registers/${m}/${name}_${m}.csv`, gridCsv(g, head.school), g.rows.length);
        }
      }
      const ytd = await grid('ytd', { fy });
      if (ytd) add(`annual/year_to_date_${fy}.csv`, gridCsv(ytd, head.school), ytd.rows.length);
      const asOf =
        new Date().toISOString().slice(0, 10) < to ? new Date().toISOString().slice(0, 10) : to;
      const grat = await grid('gratuity', { asOf });
      if (grat)
        add(`annual/gratuity_liability_${asOf}.csv`, gridCsv(grat, head.school), grat.rows.length);
      const bonus = await grid('bonus', { fy });
      if (bonus) add(`annual/bonus_${fy}.csv`, gridCsv(bonus, head.school), bonus.rows.length);
      const csv = (rows: Array<Record<string, unknown>>) => {
        if (!rows.length) return 'none\r\n';
        const cols = Object.keys(rows[0]!);
        const cell = (v: unknown) => {
          const s =
            v === null || v === undefined
              ? ''
              : v instanceof Date
                ? v.toISOString()
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return `﻿${[cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\r\n')}\r\n`;
      };
      const challans = (
        await c.query(
          `SELECT quarter, bsr_code, challan_no, deposited_on::text, amount::text, interest::text, late_fee::text, months
             FROM payroll_tds_challans WHERE fy = $1 AND deleted_at IS NULL ORDER BY quarter, deposited_on`,
          [fy],
        )
      ).rows;
      add(`tax/tds_challans_${fy}.csv`, csv(challans), challans.length);
      const filings = (
        await c.query(
          `SELECT item, to_char(month, 'YYYY-MM') AS month, period, due_on::text, done_at, ack_no, ack_date::text,
                  amount_paid::text, amount_computed::text, reopen_reason
             FROM payroll_compliance WHERE month BETWEEN $1::date AND $2::date ORDER BY due_on, item`,
          [from, to],
        )
      ).rows;
      add(`compliance/filings_${fy}.csv`, csv(filings), filings.length);
      const trail = (await this.rowsFor(c, { from, to }, 500_000)).map((r) => ({
        when: r.at,
        who: r.who,
        kind: r.kind,
        action: r.action,
        table: r.entity_type,
        record: r.entity_id,
        fields_changed: changed(r.before, r.after).join(' '),
        before: r.before,
        after: r.after,
      }));
      add(`audit/payroll_audit_trail_${fy}.csv`, csv(trail), trail.length);
      const zip = new JSZip();
      for (const f of files) zip.file(f.path, f.body);
      const manifest = [
        'file,rows,sha256',
        ...files.map(
          (f) => `${f.path},${String(f.rows)},${createHash('sha256').update(f.body).digest('hex')}`,
        ),
      ].join('\r\n');
      zip.file('MANIFEST.csv', `${manifest}\r\n`);
      zip.file(
        'README.txt',
        [
          `${head.school} — payroll auditor pack, financial year ${fy}`,
          `Built on ${registerGeneratedOn()}. Months: ${months.map(monthWords).join(', ')}.`,
          'registers/: the salary register, TDS, PF, ESI and profession tax registers of each month (one line per employee).',
          'annual/: the year to date, the gratuity liability (the accounts’ figure is the actuary’s) and the bonus.',
          'tax/: the TDS challans. compliance/: the filings with their acknowledgements.',
          'audit/: every payroll change, event and read of the year, with the fields before and after.',
          'MANIFEST.csv: each file’s rows and SHA-256 checksum. A month approved but not locked is marked PROVISIONAL in its files.',
        ].join('\r\n'),
      );
      const body = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      await this.audit.stage(ctx, c, {
        action: 'payroll.auditor_pack.build',
        entityType: 'payroll_reports',
        entityId: fy,
        after: { files: files.length, sha256: createHash('sha256').update(body).digest('hex') },
      });
      return {
        filename: `Payroll_auditor_pack_${fy}.zip`,
        contentType: 'application/zip',
        base64: body.toString('base64'),
      };
    });
  }
}
