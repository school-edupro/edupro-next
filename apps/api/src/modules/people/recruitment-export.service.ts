import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import {
  CANDIDATE_ACTIVITIES,
  CANDIDATE_DOCUMENTS,
  CANDIDATE_FIELDS,
  CANDIDATE_ROWS,
  CANDIDATE_SECTIONS,
  decryptField,
  maskValue,
  type CandidateRowKind,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';
import { APP_COLS, appFilter, nameOf, type AppRow, type AppStatus } from './recruitment-app';
import type { ApplicationExportDto, ExportLayoutDto } from './recruitment-screening.dto';

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
const LAST = 'recruitment.export.last';
const KINDS = Object.keys(CANDIDATE_ROWS) as CandidateRowKind[];
/** India time as Excel shows it (a workbook has no time zone). */
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v);
const dmy = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('-') : v);
/** Excel's rules for a sheet name: 31 characters, none of []:*?/\ */
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
const round1 = (n: number) => Math.round(n * 10) / 10;

type Cell = string | number | Date | null;
type Row = AppRow & { employee_code: string | null };
interface StageResult {
  application_id: string;
  stage_id: string;
  scheduled_at: Date | null;
  marks: string | null;
  max_marks: string | null;
  result: string | null;
  remarks: string | null;
}
interface Ctx {
  full: boolean;
  results: Map<string, StageResult[]>;
  today: string;
}
/** One column the office can pick: where it is listed, its heading, how wide, how a row fills it. */
interface ColDef {
  key: string;
  group: string;
  header: string;
  width: number;
  date?: 'day' | 'time';
  /** in the export of every field (the list summaries are not: the lists come as sheets there) */
  inFull: boolean;
  stageId?: string;
  value: (a: Row, x: Ctx) => Cell;
}
interface Col {
  header: string;
  width?: number;
  date?: 'day' | 'time';
}

/** One list (qualifications, experience…) in one cell: each entry's answers, entries split by ";". */
function summary(a: Row, kind: CandidateRowKind): Cell {
  const def = CANDIDATE_ROWS[kind];
  const lines = (a.snapshot.rows[kind] ?? [])
    .map((r) =>
      def.columns
        .map((c) => r[c.key])
        .filter((v): v is string => Boolean(v))
        .map(dmy)
        .join(', '),
    )
    .filter(Boolean);
  return lines.join('; ') || null;
}

/** Months between two days (YYYY-MM-DD), the last one counted. */
function months(from: string, to: string) {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

/**
 * The candidates as an Excel workbook (docs/design/34-recruitment.md, parts 9 and 10): the list as
 * filtered (or the ticked ones), with every field, or with the fields the office picks in the order it
 * arranges them (a named layout the school shares, or the user's last choice). "Candidates": one row per
 * application; the lists (qualifications, experience, training, children, references) as sheets of their
 * own, or summed up in one cell each; worked-out columns (age, highest qualification, total experience,
 * total marks); "About this export" says what was taken and when. Aadhaar and PAN in full only for those
 * who may see sensitive details. Every export is in the audit log.
 */
@Injectable()
export class RecruitmentExportService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The stages a column can be about: those on, and those a vacancy uses. */
  private async stagesOf(c: PoolClient) {
    return (
      await c.query<{ id: string; name: string; active: boolean }>(
        `SELECT id::text, name, active FROM recruitment_stages
          WHERE active OR id IN (SELECT unnest(stage_ids) FROM vacancies)
          ORDER BY sort_order, id`,
      )
    ).rows;
  }

  /** Every column, in the order of the full export; grouped as the picker shows them. */
  private catalogue(stages: Array<{ id: string; name: string; active: boolean }>): ColDef[] {
    const col = (
      key: string,
      group: string,
      header: string,
      width: number,
      value: ColDef['value'],
      more: Partial<ColDef> = {},
    ): ColDef => ({ key, group, header, width, value, inFull: true, ...more });
    const answer =
      (fd: (typeof CANDIDATE_FIELDS)[number]) =>
      (a: Row, x: Ctx): Cell => {
        if (fd.sensitive) {
          const enc = a.snapshot_secure?.[fd.key];
          let plain: string | null = null;
          try {
            plain = enc ? decryptField(enc) : null;
          } catch {
            plain = null;
          }
          return plain ? (x.full ? plain : maskValue(plain, fd.type)) : null;
        }
        const raw = a.snapshot.values[fd.key];
        if (raw === null || raw === undefined || raw === '') return null;
        if (fd.type === 'date') return day(String(raw));
        if (fd.type === 'number' && Number.isFinite(Number(raw))) return Number(raw);
        if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
        return String(raw);
      };
    const resultAt = (a: Row, x: Ctx, stageId: string) =>
      a.stage_ids.includes(stageId)
        ? x.results.get(a.id)?.find((r) => r.stage_id === stageId)
        : undefined;
    const scored = (a: Row, x: Ctx) =>
      (x.results.get(a.id) ?? []).filter((r) => r.marks !== null && r.result !== 'skipped');
    return [
      col('app.number', 'application', 'Application no.', 16, (a) => a.number),
      col('app.name', 'application', 'Name', 24, (a) => nameOf(a)),
      col('app.post', 'application', 'Post', 26, (a) => a.vacancy),
      col('app.vacancy', 'application', 'Vacancy', 14, (a) => a.vacancy_code),
      col('app.source', 'application', 'Source', 10, (a) =>
        a.source === 'office' ? 'Walk-in' : 'Online',
      ),
      col('app.applied', 'application', 'Applied on', 17, (a) => ist(a.submitted_at), {
        date: 'time',
      }),
      col('app.status', 'application', 'Status', 18, (a) => STATUS[a.status]),
      col('app.stage', 'application', 'Current stage', 18, (a) => a.stage),
      ...stages.flatMap((s): ColDef[] => {
        const name = `${s.name}${s.active ? '' : ' (off)'}`;
        return [
          col(
            `stage.${s.id}.date`,
            'stages',
            `${name}: date`,
            17,
            (a, x) => {
              const r = resultAt(a, x, s.id);
              return r?.scheduled_at ? ist(r.scheduled_at) : null;
            },
            { date: 'time', stageId: s.id },
          ),
          col(
            `stage.${s.id}.result`,
            'stages',
            `${name}: result`,
            14,
            (a, x) => {
              const r = resultAt(a, x, s.id)?.result;
              return r ? (RESULT[r] ?? r) : null;
            },
            { stageId: s.id },
          ),
          col(
            `stage.${s.id}.marks`,
            'stages',
            `${name}: marks`,
            10,
            (a, x) => {
              const m = resultAt(a, x, s.id)?.marks;
              return m === null || m === undefined ? null : Number(m);
            },
            { stageId: s.id },
          ),
          col(
            `stage.${s.id}.remarks`,
            'stages',
            `${name}: remarks`,
            30,
            (a, x) => resultAt(a, x, s.id)?.remarks ?? null,
            { stageId: s.id },
          ),
        ];
      }),
      col('calc.age', 'worked', 'Age (years)', 10, (a, x) => {
        const dob = String(a.snapshot.values.dob ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
        const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
        const [ty, tm, td] = x.today.split('-').map(Number) as [number, number, number];
        return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
      }),
      col('calc.highest', 'worked', 'Highest qualification', 30, (a) => {
        const r = a.snapshot.rows.education?.[0];
        if (!r?.qualification) return null;
        return [r.qualification, r.passingYear, r.score ? `${r.score}%` : null, r.division]
          .filter(Boolean)
          .join(', ');
      }),
      col('calc.experience', 'worked', 'Total experience (years)', 12, (a, x) => {
        const v = a.snapshot.values;
        const y = Number(v.total_exp_years ?? 0) || 0;
        const m = Number(v.total_exp_months ?? 0) || 0;
        if (y || m) return round1(y + m / 12);
        // not given: worked out from the jobs listed (a job without an end runs to today)
        const jobs = (a.snapshot.rows.experience ?? []).filter((j) =>
          /^\d{4}-\d{2}-\d{2}$/.test(j.fromOn ?? ''),
        );
        if (!jobs.length) return null;
        const total = jobs.reduce(
          (n, j) =>
            n + months(j.fromOn!, /^\d{4}-\d{2}-\d{2}$/.test(j.toOn ?? '') ? j.toOn! : x.today),
          0,
        );
        return round1(total / 12);
      }),
      col('calc.marks', 'worked', 'Total marks', 10, (a, x) => {
        const s = scored(a, x);
        return s.length ? s.reduce((n, r) => n + Number(r.marks), 0) : null;
      }),
      col('calc.marks_max', 'worked', 'Total marks: out of', 10, (a, x) => {
        const s = scored(a, x).filter((r) => r.max_marks !== null);
        return s.length ? s.reduce((n, r) => n + Number(r.max_marks), 0) : null;
      }),
      col('calc.marks_pct', 'worked', 'Total marks %', 10, (a, x) => {
        const s = scored(a, x).filter((r) => r.max_marks !== null && Number(r.max_marks) > 0);
        if (!s.length) return null;
        const got = s.reduce((n, r) => n + Number(r.marks), 0);
        const of = s.reduce((n, r) => n + Number(r.max_marks), 0);
        return round1((got / of) * 100);
      }),
      ...CANDIDATE_FIELDS.map((fd) =>
        col(
          `field.${fd.key}`,
          `section.${fd.section}`,
          fd.label,
          Math.min(40, Math.max(12, fd.label.length + 2)),
          answer(fd),
          fd.type === 'date' ? { date: 'day' } : {},
        ),
      ),
      ...KINDS.map((kind) =>
        col(`list.${kind}`, 'lists', CANDIDATE_ROWS[kind].title, 40, (a) => summary(a, kind), {
          inFull: false,
        }),
      ),
      col(
        'more.interests',
        'papers',
        'Interests',
        30,
        (a) =>
          a.snapshot.activities
            .filter((x) => (CANDIDATE_ACTIVITIES as readonly string[]).includes(x))
            .join(', ') || null,
      ),
      col('more.documents', 'papers', 'Documents given', 40, (a) => {
        const given = CANDIDATE_DOCUMENTS.map((d) => {
          const n = a.snapshot.files.filter((x) => x.kind === d.kind).length;
          return n ? `${d.label}${n > 1 ? ` (${String(n)})` : ''}` : null;
        }).filter(Boolean);
        return given.join(', ') || null;
      }),
      col('decision.note', 'decision', 'Decision note', 30, (a) => a.decision_note),
      col(
        'decision.on',
        'decision',
        'Decided on',
        17,
        (a) => (a.decided_at ? ist(a.decided_at) : null),
        {
          date: 'time',
        },
      ),
      col('decision.correction', 'decision', 'Correction asked', 40, (a) =>
        a.status === 'returned' && a.correction
          ? `${a.correction.partsText}: ${a.correction.remark} (by ${dmy(a.correction.dueOn)})`
          : null,
      ),
      col('decision.match', 'decision', 'Same mobile or email as', 26, (a) =>
        a.employee_match?.length
          ? a.employee_match.map((m) => `${m.name} (${m.code})`).join(', ')
          : null,
      ),
      col('decision.joined', 'decision', 'Joined as (employee code)', 14, (a) => a.employee_code),
    ];
  }

  private groups() {
    return [
      { id: 'application', title: 'Application' },
      { id: 'worked', title: 'Worked out' },
      ...CANDIDATE_SECTIONS.map((s) => ({ id: `section.${s.id}`, title: s.title })),
      { id: 'lists', title: 'Lists in one cell' },
      { id: 'papers', title: 'Interests and documents' },
      { id: 'stages', title: 'Stages' },
      { id: 'decision', title: 'Decision and follow-up' },
    ];
  }

  private canManage(ctx: RequestContext) {
    return ctx.permissions?.has(PEOPLE.recruitmentManage) ?? false;
  }

  /** What the picker shows: the columns by group, the list sheets, the school's layouts, my last choice. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const all = this.catalogue(await this.stagesOf(c));
      const layouts = await c.query<{
        id: string;
        name: string;
        columns: string[];
        sheets: string[];
        created_by: string | null;
        created_by_name: string | null;
        updated_at: Date;
      }>(
        `SELECT id::text, name, columns, sheets, created_by::text, created_by_name, updated_at
           FROM recruitment_export_layouts ORDER BY lower(name)`,
      );
      const last = await c.query<{ value: { columns: string[]; sheets: string[] } }>(
        `SELECT value FROM user_preferences WHERE user_id = $1 AND pref_key = $2`,
        [ctx.user.id, LAST],
      );
      const known = new Set(all.map((x) => x.key));
      const keep = (keys: string[]) => keys.filter((k) => known.has(k));
      const sheets = (s: string[]) => s.filter((k) => (KINDS as string[]).includes(k));
      return {
        groups: this.groups()
          .map((g) => ({
            ...g,
            columns: all
              .filter((x) => x.group === g.id)
              .map((x) => ({ key: x.key, label: x.header })),
          }))
          .filter((g) => g.columns.length),
        sheets: KINDS.map((k) => ({ kind: k, title: CANDIDATE_ROWS[k].title })),
        full: all.filter((x) => x.inFull).map((x) => x.key),
        layouts: layouts.rows.map((l) => ({
          id: l.id,
          name: l.name,
          columns: keep(l.columns),
          sheets: sheets(l.sheets),
          by: l.created_by_name,
          updatedAt: l.updated_at.toISOString(),
          canEdit: l.created_by === ctx.user.id || this.canManage(ctx),
        })),
        last: last.rows[0]
          ? {
              columns: keep(last.rows[0].value.columns ?? []),
              sheets: sheets(last.rows[0].value.sheets ?? []),
            }
          : null,
      };
    });
  }

  /** A named layout saved: a new name makes one; the same name changes it (its maker or the manager). */
  async saveLayout(ctx: RequestContext, dto: ExportLayoutDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const known = new Set(this.catalogue(await this.stagesOf(c)).map((x) => x.key));
      const columns = [...new Set(dto.columns)].filter((k) => known.has(k));
      if (!columns.length)
        throw new DomainError('validation-failed', 'Pick at least one field', { status: 400 });
      const name = dto.name.trim();
      const had = await c.query<{ id: string; created_by: string | null }>(
        `SELECT id::text, created_by::text FROM recruitment_export_layouts WHERE lower(name) = lower($1)`,
        [name],
      );
      const sheets = [...new Set(dto.sheets)];
      if (had.rows[0]) {
        if (had.rows[0].created_by !== ctx.user.id && !this.canManage(ctx))
          throw new DomainError(
            'recruitment.layout_taken',
            'A layout of this name is someone else’s: give yours another name',
            { status: 409 },
          );
        await c.query(
          `UPDATE recruitment_export_layouts SET name = $2, columns = $3, sheets = $4, updated_at = now() WHERE id = $1`,
          [had.rows[0].id, name, columns, sheets],
        );
        return { id: had.rows[0].id, updated: true };
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO recruitment_export_layouts (school_id, name, columns, sheets, created_by, created_by_name)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5) RETURNING id::text`,
        [name, columns, sheets, ctx.user.id, ctx.user.displayName],
      );
      return { id: r.rows[0]!.id, updated: false };
    });
  }

  async deleteLayout(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Layout not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const had = await c.query<{ created_by: string | null }>(
        `SELECT created_by::text FROM recruitment_export_layouts WHERE id = $1`,
        [id],
      );
      if (!had.rows[0]) throw new DomainError('not-found', 'Layout not found', { status: 404 });
      if (had.rows[0].created_by !== ctx.user.id && !this.canManage(ctx))
        throw new DomainError(
          'permission-denied',
          'Only its maker or the recruitment manager may remove it',
          {
            status: 403,
          },
        );
      await c.query(`DELETE FROM recruitment_export_layouts WHERE id = $1`, [id]);
      return { deleted: true };
    });
  }

  async export(ctx: RequestContext, q: ApplicationExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = appFilter(q);
      const apps = (
        await c.query<Row>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments chosen in appFilter; values are bound
          `SELECT x.*, e.employee_code FROM (${APP_COLS} ${f.sql}
             ORDER BY a.submitted_at DESC, a.id DESC LIMIT ${String(LIMIT)}) x
             LEFT JOIN employees e ON e.id = x.employee_id::bigint`,
          f.args,
        )
      ).rows;
      const ids = apps.map((a) => a.id);
      const results = (
        await c.query<StageResult>(
          `SELECT application_id::text, stage_id::text, scheduled_at, marks::text, max_marks::text, result, remarks
             FROM application_stage_results WHERE application_id = ANY($1::bigint[])`,
          [ids],
        )
      ).rows;
      const byApp = new Map<string, StageResult[]>();
      for (const r of results)
        byApp.set(r.application_id, [...(byApp.get(r.application_id) ?? []), r]);
      const full = ctx.permissions?.has(PEOPLE.sensitiveView) ?? false;
      const x: Ctx = { full, results: byApp, today: ist(new Date()).toISOString().slice(0, 10) };
      const all = this.catalogue(await this.stagesOf(c));

      // the fields picked, in the order arranged; or every field (the stages these candidates go through)
      let chosen: ColDef[];
      let sheets: CandidateRowKind[];
      const custom = Boolean(q.columns?.length);
      if (custom) {
        const by = new Map(all.map((d) => [d.key, d]));
        chosen = [...new Set(q.columns)]
          .map((k) => by.get(k))
          .filter((d): d is ColDef => Boolean(d));
        if (!chosen.length)
          throw new DomainError('validation-failed', 'Pick at least one field', { status: 400 });
        sheets = KINDS.filter((k) => q.sheets?.includes(k));
        await c.query(
          `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb)
           ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [ctx.user.id, LAST, JSON.stringify({ columns: chosen.map((d) => d.key), sheets })],
        );
      } else {
        const used = new Set(apps.flatMap((a) => a.stage_ids));
        chosen = all.filter((d) => d.inFull && (!d.stageId || used.has(d.stageId)));
        sheets = KINDS;
      }

      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      wb.created = new Date();
      this.sheet(
        wb,
        'Candidates',
        chosen,
        apps.map((a) => chosen.map((d) => d.value(a, x))),
      );
      // a sheet per list, joined by the application number
      for (const kind of sheets) {
        const def = CANDIDATE_ROWS[kind];
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
          apps.flatMap((a) =>
            (a.snapshot.rows[kind] ?? []).map((r): Cell[] => [
              a.number,
              nameOf(a),
              ...def.columns.map((col) => {
                const v = r[col.key];
                if (!v) return null;
                if (col.type === 'date') return day(v);
                if (col.type === 'year' && /^\d{4}$/.test(v)) return Number(v);
                return v;
              }),
            ]),
          ),
        );
      }

      // what was taken, when, by whom
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
          [
            'Fields',
            custom
              ? `${String(chosen.length)} picked${q.layout ? ` (layout: ${q.layout})` : ''}`
              : 'Every field',
          ],
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
        after: {
          rows: apps.length,
          filters,
          sensitive: full,
          fields: custom ? chosen.map((d) => d.key) : 'all',
          sheets,
        },
      });
      const stamp = x.today;
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
    ws.views = [
      { state: 'frozen', ySplit: 1, xSplit: name === 'Candidates' ? Math.min(2, cols.length) : 0 },
    ];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(1, cols.length) },
    };
    rows.forEach((r) => ws.addRow(r));
    cols.forEach((col, i) => {
      if (col.date)
        ws.getColumn(i + 1).numFmt = col.date === 'day' ? 'dd-mm-yyyy' : 'dd-mm-yyyy hh:mm';
    });
  }
}
