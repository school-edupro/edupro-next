import type { PoolClient } from '@edupro/db';

/**
 * The admission process of an application (docs/design/39, part 4): the steps it follows (a stage with
 * its approval levels), where it waits, and what the family sees of it. Plain functions on a client so
 * the office, the portal and registration share them.
 */

export type LevelBy = 'anyone' | 'role' | 'designation' | 'employees';
export interface ProcessLevel {
  name: string;
  by: LevelBy;
  roleCode?: string | null;
  designation?: string | null;
  employeeIds?: string[];
}
export interface ProcessStep {
  stageId: string;
  levels: ProcessLevel[];
}
export type StageKind =
  'document_check' | 'test' | 'interview' | 'interaction' | 'selection' | 'custom';
export interface StageRow {
  id: string;
  name: string;
  kind: StageKind;
  max_marks: string | null;
}
export interface ResultRow {
  id: string;
  stage_id: string;
  level: number;
  decision: 'approved' | 'rejected' | 'hold' | 'offered' | 'waitlisted';
  attendance: 'present' | 'absent' | null;
  marks: string | null;
  max_marks: string | null;
  remarks: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date;
}

/** Statuses in which the process moves (the office decides); later ones belong to the offer and the fee. */
export const IN_PROCESS = ['registered', 'under_review', 'sent_back', 'waitlisted'] as const;

const PASSED = new Set(['approved', 'offered']);

export async function stagesById(c: PoolClient): Promise<Map<string, StageRow>> {
  const r = await c.query<StageRow>(
    `SELECT id::text, name, kind, max_marks::text FROM admission_stages`,
  );
  return new Map(r.rows.map((s) => [s.id, s]));
}

/** The live decisions of an application (undone ones left out), oldest first. */
export async function resultsOf(c: PoolClient, appId: string): Promise<ResultRow[]> {
  const r = await c.query<ResultRow>(
    `SELECT id::text, stage_id::text, level, decision, attendance, marks::text, max_marks::text, remarks,
            decided_by::text, decided_by_name, decided_at
       FROM admission_stage_results WHERE application_id = $1 AND undone_at IS NULL ORDER BY decided_at, id`,
    [appId],
  );
  return r.rows;
}

/** The latest live decision of each (stage, level). */
const latest = (results: ResultRow[]) => {
  const out = new Map<string, ResultRow>();
  for (const x of results) out.set(`${x.stage_id}:${x.level}`, x);
  return out;
};

/** Where the steps stand: the first step not passed at every level, and its first level not passed. */
export function pointer(
  steps: ProcessStep[],
  results: ResultRow[],
): { stageNo: number; levelNo: number } {
  const last = latest(results);
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i]!;
    for (let l = 1; l <= s.levels.length; l += 1) {
      const r = last.get(`${s.stageId}:${l}`);
      if (!r || !PASSED.has(r.decision)) return { stageNo: i, levelNo: l };
    }
  }
  return { stageNo: steps.length, levelNo: 1 };
}

/** The sum of the live marks: the merit used to rank at selection. */
export function meritOf(results: ResultRow[]): number | null {
  const last = latest(results);
  let sum = 0;
  let any = false;
  for (const r of last.values())
    if (r.marks !== null) {
      sum += Number(r.marks);
      any = true;
    }
  return any ? Math.round(sum * 100) / 100 : null;
}

/** Recomputes the place of an application in its steps (after a decision, an undo or a process change). */
export async function place(
  c: PoolClient,
  appId: string,
): Promise<{ stageNo: number; levelNo: number; done: boolean }> {
  const a = await c.query<{ steps: ProcessStep[] | null }>(
    `SELECT process_steps AS steps FROM applications WHERE id = $1`,
    [appId],
  );
  const steps = a.rows[0]?.steps ?? [];
  const results = await resultsOf(c, appId);
  const p = pointer(steps, results);
  await c.query(
    `UPDATE applications SET stage_no = $2, level_no = $3, merit = $4, updated_at = now() WHERE id = $1`,
    [appId, p.stageNo, p.levelNo, meritOf(results)],
  );
  return { ...p, done: steps.length > 0 && p.stageNo >= steps.length };
}

/** A registered application starts the process of its class (none set: it waits for one). */
export async function startProcess(c: PoolClient, appId: string): Promise<boolean> {
  const r = await c.query<{ id: string; steps: ProcessStep[] }>(
    `SELECT p.id::text, p.steps FROM applications a
       JOIN admission_process_classes pc ON pc.class_id = a.class_id
       JOIN admission_processes p ON p.id = pc.process_id AND p.status = 'active'
      WHERE a.id = $1 AND a.process_id IS NULL`,
    [appId],
  );
  const p = r.rows[0];
  if (!p) return false;
  await c.query(
    `UPDATE applications SET process_id = $2, process_steps = $3::jsonb WHERE id = $1`,
    [appId, p.id, JSON.stringify(p.steps)],
  );
  await place(c, appId);
  return true;
}

export interface JourneyStep {
  stageId: string;
  name: string;
  kind: StageKind;
  maxMarks: number | null;
  state: 'done' | 'current' | 'waiting' | 'rejected';
  levels: Array<{
    no: number;
    name: string;
    by: LevelBy;
    roleCode: string | null;
    designation: string | null;
    employeeIds: string[];
    result: {
      id: string;
      decision: ResultRow['decision'];
      attendance: string | null;
      marks: number | null;
      maxMarks: number | null;
      remarks: string | null;
      by: string | null;
      at: string;
    } | null;
  }>;
}

/** The steps with their levels and decisions, for the office's stepper and the family's progress. */
export async function journey(c: PoolClient, appId: string): Promise<JourneyStep[]> {
  const a = await c.query<{ steps: ProcessStep[] | null; status: string; stage_no: number | null }>(
    `SELECT process_steps AS steps, status::text, stage_no FROM applications WHERE id = $1`,
    [appId],
  );
  const steps = a.rows[0]?.steps ?? [];
  if (!steps.length) return [];
  const stages = await stagesById(c);
  const last = latest(await resultsOf(c, appId));
  const at = a.rows[0]!.stage_no ?? 0;
  const rejected = a.rows[0]!.status === 'rejected';
  return steps.map((s, i) => {
    const st = stages.get(s.stageId);
    return {
      stageId: s.stageId,
      name: st?.name ?? 'Stage',
      kind: st?.kind ?? 'custom',
      maxMarks: st?.max_marks !== null && st?.max_marks !== undefined ? Number(st.max_marks) : null,
      state: i < at ? 'done' : i === at ? (rejected ? 'rejected' : 'current') : 'waiting',
      levels: s.levels.map((l, j) => {
        const r = last.get(`${s.stageId}:${j + 1}`);
        return {
          no: j + 1,
          name: l.name,
          by: l.by,
          roleCode: l.roleCode ?? null,
          designation: l.designation ?? null,
          employeeIds: l.employeeIds ?? [],
          result: r
            ? {
                id: r.id,
                decision: r.decision,
                attendance: r.attendance,
                marks: r.marks !== null ? Number(r.marks) : null,
                maxMarks: r.max_marks !== null ? Number(r.max_marks) : null,
                remarks: r.remarks,
                by: r.decided_by_name,
                at: r.decided_at.toISOString(),
              }
            : null,
        };
      }),
    };
  });
}

/** The slot of the application at a stage (date, venue, roll no.), for the admit card and the portal. */
export async function slotOf(c: PoolClient, appId: string, stageId?: string) {
  const r = await c.query<{
    slot_id: string;
    stage_id: string;
    stage: string;
    starts_at: Date;
    minutes: number;
    venue: string;
    notes: string | null;
    roll_no: number;
  }>(
    `SELECT s.id::text AS slot_id, s.stage_id::text, st.name AS stage, s.starts_at, s.minutes, s.venue, s.notes, x.roll_no
       FROM admission_slot_allotments x JOIN admission_slots s ON s.id = x.slot_id JOIN admission_stages st ON st.id = s.stage_id
      WHERE x.application_id = $1 AND ($2::bigint IS NULL OR x.stage_id = $2::bigint)
      ORDER BY s.starts_at DESC LIMIT 1`,
    [appId, stageId ?? null],
  );
  const s = r.rows[0];
  return s
    ? {
        slotId: s.slot_id,
        stageId: s.stage_id,
        stage: s.stage,
        startsAt: s.starts_at.toISOString(),
        minutes: s.minutes,
        venue: s.venue,
        notes: s.notes,
        rollNo: s.roll_no,
      }
    : null;
}
