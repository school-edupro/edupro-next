/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import { Inject, Injectable } from '@nestjs/common';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from '../purchase/purchase-list-file';
import { istToday } from '../purchase/purchase-stock-core';
import { dmy, monthStart, monthWords, round2 } from './leave-engine';
import { LeaveService, REQ, type ReqRow } from './leave.service';
import {
  LEAVE_OFFICE,
  type AdjustDto,
  type BalanceImportDto,
  type BalanceQueryDto,
  type RegisterQueryDto,
} from './leave.dto';

const STATUS_WORDS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

/**
 * The leave office (docs/design/85, phase B): the leave register (nine figures for the financial year,
 * the filters, a page at a time, Excel and PDF), the balance master (the monthly ledger, corrections with
 * a reason, the opening balances from Excel) and running the month's credit and close now.
 */
@Injectable()
export class LeaveOfficeService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly leave: LeaveService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private mustOffice(ctx: RequestContext) {
    if (!(ctx.permissions?.has(LEAVE_OFFICE) ?? false))
      throw new DomainError('permission-denied', 'Only the leave office sees this', {
        status: 403,
      });
  }

  // ---- the register --------------------------------------------------------------------------------
  private filter(q: RegisterQueryDto) {
    const where = `WHERE r.linked_request_id IS NULL
      AND ($1::bigint IS NULL OR r.leave_type_id = $1) AND ($2::bigint IS NULL OR r.employee_id = $2)
      AND ($3::text IS NULL OR lower(e.department) = lower($3))
      AND ($4::date IS NULL OR r.to_date >= $4) AND ($5::date IS NULL OR r.from_date <= $5)
      AND ($6::text IS NULL OR ($6 = 'system' AND r.source LIKE 'auto%') OR r.source = $6)
      AND ($7::text IS NULL OR r.number ILIKE '%' || $7 || '%' OR e.display_name ILIKE '%' || $7 || '%' OR e.employee_code ILIKE '%' || $7 || '%')`;
    const bucket = {
      pending: `r.status = 'pending' AND COALESCE((SELECT i.current_level FROM workflow_instances i WHERE i.id = r.workflow_instance_id), 1) <= 1`,
      l1: `r.status = 'pending' AND (SELECT i.current_level FROM workflow_instances i WHERE i.id = r.workflow_instance_id) = 2`,
      l2: `r.status = 'pending' AND (SELECT i.current_level FROM workflow_instances i WHERE i.id = r.workflow_instance_id) >= 3`,
      approved: `r.status = 'approved'`,
      rejected: `r.status = 'rejected'`,
      cancelled: `r.status = 'cancelled'`,
      withdrawn: `r.status = 'withdrawn'`,
      lop: `(t.loss_of_pay OR EXISTS (SELECT 1 FROM staff_leave_requests x WHERE x.linked_request_id = r.id))`,
    } as const;
    return {
      where: q.bucket ? `${where} AND ${bucket[q.bucket]}` : where,
      args: [
        q.leaveTypeId ?? null,
        q.employeeId ?? null,
        q.department ?? null,
        q.from ?? null,
        q.to ?? null,
        q.source ?? null,
        q.q ?? null,
      ],
      bucket,
    };
  }

  /**
   * Every leave as filtered, a page at a time (the loss-of-pay part of a split shows with its paid part);
   * the nine figures count the financial year whatever the filters (as the earlier register did).
   */
  async register(ctx: RequestContext, q: RegisterQueryDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = this.filter(q);
      const today = istToday();
      const y =
        Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
      const fyFrom = `${String(y)}-04-01`;
      const fyTo = `${String(y + 1)}-03-31`;
      const fig = (
        await c.query<Record<string, number>>(
          `SELECT count(*)::int AS total,
                  ${Object.entries(f.bucket)
                    .map(([k, v]) => `count(*) FILTER (WHERE ${v})::int AS ${k}`)
                    .join(', ')}
             FROM staff_leave_requests r JOIN staff_leave_types t ON t.id = r.leave_type_id
            WHERE r.linked_request_id IS NULL AND r.from_date <= $2::date AND r.to_date >= $1::date`,
          [fyFrom, fyTo],
        )
      ).rows[0]!;
      const total = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id
             JOIN staff_leave_types t ON t.id = r.leave_type_id ${f.where}`,
          f.args,
        )
      ).rows[0]!.n;
      const rows = await c.query<ReqRow>(
        `${REQ} ${f.where} ORDER BY r.created_at DESC, r.id DESC LIMIT $8 OFFSET $9`,
        [...f.args, q.size, (q.page - 1) * q.size],
      );
      const lists = await c.query<{ kind: string; id: string; name: string }>(
        `SELECT 'type' AS kind, id::text, code || ' · ' || name AS name FROM staff_leave_types WHERE status = 'active'
         UNION ALL SELECT 'employee', id::text, display_name || ' (' || employee_code || ')' FROM employees
                    WHERE deleted_at IS NULL AND status = 'active'
         UNION ALL SELECT DISTINCT 'department', department, department FROM employees
                    WHERE deleted_at IS NULL AND COALESCE(department, '') <> ''
         ORDER BY 1, 3`,
      );
      return {
        figures: { ...fig, fy: `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}` },
        rows: rows.rows.map((r) => this.leave.shape(r)),
        total,
        page: q.page,
        size: q.size,
        lists: {
          types: lists.rows.filter((x) => x.kind === 'type').map(({ id, name }) => ({ id, name })),
          employees: lists.rows
            .filter((x) => x.kind === 'employee')
            .map(({ id, name }) => ({ id, name })),
          departments: lists.rows.filter((x) => x.kind === 'department').map((x) => x.name),
        },
      };
    });
  }

  /** The register as filtered (every page) on the letterhead: Excel or PDF. */
  async registerFile(ctx: RequestContext, q: RegisterQueryDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = this.filter(q);
      const rows = (
        await c.query<ReqRow>(`${REQ} ${f.where} ORDER BY r.from_date, r.number LIMIT $8`, [
          ...f.args,
          LIST_LIMIT,
        ])
      ).rows;
      checkListSize(rows.length, 'leave requests');
      const words = [
        q.from || q.to ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}` : 'All dates',
        q.bucket ? `Only: ${q.bucket}` : null,
        q.department ? `Department: ${q.department}` : null,
        q.source ? `Applied: ${q.source}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return purchaseListFile({
        format: q.format ?? 'xlsx',
        head: await purchaseHead(c, this.storage),
        title: 'Leave register',
        slug: 'Leave-register',
        words,
        list: {
          columns:
            q.format === 'pdf'
              ? [
                  { label: 'Leave no.', width: 2 },
                  { label: 'Employee', width: 3 },
                  { label: 'Type', width: 1 },
                  { label: 'From', type: 'date' },
                  { label: 'To', type: 'date' },
                  { label: 'Days', type: 'number', width: 1 },
                  { label: 'Status', width: 1.6 },
                  { label: 'Waiting with / decided by', width: 3 },
                ]
              : [
                  { label: 'Leave no.', width: 2 },
                  { label: 'Emp. code', width: 1.4 },
                  { label: 'Employee', width: 3 },
                  { label: 'Department', width: 2.4 },
                  { label: 'Type', width: 1 },
                  { label: 'From', type: 'date' },
                  { label: 'To', type: 'date' },
                  { label: 'Days', type: 'number', width: 1 },
                  { label: 'Half day', width: 1.4 },
                  { label: 'Status', width: 1.6 },
                  { label: 'Applied', width: 2 },
                  { label: 'Applied on', type: 'date' },
                  { label: 'Reason', width: 4 },
                  { label: 'Waiting with / decided by', width: 3 },
                  { label: 'Note', width: 3 },
                ],
          rows: rows.map((r) => {
            const by = r.status === 'pending' ? (r.waiting_with ?? '') : (r.decided_by ?? '');
            return q.format === 'pdf'
              ? [
                  r.number,
                  `${r.employee} (${r.code})`,
                  r.type_code,
                  r.from_date,
                  r.to_date,
                  Number(r.days),
                  STATUS_WORDS[r.status] ?? r.status,
                  by,
                ]
              : [
                  r.number,
                  r.code,
                  r.employee,
                  r.department,
                  r.type_code,
                  r.from_date,
                  r.to_date,
                  Number(r.days),
                  r.half_day ? (r.session === 'first' ? 'First half' : 'Second half') : '',
                  STATUS_WORDS[r.status] ?? r.status,
                  r.source === 'self'
                    ? 'By the employee'
                    : r.source === 'on_behalf'
                      ? 'By the office'
                      : 'By the system',
                  r.created_at.toISOString().slice(0, 10),
                  r.reason,
                  by,
                  r.note,
                ];
          }),
        },
        sum: [q.format === 'pdf' ? 5 : 7],
      });
    });
  }

  // ---- balances ------------------------------------------------------------------------------------
  /** The month's ledger of every employee and leave type with a balance (rows opened as they are shown). */
  async balances(ctx: RequestContext, q: BalanceQueryDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const month = q.month ? `${q.month}-01` : monthStart(istToday());
      const current = month === monthStart(istToday());
      const where = `WHERE e.deleted_at IS NULL AND e.status = 'active' AND t.status = 'active' AND t.keeps_balance AND NOT t.loss_of_pay
          AND ($1::bigint IS NULL OR e.id = $1) AND ($2::bigint IS NULL OR t.id = $2)
          AND ($3::text IS NULL OR lower(e.department) = lower($3))
          AND ($4::text IS NULL OR e.display_name ILIKE '%' || $4 || '%' OR e.employee_code ILIKE '%' || $4 || '%')`;
      const args = [q.employeeId ?? null, q.leaveTypeId ?? null, q.department ?? null, q.q ?? null];
      const total = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM employees e CROSS JOIN staff_leave_types t ${where}`,
          args,
        )
      ).rows[0]!.n;
      const pairs = await c.query<{ emp: string; type_id: string }>(
        `SELECT e.id::text AS emp, t.id::text AS type_id FROM employees e CROSS JOIN staff_leave_types t ${where}
          ORDER BY e.display_name, e.employee_code, t.sort_order, t.code LIMIT $5 OFFSET $6`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const rows = [];
      for (const p of pairs.rows) {
        const b = (
          await c.query<{
            id: string;
            opening: string;
            credited: string;
            held: string;
            correction: string;
            closing: string | null;
            lapsed: string;
            closed: boolean;
            trail: string[];
          }>(
            // this month is read as it would open (nothing is written by looking); an earlier month as it was
            current
              ? `SELECT COALESCE(id::text, 'new-' || $1 || '-' || $2) AS id, opening::text, credited::text, held::text, correction::text,
                        closing::text, lapsed::text, closed, trail
                   FROM app.staff_leave_balance_peek($1, $2, $3::date)`
              : `SELECT id::text, opening::text, credited::text, held::text, correction::text, closing::text, lapsed::text, closed, trail
                   FROM staff_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND month = $3::date`,
            [p.emp, p.type_id, month],
          )
        ).rows[0];
        if (!b) continue;
        const who = (
          await c.query<{
            name: string;
            code: string;
            department: string | null;
            type: string;
            type_name: string;
            policy: string | null;
          }>(
            `SELECT e.display_name AS name, e.employee_code AS code, e.department, t.code AS type, t.name AS type_name,
                    (SELECT x.name FROM staff_leave_policies x WHERE x.leave_type_id = t.id AND x.status = 'active'
                       AND app.staff_in_scope(x.scope, x.scope_values, e.id) ORDER BY x.priority, x.id LIMIT 1) AS policy
               FROM employees e, staff_leave_types t WHERE e.id = $1 AND t.id = $2`,
            [p.emp, p.type_id],
          )
        ).rows[0]!;
        const o = Number(b.opening);
        const cr = Number(b.credited);
        const h = Number(b.held);
        const co = Number(b.correction);
        rows.push({
          id: b.id,
          employee: { id: p.emp, name: who.name, code: who.code, department: who.department },
          leaveType: { id: p.type_id, code: who.type, name: who.type_name },
          policy: who.policy,
          month,
          opening: o,
          credited: cr,
          held: h,
          correction: co,
          available: round2(o + cr + co - h),
          closing: b.closing === null ? null : Number(b.closing),
          lapsed: Number(b.lapsed),
          closed: b.closed,
          trail: b.trail,
        });
      }
      const lists = await c.query<{ kind: string; id: string; name: string }>(
        `SELECT 'type' AS kind, id::text, code || ' · ' || name AS name FROM staff_leave_types
          WHERE status = 'active' AND keeps_balance AND NOT loss_of_pay
         UNION ALL SELECT 'employee', id::text, display_name || ' (' || employee_code || ')' FROM employees
                    WHERE deleted_at IS NULL AND status = 'active'
         UNION ALL SELECT DISTINCT 'department', department, department FROM employees
                    WHERE deleted_at IS NULL AND COALESCE(department, '') <> ''
         ORDER BY 1, 3`,
      );
      return {
        month,
        monthWords: monthWords(month),
        current,
        rows,
        total,
        page: q.page,
        size: q.size,
        lists: {
          types: lists.rows.filter((x) => x.kind === 'type').map(({ id, name }) => ({ id, name })),
          employees: lists.rows
            .filter((x) => x.kind === 'employee')
            .map(({ id, name }) => ({ id, name })),
          departments: lists.rows.filter((x) => x.kind === 'department').map((x) => x.name),
        },
      };
    });
  }

  /** A correction of this month's balance (days added, or taken off with a minus), with the reason. */
  async adjust(ctx: RequestContext, dto: AdjustDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await c.query<{ code: string; ok: boolean }>(
        `SELECT code, keeps_balance AND NOT loss_of_pay AS ok FROM staff_leave_types WHERE id = $1 AND status = 'active'`,
        [dto.leaveTypeId],
      );
      if (!t.rows[0]?.ok)
        throw new DomainError('validation-failed', 'Pick a leave type that keeps a balance', {
          status: 400,
        });
      const today = istToday();
      const month = monthStart(today);
      const row = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM app.staff_leave_balance_row($1, $2, $3::date)`,
          [dto.employeeId, dto.leaveTypeId, month],
        )
      ).rows[0]!;
      const who = (
        await c.query<{ name: string }>(
          `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
        )
      ).rows[0]?.name;
      await c.query(
        `UPDATE staff_leave_balances SET correction = correction + $2, updated_at = now(), trail = trail || $3::text WHERE id = $1`,
        [
          row.id,
          dto.days,
          `${dmy(today)} correction ${dto.days > 0 ? '+' : ''}${String(dto.days)} by ${who ?? 'the office'} — ${dto.reason}`,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'leave.balance.adjust',
        entityType: 'staff_leave_balances',
        entityId: row.id,
        after: {
          employeeId: dto.employeeId,
          type: t.rows[0].code,
          days: dto.days,
          reason: dto.reason,
        },
      });
      return { id: row.id };
    });
  }

  /** The Excel to fill opening balances: every active employee and leave type with a balance, a row each. */
  async balanceFormat(ctx: RequestContext) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pairs = await c.query<{ code: string; name: string; type: string }>(
        `SELECT e.employee_code AS code, e.display_name AS name, t.code AS type
           FROM employees e CROSS JOIN staff_leave_types t
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.employee_code IS NOT NULL
            AND t.status = 'active' AND t.keeps_balance AND NOT t.loss_of_pay
          ORDER BY e.display_name, t.sort_order LIMIT 20000`,
      );
      const types = await c.query<{ code: string }>(
        `SELECT code FROM staff_leave_types WHERE status = 'active' AND keeps_balance AND NOT loss_of_pay ORDER BY sort_order`,
      );
      const bytes = await templateSheet({
        sheet: 'Opening balances',
        hideLists: true,
        columns: [
          { header: 'Employee code', width: 14, required: true, format: 'text' },
          { header: 'Employee', width: 28, note: 'For reading only (the code is read)' },
          {
            header: 'Leave code',
            width: 11,
            required: true,
            options: types.rows.map((t) => t.code),
          },
          {
            header: 'Balance',
            width: 10,
            required: true,
            format: 'number',
            check: true,
            note: 'The balance the employee has now: it becomes this month’s balance',
          },
          { header: 'Reason', width: 30, note: 'Empty: Opening balance' },
        ],
        guide: [
          'One row per employee and leave type. The balance you type becomes the balance this month (what is held by leave waiting or approved this month is kept).',
          'Leave a row empty to leave that balance as it is. 0 sets it to nothing.',
          'Upload it and press Check: every row is checked first; then save.',
          'Run it again with the same file: nothing changes the second time.',
        ],
        rows: pairs.rows.map((p) => [p.code, p.name, p.type, null, null]),
        examples: [['E104', 'Teacher name', 'CL', 6, 'Opening balance from the old register']],
      });
      return {
        filename: 'leave-opening-balances.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /** Opening balances from Excel: the figure becomes this month's balance (a correction makes up the difference). */
  async balanceImport(ctx: RequestContext, dto: BalanceImportDto) {
    this.mustOffice(ctx);
    const rows = await readSheet(dto.file, ['Employee code', 'Leave code', 'Balance'], ['Reason']);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = istToday();
      const month = monthStart(today);
      const emps = new Map(
        (
          await c.query<{ id: string; code: string; name: string }>(
            `SELECT id::text, upper(employee_code) AS code, display_name AS name FROM employees
              WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL`,
          )
        ).rows.map((r) => [r.code, r]),
      );
      const types = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, upper(code) AS code FROM staff_leave_types WHERE status = 'active' AND keeps_balance AND NOT loss_of_pay`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      const seen = new Set<string>();
      const results: Array<{
        row: number;
        employee: string;
        type: string;
        balance: number | null;
        now: number | null;
        ok: boolean;
        error?: string;
      }> = [];
      const good: Array<{ emp: string; type: string; target: number; reason: string; at: number }> =
        [];
      for (const { row, cells } of rows) {
        const code = (cells['Employee code'] ?? '').trim().toUpperCase();
        const typeCode = (cells['Leave code'] ?? '').trim().toUpperCase();
        const raw = (cells['Balance'] ?? '').trim();
        if (!raw) continue;
        const e = emps.get(code);
        const typeId = types.get(typeCode);
        const target = Number(raw);
        const problems: string[] = [];
        if (!e) problems.push(`no active employee has the code ${code || '(empty)'}`);
        if (!typeId) problems.push(`${typeCode || '(empty)'} is not a leave type with a balance`);
        if (!Number.isFinite(target) || target < 0 || target > 9999)
          problems.push('the balance is a number of 0 or more');
        const key = `${code}|${typeCode}`;
        if (seen.has(key)) problems.push('the same employee and leave type again');
        seen.add(key);
        let now: number | null = null;
        if (e && typeId) {
          const b = (
            await c.query<{ v: string }>(
              `SELECT (opening + credited + correction - held)::text AS v FROM app.staff_leave_balance_peek($1, $2, $3::date)`,
              [e.id, typeId, month],
            )
          ).rows[0]!;
          now = Number(b.v);
        }
        if (problems.length) {
          results.push({
            row,
            employee: e?.name ?? code,
            type: typeCode,
            balance: null,
            now,
            ok: false,
            error: problems.join('; '),
          });
          continue;
        }
        results.push({
          row,
          employee: `${e!.name} (${code})`,
          type: typeCode,
          balance: target,
          now,
          ok: true,
        });
        good.push({
          emp: e!.id,
          type: typeId!,
          target,
          reason: (cells['Reason'] ?? '').trim().slice(0, 200) || 'Opening balance',
          at: results.length - 1,
        });
      }
      if (dto.dryRun) return { rows: results, saved: 0 };
      let saved = 0;
      for (const g of good) {
        const b = (
          await c.query<{ id: string; v: string }>(
            `SELECT id::text, (opening + credited + correction - held)::text AS v
               FROM app.staff_leave_balance_row($1, $2, $3::date)`,
            [g.emp, g.type, month],
          )
        ).rows[0]!;
        const diff = round2(g.target - Number(b.v));
        if (diff === 0) continue;
        await c.query(
          `UPDATE staff_leave_balances SET correction = correction + $2, updated_at = now(), trail = trail || $3::text WHERE id = $1`,
          [
            b.id,
            diff,
            `${dmy(today)} set to ${String(g.target)} (${diff > 0 ? '+' : ''}${String(diff)}) — ${g.reason}`,
          ],
        );
        saved += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'leave.balance.import',
        entityType: 'staff_leave_balances',
        entityId: '0',
        after: { rows: good.length, changed: saved },
      });
      return { rows: results, saved };
    });
  }

  /** Close the months before this one, open this month and credit it now (the nightly job does the same). */
  async runMonth(ctx: RequestContext) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ n: number }>(`SELECT app.staff_leave_month_end() AS n`);
      await this.audit.stage(ctx, c, {
        action: 'leave.balance.month_end',
        entityType: 'staff_leave_balances',
        entityId: '0',
        after: { rows: r.rows[0]!.n },
      });
      return { rows: r.rows[0]!.n };
    });
  }
}
