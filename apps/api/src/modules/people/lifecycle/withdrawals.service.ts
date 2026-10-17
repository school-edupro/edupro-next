import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { approverLabel, type Approver, type PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { FeeLedgerService } from '../../fees/fee-ledger.service';
import { settleWithdrawalFees } from '../../fees/withdrawal-fees';
import { AccessService } from '../../access/access.service';
import { generatedOn, registerFile, schoolHead } from '../../attendance/register-file';
import { WorkflowService, type InstanceRow } from '../../workflow/workflow.service';
import { WAITING_WITH, startFeeApproval } from '../../fees/fee-approval';
import { raiseHostelCharge } from '../../hostel/hostel-charge';
import { checkHostelReturn, returnToHostel, type HostelReturn } from '../../hostel/hostel-return';
import { FeeAdjustmentsService } from '../../fees/fee-adjustments.service';
import {
  LIFECYCLE,
  type BulkClearanceDto,
  type BulkTcDto,
  type BulkWithdrawalDto,
  type BypassDto,
  type CancelDto,
  type ClearanceDto,
  type DepartmentInput,
  type ListWithdrawalsQueryDto,
  type RequestWithdrawalDto,
  type SaveDepartmentsDto,
} from './lifecycle.dto';
import { TcService } from './tc.service';

/** Who may clear a department: the shared approvers, or the warden of the pupil's hostel. */
export type WithdrawalApprover = Approver | { kind: 'hostel_warden' };
export type WithdrawalProcess = 'school' | 'hostel';
export const approverName = (a: WithdrawalApprover): string =>
  a.kind === 'hostel_warden' ? "Warden of the pupil's hostel" : approverLabel(a);

export interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  step: number;
  approvers: WithdrawalApprover[];
  approverLabels: string[];
  autoCheck: 'none' | 'fees' | 'library' | 'hostel_fees';
  /** the department may raise a charge on the pupil (misc fee): damages or mess dues */
  chargeKind: 'damage' | 'mess' | null;
  /** a hostel department that also clears a hosteller leaving the school */
  inSchoolExit: boolean;
  autoClear: boolean;
  bypassAllowed: boolean;
  documentRequired: boolean;
  gatesTc: boolean;
  active: boolean;
}

export interface ClearanceRow {
  id: string;
  department: string;
  departmentName: string;
  step: number;
  status: 'pending' | 'cleared' | 'hold';
  dues: string;
  remarks: string | null;
  bypassed: boolean;
  auto: boolean;
  check: { kind: string; due: number; detail: string } | null;
  documents: Array<{ fileId: string; name: string | null }>;
  approvers: string[];
  bypassAllowed: boolean;
  documentRequired: boolean;
  gatesTc: boolean;
  chargeKind: 'damage' | 'mess' | null;
  charge: string;
  chargeMiscFeeId: string | null;
  actedBy: string | null;
  actedAt: string | null;
  /** Filled per viewer: the department waits at the current step and this user may act on it. */
  canAct?: boolean;
}

export interface WithdrawalRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  initiatedOn: string;
  requestedOn: string;
  leavingOn: string;
  reason: string;
  remarks: string | null;
  documents: Array<{ fileId: string; name: string | null }>;
  status: 'requested' | 'cleared' | 'completed' | 'cancelled' | 'revoked';
  /** A revoke (the pupil rejoins) asked on a completed withdrawal: pending, approved or rejected. */
  revokeStatus: 'pending' | 'approved' | 'rejected' | null;
  revokeReason: string | null;
  revokeWaitingWith: string | null;
  /** Refund of this leaving: none, not_sent (a draft), waiting (for approval) or paid; with its amount. */
  refundState: 'none' | 'not_sent' | 'waiting' | 'paid';
  refundAmount: string;
  revokedAt: string | null;
  /** the hostel stay this withdrawal ended (a boarder): the revoke may put the pupil back (0165) */
  hostelStay: { allotmentId: string; place: string; leftOn: string } | null;
  /** what the revoke asks or did for the hostel: back as if never left, or from a day */
  revokeHostel: {
    mode: 'continue' | 'from_date';
    fromDate: string | null;
    note: string | null;
  } | null;
  currentStep: number | null;
  requestedBy: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  tc: { id: string; tcNo: string; exportId: string | null } | null;
  clearances: ClearanceRow[];
  /** Per viewer: the TC may be issued now (the departments that gate it have cleared). */
  canIssueTc?: boolean;
}

interface Db {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  section: string | null;
  class_section_id: string | null;
  initiated_on: string;
  requested_on: string;
  leaving_on: string;
  reason: string;
  remarks: string | null;
  documents: WithdrawalRow['documents'];
  status: WithdrawalRow['status'];
  current_step: number | null;
  requested_by: string | null;
  completed_at: Date | null;
  cancel_reason: string | null;
  revoke_status: WithdrawalRow['revokeStatus'];
  revoke_reason: string | null;
  revoke_waiting_with: string | null;
  refund_state: WithdrawalRow['refundState'];
  refund_amount: string;
  class_id: string | null;
  hostel_id: string | null;
  year_id: string;
  revoked_at: Date | null;
  hostel_stay: WithdrawalRow['hostelStay'];
  revoke_hostel_mode: 'continue' | 'from_date' | null;
  revoke_hostel_from: string | null;
  revoke_hostel_note: string | null;
  tc: WithdrawalRow['tc'];
  clearances: Array<Omit<ClearanceRow, 'approvers'> & { approverList: WithdrawalApprover[] }>;
}

interface Actor {
  userId: string;
  roleIds: Set<string>;
  sections: Set<string>;
  /** the hostels whose warden the user is */
  hostels: Set<string>;
  /** Holds people.withdrawal.manage: the office, and may act on (or bypass) any department. */
  manage: boolean;
}

// eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed SQL fragment over a column name written here
const SELECT = `SELECT w.id::text, w.student_id::text, s.display_name AS student_name, s.admission_no,
        sec.label AS section, sec.class_section_id, sec.class_id, rf.state AS refund_state, rf.amount::text AS refund_amount,
        w.academic_year_id::text AS year_id,
        (SELECT rm.hostel_id::text FROM hostel_allotments ha JOIN hostel_beds hb ON hb.id = ha.bed_id JOIN hostel_rooms rm ON rm.id = hb.room_id
          WHERE ha.student_id = w.student_id ORDER BY (ha.to_date IS NULL) DESC, ha.from_date DESC LIMIT 1) AS hostel_id,
        COALESCE(w.initiated_on, w.requested_on)::text AS initiated_on, w.requested_on::text, w.leaving_on::text, w.reason, w.remarks, w.documents,
        w.status, w.current_step, u.display_name AS requested_by, w.completed_at, w.cancel_reason,
        w.revoke_status, w.revoke_reason, w.revoked_at, ${WAITING_WITH('w.revoke_workflow_instance_id')} AS revoke_waiting_with,
        w.revoke_hostel_mode, w.revoke_hostel_from::text AS revoke_hostel_from, w.revoke_hostel_note,
        (SELECT jsonb_build_object('allotmentId', ha.id::text, 'leftOn', ha.to_date::text,
                                   'place', h.name || ' · ' || rm.room_no || ' · bed ' || hb.label)
           FROM hostel_allotments ha JOIN hostel_beds hb ON hb.id = ha.bed_id JOIN hostel_rooms rm ON rm.id = hb.room_id
           JOIN hostels h ON h.id = rm.hostel_id
          WHERE ha.student_id = w.student_id AND ha.end_reason = 'withdrawn' AND ha.end_remarks = 'Left the school'
          ORDER BY ha.to_date DESC LIMIT 1) AS hostel_stay,
        CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id::text, 'tcNo', t.tc_no, 'exportId', t.export_id::text) END AS tc,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', x.id::text, 'department', x.department, 'departmentName', COALESCE(d.name, initcap(x.department)), 'step', x.step,
                    'status', x.status, 'dues', x.dues::text, 'remarks', x.remarks, 'bypassed', x.bypassed, 'auto', x.auto, 'check', x.check_result,
                    'documents', x.documents, 'approverList', COALESCE(d.approvers, '[{"kind":"office"}]'::jsonb),
                    'bypassAllowed', COALESCE(d.bypass_allowed, false), 'documentRequired', COALESCE(d.document_required, false),
                    'gatesTc', COALESCE(d.gates_tc, false), 'chargeKind', d.charge_kind, 'charge', x.charge::text,
                    'chargeMiscFeeId', x.charge_misc_fee_id::text,
                    'actedBy', (SELECT display_name FROM users WHERE id = x.acted_by), 'actedAt', x.acted_at) ORDER BY x.step, COALESCE(d.sort_order, 0), x.id)
                    FROM withdrawal_clearances x LEFT JOIN withdrawal_departments d ON d.id = x.department_id
                   WHERE x.withdrawal_id = w.id), '[]'::jsonb) AS clearances
   FROM student_withdrawals w JOIN students s ON s.id = w.student_id LEFT JOIN users u ON u.id = w.requested_by
   LEFT JOIN transfer_certificates t ON t.id = w.tc_id AND t.status = 'issued'
   LEFT JOIN LATERAL (SELECT c.code || '-' || cs.name AS label, e.class_section_id::text, cs.class_id::text
                        FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
                       WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC, e.id DESC LIMIT 1) sec ON true
   CROSS JOIN LATERAL (SELECT CASE WHEN count(*) FILTER (WHERE r.status = 'requested') > 0 THEN 'waiting'
                                   WHEN count(*) FILTER (WHERE r.status = 'draft') > 0 THEN 'not_sent'
                                   WHEN count(*) FILTER (WHERE r.status IN ('approved', 'paid')) > 0 THEN 'paid'
                                   ELSE 'none' END AS state,
                              COALESCE(sum(r.amount) FILTER (WHERE r.status IN ('draft', 'requested', 'approved', 'paid')), 0) AS amount
                         FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id
                        WHERE r.withdrawal_id = w.id
                           OR (COALESCE(r.student_id, p.student_id) = w.student_id AND r.created_at >= w.created_at)) rf`;

/** The departments a school starts with; it may rename, re-order, add or switch them off. */
type DefaultDepartment = Omit<DepartmentInput, 'approvers' | 'chargeKind' | 'inSchoolExit'> & {
  approvers: Array<WithdrawalApprover | { kind: 'role_code'; code: string }>;
  chargeKind?: 'damage' | 'mess' | null;
  inSchoolExit?: boolean;
};
const DEFAULTS: DefaultDepartment[] = [
  {
    code: 'fees',
    name: 'Fees and accounts',
    step: 1,
    approvers: [{ kind: 'role_code', code: 'accountant' }, { kind: 'office' }],
    autoCheck: 'fees',
    autoClear: true,
    bypassAllowed: false,
    documentRequired: false,
    gatesTc: true,
    active: true,
  },
  {
    code: 'library',
    name: 'Library',
    step: 1,
    approvers: [{ kind: 'office' }],
    autoCheck: 'library',
    autoClear: true,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
  {
    code: 'transport',
    name: 'Transport',
    step: 1,
    approvers: [{ kind: 'office' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
  {
    code: 'class_teacher',
    name: 'Class teacher',
    step: 2,
    approvers: [{ kind: 'class_teacher' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
  {
    code: 'principal',
    name: 'Principal',
    step: 3,
    approvers: [{ kind: 'role_code', code: 'school_admin' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: false,
    documentRequired: false,
    gatesTc: false,
    active: true,
  },
];

/**
 * The hostel's steps a school starts with (docs/design/27-hostel-withdrawal.md): they clear a hosteller
 * who leaves the school, inside the school withdrawal. The warden checks the room and its inventory
 * (damages), the mess its dues; each raises its amount as a misc fee. (Leaving only the hostel goes
 * through its approval levels on Fee setup -> Approval levels.)
 */
const HOSTEL_DEFAULTS: DefaultDepartment[] = [
  {
    code: 'hostel_warden',
    name: 'Warden: room and inventory',
    step: 1,
    approvers: [{ kind: 'hostel_warden' }, { kind: 'office' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: false,
    documentRequired: false,
    gatesTc: false,
    active: true,
    chargeKind: 'damage',
    inSchoolExit: true,
  },
  {
    code: 'hostel_mess',
    name: 'Mess',
    step: 1,
    approvers: [{ kind: 'office' }],
    autoCheck: 'none',
    autoClear: false,
    bypassAllowed: true,
    documentRequired: false,
    gatesTc: false,
    active: true,
    chargeKind: 'mess',
    inSchoolExit: true,
  },
];

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Withdrawal (2026-10-01, replaces the S7 two-step flow): the office starts it with dates, reason and
 * documents; the school's departments clear it in steps (same step in parallel), each by its own
 * approvers, with automatic fee / library checks that clear by themselves when nothing is due, an
 * optional bypass, remarks, dues and documents. The TC can be issued once the departments that gate
 * it (fees) have cleared; completion ends the enrolment and revokes the student's login (and a parent's
 * when no other child studies here). The office may cancel until completion. Bulk start, bulk clear
 * and bulk TC serve the Class XII year end.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ledger: FeeLedgerService,
    private readonly tcs: TcService,
    private readonly workflow: WorkflowService,
    private readonly access: AccessService,
    private readonly adjustments: FeeAdjustmentsService,
  ) {}

  // ---- settings ------------------------------------------------------------------------------------
  private async ensureDepartments(c: PoolClient, process: WithdrawalProcess = 'school') {
    const has = await c.query(`SELECT 1 FROM withdrawal_departments WHERE process = $1 LIMIT 1`, [
      process,
    ]);
    if (has.rowCount) return;
    const roles = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM roles WHERE school_id IS NULL AND code IN ('accountant', 'school_admin')`,
    );
    const byCode = new Map(roles.rows.map((r) => [r.code, r]));
    let order = 0;
    for (const d of process === 'hostel' ? HOSTEL_DEFAULTS : DEFAULTS) {
      const approvers = d.approvers.flatMap((a): WithdrawalApprover[] => {
        if (a.kind !== 'role_code') return [a];
        const r = byCode.get(a.code);
        return r ? [{ kind: 'role', roleId: r.id, name: r.name }] : [];
      });
      await c.query(
        `INSERT INTO withdrawal_departments (school_id, code, name, step, approvers, auto_check, auto_clear, bypass_allowed, document_required, gates_tc, sort_order,
                                             process, charge_kind, in_school_exit, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, process, code) DO NOTHING`,
        [
          d.code,
          d.name,
          d.step,
          JSON.stringify(approvers.length ? approvers : [{ kind: 'office' }]),
          d.autoCheck,
          d.autoClear,
          d.bypassAllowed,
          d.documentRequired,
          d.gatesTc,
          (order += 1),
          process,
          d.chargeKind ?? null,
          d.inSchoolExit ?? false,
        ],
      );
    }
  }

  async departmentsIn(
    c: PoolClient,
    activeOnly: boolean,
    process: WithdrawalProcess = 'school',
  ): Promise<DepartmentRow[]> {
    await this.ensureDepartments(c, process);
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      step: number;
      approvers: WithdrawalApprover[];
      charge_kind: DepartmentRow['chargeKind'];
      in_school_exit: boolean;
      auto_check: DepartmentRow['autoCheck'];
      auto_clear: boolean;
      bypass_allowed: boolean;
      document_required: boolean;
      gates_tc: boolean;
      status: string;
    }>(
      `SELECT id::text, code, name, step, approvers, auto_check, auto_clear, bypass_allowed, document_required, gates_tc, status::text,
              charge_kind, in_school_exit
         FROM withdrawal_departments WHERE ($1 = false OR status = 'active') AND process = $2 ORDER BY step, sort_order, id`,
      [activeOnly, process],
    );
    return r.rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      step: d.step,
      approvers: d.approvers,
      approverLabels: d.approvers.map(approverName),
      autoCheck: d.auto_check,
      chargeKind: d.charge_kind,
      inSchoolExit: d.in_school_exit,
      autoClear: d.auto_clear,
      bypassAllowed: d.bypass_allowed,
      documentRequired: d.document_required,
      gatesTc: d.gates_tc,
      active: d.status === 'active',
    }));
  }

  async departments(ctx: RequestContext, process: WithdrawalProcess = 'school') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const roles = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'support_engineer') AND deleted_at IS NULL ORDER BY name`,
      );
      const staff = await c.query<{ user_id: string; name: string; designation: string | null }>(
        `SELECT e.user_id::text, e.display_name AS name, e.designation FROM employees e
          WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL ORDER BY e.display_name`,
      );
      return {
        departments: await this.departmentsIn(c, false, process),
        roles: roles.rows,
        staff: staff.rows.map((x) => ({
          userId: x.user_id,
          name: x.name,
          designation: x.designation,
        })),
      };
    });
  }

  async saveDepartments(
    ctx: RequestContext,
    dto: SaveDepartmentsDto,
    process: WithdrawalProcess = 'school',
  ) {
    const codes = dto.departments.map((d) => d.code);
    if (new Set(codes).size !== codes.length)
      throw new DomainError('validation-failed', 'Each department needs its own code', {
        status: 400,
      });
    if (!dto.departments.some((d) => d.active))
      throw new DomainError('validation-failed', 'Keep at least one department active', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureDepartments(c, process);
      const approvers = dto.departments.flatMap((d) => d.approvers);
      const roleIds = approvers.flatMap((a) => (a.kind === 'role' ? [a.roleId] : []));
      const userIds = approvers.flatMap((a) => (a.kind === 'user' ? [a.userId] : []));
      if (roleIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT id)::int AS n FROM roles WHERE id = ANY($1::bigint[]) AND (school_id IS NULL OR school_id = app.current_school_id())`,
          [roleIds],
        );
        if (r.rows[0]!.n !== new Set(roleIds).size)
          throw new DomainError('validation-failed', 'An approver role does not exist', {
            status: 400,
          });
      }
      if (userIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT user_id)::int AS n FROM employees WHERE user_id = ANY($1::bigint[]) AND deleted_at IS NULL`,
          [userIds],
        );
        if (r.rows[0]!.n !== new Set(userIds).size)
          throw new DomainError(
            'validation-failed',
            'An approver is not an employee of this school with a login',
            { status: 400 },
          );
      }
      const hostel = process === 'hostel';
      const wrongCheck = dto.departments.find((d) =>
        hostel
          ? d.autoCheck === 'fees' || d.autoCheck === 'library'
          : d.autoCheck === 'hostel_fees',
      );
      if (wrongCheck)
        throw new DomainError(
          'validation-failed',
          `${wrongCheck.name}: that automatic check belongs to the other withdrawal`,
          { status: 400 },
        );
      const before = await this.departmentsIn(c, false, process);
      let order = 0;
      for (const d of dto.departments)
        await c.query(
          `INSERT INTO withdrawal_departments (school_id, code, name, step, approvers, auto_check, auto_clear, bypass_allowed, document_required, gates_tc, sort_order, status,
                                               process, charge_kind, in_school_exit, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::row_status, $12, $13, $14, app.current_user_id(), app.current_user_id())
           ON CONFLICT (school_id, process, code) DO UPDATE SET name = EXCLUDED.name, step = EXCLUDED.step, approvers = EXCLUDED.approvers,
             auto_check = EXCLUDED.auto_check, auto_clear = EXCLUDED.auto_clear, bypass_allowed = EXCLUDED.bypass_allowed,
             document_required = EXCLUDED.document_required, gates_tc = EXCLUDED.gates_tc, sort_order = EXCLUDED.sort_order,
             status = EXCLUDED.status, charge_kind = EXCLUDED.charge_kind, in_school_exit = EXCLUDED.in_school_exit,
             updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [
            d.code,
            d.name,
            d.step,
            JSON.stringify(d.approvers),
            d.autoCheck,
            d.autoCheck !== 'none' && d.autoClear,
            d.bypassAllowed,
            d.documentRequired,
            !hostel && d.gatesTc,
            (order += 1),
            d.active ? 'active' : 'inactive',
            process,
            hostel ? d.chargeKind : null,
            hostel && d.inSchoolExit,
          ],
        );
      // departments left out of the list are switched off (their past clearances stay)
      await c.query(
        `UPDATE withdrawal_departments SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id()
          WHERE process = $2 AND code <> ALL($1::text[])`,
        [codes, process],
      );
      const after = await this.departmentsIn(c, false, process);
      await this.audit.stage(ctx, c, {
        action: hostel
          ? 'hostel.withdrawal.departments_save'
          : 'people.withdrawal.departments_save',
        entityType: 'withdrawal_departments',
        entityId: requireTenant(ctx).schoolId,
        before: before.map((d) => ({ code: d.code, step: d.step, active: d.active })),
        after: after.map((d) => ({ code: d.code, step: d.step, active: d.active })),
      });
      return after;
    });
  }

  // ---- reading -------------------------------------------------------------------------------------
  private async actor(c: PoolClient, ctx: RequestContext): Promise<Actor> {
    const roles = await c.query<{ role_id: string }>(
      `SELECT role_id::text FROM user_roles WHERE user_id = app.current_user_id() AND revoked_at IS NULL
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
    );
    const sections = await c.query<{ id: string }>(
      `SELECT ta.class_section_id::text AS id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL`,
    );
    const hostels = await c.query<{ id: string }>(
      `SELECT hw.hostel_id::text AS id FROM hostel_wardens hw JOIN employees e ON e.id = hw.employee_id
        WHERE e.user_id = app.current_user_id()`,
    );
    return {
      userId: ctx.user.id,
      roleIds: new Set(roles.rows.map((x) => x.role_id)),
      sections: new Set(sections.rows.map((x) => x.id)),
      hostels: new Set(hostels.rows.map((x) => x.id)),
      manage: ctx.permissions?.has(LIFECYCLE.withdrawalManage) ?? false,
    };
  }

  private named(
    a: WithdrawalApprover,
    actor: Actor,
    classSectionId: string | null,
    hostelId: string | null = null,
  ): boolean {
    if (a.kind === 'office') return actor.manage;
    if (a.kind === 'class_teacher')
      return classSectionId !== null && actor.sections.has(classSectionId);
    if (a.kind === 'hostel_warden') return hostelId !== null && actor.hostels.has(hostelId);
    if (a.kind === 'role') return actor.roleIds.has(a.roleId);
    return a.userId === actor.userId;
  }

  private view(r: Db, actor: Actor | null): WithdrawalRow {
    const open = r.status === 'requested' || r.status === 'cleared';
    const clearances: ClearanceRow[] = r.clearances.map(({ approverList, ...x }) => ({
      ...x,
      approvers: approverList.map(approverName),
      canAct: actor
        ? open &&
          x.status !== 'cleared' &&
          x.step === r.current_step &&
          (actor.manage ||
            approverList.some((a) => this.named(a, actor, r.class_section_id, r.hostel_id)))
        : undefined,
    }));
    const gates = clearances.filter((x) => x.gatesTc);
    const gateCleared = gates.length
      ? gates.every((x) => x.status === 'cleared')
      : r.status !== 'requested';
    return {
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      admissionNo: r.admission_no,
      section: r.section,
      initiatedOn: r.initiated_on,
      requestedOn: r.requested_on,
      leavingOn: r.leaving_on,
      reason: r.reason,
      remarks: r.remarks,
      documents: r.documents ?? [],
      status: r.status,
      currentStep: r.current_step,
      requestedBy: r.requested_by,
      completedAt: r.completed_at ? r.completed_at.toISOString() : null,
      cancelReason: r.cancel_reason,
      revokeStatus: r.revoke_status,
      revokeReason: r.revoke_reason,
      revokeWaitingWith: r.revoke_waiting_with,
      refundState: r.refund_state,
      refundAmount: r.refund_amount,
      revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
      hostelStay: r.hostel_stay,
      revokeHostel: r.revoke_hostel_mode
        ? { mode: r.revoke_hostel_mode, fromDate: r.revoke_hostel_from, note: r.revoke_hostel_note }
        : null,
      tc: r.tc,
      clearances,
      canIssueTc: r.status !== 'cancelled' && r.status !== 'revoked' && !r.tc && gateCleared,
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

  async list(
    ctx: RequestContext,
    q: ListWithdrawalsQueryDto,
  ): Promise<{ rows: WithdrawalRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.status === 'open' || q.mine) where.push(`w.status IN ('requested', 'cleared')`);
      else if (q.status === 'all') where.push('true');
      else {
        params.push(q.status);
        where.push(`w.status = $${params.length}::withdrawal_status`);
      }
      if (q.classSectionId) {
        params.push(q.classSectionId);
        where.push(`sec.class_section_id = $${params.length}::text`);
      }
      if (q.classId) {
        params.push(q.classId);
        where.push(`sec.class_id = $${params.length}::text`);
      }
      if (q.leavingFrom) {
        params.push(q.leavingFrom);
        where.push(`w.leaving_on >= $${params.length}::date`);
      }
      if (q.leavingTo) {
        params.push(q.leavingTo);
        where.push(`w.leaving_on <= $${params.length}::date`);
      }
      if (q.tc) where.push(q.tc === 'issued' ? 't.id IS NOT NULL' : 't.id IS NULL');
      if (q.refund) {
        params.push(q.refund);
        where.push(`rf.state = $${params.length}`);
      }
      if (q.q) {
        params.push(`%${q.q.toLowerCase()}%`);
        where.push(
          `(lower(s.display_name) LIKE $${params.length} OR lower(s.admission_no) LIKE $${params.length})`,
        );
      }
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where joins fixed fragments; values are bound parameters
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY w.requested_on DESC, w.id DESC LIMIT 2000`,
        params,
      );
      let rows = r.rows.map((x) => this.view(x, actor));
      // "awaiting me": a department at the current step names me (the office sees only office steps)
      if (q.mine)
        rows = rows.filter((w) =>
          r.rows
            .find((x) => x.id === w.id)!
            .clearances.some(
              (x) =>
                x.status !== 'cleared' &&
                x.step === w.currentStep &&
                x.approverList.some((a) => {
                  const row = r.rows.find((y) => y.id === w.id)!;
                  return this.named(a, actor, row.class_section_id, row.hostel_id);
                }),
            ),
        );
      const total = rows.length;
      return { rows: rows.slice((q.page - 1) * q.size, q.page * q.size), total };
    });
  }

  /** The register as filtered on the screen (every page of it) as Excel or PDF, made at once. */
  async listFile(ctx: RequestContext, q: ListWithdrawalsQueryDto, format: 'xlsx' | 'pdf') {
    const { rows } = await this.list(ctx, { ...q, page: 1, size: 2000 });
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const d = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
    const STATUS: Record<string, string> = {
      requested: 'In clearance',
      cleared: 'Cleared',
      completed: 'Completed',
      cancelled: 'Cancelled',
      revoked: 'Revoked',
    };
    const REFUND: Record<string, string> = {
      none: '',
      not_sent: 'Not sent',
      waiting: 'Waiting for approval',
      paid: 'Paid',
    };
    const filters = [
      q.mine
        ? 'Waiting for me'
        : q.status === 'open'
          ? 'Open'
          : q.status === 'all'
            ? 'All'
            : STATUS[q.status],
      q.leavingFrom || q.leavingTo
        ? `Leaving ${d(q.leavingFrom ?? null) || '…'} to ${d(q.leavingTo ?? null) || '…'}`
        : '',
      q.tc ? (q.tc === 'issued' ? 'TC issued' : 'TC not issued') : '',
      q.refund ? `Refund: ${REFUND[q.refund] || 'none'}` : '',
      q.q ? `Search: ${q.q}` : '',
      `${String(rows.length)} record(s)`,
    ].filter(Boolean) as string[];
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Withdrawal register',
        details: [filters.join(' · '), generatedOn()],
        legend: '',
        columns: [
          { label: 'Sr', width: 3, right: true },
          { label: 'Admission no.', width: 8 },
          { label: 'Student', width: 14 },
          { label: 'Class', width: 6 },
          { label: 'Started', width: 7 },
          { label: 'Leaving on', width: 7 },
          { label: 'Reason', width: 16 },
          { label: 'Waiting with', width: 12 },
          { label: 'TC no.', width: 8 },
          { label: 'Refund', width: 9 },
          { label: 'Refund amount', width: 8, right: true },
          { label: 'Status', width: 8 },
        ],
        rows: rows.map((w, i) => [
          i + 1,
          w.admissionNo,
          w.studentName,
          w.section ?? '',
          d(w.initiatedOn),
          d(w.leavingOn),
          w.reason,
          w.status === 'requested'
            ? w.clearances
                .filter((x) => x.step === w.currentStep && x.status !== 'cleared')
                .map((x) => x.departmentName)
                .join(', ')
            : '',
          w.tc?.tcNo ?? '',
          REFUND[w.refundState] ?? '',
          w.refundState === 'none' ? '' : Number(w.refundAmount),
          STATUS[w.status] ?? w.status,
        ]),
        filename: 'withdrawal-register',
      },
      format,
    );
  }

  async get(ctx: RequestContext, id: string): Promise<WithdrawalRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.findDb(c, id);
      if (!row) throw new DomainError('not-found', 'Withdrawal not found');
      return this.view(row, await this.actor(c, ctx));
    });
  }

  async forStudent(ctx: RequestContext, studentId: string): Promise<WithdrawalRow[]> {
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

  private async startIn(
    c: PoolClient,
    ctx: RequestContext,
    studentId: string,
    dto: RequestWithdrawalDto & { batchId?: string },
  ): Promise<string> {
    const tenant = requireTenant(ctx);
    const s = await c.query<{ status: string }>(
      `SELECT status::text FROM students WHERE id = $1 AND deleted_at IS NULL`,
      [studentId],
    );
    if (!s.rows[0]) throw new DomainError('not-found', 'Student not found');
    if (s.rows[0].status !== 'active')
      throw new DomainError('withdrawal.student_inactive', 'The student is not active', {
        status: 409,
      });
    const departments = await this.departmentsIn(c, true);
    if (!departments.length)
      throw new DomainError(
        'withdrawal.no_departments',
        'Set up the withdrawal departments first',
        {
          status: 409,
        },
      );
    await this.checkLeavingDate(c, studentId, dto.leavingOn);
    const documents = await this.checkFiles(c, dto.documents ?? []);
    const firstStep = Math.min(...departments.map((d) => d.step));
    let id: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO student_withdrawals (school_id, student_id, academic_year_id, initiated_on, leaving_on, reason, remarks, documents, current_step, batch_id, requested_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, COALESCE($3::date, CURRENT_DATE), $4::date, $5, $6, $7::jsonb, $8, $9::uuid, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          studentId,
          tenant.academicYearId,
          dto.initiatedOn ?? null,
          dto.leavingOn,
          dto.reason,
          dto.remarks ?? null,
          JSON.stringify(documents),
          firstStep,
          dto.batchId ?? null,
        ],
      );
      id = r.rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new DomainError(
          'withdrawal.open_exists',
          'The student already has an open withdrawal',
          {
            status: 409,
          },
        );
      throw error;
    }
    for (const d of departments)
      await c.query(
        `INSERT INTO withdrawal_clearances (school_id, withdrawal_id, department, department_id, step) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
        [id, d.code, d.id, d.step],
      );
    // a hosteller (a bed held on the leaving date or after) is also cleared by the hostel's steps
    // (Hostel -> Withdrawals -> Steps; docs/design/27-hostel-withdrawal.md)
    const boarder = await c.query(
      `SELECT 1 FROM hostel_allotments WHERE student_id = $1 AND (to_date IS NULL OR to_date >= $2::date)`,
      [studentId, dto.leavingOn],
    );
    if (boarder.rowCount)
      for (const d of await this.departmentsIn(c, true, 'hostel')) {
        if (departments.some((x) => x.code === d.code)) continue;
        departments.push(d);
        await c.query(
          `INSERT INTO withdrawal_clearances (school_id, withdrawal_id, department, department_id, step) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
          [id, d.code, d.id, d.step],
        );
      }
    if (boarder.rowCount) await this.advance(c, id);
    await this.audit.stage(ctx, c, {
      action: 'people.withdrawal.request',
      entityType: 'student_withdrawals',
      entityId: id,
      after: {
        studentId,
        initiatedOn: dto.initiatedOn ?? null,
        leavingOn: dto.leavingOn,
        reason: dto.reason,
        documents: documents.length,
        departments: departments.map((d) => `${d.step}:${d.code}`),
        batchId: dto.batchId ?? null,
      },
    });
    return id;
  }

  async request(
    ctx: RequestContext,
    studentId: string,
    dto: RequestWithdrawalDto,
  ): Promise<WithdrawalRow> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const id = await this.db.tenant(tenant, (c) => this.startIn(c, ctx, studentId, dto));
    await this.runChecks(ctx, id);
    return this.get(ctx, id);
  }

  /** Many students with one leaving date and reason (e.g. Class XII at the year end). */
  async bulkRequest(ctx: RequestContext, dto: BulkWithdrawalDto) {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const batchId = randomUUID();
    const results: Array<{ studentId: string; ok: boolean; id?: string; error?: string }> = [];
    for (const studentId of [...new Set(dto.studentIds)]) {
      try {
        const id = await this.db.tenant(tenant, (c) =>
          this.startIn(c, ctx, studentId, { ...dto, documents: [], batchId }),
        );
        await this.runChecks(ctx, id);
        results.push({ studentId, ok: true, id });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ studentId, ok: false, error: error.message });
      }
    }
    return {
      batchId,
      started: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ---- automatic checks and steps ----------------------------------------------------------------------
  /**
   * Fee dues up to the leaving date (balance and late fee outstanding), from the live ledger; the hostel
   * check counts the hostel fee only.
   */
  async feeDues(
    ctx: RequestContext,
    studentId: string,
    leavingOn: string,
    only: 'all' | 'hostel' = 'all',
  ) {
    const kind = only === 'hostel' ? 'hostel_fees' : 'fees';
    const what = only === 'hostel' ? 'hostel fee' : 'fees';
    try {
      const l = await this.ledger.ledger(ctx, studentId);
      const due = l.instalments
        .filter((i) => i.dueOn <= leavingOn && (only === 'all' || i.ledger === 'hostel'))
        .reduce((n, i) => n + Number(i.balance) + Number(i.lateFee.outstanding), 0);
      return {
        kind,
        due: Math.max(Math.round(due * 100) / 100, 0),
        detail:
          due > 0
            ? `${money(due)} ${what} due up to the leaving date`
            : `No ${what} due up to the leaving date`,
      };
    } catch (error) {
      if (error instanceof DomainError && error.status === 404)
        return { kind, due: 0, detail: 'No fee ledger for this student' };
      throw error;
    }
  }

  private async libraryDues(c: PoolClient, studentId: string) {
    const r = await c.query<{ open: number; fines: string }>(
      `SELECT count(*) FILTER (WHERE returned_on IS NULL)::int AS open,
              COALESCE(sum(fine_amount - fine_waived) FILTER (WHERE fine_amount > fine_waived AND fine_receipt_id IS NULL), 0)::text AS fines
         FROM library_loans WHERE borrower_kind = 'student' AND borrower_id = $1`,
      [studentId],
    );
    const open = r.rows[0]?.open ?? 0;
    const fines = Number(r.rows[0]?.fines ?? 0);
    const parts = [
      open ? `${String(open)} book${open === 1 ? '' : 's'} not returned` : null,
      fines ? `${money(fines)} fine unpaid` : null,
    ].filter(Boolean);
    return {
      kind: 'library',
      due: open + fines,
      detail: parts.length ? parts.join(', ') : 'No books out and no fines',
    };
  }

  /** Moves to the next step once every department of the current one has cleared. */
  private async advance(c: PoolClient, id: string) {
    await c.query(
      `UPDATE student_withdrawals w SET
          current_step = (SELECT min(step) FROM withdrawal_clearances WHERE withdrawal_id = w.id AND status <> 'cleared'),
          status = CASE WHEN EXISTS (SELECT 1 FROM withdrawal_clearances WHERE withdrawal_id = w.id AND status <> 'cleared')
                        THEN 'requested' ELSE 'cleared' END::withdrawal_status,
          updated_at = now()
        WHERE w.id = $1 AND w.status IN ('requested', 'cleared')`,
      [id],
    );
  }

  /**
   * Runs the automatic checks of the departments at the current step, clears those that may clear
   * themselves when nothing is due, and repeats while that opens the next step.
   */
  private async runChecks(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    for (let round = 0; round < 10; round += 1) {
      const w = await this.db.tenant(tenant, (c) => this.findDb(c, id));
      if (!w || w.status !== 'requested' || w.current_step === null) return;
      const due = w.clearances.filter(
        (x) => x.step === w.current_step && x.status !== 'cleared' && !x.check,
      );
      const checks = await Promise.all(
        due.map(async (x) => {
          const dep = await this.db.tenant(tenant, (c) =>
            c.query<{ auto_check: string; auto_clear: boolean }>(
              `SELECT d.auto_check, d.auto_clear FROM withdrawal_clearances x JOIN withdrawal_departments d ON d.id = x.department_id WHERE x.id = $1`,
              [x.id],
            ),
          );
          const kind = dep.rows[0]?.auto_check ?? 'none';
          if (kind === 'none') return null;
          const result =
            kind === 'fees' || kind === 'hostel_fees'
              ? await this.feeDues(
                  ctx,
                  w.student_id,
                  w.leaving_on,
                  kind === 'hostel_fees' ? 'hostel' : 'all',
                )
              : await this.db.tenant(tenant, (c) => this.libraryDues(c, w.student_id));
          return { clearanceId: x.id, result, autoClear: dep.rows[0]!.auto_clear };
        }),
      );
      const done = checks.filter((x): x is NonNullable<typeof x> => x !== null);
      if (!done.length) return;
      const stepBefore = w.current_step;
      const stepAfter = await this.db.tenant(tenant, async (c) => {
        for (const ch of done) {
          const clear = ch.autoClear && ch.result.due === 0;
          await c.query(
            `UPDATE withdrawal_clearances SET check_result = $2::jsonb,
                    dues = CASE WHEN $4 IN ('fees', 'hostel_fees') THEN $5 ELSE dues END,
                    status = CASE WHEN $3 THEN 'cleared'::clearance_status ELSE status END,
                    auto = $3, remarks = CASE WHEN $3 THEN 'Cleared automatically: ' || $6 ELSE remarks END,
                    acted_at = CASE WHEN $3 THEN now() ELSE acted_at END
              WHERE id = $1`,
            [
              ch.clearanceId,
              JSON.stringify(ch.result),
              clear,
              ch.result.kind,
              ch.result.kind === 'library' ? 0 : ch.result.due,
              ch.result.detail,
            ],
          );
        }
        await this.advance(c, id);
        const r = await c.query<{ current_step: number | null }>(
          `SELECT current_step FROM student_withdrawals WHERE id = $1`,
          [id],
        );
        return r.rows[0]?.current_step ?? null;
      });
      if (stepAfter === stepBefore) return;
    }
  }

  // ---- department actions ------------------------------------------------------------------------------
  private async actOn(
    ctx: RequestContext,
    id: string,
    department: string,
    apply: (c: PoolClient, x: Db['clearances'][number], w: Db) => Promise<Record<string, unknown>>,
    action: string,
  ): Promise<WithdrawalRow> {
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(w.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          {
            status: 409,
          },
        );
      const x = w.clearances.find((y) => y.department === department);
      if (!x) throw new DomainError('not-found', `No clearance for department "${department}"`);
      if (x.step !== w.current_step && x.status !== 'cleared')
        throw new DomainError(
          'withdrawal.not_this_step',
          `${x.departmentName} acts at step ${String(x.step)}; the withdrawal is at step ${String(w.current_step ?? '-')}`,
          { status: 409 },
        );
      const actor = await this.actor(c, ctx);
      if (
        !actor.manage &&
        !x.approverList.some((a) => this.named(a, actor, w.class_section_id, w.hostel_id))
      )
        throw new DomainError(
          'withdrawal.not_assigned',
          `${x.departmentName} is cleared by ${x.approverList.map(approverName).join(' or ')}`,
          { status: 403 },
        );
      const after = await apply(c, x, w);
      await this.advance(c, id);
      await this.audit.stage(ctx, c, {
        action,
        entityType: 'student_withdrawals',
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
        // a hostel department of a hosteller's withdrawal: damages or mess dues become a misc fee
        const charge = await raiseHostelCharge(c, {
          department: x,
          amount: dto.charge ?? 0,
          studentId: w.student_id,
          yearId: w.year_id,
          what: `leaving the school on ${w.leaving_on.split('-').reverse().join('-')}`,
        });
        await c.query(
          `UPDATE withdrawal_clearances SET status = $2::clearance_status, dues = $3, remarks = $4, documents = $5::jsonb,
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
        };
      },
      'people.withdrawal.clear',
    );
  }

  /** Skips a department the school allows to be bypassed; the reason is kept with the clearance. */
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
          `UPDATE withdrawal_clearances SET status = 'cleared', bypassed = true, auto = false, remarks = $2,
                  acted_by = app.current_user_id(), acted_at = now() WHERE id = $1`,
          [x.id, `Bypassed: ${dto.reason}`],
        );
        return { status: 'cleared', bypassed: true, reason: dto.reason };
      },
      'people.withdrawal.bypass',
    );
  }

  /** The same decision for one department on many withdrawals; each stands alone. */
  async bulkClearance(ctx: RequestContext, dto: BulkClearanceDto) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of [...new Set(dto.withdrawalIds)]) {
      try {
        await this.clearance(ctx, id, dto.department, {
          status: dto.status,
          dues: 0,
          remarks: dto.remarks,
          documents: dto.documents ?? [],
          charge: 0,
        });
        results.push({ id, ok: true });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ id, ok: false, error: error.message });
      }
    }
    return {
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  // ---- TC, completion, cancel ----------------------------------------------------------------------------
  async issueTc(
    ctx: RequestContext,
    id: string,
    dto: Omit<BulkTcDto, 'withdrawalIds'>,
  ): Promise<WithdrawalRow> {
    const w = await this.get(ctx, id);
    if (w.status === 'cancelled')
      throw new DomainError('withdrawal.not_open', 'The withdrawal was cancelled', { status: 409 });
    if (w.tc)
      throw new DomainError('tc.already_issued', `TC ${w.tc.tcNo} is already issued`, {
        status: 409,
      });
    if (!w.canIssueTc) {
      const waiting = w.clearances.filter((x) => x.gatesTc && x.status !== 'cleared');
      throw new DomainError(
        'withdrawal.tc_gated',
        `The TC can be issued after ${waiting.map((x) => x.departmentName).join(', ') || 'every department'} clears`,
        { status: 409 },
      );
    }
    const tc = await this.tcs.issue(
      ctx,
      w.studentId,
      {
        reason: dto.reason ?? w.reason,
        issuedOn: dto.issuedOn ?? w.leavingOn,
        conduct: dto.conduct ?? 'Good',
        promotionStatus: dto.promotionStatus,
        duesCleared: true,
        remarks: dto.remarks,
      },
      { keepStatus: w.status !== 'completed' },
    );
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`UPDATE student_withdrawals SET tc_id = $2, updated_at = now() WHERE id = $1`, [
        id,
        tc.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.tc',
        entityType: 'student_withdrawals',
        entityId: id,
        after: { tcNo: tc.tcNo, tcId: tc.id },
      });
    });
    return this.get(ctx, id);
  }

  async bulkTc(ctx: RequestContext, dto: BulkTcDto) {
    const results: Array<{
      id: string;
      ok: boolean;
      tcNo?: string;
      exportId?: string | null;
      error?: string;
    }> = [];
    for (const id of [...new Set(dto.withdrawalIds)]) {
      try {
        const w = await this.issueTc(ctx, id, dto);
        results.push({ id, ok: true, tcNo: w.tc?.tcNo, exportId: w.tc?.exportId ?? null });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ id, ok: false, error: error.message });
      }
    }
    return {
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /**
   * A boarder cannot leave the school before the hostel stay held now began: the bed and the hostel fee
   * would end before they start. Correct the leaving date, or end that stay first.
   */
  private async checkLeavingDate(c: PoolClient, studentId: string, leavingOn: string) {
    const stay = (
      await c.query<{ from: string }>(
        `SELECT min(from_date)::text AS from FROM hostel_allotments
          WHERE student_id = $1 AND from_date > $2::date AND (to_date IS NULL OR to_date > $2::date)`,
        [studentId, leavingOn],
      )
    ).rows[0]?.from;
    if (stay) {
      const dmy = (d: string) => d.split('-').reverse().join('-');
      throw new DomainError(
        'withdrawal.before_hostel',
        `The pupil stays in the hostel from ${dmy(stay)}, after the leaving date ${dmy(leavingOn)}. Change the leaving date to that day or later, or end the hostel stay first.`,
        { status: 409 },
      );
    }
  }

  /**
   * A new leaving date for an open withdrawal. The dues depend on it, so the fee departments (the fee
   * check) are opened again and checked afresh; a pupil who now holds a bed on the leaving date gets the
   * hostel's steps. Not once the TC is issued (it carries the date).
   */
  async changeLeavingDate(
    ctx: RequestContext,
    id: string,
    leavingOn: string,
    note?: string,
  ): Promise<WithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await this.findDb(c, id, true);
      if (!w) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(w.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          { status: 409 },
        );
      if (w.tc)
        throw new DomainError(
          'withdrawal.tc_issued',
          `TC ${w.tc.tcNo} is issued with the old date: cancel the TC first`,
          { status: 409 },
        );
      if (leavingOn === w.leaving_on) return;
      await this.checkLeavingDate(c, w.student_id, leavingOn);
      await c.query(
        `UPDATE student_withdrawals SET leaving_on = $2::date, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, leavingOn],
      );
      const reopened = await c.query<{ department: string }>(
        `UPDATE withdrawal_clearances x SET status = 'pending', auto = false, bypassed = false, check_result = NULL,
                remarks = 'Opened again: the leaving date changed', acted_by = NULL, acted_at = NULL
           FROM withdrawal_departments d
          WHERE d.id = x.department_id AND x.withdrawal_id = $1 AND x.status <> 'pending'
            AND (d.auto_check IN ('fees', 'hostel_fees') OR x.department = 'fees')
        RETURNING x.department`,
        [id],
      );
      const added: string[] = [];
      const boarder = await c.query(
        `SELECT 1 FROM hostel_allotments WHERE student_id = $1 AND (to_date IS NULL OR to_date >= $2::date)`,
        [w.student_id, leavingOn],
      );
      if (boarder.rowCount)
        for (const d of await this.departmentsIn(c, true, 'hostel')) {
          if (w.clearances.some((x) => x.department === d.code)) continue;
          await c.query(
            `INSERT INTO withdrawal_clearances (school_id, withdrawal_id, department, department_id, step) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
            [id, d.code, d.id, d.step],
          );
          added.push(d.code);
        }
      await this.advance(c, id);
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.leaving_date',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { leavingOn: w.leaving_on },
        after: {
          leavingOn,
          note: note ?? null,
          reopened: reopened.rows.map((r) => r.department),
          added,
        },
      });
    });
    await this.runChecks(ctx, id);
    return this.get(ctx, id);
  }

  async complete(ctx: RequestContext, id: string): Promise<WithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findDb(c, id);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      await this.checkLeavingDate(c, before.student_id, before.leaving_on);
      await c.query(`SELECT app.complete_withdrawal($1)`, [id]);
      // a hosteller: the bed is given up on the leaving date and the hostel fee ends with that month (the
      // later months are cut below with the school fee); an open hostel withdrawal is closed
      const bed = await c.query<{ id: string }>(
        `UPDATE hostel_allotments SET to_date = GREATEST(from_date, $2::date), end_reason = 'withdrawn',
                end_remarks = 'Left the school', ended_at = now(), ended_by = app.current_user_id()
          WHERE student_id = $1 AND (to_date IS NULL OR to_date > $2::date)
        RETURNING id::text`,
        [before.student_id, before.leaving_on],
      );
      if (bed.rowCount) {
        await c.query(
          `UPDATE student_fee_profiles SET hostel_to = date_trunc('month', $3::date)::date, updated_at = now(), updated_by = app.current_user_id()
            WHERE student_id = $1 AND academic_year_id = $2 AND hosteller`,
          [before.student_id, before.year_id, before.leaving_on],
        );
        await c.query(
          `UPDATE hostel_withdrawals SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Left the school', updated_at = now()
            WHERE student_id = $1 AND status IN ('requested', 'cleared')`,
          [before.student_id],
        );
      }
      // fee: later months are not charged. The refund is not raised here: the accounts office prints
      // the provisional bill, meets the parent, and then sends the refund for approval (resettleFees)
      const year = await c.query<{ id: string | null }>(
        `SELECT academic_year_id::text AS id FROM student_withdrawals WHERE id = $1`,
        [id],
      );
      const fee = year.rows[0]?.id
        ? await settleWithdrawalFees(
            this.workflow,
            c,
            ctx,
            {
              id,
              studentId: before.student_id,
              leavingOn: before.leaving_on,
              yearId: year.rows[0].id,
            },
            false,
          )
        : null;
      // a parent keeps the login while another child of theirs still studies here
      const parents = await c.query<{ user_id: string }>(
        `SELECT DISTINCT g.user_id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = $1 AND g.user_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM student_guardians sg2 JOIN students s2 ON s2.id = sg2.student_id
                             WHERE sg2.guardian_id = g.id AND s2.id <> $1 AND s2.status = 'active' AND s2.deleted_at IS NULL)`,
        [before.student_id],
      );
      // after leaving: either the logins close, or (people.former_portal_days) they stay open for a
      // while with the rights of the "Former student / parent" roles only
      const days = await this.formerPortalDays(c);
      if (days > 0) {
        const su = await c.query<{ user_id: string | null }>(
          `SELECT user_id::text FROM students WHERE id = $1`,
          [before.student_id],
        );
        if (su.rows[0]?.user_id)
          await this.switchToFormer(c, su.rows[0].user_id, 'student', id, days);
        for (const p of parents.rows) await this.switchToFormer(c, p.user_id, 'parent', id, days);
      } else if (parents.rows.length)
        await c.query(
          `UPDATE user_school_memberships SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id()
            WHERE school_id = app.current_school_id() AND person_type = 'guardian' AND user_id = ANY($1::bigint[])`,
          [parents.rows.map((p) => p.user_id)],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.complete',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { status: before.status },
        after: {
          status: 'completed',
          studentId: before.student_id,
          leavingOn: before.leaving_on,
          parentLoginsRevoked: parents.rows.length,
          bedsGivenUp: bed.rowCount ?? 0,
          fee,
        },
      });
    });
    // the pupil's and the parents' rights changed: drop the cached sets so it shows at once
    await this.access.invalidateSchool(requireTenant(ctx).schoolId);
    return this.get(ctx, id);
  }

  /**
   * The accounts office sends the refund of a completed withdrawal for approval, after the provisional
   * bill has been printed and discussed with the parent: fee paid for the months after the leaving
   * month, and any advance. Pressed again, it closes the refund that still waits (with its approval)
   * and raises it afresh. A refund already paid is not touched.
   */
  async resettleFees(ctx: RequestContext, id: string, draft = false) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await c.query<{
        status: string;
        student_id: string;
        leaving_on: string;
        year: string | null;
      }>(
        `SELECT status::text, student_id::text, leaving_on::text, academic_year_id::text AS year FROM student_withdrawals WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = w.rows[0];
      if (!row) throw new DomainError('not-found', 'Withdrawal not found');
      if (row.status !== 'completed' || !row.year)
        throw new DomainError(
          'withdrawal.not_completed',
          'The fee is settled only for a completed withdrawal',
          { status: 409 },
        );
      if (draft) {
        // a draft is only a paper to print: it never takes the place of a refund already sent
        const sent = await c.query(
          `SELECT 1 FROM fee_refunds WHERE withdrawal_id = $1 AND status IN ('requested', 'approved')`,
          [id],
        );
        if (sent.rowCount)
          throw new DomainError(
            'fees.refund_open',
            'The refund of this withdrawal is already sent for approval',
            { status: 409 },
          );
        const fee = await settleWithdrawalFees(
          this.workflow,
          c,
          ctx,
          { id, studentId: row.student_id, leavingOn: row.leaving_on, yearId: row.year },
          'draft',
        );
        if (!fee.draftId)
          throw new DomainError(
            'fees.nothing_to_refund',
            'Nothing is refundable by the rule for this withdrawal',
            { status: 409 },
          );
        await this.audit.stage(ctx, c, {
          action: 'people.withdrawal.fee_refund_draft',
          entityType: 'student_withdrawals',
          entityId: id,
          after: { fee },
        });
        return { replaced: 0, ...fee };
      }
      const old = await c.query<{ id: string; workflow_instance_id: string | null }>(
        `UPDATE fee_refunds SET status = 'rejected', decided_by = app.current_user_id(), decided_at = now(),
                decision_note = 'Replaced: the withdrawal refund was worked out again'
          WHERE withdrawal_id = $1 AND status = 'requested'
        RETURNING id::text, workflow_instance_id::text`,
        [id],
      );
      const instances = [
        ...new Set(old.rows.map((r) => r.workflow_instance_id).filter((x): x is string => !!x)),
      ];
      if (instances.length) {
        await c.query(
          `UPDATE workflow_steps SET status = 'skipped' WHERE instance_id = ANY($1::bigint[]) AND status = 'pending'`,
          [instances],
        );
        await c.query(
          `UPDATE workflow_instances SET status = 'cancelled', completed_at = now(), updated_at = now()
            WHERE id = ANY($1::bigint[]) AND status = 'pending'`,
          [instances],
        );
      }
      const fee = await settleWithdrawalFees(this.workflow, c, ctx, {
        id,
        studentId: row.student_id,
        leavingOn: row.leaving_on,
        yearId: row.year,
      });
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.fee_resettle',
        entityType: 'student_withdrawals',
        entityId: id,
        after: { replaced: old.rows.length, fee },
      });
      return { replaced: old.rows.length, ...fee };
    });
  }

  /**
   * Revoke of a completed withdrawal (the pupil rejoins in the same session). It is asked with a
   * reason and goes through Fee setup -> Approval levels; where the school has no levels in force it
   * is applied at once. Applying is app.revoke_withdrawal: the pupil is active again in the same class,
   * the logins come back, every month is charged again, a waiting refund of the withdrawal is closed
   * and the fee a paid refund cancelled becomes due again.
   */
  /** The hostel stay this withdrawal ended (to put a boarder back on a revoke). */
  private async hostelStayOf(c: PoolClient, id: string) {
    const r = await c.query<{
      allotment_id: string;
      student_id: string;
      year_id: string;
      left_on: string;
    }>(
      `SELECT ha.id::text AS allotment_id, w.student_id::text, w.academic_year_id::text AS year_id, ha.to_date::text AS left_on
         FROM student_withdrawals w JOIN hostel_allotments ha ON ha.student_id = w.student_id
        WHERE w.id = $1 AND ha.end_reason = 'withdrawn' AND ha.end_remarks = 'Left the school'
        ORDER BY ha.to_date DESC LIMIT 1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  private hostelReturn(
    stay: { allotment_id: string; student_id: string; year_id: string; left_on: string },
    h: { mode: 'continue' | 'from_date'; fromDate?: string; bedId?: string },
  ): HostelReturn {
    return {
      studentId: stay.student_id,
      yearId: stay.year_id,
      allotmentId: stay.allotment_id,
      leftOn: stay.left_on,
      // the school withdrawal closed the hostel fee with the leaving month
      feeUntil: `${stay.left_on.slice(0, 7)}-01`,
      mode: h.mode,
      fromDate: h.fromDate ?? null,
      bedId: h.bedId ?? null,
      remark: 'Back in the hostel: the school withdrawal was revoked',
    };
  }

  async requestRevoke(
    ctx: RequestContext,
    id: string,
    reason: string,
    hostel?: { mode: 'continue' | 'from_date'; fromDate?: string; bedId?: string } | null,
  ): Promise<WithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const w = await c.query<{
        status: string;
        revoke_status: string | null;
        year_status: string | null;
        tc: boolean;
        name: string;
        leaving_on: string;
      }>(
        `SELECT w.status::text, w.revoke_status, y.status::text AS year_status, w.leaving_on::text,
                EXISTS (SELECT 1 FROM transfer_certificates t WHERE t.id = w.tc_id AND t.status = 'issued') AS tc,
                (SELECT display_name FROM students WHERE id = w.student_id) AS name
           FROM student_withdrawals w LEFT JOIN academic_years y ON y.id = w.academic_year_id WHERE w.id = $1 FOR UPDATE OF w`,
        [id],
      );
      const row = w.rows[0];
      if (!row) throw new DomainError('not-found', 'Withdrawal not found');
      if (row.status !== 'completed')
        throw new DomainError(
          'withdrawal.not_completed',
          'Only a completed withdrawal can be revoked; one that is still open is cancelled instead',
          { status: 409 },
        );
      if (row.revoke_status === 'pending')
        throw new DomainError(
          'withdrawal.revoke_open',
          'A revoke of this withdrawal is already waiting for approval',
          { status: 409 },
        );
      if (row.year_status !== 'active')
        throw new DomainError(
          'withdrawal.revoke_other_session',
          'A withdrawal is revoked only in its own, current session',
          { status: 409 },
        );
      if (row.tc)
        throw new DomainError(
          'withdrawal.tc_issued',
          'A transfer certificate is issued: cancel it first, then revoke the withdrawal',
          { status: 409 },
        );
      // a boarder may come back to the hostel too: the bed must be free for it now
      const stay = hostel ? await this.hostelStayOf(c, id) : null;
      if (hostel && !stay)
        throw new DomainError(
          'withdrawal.not_boarder',
          'This withdrawal did not end a hostel stay',
          {
            status: 409,
          },
        );
      if (hostel && stay) await checkHostelReturn(c, this.hostelReturn(stay, hostel));
      await c.query(
        `UPDATE student_withdrawals SET revoke_status = 'pending', revoke_reason = $2, revoke_requested_by = app.current_user_id(),
                revoke_requested_at = now(), revoke_workflow_instance_id = NULL, revoke_hostel_mode = $3, revoke_hostel_from = $4::date,
                revoke_hostel_bed_id = $5, revoke_hostel_note = NULL, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          reason,
          hostel?.mode ?? null,
          hostel?.mode === 'from_date' ? (hostel.fromDate ?? null) : null,
          hostel?.mode === 'from_date' ? (hostel.bedId ?? null) : null,
        ],
      );
      const instanceId = await startFeeApproval(
        this.workflow,
        c,
        ctx,
        { code: 'withdrawal_revoke', name: 'Revoke of a withdrawal (pupil rejoins)' },
        id,
        `Revoke withdrawal: ${row.name} (left ${row.leaving_on.split('-').reverse().join('-')}) rejoins; all months charged again${
          hostel
            ? hostel.mode === 'continue'
              ? '; back in the hostel as if never left'
              : `; back in the hostel from ${(hostel.fromDate ?? '').split('-').reverse().join('-')}`
            : ''
        }`,
        { reason, hostel: hostel ?? null },
      );
      if (instanceId)
        await c.query(
          `UPDATE student_withdrawals SET revoke_workflow_instance_id = $2 WHERE id = $1 AND revoke_status = 'pending'`,
          [id, instanceId],
        );
      // no approval levels in force: it is applied now
      else await this.applyRevoke(c, id);
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.revoke_request',
        entityType: 'student_withdrawals',
        entityId: id,
        after: { reason, appliedAtOnce: !instanceId },
      });
    });
    return this.get(ctx, id);
  }

  // ---- portal after leaving ------------------------------------------------------------------------
  private async formerPortalDays(c: PoolClient): Promise<number> {
    const r = await c.query<{ v: string | null }>(
      `SELECT app.setting('people.former_portal_days') #>> '{}' AS v`,
    );
    const n = Number(r.rows[0]?.v ?? 90);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 730) : 0;
  }

  /**
   * The school's own "Former student" / "Former parent" role: what a withdrawn pupil or the parent may
   * still see. Made on first use with a small default set; the school changes its rights under Access
   * -> Roles and permissions like any other school role.
   */
  private async formerRole(c: PoolClient, kind: 'student' | 'parent'): Promise<string> {
    const code = kind === 'student' ? 'former_student' : 'former_parent';
    const has = await c.query<{ id: string }>(
      `SELECT id::text FROM roles WHERE school_id = app.current_school_id() AND code = $1 AND deleted_at IS NULL`,
      [code],
    );
    if (has.rows[0]) return has.rows[0].id;
    const r = await c.query<{ id: string }>(
      `INSERT INTO roles (school_id, code, name, kind, is_system, description, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, 'module'::role_kind, false, $3, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
      [
        code,
        kind === 'student' ? 'Former student' : 'Former parent',
        'What a withdrawn pupil or the parent may still see on the portal for the days set under Withdrawal settings',
      ],
    );
    await c.query(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT $1, p.code FROM permissions p WHERE p.code = ANY($2::text[]) ON CONFLICT DO NOTHING`,
      [
        r.rows[0]!.id,
        [
          'engagement.family.view',
          'fees.family.view',
          ...(kind === 'parent' ? ['payments.family.pay'] : []),
          'exams.family.view',
          'platform.files.view',
          'reports.export.view',
          'platform.privacy.request',
        ],
      ],
    );
    return r.rows[0]!.id;
  }

  /** The login stays open, but the full parent / student role is set aside for the former role, for `days`. */
  private async switchToFormer(
    c: PoolClient,
    userId: string,
    kind: 'student' | 'parent',
    withdrawalId: string,
    days: number,
  ): Promise<void> {
    await c.query(
      `UPDATE user_school_memberships SET status = 'active', updated_at = now(), updated_by = app.current_user_id()
        WHERE school_id = app.current_school_id() AND user_id = $1 AND person_type = $2`,
      [userId, kind === 'parent' ? 'guardian' : 'student'],
    );
    await c.query(
      `UPDATE user_roles ur SET revoked_at = now(), revoked_by = app.current_user_id(), reason = $3, updated_at = now(), updated_by = app.current_user_id()
         FROM roles r
        WHERE r.id = ur.role_id AND r.code = $2 AND ur.user_id = $1 AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL`,
      [userId, kind, `withdrawal:${withdrawalId}:suspended`],
    );
    await c.query(
      `INSERT INTO user_roles (school_id, user_id, role_id, valid_from, valid_to, granted_by, reason, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, CURRENT_DATE, CURRENT_DATE + $3::int, app.current_user_id(), $4, app.current_user_id(), app.current_user_id())`,
      [userId, await this.formerRole(c, kind), days, `withdrawal:${withdrawalId}:former`],
    );
  }

  /** The days and the two roles, for the Withdrawal settings page. */
  async portalAccess(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      days: await this.formerPortalDays(c),
      studentRoleId: await this.formerRole(c, 'student'),
      parentRoleId: await this.formerRole(c, 'parent'),
    }));
  }

  async setPortalAccess(ctx: RequestContext, days: number) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.formerPortalDays(c);
      // as SettingsService.set: close the open row, replace today's, insert the new value
      await c.query(
        `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
          WHERE key = 'people.former_portal_days' AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
      );
      await c.query(
        `DELETE FROM school_settings WHERE key = 'people.former_portal_days' AND valid_from = CURRENT_DATE`,
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), 'people.former_portal_days', $1::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
        [JSON.stringify(days)],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.portal_access',
        entityType: 'school_settings',
        entityId: 'people.former_portal_days',
        before: { days: before },
        after: { days },
      });
      return {
        days,
        studentRoleId: await this.formerRole(c, 'student'),
        parentRoleId: await this.formerRole(c, 'parent'),
      };
    });
  }

  private async applyRevoke(c: PoolClient, id: string): Promise<void> {
    try {
      await c.query(`SELECT app.revoke_withdrawal($1)`, [id]);
      // a refund draft of the withdrawal that was never sent has no meaning any more
      await c.query(`DELETE FROM fee_refunds WHERE withdrawal_id = $1 AND status = 'draft'`, [id]);
      // a boarder asked back in the hostel: the stay goes on, or a new stay from the day (0165)
      const want = await c.query<{
        mode: 'continue' | 'from_date' | null;
        from: string | null;
        bed: string | null;
      }>(
        `SELECT revoke_hostel_mode AS mode, revoke_hostel_from::text AS "from", revoke_hostel_bed_id::text AS bed
           FROM student_withdrawals WHERE id = $1`,
        [id],
      );
      const h = want.rows[0];
      const stay = h?.mode ? await this.hostelStayOf(c, id) : null;
      if (h?.mode && stay) {
        const notes = await returnToHostel(
          c,
          this.hostelReturn(stay, {
            mode: h.mode,
            fromDate: h.from ?? undefined,
            bedId: h.bed ?? undefined,
          }),
          (cc, sid, yid) => this.adjustments.carryHostelOutsideStay(cc, sid, yid),
        );
        await c.query(`UPDATE student_withdrawals SET revoke_hostel_note = $2 WHERE id = $1`, [
          id,
          notes.join(' '),
        ]);
      }
      // the pupil is back: the full roles return and the "former" ones end
      await c.query(
        `UPDATE user_roles SET revoked_at = NULL, revoked_by = NULL, reason = 'restored: withdrawal revoked', updated_at = now(), updated_by = app.current_user_id()
          WHERE school_id = app.current_school_id() AND reason = $1`,
        [`withdrawal:${id}:suspended`],
      );
      await c.query(
        `UPDATE user_roles SET revoked_at = now(), revoked_by = app.current_user_id(), updated_at = now(), updated_by = app.current_user_id()
          WHERE school_id = app.current_school_id() AND reason = $1 AND revoked_at IS NULL`,
        [`withdrawal:${id}:former`],
      );
      // cached rights are dropped once this has been saved (the caller's transaction ends first)
      const sc = await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`);
      const schoolId = sc.rows[0]!.id;
      setTimeout(
        () => void this.access.invalidateSchool(schoolId).catch(() => undefined),
        1500,
      ).unref();
    } catch (error) {
      const e = error as { message?: string; detail?: string };
      if (e.message?.startsWith('withdrawal.') || e.message?.startsWith('fees.'))
        throw new DomainError(e.message, e.detail ?? 'The withdrawal could not be revoked', {
          status: 409,
        });
      throw error;
    }
  }

  /** The last level approved: the withdrawal is revoked. A level rejected: nothing changes. */
  async onRevokeComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    if (outcome === 'approved') await this.applyRevoke(c, instance.entityId);
    else
      await c.query(
        `UPDATE student_withdrawals SET revoke_status = 'rejected', updated_at = now() WHERE id = $1 AND revoke_status = 'pending'`,
        [instance.entityId],
      );
    await this.audit.stage(ctx, c, {
      action: `people.withdrawal.revoke_${outcome}`,
      entityType: 'student_withdrawals',
      entityId: instance.entityId,
      after: { workflowInstanceId: instance.id },
    });
  }

  async cancel(ctx: RequestContext, id: string, dto: CancelDto): Promise<WithdrawalRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findDb(c, id, true);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(before.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          {
            status: 409,
          },
        );
      if (before.tc)
        throw new DomainError(
          'withdrawal.tc_issued',
          `Cancel TC ${before.tc.tcNo} first, then the withdrawal`,
          { status: 409 },
        );
      await c.query(
        `UPDATE student_withdrawals SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, current_step = NULL, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.cancel',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { status: before.status },
        after: { status: 'cancelled', reason: dto.reason },
      });
    });
    return this.get(ctx, id);
  }
}
