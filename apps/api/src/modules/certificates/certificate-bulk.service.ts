import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ReportsService } from '../reports/reports.service';
import type { BulkIssueDto, BulkPreviewDto } from './certificates.dto';
import { CertificatesService } from './certificates.service';

/**
 * Bulk issue (docs/design/87, phase E): one type to a section's students on the rolls, to chosen students, or to the
 * leavers (a withdrawal cleared or complete and no TC yet), in roll order. The preview shows each one's checks; the
 * issue gives each its own certificate and number (each its own transaction: one that fails is left out with its
 * reason), then one PDF of the batch in the same order.
 */
export interface BulkTarget {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: string | null;
  classLabel: string | null;
}

@Injectable()
export class CertificateBulkService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly certificates: CertificatesService,
  ) {}

  /** The students of the scope, in roll order. */
  private async targets(c: PoolClient, dto: BulkPreviewDto): Promise<BulkTarget[]> {
    const cls = `(SELECT c.name || ' – ' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                    JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = en.academic_year_id
                   WHERE en.student_id = s.id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1)`;
    const roll = `(SELECT en.roll_no::text FROM enrolments en JOIN academic_years y ON y.id = en.academic_year_id
                    WHERE en.student_id = s.id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1)`;
    let r;
    if (dto.sectionId)
      r = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        roll_no: string | null;
        class_label: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- cls and roll are fixed fragments; values are bound parameters
        `SELECT s.id::text, s.display_name AS name, s.admission_no, e.roll_no::text AS roll_no, ${cls} AS class_label
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
          WHERE e.class_section_id = $1 AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [dto.sectionId],
      );
    else if (dto.studentIds?.length)
      r = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        roll_no: string | null;
        class_label: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- cls and roll are fixed fragments; values are bound parameters
        `SELECT s.id::text, s.display_name AS name, s.admission_no, ${roll} AS roll_no, ${cls} AS class_label
           FROM students s WHERE s.id = ANY($1::bigint[]) AND s.deleted_at IS NULL
          ORDER BY class_label NULLS LAST, (${roll})::int NULLS LAST, s.display_name`,
        [dto.studentIds],
      );
    else
      r = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        roll_no: string | null;
        class_label: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- cls and roll are fixed fragments; values are bound parameters
        `SELECT s.id::text, s.display_name AS name, s.admission_no, ${roll} AS roll_no, ${cls} AS class_label
           FROM students s
          WHERE s.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM student_withdrawals w WHERE w.student_id = s.id AND w.status IN ('cleared', 'completed')
                          AND w.kind IS DISTINCT FROM 'admission_cancelled')
            AND NOT EXISTS (SELECT 1 FROM transfer_certificates t WHERE t.student_id = s.id AND t.status = 'issued')
          ORDER BY class_label NULLS LAST, (${roll})::int NULLS LAST, s.display_name
          LIMIT 300`,
      );
    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      admissionNo: x.admission_no,
      rollNo: x.roll_no,
      classLabel: x.class_label,
    }));
  }

  /** Each student of the scope with what issuing would find. */
  async preview(ctx: RequestContext, dto: BulkPreviewDto) {
    const tenant = requireTenant(ctx);
    const { type, list } = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      if (type.audience !== 'STUDENT')
        throw new DomainError('validation-failed', 'Bulk issue is for student certificates', {
          status: 400,
        });
      return { type, list: await this.targets(c, dto) };
    });
    if (list.length > 300)
      throw new DomainError('validation-failed', 'At most 300 students at a time', { status: 400 });
    const rows = [];
    for (const s of list) {
      try {
        const a = await this.certificates.assess(ctx, {
          typeCode: dto.typeCode,
          studentId: s.id,
          purpose: dto.purpose,
          issuedOn: dto.issuedOn,
          fields: dto.fields,
        });
        rows.push({
          ...s,
          checks: a.checks,
          problems: a.problems,
          held: a.checks.some((x) => x.key === 'one' && !x.ok),
          ok: a.checks.every((x) => x.ok) && !a.problems.length,
        });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        rows.push({ ...s, checks: [], problems: [e.message], held: false, ok: false });
      }
    }
    return {
      type: { code: type.code, name: type.name },
      rows,
      figures: {
        total: rows.length,
        ok: rows.filter((r) => r.ok).length,
        failed: rows.filter((r) => !r.ok && !r.held).length,
        held: rows.filter((r) => r.held).length,
      },
      can: { override: ctx.permissions?.has('certificate.register.override') ?? false },
    };
  }

  /** Issues to every student of the scope that can have it (all whose checks fail too, with the principal's reason). */
  async issue(ctx: RequestContext, dto: BulkIssueDto) {
    const tenant = requireTenant(ctx);
    const { type, list, batchId } = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      if (type.audience !== 'STUDENT')
        throw new DomainError('validation-failed', 'Bulk issue is for student certificates', {
          status: 400,
        });
      const list = await this.targets(c, dto);
      if (!list.length)
        throw new DomainError('validation-failed', 'No students to issue to', { status: 400 });
      if (list.length > 300)
        throw new DomainError('validation-failed', 'At most 300 students at a time', {
          status: 400,
        });
      const b = await c.query<{ id: string }>(
        `INSERT INTO certificate_batches (school_id, type_id, title, scope, override_reason, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, app.current_user_id()) RETURNING id::text`,
        [
          type.id,
          (dto.title || `${type.name} · ${String(list.length)} students`).slice(0, 200),
          JSON.stringify(
            dto.sectionId
              ? { sectionId: dto.sectionId }
              : dto.studentIds?.length
                ? { studentIds: dto.studentIds }
                : { leavers: true },
          ),
          dto.overrideReason ?? null,
        ],
      );
      return { type, list, batchId: b.rows[0]!.id };
    });
    return this.run(
      ctx,
      batchId,
      type.name,
      list.map((s) => ({
        student: s,
        dto: {
          typeCode: dto.typeCode,
          studentId: s.id,
          purpose: dto.purpose,
          issuedOn: dto.issuedOn,
          fields: dto.fields,
          overrideReason: dto.overrideReason,
        },
      })),
    );
  }

  /**
   * Issues each in order inside the batch (each its own transaction), then records who was left out and why and
   * queues the batch's PDF. Used by the awards too (each allotment its own fields).
   */
  async run(
    ctx: RequestContext,
    batchId: string,
    typeName: string,
    items: Array<{
      student: BulkTarget;
      dto: Parameters<CertificatesService['issue']>[1];
      after?: (certificateId: string) => Promise<void>;
    }>,
  ) {
    const tenant = requireTenant(ctx);
    const issued: string[] = [];
    const skipped: Array<{ studentId: string; name: string; reason: string }> = [];
    for (const it of items) {
      try {
        const cert = await this.certificates.issue(ctx, it.dto, { batchId });
        issued.push(cert.id);
        if (it.after) await it.after(cert.id);
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        skipped.push({
          studentId: it.student.id,
          name: it.student.name,
          reason: e.message.slice(0, 300),
        });
      }
    }
    let exportId: string | null = null;
    if (issued.length) {
      await this.db.tenant(tenant, (c) =>
        c.query(
          `UPDATE certificate_batches SET certificate_ids = $2::bigint[], skipped = $3::jsonb WHERE id = $1`,
          [batchId, issued, JSON.stringify(skipped)],
        ),
      );
      const exp = await this.reports.createRenderedForOwner(
        ctx,
        {
          dataset: 'certificate_batch_doc',
          format: 'pdf',
          params: { batchId },
          title: `${typeName} · batch ${batchId} (${String(issued.length)})`,
        },
        'certificate.batch.render',
      );
      exportId = exp.id;
      // the batch's print is kept for good, as its certificates are
      await this.db.tenant(tenant, (c) =>
        c.query(`UPDATE exports SET expires_at = now() + interval '100 years' WHERE id = $1`, [
          exp.id,
        ]),
      );
    }
    await this.db.tenant(tenant, async (c) => {
      await c.query(
        `UPDATE certificate_batches SET certificate_ids = $2::bigint[], skipped = $3::jsonb, export_id = $4 WHERE id = $1`,
        [batchId, issued, JSON.stringify(skipped), exportId],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.batch.issue',
        entityType: 'certificate_batches',
        entityId: batchId,
        after: { issued: issued.length, skipped: skipped.length },
      });
    });
    return this.batch(ctx, batchId);
  }

  async batch(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = (
        await c.query<{
          id: string;
          title: string;
          type_name: string;
          type_code: string;
          scope: Record<string, unknown>;
          ids: string[];
          skipped: Array<{ studentId: string; name: string; reason: string }>;
          override_reason: string | null;
          export_id: string | null;
          by: string | null;
          created_at: Date;
        }>(
          `SELECT b.id::text, b.title, t.name AS type_name, t.code AS type_code, b.scope, b.certificate_ids::text[] AS ids,
                  b.skipped, b.override_reason, b.export_id::text, u.display_name AS by, b.created_at
             FROM certificate_batches b JOIN certificate_types t ON t.id = b.type_id LEFT JOIN users u ON u.id = b.created_by
            WHERE b.id = $1`,
          [id],
        )
      ).rows[0];
      if (!b) throw new DomainError('not-found', 'Batch not found');
      const certs = await c.query<{
        id: string;
        number: string;
        status: string;
        name: string;
        admission_no: string;
        override: boolean;
      }>(
        `SELECT x.id::text, x.number, x.status, s.display_name AS name, s.admission_no, x.override_reason IS NOT NULL AS override
           FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) JOIN certificates x ON x.id = o.id
           LEFT JOIN students s ON s.id = x.student_id ORDER BY o.n`,
        [b.ids],
      );
      return {
        id: b.id,
        title: b.title,
        typeName: b.type_name,
        typeCode: b.type_code,
        scope: b.scope,
        issued: certs.rows.map((x) => ({
          id: x.id,
          number: x.number,
          status: x.status,
          name: x.name,
          admissionNo: x.admission_no,
          override: x.override,
        })),
        skipped: b.skipped,
        overrideReason: b.override_reason,
        exportId: b.export_id,
        by: b.by,
        createdAt: b.created_at.toISOString(),
      };
    });
  }

  async batches(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        title: string;
        type_name: string;
        issued: number;
        skipped: number;
        export_id: string | null;
        by: string | null;
        created_at: Date;
      }>(
        `SELECT b.id::text, b.title, t.name AS type_name, cardinality(b.certificate_ids)::int AS issued,
                jsonb_array_length(b.skipped)::int AS skipped, b.export_id::text, u.display_name AS by, b.created_at
           FROM certificate_batches b JOIN certificate_types t ON t.id = b.type_id LEFT JOIN users u ON u.id = b.created_by
          ORDER BY b.created_at DESC LIMIT 100`,
      );
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          title: x.title,
          typeName: x.type_name,
          issued: x.issued,
          skipped: x.skipped,
          exportId: x.export_id,
          by: x.by,
          createdAt: x.created_at.toISOString(),
        })),
      };
    });
  }
}
