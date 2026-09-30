import { Injectable } from '@nestjs/common';
import {
  PDF_COLUMN_LIMIT,
  QUEUES,
  REPORT_SECTIONS,
  STUDENT_REPORT_FIELDS,
  loadProfileLists,
  STUDENT_REPORT_FIELD_BY_KEY,
  applyReportFilters,
  applyReportSearch,
  loadStudentReportRows,
  sortReportRows,
  validateReportSpec,
  type PoolClient,
  type ReportFilter,
  type ReportRow,
  type ReportSpec,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import type { StudentGridDto, StudentGridExportDto } from './people.dto';
import { PEOPLE } from './people.permissions';
import { StudentsService } from './students.service';

/** Always sent with each row: the identity cell and the row actions need them. */
const IDENTITY = [
  'admission_no',
  'full_name',
  'dob',
  'gender',
  'class_section',
  'roll_no',
  'student_status',
  'enrolment_status',
];
const LEFT = new Set(['Withdrawn', 'Left', 'Transferred']);

const invalid = (errors: string[]) =>
  new DomainError('validation-failed', errors.join('; '), { status: 400, extra: { errors } });

/**
 * The students list: any profile field as a column, any field as a filter (the report builder's
 * engine), the search box, status tabs with counts, sort and pages; the same view exports to a
 * branded Excel or PDF.
 */
@Injectable()
export class StudentGridService {
  constructor(
    private readonly db: DbService,
    private readonly students: StudentsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private statusFilter(status: StudentGridDto['status']): (r: ReportRow) => boolean {
    if (status === 'active')
      return (r) => r.student_status === 'Active' && !LEFT.has(String(r.enrolment_status));
    if (status === 'inactive')
      return (r) => r.student_status === 'Inactive' && !LEFT.has(String(r.enrolment_status));
    if (status === 'withdrawn') return (r) => LEFT.has(String(r.enrolment_status));
    return () => true;
  }

  private check(dto: StudentGridDto) {
    const errors = validateReportSpec({
      columns: dto.columns.length ? dto.columns : [{ key: 'admission_no' }],
      filters: dto.filters as ReportFilter[],
      sort: dto.sort,
      options: { paper: 'A4', orientation: 'auto' },
    });
    if (errors.length) throw invalid(errors);
  }

  private async load(ctx: RequestContext, c: PoolClient, yearId: string) {
    const tenant = requireTenant(ctx);
    return loadStudentReportRows(c, {
      academicYearId: yearId,
      sectionIds: await this.students.scopeFilter(tenant),
      includeInactive: true,
      showSensitive: ctx.permissions?.has(PEOPLE.sensitiveView) ?? false,
    });
  }

  private year(ctx: RequestContext, dto: StudentGridDto): string {
    const y = dto.academicYearId ?? requireTenant(ctx).academicYearId;
    if (!y) throw invalid(['Choose an academic year']);
    return y;
  }

  /** Every field that can be a column or a filter, with drop-down values for the filters. */
  async fields(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const showSensitive = ctx.permissions?.has(PEOPLE.sensitiveView) ?? false;
    return this.db.tenant(tenant, async (c) => {
      const lists = await loadProfileLists(c);
      const sections = await c.query<{ label: string }>(
        `SELECT c.code || '-' || cs.name AS label FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY c.code, cs.name`,
        [tenant.academicYearId ?? null],
      );
      const discounts = await c.query<{ name: string }>(
        `SELECT DISTINCT name FROM fee_discounts WHERE academic_year_id = $1 ORDER BY name`,
        [tenant.academicYearId ?? null],
      );
      const routes = await c.query<{ label: string }>(
        `SELECT code || ' ' || name AS label FROM transport_routes WHERE status = 'active' ORDER BY code`,
      );
      const fixed: Record<string, string[]> = {
        class_section: sections.rows.map((x) => x.label),
        student_status: ['Active', 'Inactive'],
        enrolment_status: ['Active', 'Promoted', 'Transferred', 'Withdrawn', 'Left'],
        fee_discount: discounts.rows.map((x) => x.name),
        transport_route: routes.rows.map((x) => x.label),
        student_type: ['New', 'Old'],
      };
      return {
        sections: REPORT_SECTIONS,
        fields: STUDENT_REPORT_FIELDS.map((f) => ({
          ...f,
          options: fixed[f.key] ?? (f.list ? (lists[f.list] ?? null) : null),
          masked: Boolean(f.sensitive) && !showSensitive,
        })),
      };
    });
  }

  async grid(ctx: RequestContext, dto: StudentGridDto) {
    this.check(dto);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const all = await this.load(ctx, c, this.year(ctx, dto));
      const stats = {
        total: all.length,
        active: all.filter(this.statusFilter('active')).length,
        inactive: all.filter(this.statusFilter('inactive')).length,
        withdrawn: all.filter(this.statusFilter('withdrawn')).length,
      };
      const filtered = sortReportRows(
        applyReportFilters(
          applyReportSearch(all.filter(this.statusFilter(dto.status)), dto.search),
          dto.filters as ReportFilter[],
        ),
        dto.sort.length
          ? dto.sort
          : [
              { key: 'class_section', dir: 'asc' },
              { key: 'roll_no', dir: 'asc' },
            ],
      );
      const pages = Math.max(1, Math.ceil(filtered.length / dto.size));
      const page = Math.min(dto.page, pages);
      const keys = [...new Set([...IDENTITY, ...dto.columns.map((x) => x.key)])];
      const rows = filtered.slice((page - 1) * dto.size, page * dto.size).map((r) => {
        const o: ReportRow = { __id: r.__id ?? null, __photo: r.__photo ?? null };
        for (const k of keys) o[k] = r[k] ?? null;
        return o;
      });
      return {
        columns: dto.columns.map((col) => {
          const f = STUDENT_REPORT_FIELD_BY_KEY.get(col.key)!;
          return { key: col.key, header: col.label?.trim() || f.label, type: f.type };
        }),
        rows,
        total: filtered.length,
        page,
        pages,
        stats,
      };
    });
  }

  /** The current view (columns, filters, search, status, sort) as a branded Excel or PDF. */
  async export(ctx: RequestContext, dto: StudentGridExportDto) {
    this.check(dto);
    const tenant = requireTenant(ctx);
    const statusFilters: ReportFilter[] =
      dto.status === 'active'
        ? [
            { key: 'student_status', op: 'eq', values: ['Active'] },
            { key: 'enrolment_status', op: 'not_in', values: [...LEFT] },
          ]
        : dto.status === 'inactive'
          ? [
              { key: 'student_status', op: 'eq', values: ['Inactive'] },
              { key: 'enrolment_status', op: 'not_in', values: [...LEFT] },
            ]
          : dto.status === 'withdrawn'
            ? [{ key: 'enrolment_status', op: 'in', values: [...LEFT] }]
            : [];
    const columns = [
      { key: 'admission_no' },
      { key: 'full_name', label: 'Student' },
      ...dto.columns.filter((x) => x.key !== 'admission_no' && x.key !== 'full_name'),
    ];
    const spec: ReportSpec = {
      columns,
      filters: [...statusFilters, ...(dto.filters as ReportFilter[])],
      sort: dto.sort.length
        ? dto.sort
        : [
            { key: 'class_section', dir: 'asc' },
            { key: 'roll_no', dir: 'asc' },
          ],
      options: {
        paper: columns.length > PDF_COLUMN_LIMIT.A4 ? 'A3' : 'A4',
        orientation: 'auto',
        includeInactive: dto.status !== 'active',
        search: dto.search ?? null,
      },
    };
    const errors = validateReportSpec(spec, dto.format);
    if (errors.length) throw invalid(errors);
    return this.db.tenant(tenant, async (c) => {
      const yearId = this.year(ctx, dto);
      const y = await c.query<{ code: string }>('SELECT code FROM academic_years WHERE id = $1', [
        yearId,
      ]);
      const title = dto.title?.trim() || 'Student list';
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), 'report_builder', $1, $2::jsonb, $3, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          dto.format,
          JSON.stringify({
            definitionId: null,
            name: title,
            description: null,
            spec,
            academicYearId: yearId,
            academicYear: y.rows[0]?.code ?? '',
            sectionIds: await this.students.scopeFilter(tenant),
            showSensitive: ctx.permissions?.has(PEOPLE.sensitiveView) ?? false,
          }),
          title,
        ],
      );
      const exportId = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId });
      await this.audit.stage(ctx, c, {
        action: 'people.student.list_export',
        entityType: 'exports',
        entityId: exportId,
        after: {
          format: dto.format,
          columns: columns.length,
          filters: spec.filters.length,
          search: dto.search ?? null,
        },
      });
      return { exportId, format: dto.format, spec };
    });
  }
}
