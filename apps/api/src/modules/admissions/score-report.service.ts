import { Injectable } from '@nestjs/common';
import { ADMISSION_STATUS_BY_CODE, type PointLine, type PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { scoreReportPdf } from './admission-pdf';
import { meritOrder } from './merit-order';
import { papersIn } from './part-marks';
import { classPointRules, classPointsMax } from './points-rules';
import type { ScoreReportQueryDto } from './scores.dto';

const LIVE = `a.status::text NOT IN ('draft', 'cancelled', 'withdrawn')`;
const ist = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

/**
 * The score report (docs/design/48, part 4): a row per registration of a session's class with each
 * criterion's points, the form points, the test / interview marks, the total and the rank (the merit
 * order of docs/design/40); and Recalculate (part 3) for registrations not yet confirmed.
 */
@Injectable()
export class AdmissionScoreReportService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The sessions with their classes and how many registrations each has (docs/design/61): the report
   * opens where there are some.
   */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cycles = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC, id DESC`,
      );
      const classes = await c.query<{ cycle_id: string; id: string; name: string; n: number }>(
        `SELECT k.cycle_id::text, cl.id::text, cl.name,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = k.cycle_id AND a.class_id = k.class_id
                    AND a.form_id IS NOT NULL AND a.status::text <> 'draft') AS n
           FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          ORDER BY cl.display_order, cl.name`,
      );
      return {
        cycles: cycles.rows.map((y) => {
          const mine = classes.rows.filter((k) => k.cycle_id === y.id);
          return {
            ...y,
            registrations: mine.reduce((t, k) => t + k.n, 0),
            classes: mine.map((k) => ({ id: k.id, name: k.name, registrations: k.n })),
          };
        }),
      };
    });
  }

  /**
   * The marks columns of a class (docs/design/61): for each Written test / Interview stage of its
   * process (or any stage with a maximum), the paper's subjects or parameters and the stage total;
   * a stage without a paper, one column.
   */
  private async markColumnsOf(c: PoolClient, classId: string, steps: Array<{ stageId: string }>) {
    const st = await c.query<{ id: string; name: string; kind: string; max_marks: string | null }>(
      `SELECT id::text, name, kind, max_marks::text FROM admission_stages WHERE id = ANY($1::bigint[])`,
      [steps.map((x) => x.stageId)],
    );
    const cols: Array<{
      key: string;
      stageId: string;
      stage: string;
      /** the stage's own kind (test, interview…), for the report's views */
      stageKind: string;
      label: string;
      max: number | null;
      kind: 'part' | 'total' | 'stage';
    }> = [];
    for (const step of steps) {
      const x = st.rows.find((y) => y.id === step.stageId);
      if (!x || (!['test', 'interview'].includes(x.kind) && x.max_marks === null)) continue;
      const paper = ['test', 'interview'].includes(x.kind)
        ? ((await papersIn(c, x.id)).get(classId) ?? null)
        : null;
      if (paper) {
        for (const pt of paper.parts)
          cols.push({
            key: `${x.id}:${pt.id}`,
            stageId: x.id,
            stage: x.name,
            stageKind: x.kind,
            label: pt.name,
            max: pt.maxMarks,
            kind: 'part',
          });
        cols.push({
          key: `${x.id}:total`,
          stageId: x.id,
          stage: x.name,
          stageKind: x.kind,
          label: `${x.name} total`,
          max: paper.total,
          kind: 'total',
        });
      } else
        cols.push({
          key: `${x.id}:stage`,
          stageId: x.id,
          stage: x.name,
          stageKind: x.kind,
          label: x.name,
          max: x.max_marks !== null ? Number(x.max_marks) : null,
          kind: 'stage',
        });
    }
    return cols;
  }

  /** Each registration's marks for the columns: by part, the stage totals (AB when absent). */
  private async markCellsOf(
    c: PoolClient,
    ids: string[],
    cols: Awaited<ReturnType<AdmissionScoreReportService['markColumnsOf']>>,
  ) {
    const out = new Map<string, Map<string, number | 'AB'>>();
    const put = (id: string, k: string, v: number | 'AB') => {
      if (!out.has(id)) out.set(id, new Map());
      out.get(id)!.set(k, v);
    };
    if (!ids.length || !cols.length) return out;
    const stages = [...new Set(cols.map((x) => x.stageId))];
    const parts = await c.query<{
      id: string;
      stage_id: string;
      part_id: string;
      marks: string | null;
    }>(
      `SELECT application_id::text AS id, stage_id::text, part_id::text, marks::text FROM admission_part_marks
        WHERE application_id = ANY($1::bigint[]) AND stage_id = ANY($2::bigint[])`,
      [ids, stages],
    );
    for (const x of parts.rows)
      if (x.marks !== null) put(x.id, `${x.stage_id}:${x.part_id}`, Number(x.marks));
    const totals = await c.query<{
      id: string;
      stage_id: string;
      absent: boolean;
      total: string | null;
    }>(
      `SELECT application_id::text AS id, stage_id::text, absent, total::text FROM admission_stage_marks
        WHERE application_id = ANY($1::bigint[]) AND stage_id = ANY($2::bigint[])`,
      [ids, stages],
    );
    for (const x of totals.rows) {
      if (x.absent) {
        put(x.id, `${x.stage_id}:total`, 'AB');
        for (const col of cols)
          if (col.stageId === x.stage_id && col.kind === 'part') put(x.id, col.key, 'AB');
      } else if (x.total !== null) put(x.id, `${x.stage_id}:total`, Number(x.total));
    }
    // a stage without a paper: the latest marks of each level, added (as merit counts them)
    const plain = await c.query<{ id: string; stage_id: string; marks: string; absent: boolean }>(
      `SELECT id, stage_id, sum(marks)::text AS marks, bool_or(attendance = 'absent') AS absent FROM (
         SELECT DISTINCT ON (x.application_id, x.stage_id, x.level) x.application_id::text AS id, x.stage_id::text,
                x.marks, x.attendance
           FROM admission_stage_results x
          WHERE x.application_id = ANY($1::bigint[]) AND x.stage_id = ANY($2::bigint[]) AND x.undone_at IS NULL
            AND (x.marks IS NOT NULL OR x.attendance = 'absent')
          ORDER BY x.application_id, x.stage_id, x.level, x.decided_at DESC) y
        GROUP BY id, stage_id`,
      [ids, cols.filter((x) => x.kind === 'stage').map((x) => x.stageId)],
    );
    for (const x of plain.rows)
      put(x.id, `${x.stage_id}:stage`, x.absent && Number(x.marks) === 0 ? 'AB' : Number(x.marks));
    return out;
  }

  private async reportWith(c: PoolClient, q: ScoreReportQueryDto) {
    const line = await c.query<{
      session: string;
      class_name: string;
      merit_seed: string | null;
    }>(
      `SELECT y.name AS session, cl.name AS class_name, k.merit_seed
         FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id JOIN classes cl ON cl.id = k.class_id
        WHERE k.cycle_id = $1 AND k.class_id = $2 AND y.deleted_at IS NULL`,
      [q.cycleId, q.classId],
    );
    if (!line.rows[0])
      throw new DomainError('not-found', 'The class is not in that session', { status: 404 });
    const rules = await classPointRules(c, q.cycleId, q.classId);
    // a column per level of the class's process (docs/design/50): the decision, remark, who
    const proc = await c.query<{
      steps: Array<{ stageId: string; levels: Array<{ name: string }> }>;
    }>(
      `SELECT p.steps FROM admission_process_classes pc JOIN admission_processes p ON p.id = pc.process_id
        WHERE pc.class_id = $1 AND p.status = 'active' LIMIT 1`,
      [q.classId],
    );
    const stageNames = new Map(
      (
        await c.query<{ id: string; name: string }>(`SELECT id::text, name FROM admission_stages`)
      ).rows.map((x) => [x.id, x.name]),
    );
    const levelCols = (proc.rows[0]?.steps ?? []).flatMap((st) =>
      st.levels.map((l, i) => ({
        key: `${st.stageId}:${String(i + 1)}`,
        label: `${stageNames.get(st.stageId) ?? 'Stage'} · ${l.name}`,
      })),
    );
    const markCols = await this.markColumnsOf(c, q.classId, proc.rows[0]?.steps ?? []);
    const max = await classPointsMax(c, q.cycleId, q.classId);
    const r = await c.query<{
      id: string;
      number: string | null;
      candidate: string | null;
      category: string | null;
      status: string;
      dob: Date | null;
      form_points: string | null;
      merit: string | null;
      lines: PointLine[] | null;
      confirmed: boolean;
      steps: Array<{ stageId: string }> | null;
      stage_no: number;
    }>(
      `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, k.name AS category, a.status::text,
              a.child_dob AS dob, a.form_points::text, a.merit::text, a.points_breakdown AS lines,
              a.points_confirmed_at IS NOT NULL AS confirmed, a.process_steps AS steps, a.stage_no
         FROM applications a LEFT JOIN admission_fee_categories k ON k.id = a.category_id
        WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.form_id IS NOT NULL AND a.status::text <> 'draft'
          AND ($3::bigint IS NULL OR a.category_id = $3) AND ($4::text IS NULL OR a.status::text = $4)
        ORDER BY a.id`,
      [q.cycleId, q.classId, q.categoryId ?? null, q.status ?? null],
    );
    const decided = await c.query<{
      id: string;
      k: string;
      decision: string;
      remarks: string | null;
      by: string | null;
      at: Date;
    }>(
      `SELECT DISTINCT ON (x.application_id, x.stage_id, x.level) x.application_id::text AS id,
              x.stage_id::text || ':' || x.level AS k, x.decision, x.remarks, x.decided_by_name AS by, x.decided_at AS at
         FROM admission_stage_results x
        WHERE x.application_id = ANY($1::bigint[]) AND x.undone_at IS NULL
        ORDER BY x.application_id, x.stage_id, x.level, x.decided_at DESC`,
      [r.rows.map((x) => x.id)],
    );
    const cells = await this.markCellsOf(
      c,
      r.rows.map((x) => x.id),
      markCols,
    );
    const remarkOf = (id: string, k: string) => {
      const d = decided.rows.find((x) => x.id === id && x.k === k);
      return d
        ? `${d.decision}${d.remarks ? `: ${d.remarks}` : ''} (${d.by ?? '-'}, ${d.at.toISOString().slice(8, 10)}-${d.at.toISOString().slice(5, 7)})`
        : null;
    };
    const rows = r.rows.map((x) => {
      const lines = x.lines ?? [];
      const points = x.form_points !== null ? Number(x.form_points) : null;
      const merit = x.merit !== null ? Number(x.merit) : null;
      return {
        id: x.id,
        number: x.number,
        candidate: x.candidate,
        category: x.category,
        status: ADMISSION_STATUS_BY_CODE[x.status] ?? x.status,
        live: !['cancelled', 'withdrawn', 'rejected'].includes(x.status),
        dob: x.dob ? x.dob.toISOString().slice(0, 10) : null,
        lines: rules.map((k) => {
          const l = lines.find((y) => y.name === k.name);
          return l ? { points: l.points, max: l.max, check: l.check ?? null } : null;
        }),
        points,
        marks: merit !== null ? Math.round((merit - (points ?? 0)) * 100) / 100 : null,
        cells: markCols.map((col) => cells.get(x.id)?.get(col.key) ?? null),
        merit,
        confirmed: x.confirmed,
        check: lines.some((l) => Boolean(l.check)),
        remarks: levelCols.map((col) => remarkOf(x.id, col.key)),
        // where the registration is in its process, for a stage's view
        steps: (x.steps ?? []).map((y) => y.stageId),
        stageNo: x.stage_no,
        cancelled: ['cancelled', 'withdrawn'].includes(x.status),
      };
    });
    // the rank among the live ones, as Selection orders them
    const ranked = meritOrder(
      rows.filter((x) => x.live).map((x) => ({ ...x, number: x.number })),
      line.rows[0].merit_seed,
    );
    const rank = new Map(ranked.order.map((x) => [x.id, x.rank]));
    const all = rows
      .map((x) => ({ ...x, rank: rank.get(x.id) ?? null }))
      .filter((x) => !q.check || x.check)
      // a name or registration no.: the rank stays the class's (docs/design/61)
      .filter((x) => {
        const t = (q.q ?? '').trim().toLowerCase();
        return (
          !t ||
          (x.candidate ?? '').toLowerCase().includes(t) ||
          (x.number ?? '').toLowerCase().includes(t)
        );
      })
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || Number(a.id) - Number(b.id));
    // the report's views (docs/design/62): the merit list, and each stage with marks
    const views = [
      { id: 'merit', name: 'Merit list', kind: 'merit' },
      ...[
        ...new Map(markCols.map((x) => [x.stageId, { name: x.stage, kind: x.stageKind }] as const)),
      ].map(([id, x]) => ({ id, ...x })),
    ];
    const view = views.find((x) => x.id === (q.view ?? 'merit'));
    if (!view)
      throw new DomainError('not-found', 'That stage has no marks in this class', { status: 404 });
    const base = {
      session: line.rows[0].session,
      className: line.rows[0].class_name,
      max,
      views,
      view,
    };
    if (view.id === 'merit')
      return {
        ...base,
        levels: levelCols.map((x) => x.label),
        marks: markCols.map(({ stage, label, max, kind }) => ({ stage, label, max, kind })),
        criteria: rules.map((k) => ({
          name: k.name,
          kind: k.kind,
          cap: k.cap,
          points: k.points,
        })),
        rows: all.map(({ steps: _s, stageNo: _n, cancelled: _c, ...x }) => ({
          ...x,
          total: x.merit,
          percent: null as number | null,
        })),
      };
    // a stage's result: its parts and total, the % and the rank by its total (equal totals share it)
    const at = markCols.flatMap((col, i) => (col.stageId === view.id ? [i] : []));
    const totalAt = at.find((i) => markCols[i]!.kind !== 'part')!;
    const outOf = markCols[totalAt]!.max;
    const levelAt = levelCols.flatMap((col, i) => (col.key.startsWith(`${view.id}:`) ? [i] : []));
    const sat = all
      .filter((x) => {
        const idx = x.steps.indexOf(view.id);
        return (idx >= 0 && x.stageNo >= idx) || at.some((i) => x.cells[i] !== null);
      })
      .map((x) => {
        const total = x.cells[totalAt] ?? null;
        return {
          ...x,
          total: typeof total === 'number' ? total : null,
          absent: total === 'AB',
          percent:
            typeof total === 'number' && outOf ? Math.round((total / outOf) * 10000) / 100 : null,
        };
      });
    const scores = sat
      .filter((x) => !x.cancelled && x.total !== null)
      .map((x) => x.total!)
      .sort((a, b) => b - a);
    return {
      ...base,
      levels: levelAt.map((i) => levelCols[i]!.label),
      marks: at.map((i) => {
        const { stage, label, max, kind } = markCols[i]!;
        return { stage, label, max, kind };
      }),
      criteria: [] as Array<{
        name: string;
        kind: 'fixed' | 'table' | 'sibling';
        cap: number | null;
        points: number;
      }>,
      rows: sat
        .map(({ steps: _s, stageNo: _n, cancelled, ...x }) => ({
          ...x,
          cells: at.map((i) => x.cells[i] ?? null),
          remarks: levelAt.map((i) => x.remarks[i] ?? null),
          rank: !cancelled && x.total !== null ? scores.indexOf(x.total) + 1 : null,
        }))
        .sort(
          (a, b) =>
            (a.rank ?? 1e9) - (b.rank ?? 1e9) ||
            (a.number ?? '').localeCompare(b.number ?? '') ||
            Number(a.id) - Number(b.id),
        ),
    };
  }

  async report(ctx: RequestContext, q: ScoreReportQueryDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.reportWith(c, q));
  }

  async xlsx(ctx: RequestContext, q: ScoreReportQueryDto) {
    const rep = await this.report(ctx, q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Score report');
    ws.addRow([
      `${rep.view.id === 'merit' ? 'Score report' : `${rep.view.name} result`}: ${rep.className} · ${rep.session}`,
    ]).font = { bold: true };
    ws.addRow([`${String(rep.rows.length)} registrations · printed ${ist(new Date())}`]);
    ws.addRow([]);
    const merit = rep.view.id === 'merit';
    const head = merit
      ? [
          'Rank',
          'Registration no.',
          'Candidate',
          'Category',
          'Status',
          ...rep.criteria.map((k) => k.name),
          'Form points',
          ...rep.marks.map((m) =>
            m.kind === 'part'
              ? `${m.stage} · ${m.label}${m.max !== null ? ` (${String(m.max)})` : ''}`
              : `${m.label}${m.max !== null ? ` (${String(m.max)})` : ''}`,
          ),
          'Total',
          'To check',
          ...rep.levels,
        ]
      : [
          'Rank',
          'Registration no.',
          'Candidate',
          'Category',
          'Status',
          ...rep.marks.map((m) => `${m.label}${m.max !== null ? ` (${String(m.max)})` : ''}`),
          '%',
          ...rep.levels,
        ];
    const h = ws.addRow(head);
    h.font = { bold: true };
    head.forEach((_, i) => (ws.getColumn(i + 1).width = i === 2 ? 26 : i === 1 ? 22 : 14));
    for (const x of rep.rows)
      ws.addRow(
        merit
          ? [
              x.rank ?? '',
              x.number ?? '',
              x.candidate ?? '',
              x.category ?? '',
              x.status,
              ...x.lines.map((l) => (l ? l.points : '')),
              x.points ?? '',
              ...x.cells.map((v) => v ?? ''),
              x.merit ?? '',
              x.lines
                .map((l) => l?.check)
                .filter(Boolean)
                .join('; '),
              ...x.remarks.map((m) => m ?? ''),
            ]
          : [
              x.rank ?? '',
              x.number ?? '',
              x.candidate ?? '',
              x.category ?? '',
              x.status,
              ...x.cells.map((v) => v ?? ''),
              x.percent ?? '',
              ...x.remarks.map((m) => m ?? ''),
            ],
      );
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      bytes,
      filename: `score-report-${rep.className}${rep.view.id === 'merit' ? '' : `-${rep.view.name}`}`
        .replace(/[^A-Za-z0-9]+/g, '-')
        .concat('.xlsx'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  async pdf(ctx: RequestContext, q: ScoreReportQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rep = await this.reportWith(c, q);
      const school = await c.query<{
        name: string;
        address: string | null;
        contact: string | null;
        logo: string | null;
      }>(
        `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
                NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
           FROM schools WHERE id = app.current_school_id()`,
      );
      const sc = school.rows[0]!;
      const n = (v: number | null) => (v === null ? '-' : String(v));
      const bytes = await scoreReportPdf({
        school: {
          name: sc.name,
          address: sc.address,
          contact: sc.contact ? `Phone ${sc.contact}` : null,
        },
        logo: await this.core.fileBytes(c, sc.logo),
        mode: rep.view.id === 'merit' ? 'merit' : 'stage',
        title: `${rep.view.id === 'merit' ? 'Score report' : `${rep.view.name} result`}: ${rep.className}`,
        subtitle: `${rep.session} · ${String(rep.rows.length)} registrations${rep.max ? ` · points out of ${String(rep.max)}` : ''}`,
        criteria: rep.criteria.map((k) => k.name),
        // the PDF's narrow columns: a part by its name, a stage's total by the stage
        marks: rep.marks.map((m) =>
          m.kind === 'part'
            ? `${m.label}${m.max !== null ? ` (${String(m.max)})` : ''}`
            : `${m.stage}${m.max !== null ? ` (${String(m.max)})` : ''}`,
        ),
        rows: rep.rows.map((x) => ({
          rank: x.rank !== null ? String(x.rank) : '-',
          number: x.number ?? '',
          candidate: x.candidate ?? '',
          lines: x.lines.map((l) => (l ? String(l.points) : '-')),
          points: n(x.points),
          marks: x.cells.map((v) => (v === null ? '-' : String(v))),
          // a stage's result: its % in the last column
          total: rep.view.id === 'merit' ? n(x.merit) : n(x.percent),
          check: x.check,
          note: rep.levels
            .map((l, i) => (x.remarks[i] ? `${l}: ${x.remarks[i]!}` : null))
            .filter(Boolean)
            .join('  |  '),
        })),
        printedAt: ist(new Date()),
      });
      return {
        bytes,
        filename:
          `score-report-${rep.className}${rep.view.id === 'merit' ? '' : `-${rep.view.name}`}`
            .replace(/[^A-Za-z0-9]+/g, '-')
            .concat('.pdf'),
        contentType: 'application/pdf',
      };
    });
  }

  /**
   * Recalculate (docs/design/48, part 3): the points of a session's registrations (one class, or
   * every class) worked out again from the answers and today's tables; those the office confirmed at
   * Document check stay. Says how many were looked at and how many changed.
   */
  async recalculate(ctx: RequestContext, cycleId: string, classId?: string) {
    if (!/^\d{1,18}$/.test(cycleId))
      throw new DomainError('not-found', 'Admission session not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; before: string | null }>(
        // eslint-disable-next-line no-restricted-syntax -- LIVE is a fixed fragment
        `SELECT a.id::text, a.form_points::text AS before FROM applications a
          WHERE a.cycle_id = $1 AND ($2::bigint IS NULL OR a.class_id = $2) AND a.form_id IS NOT NULL
            AND ${LIVE} AND a.status::text <> 'admitted' AND a.points_confirmed_at IS NULL ORDER BY a.id`,
        [cycleId, classId ?? null],
      );
      let changed = 0;
      for (const a of r.rows) {
        await this.core.refreshPoints(c, a.id);
        const after = await c.query<{ p: string | null }>(
          `SELECT form_points::text AS p FROM applications WHERE id = $1`,
          [a.id],
        );
        if (Number(after.rows[0]?.p ?? 0) !== Number(a.before ?? 0)) changed += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.points.recalculate',
        entityType: 'admission_cycles',
        entityId: cycleId,
        after: { classId: classId ?? null, recalculated: r.rows.length, changed },
      });
      return { recalculated: r.rows.length, changed };
    });
  }
}
