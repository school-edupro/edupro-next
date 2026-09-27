import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { TemplatesService } from '../../platform/templates/templates.service';
import { ReportsService } from '../../reports/reports.service';
import type { CancelDto, IssueTcDto, ListTcQueryDto } from './lifecycle.dto';

export interface TcRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  tcNo: string;
  serial: number;
  issuedOn: string;
  reason: string;
  lastClass: string | null;
  conduct: string;
  promotionStatus: string | null;
  duesCleared: boolean;
  remarks: string | null;
  templateId: string | null;
  exportId: string | null;
  status: 'issued' | 'cancelled';
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

interface Db {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  tc_no: string;
  serial: number;
  issued_on: string;
  reason: string;
  last_class: string | null;
  conduct: string;
  promotion_status: string | null;
  dues_cleared: boolean;
  remarks: string | null;
  template_id: string | null;
  export_id: string | null;
  status: TcRow['status'];
  issued_by: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
}

const SELECT = `SELECT t.id::text, t.student_id::text, s.display_name AS student_name, s.admission_no, t.tc_no, t.serial, t.issued_on::text, t.reason,
        t.last_class, t.conduct, t.promotion_status, t.dues_cleared, t.remarks, t.template_id::text, t.export_id::text, t.status,
        u.display_name AS issued_by, t.cancelled_at, t.cancel_reason, t.created_at
   FROM transfer_certificates t JOIN students s ON s.id = t.student_id LEFT JOIN users u ON u.id = t.issued_by`;

const toRow = (r: Db): TcRow => ({
  id: r.id,
  studentId: r.student_id,
  studentName: r.student_name,
  admissionNo: r.admission_no,
  tcNo: r.tc_no,
  serial: r.serial,
  issuedOn: r.issued_on,
  reason: r.reason,
  lastClass: r.last_class,
  conduct: r.conduct,
  promotionStatus: r.promotion_status,
  duesCleared: r.dues_cleared,
  remarks: r.remarks,
  templateId: r.template_id,
  exportId: r.export_id,
  status: r.status,
  issuedBy: r.issued_by,
  cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
  cancelReason: r.cancel_reason,
  createdAt: r.created_at.toISOString(),
});

/**
 * Transfer certificates (S7-02): numbered per school, a snapshot of the student at issue time, the PDF
 * produced by the document renderer from the school's TC template. Issuing ends an active enrolment.
 */
@Injectable()
export class TcService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly templates: TemplatesService,
  ) {}

  async list(ctx: RequestContext, q: ListTcQueryDto): Promise<{ rows: TcRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`t.status = $${params.length}::tc_status`);
      }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(
          `(t.tc_no ILIKE $${params.length} OR s.display_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`,
        );
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM transfer_certificates t JOIN students s ON s.id = t.student_id WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY t.serial DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<TcRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<Db>(`${SELECT} WHERE t.id = $1`, [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<TcRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    if (!row) throw new DomainError('not-found', 'Transfer certificate not found');
    return row;
  }

  async forStudent(ctx: RequestContext, studentId: string): Promise<TcRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = await c.query<Db>(`${SELECT} WHERE t.student_id = $1 ORDER BY t.serial DESC`, [
        studentId,
      ]);
      return r.rows.map(toRow);
    });
  }

  async issue(ctx: RequestContext, studentId: string, dto: IssueTcDto): Promise<TcRow> {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const yearId = tenant.academicYearId;
    // 1. the certificate row and the student's departure, committed first so the renderer can read them
    const tcId = await this.db.tenant(tenant, async (c) => {
      const s = await c.query<{
        status: string;
        snapshot: Record<string, unknown>;
        last_class: string | null;
        year_code: string;
      }>(
        `SELECT s.status::text, y.code AS year_code,
                (SELECT c.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes c ON c.id = cs.class_id
                  WHERE e.student_id = s.id ORDER BY e.academic_year_id DESC, e.id DESC LIMIT 1) AS last_class,
                jsonb_build_object('name', s.display_name, 'admissionNo', s.admission_no, 'dob', to_char(s.dob, 'DD Mon YYYY'), 'gender', s.gender::text,
                  'category', s.category, 'admittedOn', to_char(s.admitted_on, 'DD Mon YYYY'), 'house', s.house,
                  'guardianName', (SELECT g.display_name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1),
                  'guardianMobile', (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC, sg.id LIMIT 1)) AS snapshot
           FROM students s CROSS JOIN academic_years y
          WHERE s.id = $1 AND s.deleted_at IS NULL AND y.id = $2`,
        [studentId, yearId],
      );
      const student = s.rows[0];
      if (!student) throw new DomainError('not-found', 'Student not found');
      const open = await c.query(
        `SELECT 1 FROM transfer_certificates WHERE student_id = $1 AND status = 'issued'`,
        [studentId],
      );
      if (open.rowCount)
        throw new DomainError(
          'tc.already_issued',
          'The student already holds an issued transfer certificate',
          {
            status: 409,
          },
        );
      const template = dto.templateId
        ? await this.templates.get(ctx, dto.templateId)
        : await this.templates.activeOfKind(c, 'transfer_certificate');
      if (!template)
        throw new DomainError(
          'template.missing',
          'No active transfer certificate template; install the defaults first',
          {
            status: 409,
          },
        );
      const no = await c.query<{ tc_no: string; serial: number }>(
        `SELECT * FROM app.next_tc_no($1)`,
        [student.year_code],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO transfer_certificates (school_id, student_id, academic_year_id, tc_no, serial, issued_on, reason, last_class, conduct, promotion_status, dues_cleared, remarks, snapshot, template_id, issued_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8, $9, $10, $11, $12::jsonb, $13, app.current_user_id())
         RETURNING id::text`,
        [
          studentId,
          yearId,
          no.rows[0]!.tc_no,
          no.rows[0]!.serial,
          dto.issuedOn ?? null,
          dto.reason,
          student.last_class,
          dto.conduct,
          dto.promotionStatus ?? null,
          dto.duesCleared,
          dto.remarks ?? null,
          JSON.stringify(student.snapshot),
          template.id,
        ],
      );
      const id = r.rows[0]!.id;
      if (student.status === 'active') {
        await c.query(`SELECT set_config('app.status_reason', $1, true)`, [
          `transfer certificate ${no.rows[0]!.tc_no}`,
        ]);
        await c.query(
          `UPDATE students SET status = 'inactive', left_on = COALESCE($2::date, CURRENT_DATE), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [studentId, dto.issuedOn ?? null],
        );
        await c.query(
          `UPDATE enrolments SET status = 'transferred', ended_on = COALESCE($2::date, CURRENT_DATE), updated_at = now(), updated_by = app.current_user_id()
            WHERE student_id = $1 AND status = 'active'`,
          [studentId, dto.issuedOn ?? null],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'people.tc.issue',
        entityType: 'transfer_certificates',
        entityId: id,
        after: { tcNo: no.rows[0]!.tc_no, studentId, reason: dto.reason },
      });
      return id;
    });
    // 2. the PDF through the export service (its own transaction and outbox row)
    const tc = (await this.db.tenant(tenant, (c) => this.find(c, tcId)))!;
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'document',
        format: 'pdf',
        params: { templateId: tc.templateId, entity: 'transfer_certificate', entityId: tcId },
        title: `TC ${tc.tcNo}`,
      },
      'people.tc.render',
    );
    await this.db.tenant(tenant, (c) =>
      c.query(`UPDATE transfer_certificates SET export_id = $2 WHERE id = $1`, [tcId, exp.id]),
    );
    return { ...tc, exportId: exp.id };
  }

  /** (Re)queues the PDF, for certificates created before a template existed or after a template change. */
  async render(ctx: RequestContext, id: string): Promise<TcRow> {
    const tenant = requireTenant(ctx);
    const tc = await this.get(ctx, id);
    let templateId = tc.templateId;
    if (!templateId) {
      const t = await this.db.tenant(tenant, (c) =>
        this.templates.activeOfKind(c, 'transfer_certificate'),
      );
      if (!t)
        throw new DomainError(
          'template.missing',
          'No active transfer certificate template; install the defaults first',
          {
            status: 409,
          },
        );
      templateId = t.id;
    }
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'document',
        format: 'pdf',
        params: { templateId, entity: 'transfer_certificate', entityId: id },
        title: `TC ${tc.tcNo}`,
      },
      'people.tc.render',
    );
    await this.db.tenant(tenant, (c) =>
      c.query(
        `UPDATE transfer_certificates SET export_id = $2, template_id = COALESCE(template_id, $3) WHERE id = $1`,
        [id, exp.id, templateId],
      ),
    );
    return { ...tc, exportId: exp.id, templateId };
  }

  async cancel(ctx: RequestContext, id: string, dto: CancelDto): Promise<TcRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Transfer certificate not found');
      if (before.status === 'cancelled')
        throw new DomainError('tc.already_cancelled', 'The certificate is already cancelled', {
          status: 409,
        });
      await c.query(
        `UPDATE transfer_certificates SET status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_id(), cancel_reason = $2 WHERE id = $1`,
        [id, dto.reason],
      );
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'people.tc.cancel',
        entityType: 'transfer_certificates',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status, reason: dto.reason },
      });
      return after;
    });
  }
}
