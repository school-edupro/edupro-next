import { Injectable } from '@nestjs/common';
import {
  ADMISSION_STATUS_LABELS,
  PDF_COLUMN_LIMIT,
  QUEUES,
  applyReportFilters,
  applyReportSearch,
  loadAdmissionReportRows,
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
import type { AdmissionGridDto, AdmissionGridExportDto } from './grid.dto';

const DS = 'admissions' as const;
const IDENTITY = [
  'registration_no',
  'candidate',
  'class_sought',
  'session',
  'status',
  'admission_no',
  'mobile',
];
const DEFAULT_SORT = [{ key: 'registration_no', dir: 'desc' as const }];
const TABS: Record<'in_progress' | 'unfinished' | 'admitted' | 'closed', string[]> = {
  in_progress: [
    'Registered',
    'Under review',
    'Correction asked',
    'Shortlisted',
    'Selected',
    'Waiting list',
    'Offered',
  ],
  unfinished: ['Form not submitted', 'Registration fee due'],
  admitted: ['Admission fee paid', 'Admitted'],
  closed: ['Not selected', 'Withdrawn', 'Cancelled'],
};
const invalid = (errors: string[]) =>
  new DomainError('validation-failed', errors.join('; '), { status: 400, extra: { errors } });

/**
 * The admissions list (docs/design/39, part 7): every registration with any registration, fee, admission
 * or form-answer column, any field as a filter (the report builder's engine on the Admissions dataset),
 * the search box, status tabs with counts, sort and pages; the same view exports to a branded Excel or PDF.
 */
@Injectable()
export class AdmissionGridService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private sensitive(ctx: RequestContext) {
    return ctx.permissions?.has('people.sensitive.view') ?? false;
  }

  private check(dto: AdmissionGridDto) {
    const errors = validateReportSpec({
      dataset: DS,
      columns: dto.columns.length ? dto.columns : [{ key: 'registration_no' }],
      filters: dto.filters as ReportFilter[],
      sort: dto.sort,
      options: { paper: 'A4', orientation: 'auto' },
    });
    if (errors.length) throw invalid(errors);
  }

  private tab(s: AdmissionGridDto['status']) {
    return (r: ReportRow) => s === 'all' || TABS[s].includes(String(r.status));
  }

  /** Every field that can be a column or a filter, with drop-down values for the filters. */
  async fields(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sessions = await c.query<{ name: string }>(
        `SELECT name FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC`,
      );
      const classes = await c.query<{ name: string }>(
        `SELECT DISTINCT cl.name, cl.display_order FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id ORDER BY cl.display_order, cl.name`,
      );
      const categories = await c.query<{ name: string }>(
        `SELECT name FROM admission_fee_categories ORDER BY sort_order, id`,
      );
      const stages = await c.query<{ name: string }>(
        `SELECT name FROM admission_stages ORDER BY sort_order, id`,
      );
      const fixed: Record<string, string[]> = {
        session: sessions.rows.map((x) => x.name),
        class_sought: classes.rows.map((x) => x.name),
        status: ADMISSION_STATUS_LABELS,
        stage: stages.rows.map((x) => x.name),
        category: categories.rows.map((x) => x.name),
        entered_at: ['Online', 'School desk'],
        refund_status: ['requested', 'approved', 'rejected', 'paid'],
      };
      const d = reportDataset(DS);
      return {
        sections: d.sections,
        fields: d.fields.map((f) => ({
          ...f,
          options: fixed[f.key] ?? null,
          masked: Boolean(f.sensitive) && !this.sensitive(ctx),
        })),
      };
    });
  }

  async grid(ctx: RequestContext, dto: AdmissionGridDto) {
    this.check(dto);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const all = await loadAdmissionReportRows(c, { showSensitive: this.sensitive(ctx) });
      const searching = Boolean(dto.search?.trim());
      const stats = {
        total: all.length,
        in_progress: all.filter(this.tab('in_progress')).length,
        unfinished: all.filter(this.tab('unfinished')).length,
        admitted: all.filter(this.tab('admitted')).length,
        closed: all.filter(this.tab('closed')).length,
      };
      const filtered = sortReportRows(
        applyReportFilters(
          applyReportSearch(searching ? all : all.filter(this.tab(dto.status)), dto.search, DS),
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
        const o: ReportRow = { __id: r.__id ?? null };
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

  /**
   * The admissions dashboard (docs/design/39, part 7): figures first (registrations, fees collected, in
   * process, offered, admitted, cancelled), then the funnel per class with seats, then small charts (the
   * last 30 days, categories, online or desk).
   */
  async overview(ctx: RequestContext, cycleId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cycles = await c.query<{ id: string; name: string; status: string }>(
        `SELECT id::text, name, status::text FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC`,
      );
      const id =
        cycleId ?? cycles.rows.find((x) => x.status === 'open')?.id ?? cycles.rows[0]?.id ?? null;
      if (!id) return { cycles: [], session: null };
      const f = await c.query<Record<string, number>>(
        `SELECT count(*)::int AS started,
                count(*) FILTER (WHERE a.status <> 'draft')::int AS submitted,
                count(*) FILTER (WHERE a.application_no IS NOT NULL)::int AS registered,
                count(*) FILTER (WHERE a.status::text IN ('registered', 'under_review'))::int AS in_process,
                count(*) FILTER (WHERE a.status = 'sent_back')::int AS sent_back,
                count(*) FILTER (WHERE a.status::text IN ('registered', 'under_review') AND st.kind IN ('test', 'interview', 'interaction'))::int AS at_test,
                count(*) FILTER (WHERE a.status = 'offered')::int AS offered,
                count(*) FILTER (WHERE a.status = 'waitlisted')::int AS waitlisted,
                count(*) FILTER (WHERE a.status = 'fee_paid')::int AS fee_paid,
                count(*) FILTER (WHERE a.status = 'admitted')::int AS admitted,
                count(*) FILTER (WHERE a.status = 'rejected')::int AS rejected,
                count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
                count(*) FILTER (WHERE a.status = 'submitted')::int AS fee_due,
                count(*) FILTER (WHERE a.status = 'draft')::int AS drafts,
                count(*) FILTER (WHERE a.entered_by IS NOT NULL AND a.application_no IS NOT NULL)::int AS desk
           FROM applications a LEFT JOIN admission_stages st ON st.id = (a.process_steps -> a.stage_no ->> 'stageId')::bigint
          WHERE a.cycle_id = $1 AND a.form_id IS NOT NULL`,
        [id],
      );
      const fees = await c.query<{ reg: string; adm: string; refunds: string }>(
        `SELECT COALESCE(sum(m.amount) FILTER (WHERE h.code = 'ADMREG'), 0)::text AS reg,
                COALESCE(sum(m.amount) FILTER (WHERE h.code = 'ADMFEE'), 0)::text AS adm,
                (SELECT COALESCE(sum(r.amount), 0) FROM admission_refunds r JOIN applications a2 ON a2.id = r.application_id
                  WHERE a2.cycle_id = $1 AND r.status = 'paid')::text AS refunds
           FROM misc_receipts m JOIN applications a ON a.id = m.application_id JOIN fee_heads h ON h.id = m.head_id
          WHERE a.cycle_id = $1 AND m.status = 'posted'`,
        [id],
      );
      const byClass = await c.query<{
        class_id: string;
        class_name: string;
        seats: number;
        registered: number;
        in_process: number;
        offered: number;
        waitlisted: number;
        confirmed: number;
        admitted: number;
        cancelled: number;
      }>(
        `SELECT k.class_id::text, cl.name AS class_name, k.seats,
                count(a.id) FILTER (WHERE a.application_no IS NOT NULL)::int AS registered,
                count(a.id) FILTER (WHERE a.status::text IN ('registered', 'under_review', 'sent_back'))::int AS in_process,
                count(a.id) FILTER (WHERE a.status = 'offered')::int AS offered,
                count(a.id) FILTER (WHERE a.status = 'waitlisted')::int AS waitlisted,
                count(a.id) FILTER (WHERE a.status::text IN ('fee_paid', 'admitted'))::int AS confirmed,
                count(a.id) FILTER (WHERE a.status = 'admitted')::int AS admitted,
                count(a.id) FILTER (WHERE a.status = 'cancelled')::int AS cancelled
           FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
           LEFT JOIN applications a ON a.cycle_id = k.cycle_id AND a.class_id = k.class_id AND a.form_id IS NOT NULL
          WHERE k.cycle_id = $1 GROUP BY k.class_id, cl.name, cl.display_order, k.seats ORDER BY cl.display_order, cl.name`,
        [id],
      );
      const daily = await c.query<{ d: string; registrations: number; collected: string }>(
        `WITH days AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 29, (now() AT TIME ZONE 'Asia/Kolkata')::date, '1 day')::date AS d)
         SELECT to_char(days.d, 'DD Mon') AS d,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = $1 AND (a.registered_at AT TIME ZONE 'Asia/Kolkata')::date = days.d) AS registrations,
                (SELECT COALESCE(sum(m.amount), 0)::text FROM misc_receipts m JOIN applications a ON a.id = m.application_id
                  WHERE a.cycle_id = $1 AND m.status = 'posted' AND m.received_on = days.d) AS collected
           FROM days ORDER BY days.d`,
        [id],
      );
      const byCategory = await c.query<{ name: string; n: number }>(
        `SELECT COALESCE(k.name, 'Not set') AS name, count(*)::int AS n FROM applications a LEFT JOIN admission_fee_categories k ON k.id = a.category_id
          WHERE a.cycle_id = $1 AND a.application_no IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        [id],
      );
      const x = f.rows[0]!;
      const fee = fees.rows[0]!;
      return {
        cycles: cycles.rows,
        session: cycles.rows.find((y) => y.id === id) ?? null,
        figures: {
          started: x.started,
          submitted: x.submitted,
          registered: x.registered,
          drafts: x.drafts,
          feeDue: x.fee_due,
          inProcess: x.in_process,
          sentBack: x.sent_back,
          atTest: x.at_test,
          offered: x.offered,
          waitlisted: x.waitlisted,
          feePaid: x.fee_paid,
          admitted: x.admitted,
          rejected: x.rejected,
          cancelled: x.cancelled,
          desk: x.desk,
          registrationFees: Number(fee.reg),
          admissionFees: Number(fee.adm),
          refunds: Number(fee.refunds),
        },
        byClass: byClass.rows.map((r) => ({
          classId: r.class_id,
          className: r.class_name,
          seats: r.seats,
          registered: r.registered,
          inProcess: r.in_process,
          offered: r.offered,
          waitlisted: r.waitlisted,
          confirmed: r.confirmed,
          admitted: r.admitted,
          cancelled: r.cancelled,
        })),
        daily: daily.rows.map((r) => ({
          day: r.d,
          registrations: r.registrations,
          collected: Number(r.collected),
        })),
        byCategory: byCategory.rows,
      };
    });
  }

  /** The current view as a branded Excel or PDF. */
  async export(ctx: RequestContext, dto: AdmissionGridExportDto) {
    this.check(dto);
    const searching = Boolean(dto.search?.trim());
    const statusFilters: ReportFilter[] =
      searching || dto.status === 'all'
        ? []
        : [{ key: 'status', op: 'in', values: TABS[dto.status] }];
    const columns = [
      { key: 'registration_no' },
      { key: 'candidate', label: 'Candidate' },
      ...dto.columns.filter((x) => x.key !== 'registration_no' && x.key !== 'candidate'),
    ];
    const spec: ReportSpec = {
      dataset: DS,
      columns,
      filters: [...statusFilters, ...(dto.filters as ReportFilter[])],
      sort: dto.sort.length ? dto.sort : DEFAULT_SORT,
      options: {
        paper: columns.length > PDF_COLUMN_LIMIT.A4 ? 'A3' : 'A4',
        orientation: 'auto',
        includeInactive: true,
        search: dto.search ?? null,
      },
    };
    const errors = validateReportSpec(spec, dto.format);
    if (errors.length) throw invalid(errors);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const title = dto.title?.trim() || 'Admissions';
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
        action: 'admissions.list_export',
        entityType: 'exports',
        entityId: exportId,
        after: { format: dto.format, columns: columns.length, filters: spec.filters.length },
      });
      return { exportId, format: dto.format, spec };
    });
  }
}
