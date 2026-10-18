import { Injectable } from '@nestjs/common';
import {
  PDF_COLUMN_LIMIT,
  QUEUES,
  applyReportFilters,
  applyReportSearch,
  loadEmployeeLists,
  loadEmployeeReportRows,
  reportDataset,
  sortReportRows,
  validateReportSpec,
  type ReportFilter,
  type ReportRow,
  type ReportSpec,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import type { EmployeeGridDto, EmployeeGridExportDto } from './people.dto';
import { PEOPLE } from './people.permissions';

const DS = 'employee_profile' as const;
/** Always sent with each row: the identity cell and the row links need them. */
const IDENTITY = [
  'employee_code',
  'full_name',
  'designation',
  'department',
  'staff_type',
  'employee_status',
  'has_login',
  'profile_completeness',
];
const DEFAULT_SORT = [{ key: 'full_name', dir: 'asc' as const }];

const invalid = (errors: string[]) =>
  new DomainError('validation-failed', errors.join('; '), { status: 400, extra: { errors } });

/**
 * The employee list (docs/design/30-employee-master.md, part 2): any catalogue field as a column or a
 * filter (the report builder's engine on the employee dataset), the search box, status tabs with counts,
 * sort and pages; the same view exports to a branded Excel or PDF.
 */
@Injectable()
export class EmployeeGridService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private sensitive(ctx: RequestContext) {
    return ctx.permissions?.has(PEOPLE.sensitiveView) ?? false;
  }

  private check(dto: EmployeeGridDto) {
    const errors = validateReportSpec({
      dataset: DS,
      columns: dto.columns.length ? dto.columns : [{ key: 'employee_code' }],
      filters: dto.filters as ReportFilter[],
      sort: dto.sort,
      options: { paper: 'A4', orientation: 'auto' },
    });
    if (errors.length) throw invalid(errors);
  }

  private status(s: EmployeeGridDto['status']) {
    return (r: ReportRow) =>
      s === 'all'
        ? true
        : s === 'active'
          ? r.employee_status === 'Active'
          : r.employee_status !== 'Active';
  }

  /** Every field that can be a column or a filter, with drop-down values for the filters. */
  async fields(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_masters_seed(app.current_school_id()), app.staff_profile_lists_seed(app.current_school_id())`);
      const lists = await loadEmployeeLists(c);
      const fixed: Record<string, string[]> = {
        employee_status: ['Active', 'Inactive'],
        staff_group: ['Teaching', 'Non-teaching', 'Contract', 'Visiting'],
        has_login: ['Yes', 'No'],
        highest_qualification: lists.Qualification ?? [],
      };
      const d = reportDataset(DS);
      return {
        sections: d.sections,
        fields: d.fields.map((f) => ({
          ...f,
          options: fixed[f.key] ?? (f.list ? (lists[f.list] ?? null) : null),
          masked: Boolean(f.sensitive) && !this.sensitive(ctx),
        })),
      };
    });
  }

  async grid(ctx: RequestContext, dto: EmployeeGridDto) {
    this.check(dto);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const all = await loadEmployeeReportRows(c, {
        includeInactive: true,
        showSensitive: this.sensitive(ctx),
      });
      const searching = Boolean(dto.search?.trim());
      const stats = {
        total: all.length,
        active: all.filter(this.status('active')).length,
        inactive: all.filter(this.status('inactive')).length,
        teaching: all.filter((r) => r.employee_status === 'Active' && r.staff_group === 'Teaching')
          .length,
        nonTeaching: all.filter(
          (r) => r.employee_status === 'Active' && r.staff_group === 'Non-teaching',
        ).length,
        noLogin: all.filter((r) => r.employee_status === 'Active' && r.has_login === 'No').length,
        incomplete: all.filter(
          (r) => r.employee_status === 'Active' && Number(r.profile_completeness ?? 0) < 100,
        ).length,
      };
      const filtered = sortReportRows(
        applyReportFilters(
          // a search looks in every employee, whatever the status: one who has left is still found
          applyReportSearch(searching ? all : all.filter(this.status(dto.status)), dto.search, DS),
          dto.filters as ReportFilter[],
          DS,
        ),
        dto.sort.length ? dto.sort : DEFAULT_SORT,
        DS,
      );
      const pages = Math.max(1, Math.ceil(filtered.length / dto.size));
      const page = Math.min(dto.page, pages);
      const keys = [...new Set([...IDENTITY, ...dto.columns.map((x) => x.key)])];
      const rows = filtered.slice((page - 1) * dto.size, page * dto.size).map((r) => {
        const o: ReportRow = { __id: r.__id ?? null, __photo: r.__photo ?? null };
        for (const k of keys) o[k] = r[k] ?? null;
        return o;
      });
      const byKey = reportDataset(DS).byKey;
      return {
        searchedAll: searching,
        columns: dto.columns.map((col) => {
          const f = byKey.get(col.key)!;
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
  async export(ctx: RequestContext, dto: EmployeeGridExportDto) {
    this.check(dto);
    const searching = Boolean(dto.search?.trim());
    const statusFilters: ReportFilter[] =
      searching || dto.status === 'all'
        ? []
        : [
            {
              key: 'employee_status',
              op: dto.status === 'active' ? 'eq' : 'neq',
              values: ['Active'],
            },
          ];
    const columns = [
      { key: 'employee_code' },
      { key: 'full_name', label: 'Employee' },
      ...dto.columns.filter((x) => x.key !== 'employee_code' && x.key !== 'full_name'),
    ];
    const spec: ReportSpec = {
      dataset: DS,
      columns,
      filters: [...statusFilters, ...(dto.filters as ReportFilter[])],
      sort: dto.sort.length ? dto.sort : DEFAULT_SORT,
      options: {
        paper: columns.length > PDF_COLUMN_LIMIT.A4 ? 'A3' : 'A4',
        orientation: 'auto',
        includeInactive: searching || dto.status !== 'active',
        search: dto.search ?? null,
      },
    };
    const errors = validateReportSpec(spec, dto.format);
    if (errors.length) throw invalid(errors);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const title = dto.title?.trim() || 'Employee list';
      const y = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM academic_years WHERE id = $1`,
        [tenant.academicYearId ?? null],
      );
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
            academicYearId: y.rows[0]?.id ?? tenant.academicYearId ?? null,
            academicYear: y.rows[0]?.code ?? '',
            sectionIds: null,
            showSensitive: this.sensitive(ctx),
          }),
          title,
        ],
      );
      const exportId = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId });
      await this.audit.stage(ctx, c, {
        action: 'people.employee.list_export',
        entityType: 'exports',
        entityId: exportId,
        after: { format: dto.format, columns: columns.length, filters: spec.filters.length },
      });
      return { exportId, format: dto.format, spec };
    });
  }
}
