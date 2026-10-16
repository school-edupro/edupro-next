import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { FeeAdjustmentsService } from '../fees/fee-adjustments.service';
import { startFeeApproval } from '../fees/fee-approval';
import type { ClearanceDto, BypassDto } from '../people/lifecycle/lifecycle.dto';
import {
  WithdrawalsService,
  approverName,
  type WithdrawalApprover,
} from '../people/lifecycle/withdrawals.service';
import { WorkflowService } from '../workflow/workflow.service';
import { raiseHostelCharge } from './hostel-charge';
import {
  HOSTEL_WD,
  type ListHostelWithdrawalsDto,
  type StartHostelWithdrawalDto,
} from './hostel-withdrawal.dto';
import { HostelService } from './hostel.service';

type Status = 'requested' | 'cleared' | 'completed' | 'cancelled';

export interface HostelClearanceRow {
  id: string;
  department: string;
  departmentName: string;
  step: number;
  status: 'pending' | 'cleared' | 'hold';
  dues: string;
  charge: string;
  chargeMiscFeeId: string | null;
  chargeKind: 'damage' | 'mess' | null;
  remarks: string | null;
  bypassed: boolean;
  auto: boolean;
  check: { kind: string; due: number; detail: string } | null;
  documents: Array<{ fileId: string; name: string | null }>;
  approvers: string[];
  bypassAllowed: boolean;
  documentRequired: boolean;
  /** the Accounts settlement step chooses carry-forward or refund */
  settles: boolean;
  actedBy: string | null;
  actedAt: string | null;
  canAct?: boolean;
}

export interface HostelWithdrawalRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  hostelId: string;
  hostelName: string;
  place: string;
  requestedOn: string;
  leavingOn: string;
  reason: string;
  remarks: string | null;
  documents: Array<{ fileId: string; name: string | null }>;
  status: Status;
  currentStep: number | null;
  feeChoice: 'carry' | 'refund';
  noticeDays: number | null;
  noticeShort: boolean;
  feeUntil: string | null;
  feeNote: string | null;
  requestedBy: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  clearances: HostelClearanceRow[];
  canComplete?: boolean;
}

interface Db extends Omit<HostelWithdrawalRow, 'clearances' | 'completedAt'> {
  yearId: string;
  completedAt: Date | null;
  clearances: Array<Omit<HostelClearanceRow, 'approvers'> & { approverList: WithdrawalApprover[] }>;
}

interface Actor {
  userId: string;
  roleIds: Set<string>;
  hostels: Set<string>;
  /** "School office": the withdrawal manage right with the hostel office rights (set-up or allotment) */
  manage: boolean;
  /** the hostels a warden without the office rights works in; null = all */
  only: string[] | null;
}

const SELECT = `SELECT w.id::text, w.student_id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo",
        sec.label AS section, h.id::text AS "hostelId", h.name AS "hostelName", rm.room_no || '-' || b.label AS place,
        w.requested_on::text AS "requestedOn", w.leaving_on::text AS "leavingOn", w.reason, w.remarks, w.documents, w.status,
        w.current_step AS "currentStep", w.fee_choice AS "feeChoice", w.notice_days AS "noticeDays", w.notice_short AS "noticeShort",
        w.fee_until::text AS "feeUntil", w.fee_note AS "feeNote", w.academic_year_id::text AS "yearId",
        u.display_name AS "requestedBy", w.completed_at AS "completedAt", w.cancel_reason AS "cancelReason",
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', x.id::text, 'department', x.department, 'departmentName', COALESCE(d.name, initcap(x.department)), 'step', x.step,
                    'status', x.status, 'dues', x.dues::text, 'charge', x.charge::text, 'chargeMiscFeeId', x.charge_misc_fee_id::text,
                    'chargeKind', d.charge_kind, 'remarks', x.remarks, 'bypassed', x.bypassed, 'auto', x.auto, 'check', x.check_result,
                    'documents', x.documents, 'approverList', COALESCE(d.approvers, '[{"kind":"office"}]'::jsonb),
                    'bypassAllowed', COALESCE(d.bypass_allowed, false), 'documentRequired', COALESCE(d.document_required, false),
                    'autoCheck', COALESCE(d.auto_check, 'none'), 'autoClear', COALESCE(d.auto_clear, false),
                    'settles', x.step = (SELECT max(step) FROM hostel_withdrawal_clearances WHERE withdrawal_id = w.id),
                    'actedBy', (SELECT display_name FROM users WHERE id = x.acted_by), 'actedAt', x.acted_at)
                    ORDER BY x.step, COALESCE(d.sort_order, 0), x.id)
                    FROM hostel_withdrawal_clearances x LEFT JOIN withdrawal_departments d ON d.id = x.department_id
                   WHERE x.withdrawal_id = w.id), '[]'::jsonb) AS clearances
   FROM hostel_withdrawals w JOIN students s ON s.id = w.student_id
   JOIN hostel_allotments a ON a.id = w.allotment_id JOIN hostel_beds b ON b.id = a.bed_id
   JOIN hostel_rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
   LEFT JOIN users u ON u.id = w.requested_by
   LEFT JOIN LATERAL (SELECT c.code || '-' || cs.name AS label FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                        JOIN classes c ON c.id = cs.class_id
                       WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC, e.id DESC LIMIT 1) sec ON true`;

const REASON: Record<string, string> = {
  parent_request: "Parent's request",
  discipline: 'Discipline',
  health: 'Health',
  other: 'Other',
};
const STATUS: Record<Status, string> = {
  requested: 'In clearance',
  cleared: 'Cleared',
  completed: 'Left the hostel',
  cancelled: 'Cancelled',
};
const dmy = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('-') : '');
const monthOf = (d: string) => `${d.slice(0, 7)}-01`;
const nextMonth = (d: string) => {
  const [y, m] = d.slice(0, 7).split('-').map(Number) as [number, number];
  return m === 12 ? `${String(y + 1)}-01-01` : `${String(y)}-${String(m + 1).padStart(2, '0')}-01`;
};
const monthLabel = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Hostel withdrawal (docs/design/27-hostel-withdrawal.md): a pupil leaves the hostel and stays in
 * school. The hostel office or a warden starts it with the leaving date; the hostel's departments clear
 * it in steps (the same engine and settings page as the school withdrawal: approvers, automatic hostel fee
 * check, bypass, documents), the warden's damages and the mess dues become misc fees on the pupil, and
 * the last step (Accounts) chooses carry-forward or refund. Completion vacates the bed on the leaving
 * date; the hostel fee runs to the leaving month (one more when the notice was short and the school
 * charges it); paid hostel months after that are carried to the next unpaid fee or refunded through the
 * fee approval levels; the parent is told.
 */
@Injectable()
export class HostelWithdrawalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hostel: HostelService,
    private readonly withdrawals: WithdrawalsService,
    private readonly adjustments: FeeAdjustmentsService,
    private readonly workflow: WorkflowService,
  ) {}

  // ---- settings ------------------------------------------------------------------------------------
  private async setting(c: PoolClient) {
    const r = await c.query<{ days: string | null; charge: string | null }>(
      `SELECT app.setting('hostel.withdrawal_notice_days') #>> '{}' AS days,
              app.setting('hostel.withdrawal_notice_charge') #>> '{}' AS charge`,
    );
    return {
      noticeDays:
        r.rows[0]?.days !== null && r.rows[0]?.days !== undefined ? Number(r.rows[0].days) : 30,
      noticeCharge: (r.rows[0]?.charge ?? 'true') !== 'false',
    };
  }

  async settings(ctx: RequestContext) {
    const [deps, s] = await Promise.all([
      this.withdrawals.departments(ctx, 'hostel'),
      this.db.tenant(requireTenant(ctx), (c) => this.setting(c)),
    ]);
    return { ...deps, ...s };
  }

  async saveSettings(ctx: RequestContext, dto: { noticeDays: number; noticeCharge: boolean }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.setting(c);
      for (const [key, value] of [
        ['hostel.withdrawal_notice_days', dto.noticeDays],
        ['hostel.withdrawal_notice_charge', dto.noticeCharge],
      ] as const) {
        // as SettingsService.set: close the open row, replace today's, insert the new value
        await c.query(
          `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
            WHERE key = $1 AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
          [key],
        );
        await c.query(`DELETE FROM school_settings WHERE key = $1 AND valid_from = CURRENT_DATE`, [
          key,
        ]);
        await c.query(
          `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
          [key, JSON.stringify(value)],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.settings',
        entityType: 'school_settings',
        entityId: 'hostel.withdrawal_notice',
        before,
        after: dto,
      });
      return this.setting(c);
    });
  }

  // ---- reading -------------------------------------------------------------------------------------
  private async actor(c: PoolClient, ctx: RequestContext): Promise<Actor> {
    const roles = await c.query<{ role_id: string }>(
      `SELECT role_id::text FROM user_roles WHERE user_id = app.current_user_id() AND revoked_at IS NULL
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
    );
    const hostels = await c.query<{ id: string }>(
      `SELECT hw.hostel_id::text AS id FROM hostel_wardens hw JOIN employees e ON e.id = hw.employee_id
        WHERE e.user_id = app.current_user_id()`,
    );
    const only = await this.hostel.scope(ctx, c);
    return {
      userId: ctx.user.id,
      roleIds: new Set(roles.rows.map((x) => x.role_id)),
      hostels: new Set(hostels.rows.map((x) => x.id)),
      manage: (ctx.permissions?.has(HOSTEL_WD.manage) ?? false) && only === null,
      only,
    };
  }

  /** A warden starts, completes and cancels only for a pupil of their own hostel. */
  private ownHostel(actor: Actor, hostelId: string) {
    if (actor.only && !actor.only.includes(hostelId))
      throw new DomainError('hostel.not_your_hostel', 'The pupil stays in another hostel', {
        status: 403,
      });
  }

  private named(a: WithdrawalApprover, actor: Actor, hostelId: string): boolean {
    if (a.kind === 'office') return actor.manage;
    if (a.kind === 'hostel_warden') return actor.hostels.has(hostelId);
    if (a.kind === 'role') return actor.roleIds.has(a.roleId);
    if (a.kind === 'user') return a.userId === actor.userId;
    return false;
  }

  private view(r: Db, actor: Actor | null): HostelWithdrawalRow {
    const open = r.status === 'requested' || r.status === 'cleared';
    const { yearId: _year, completedAt, ...rest } = r;
    void _year;
    return {
      ...rest,
      documents: r.documents ?? [],
      completedAt: completedAt ? completedAt.toISOString() : null,
      clearances: r.clearances.map(({ approverList, ...x }) => {
        const {
          autoCheck: _a,
          autoClear: _b,
          ...y
        } = x as typeof x & {
          autoCheck?: string;
          autoClear?: boolean;
        };
        void _a;
        void _b;
        return {
          ...y,
          approvers: approverList.map(approverName),
          canAct: actor
            ? open &&
              x.status !== 'cleared' &&
              x.step === r.currentStep &&
              (actor.manage || approverList.some((a) => this.named(a, actor, r.hostelId)))
            : undefined,
        };
      }),
      canComplete: actor
        ? r.status === 'cleared' && (actor.manage || (actor.only?.includes(r.hostelId) ?? false))
        : undefined,
    };
  }

  private async findDb(c: PoolClient, id: string, lock = false): Promise<Db | null> {
    const r = await c.query<Db>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      `${SELECT} WHERE w.id = $1${lock ? ' FOR UPDATE OF w' : ''}`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async list(ctx: RequestContext, q: ListHostelWithdrawalsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const params: unknown[] = [];
      const where: string[] = [];
      const add = (v: unknown) => {
        params.push(v);
        return `$${String(params.length)}`;
      };
      if (q.status === 'open' || q.mine) where.push(`w.status IN ('requested', 'cleared')`);
      else if (q.status !== 'all') where.push(`w.status = ${add(q.status)}`);
      // a warden without the office rights sees their own hostels (Accounts and the office see all)
      if (actor.only?.length) where.push(`h.id = ANY(${add(actor.only)}::bigint[])`);
      if (q.hostelId) where.push(`h.id = ${add(q.hostelId)}`);
      if (q.leavingFrom) where.push(`w.leaving_on >= ${add(q.leavingFrom)}::date`);
      if (q.leavingTo) where.push(`w.leaving_on <= ${add(q.leavingTo)}::date`);
      if (q.q) {
        const p = add(`%${q.q.toLowerCase()}%`);
        where.push(`(lower(s.display_name) LIKE ${p} OR lower(s.admission_no) LIKE ${p})`);
      }
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where joins fixed fragments; values are bound parameters
        `${SELECT} WHERE ${where.length ? where.join(' AND ') : 'true'} ORDER BY w.leaving_on DESC, w.id DESC LIMIT 2000`,
        params,
      );
      let rows = r.rows.map((x) => this.view(x, actor));
      if (q.mine) rows = rows.filter((w) => w.clearances.some((x) => x.canAct));
      return { rows: rows.slice((q.page - 1) * q.size, q.page * q.size), total: rows.length };
    });
  }

  async listFile(ctx: RequestContext, q: ListHostelWithdrawalsDto, format: 'xlsx' | 'pdf') {
    const { rows } = await this.list(ctx, { ...q, page: 1, size: 500 });
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const waiting = (w: HostelWithdrawalRow) =>
      w.clearances
        .filter((x) => x.status !== 'cleared' && x.step === w.currentStep)
        .map((x) => x.departmentName)
        .join(', ');
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Hostel withdrawal register',
        details: [
          [
            q.status === 'open' ? 'Open' : q.status === 'all' ? 'All' : STATUS[q.status as Status],
            q.leavingFrom ? `leaving from ${dmy(q.leavingFrom)}` : null,
            q.leavingTo ? `to ${dmy(q.leavingTo)}` : null,
            `${String(rows.length)} record(s)`,
          ]
            .filter(Boolean)
            .join(' · '),
          generatedOn(),
        ],
        legend: '',
        columns: [
          { label: 'Sr', width: 3, right: true },
          { label: 'Admission no.', width: 8 },
          { label: 'Pupil', width: 14 },
          { label: 'Class', width: 6 },
          { label: 'Hostel', width: 10 },
          { label: 'Room-bed', width: 6 },
          { label: 'Asked on', width: 7 },
          { label: 'Leaving on', width: 7 },
          { label: 'Reason', width: 9 },
          { label: 'Charges', width: 7, right: true },
          { label: 'Fee up to', width: 7 },
          { label: 'Waiting with', width: 12 },
          { label: 'Status', width: 8 },
        ],
        rows: rows.map((w, i) => [
          i + 1,
          w.admissionNo,
          w.studentName,
          w.section ?? '',
          w.hostelName,
          w.place,
          dmy(w.requestedOn),
          dmy(w.leavingOn),
          REASON[w.reason] ?? w.reason,
          w.clearances.reduce((n, x) => n + Number(x.charge), 0) || '',
          w.feeUntil ? monthLabel(w.feeUntil) : '',
          w.status === 'requested' ? waiting(w) : '',
          STATUS[w.status],
        ]),
        filename: 'hostel-withdrawal-register',
      },
      format,
    );
  }

  async get(ctx: RequestContext, id: string): Promise<HostelWithdrawalRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.findDb(c, id);
      if (!row) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
      return this.view(row, await this.actor(c, ctx));
    });
  }

  async forStudent(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = await c.query<Db>(`${SELECT} WHERE w.student_id = $1 ORDER BY w.id DESC`, [
        studentId,
      ]);
      return r.rows.map((x) => this.view(x, actor));
    });
  }

  // ---- starting --------------------------------------------------------------------------------------
  async start(
    ctx: RequestContext,
    studentId: string,
    dto: StartHostelWithdrawalDto,
  ): Promise<HostelWithdrawalRow> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const id = await this.db.tenant(tenant, async (c) => {
      const s = await c.query<{ name: string; status: string }>(
        `SELECT display_name AS name, status::text FROM students WHERE id = $1 AND deleted_at IS NULL`,
        [studentId],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Pupil not found', { status: 404 });
      if (s.rows[0].status !== 'active')
        throw new DomainError('withdrawal.student_inactive', 'The pupil is not active', {
          status: 409,
        });
      const stay = await c.query<{ id: string; from_date: string; hostel_id: string }>(
        `SELECT a.id::text, a.from_date::text, rm.hostel_id::text FROM hostel_allotments a
           JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms rm ON rm.id = b.room_id
          WHERE a.student_id = $1 AND a.to_date IS NULL`,
        [studentId],
      );
      const bed = stay.rows[0];
      if (!bed)
        throw new DomainError('hostel.not_allotted', `${s.rows[0].name} holds no hostel bed`, {
          status: 409,
        });
      if (dto.leavingOn < bed.from_date)
        throw new DomainError('hostel.before_stay', `The stay started on ${dmy(bed.from_date)}`, {
          status: 422,
        });
      // a warden without the office rights starts one only for a pupil of their hostel
      this.ownHostel(await this.actor(c, ctx), bed.hostel_id);
      const school = await c.query(
        `SELECT 1 FROM student_withdrawals WHERE student_id = $1 AND status IN ('requested', 'cleared')`,
        [studentId],
      );
      if (school.rowCount)
        throw new DomainError(
          'hostel.leaving_school',
          'The pupil is leaving the school: the hostel is cleared within that withdrawal',
          { status: 409 },
        );
      const departments = await this.withdrawals.departmentsIn(c, true, 'hostel');
      if (!departments.length)
        throw new DomainError(
          'withdrawal.no_departments',
          'Set up the hostel withdrawal steps first',
          { status: 409 },
        );
      const files = await this.checkFiles(c, dto.documents ?? []);
      const { noticeDays, noticeCharge } = await this.setting(c);
      const requestedOn =
        dto.requestedOn ?? new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      if (
        dto.leavingOn < requestedOn &&
        Date.parse(requestedOn) - Date.parse(dto.leavingOn) > 31 * 86400e3
      )
        throw new DomainError(
          'hostel.leaving_too_old',
          'The leaving date may be at most 31 days before the request',
          { status: 422 },
        );
      const days = Math.round((Date.parse(dto.leavingOn) - Date.parse(requestedOn)) / 86400e3);
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO hostel_withdrawals (school_id, student_id, academic_year_id, allotment_id, requested_on, leaving_on, reason, remarks, documents,
                                           current_step, notice_days, notice_short, requested_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb, $9, $10, $11, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            studentId,
            tenant.academicYearId,
            bed.id,
            requestedOn,
            dto.leavingOn,
            dto.reason,
            dto.remarks ?? null,
            JSON.stringify(files),
            Math.min(...departments.map((d) => d.step)),
            noticeDays,
            noticeCharge && days < noticeDays,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'withdrawal.open_exists',
            'The pupil already has an open hostel withdrawal',
            { status: 409 },
          );
        throw error;
      }
      for (const d of departments)
        await c.query(
          `INSERT INTO hostel_withdrawal_clearances (school_id, withdrawal_id, department, department_id, step) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
          [id, d.code, d.id, d.step],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.start',
        entityType: 'hostel_withdrawals',
        entityId: id,
        after: {
          studentId,
          requestedOn,
          leavingOn: dto.leavingOn,
          reason: dto.reason,
          noticeShort: noticeCharge && days < noticeDays,
          departments: departments.map((d) => `${String(d.step)}:${d.code}`),
        },
      });
      return id;
    });
    await this.runChecks(ctx, id);
    return this.get(ctx, id);
  }

  private async checkFiles(c: PoolClient, files: Array<{ fileId: string }>) {
    const out: Array<{ fileId: string; name: string | null }> = [];
    for (const f of files) {
      const r = await c.query<{ status: string; original_name: string | null }>(
        `SELECT status::text, original_name FROM files WHERE id = $1`,
        [f.fileId],
      );
      if (!r.rows[0])
        throw new DomainError('not-found', 'Attached file not found', { status: 404 });
      if (r.rows[0].status !== 'ready')
        throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
          status: 409,
        });
      out.push({ fileId: f.fileId, name: r.rows[0].original_name });
    }
    return out;
  }

  // ---- steps ---------------------------------------------------------------------------------------------
  private async advance(c: PoolClient, id: string) {
    await c.query(
      `UPDATE hostel_withdrawals w SET
          current_step = (SELECT min(step) FROM hostel_withdrawal_clearances WHERE withdrawal_id = w.id AND status <> 'cleared'),
          status = CASE WHEN EXISTS (SELECT 1 FROM hostel_withdrawal_clearances WHERE withdrawal_id = w.id AND status <> 'cleared')
                        THEN 'requested' ELSE 'cleared' END,
          updated_at = now()
        WHERE w.id = $1 AND w.status IN ('requested', 'cleared')`,
      [id],
    );
  }

  /** The automatic hostel fee check of the current step; clears by itself when nothing is due. */
  private async runChecks(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    for (let round = 0; round < 10; round += 1) {
      const w = await this.db.tenant(tenant, (c) => this.findDb(c, id));
      if (!w || w.status !== 'requested' || w.currentStep === null) return;
      const due = (
        w.clearances as Array<Db['clearances'][number] & { autoCheck: string; autoClear: boolean }>
      ).filter(
        (x) =>
          x.step === w.currentStep && x.status !== 'cleared' && !x.check && x.autoCheck !== 'none',
      );
      if (!due.length) return;
      const results = await Promise.all(
        due.map(async (x) => ({
          x,
          result: await this.withdrawals.feeDues(ctx, w.studentId, w.leavingOn, 'hostel'),
        })),
      );
      const before = w.currentStep;
      const after = await this.db.tenant(tenant, async (c) => {
        for (const { x, result } of results) {
          const clear = x.autoClear && result.due === 0;
          await c.query(
            `UPDATE hostel_withdrawal_clearances SET check_result = $2::jsonb, dues = $3,
                    status = CASE WHEN $4 THEN 'cleared'::clearance_status ELSE status END, auto = $4,
                    remarks = CASE WHEN $4 THEN 'Cleared automatically: ' || $5 ELSE remarks END,
                    acted_at = CASE WHEN $4 THEN now() ELSE acted_at END
              WHERE id = $1`,
            [x.id, JSON.stringify(result), result.due, clear, result.detail],
          );
        }
        await this.advance(c, id);
        const r = await c.query<{ step: number | null }>(
          `SELECT current_step AS step FROM hostel_withdrawals WHERE id = $1`,
          [id],
        );
        return r.rows[0]?.step ?? null;
      });
      if (after === before) return;
    }
  }

  private async actOn(
    ctx: RequestContext,
    id: string,
    department: string,
    apply: (c: PoolClient, x: Db['clearances'][number], w: Db) => Promise<Record<string, unknown>>,
    action: string,
  ) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
      if (w.status !== 'requested' && w.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_open',
          'The hostel withdrawal is already completed or cancelled',
          { status: 409 },
        );
      const x = w.clearances.find((y) => y.department === department);
      if (!x)
        throw new DomainError('not-found', `No clearance for "${department}"`, { status: 404 });
      if (x.step !== w.currentStep && x.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_this_step',
          `${x.departmentName} acts at step ${String(x.step)}; the withdrawal is at step ${String(w.currentStep ?? '-')}`,
          { status: 409 },
        );
      const actor = await this.actor(c, ctx);
      if (!actor.manage && !x.approverList.some((a) => this.named(a, actor, w.hostelId)))
        throw new DomainError(
          'withdrawal.not_assigned',
          `${x.departmentName} is cleared by ${x.approverList.map(approverName).join(' or ')}`,
          { status: 403 },
        );
      const after = await apply(c, x, w);
      await this.advance(c, id);
      await this.audit.stage(ctx, c, {
        action,
        entityType: 'hostel_withdrawals',
        entityId: id,
        before: { department, status: x.status },
        after: { department, ...after },
      });
    });
    await this.runChecks(ctx, id);
    return this.get(ctx, id);
  }

  async clearance(ctx: RequestContext, id: string, department: string, dto: ClearanceDto) {
    return this.actOn(
      ctx,
      id,
      department,
      async (c, x, w) => {
        const added = await this.checkFiles(c, dto.documents ?? []);
        const documents = [...(x.documents ?? []), ...added];
        if (dto.status === 'cleared' && x.documentRequired && !documents.length)
          throw new DomainError(
            'withdrawal.document_required',
            `${x.departmentName} needs a document attached to clear`,
            { status: 400 },
          );
        const charge = await raiseHostelCharge(c, {
          department: x,
          amount: dto.charge ?? 0,
          studentId: w.studentId,
          yearId: w.yearId,
          what: `leaving the hostel on ${dmy(w.leavingOn)}`,
        });
        if (dto.feeChoice) {
          if (!x.settles)
            throw new DomainError(
              'hostel.not_settlement',
              'Carry-forward or refund is chosen at the last step (Accounts)',
              { status: 400 },
            );
          await c.query(`UPDATE hostel_withdrawals SET fee_choice = $2 WHERE id = $1`, [
            w.id,
            dto.feeChoice,
          ]);
        }
        await c.query(
          `UPDATE hostel_withdrawal_clearances SET status = $2::clearance_status, dues = $3, remarks = $4, documents = $5::jsonb,
                  bypassed = false, auto = false, acted_by = app.current_user_id(), acted_at = now(),
                  charge = COALESCE($6, charge), charge_misc_fee_id = COALESCE($7, charge_misc_fee_id) WHERE id = $1`,
          [
            x.id,
            dto.status,
            dto.dues,
            dto.remarks ?? null,
            JSON.stringify(documents),
            charge?.amount ?? null,
            charge?.miscFeeId ?? null,
          ],
        );
        return {
          status: dto.status,
          dues: dto.dues,
          remarks: dto.remarks ?? null,
          documents: added.length,
          charge: charge?.amount ?? null,
          feeChoice: dto.feeChoice ?? null,
        };
      },
      'hostel.withdrawal.clear',
    );
  }

  async bypass(ctx: RequestContext, id: string, department: string, dto: BypassDto) {
    return this.actOn(
      ctx,
      id,
      department,
      async (c, x) => {
        if (!x.bypassAllowed)
          throw new DomainError('withdrawal.no_bypass', `${x.departmentName} cannot be bypassed`, {
            status: 409,
          });
        await c.query(
          `UPDATE hostel_withdrawal_clearances SET status = 'cleared', bypassed = true, auto = false, remarks = $2,
                  acted_by = app.current_user_id(), acted_at = now() WHERE id = $1`,
          [x.id, `Bypassed: ${dto.reason}`],
        );
        return { status: 'cleared', bypassed: true, reason: dto.reason };
      },
      'hostel.withdrawal.bypass',
    );
  }

  // ---- completion and cancel ----------------------------------------------------------------------------
  async complete(ctx: RequestContext, id: string): Promise<HostelWithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
      this.ownHostel(await this.actor(c, ctx), w.hostelId);
      if (w.status !== 'cleared')
        throw new DomainError(
          w.status === 'requested' ? 'withdrawal.clearance_pending' : 'withdrawal.not_open',
          w.status === 'requested'
            ? 'Every step must clear the pupil first'
            : 'The hostel withdrawal is already completed or cancelled',
          { status: 409 },
        );
      const stay = await c.query<{ from_date: string; to_date: string | null }>(
        `SELECT from_date::text, to_date::text FROM hostel_allotments WHERE id = $1 FOR UPDATE`,
        [
          (
            await c.query<{ a: string }>(
              `SELECT allotment_id::text AS a FROM hostel_withdrawals WHERE id = $1`,
              [id],
            )
          ).rows[0]!.a,
        ],
      );
      if (stay.rows[0]?.to_date !== null)
        throw new DomainError(
          'hostel.not_allotted',
          'The bed was already given up (vacated or moved); cancel this withdrawal',
          { status: 409 },
        );
      // 1. the bed is given up on the leaving date
      await c.query(
        `UPDATE hostel_allotments SET to_date = $2, end_reason = 'vacate', end_remarks = $3, ended_at = now(), ended_by = app.current_user_id()
          WHERE student_id = $1 AND to_date IS NULL`,
        [w.studentId, w.leavingOn, `Hostel withdrawal: ${REASON[w.reason] ?? w.reason}`],
      );
      // 2. the hostel fee runs to the leaving month, one more when the notice was short
      const feeUntil = w.noticeShort ? nextMonth(w.leavingOn) : monthOf(w.leavingOn);
      const sync = await this.hostel.syncFee(c, w.studentId, w.yearId, feeUntil);
      // 3. paid hostel months after that: carried forward or refunded (Accounts' choice)
      let note: string;
      if (!sync.synced) note = `The hostel fee was not changed: ${sync.note ?? 'no fee set-up'}`;
      else if (w.feeChoice === 'refund') note = await this.refundOutsideStay(c, ctx, w);
      else
        note =
          (await this.adjustments.carryHostelOutsideStay(c, w.studentId, w.yearId)) ??
          'No hostel month paid after the fee stops';
      const until = `Hostel fee up to ${monthLabel(feeUntil)}${w.noticeShort ? ' (short notice)' : ''}.`;
      await c.query(
        `UPDATE hostel_withdrawals SET status = 'completed', completed_at = now(), completed_by = app.current_user_id(),
                fee_until = $2::date, fee_note = $3, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, feeUntil, `${until} ${note}`],
      );
      // 4. the parent is told (when the school has made the template ready)
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      await c.query(
        `SELECT app.template_to_mobiles('hostel_withdrawn_parent', ARRAY(
           SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = $1 AND sg.receives_notifications AND g.mobile IS NOT NULL), $2::jsonb)`,
        [
          w.studentId,
          JSON.stringify({
            who: w.studentName.split(' ')[0],
            hostel: w.hostelName,
            date: dmy(w.leavingOn),
            until: monthLabel(feeUntil),
            fee: w.feeChoice === 'refund' ? 'Any hostel fee paid after that is refunded.' : '',
            school: school.rows[0]?.name ?? '',
          }),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.complete',
        entityType: 'hostel_withdrawals',
        entityId: id,
        before: { status: w.status },
        after: {
          status: 'completed',
          studentId: w.studentId,
          leavingOn: w.leavingOn,
          feeUntil,
          feeChoice: w.feeChoice,
          note,
        },
      });
    });
    return this.get(ctx, id);
  }

  /**
   * Hostel months paid that are now outside the stay are refunded: one refund per receipt, for approval
   * through the fee approval levels (the refunded fee is cancelled, not asked again); unpaid hostel lines
   * outside the stay are cancelled.
   */
  private async refundOutsideStay(c: PoolClient, ctx: RequestContext, w: Db): Promise<string> {
    const OUTSIDE = `d.student_id = $1 AND d.academic_year_id = $2 AND d.ledger = 'hostel' AND d.source = 'structure'
          AND NOT (sp.hosteller AND app.fee_in_hostel(sp.hostel_from, sp.hostel_to, make_date(fp.year, fp.month, 1)))`;
    const paid = await c.query<{
      payment_id: string;
      total: string;
      lines: Array<{
        part: string;
        demandId: string;
        head: string;
        period: string;
        amount: string;
      }>;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- OUTSIDE is a fixed fragment; values are bound parameters
      `SELECT a.payment_id::text, sum(a.amount)::numeric(14,2)::text AS total,
              jsonb_agg(jsonb_build_object('part', 'fee', 'demandId', d.id::text, 'head', h.name, 'period', fp.name, 'amount', a.amount::numeric(14,2)::text)
                        ORDER BY fp.sequence, h.sort_order) AS lines
         FROM (SELECT payment_id, demand_id, sum(amount) AS amount FROM fee_payment_allocations GROUP BY payment_id, demand_id) a
         JOIN fee_payments p ON p.id = a.payment_id AND p.status IN ('posted', 'partly_refunded')
         JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id JOIN fee_periods fp ON fp.id = d.period_id
         JOIN student_fee_profiles sp ON sp.student_id = d.student_id AND sp.academic_year_id = d.academic_year_id
        WHERE ${OUTSIDE}
          AND NOT EXISTS (SELECT 1 FROM fee_refunds r WHERE r.payment_id = a.payment_id AND r.status IN ('requested', 'approved'))
        GROUP BY a.payment_id ORDER BY a.payment_id`,
      [w.studentId, w.yearId],
    );
    await c.query(
      // eslint-disable-next-line no-restricted-syntax -- OUTSIDE is a fixed fragment; values are bound parameters
      `UPDATE fee_demands d SET status = 'cancelled', updated_at = now()
         FROM fee_periods fp, student_fee_profiles sp
        WHERE fp.id = d.period_id AND sp.student_id = d.student_id AND sp.academic_year_id = d.academic_year_id
          AND ${OUTSIDE} AND d.paid = 0 AND d.status = 'pending'`,
      [w.studentId, w.yearId],
    );
    if (!paid.rows.length) return 'No hostel month paid after the fee stops';
    const reason = `Hostel withdrawal: left the hostel on ${dmy(w.leavingOn)}`;
    const batch = (await c.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)).rows[0]!
      .id;
    const ids: string[] = [];
    let total = 0;
    for (const p of paid.rows) {
      const amount = Number(p.total);
      if (amount <= 0) continue;
      const r = await c.query<{ id: string }>(
        `INSERT INTO fee_refunds (school_id, payment_id, amount, reason, mode, requested_by, request_id, lines, fee_action, batch_id, hostel_withdrawal_id, status)
         VALUES (app.current_school_id(), $1, $2, $3, 'bank', app.current_user_id(), app.current_request_id(), $4::jsonb, 'cancel', $5::uuid, $6, 'requested')
         RETURNING id::text`,
        [p.payment_id, amount.toFixed(2), reason, JSON.stringify(p.lines), batch, w.id],
      );
      ids.push(r.rows[0]!.id);
      total += amount;
    }
    if (!ids.length) return 'No hostel month paid after the fee stops';
    let inApproval = false;
    try {
      const instanceId = await startFeeApproval(
        this.workflow,
        c,
        ctx,
        { code: 'fee_refund', name: 'Fee refund' },
        ids[0]!,
        `Refund on hostel withdrawal: ${w.studentName}: ${rs(total)} (${String(ids.length)} receipt${ids.length === 1 ? '' : 's'})`,
        { kind: 'hostel_withdrawal', hostelWithdrawalId: w.id, reason },
      );
      if (instanceId) {
        await c.query(
          `UPDATE fee_refunds SET workflow_instance_id = $2 WHERE id = ANY($1::bigint[])`,
          [ids, instanceId],
        );
        inApproval = true;
      }
    } catch (error) {
      // the refunds then wait on Fees -> Refunds for a user with the refund approve right
      if (!(error instanceof DomainError)) throw error;
    }
    return `Hostel paid after the fee stops (${rs(total)}) is sent for refund${inApproval ? ' through the approval levels' : '; it waits on Fees → Refunds'}.`;
  }

  async cancel(ctx: RequestContext, id: string, reason: string): Promise<HostelWithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
      this.ownHostel(await this.actor(c, ctx), w.hostelId);
      if (w.status !== 'requested' && w.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_open',
          'Only an open hostel withdrawal can be cancelled',
          { status: 409 },
        );
      await c.query(
        `UPDATE hostel_withdrawals SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.cancel',
        entityType: 'hostel_withdrawals',
        entityId: id,
        before: { status: w.status },
        after: { status: 'cancelled', reason },
      });
    });
    return this.get(ctx, id);
  }
}
