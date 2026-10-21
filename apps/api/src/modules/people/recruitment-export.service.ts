import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  CANDIDATE_ACTIVITIES,
  CANDIDATE_DOCUMENTS,
  CANDIDATE_FIELDS,
  CANDIDATE_ROWS,
  decryptField,
  maskValue,
  type CandidateRowKind,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import { APP_COLS, appFilter, nameOf, type AppRow, type AppStatus } from './recruitment-app';
import type { ApplicationExportDto } from './recruitment-screening.dto';

const STATUS: Record<AppStatus, string> = {
  submitted: 'Received',
  screening: 'Under screening',
  selected: 'Selected',
  rejected: 'Not taken forward',
  on_hold: 'On hold',
  withdrawn: 'Withdrawn',
  joined: 'Joined',
  returned: 'Correction needed',
};
const RESULT: Record<string, string> = {
  pass: 'Passed',
  fail: 'Not through',
  hold: 'On hold',
  skipped: 'Skipped',
};
const LIMIT = 5000;
/** India time as Excel shows it (a workbook has no time zone). */
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v);
/** Excel's rules for a sheet name: 31 characters, none of []:*?/\ */
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

type Cell = string | number | Date | null;
interface Col {
  header: string;
  width?: number;
  date?: 'day' | 'time';
}

/**
 * The candidates as an Excel workbook (docs/design/34-recruitment.md, part 9): the list as filtered (or
 * the ticked ones). "Candidates": one row per application, with where it stands, every stage's date,
 * result and marks, every answer of the form, the interests and the documents given; a sheet for each
 * list (qualifications, experience, training, children, references) joined by the application number;
 * "About this export" says what was taken and when. Aadhaar and PAN in full only for those who may see
 * sensitive details. Every export is in the audit log.
 */
@Injectable()
export class RecruitmentExportService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async export(ctx: RequestContext, q: ApplicationExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = appFilter(q);
      const apps = (
        await c.query<AppRow & { employee_code: string | null }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments chosen in appFilter; values are bound
          `SELECT x.*, e.employee_code FROM (${APP_COLS} ${f.sql}
             ORDER BY a.submitted_at DESC, a.id DESC LIMIT ${String(LIMIT)}) x
             LEFT JOIN employees e ON e.id = x.employee_id::bigint`,
          f.args,
        )
      ).rows;
      const ids = apps.map((a) => a.id);
      const stages = (
        await c.query<{ id: string; name: string }>(
          `SELECT id::text, name FROM recruitment_stages
            WHERE id IN (SELECT unnest(stage_ids) FROM vacancies v JOIN job_applications a ON a.vacancy_id = v.id
                          WHERE a.id = ANY($1::bigint[]))
            ORDER BY sort_order, id`,
          [ids],
        )
      ).rows;
      const results = (
        await c.query<{
          application_id: string;
          stage_id: string;
          scheduled_at: Date | null;
          marks: string | null;
          max_marks: string | null;
          result: string | null;
        }>(
          `SELECT application_id::text, stage_id::text, scheduled_at, marks::text, max_marks::text, result
             FROM application_stage_results WHERE application_id = ANY($1::bigint[])`,
          [ids],
        )
      ).rows;
      const resultOf = new Map(results.map((r) => [`${r.application_id}:${r.stage_id}`, r]));
      const full = ctx.permissions?.has(PEOPLE.sensitiveView) ?? false;

      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      wb.created = new Date();

      // ---- Candidates: one row per application
      const cols: Col[] = [
        { header: 'Application no.', width: 16 },
        { header: 'Name', width: 24 },
        { header: 'Post', width: 26 },
        { header: 'Vacancy', width: 14 },
        { header: 'Source', width: 10 },
        { header: 'Applied on', width: 17, date: 'time' },
        { header: 'Status', width: 18 },
        { header: 'Current stage', width: 18 },
        ...stages.flatMap((s): Col[] => [
          { header: `${s.name}: date`, width: 17, date: 'time' },
          { header: `${s.name}: result`, width: 14 },
          { header: `${s.name}: marks`, width: 10 },
        ]),
        ...CANDIDATE_FIELDS.map((fd): Col => ({
          header: fd.label,
          width: Math.min(40, Math.max(12, fd.label.length + 2)),
          ...(fd.type === 'date' ? { date: 'day' as const } : {}),
        })),
        { header: 'Interests', width: 30 },
        { header: 'Documents given', width: 40 },
        { header: 'Decision note', width: 30 },
        { header: 'Decided on', width: 17, date: 'time' },
        { header: 'Correction asked', width: 40 },
        { header: 'Same mobile or email as', width: 26 },
        { header: 'Joined as (employee code)', width: 14 },
      ];
      const rows = apps.map((a): Cell[] => {
        const v = a.snapshot.values;
        const answer = (fd: (typeof CANDIDATE_FIELDS)[number]): Cell => {
          if (fd.sensitive) {
            const enc = a.snapshot_secure?.[fd.key];
            let plain: string | null = null;
            try {
              plain = enc ? decryptField(enc) : null;
            } catch {
              plain = null;
            }
            return plain ? (full ? plain : maskValue(plain, fd.type)) : null;
          }
          const raw = v[fd.key];
          if (raw === null || raw === undefined || raw === '') return null;
          if (fd.type === 'date') return day(String(raw));
          if (fd.type === 'number' && Number.isFinite(Number(raw))) return Number(raw);
          if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
          return String(raw);
        };
        const given = CANDIDATE_DOCUMENTS.map((d) => {
          const n = a.snapshot.files.filter((x) => x.kind === d.kind).length;
          return n ? `${d.label}${n > 1 ? ` (${String(n)})` : ''}` : null;
        }).filter(Boolean);
        const corr =
          a.status === 'returned' && a.correction
            ? `${a.correction.partsText}: ${a.correction.remark} (by ${a.correction.dueOn.split('-').reverse().join('-')})`
            : null;
        return [
          a.number,
          nameOf(a),
          a.vacancy,
          a.vacancy_code,
          a.source === 'office' ? 'Walk-in' : 'Online',
          ist(a.submitted_at),
          STATUS[a.status],
          a.stage,
          ...stages.flatMap((s): Cell[] => {
            if (!a.stage_ids.includes(s.id)) return [null, null, null];
            const r = resultOf.get(`${a.id}:${s.id}`);
            return [
              r?.scheduled_at ? ist(r.scheduled_at) : null,
              r?.result ? (RESULT[r.result] ?? r.result) : null,
              r?.marks !== null && r?.marks !== undefined ? Number(r.marks) : null,
            ];
          }),
          ...CANDIDATE_FIELDS.map(answer),
          a.snapshot.activities
            .filter((x) => (CANDIDATE_ACTIVITIES as readonly string[]).includes(x))
            .join(', ') || null,
          given.join(', ') || null,
          a.decision_note,
          a.decided_at ? ist(a.decided_at) : null,
          corr,
          a.employee_match?.length
            ? a.employee_match.map((m) => `${m.name} (${m.code})`).join(', ')
            : null,
          a.employee_code,
        ];
      });
      this.sheet(wb, 'Candidates', cols, rows);

      // ---- a sheet per list, joined by the application number
      for (const kind of Object.keys(CANDIDATE_ROWS) as CandidateRowKind[]) {
        const def = CANDIDATE_ROWS[kind];
        const lines = apps.flatMap((a) =>
          (a.snapshot.rows[kind] ?? []).map((r): Cell[] => [
            a.number,
            nameOf(a),
            ...def.columns.map((col) => {
              const x = r[col.key];
              if (!x) return null;
              if (col.type === 'date') return day(x);
              if (col.type === 'year' && /^\d{4}$/.test(x)) return Number(x);
              return x;
            }),
          ]),
        );
        this.sheet(
          wb,
          sheetName(def.title),
          [
            { header: 'Application no.', width: 16 },
            { header: 'Name', width: 24 },
            ...def.columns.map((col): Col => ({
              header: col.label,
              width: Math.min(36, Math.max(12, col.label.length + 4)),
              ...(col.type === 'date' ? { date: 'day' as const } : {}),
            })),
          ],
          lines,
        );
      }

      // ---- what was taken, when, by whom
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const vacancy = q.vacancy
        ? (
            await c.query<{ title: string; code: string }>(
              `SELECT title, code FROM vacancies WHERE id = $1`,
              [q.vacancy],
            )
          ).rows[0]
        : undefined;
      const stage = q.stage
        ? (
            await c.query<{ name: string }>(`SELECT name FROM recruitment_stages WHERE id = $1`, [
              q.stage,
            ])
          ).rows[0]
        : undefined;
      const filters =
        [
          q.ids?.length ? `${String(q.ids.length)} ticked` : null,
          vacancy ? `Vacancy: ${vacancy.title} (${vacancy.code})` : null,
          stage ? `Stage: ${stage.name}` : null,
          q.status ? `Status: ${STATUS[q.status]}` : null,
          q.q ? `Search: ${q.q}` : null,
          q.match ? 'Same mobile or email as an employee' : null,
        ]
          .filter(Boolean)
          .join('; ') || 'All candidates';
      const about = wb.addWorksheet('About this export');
      (
        [
          ['School', school],
          ['Exported on', ist(new Date())],
          ['By', ctx.user.displayName],
          ['Candidates', filters],
          ['Rows', apps.length],
          ['Aadhaar and PAN', full ? 'In full' : 'Masked'],
          ...(apps.length === LIMIT
            ? [['Note', `Only the latest ${String(LIMIT)} are in this file: narrow the filters.`]]
            : []),
        ] as Array<[string, Cell]>
      ).forEach(([k, val]) => {
        const r = about.addRow([k, val]);
        r.getCell(1).font = { bold: true };
        if (val instanceof Date) r.getCell(2).numFmt = 'dd-mm-yyyy hh:mm';
      });
      about.getColumn(1).width = 18;
      about.getColumn(2).width = 70;

      await this.audit.stage(ctx, c, {
        action: 'people.recruitment.export',
        entityType: 'job_applications',
        entityId: requireTenant(ctx).schoolId,
        after: { rows: apps.length, filters, sensitive: full },
      });
      const stamp = ist(new Date()).toISOString().slice(0, 10);
      const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      return {
        filename: `Candidates-${vacancy?.code ?? 'all'}-${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
        rows: apps.length,
      };
    });
  }

  /** A sheet: the header in bold and frozen, a filter on every column, dates as Excel dates. */
  private sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Cell[][]) {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map((col) => ({ header: col.header, width: col.width ?? 16 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: name === 'Candidates' ? 2 : 0 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    rows.forEach((r) => ws.addRow(r));
    cols.forEach((col, i) => {
      if (col.date)
        ws.getColumn(i + 1).numFmt = col.date === 'day' ? 'dd-mm-yyyy' : 'dd-mm-yyyy hh:mm';
    });
  }
}
