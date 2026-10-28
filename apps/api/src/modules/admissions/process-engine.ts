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
  /** days to decide (docs/design/47); none: no time limit */
  days?: number | null;
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

/** The merit of an application again, after its points changed (docs/design/40). */
export async function refreshMerit(c: PoolClient, appId: string): Promise<void> {
  const results = await resultsOf(c, appId);
  await c.query(
    `UPDATE applications SET merit = CASE WHEN $2::numeric IS NULL AND form_points IS NULL THEN NULL
       ELSE COALESCE($2::numeric, 0) + COALESCE(form_points, 0) END, updated_at = now() WHERE id = $1`,
    [appId, meritOf(results)],
  );
}

/** A slot's date and time as families and the history read it (India time). */
export const slotWhen = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

/**
 * A candidate come to a stage taking slots (Written test, Interview, Interaction) without a slot for it
 * goes into the earliest slot of their class (or for every class) dated today or later, India date,
 * with room (docs/design/59, part 2): the next roll number of the stage and a line in the history; no
 * message (the office mails the schedule from the slot). No slot with room: they wait. Returns the
 * slot taken.
 */
export async function autoSlot(
  c: PoolClient,
  appId: string,
  actorUser: string | null,
): Promise<string | null> {
  const a = await c.query<{ cycle_id: string; class_id: string; status: string; stage_id: string }>(
    `SELECT a.cycle_id::text, a.class_id::text, a.status::text, st.id::text AS stage_id
       FROM applications a JOIN admission_stages st ON st.id::text = (a.process_steps -> a.stage_no ->> 'stageId')
      WHERE a.id = $1 AND a.status::text IN ('registered', 'under_review') AND st.kind IN ('test', 'interview', 'interaction')
        AND NOT EXISTS (SELECT 1 FROM admission_slot_allotments x WHERE x.application_id = a.id AND x.stage_id = st.id)`,
    [appId],
  );
  const x = a.rows[0];
  if (!x) return null;
  // the class's own slot before an every-class one at the same time
  const slots = await c.query<{ id: string; starts_at: Date; venue: string; stage: string }>(
    `SELECT s.id::text, s.starts_at, s.venue, st.name AS stage
       FROM admission_slots s JOIN admission_stages st ON st.id = s.stage_id
      WHERE s.cycle_id = $1 AND s.stage_id = $2 AND (s.class_id IS NULL OR s.class_id = $3)
        AND (s.starts_at AT TIME ZONE 'Asia/Kolkata')::date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY s.starts_at, s.class_id IS NULL, s.id`,
    [x.cycle_id, x.stage_id, x.class_id],
  );
  for (const s of slots.rows) {
    // locked: two decisions at once do not overfill a slot
    const room = await c.query<{ room: number }>(
      `SELECT s.capacity - (SELECT count(*)::int FROM admission_slot_allotments y WHERE y.slot_id = s.id) AS room
         FROM admission_slots s WHERE s.id = $1 FOR UPDATE`,
      [s.id],
    );
    if ((room.rows[0]?.room ?? 0) <= 0) continue;
    const roll = await c.query<{ n: number }>(
      `SELECT COALESCE(max(y.roll_no), 0)::int + 1 AS n FROM admission_slot_allotments y JOIN admission_slots s ON s.id = y.slot_id
        WHERE s.cycle_id = $1 AND y.stage_id = $2`,
      [x.cycle_id, x.stage_id],
    );
    const n = roll.rows[0]!.n;
    const put = await c.query(
      `INSERT INTO admission_slot_allotments (school_id, slot_id, stage_id, application_id, roll_no)
       VALUES (app.current_school_id(), $1, $2, $3, $4) ON CONFLICT (application_id, stage_id) DO NOTHING`,
      [s.id, x.stage_id, appId, n],
    );
    if (!put.rowCount) return null;
    await c.query(
      `INSERT INTO application_events (school_id, application_id, from_status, to_status, note, actor_user_id)
       VALUES (app.current_school_id(), $1, $2::application_status, $2::application_status, $3, $4)`,
      [
        appId,
        x.status,
        `${s.stage}: ${slotWhen(s.starts_at)} at ${s.venue} (roll no. ${String(n)}) · given automatically`.slice(
          0,
          500,
        ),
        actorUser,
      ],
    );
    return s.id;
  }
  return null;
}

/**
 * Recomputes the place of an application in its steps (after a decision, an undo or a process change);
 * come to a stage taking slots, it takes one (docs/design/59) unless the caller does that itself after
 * its own history lines.
 */
export async function place(
  c: PoolClient,
  appId: string,
  opts: { slot?: boolean; actorUser?: string | null } = {},
): Promise<{ stageNo: number; levelNo: number; done: boolean }> {
  const a = await c.query<{ steps: ProcessStep[] | null }>(
    `SELECT process_steps AS steps FROM applications WHERE id = $1`,
    [appId],
  );
  const steps = a.rows[0]?.steps ?? [];
  const results = await resultsOf(c, appId);
  const p = pointer(steps, results);
  await c.query(
    // merit = the form's points (docs/design/40) + the live marks; none of either: no merit yet
    `UPDATE applications SET stage_no = $2, level_no = $3, updated_at = now(),
            merit = CASE WHEN $4::numeric IS NULL AND form_points IS NULL THEN NULL
                         ELSE COALESCE($4::numeric, 0) + COALESCE(form_points, 0) END
      WHERE id = $1`,
    [appId, p.stageNo, p.levelNo, meritOf(results)],
  );
  if (opts.slot !== false) await autoSlot(c, appId, opts.actorUser ?? null);
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
  /** marks by part of a test or interview (docs/design/57), for the office only */
  byPart?: StageMarks | null;
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

/** A candidate's marks in the parts of a stage's paper, the total and absent (docs/design/57). */
export interface StageMarks {
  parts: Array<{ name: string; max: number; marks: number | null }>;
  total: number | null;
  maxTotal: number | null;
  absent: boolean;
  remark: string | null;
}

/** The marks by part of an application, by stage. */
async function marksByStage(c: PoolClient, appId: string): Promise<Map<string, StageMarks>> {
  const sm = await c.query<{
    stage_id: string;
    absent: boolean;
    total: string | null;
    max_total: string | null;
    remark: string | null;
  }>(
    `SELECT stage_id::text, absent, total::text, max_total::text, remark FROM admission_stage_marks WHERE application_id = $1`,
    [appId],
  );
  const out = new Map<string, StageMarks>();
  if (!sm.rows.length) return out;
  const pm = await c.query<{ stage_id: string; name: string; max: string; marks: string | null }>(
    `SELECT m.stage_id::text, m.part_name AS name, m.max_marks::text AS max, m.marks::text
       FROM admission_part_marks m JOIN admission_paper_parts p ON p.id = m.part_id
      WHERE m.application_id = $1 ORDER BY p.sort_order, m.id`,
    [appId],
  );
  for (const x of sm.rows)
    out.set(x.stage_id, {
      parts: pm.rows
        .filter((p) => p.stage_id === x.stage_id)
        .map((p) => ({
          name: p.name,
          max: Number(p.max),
          marks: p.marks !== null ? Number(p.marks) : null,
        })),
      total: x.total !== null ? Number(x.total) : null,
      maxTotal: x.max_total !== null ? Number(x.max_total) : null,
      absent: x.absent,
      remark: x.remark,
    });
  return out;
}

/**
 * The steps with their levels and decisions, for the office's stepper and the family's progress. The
 * marks by part come only when asked (the office): the family sees them after their release.
 */
export async function journey(
  c: PoolClient,
  appId: string,
  opts: { marks?: boolean } = {},
): Promise<JourneyStep[]> {
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
  const marks = opts.marks ? await marksByStage(c, appId) : null;
  return steps.map((s, i) => {
    const st = stages.get(s.stageId);
    return {
      stageId: s.stageId,
      name: st?.name ?? 'Stage',
      kind: st?.kind ?? 'custom',
      maxMarks: st?.max_marks !== null && st?.max_marks !== undefined ? Number(st.max_marks) : null,
      state: i < at ? 'done' : i === at ? (rejected ? 'rejected' : 'current') : 'waiting',
      ...(marks ? { byPart: marks.get(s.stageId) ?? null } : {}),
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
