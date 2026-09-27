import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { SetRuleDto } from './attendance.dto';

export interface RuleRow {
  studentId: string;
  student: string;
  section: string | null;
  lateAfter: string | null;
  alertsMuted: boolean;
  reason: string | null;
  validFrom: string;
  validTo: string | null;
}

/** RFID rules v2 (S11): per-student overrides of the late time and alert muting for the working year. */
@Injectable()
export class RulesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  async list(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      data: await this.rows(c, yearId, null),
    }));
  }

  async get(ctx: RequestContext, studentId: string): Promise<RuleRow | null> {
    const yearId = this.year(ctx);
    return this.db.tenant(
      requireTenant(ctx),
      async (c) => (await this.rows(c, yearId, studentId))[0] ?? null,
    );
  }

  async set(ctx: RequestContext, studentId: string, dto: SetRuleDto): Promise<RuleRow> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        studentId,
      ]);
      if (!st.rowCount) throw new DomainError('not-found', 'Student not found', { status: 404 });
      await c.query(
        `INSERT INTO student_attendance_rules (school_id, student_id, academic_year_id, late_after, alerts_muted, reason, valid_from, valid_to, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::time, $4, $5, COALESCE($6::date, CURRENT_DATE), $7::date, app.current_user_id())
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET late_after = EXCLUDED.late_after, alerts_muted = EXCLUDED.alerts_muted, reason = EXCLUDED.reason, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, updated_at = now()`,
        [
          studentId,
          yearId,
          dto.lateAfter ?? null,
          dto.alertsMuted,
          dto.reason ?? null,
          dto.validFrom ?? null,
          dto.validTo ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'attendance.rule.set',
        entityType: 'students',
        entityId: studentId,
        after: {
          lateAfter: dto.lateAfter ?? null,
          alertsMuted: dto.alertsMuted,
          reason: dto.reason ?? null,
        },
      });
      return (await this.rows(c, yearId, studentId))[0]!;
    });
  }

  async clear(ctx: RequestContext, studentId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `DELETE FROM student_attendance_rules WHERE student_id = $1 AND academic_year_id = $2`,
        [studentId, yearId],
      );
      if (!r.rowCount)
        throw new DomainError('not-found', 'No rule for this student', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'attendance.rule.clear',
        entityType: 'students',
        entityId: studentId,
        after: {},
      });
      return { ok: true };
    });
  }

  private async rows(c: PoolClient, yearId: string, studentId: string | null): Promise<RuleRow[]> {
    const r = await c.query<{
      student_id: string;
      student: string;
      section: string | null;
      late_after: string | null;
      alerts_muted: boolean;
      reason: string | null;
      valid_from: string;
      valid_to: string | null;
    }>(
      `SELECT r.student_id::text, s.display_name AS student,
              (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active' LIMIT 1) AS section,
              r.late_after::text, r.alerts_muted, r.reason, r.valid_from::text, r.valid_to::text
         FROM student_attendance_rules r JOIN students s ON s.id = r.student_id
        WHERE r.academic_year_id = $1 AND ($2::bigint IS NULL OR r.student_id = $2::bigint) ORDER BY s.display_name`,
      [yearId, studentId],
    );
    return r.rows.map((x) => ({
      studentId: x.student_id,
      student: x.student,
      section: x.section,
      lateAfter: x.late_after ? x.late_after.slice(0, 5) : null,
      alertsMuted: x.alerts_muted,
      reason: x.reason,
      validFrom: x.valid_from,
      validTo: x.valid_to,
    }));
  }
}
