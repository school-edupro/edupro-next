import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { TemplatesService } from '../../platform/templates/templates.service';
import { ReportsService } from '../../reports/reports.service';
import { CertificatesService } from '../../certificates/certificates.service';
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
    private readonly certificates: CertificatesService,
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

  /**
   * Issues a TC through the certificate register (docs/design/87): its checks (the withdrawal; fees, library, hostel and
   * transport cleared; one live TC) run on every route, the principal may override a failed one with a reason; the
   * number is the type's of the year (TC/2026-27/00001) with the book Sl. No.; every printed field is frozen. From a
   * withdrawal still in progress (`keepStatus`), the student stays active until the withdrawal completes; otherwise the
   * TC itself ends the enrolment.
   */
  async issue(
    ctx: RequestContext,
    studentId: string,
    dto: IssueTcDto,
    opts: { keepStatus?: boolean; withdrawalId?: string | null; leavingOn?: string | null } = {},
  ): Promise<TcRow> {
    const tenant = requireTenant(ctx);
    const open = await this.db.tenant(tenant, (c) =>
      c.query<{ tc_no: string }>(
        `SELECT tc_no FROM transfer_certificates WHERE student_id = $1 AND status = 'issued' LIMIT 1`,
        [studentId],
      ),
    );
    if (open.rows[0])
      throw new DomainError(
        'tc.already_issued',
        `The student already holds an issued transfer certificate (${open.rows[0].tc_no})`,
        { status: 409 },
      );
    const cert = await this.certificates.issue(
      ctx,
      {
        typeCode: 'TC',
        studentId,
        issuedOn: dto.issuedOn,
        fields: {
          ...dto.fields,
          reason: dto.reason,
          conduct: dto.conduct,
          ...(dto.promotionStatus ? { promotion: dto.promotionStatus } : {}),
          ...(dto.remarks ? { remarks: dto.remarks } : {}),
        },
        overrideReason: dto.overrideReason,
      },
      opts,
    );
    const tc = (await this.db.tenant(tenant, (c) => this.find(c, cert.transferCertificateId!)))!;
    await this.db.tenant(tenant, (c) =>
      this.audit.stage(ctx, c, {
        action: 'people.tc.issue',
        entityType: 'transfer_certificates',
        entityId: tc.id,
        after: { tcNo: tc.tcNo, studentId, reason: dto.reason, certificateId: cert.id },
      }),
    );
    return tc;
  }

  /** (Re)queues the PDF, for certificates created before a template existed or after a template change. */
  async render(ctx: RequestContext, id: string): Promise<TcRow> {
    const tenant = requireTenant(ctx);
    const tc = await this.get(ctx, id);
    const kept = await this.db.tenant(tenant, (c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM certificates WHERE transfer_certificate_id = $1 AND copy_no = 0`,
        [id],
      ),
    );
    if (kept.rows[0]) {
      // the register's paper (the frozen fields through the template version it was made with, or the old TC template)
      const cert = await this.certificates.render(ctx, kept.rows[0].id);
      return { ...tc, exportId: cert.exportId };
    }
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
      // its register row (and any duplicate) with it: the number is never given again
      await this.certificates.cancelForTc(c, id, dto.reason.length >= 3 ? dto.reason : 'Cancelled');
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
