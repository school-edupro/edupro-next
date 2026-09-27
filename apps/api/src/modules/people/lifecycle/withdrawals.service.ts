import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import {
  DEFAULT_CLEARANCE_DEPARTMENTS,
  type CancelDto,
  type ClearanceDto,
  type ListWithdrawalsQueryDto,
  type RequestWithdrawalDto,
} from './lifecycle.dto';

export interface ClearanceRow {
  id: string;
  department: string;
  status: 'pending' | 'cleared' | 'hold';
  dues: string;
  remarks: string | null;
  actedBy: string | null;
  actedAt: string | null;
}

export interface WithdrawalRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  section: string | null;
  requestedOn: string;
  leavingOn: string;
  reason: string;
  status: 'requested' | 'cleared' | 'completed' | 'cancelled';
  requestedBy: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  clearances: ClearanceRow[];
}

interface Db {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  section: string | null;
  requested_on: string;
  leaving_on: string;
  reason: string;
  status: WithdrawalRow['status'];
  requested_by: string | null;
  completed_at: Date | null;
  cancel_reason: string | null;
  clearances: ClearanceRow[];
}

const SELECT = `SELECT w.id::text, w.student_id::text, s.display_name AS student_name, s.admission_no,
        (SELECT c.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
          WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC, e.id DESC LIMIT 1) AS section,
        w.requested_on::text, w.leaving_on::text, w.reason, w.status, u.display_name AS requested_by, w.completed_at, w.cancel_reason,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id::text, 'department', x.department, 'status', x.status, 'dues', x.dues::text, 'remarks', x.remarks,
                    'actedBy', (SELECT display_name FROM users WHERE id = x.acted_by), 'actedAt', x.acted_at) ORDER BY x.id)
                    FROM withdrawal_clearances x WHERE x.withdrawal_id = w.id), '[]'::jsonb) AS clearances
   FROM student_withdrawals w JOIN students s ON s.id = w.student_id LEFT JOIN users u ON u.id = w.requested_by`;

const toRow = (r: Db): WithdrawalRow => ({
  id: r.id,
  studentId: r.student_id,
  studentName: r.student_name,
  admissionNo: r.admission_no,
  section: r.section,
  requestedOn: r.requested_on,
  leavingOn: r.leaving_on,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  cancelReason: r.cancel_reason,
  clearances: r.clearances,
});

/**
 * Withdrawal in two steps (S7-02, legacy student_fnf): a request opens one clearance per department;
 * completion (app.complete_withdrawal) is refused until every department has cleared, then ends the
 * enrolment, deactivates the student and their login.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: RequestContext,
    q: ListWithdrawalsQueryDto,
  ): Promise<{ rows: WithdrawalRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      let where = 'TRUE';
      if (q.status === 'open') where = `w.status IN ('requested', 'cleared')`;
      else {
        params.push(q.status);
        where = `w.status = $1::withdrawal_status`;
      }
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- where is one of two fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM student_withdrawals w WHERE ${where}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where is a fixed fragment; values are bound parameters
        `${SELECT} WHERE ${where} ORDER BY w.requested_on DESC, w.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<WithdrawalRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<Db>(`${SELECT} WHERE w.id = $1`, [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<WithdrawalRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    if (!row) throw new DomainError('not-found', 'Withdrawal not found');
    return row;
  }

  async forStudent(ctx: RequestContext, studentId: string): Promise<WithdrawalRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = await c.query<Db>(`${SELECT} WHERE w.student_id = $1 ORDER BY w.id DESC`, [
        studentId,
      ]);
      return r.rows.map(toRow);
    });
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
    return this.db.tenant(tenant, async (c) => {
      const s = await c.query<{ status: string }>(
        `SELECT status::text FROM students WHERE id = $1 AND deleted_at IS NULL`,
        [studentId],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Student not found');
      if (s.rows[0].status !== 'active')
        throw new DomainError('withdrawal.student_inactive', 'The student is not active', {
          status: 409,
        });
      const setting = await c.query<{ v: unknown }>(
        `SELECT app.setting('people.withdrawal_departments') AS v`,
      );
      const configured = Array.isArray(setting.rows[0]?.v)
        ? (setting.rows[0]!.v as string[])
        : null;
      const departments = dto.departments ?? configured ?? DEFAULT_CLEARANCE_DEPARTMENTS;
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO student_withdrawals (school_id, student_id, academic_year_id, leaving_on, reason, requested_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [studentId, tenant.academicYearId, dto.leavingOn, dto.reason],
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
      for (const department of new Set(departments))
        await c.query(
          `INSERT INTO withdrawal_clearances (school_id, withdrawal_id, department) VALUES (app.current_school_id(), $1, $2)`,
          [id, department],
        );
      const created = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.request',
        entityType: 'student_withdrawals',
        entityId: id,
        after: { studentId, leavingOn: dto.leavingOn, reason: dto.reason, departments },
      });
      return created;
    });
  }

  async clearance(
    ctx: RequestContext,
    id: string,
    department: string,
    dto: ClearanceDto,
  ): Promise<WithdrawalRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(before.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          {
            status: 409,
          },
        );
      const r = await c.query(
        `UPDATE withdrawal_clearances SET status = $3::clearance_status, dues = $4, remarks = $5, acted_by = app.current_user_id(), acted_at = now()
          WHERE withdrawal_id = $1 AND department = $2`,
        [id, department, dto.status, dto.dues, dto.remarks ?? null],
      );
      if (r.rowCount === 0)
        throw new DomainError('not-found', `No clearance for department "${department}"`);
      await c.query(
        `UPDATE student_withdrawals SET status = CASE WHEN EXISTS (SELECT 1 FROM withdrawal_clearances WHERE withdrawal_id = $1 AND status <> 'cleared') THEN 'requested' ELSE 'cleared' END::withdrawal_status,
                updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.clear',
        entityType: 'student_withdrawals',
        entityId: id,
        before: {
          department,
          status: before.clearances.find((x) => x.department === department)?.status,
        },
        after: { department, status: dto.status, dues: dto.dues, remarks: dto.remarks ?? null },
      });
      return after;
    });
  }

  async complete(ctx: RequestContext, id: string): Promise<WithdrawalRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      await c.query(`SELECT app.complete_withdrawal($1)`, [id]);
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.complete',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status, studentId: after.studentId, leavingOn: after.leavingOn },
      });
      return after;
    });
  }

  async cancel(ctx: RequestContext, id: string, dto: CancelDto): Promise<WithdrawalRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Withdrawal not found');
      if (!['requested', 'cleared'].includes(before.status))
        throw new DomainError(
          'withdrawal.not_open',
          'The withdrawal is already completed or cancelled',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE student_withdrawals SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, dto.reason],
      );
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'people.withdrawal.cancel',
        entityType: 'student_withdrawals',
        entityId: id,
        before: { status: before.status },
        after: { status: 'cancelled', reason: dto.reason },
      });
      return after;
    });
  }
}
