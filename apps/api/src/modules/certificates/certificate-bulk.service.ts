import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';
import { ReportsService } from '../reports/reports.service';
import {
  BULK_MAX,
  type BulkIssueDto,
  type BulkPreviewDto,
  type BulkRunDto,
} from './certificates.dto';
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
  /** the section (or, for staff, the department) it is taken from: a batch each */
  sectionId?: string | null;
  /** a student, or an employee (a staff type) */
  kind?: 'student' | 'employee';
}

/** A staff type takes departments; a student type the other scopes. */
function assertAudience(audience: string, dto: BulkPreviewDto) {
  const staff = audience === 'STAFF';
  if (staff !== !!dto.departments?.length)
    throw new DomainError(
      'validation-failed',
      staff
        ? 'A staff certificate is issued to departments of employees'
        : 'A student certificate is issued to classes and sections, chosen students or the leavers',
      { status: 400 },
    );
}

@Injectable()
export class CertificateBulkService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly certificates: CertificatesService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** The classes of the selected year with their sections and the students on the rolls in each (the tick list). */
  async sections(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        class_id: string;
        class_name: string;
        id: string;
        name: string;
        students: number;
      }>(
        `SELECT c.id::text AS class_id, c.name AS class_name, cs.id::text, cs.name,
                (SELECT count(*)::int FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
                  WHERE e.class_section_id = cs.id AND e.status = 'active') AS students
           FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND cs.status = 'active' AND c.deleted_at IS NULL
          ORDER BY c.display_order, c.name, cs.name`,
        [tenant.academicYearId],
      );
      const classes: Array<{
        id: string;
        name: string;
        students: number;
        sections: Array<{ id: string; name: string; students: number }>;
      }> = [];
      for (const x of r.rows) {
        let k = classes.find((y) => y.id === x.class_id);
        if (!k) {
          k = { id: x.class_id, name: x.class_name, students: 0, sections: [] };
          classes.push(k);
        }
        k.sections.push({ id: x.id, name: x.name, students: x.students });
        k.students += x.students;
      }
      return { classes, max: BULK_MAX };
    });
  }

  /** The departments with their employees in service and who have left (the staff tick list). */
  async departments(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ name: string; active: number; left: number }>(
        `SELECT COALESCE(NULLIF(btrim(department), ''), '') AS name,
                count(*) FILTER (WHERE status = 'active')::int AS active,
                count(*) FILTER (WHERE status <> 'active')::int AS left
           FROM employees WHERE deleted_at IS NULL
          GROUP BY 1 ORDER BY (COALESCE(NULLIF(btrim(department), ''), '') = ''), 1`,
      );
      return { departments: r.rows, max: BULK_MAX };
    });
  }

  /** The people of a scope, in order (the bulk preview, and a certificate sheet's rows). */
  async targets(c: PoolClient, dto: BulkPreviewDto): Promise<BulkTarget[]> {
    const cls = `(SELECT c.name || ' – ' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                    JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = en.academic_year_id
                   WHERE en.student_id = s.id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1)`;
    const roll = `(SELECT en.roll_no::text FROM enrolments en JOIN academic_years y ON y.id = en.academic_year_id
                    WHERE en.student_id = s.id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1)`;
    if (dto.departments?.length) {
      // employees of these departments (one with none: ""), in service or who have left, by department and code
      const e = await c.query<{
        id: string;
        name: string;
        code: string;
        department: string;
        designation: string | null;
      }>(
        `SELECT e.id::text, e.display_name AS name, e.employee_code AS code,
                COALESCE(NULLIF(btrim(e.department), ''), '') AS department, e.designation
           FROM employees e
          WHERE e.deleted_at IS NULL AND COALESCE(NULLIF(btrim(e.department), ''), '') = ANY($1::text[])
            AND (CASE WHEN $2 = 'left' THEN e.status <> 'active' ELSE e.status = 'active' END)
          ORDER BY (COALESCE(NULLIF(btrim(e.department), ''), '') = ''), 4, e.employee_code`,
        [dto.departments, dto.staffState ?? 'active'],
      );
      return e.rows.map((x) => ({
        id: x.id,
        name: x.name,
        admissionNo: x.code,
        rollNo: null,
        classLabel: [x.department || 'No department', x.designation].filter(Boolean).join(' · '),
        sectionId: x.department,
        kind: 'employee' as const,
      }));
    }
    let r;
    if (dto.sectionId || dto.sectionIds?.length)
      // a section, or several (in class order, then section, then roll): each row knows its section
      r = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        roll_no: string | null;
        class_label: string | null;
        section_id: string | null;
      }>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no, e.roll_no::text AS roll_no,
                k.name || ' – ' || cs.name AS class_label, cs.id::text AS section_id
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE e.class_section_id = ANY($1::bigint[]) AND e.status = 'active'
          ORDER BY k.display_order, k.name, cs.name, e.roll_no NULLS LAST, s.display_name`,
        [dto.sectionIds?.length ? dto.sectionIds : [dto.sectionId]],
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
      sectionId: 'section_id' in x ? (x.section_id as string | null) : null,
      kind: 'student' as const,
    }));
  }

  /** Each student of the scope with what issuing would find. */
  async preview(ctx: RequestContext, dto: BulkPreviewDto) {
    const tenant = requireTenant(ctx);
    const { type, list } = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      assertAudience(type.audience, dto);
      return { type, list: await this.targets(c, dto) };
    });
    if (list.length > BULK_MAX)
      throw new DomainError(
        'validation-failed',
        `At most ${String(BULK_MAX)} students at a time: choose fewer sections`,
        { status: 400 },
      );
    const rows = [];
    for (const s of list) {
      try {
        const a = await this.certificates.assess(ctx, {
          typeCode: dto.typeCode,
          ...(s.kind === 'employee' ? { employeeId: s.id } : { studentId: s.id }),
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
        sections: new Set(rows.map((r) => r.sectionId ?? '')).size,
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
      assertAudience(type.audience, dto);
      const list = await this.targets(c, dto);
      if (!list.length)
        throw new DomainError('validation-failed', 'No students to issue to', { status: 400 });
      if (list.length > BULK_MAX)
        throw new DomainError(
          'validation-failed',
          `At most ${String(BULK_MAX)} students at a time: choose fewer sections`,
          { status: 400 },
        );
      const b = await c.query<{ id: string }>(
        `INSERT INTO certificate_batches (school_id, type_id, title, scope, override_reason, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, app.current_user_id()) RETURNING id::text`,
        [
          type.id,
          (dto.title || `${type.name} · ${String(list.length)} students`).slice(0, 200),
          JSON.stringify(
            dto.sectionId
              ? { sectionId: dto.sectionId }
              : dto.sectionIds?.length
                ? { sectionIds: dto.sectionIds }
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
          ...(s.kind === 'employee' ? { employeeId: s.id } : { studentId: s.id }),
          purpose: dto.purpose,
          issuedOn: dto.issuedOn,
          fields: dto.fields,
          overrideReason: dto.overrideReason,
        },
      })),
    );
  }

  /**
   * A run (16 Nov 2026): the scope's students ticked in the preview, a batch for each section (each its own PDF in roll
   * order; the leavers or chosen students: one batch), the batches sharing the run's id. Those whose checks fail are
   * issued only with the principal's reason; one that cannot be issued is left out with its reason.
   */
  async issueRun(ctx: RequestContext, dto: BulkRunDto) {
    const tenant = requireTenant(ctx);
    const runId = randomUUID();
    const { type, list } = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      assertAudience(type.audience, dto);
      return { type, list: await this.targets(c, dto) };
    });
    const ticked = new Set(dto.only);
    const chosen = list.filter((s) => ticked.has(s.id));
    if (!chosen.length)
      throw new DomainError(
        'validation-failed',
        'Tick at least one student of the chosen classes',
        {
          status: 400,
        },
      );
    if (chosen.length > BULK_MAX)
      throw new DomainError(
        'validation-failed',
        `At most ${String(BULK_MAX)} students at a time: choose fewer sections`,
        { status: 400 },
      );
    // the groups, in order: a section each, or one
    const groups: Array<{ scope: Record<string, unknown>; label: string; students: BulkTarget[] }> =
      [];
    if (dto.departments?.length)
      for (const s of chosen) {
        let g = groups.find((x) => x.scope.department === s.sectionId);
        if (!g) {
          g = {
            scope: { department: s.sectionId, staffState: dto.staffState ?? 'active' },
            label: s.sectionId || 'No department',
            students: [],
          };
          groups.push(g);
        }
        g.students.push(s);
      }
    else if (dto.sectionIds?.length || dto.sectionId)
      for (const s of chosen) {
        let g = groups.find((x) => x.scope.sectionId === s.sectionId);
        if (!g) {
          g = { scope: { sectionId: s.sectionId }, label: s.classLabel ?? 'Section', students: [] };
          groups.push(g);
        }
        g.students.push(s);
      }
    else
      groups.push({
        scope: dto.leavers ? { leavers: true } : { studentIds: chosen.map((s) => s.id) },
        label: dto.leavers ? 'the leavers' : 'chosen students',
        students: chosen,
      });
    await this.issueInGroups(
      ctx,
      type,
      runId,
      groups.map((g) => ({
        scope: g.scope,
        label: g.label,
        items: g.students.map((s) => ({
          student: s,
          dto: {
            typeCode: dto.typeCode,
            ...(s.kind === 'employee' ? { employeeId: s.id } : { studentId: s.id }),
            purpose: dto.purpose,
            issuedOn: dto.issuedOn,
            fields: dto.fields,
            overrideReason: dto.overrideReason,
          },
        })),
      })),
      dto.overrideReason ?? null,
    );
    return this.runOf(ctx, runId);
  }

  /**
   * One run: a batch for each group (a section or department) in order, each person with their own certificate and
   * details (a sheet's rows, 17 Nov 2026), each batch with its PDF. Returns each batch as `run` leaves it.
   */
  async issueInGroups(
    ctx: RequestContext,
    type: { id: string; name: string },
    runId: string,
    groups: Array<{
      scope: Record<string, unknown>;
      label: string;
      items: Parameters<CertificateBulkService['run']>[3];
    }>,
    overrideReason: string | null,
  ) {
    const tenant = requireTenant(ctx);
    const out: Array<Awaited<ReturnType<CertificateBulkService['run']>>> = [];
    for (const g of groups) {
      const batchId = await this.db.tenant(tenant, async (c) => {
        const b = await c.query<{ id: string }>(
          `INSERT INTO certificate_batches (school_id, type_id, title, scope, override_reason, created_by, run_id)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, app.current_user_id(), $5) RETURNING id::text`,
          [
            type.id,
            `${type.name} · ${g.label} (${String(g.items.length)})`.slice(0, 200),
            JSON.stringify(g.scope),
            overrideReason,
            runId,
          ],
        );
        return b.rows[0]!.id;
      });
      out.push(await this.run(ctx, batchId, type.name, g.items));
    }
    return out;
  }

  /** A run's batches with their PDFs (the run's page). */
  async runOf(ctx: RequestContext, runId: string) {
    if (!/^[0-9a-f-]{36}$/.test(runId)) throw new DomainError('not-found', 'Run not found');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        title: string;
        type_name: string;
        issued: number;
        skipped: number;
        export_id: string | null;
        export_status: string | null;
        by: string | null;
        created_at: Date;
      }>(
        `SELECT b.id::text, b.title, t.name AS type_name, cardinality(b.certificate_ids)::int AS issued,
                jsonb_array_length(b.skipped)::int AS skipped, b.export_id::text, e.status::text AS export_status,
                u.display_name AS by, b.created_at
           FROM certificate_batches b JOIN certificate_types t ON t.id = b.type_id
           LEFT JOIN exports e ON e.id = b.export_id LEFT JOIN users u ON u.id = b.created_by
          WHERE b.run_id = $1::uuid ORDER BY b.id`,
        [runId],
      );
      if (!r.rows.length) throw new DomainError('not-found', 'Run not found');
      const rows = r.rows.map((x) => ({
        id: x.id,
        title: x.title,
        issued: x.issued,
        skipped: x.skipped,
        exportId: x.export_id,
        exportStatus: x.export_status,
      }));
      return {
        runId,
        typeName: r.rows[0]!.type_name,
        by: r.rows[0]!.by,
        createdAt: r.rows[0]!.created_at.toISOString(),
        figures: {
          batches: rows.length,
          issued: rows.reduce((n, x) => n + x.issued, 0),
          skipped: rows.reduce((n, x) => n + x.skipped, 0),
          ready: rows.filter((x) => x.exportStatus === 'ready').length,
          withPdf: rows.filter((x) => x.exportId).length,
        },
        batches: rows,
      };
    });
  }

  /** Every batch PDF of a run in one ZIP, a file each, named by its section. */
  async runZip(ctx: RequestContext, runId: string) {
    const run = await this.runOf(ctx, runId);
    const withPdf = run.batches.filter((b) => b.exportId);
    if (!withPdf.length)
      throw new DomainError('validation-failed', 'No PDF in this run', { status: 400 });
    if (withPdf.some((b) => b.exportStatus !== 'ready'))
      throw new DomainError(
        'certificate.run_not_ready',
        'Some PDFs are still being made; try again in a moment',
        { status: 409 },
      );
    const files = await this.db.tenant(
      requireTenant(ctx),
      async (c) =>
        (
          await c.query<{ batch_id: string; object_key: string }>(
            `SELECT b.id::text AS batch_id, f.object_key FROM certificate_batches b
             JOIN exports e ON e.id = b.export_id JOIN files f ON f.id = e.file_id
            WHERE b.run_id = $1::uuid AND f.deleted_at IS NULL ORDER BY b.id`,
            [runId],
          )
        ).rows,
    );
    const zip = new JSZip();
    const used = new Set<string>();
    for (const f of files) {
      const b = run.batches.find((x) => x.id === f.batch_id)!;
      let name =
        b.title
          .replace(/[^\w\- ().·–]+/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100) || `batch ${b.id}`;
      while (used.has(name)) name = `${name} ${b.id}`;
      used.add(name);
      zip.file(`${name}.pdf`, await this.storage.read(f.object_key));
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return {
      filename: `${run.typeName} - ${String(run.figures.issued)} certificates.zip`.replace(
        /[^\w\- ().]+/g,
        '',
      ),
      contentType: 'application/zip',
      base64: bytes.toString('base64'),
    };
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
        `SELECT x.id::text, x.number, x.status, COALESCE(s.display_name, em.display_name) AS name,
                COALESCE(s.admission_no, em.employee_code) AS admission_no, x.override_reason IS NOT NULL AS override
           FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) JOIN certificates x ON x.id = o.id
           LEFT JOIN students s ON s.id = x.student_id LEFT JOIN employees em ON em.id = x.employee_id ORDER BY o.n`,
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
