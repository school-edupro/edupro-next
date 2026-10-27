import { Injectable } from '@nestjs/common';
import type { ReportRow } from '@edupro/db';
import ExcelJS from 'exceljs';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { tablePdf } from './admission-pdf';
import type { AdmissionGridDto } from './grid.dto';
import { AdmissionGridService } from './grid.service';

/** The ready-made admission reports (docs/design/52, part 1); the school's own come from the report builder. */
export const READY_REPORTS = [
  {
    key: 'register',
    name: 'Registration register',
    description: 'Every submitted registration: number, date, candidate, class, category, parents.',
  },
  {
    key: 'class_summary',
    name: 'Class-wise summary',
    description: 'Per class: forms started, fee due, in process, selected, admitted, closed.',
  },
  {
    key: 'category_count',
    name: 'Category-wise count',
    description: 'Submitted registrations per class and fee category.',
  },
  {
    key: 'fee_due',
    name: 'Fee due list',
    description: 'Registration fee or admission fee due, with the amount, pay-by date and mobile.',
  },
  {
    key: 'admitted',
    name: 'Admitted list',
    description: 'Admission no., class-section, category, admission fee and receipt.',
  },
  {
    key: 'merit',
    name: 'Merit list',
    description: 'Per class, ranked by merit points, of registrations still in process.',
  },
] as const;
export type ReadyReportKey = (typeof READY_REPORTS)[number]['key'];

const DRAFT = 'Form not submitted';
const IN_PROCESS = ['Registered', 'Under review', 'Correction asked', 'Shortlisted'];
const SELECTED = ['Selected', 'Waiting list', 'Offered'];
const ADMITTED = ['Admission fee paid', 'Admitted'];
const CLOSED = ['Not selected', 'Withdrawn', 'Cancelled'];

interface Table {
  title: string;
  /** header and width in PDF points (the PDF page holds about 515) */
  columns: Array<{ h: string; w: number }>;
  rows: string[][];
  /** a summary counts registrations, not its own rows */
  counts?: number;
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dmy = (v: unknown) => {
  const s = txt(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const money = (v: unknown) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-IN');

/**
 * Ready-made admission reports for the Admissions list's "Download report" (docs/design/52): each runs
 * on what the list shows (tab, filters, search) and comes back at once as Excel or a letterhead PDF.
 */
@Injectable()
export class AdmissionReadyReportsService {
  constructor(
    private readonly db: DbService,
    private readonly grid: AdmissionGridService,
    private readonly core: AdmissionCoreService,
  ) {}

  list() {
    return { reports: READY_REPORTS.map((r) => ({ ...r })) };
  }

  async run(ctx: RequestContext, key: string, dto: AdmissionGridDto & { format: 'xlsx' | 'pdf' }) {
    const def = READY_REPORTS.find((r) => r.key === key);
    if (!def) throw new DomainError('not-found', 'Report not found', { status: 404 });
    const rows = await this.grid.viewRows(ctx, { ...dto, columns: [] });
    const order = await this.db.tenant(requireTenant(ctx), async (c) => ({
      classes: (
        await c.query<{ name: string }>(
          `SELECT name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
        )
      ).rows.map((x) => x.name),
      categories: (
        await c.query<{ name: string }>(
          `SELECT name FROM admission_fee_categories ORDER BY sort_order, id`,
        )
      ).rows.map((x) => x.name),
    }));
    const table = this.table(def.key, def.name, rows, order);
    const n = table.counts ?? table.rows.length;
    const subtitle = `${String(n)} registration${n === 1 ? '' : 's'} · ${ctx.user.displayName}`;
    const file = `admissions-${def.key.replace(/_/g, '-')}`;
    if (dto.format === 'pdf')
      return this.db.tenant(requireTenant(ctx), async (c) => {
        const sc = (
          await c.query<{
            name: string;
            address: string | null;
            contact: string | null;
            logo: string | null;
          }>(
            `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
                    NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
               FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]!;
        const bytes = await tablePdf({
          school: {
            name: sc.name,
            address: sc.address,
            contact: sc.contact ? `Phone ${sc.contact}` : null,
          },
          logo: await this.core.fileBytes(c, sc.logo),
          title: table.title,
          subtitle,
          columns: table.columns,
          rows: table.rows,
          printedAt: new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date()),
        });
        return { bytes, filename: `${file}.pdf`, contentType: 'application/pdf' };
      });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(def.name.slice(0, 31));
    ws.addRow([table.title]).font = { bold: true };
    ws.addRow([subtitle]);
    ws.addRow([]);
    ws.addRow(table.columns.map((x) => x.h)).font = { bold: true };
    table.columns.forEach(
      (x, i) => (ws.getColumn(i + 1).width = Math.max(10, Math.round(x.w / 4))),
    );
    for (const r of table.rows) ws.addRow(r);
    return {
      bytes: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: `${file}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** The report's columns and rows from the list's rows. */
  private table(
    key: ReadyReportKey,
    title: string,
    all: ReportRow[],
    order: { classes: string[]; categories: string[] },
  ): Table {
    const submitted = all.filter((r) => r.status !== DRAFT);
    const classesOf = (rows: ReportRow[]) => {
      const seen = new Set(rows.map((r) => txt(r.class_sought)));
      return [
        ...order.classes.filter((x) => seen.has(x)),
        ...[...seen].filter((x) => !order.classes.includes(x)).sort(),
      ];
    };
    const st = (r: ReportRow) => txt(r.status);
    switch (key) {
      case 'register':
        return {
          title,
          columns: [
            { h: 'Registration no.', w: 92 },
            { h: 'Date', w: 52 },
            { h: 'Candidate', w: 86 },
            { h: 'Class', w: 44 },
            { h: 'Category', w: 54 },
            { h: 'Father', w: 66 },
            { h: 'Mobile', w: 56 },
            { h: 'Status', w: 65 },
          ],
          rows: [...submitted]
            .sort((a, b) => txt(a.registration_no).localeCompare(txt(b.registration_no)))
            .map((r) => [
              txt(r.registration_no),
              dmy(r.registered_on ?? r.submitted_on),
              txt(r.candidate),
              txt(r.class_sought),
              txt(r.category),
              txt(r.f_father_name),
              txt(r.mobile),
              st(r),
            ]),
        };
      case 'class_summary': {
        const buckets: Array<[string, (r: ReportRow) => boolean]> = [
          ['Not submitted', (r) => st(r) === DRAFT],
          ['Reg. fee due', (r) => st(r) === 'Registration fee due'],
          ['In process', (r) => IN_PROCESS.includes(st(r))],
          ['Selected', (r) => SELECTED.includes(st(r))],
          ['Admitted', (r) => ADMITTED.includes(st(r))],
          ['Closed', (r) => CLOSED.includes(st(r))],
        ];
        const line = (name: string, rows: ReportRow[]) => [
          name,
          ...buckets.map(([, f]) => String(rows.filter(f).length)),
          String(rows.length),
        ];
        return {
          title,
          columns: [
            { h: 'Class', w: 65 },
            ...buckets.map(([h], i) => ({ h, w: i === 0 ? 70 : 62 })),
            { h: 'Total', w: 60 },
          ],
          rows: [
            ...classesOf(all).map((k) =>
              line(
                k,
                all.filter((r) => txt(r.class_sought) === k),
              ),
            ),
            line('All classes', all),
          ],
          counts: all.length,
        };
      }
      case 'category_count': {
        const seen = new Set(submitted.map((r) => txt(r.category) || 'Not set'));
        const cats = [
          ...order.categories.filter((x) => seen.has(x)),
          ...[...seen].filter((x) => !order.categories.includes(x)),
        ];
        const w = Math.max(40, Math.floor(380 / Math.max(1, cats.length)));
        const line = (name: string, rows: ReportRow[]) => [
          name,
          ...cats.map((k) =>
            String(rows.filter((r) => (txt(r.category) || 'Not set') === k).length),
          ),
          String(rows.length),
        ];
        return {
          title,
          columns: [{ h: 'Class', w: 75 }, ...cats.map((h) => ({ h, w })), { h: 'Total', w: 55 }],
          rows: [
            ...classesOf(submitted).map((k) =>
              line(
                k,
                submitted.filter((r) => txt(r.class_sought) === k),
              ),
            ),
            line('All classes', submitted),
          ],
          counts: submitted.length,
        };
      }
      case 'fee_due':
        return {
          title,
          columns: [
            { h: 'Registration no.', w: 92 },
            { h: 'Candidate', w: 90 },
            { h: 'Class', w: 44 },
            { h: 'Category', w: 56 },
            { h: 'Fee', w: 72 },
            { h: 'Amount', w: 50 },
            { h: 'Pay by', w: 52 },
            { h: 'Mobile', w: 59 },
          ],
          rows: all
            .filter((r) => st(r) === 'Registration fee due' || st(r) === 'Offered')
            .map((r) => {
              const reg = st(r) === 'Registration fee due';
              return [
                txt(r.registration_no),
                txt(r.candidate),
                txt(r.class_sought),
                txt(r.category),
                reg ? 'Registration fee' : 'Admission fee',
                money(reg ? r.registration_fee : r.admission_fee),
                reg ? '' : dmy(r.offer_last_date),
                txt(r.mobile),
              ];
            }),
        };
      case 'admitted':
        return {
          title,
          columns: [
            { h: 'Admission no.', w: 70 },
            { h: 'Candidate', w: 92 },
            { h: 'Class-section', w: 60 },
            { h: 'Category', w: 58 },
            { h: 'Admission fee', w: 56 },
            { h: 'Receipt', w: 80 },
            { h: 'Paid on', w: 50 },
            { h: 'Admitted on', w: 49 },
          ],
          rows: all
            .filter((r) => ADMITTED.includes(st(r)))
            .map((r) => [
              txt(r.admission_no),
              txt(r.candidate),
              txt(r.class_section) || txt(r.class_sought),
              txt(r.category),
              money(r.admission_fee),
              txt(r.admission_receipt),
              dmy(r.fee_paid_on),
              dmy(r.admitted_on),
            ]),
        };
      case 'merit': {
        const live = submitted.filter(
          (r) => !CLOSED.includes(st(r)) && r.merit !== null && r.merit !== undefined,
        );
        const rows: string[][] = [];
        for (const k of classesOf(live)) {
          const ranked = live
            .filter((r) => txt(r.class_sought) === k)
            .sort((a, b) => Number(b.merit) - Number(a.merit));
          let rank = 0;
          let last: number | null = null;
          ranked.forEach((r, i) => {
            if (Number(r.merit) !== last) rank = i + 1;
            last = Number(r.merit);
            rows.push([
              k,
              String(rank),
              txt(r.registration_no),
              txt(r.candidate),
              txt(r.category),
              txt(r.merit),
              st(r),
            ]);
          });
        }
        return {
          title,
          columns: [
            { h: 'Class', w: 50 },
            { h: 'Rank', w: 34 },
            { h: 'Registration no.', w: 96 },
            { h: 'Candidate', w: 100 },
            { h: 'Category', w: 70 },
            { h: 'Merit', w: 45 },
            { h: 'Status', w: 120 },
          ],
          rows,
        };
      }
    }
  }
}
