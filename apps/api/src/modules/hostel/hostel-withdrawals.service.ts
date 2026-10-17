import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { FeeAdjustmentsService } from '../fees/fee-adjustments.service';
import { startFeeApproval } from '../fees/fee-approval';
import { WithdrawalsService } from '../people/lifecycle/withdrawals.service';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { raiseHostelCharge } from './hostel-charge';
import {
  HOSTEL_WD,
  type ListHostelWithdrawalsDto,
  type StartHostelWithdrawalDto,
} from './hostel-withdrawal.dto';
import { HostelService } from './hostel.service';

type Status = 'requested' | 'cleared' | 'completed' | 'cancelled' | 'rejected';

/** The approval levels of a hostel withdrawal (Fee setup -> Approval levels, "Hostel withdrawal"). */
export const HW_FLOW = { code: 'hostel_withdrawal', entityType: 'hostel_withdrawal' } as const;
const DEFAULT_LEVELS = [
  {
    level: 1,
    name: 'Accounts',
    resolver: { kind: 'role', roleCode: 'accountant' },
    slaHours: 48,
  },
  {
    level: 2,
    name: 'Principal approval',
    resolver: { kind: 'role', roleCode: 'school_admin' },
    slaHours: 48,
  },
];
const DEFAULT_CREATORS = ['hostel_clerk', 'warden', 'school_admin', 'group_admin'];

export interface ApprovalStep {
  id: string;
  level: number;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  assignees: string[];
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
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
  feeChoice: 'carry' | 'refund';
  noticeDays: number | null;
  noticeShort: boolean;
  damageCharge: string;
  messCharge: string;
  chargeRemarks: string | null;
  feeUntil: string | null;
  feeNote: string | null;
  decidedNote: string | null;
  requestedBy: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  /** the approval levels it goes through; null when the school has them switched off */
  approval: {
    instanceId: string;
    status: string;
    currentLevel: number;
    steps: ApprovalStep[];
  } | null;
  /** who it waits with now (the current level's name) */
  waitingWith: string | null;
  /** per viewer: the pending step is theirs; lastLevel = they choose carry-forward or refund */
  myStep: { id: string; lastLevel: boolean } | null;
  /** per viewer: no approval levels in force, the office completes it */
  canComplete?: boolean;
}

interface Db extends Omit<HostelWithdrawalRow, 'completedAt' | 'approval' | 'myStep'> {
  yearId: string;
  instanceId: string | null;
  completedAt: Date | null;
}

const SELECT = `SELECT w.id::text, w.student_id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo",
        sec.label AS section, h.id::text AS "hostelId", h.name AS "hostelName", rm.room_no || '-' || b.label AS place,
        w.requested_on::text AS "requestedOn", w.leaving_on::text AS "leavingOn", w.reason, w.remarks, w.documents, w.status,
        w.fee_choice AS "feeChoice", w.notice_days AS "noticeDays", w.notice_short AS "noticeShort",
        w.damage_charge::text AS "damageCharge", w.mess_charge::text AS "messCharge", w.charge_remarks AS "chargeRemarks",
        w.fee_until::text AS "feeUntil", w.fee_note AS "feeNote", w.decided_note AS "decidedNote", w.academic_year_id::text AS "yearId",
        w.workflow_instance_id::text AS "instanceId",
        u.display_name AS "requestedBy", w.completed_at AS "completedAt", w.cancel_reason AS "cancelReason",
        (SELECT st.name FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level
          WHERE i.id = w.workflow_instance_id AND i.status = 'pending' LIMIT 1) AS "waitingWith"
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
  requested: 'Waiting for approval',
  cleared: 'Approved, to complete',
  completed: 'Left the hostel',
  cancelled: 'Cancelled',
  rejected: 'Not approved',
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
 * school. The Hostel Clerk, a warden of the pupil's hostel or the office starts it (the roles allowed are
 * set as "who may start" on Fee setup -> Approval levels) with the leaving date, the room damages and the
 * mess dues. It then goes through the hostel withdrawal's own approval levels; the last approver chooses
 * carry-forward or refund. The last approval vacates the bed on the leaving date, keeps the hostel fee to
 * the leaving month (one more when the notice was short and the school charges it), carries forward or
 * refunds the hostel months paid after that, raises the damages and mess dues as misc fees and tells the
 * parent. With the levels switched off the office completes it itself.
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

  /** The school's approval levels of a hostel withdrawal, made with the standard two levels the first time. */
  private async ensureFlow(c: PoolClient) {
    await c.query(
      `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
       SELECT app.current_school_id(), $1, 'Hostel withdrawal', $2, $3::jsonb, $4::text[], app.current_user_id(), app.current_user_id()
        WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL)`,
      [HW_FLOW.code, HW_FLOW.entityType, JSON.stringify(DEFAULT_LEVELS), DEFAULT_CREATORS],
    );
    const r = await c.query<{ status: string }>(
      `SELECT status::text FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL`,
      [HW_FLOW.code],
    );
    return r.rows[0]?.status === 'active';
  }

  /** Makes sure the approval levels exist (Fee setup -> Approval levels lists and edits them). */
  async approvalFlow(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ active: await this.ensureFlow(c) }));
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
  /** The hostels a warden without the office rights works in; null = all (office, clerk, accounts). */
  private async only(c: PoolClient, ctx: RequestContext) {
    return this.hostel.scope(ctx, c);
  }

  /** A warden starts and cancels only for a pupil of their own hostel. */
  private ownHostel(only: string[] | null, hostelId: string) {
    if (only && !only.includes(hostelId))
      throw new DomainError('hostel.not_your_hostel', 'The pupil stays in another hostel', {
        status: 403,
      });
  }

  private async approvalOf(c: PoolClient, instanceId: string | null) {
    if (!instanceId) return null;
    const i = await c.query<{ status: string; current_level: number }>(
      `SELECT status::text, current_level FROM workflow_instances WHERE id = $1`,
      [instanceId],
    );
    if (!i.rows[0]) return null;
    const steps = await c.query<{
      id: string;
      level: number;
      name: string;
      status: ApprovalStep['status'];
      assignees: string[] | null;
      assignee_ids: string[];
      acted_by: string | null;
      acted_at: Date | null;
      note: string | null;
    }>(
      `SELECT s.id::text, s.level, s.name, s.status::text,
              (SELECT array_agg(u.display_name ORDER BY u.display_name) FROM users u WHERE u.id = ANY(s.assignee_user_ids)) AS assignees,
              s.assignee_user_ids::text[] AS assignee_ids,
              (SELECT display_name FROM users WHERE id = s.acted_by) AS acted_by, s.acted_at, s.note
         FROM workflow_steps s WHERE s.instance_id = $1 ORDER BY s.level`,
      [instanceId],
    );
    return {
      instanceId,
      status: i.rows[0].status,
      currentLevel: i.rows[0].current_level,
      steps: steps.rows.map((s) => ({
        id: s.id,
        level: s.level,
        name: s.name,
        status: s.status,
        assignees: s.assignees ?? [],
        actedBy: s.acted_by,
        actedAt: s.acted_at ? s.acted_at.toISOString() : null,
        note: s.note,
      })),
      assigneeIds: new Map(steps.rows.map((s) => [s.id, s.assignee_ids])),
    };
  }

  private async view(
    c: PoolClient,
    ctx: RequestContext,
    r: Db,
    only: string[] | null,
  ): Promise<HostelWithdrawalRow> {
    const { yearId: _y, instanceId, completedAt, ...rest } = r;
    void _y;
    const a = await this.approvalOf(c, instanceId);
    const pending =
      a && a.status === 'pending'
        ? a.steps.find((s) => s.level === a.currentLevel && s.status === 'pending')
        : undefined;
    const mine =
      pending && (a?.assigneeIds.get(pending.id) ?? []).includes(ctx.user.id)
        ? {
            id: pending.id,
            lastLevel: pending.level === Math.max(...(a?.steps.map((s) => s.level) ?? [0])),
          }
        : null;
    const manage = ctx.permissions?.has(HOSTEL_WD.manage) ?? false;
    return {
      ...rest,
      documents: r.documents ?? [],
      completedAt: completedAt ? completedAt.toISOString() : null,
      approval: a
        ? {
            instanceId: a.instanceId,
            status: a.status,
            currentLevel: a.currentLevel,
            steps: a.steps,
          }
        : null,
      myStep: mine,
      canComplete:
        manage &&
        (r.status === 'cleared' || (r.status === 'requested' && !instanceId)) &&
        (!only || only.includes(r.hostelId)),
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
      const only = await this.only(c, ctx);
      const params: unknown[] = [];
      const where: string[] = [];
      const add = (v: unknown) => {
        params.push(v);
        return `$${String(params.length)}`;
      };
      if (q.status === 'open' || q.mine) where.push(`w.status IN ('requested', 'cleared')`);
      else if (q.status !== 'all') where.push(`w.status = ${add(q.status)}`);
      // "waiting for me": the pending approval step is mine
      if (q.mine)
        where.push(`EXISTS (SELECT 1 FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level
                            WHERE i.id = w.workflow_instance_id AND i.status = 'pending' AND st.status = 'pending'
                              AND app.current_user_id() = ANY(st.assignee_user_ids))`);
      // a warden without the office rights sees their own hostels (the office and Accounts see all)
      if (only?.length && !q.mine) where.push(`h.id = ANY(${add(only)}::bigint[])`);
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
      const page = r.rows.slice((q.page - 1) * q.size, q.page * q.size);
      const rows: HostelWithdrawalRow[] = [];
      for (const x of page) rows.push(await this.view(c, ctx, x, only));
      return { rows, total: r.rows.length };
    });
  }

  async listFile(ctx: RequestContext, q: ListHostelWithdrawalsDto, format: 'xlsx' | 'pdf') {
    const { rows } = await this.list(ctx, { ...q, page: 1, size: 500 });
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
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
          Number(w.damageCharge) + Number(w.messCharge) || '',
          w.feeUntil ? monthLabel(w.feeUntil) : '',
          w.waitingWith ?? '',
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
      return this.view(c, ctx, row, await this.only(c, ctx));
    });
  }

  async forStudent(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.only(c, ctx);
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = await c.query<Db>(`${SELECT} WHERE w.student_id = $1 ORDER BY w.id DESC`, [
        studentId,
      ]);
      const out: HostelWithdrawalRow[] = [];
      for (const x of r.rows) out.push(await this.view(c, ctx, x, only));
      return out;
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
      const s = await c.query<{ name: string; admission_no: string; status: string }>(
        `SELECT display_name AS name, admission_no, status::text FROM students WHERE id = $1 AND deleted_at IS NULL`,
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
      this.ownHostel(await this.only(c, ctx), bed.hostel_id);
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
      const files = await this.checkFiles(c, dto.documents ?? []);
      const { noticeDays, noticeCharge } = await this.setting(c);
      const requestedOn =
        dto.requestedOn ?? new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      // a leaving date on or after the request: the notice period applies; an earlier one records a
      // pupil who has already left, and no notice month is charged
      const days = Math.round((Date.parse(dto.leavingOn) - Date.parse(requestedOn)) / 86400e3);
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO hostel_withdrawals (school_id, student_id, academic_year_id, allotment_id, requested_on, leaving_on, reason, remarks, documents,
                                           notice_days, notice_short, damage_charge, mess_charge, charge_remarks, requested_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
                   app.current_user_id(), app.current_user_id())
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
            noticeDays,
            noticeCharge && days >= 0 && days < noticeDays,
            dto.damageCharge.toFixed(2),
            dto.messCharge.toFixed(2),
            dto.chargeRemarks ?? null,
          ],
        );
        id = r.rows[0]!.id;
        // started from the parent's request: the request now points at this withdrawal
        if (dto.exitRequestId) {
          const ex = await c.query(
            `UPDATE hostel_exit_requests SET status = 'started', withdrawal_id = $2, decided_by = app.current_user_id(), decided_at = now()
              WHERE id = $1 AND student_id = $3 AND status = 'pending'`,
            [dto.exitRequestId, id, studentId],
          );
          if (!ex.rowCount)
            throw new DomainError(
              'hostel.exit_request_not_pending',
              "The parent's request is no longer waiting (started, declined or withdrawn)",
              { status: 409 },
            );
          await c.query(`UPDATE hostel_withdrawals SET exit_request_id = $2 WHERE id = $1`, [
            id,
            dto.exitRequestId,
          ]);
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'withdrawal.open_exists',
            'The pupil already has an open hostel withdrawal',
            { status: 409 },
          );
        throw error;
      }
      // the approval levels of Fee setup -> Approval levels (they also say who may start one)
      let instanceId: string | null = null;
      if (await this.ensureFlow(c)) {
        const inst = await this.workflow.start(c, ctx, {
          definitionCode: HW_FLOW.code,
          entityType: HW_FLOW.entityType,
          entityId: id,
          subject: `Hostel withdrawal: ${s.rows[0].name} (${s.rows[0].admission_no}) leaving on ${dmy(dto.leavingOn)}`,
          payload: {
            studentId,
            leavingOn: dto.leavingOn,
            damageCharge: dto.damageCharge,
            messCharge: dto.messCharge,
          },
        });
        instanceId = inst.id;
        await c.query(`UPDATE hostel_withdrawals SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          instanceId,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.start',
        entityType: 'hostel_withdrawals',
        entityId: id,
        after: {
          studentId,
          requestedOn,
          leavingOn: dto.leavingOn,
          reason: dto.reason,
          noticeShort: noticeCharge && days >= 0 && days < noticeDays,
          damageCharge: dto.damageCharge,
          messCharge: dto.messCharge,
          approval: instanceId,
        },
      });
      return id;
    });
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

  // ---- approval ------------------------------------------------------------------------------------------
  /**
   * The approver of the current level decides here (the Approvals inbox works too). At the last level
   * the approver chooses carry-forward or refund of the hostel months paid after the fee stops.
   */
  async decide(
    ctx: RequestContext,
    id: string,
    dto: { outcome: 'approved' | 'rejected'; note?: string; feeChoice?: 'carry' | 'refund' },
  ): Promise<HostelWithdrawalRow> {
    const w = await this.get(ctx, id);
    if (w.status !== 'requested' || !w.approval || w.approval.status !== 'pending')
      throw new DomainError('withdrawal.not_open', 'Nothing is waiting for approval here', {
        status: 409,
      });
    if (!w.myStep)
      throw new DomainError('workflow.not_assignee', 'This level is not assigned to you', {
        status: 403,
      });
    if (dto.outcome === 'rejected' && !dto.note?.trim())
      throw new DomainError('validation-failed', 'Give the reason for not approving', {
        status: 400,
      });
    if (dto.feeChoice && w.myStep.lastLevel && dto.outcome === 'approved')
      await this.db.tenant(requireTenant(ctx), (c) =>
        c.query(`UPDATE hostel_withdrawals SET fee_choice = $2, updated_at = now() WHERE id = $1`, [
          id,
          dto.feeChoice,
        ]),
      );
    await this.workflow.act(ctx, w.myStep.id, dto.outcome, { note: dto.note });
    return this.get(ctx, id);
  }

  /** The approval levels are done (WorkflowService.onComplete): leave the hostel, or not approved. */
  async onApprovalComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    const w = await this.findDb(c, instance.entityId, true);
    if (!w || w.status !== 'requested') return;
    if (outcome === 'rejected') {
      const note = instance.steps.find((s) => s.status === 'rejected')?.note ?? null;
      await c.query(
        `UPDATE hostel_withdrawals SET status = 'rejected', decided_note = $2, updated_at = now() WHERE id = $1`,
        [w.id, note],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.withdrawal.rejected',
        entityType: 'hostel_withdrawals',
        entityId: w.id,
        after: { note },
      });
      return;
    }
    await this.completeIn(c, ctx, w);
  }

  /** With the approval levels switched off, the office completes it (choosing carry-forward or refund). */
  async complete(
    ctx: RequestContext,
    id: string,
    feeChoice?: 'carry' | 'refund',
  ): Promise<HostelWithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
      this.ownHostel(await this.only(c, ctx), w.hostelId);
      if (w.instanceId && w.status === 'requested')
        throw new DomainError(
          'withdrawal.clearance_pending',
          'It is waiting for its approval levels; it completes on the last approval',
          { status: 409 },
        );
      if (w.status !== 'requested' && w.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_open',
          'The hostel withdrawal is already completed, cancelled or not approved',
          { status: 409 },
        );
      if (feeChoice) {
        await c.query(`UPDATE hostel_withdrawals SET fee_choice = $2 WHERE id = $1`, [
          id,
          feeChoice,
        ]);
        w.feeChoice = feeChoice;
      }
      await this.completeIn(c, ctx, w);
    });
    return this.get(ctx, id);
  }

  private async completeIn(c: PoolClient, ctx: RequestContext, w: Db) {
    const stay = await c.query<{ to_date: string | null }>(
      `SELECT a.to_date::text FROM hostel_allotments a JOIN hostel_withdrawals hw ON hw.allotment_id = a.id WHERE hw.id = $1`,
      [w.id],
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
    // 3. paid hostel months after that: carried forward or refunded
    let note: string;
    if (!sync.synced) note = `The hostel fee was not changed: ${sync.note ?? 'no fee set-up'}`;
    else if (w.feeChoice === 'refund') note = await this.refundOutsideStay(c, ctx, w);
    else
      note =
        (await this.adjustments.carryHostelOutsideStay(c, w.studentId, w.yearId)) ??
        'No hostel month paid after the fee stops';
    // 4. damages and mess dues entered at the start become misc fees of the pupil
    const what = `leaving the hostel on ${dmy(w.leavingOn)}`;
    const damage = await raiseHostelCharge(c, {
      department: {
        departmentName: 'Room and inventory',
        chargeKind: 'damage',
        charge: '0',
        chargeMiscFeeId: null,
      },
      amount: Number(w.damageCharge),
      studentId: w.studentId,
      yearId: w.yearId,
      what,
    });
    const mess = await raiseHostelCharge(c, {
      department: {
        departmentName: 'Mess',
        chargeKind: 'mess',
        charge: '0',
        chargeMiscFeeId: null,
      },
      amount: Number(w.messCharge),
      studentId: w.studentId,
      yearId: w.yearId,
      what,
    });
    const charges = [
      damage ? `damages ${rs(damage.amount)}` : null,
      mess ? `mess dues ${rs(mess.amount)}` : null,
    ].filter(Boolean);
    const until = `Hostel fee up to ${monthLabel(feeUntil)}${w.noticeShort ? ' (short notice)' : ''}.`;
    const feeNote = `${until} ${note}${charges.length ? ` Raised as misc fees: ${charges.join(', ')}.` : ''}`;
    await c.query(
      `UPDATE hostel_withdrawals SET status = 'completed', completed_at = now(), completed_by = app.current_user_id(),
              fee_until = $2::date, fee_note = $3, damage_misc_fee_id = $4, mess_misc_fee_id = $5,
              updated_at = now(), updated_by = app.current_user_id()
        WHERE id = $1`,
      [w.id, feeUntil, feeNote, damage?.miscFeeId ?? null, mess?.miscFeeId ?? null],
    );
    // 5. the parent is told (when the school has made the template ready)
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
      entityId: w.id,
      before: { status: w.status },
      after: {
        status: 'completed',
        studentId: w.studentId,
        leavingOn: w.leavingOn,
        feeUntil,
        feeChoice: w.feeChoice,
        note,
        charges,
      },
    });
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

  /** Cancelled before it is approved: the pupil keeps the bed; a pending approval is closed. */
  async cancel(ctx: RequestContext, id: string, reason: string): Promise<HostelWithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Hostel withdrawal not found', { status: 404 });
      this.ownHostel(await this.only(c, ctx), w.hostelId);
      if (w.status !== 'requested' && w.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_open',
          'Only an open hostel withdrawal can be cancelled',
          { status: 409 },
        );
      if (w.instanceId) {
        await c.query(
          `UPDATE workflow_steps SET status = 'skipped' WHERE instance_id = $1 AND status = 'pending'`,
          [w.instanceId],
        );
        await c.query(
          `UPDATE workflow_instances SET status = 'cancelled', completed_at = now(), updated_at = now()
            WHERE id = $1 AND status = 'pending'`,
          [w.instanceId],
        );
      }
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
