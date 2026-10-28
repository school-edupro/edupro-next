import { Injectable } from '@nestjs/common';
import { admissionWaitingFor, type PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { csvRecords } from '../people/csv';
import { AdmissionCoreService } from './admission-core.service';
import { tablePdf } from './admission-pdf';
import { AdmissionPapersService } from './papers.service';
import { storeMarks, type Paper } from './part-marks';
import { messageTag } from './message-tag';
import { place, refreshMerit } from './process-engine';
import { AdmissionProcessService } from './process.service';
import type { ResultsQueryDto, ResultsReleaseDto, ResultsSaveDto } from './results.dto';

/** The sheet's own key cell: which session, class and stage it was made for. */
const KEY = /^EPMARK:(\d{1,18}):(\d{1,18}):(\d{1,18})$/;
const HEAD_ROW = 5;
const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Where a candidate stands at the stage. */
type State = 'waiting' | 'held' | 'selected' | 'rejected' | 'sent_back' | 'other';
const STATE_WORDS: Record<State, string> = {
  waiting: 'Waiting',
  held: 'Held',
  selected: 'Selected',
  rejected: 'Not selected',
  sent_back: 'Sent back',
  other: 'Past this stage',
};
interface Place {
  cycleId: string;
  classId: string;
  stageId: string;
}
export interface ResultRow {
  id: string;
  number: string | null;
  candidate: string | null;
  category: string | null;
  rollNo: number | null;
  slotId: string | null;
  slot: string | null;
  state: State;
  /** the level it waits at */
  level: string | null;
  /** marks by part id (null: none) */
  marks: Record<string, number | null>;
  absent: boolean;
  total: number | null;
  maxTotal: number | null;
  percent: number | null;
  below: boolean;
  remark: string | null;
  decision: { decision: string; by: string | null; at: string } | null;
  /** the decision at this stage in the page's words (none while waiting) */
  current: Choice | null;
  /** a later stage that has decided: a decision here can no longer change */
  laterStage: string | null;
  /** any marks (or absent) entered */
  marked: boolean;
}
/** A decision as the grid and the sheet offer it (docs/design/58). */
type Choice = 'select' | 'hold' | 'reject';
const CHOICE_WORDS: Record<Choice, string> = {
  select: 'Selected',
  hold: 'Held',
  reject: 'Not selected',
};
interface Input {
  /** undefined: not changed; null: none */
  marks: Record<string, number | null | undefined>;
  absent?: boolean;
  remark?: string | null;
  decision?: Choice | null;
  reason?: string;
}
type Prepared =
  | { error: string }
  | {
      error?: undefined;
      next: Record<string, number | null>;
      absent: boolean;
      remark: string | null;
      total: number | null;
      changedMarks: boolean;
      changed: boolean;
      decision: 'approve' | 'hold' | 'reject' | null;
      /** a decided candidate's decision changes: the stage's decision is undone first */
      undo: boolean;
      /** what changes, in words (the sheet's check) */
      words: string;
    };

/**
 * Test and interview results by part (docs/design/57, part 2), the DPS "Result Report": for a session,
 * class and Test / Interview stage, each candidate who reached the stage with a mark per part of the
 * class's paper, absent, total, %, below cut-off and where they stand; entered on the screen or by the
 * class's sheet (all parts together; a Decision column takes Select or Hold, decided at the level the
 * candidate waits at); exported as Excel or PDF. A decided candidate's marks change only with a reason,
 * and the decision's marks (and merit) follow.
 */
@Injectable()
export class AdmissionResultsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly core: AdmissionCoreService,
    private readonly papers: AdmissionPapersService,
    private readonly process: AdmissionProcessService,
  ) {}

  /** The sessions with their classes, and the Test and Interview stages, for the page's choices. */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cycles = await c.query<{ id: string; name: string; status: string }>(
        `SELECT id::text, name, status::text FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC, id DESC`,
      );
      const classes = await c.query<{ cycle_id: string; id: string; name: string }>(
        `SELECT k.cycle_id::text, cl.id::text, cl.name FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          ORDER BY cl.display_order, cl.name`,
      );
      const stages = await c.query<{ id: string; name: string; kind: string }>(
        `SELECT id::text, name, kind FROM admission_stages WHERE kind IN ('test', 'interview') AND status = 'active'
          ORDER BY sort_order, id`,
      );
      return {
        cycles: cycles.rows.map((y) => ({
          ...y,
          classes: classes.rows
            .filter((k) => k.cycle_id === y.id)
            .map((k) => ({ id: k.id, name: k.name })),
        })),
        stages: stages.rows,
      };
    });
  }

  private async placeOf(c: PoolClient, p: Place) {
    const r = await c.query<{ cycle: string; class_name: string; stage: string; kind: string }>(
      `SELECT y.name AS cycle, cl.name AS class_name, st.name AS stage, st.kind
         FROM admission_cycles y JOIN admission_class_criteria k ON k.cycle_id = y.id AND k.class_id = $2
         JOIN classes cl ON cl.id = k.class_id CROSS JOIN admission_stages st
        WHERE y.id = $1 AND y.deleted_at IS NULL AND st.id = $3`,
      [p.cycleId, p.classId, p.stageId],
    );
    const x = r.rows[0];
    if (!x)
      throw new DomainError('not-found', 'That class is not in this session', { status: 404 });
    if (x.kind !== 'test' && x.kind !== 'interview')
      throw new DomainError('validation-failed', `${x.stage} takes no marks`, { status: 400 });
    const paper = (await this.papers.papersIn(c, p.stageId)).get(p.classId) ?? null;
    return {
      cycle: x.cycle,
      className: x.class_name,
      stage: x.stage,
      kind: x.kind as 'test' | 'interview',
      paper,
    };
  }

  private needPaper(at: Awaited<ReturnType<AdmissionResultsService['placeOf']>>): Paper {
    if (!at.paper)
      throw new DomainError(
        'admissions.no_paper',
        `${at.className} has no paper for ${at.stage}: set its ${at.kind === 'test' ? 'subjects' : 'parameters'} in Admission set-up → Test and interview papers`,
        { status: 409 },
      );
    return at.paper;
  }

  /** Every candidate of the class who reached the stage, with their marks and where they stand. */
  private async rowsIn(c: PoolClient, p: Place, paper: Paper): Promise<ResultRow[]> {
    const r = await c.query<{
      id: string;
      number: string | null;
      candidate: string | null;
      status: string;
      stage_no: number;
      idx: number;
      level_name: string | null;
      category: string | null;
      roll_no: number | null;
      slot_id: string | null;
      starts_at: Date | null;
      venue: string | null;
      absent: boolean | null;
      total: string | null;
      max_total: string | null;
      remark: string | null;
      later_stage: string | null;
    }>(
      `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, a.status::text, a.stage_no,
              (e.ord - 1)::int AS idx, a.process_steps -> a.stage_no -> 'levels' -> (a.level_no - 1) ->> 'name' AS level_name,
              k.name AS category, al.roll_no, al.slot_id::text, sl.starts_at, sl.venue,
              m.absent, m.total::text, m.max_total::text, m.remark,
              (SELECT st2.name FROM admission_stage_results x JOIN admission_stages st2 ON st2.id = x.stage_id
                WHERE x.application_id = a.id AND x.undone_at IS NULL
                  AND x.stage_id::text IN (SELECT y.step ->> 'stageId' FROM jsonb_array_elements(a.process_steps)
                                             WITH ORDINALITY y(step, ord) WHERE y.ord > e.ord)
                ORDER BY x.decided_at DESC LIMIT 1) AS later_stage
         FROM applications a
         CROSS JOIN LATERAL (SELECT x.ord FROM jsonb_array_elements(a.process_steps) WITH ORDINALITY x(step, ord)
                              WHERE x.step ->> 'stageId' = $3 LIMIT 1) e
         LEFT JOIN admission_fee_categories k ON k.id = a.category_id
         LEFT JOIN admission_slot_allotments al ON al.application_id = a.id AND al.stage_id = $4
         LEFT JOIN admission_slots sl ON sl.id = al.slot_id
         LEFT JOIN admission_stage_marks m ON m.application_id = a.id AND m.stage_id = $4
        WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.application_no IS NOT NULL AND a.process_steps IS NOT NULL
          AND a.status::text NOT IN ('draft', 'cancelled') AND a.stage_no >= e.ord - 1
        ORDER BY al.roll_no NULLS LAST, a.application_no`,
      [p.cycleId, p.classId, p.stageId, p.stageId],
    );
    const ids = r.rows.map((x) => x.id);
    const last = new Map<string, { decision: string; by: string | null; at: Date }>();
    const marks = new Map<string, Record<string, number | null>>();
    if (ids.length) {
      const d = await c.query<{ id: string; decision: string; by: string | null; at: Date }>(
        `SELECT DISTINCT ON (x.application_id) x.application_id::text AS id, x.decision, x.decided_by_name AS by,
                x.decided_at AS at
           FROM admission_stage_results x
          WHERE x.stage_id = $1 AND x.application_id = ANY($2::bigint[]) AND x.undone_at IS NULL
          ORDER BY x.application_id, x.decided_at DESC, x.id DESC`,
        [p.stageId, ids],
      );
      for (const x of d.rows) last.set(x.id, x);
      const m = await c.query<{ id: string; part_id: string; marks: string | null }>(
        `SELECT application_id::text AS id, part_id::text, marks::text FROM admission_part_marks
          WHERE stage_id = $1 AND application_id = ANY($2::bigint[])`,
        [p.stageId, ids],
      );
      for (const x of m.rows) {
        const o = marks.get(x.id) ?? {};
        o[x.part_id] = x.marks !== null ? Number(x.marks) : null;
        marks.set(x.id, o);
      }
    }
    const slotWords = (at: Date | null, venue: string | null) =>
      at
        ? `${new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(at)}${venue ? ` · ${venue}` : ''}`
        : null;
    return r.rows.map((x) => {
      const d = last.get(x.id);
      const state: State =
        x.stage_no > x.idx
          ? 'selected'
          : x.status === 'rejected'
            ? 'rejected'
            : x.status === 'sent_back'
              ? 'sent_back'
              : x.status === 'registered' || x.status === 'under_review'
                ? d?.decision === 'hold'
                  ? 'held'
                  : 'waiting'
                : 'other';
      const own = marks.get(x.id) ?? {};
      const byPart: Record<string, number | null> = {};
      for (const pt of paper.parts) byPart[pt.id] = own[pt.id] ?? null;
      const absent = Boolean(x.absent);
      const total = x.total !== null ? Number(x.total) : null;
      const maxTotal = x.max_total !== null ? Number(x.max_total) : paper.total;
      const percent =
        total !== null && maxTotal && maxTotal > 0 ? round2((total / maxTotal) * 100) : null;
      const below =
        !absent &&
        total !== null &&
        (paper.parts.some(
          (pt) => pt.passMarks !== null && byPart[pt.id] != null && byPart[pt.id]! < pt.passMarks,
        ) ||
          (paper.minPercent !== null && percent !== null && percent < paper.minPercent));
      return {
        id: x.id,
        number: x.number,
        candidate: x.candidate,
        category: x.category,
        rollNo: x.roll_no,
        slotId: x.slot_id,
        slot: slotWords(x.starts_at, x.venue),
        state,
        level: state === 'waiting' || state === 'held' ? x.level_name : null,
        marks: byPart,
        absent,
        total,
        maxTotal,
        percent,
        below,
        remark: x.remark,
        decision: d ? { decision: d.decision, by: d.by, at: d.at.toISOString() } : null,
        current:
          state === 'selected'
            ? 'select'
            : state === 'rejected'
              ? 'reject'
              : state === 'held'
                ? 'hold'
                : null,
        laterStage: x.later_stage,
        marked: absent || Object.values(byPart).some((v) => v !== null),
      };
    });
  }

  private filter(rows: ResultRow[], q: ResultsQueryDto) {
    const text = (q.q ?? '').trim().toLowerCase();
    const band = q.band ? q.band.split('-').map(Number) : null;
    return rows.filter((r) => {
      if (q.slotId && r.slotId !== q.slotId) return false;
      if (
        text &&
        !(r.number ?? '').toLowerCase().includes(text) &&
        !(r.candidate ?? '').toLowerCase().includes(text)
      )
        return false;
      if (band) {
        const [lo, hi] = band as [number, number];
        if (r.percent === null || r.percent > hi || (lo > 0 ? r.percent <= lo - 1 : r.percent < 0))
          return false;
      }
      if (q.cutoff === 'below' && !r.below) return false;
      if (q.cutoff === 'ok' && (!r.marked || r.absent || r.below)) return false;
      if (q.state === 'waiting' && r.state !== 'waiting' && r.state !== 'held') return false;
      if (q.state === 'decided' && r.state !== 'selected' && r.state !== 'rejected') return false;
      if (q.state === 'unmarked' && r.marked) return false;
      return true;
    });
  }

  /** The results grid of a session, class and stage, as filtered. */
  async list(ctx: RequestContext, q: ResultsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.placeOf(c, q);
      const all = at.paper ? await this.rowsIn(c, q, at.paper) : [];
      const slots = await c.query<{ id: string; starts_at: Date; venue: string }>(
        `SELECT id::text, starts_at, venue FROM admission_slots
          WHERE cycle_id = $1 AND stage_id = $2 AND (class_id IS NULL OR class_id = $3) ORDER BY starts_at`,
        [q.cycleId, q.stageId, q.classId],
      );
      return {
        place: at,
        release: await this.releaseOf(c, q),
        slots: slots.rows.map((s) => ({
          id: s.id,
          label: `${new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(s.starts_at)} · ${s.venue}`,
        })),
        counts: {
          all: all.length,
          waiting: all.filter((r) => r.state === 'waiting' || r.state === 'held').length,
          marked: all.filter((r) => r.marked).length,
          below: all.filter((r) => r.below).length,
        },
        rows: this.filter(all, q),
      };
    });
  }

  /** A row's input checked against the paper and where the candidate stands; nothing written. */
  private prepare(row: ResultRow, input: Input, paper: Paper, fromSheet: boolean): Prepared {
    if (input.decision && !['select', 'hold', 'reject'].includes(input.decision))
      return { error: 'Decision must be Select, Hold or Not selected' };
    for (const k of Object.keys(input.marks))
      if (!paper.parts.some((pt) => pt.id === k)) return { error: 'A part not on the paper' };
    const next: Record<string, number | null> = {};
    let given = false;
    for (const pt of paper.parts) {
      const v = input.marks[pt.id];
      if (v !== undefined && v !== null) {
        if (!Number.isFinite(v) || v < 0 || v > pt.maxMarks)
          return { error: `${pt.name}: marks from 0 to ${String(pt.maxMarks)}` };
        given = true;
      }
      next[pt.id] = v === undefined ? (row.marks[pt.id] ?? null) : v;
    }
    const absent = input.absent ?? row.absent;
    if (absent && given) return { error: 'Absent and marks both given: clear one' };
    if (absent) for (const k of Object.keys(next)) next[k] = null;
    const remark =
      input.remark === undefined ? row.remark : input.remark ? input.remark.trim() : null;
    const entered = Object.values(next).filter((v): v is number => v !== null);
    const total = absent || !entered.length ? null : round2(entered.reduce((n, v) => n + v, 0));
    const changedMarks =
      absent !== row.absent || paper.parts.some((pt) => next[pt.id] !== row.marks[pt.id]);
    const changed = changedMarks || remark !== row.remark;
    // a decision the same as the present one changes nothing (docs/design/58)
    const want = input.decision && input.decision !== row.current ? input.decision : null;
    const decided = row.state === 'selected' || row.state === 'rejected';
    const reason = input.reason?.trim() ?? '';
    const need = fromSheet ? 'write the Reason for change' : 'give the reason';
    if (want && row.state === 'sent_back')
      return { error: 'Sent back to the family: decide when it is back' };
    if ((want || changed) && row.state === 'other')
      return { error: 'Past this stage: nothing changed here' };
    if (want && decided && row.laterStage)
      return { error: `Decided at ${row.laterStage} since: undo it there first` };
    if (want && decided && reason.length < 3)
      return {
        error: `Already ${CHOICE_WORDS[row.current!].toLowerCase()}: ${need} for the new decision`,
      };
    if (changedMarks && decided && reason.length < 3)
      return {
        error: `Already ${CHOICE_WORDS[row.current!].toLowerCase()}: ${need} for changing the marks`,
      };
    if (want === 'select' && absent)
      return { error: 'Absent: Hold the candidate, or clear Absent' };
    if (want === 'select' && total === null) return { error: 'Enter the marks before Select' };
    const words = [
      want
        ? row.current
          ? `Decision ${CHOICE_WORDS[row.current]} → ${CHOICE_WORDS[want]}`
          : CHOICE_WORDS[want]
        : null,
      changedMarks ? (absent ? 'Absent' : 'Marks changed') : null,
      !changedMarks && remark !== row.remark ? 'Remark changed' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      next,
      absent,
      remark,
      total,
      changedMarks,
      changed,
      decision: want === 'select' ? 'approve' : want,
      undo: Boolean(want && decided),
      words: words || 'No change',
    };
  }

  /** A prepared row written: marks by part, the stage's total, a correction, a decision. */
  private async write(
    c: PoolClient,
    ctx: RequestContext,
    p: Place,
    stageName: string,
    paper: Paper,
    row: ResultRow,
    prep: Exclude<Prepared, { error: string }>,
    input: Input,
    waitingForMe: Set<string>,
  ) {
    if (prep.changed)
      await storeMarks(
        c,
        ctx.user.id,
        row.id,
        p.stageId,
        paper,
        prep.next,
        prep.absent,
        prep.remark,
      );
    const decided = row.state === 'selected' || row.state === 'rejected';
    let waitLevel = row.level;
    // a held or decided candidate's marks: the stage's live decisions carry the new total (merit follows)
    if (prep.changedMarks && row.decision) {
      // the decision's marks follow (the levels that recorded them, else the latest), and so the merit
      const fixed = await c.query(
        `UPDATE admission_stage_results SET marks = $3, max_marks = $4, attendance = CASE WHEN $5 THEN 'absent' ELSE attendance END
          WHERE application_id = $1 AND stage_id = $2 AND undone_at IS NULL AND (marks IS NOT NULL OR attendance = 'absent')`,
        [row.id, p.stageId, prep.total, paper.total, prep.absent],
      );
      if (!fixed.rowCount)
        await c.query(
          `UPDATE admission_stage_results SET marks = $3, max_marks = $4
            WHERE id = (SELECT id FROM admission_stage_results WHERE application_id = $1 AND stage_id = $2 AND undone_at IS NULL
                         ORDER BY decided_at DESC, id DESC LIMIT 1)`,
          [row.id, p.stageId, prep.total, paper.total],
        );
      await refreshMerit(c, row.id);
      if (decided) {
        const a = await this.core.row(c, row.id);
        await this.core.event(
          c,
          row.id,
          a.status,
          a.status,
          `${stageName}: marks corrected to ${prep.absent ? 'absent' : `${String(prep.total ?? '-')}/${String(paper.total)}`} · ${input.reason ?? ''}`,
          { actorUser: ctx.user.id },
        );
      }
    }
    if (prep.undo) {
      // the stage's last decision undone with the reason; the candidate waits at that level again
      const a = await this.core.row(c, row.id);
      await c.query(
        `UPDATE admission_stage_results SET undone_at = now(), undone_by = $2, undo_reason = $3
          WHERE id = (SELECT id FROM admission_stage_results WHERE application_id = $1 AND stage_id = $4
                        AND undone_at IS NULL ORDER BY decided_at DESC, id DESC LIMIT 1)`,
        [row.id, ctx.user.id, input.reason, p.stageId],
      );
      await c.query(
        `UPDATE applications SET status = 'under_review', decided_at = NULL, decided_by = NULL, updated_at = now() WHERE id = $1`,
        [row.id],
      );
      await place(c, row.id);
      await this.core.event(
        c,
        row.id,
        a.status,
        'under_review',
        `${stageName}: ${CHOICE_WORDS[row.current!]} undone · ${input.reason ?? ''}`,
        { actorUser: ctx.user.id },
      );
      const lv = await c.query<{ name: string | null }>(
        `SELECT process_steps -> stage_no -> 'levels' -> (level_no - 1) ->> 'name' AS name FROM applications WHERE id = $1`,
        [row.id],
      );
      waitLevel = lv.rows[0]?.name ?? row.level;
    }
    if (prep.decision) {
      // an admin deciding at a level they are not named in: the remark says so (docs/design/55)
      const behalf = waitingForMe.has(row.id)
        ? ''
        : ` (by ${ctx.user.displayName} for ${waitLevel ?? 'the level'})`;
      await this.process.decideWith(c, ctx, row.id, {
        decision: prep.decision,
        marks: prep.absent ? null : prep.total,
        attendance: prep.absent ? 'absent' : 'present',
        remarks: `${(prep.undo ? input.reason : prep.remark) ?? 'Test results'}${behalf}`.slice(
          0,
          1000,
        ),
      });
    }
  }

  /** Rows saved from the screen (all parts together), each on its own: one row's error stops only it. */
  async save(ctx: RequestContext, dto: ResultsSaveDto) {
    const errors: Array<{ applicationId: string; error: string }> = [];
    let saved = 0;
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.placeOf(c, dto);
      const paper = this.needPaper(at);
      const rows = new Map((await this.rowsIn(c, dto, paper)).map((r) => [r.id, r]));
      const mine = await admissionWaitingFor(c, ctx.user.id);
      for (const x of dto.rows) {
        const row = rows.get(x.applicationId);
        if (!row) {
          errors.push({ applicationId: x.applicationId, error: 'Not at this stage in this class' });
          continue;
        }
        const input: Input = {
          marks: x.marks,
          absent: x.absent,
          remark: x.remark,
          decision: x.decision,
          reason: x.reason,
        };
        const prep = this.prepare(row, input, paper, false);
        if (prep.error !== undefined) {
          errors.push({ applicationId: x.applicationId, error: prep.error });
          continue;
        }
        if (!prep.changed && !prep.decision) continue;
        // (a decided candidate's changes are logged with the reason in the registration's history)
        await c.query('SAVEPOINT result_row');
        try {
          await this.write(c, ctx, dto, at.stage, paper, row, prep, input, mine);
          await c.query('RELEASE SAVEPOINT result_row');
          saved += 1;
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT result_row');
          if (!(e instanceof DomainError)) throw e;
          errors.push({ applicationId: x.applicationId, error: e.message });
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.results.save',
        entityType: 'admission_stages',
        entityId: dto.stageId,
        after: { cycleId: dto.cycleId, classId: dto.classId, saved, errors: errors.length },
      });
    });
    return { saved, errors };
  }

  /** The class's sheet: the candidates who may still be marked or decided, a column per part. */
  async sheet(ctx: RequestContext, p: Place & { slotId?: string }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.placeOf(c, p);
      const paper = this.needPaper(at);
      // a slot's sheet: only its candidates (Tests and interviews)
      let slot: string | null = null;
      if (p.slotId) {
        const s = await c.query<{ starts_at: Date; venue: string }>(
          `SELECT starts_at, venue FROM admission_slots WHERE id = $1 AND cycle_id = $2 AND stage_id = $3`,
          [p.slotId, p.cycleId, p.stageId],
        );
        if (!s.rows[0])
          throw new DomainError('not-found', 'Slot not found in this session and stage', {
            status: 404,
          });
        slot = `${new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(s.rows[0].starts_at)} · ${s.rows[0].venue}`;
      }
      // everyone who reached the stage, decided ones too (docs/design/58), with what they have now
      const rows = (await this.rowsIn(c, p, paper)).filter(
        (r) => r.state !== 'other' && (!p.slotId || r.slotId === p.slotId),
      );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Results');
      ws.getCell('A1').value =
        `Results sheet: ${at.stage} · ${at.className}${slot ? ` · slot ${slot}` : ''}`;
      ws.getCell('A1').font = { bold: true, size: 13 };
      ws.getCell('A2').value =
        `${at.cycle} · made ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${ctx.user.displayName}. Change what needs changing: marks (a blank cell is not changed), Absent (Y), Decision (Select, Hold or Not selected; blank: marks only) and Remark. A candidate already selected or not selected needs a Reason for change. Rows left as they are change nothing.`;
      ws.getCell('A3').value = `EPMARK:${p.cycleId}:${p.classId}:${p.stageId}`;
      ws.getCell('A3').font = { color: { argb: 'FF888888' }, size: 8 };
      ws.getCell('B3').value = 'Do not change row 3, the headings or the Registration no. column.';
      const parts = paper.parts.map((pt) => `${pt.name} (${String(pt.maxMarks)})`);
      const head = [
        'Registration no.',
        'Candidate',
        'Roll no.',
        'Category',
        ...parts,
        'Absent (Y)',
        `Total (${String(paper.total)})`,
        '%',
        'Decision',
        'Remark',
        'Reason for change',
      ];
      const hr = ws.getRow(HEAD_ROW);
      hr.values = head;
      hr.font = { bold: true };
      head.forEach(
        (h, i) =>
          (ws.getColumn(i + 1).width =
            i < 2
              ? 24
              : h === 'Remark' || h === 'Reason for change'
                ? 36
                : Math.max(10, h.length + 2)),
      );
      const first = 5;
      const lastPart = first + parts.length - 1;
      const col = (n: number) => ws.getColumn(n).letter;
      const cAbsent = lastPart + 1;
      const cTotal = cAbsent + 1;
      const cPct = cTotal + 1;
      const cDecision = cPct + 1;
      const cRemark = cDecision + 1;
      const cReason = cRemark + 1;
      const SHEET_CHOICE: Record<Choice, string> = {
        select: 'Select',
        hold: 'Hold',
        reject: 'Not selected',
      };
      rows.forEach((x, i) => {
        const n = HEAD_ROW + 1 + i;
        const row = ws.getRow(n);
        row.values = [
          x.number ?? '',
          x.candidate ?? '',
          x.rollNo ?? '',
          x.category ?? '',
          ...paper.parts.map((pt) => x.marks[pt.id] ?? ''),
          x.absent ? 'Y' : '',
        ];
        row.getCell(cTotal).value = {
          formula: `IF(${col(cAbsent)}${String(n)}="Y","",IF(COUNT(${col(first)}${String(n)}:${col(lastPart)}${String(n)})=0,"",SUM(${col(first)}${String(n)}:${col(lastPart)}${String(n)})))`,
        };
        row.getCell(cPct).value = {
          formula: `IF(${col(cTotal)}${String(n)}="","",ROUND(${col(cTotal)}${String(n)}/${String(paper.total)}*100,2))`,
        };
        if (x.remark) row.getCell(cRemark).value = x.remark;
        if (x.current) row.getCell(cDecision).value = SHEET_CHOICE[x.current];
        paper.parts.forEach((pt, j) => {
          const cell = row.getCell(first + j);
          cell.dataValidation = {
            type: 'decimal',
            operator: 'between',
            allowBlank: true,
            formulae: [0, pt.maxMarks],
            showErrorMessage: true,
            errorTitle: pt.name,
            error: `Marks from 0 to ${String(pt.maxMarks)}`,
          };
          cell.protection = { locked: false };
        });
        row.getCell(cAbsent).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"Y"'],
          showErrorMessage: true,
          error: 'Y for absent, or leave it blank',
        };
        if (x.state !== 'sent_back')
          row.getCell(cDecision).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"Select,Hold,Not selected"'],
            showErrorMessage: true,
            errorTitle: 'Decision',
            error: 'Select, Hold or Not selected, or leave it blank',
          };
        for (const k of [cAbsent, cDecision, cRemark, cReason])
          row.getCell(k).protection = { locked: false };
      });
      await ws.protect('', {
        selectLockedCells: true,
        selectUnlockedCells: true,
        formatColumns: true,
      });
      return {
        filename:
          `Results-${at.stage}-${at.className}${p.slotId ? `-slot-${p.slotId}` : ''}.xlsx`.replace(
            /[^\w.-]+/g,
            '-',
          ),
        contentType: XLSX,
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        rows: rows.length,
      };
    });
  }

  /** The filled sheet (.xlsx, or the same saved as .csv) as rows of text: row n is grid[n - 1]. */
  private async grid(body: unknown): Promise<string[][]> {
    if (!Buffer.isBuffer(body) || !body.length)
      throw new DomainError('validation-failed', 'Upload the filled sheet (.xlsx or .csv)', {
        status: 400,
      });
    if (body.length > MAX_BYTES)
      throw new DomainError('validation-failed', 'The sheet is larger than 5 MB', { status: 400 });
    // an .xlsx is a zip ("PK"); anything else is read as CSV text
    if (body[0] !== 0x50 || body[1] !== 0x4b) return csvRecords(body.toString('utf8'));
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(body as unknown as ArrayBuffer);
    } catch {
      throw new DomainError('validation-failed', 'That file is not an Excel sheet (.xlsx)', {
        status: 400,
      });
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new DomainError('validation-failed', 'The file has no sheet', { status: 400 });
    const text = (v: ExcelJS.CellValue): string => {
      if (v === null || v === undefined) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
      if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
      if (typeof v === 'object' && 'text' in v) return String(v.text);
      return String(v);
    };
    const out: string[][] = [];
    const rows = Math.min(ws.rowCount, HEAD_ROW + MAX_ROWS + 1);
    for (let n = 1; n <= rows; n += 1) {
      const r = ws.getRow(n);
      const cells: string[] = [];
      for (let i = 1; i <= ws.columnCount; i += 1) cells.push(text(r.getCell(i).value));
      out.push(cells);
    }
    if (ws.rowCount > HEAD_ROW + MAX_ROWS)
      throw new DomainError('validation-failed', `At most ${String(MAX_ROWS)} rows in one sheet`, {
        status: 400,
      });
    return out;
  }

  /** The filled sheet checked row by row; with apply, the good rows saved and decided. */
  async upload(ctx: RequestContext, body: unknown, apply: boolean) {
    const g = await this.grid(body);
    const cell = (n: number, i: number) => (g[n - 1]?.[i] ?? '').trim();
    const key = KEY.exec(cell(3, 0));
    if (!key)
      throw new DomainError(
        'validation-failed',
        'This is not a results sheet made here: download the sheet of the class first',
        { status: 400 },
      );
    const p: Place = { cycleId: key[1]!, classId: key[2]!, stageId: key[3]! };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.placeOf(c, p);
      const paper = this.needPaper(at);
      const head = (g[HEAD_ROW - 1] ?? []).map((h) => h.trim());
      const find = (h: string) => head.findIndex((x) => x.toLowerCase() === h.toLowerCase());
      const cNo = find('Registration no.');
      const cParts = paper.parts.map((pt) => find(`${pt.name} (${String(pt.maxMarks)})`));
      const cAbsent = find('Absent (Y)');
      const cDecision = find('Decision');
      const cRemark = find('Remark');
      // a sheet made before docs/design/58 has no reason column: decided candidates then cannot change
      const cReason = find('Reason for change');
      if (cNo < 0 || cAbsent < 0 || cDecision < 0 || cRemark < 0 || cParts.some((x) => x < 0))
        throw new DomainError(
          'validation-failed',
          `The paper of ${at.className} changed since this sheet was made, or its headings were changed: download the sheet again`,
          { status: 400 },
        );
      const all = await this.rowsIn(c, p, paper);
      const byNo = new Map(all.filter((r) => r.number).map((r) => [r.number!, r]));
      const mine = apply ? await admissionWaitingFor(c, ctx.user.id) : new Set<string>();
      const out: Array<{
        row: number;
        number: string;
        candidate: string | null;
        total: number | null;
        decision: string | null;
        status: 'ok' | 'skipped' | 'error' | 'done';
        reason: string | null;
        /** what the row changes, in words */
        change: string | null;
      }> = [];
      const notFound: string[] = [];
      const seen = new Set<string>();
      for (let n = HEAD_ROW + 1; n <= g.length; n += 1) {
        const number = cell(n, cNo);
        if (!number) continue;
        const r = byNo.get(number);
        const line = {
          row: n,
          number,
          candidate: r?.candidate ?? null,
          total: null as number | null,
          decision: cell(n, cDecision) || null,
          status: 'ok' as 'ok' | 'skipped' | 'error' | 'done',
          reason: null as string | null,
          change: null as string | null,
        };
        out.push(line);
        if (seen.has(number)) {
          line.status = 'error';
          line.reason = 'The same registration twice';
          continue;
        }
        seen.add(number);
        if (!r) {
          line.status = 'error';
          line.reason = `Not found in ${at.className} at ${at.stage}`;
          notFound.push(number);
          continue;
        }
        const marks: Record<string, number | null | undefined> = {};
        let bad: string | null = null;
        paper.parts.forEach((pt, j) => {
          const v = cell(n, cParts[j]!);
          if (!v) return;
          const num = Number(v.replace(/,/g, ''));
          if (!Number.isFinite(num)) bad ??= `${pt.name}: "${v}" is not a number`;
          else marks[pt.id] = num;
        });
        const absentText = cell(n, cAbsent).toUpperCase();
        const decisionText = cell(n, cDecision).toLowerCase().replace(/\s+/g, ' ');
        const SHEET_WORDS: Record<string, Choice> = {
          select: 'select',
          selected: 'select',
          hold: 'hold',
          held: 'hold',
          'not selected': 'reject',
          reject: 'reject',
          rejected: 'reject',
        };
        if (absentText && !['Y', 'YES', 'N', 'NO'].includes(absentText))
          bad ??= 'Absent must be Y or blank';
        if (decisionText && !SHEET_WORDS[decisionText])
          bad ??= 'Decision must be Select, Hold or Not selected';
        if (bad) {
          line.status = 'error';
          line.reason = bad;
          continue;
        }
        const remark = cell(n, cRemark);
        const input: Input = {
          marks,
          ...(absentText ? { absent: absentText === 'Y' || absentText === 'YES' } : {}),
          ...(remark ? { remark } : {}),
          decision: decisionText ? SHEET_WORDS[decisionText]! : null,
          ...(cReason >= 0 && cell(n, cReason) ? { reason: cell(n, cReason) } : {}),
        };
        const prep = this.prepare(r, input, paper, true);
        if (prep.error !== undefined) {
          line.status = 'error';
          line.reason = prep.error;
          continue;
        }
        line.total = prep.total;
        line.change = prep.words;
        if (!prep.changed && !prep.decision) {
          line.status = 'skipped';
          line.reason = 'No change';
          continue;
        }
        if (!apply) continue;
        await c.query('SAVEPOINT result_row');
        try {
          await this.write(c, ctx, p, at.stage, paper, r, prep, input, mine);
          await c.query('RELEASE SAVEPOINT result_row');
          line.status = 'done';
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT result_row');
          if (!(e instanceof DomainError)) throw e;
          line.status = 'error';
          line.reason = e.message;
        }
      }
      if (apply)
        await this.audit.stage(ctx, c, {
          action: 'admissions.results.sheet',
          entityType: 'admission_stages',
          entityId: p.stageId,
          after: {
            cycleId: p.cycleId,
            classId: p.classId,
            done: out.filter((x) => x.status === 'done').length,
          },
        });
      const count = (s: string) => out.filter((x) => x.status === s).length;
      return {
        place: `${at.cycle} · ${at.className} · ${at.stage}`,
        applied: apply,
        ok: count('ok'),
        done: count('done'),
        skipped: count('skipped'),
        errors: count('error'),
        notFound,
        rows: out,
      };
    });
  }

  // ---- results released to families (part 4) --------------------------------------------------------
  private async releaseOf(c: PoolClient, p: Place) {
    const r = await c.query<{
      release_at: Date;
      passed: boolean;
      by: string | null;
      told_at: Date | null;
      told_count: number | null;
    }>(
      `SELECT r.release_at, r.release_at <= now() AS passed, u.display_name AS by, r.told_at, r.told_count
         FROM admission_result_releases r LEFT JOIN users u ON u.id = r.set_by
        WHERE r.cycle_id = $1 AND r.class_id = $2 AND r.stage_id = $3`,
      [p.cycleId, p.classId, p.stageId],
    );
    const x = r.rows[0];
    return x
      ? {
          at: x.release_at.toISOString(),
          passed: x.passed,
          by: x.by,
          toldAt: x.told_at?.toISOString() ?? null,
          toldCount: x.told_count,
        }
      : null;
  }

  /** The results of a class and stage shown to families from a date and time (now or later). */
  async setRelease(ctx: RequestContext, dto: ResultsReleaseDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.placeOf(c, dto);
      this.needPaper(at);
      const was = await this.releaseOf(c, dto);
      if (was?.passed)
        throw new DomainError(
          'admissions.results_released',
          'The results are already out to the families: the release can no longer be changed',
          { status: 409 },
        );
      const when = new Date(dto.releaseAt);
      if (when.getTime() < Date.now() - 60_000)
        throw new DomainError(
          'validation-failed',
          'The release time has passed: choose now or a later time',
          { status: 400 },
        );
      await c.query(
        `INSERT INTO admission_result_releases (school_id, cycle_id, class_id, stage_id, release_at, set_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5)
         ON CONFLICT (cycle_id, class_id, stage_id) DO UPDATE SET release_at = EXCLUDED.release_at,
                set_by = EXCLUDED.set_by, set_at = now()`,
        [dto.cycleId, dto.classId, dto.stageId, when, ctx.user.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.results.release',
        entityType: 'admission_stages',
        entityId: dto.stageId,
        after: { cycleId: dto.cycleId, classId: dto.classId, releaseAt: when.toISOString() },
      });
      return { release: await this.releaseOf(c, dto) };
    });
  }

  /** A release withdrawn before its time (the families never saw it). */
  async withdrawRelease(ctx: RequestContext, p: Place) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.placeOf(c, p);
      const was = await this.releaseOf(c, p);
      if (!was) throw new DomainError('not-found', 'No release is set', { status: 404 });
      if (was.passed)
        throw new DomainError(
          'admissions.results_released',
          'The results are already out to the families: the release can no longer be withdrawn',
          { status: 409 },
        );
      await c.query(
        `DELETE FROM admission_result_releases WHERE cycle_id = $1 AND class_id = $2 AND stage_id = $3`,
        [p.cycleId, p.classId, p.stageId],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.results.withdraw',
        entityType: 'admission_stages',
        entityId: p.stageId,
        after: { cycleId: p.cycleId, classId: p.classId },
      });
      return { release: null };
    });
  }

  /**
   * The families told the results are out (once the release time has passed): each candidate with
   * marks (or absent) at the stage gets the admission_result message, the marks by part in the email.
   */
  async tell(ctx: RequestContext, p: Place) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const at = await this.placeOf(c, p);
      const paper = this.needPaper(at);
      const was = await this.releaseOf(c, p);
      if (!was?.passed)
        throw new DomainError(
          'admissions.results_not_released',
          'The results are not out yet: tell the families once the release time has passed',
          { status: 409 },
        );
      const r = await c.query<{
        id: string;
        number: string | null;
        candidate: string | null;
        mobile: string | null;
        email: string | null;
        absent: boolean;
        total: string | null;
        max_total: string | null;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.candidate_name AS candidate, a.contact_mobile AS mobile,
                a.contact_email AS email, sm.absent, sm.total::text, sm.max_total::text
           FROM admission_stage_marks sm JOIN applications a ON a.id = sm.application_id
          WHERE a.cycle_id = $1 AND a.class_id = $2 AND sm.stage_id = $3 AND a.status::text NOT IN ('draft', 'cancelled')
            AND (sm.absent OR sm.total IS NOT NULL)
          ORDER BY a.application_no`,
        [p.cycleId, p.classId, p.stageId],
      );
      const parts = await c.query<{ id: string; name: string; max: string; marks: string | null }>(
        `SELECT m.application_id::text AS id, m.part_name AS name, trim_scale(m.max_marks)::text AS max,
                trim_scale(m.marks)::text AS marks
           FROM admission_part_marks m JOIN admission_paper_parts pp ON pp.id = m.part_id
          WHERE m.stage_id = $1 AND m.application_id = ANY($2::bigint[]) ORDER BY pp.sort_order, m.id`,
        [p.stageId, r.rows.map((x) => x.id)],
      );
      for (const x of r.rows) {
        const max = x.max_total !== null ? Number(x.max_total) : paper.total;
        const total = x.total !== null ? Number(x.total) : null;
        const result = x.absent
          ? `${at.stage}: absent`
          : `${at.stage}: ${String(total)} out of ${String(max)} (${String(round2(((total ?? 0) / max) * 100))}%)`;
        const rows: Array<[string, string]> = x.absent
          ? [[at.stage, 'Absent']]
          : [
              ...parts.rows
                .filter((y) => y.id === x.id)
                .map((y): [string, string] => [y.name, `${y.marks ?? '-'} / ${y.max}`]),
              ['Total', `${String(total)} / ${String(max)}`],
            ];
        await c.query(
          `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8)`,
          [
            'admission_result',
            x.mobile,
            x.email,
            JSON.stringify({
              ...messageTag('status', { applicationId: x.id }),
              name: x.candidate ?? '',
              number: x.number ?? '',
              class: at.className,
              school: '',
              result,
            }),
            `${at.stage} result`,
            `The ${at.stage.toLowerCase()} result of ${x.candidate ?? 'your ward'} is out.`,
            JSON.stringify(rows),
            'Sign in to the admission portal for the details.',
          ],
        );
      }
      await c.query(
        `UPDATE admission_result_releases SET told_at = now(), told_by = $4, told_count = $5
          WHERE cycle_id = $1 AND class_id = $2 AND stage_id = $3`,
        [p.cycleId, p.classId, p.stageId, ctx.user.id, r.rows.length],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.results.tell',
        entityType: 'admission_stages',
        entityId: p.stageId,
        after: { cycleId: p.cycleId, classId: p.classId, told: r.rows.length },
      });
      return { told: r.rows.length, release: await this.releaseOf(c, p) };
    });
  }

  /** The grid as filtered, as Excel or a letterhead PDF. */
  async export(ctx: RequestContext, q: ResultsQueryDto & { format: 'xlsx' | 'pdf' }) {
    const data = await this.list(ctx, q);
    const paper = data.place.paper;
    if (!paper) this.needPaper(data.place);
    const parts = paper!.parts;
    const title = `${data.place.stage} results · ${data.place.className}`;
    const subtitle = `${data.place.cycle} · ${String(data.rows.length)} candidate${data.rows.length === 1 ? '' : 's'} · out of ${String(paper!.total)}`;
    const columns = [
      'Roll no.',
      'Registration no.',
      'Candidate',
      ...parts.map((pt) => `${pt.name} (${String(pt.maxMarks)})`),
      'Total',
      '%',
      'Cut-off',
      'Stands',
    ];
    const rows = data.rows.map((r) => [
      r.rollNo !== null ? String(r.rollNo) : '',
      r.number ?? '',
      r.candidate ?? '',
      ...parts.map((pt) =>
        r.absent ? 'AB' : r.marks[pt.id] != null ? String(r.marks[pt.id]) : '',
      ),
      r.absent ? 'Absent' : r.total !== null ? String(r.total) : '',
      r.percent !== null ? String(r.percent) : '',
      r.below ? 'Below' : '',
      STATE_WORDS[r.state],
    ]);
    const file = `results-${data.place.stage}-${data.place.className}`
      .toLowerCase()
      .replace(/[^\w-]+/g, '-');
    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Results');
      ws.addRow([title]).font = { bold: true };
      ws.addRow([subtitle]);
      ws.addRow([]);
      ws.addRow(columns).font = { bold: true };
      columns.forEach(
        (h, i) => (ws.getColumn(i + 1).width = i === 2 ? 28 : Math.max(10, h.length + 2)),
      );
      for (const r of rows) ws.addRow(r);
      return {
        filename: `${file}.xlsx`,
        contentType: XLSX,
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    }
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
      // A4 is 515 points wide inside the margins: the parts share what the fixed columns leave
      const fixed = [28, 64, 96];
      const tail = [36, 34, 36, 52];
      const room = 515 - [...fixed, ...tail].reduce((n, w) => n + w, 0);
      const each = Math.max(22, Math.floor(room / Math.max(parts.length, 1)));
      const bytes = await tablePdf({
        school: {
          name: sc.name,
          address: sc.address,
          contact: sc.contact ? `Phone ${sc.contact}` : null,
        },
        logo: await this.core.fileBytes(c, sc.logo),
        title,
        subtitle,
        columns: columns.map((h, i) => ({
          h,
          w:
            i < fixed.length
              ? fixed[i]!
              : i < fixed.length + parts.length
                ? each
                : tail[i - fixed.length - parts.length]!,
        })),
        rows,
        printedAt: new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      });
      return {
        filename: `${file}.pdf`,
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }
}
