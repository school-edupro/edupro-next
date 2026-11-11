/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { checkListSize, LIST_LIMIT } from '../purchase/purchase-list-file';
import { istToday } from '../purchase/purchase-stock-core';
import { dmy, fail, monthStart, monthWords, round2 } from './leave-engine';
import { leaveReportFile, preparedChecked } from './leave-report-file';
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
const BUCKET_WORDS: Record<string, string> = {
  pending: 'Pending',
  l1: 'L1 Approved',
  l2: 'L2 Approved',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  withdrawn: 'Withdrawn',
  lop: 'LWP',
};
/** "CODE — Name" of a user (with their employee code when they are staff) */
const PERSON = (col: string) =>
  `(SELECT COALESCE((SELECT x.employee_code FROM employees x WHERE x.user_id = u.id AND x.deleted_at IS NULL LIMIT 1) || ' — ', '') || u.display_name
      FROM users u WHERE u.id = ${col})`;
/** the open instance: the cancellation while one is asked, else the leave's */
const OPEN = `COALESCE(CASE WHEN r.cancel_status = 'pending' THEN r.cancel_instance_id END, r.workflow_instance_id)`;
/** what the register adds to a leave row: who decided, who entered it, the last step acted, the current approvers */
const REG_EXTRA = `, ${PERSON('r.decided_by')} AS decided_person, ${PERSON('r.applied_by')} AS applied_person,
       ${PERSON('r.cancel_raised_by')} AS cancel_person,
       (SELECT jsonb_build_object('level', s.level, 'status', s.status, 'person', ${PERSON('s.acted_by')}, 'at', s.acted_at)
          FROM workflow_steps s WHERE s.instance_id = r.workflow_instance_id AND s.acted_at IS NOT NULL AND s.status IN ('approved', 'rejected')
         ORDER BY s.acted_at DESC, s.level DESC LIMIT 1) AS last_step,
       (SELECT i.current_level FROM workflow_instances i WHERE i.id = ${OPEN} AND i.status = 'pending') AS approver_level,
       (SELECT string_agg(${PERSON('a.uid')}, ', ')
          FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id CROSS JOIN LATERAL unnest(s.assignee_user_ids) AS a(uid)
         WHERE i.id = ${OPEN} AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending') AS approvers`;
type RegDb = ReqRow & {
  decided_person: string | null;
  applied_person: string | null;
  cancel_person: string | null;
  last_step: { level: number; status: string; person: string | null; at: string } | null;
  approver_level: number | null;
  approvers: string | null;
};
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** dd-mm-yyyy hh:mm, India time */
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
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
    .replace(',', '');

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

  /** The register's rows with what the old screen showed of each (docs/design/85, "the register and balances as the old screens"). */
  private async regRows(
    c: PoolClient,
    where: string,
    args: unknown[],
    order: string,
    limit: string,
  ) {
    return (
      await c.query<RegDb>(
        `${REQ.replace('FROM staff_leave_requests r', `${REG_EXTRA} FROM staff_leave_requests r`)} ${where} ${order} ${limit}`,
        args,
      )
    ).rows.map((r) => this.regShape(r));
  }

  /**
   * One row as the old Approve / Reject Leave screen: the stage (Pending, L1 / L2 Approved, LWP…), the
   * final status, the last action (who, when), the current approver, and what the office may do from it —
   * only while a leave waits (Approve / Reject over every approver), Edit dates and Cancel once approved.
   */
  private regShape(r: RegDb) {
    const step = r.last_step;
    const office = r.decision_note?.startsWith('Decided by the leave office') ?? false;
    const at = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
    const last: { words: string; by: string | null; at: string | null } =
      r.cancel_status === 'pending'
        ? { words: 'Cancellation asked', by: r.cancel_person, at: at(r.cancel_raised_at) }
        : r.status === 'pending'
          ? step
            ? { words: `L${String(step.level)} Approved`, by: step.person, at: at(step.at) }
            : { words: 'L1 Pending', by: null, at: null }
          : r.status === 'approved'
            ? r.source === 'on_behalf'
              ? {
                  words: 'Applied & approved on behalf',
                  by: r.applied_person,
                  at: at(r.created_at),
                }
              : r.source.startsWith('auto')
                ? {
                    words: 'Deducted by the system',
                    by: null,
                    at: at(r.decided_at ?? r.created_at),
                  }
                : r.source === 'import'
                  ? { words: 'Brought from the old module', by: null, at: at(r.created_at) }
                  : office
                    ? {
                        words: 'Approved by the leave office',
                        by: r.decided_person,
                        at: at(r.decided_at),
                      }
                    : step
                      ? {
                          words: `L${String(step.level)} Approved`,
                          by: step.person,
                          at: at(step.at),
                        }
                      : { words: 'Approved', by: r.decided_person, at: at(r.decided_at) }
            : r.status === 'rejected'
              ? office
                ? {
                    words: 'Rejected by the leave office',
                    by: r.decided_person,
                    at: at(r.decided_at),
                  }
                : step && step.status === 'rejected'
                  ? { words: `L${String(step.level)} Rejected`, by: step.person, at: at(step.at) }
                  : { words: 'Rejected', by: r.decided_person, at: at(r.decided_at) }
              : {
                  words: STATUS_WORDS[r.status] ?? r.status,
                  by: r.decided_person,
                  at: at(r.decided_at),
                };
    const done = (r.level ?? 1) - 1;
    const stage = r.loss_of_pay
      ? 'LWP'
      : r.status === 'pending'
        ? done <= 0
          ? 'Pending'
          : `L${String(done)} Approved`
        : r.status === 'approved'
          ? step?.status === 'approved' && !office
            ? `L${String(step.level)} Approved`
            : 'Approved'
          : (STATUS_WORDS[r.status] ?? r.status);
    const waiting = r.approver_level !== null;
    return {
      ...this.leave.shape(r),
      stage,
      appliedPerson: r.applied_person,
      lastAction: last,
      approver: waiting
        ? {
            head: `${r.cancel_status === 'pending' ? 'CANCELLATION · ' : ''}LEVEL ${String(r.approver_level)} PENDING`,
            people: r.approvers,
          }
        : { head: (STATUS_WORDS[r.status] ?? r.status).toUpperCase(), people: last.by },
      can: {
        override: r.status === 'pending' && !!r.workflow_instance_id,
        trim:
          r.status === 'approved' &&
          !r.linked_request_id &&
          !r.lop_part_id &&
          Number(r.days) > 1 &&
          r.cancel_status !== 'pending',
        cancel: r.status === 'approved' && !r.linked_request_id && r.cancel_status !== 'pending',
      },
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
      const rows = await this.regRows(
        c,
        f.where,
        [...f.args, q.size, (q.page - 1) * q.size],
        'ORDER BY r.created_at DESC, r.id DESC',
        'LIMIT $8 OFFSET $9',
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
        figures: {
          ...fig,
          fy: `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`,
          fyFrom,
          fyTo,
        },
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

  /** The register as filtered (every page), the old screen's columns, on the letterhead: Excel or PDF. */
  async registerFile(ctx: RequestContext, q: RegisterQueryDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = this.filter(q);
      const rows = await this.regRows(
        c,
        f.where,
        [...f.args, LIST_LIMIT],
        'ORDER BY r.created_at DESC, r.id DESC',
        'LIMIT $8',
      );
      checkListSize(rows.length, 'leave requests');
      // each leave's levels: who decided (or waits), how and when — the earlier register's L1–L3
      const steps = await c.query<{ id: string; levels: string[] }>(
        `SELECT r.id::text,
                array_agg(s.name || ': ' || CASE s.status
                    WHEN 'approved' THEN 'approved by ' || COALESCE((SELECT u.display_name FROM users u WHERE u.id = s.acted_by), '—')
                         || ' on ' || to_char(s.acted_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY')
                    WHEN 'rejected' THEN 'not approved by ' || COALESCE((SELECT u.display_name FROM users u WHERE u.id = s.acted_by), '—')
                         || ' on ' || to_char(s.acted_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY')
                    WHEN 'pending' THEN 'waiting with ' || COALESCE((SELECT string_agg(u.display_name, ', ') FROM users u WHERE u.id = ANY(s.assignee_user_ids)), 'nobody')
                    ELSE 'passed on' END ORDER BY s.level) AS levels
           FROM staff_leave_requests r JOIN workflow_steps s ON s.instance_id = r.workflow_instance_id
          WHERE r.id = ANY($1::bigint[]) GROUP BY r.id`,
        [rows.map((r) => r.id)],
      );
      const levelsOf = new Map(steps.rows.map((x) => [x.id, x.levels]));
      const words = [
        q.from || q.to ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}` : 'All dates',
        q.bucket ? `Only: ${BUCKET_WORDS[q.bucket]}` : null,
        q.department ? `Department: ${q.department}` : null,
        q.source
          ? `Applied: ${q.source === 'system' ? 'by the system' : q.source === 'self' ? 'by the employee' : 'on behalf'}`
          : null,
        q.q ? `Search: ${q.q}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const when = (iso: string | null) => (iso ? dateTime(iso) : '');
      return leaveReportFile({
        format: q.format ?? 'xlsx',
        head: await purchaseHead(c, this.storage),
        name: 'Approve / Reject Leave',
        slug: 'Leave-register',
        words,
        table: {
          columns: [
            { label: 'S. no.', type: 'number', width: 0.6 },
            { label: 'Leave ID', width: 2 },
            { label: 'Employee', width: 2.4 },
            { label: 'Emp. code', width: 1.2 },
            { label: 'On behalf by', width: 2 },
            { label: 'Leave type', width: 1.8 },
            { label: 'Applied date', width: 1.5 },
            { label: 'From date', type: 'date', width: 1.1 },
            { label: 'To date', type: 'date', width: 1.1 },
            { label: 'Total days', type: 'number', width: 0.8 },
            { label: 'Status', width: 1.2 },
            { label: 'Final status', width: 1.1 },
            { label: 'Reason', width: 3 },
            { label: 'Last action', width: 2 },
            { label: 'Last action by', width: 2 },
            { label: 'Last action date', width: 1.5 },
            { label: 'Current approver', width: 2.4 },
            { label: 'Level 1', width: 3 },
            { label: 'Level 2', width: 3 },
            { label: 'Level 3', width: 3 },
          ],
          rows: rows.map((r, i) => [
            i + 1,
            r.number,
            r.employee.name,
            r.employee.code,
            r.source === 'on_behalf' ? (r.appliedPerson ?? '') : '',
            `${r.leaveType.code} — ${r.leaveType.name}`,
            when(r.appliedAt),
            r.from,
            r.to,
            r.days,
            r.stage,
            STATUS_WORDS[r.status] ?? r.status,
            r.reason,
            r.lastAction.words,
            r.lastAction.by ?? '',
            when(r.lastAction.at),
            [r.approver.head, r.approver.people].filter(Boolean).join(' · '),
            ...[0, 1, 2].map((k) => levelsOf.get(r.id)?.[k] ?? ''),
          ]),
          // the PDF leaves out the code (with the name), who entered it and the levels (Excel has them)
          pdfColumns: [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          paper: { a3: true, fontSize: 7 },
        },
        signs: await preparedChecked(c, (k) => this.storage.read(k)),
      });
    });
  }

  // ---- balances ------------------------------------------------------------------------------------
  /**
   * The balance ledger as the old Employee Leave Balance: one row per employee × leave type × month, every
   * month newest first (or the month asked). This month is read as it would open (nothing is written by
   * looking) and is the one that may be corrected; earlier months are as they were stored.
   */
  async balances(ctx: RequestContext, q: BalanceQueryDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = monthStart(istToday());
      const month = q.month ? `${q.month}-01` : null;
      const withCurrent = month === null || month === cur;
      const withStored = month === null || month < cur;
      const people = `e.deleted_at IS NULL AND e.status = 'active' AND t.status = 'active' AND t.keeps_balance AND NOT t.loss_of_pay
          AND ($1::bigint IS NULL OR e.id = $1) AND ($2::bigint IS NULL OR t.id = $2)
          AND ($3::text IS NULL OR lower(e.department) = lower($3))
          AND ($4::text IS NULL OR e.display_name ILIKE '%' || $4 || '%' OR e.employee_code ILIKE '%' || $4 || '%')`;
      const args = [q.employeeId ?? null, q.leaveTypeId ?? null, q.department ?? null, q.q ?? null];
      const stored = `FROM staff_leave_balances b JOIN employees e ON e.id = b.employee_id JOIN staff_leave_types t ON t.id = b.leave_type_id
          WHERE ${people} AND b.month < $5::date AND ($6::date IS NULL OR b.month = $6::date)`;
      const nCur = withCurrent
        ? (
            await c.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM employees e CROSS JOIN staff_leave_types t WHERE ${people}`,
              args,
            )
          ).rows[0]!.n
        : 0;
      const nStored = withStored
        ? (
            await c.query<{ n: number }>(`SELECT count(*)::int AS n ${stored}`, [
              ...args,
              cur,
              month,
            ])
          ).rows[0]!.n
        : 0;
      const total = nCur + nStored;
      const file = !!q.format;
      if (file && total > 20000)
        fail('More than 20,000 balance rows: pick a month, a leave type or a department');
      const off = file ? 0 : (q.page - 1) * q.size;
      const want = file ? total : q.size;
      const who = `e.id::text AS emp, e.display_name AS name, e.employee_code AS code, e.department, e.designation,
              t.id::text AS type_id, t.code AS type, t.name AS type_name,
              (SELECT x.name FROM staff_leave_policies x WHERE x.leave_type_id = t.id AND x.status = 'active'
                 AND app.staff_in_scope(x.scope, x.scope_values, e.id) ORDER BY x.priority, x.id LIMIT 1) AS policy`;
      type Who = {
        emp: string;
        name: string;
        code: string;
        department: string | null;
        designation: string | null;
        type_id: string;
        type: string;
        type_name: string;
        policy: string | null;
      };
      type Bal = {
        id: string;
        opening: string;
        credited: string;
        held: string;
        correction: string;
        closing: string | null;
        lapsed: string;
        closed: boolean;
        trail: string[];
      };
      const shape = (w: Who, b: Bal, m: string) => {
        const o = Number(b.opening);
        const cr = Number(b.credited);
        const h = Number(b.held);
        const co = Number(b.correction);
        return {
          id: b.id,
          employee: {
            id: w.emp,
            name: w.name,
            code: w.code,
            department: w.department,
            designation: w.designation,
          },
          leaveType: { id: w.type_id, code: w.type, name: w.type_name },
          policy: w.policy,
          month: m,
          opening: o,
          credited: cr,
          held: h,
          correction: co,
          available: round2(o + cr + co - h),
          closing: b.closing === null ? null : Number(b.closing),
          lapsed: Number(b.lapsed),
          closed: b.closed,
          trail: b.trail,
          /** this month: the one a correction goes to */
          current: m === cur,
        };
      };
      const rows: Array<ReturnType<typeof shape>> = [];
      // this month first: each employee and type as it would open
      if (withCurrent && off < nCur) {
        const pairs = await c.query<Who>(
          `SELECT ${who} FROM employees e CROSS JOIN staff_leave_types t WHERE ${people}
            ORDER BY e.display_name, e.employee_code, t.sort_order, t.code LIMIT $5 OFFSET $6`,
          [...args, Math.min(want, nCur - off), off],
        );
        for (const p of pairs.rows) {
          const b = (
            await c.query<Bal>(
              `SELECT COALESCE(id::text, 'new-' || $1 || '-' || $2) AS id, opening::text, credited::text, held::text, correction::text,
                      closing::text, lapsed::text, closed, trail
                 FROM app.staff_leave_balance_peek($1, $2, $3::date)`,
              [p.emp, p.type_id, cur],
            )
          ).rows[0];
          if (b) rows.push(shape(p, b, cur));
        }
      }
      // then the months before, newest first, as they were stored
      const left = want - rows.length;
      if (withStored && left > 0) {
        const got = await c.query<Who & Bal & { month: string }>(
          `SELECT ${who}, b.id::text, b.month::text, b.opening::text, b.credited::text, b.held::text, b.correction::text,
                  b.closing::text, b.lapsed::text, b.closed, b.trail
             ${stored}
            ORDER BY b.month DESC, e.display_name, e.employee_code, t.sort_order, t.code LIMIT $7 OFFSET $8`,
          [...args, cur, month, left, Math.max(0, off - nCur)],
        );
        for (const r of got.rows) rows.push(shape(r, r, r.month));
      }
      if (q.format)
        return leaveReportFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          name: 'Employee Leave Balance',
          slug: 'Leave-balances',
          words: [
            month ? monthWords(month) : 'Every month',
            q.department ? `Department: ${q.department}` : null,
            q.q ? `Search: ${q.q}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          table: {
            columns: [
              { label: 'Sr. no.', type: 'number', width: 0.6 },
              { label: 'Emp Id', width: 1.2 },
              { label: 'Emp name', width: 2.4 },
              { label: 'Designation', width: 1.8 },
              { label: 'Department', width: 1.8 },
              { label: 'Leave type', width: 2 },
              { label: 'Month', width: 1.1 },
              { label: 'Year', type: 'number', width: 0.7 },
              { label: 'Open bal', type: 'number', width: 0.9 },
              { label: 'Accrued', type: 'number', width: 0.9 },
              { label: 'Availed', type: 'number', width: 0.9 },
              { label: 'Correction', type: 'number', width: 0.9 },
              { label: 'Close bal', type: 'number', width: 0.9 },
              { label: 'Lapsed', type: 'number', width: 0.9 },
              { label: 'Total bal', type: 'number', width: 0.9 },
              { label: 'Status', width: 0.8 },
              { label: 'Policy', width: 2 },
            ],
            rows: rows.map((r, i) => [
              i + 1,
              r.employee.code,
              r.employee.name,
              r.employee.designation,
              r.employee.department,
              `${r.leaveType.code} — ${r.leaveType.name}`,
              MONTH_NAMES[Number(r.month.slice(5, 7)) - 1]!,
              Number(r.month.slice(0, 4)),
              r.opening,
              r.credited,
              r.held,
              r.correction,
              r.closing,
              r.lapsed,
              r.available,
              r.closed ? 'Closed' : 'Open',
              r.policy,
            ]),
            pdfColumns: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            paper: { fontSize: 7 },
          },
          signs: await preparedChecked(c, (k) => this.storage.read(k)),
        });
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
        current: cur,
        monthWords: month ? monthWords(month) : 'Every month',
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
