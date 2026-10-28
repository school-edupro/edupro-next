import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

/** A part of a paper: a test's subject or an interview's parameter (docs/design/57). */
export interface PaperPart {
  id: string;
  /** the school's list entry it is (docs/design/57, follow-up) */
  itemId: string | null;
  name: string;
  maxMarks: number;
  passMarks: number | null;
}
export interface Paper {
  id: string;
  minPercent: number | null;
  parts: PaperPart[];
  /** the class's maximum for the stage: the sum of the parts */
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A stage's papers, one per class (only classes with active parts). */
export async function papersIn(c: PoolClient, stageId: string): Promise<Map<string, Paper>> {
  const r = await c.query<{
    class_id: string;
    paper_id: string;
    min_percent: string | null;
    part_id: string;
    item_id: string | null;
    name: string;
    max_marks: string;
    pass_marks: string | null;
  }>(
    `SELECT p.class_id::text, p.id::text AS paper_id, p.min_percent::text, pp.id::text AS part_id,
            pp.item_id::text, pp.name,
            pp.max_marks::text, pp.pass_marks::text
       FROM admission_papers p
       JOIN admission_paper_parts pp ON pp.paper_id = p.id AND pp.status = 'active'
      WHERE p.stage_id = $1 ORDER BY p.class_id, pp.sort_order, pp.id`,
    [stageId],
  );
  const out = new Map<string, Paper>();
  for (const x of r.rows) {
    const p = out.get(x.class_id) ?? {
      id: x.paper_id,
      minPercent: x.min_percent !== null ? Number(x.min_percent) : null,
      parts: [],
      total: 0,
    };
    p.parts.push({
      id: x.part_id,
      itemId: x.item_id,
      name: x.name,
      maxMarks: Number(x.max_marks),
      passMarks: x.pass_marks !== null ? Number(x.pass_marks) : null,
    });
    p.total = round2(p.total + Number(x.max_marks));
    out.set(x.class_id, p);
  }
  return out;
}

/** The marks an application has in a stage's parts (part id → marks), and absent. */
export async function marksOf(
  c: PoolClient,
  appId: string,
  stageId: string,
): Promise<{
  marks: Record<string, number | null>;
  absent: boolean;
  remark: string | null;
} | null> {
  const s = await c.query<{ absent: boolean; remark: string | null }>(
    `SELECT absent, remark FROM admission_stage_marks WHERE application_id = $1 AND stage_id = $2`,
    [appId, stageId],
  );
  if (!s.rows[0]) return null;
  const m = await c.query<{ part_id: string; marks: string | null }>(
    `SELECT part_id::text, marks::text FROM admission_part_marks WHERE application_id = $1 AND stage_id = $2`,
    [appId, stageId],
  );
  return {
    marks: Object.fromEntries(
      m.rows.map((x) => [x.part_id, x.marks !== null ? Number(x.marks) : null]),
    ),
    absent: s.rows[0].absent,
    remark: s.rows[0].remark,
  };
}

/**
 * Marks by part written for an application and stage: each part's marks (with its name and maximum
 * kept), and the stage's absent, total (the parts entered; none, or absent: null), out of and remark.
 */
export async function storeMarks(
  c: PoolClient,
  userId: string,
  appId: string,
  stageId: string,
  paper: Paper,
  next: Record<string, number | null>,
  absent: boolean,
  remark: string | null,
): Promise<{ total: number | null }> {
  for (const pt of paper.parts)
    await c.query(
      `INSERT INTO admission_part_marks (school_id, application_id, stage_id, part_id, part_name, max_marks, marks, entered_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (application_id, part_id) DO UPDATE SET part_name = EXCLUDED.part_name, max_marks = EXCLUDED.max_marks,
              marks = EXCLUDED.marks, entered_by = EXCLUDED.entered_by, entered_at = now()
        WHERE admission_part_marks.marks IS DISTINCT FROM EXCLUDED.marks
           OR admission_part_marks.part_name <> EXCLUDED.part_name
           OR admission_part_marks.max_marks <> EXCLUDED.max_marks`,
      [appId, stageId, pt.id, pt.name, pt.maxMarks, absent ? null : (next[pt.id] ?? null), userId],
    );
  const got = paper.parts
    .map((pt) => next[pt.id])
    .filter((v): v is number => v !== null && v !== undefined);
  const total = absent || !got.length ? null : round2(got.reduce((n, v) => n + v, 0));
  await c.query(
    `INSERT INTO admission_stage_marks (school_id, application_id, stage_id, absent, total, max_total, remark, updated_by)
     VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (application_id, stage_id) DO UPDATE SET absent = EXCLUDED.absent, total = EXCLUDED.total,
            max_total = EXCLUDED.max_total, remark = EXCLUDED.remark, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [appId, stageId, absent, total, paper.total, remark, userId],
  );
  return { total };
}

/** Marks by part checked against the paper: every key a part, every value 0 to the part's maximum. */
export function checkParts(paper: Paper, parts: Record<string, number | null | undefined>) {
  for (const [k, v] of Object.entries(parts)) {
    const pt = paper.parts.find((x) => x.id === k);
    if (!pt) throw new DomainError('validation-failed', 'A part not on the paper', { status: 400 });
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0 || v > pt.maxMarks))
      throw new DomainError(
        'validation-failed',
        `${pt.name}: marks from 0 to ${String(pt.maxMarks)}`,
        { status: 400 },
      );
  }
}
