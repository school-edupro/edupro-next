import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { papersIn, type Paper } from './part-marks';
import type { CopyPaperDto, PaperDto, PaperItemsDto } from './process.dto';

/** The list's first entries beyond the school's own subjects (the school changes them). */
const TEST_ITEMS = ['Mental Ability', 'General Knowledge', 'Reasoning'];
const INTERVIEW_ITEMS = [
  'Communication',
  'Confidence',
  'General awareness',
  'Behaviour',
  'Parent interaction',
];

export type { Paper, PaperPart } from './part-marks';

type ItemKind = 'test' | 'interview' | 'both';
export interface PaperItem {
  id: string;
  name: string;
  kind: ItemKind;
  maxMarks: number | null;
  status: 'active' | 'inactive';
  /** the classes' papers (of any stage) using it */
  used: number;
  usedIn: Array<'test' | 'interview'>;
}
const fits = (kind: ItemKind, stage: 'test' | 'interview') => kind === 'both' || kind === stage;

/**
 * Test and interview papers by class (docs/design/57, part 1): a Test or Interview stage's paper for a
 * class lists its parts (subjects, or an interview's parameters) with maximum marks and an optional
 * pass mark, and an optional minimum total %. The class's maximum for the stage is the sum of the
 * parts; a class with no paper keeps the stage's own maximum. A part taken off is switched off.
 */
@Injectable()
export class AdmissionPapersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async stageOf(c: PoolClient, stageId: string) {
    const s = await c.query<{ id: string; name: string; kind: string; max_marks: string | null }>(
      `SELECT id::text, name, kind, max_marks::text FROM admission_stages WHERE id = $1`,
      [stageId],
    );
    const x = s.rows[0];
    if (!x) throw new DomainError('not-found', 'Stage not found', { status: 404 });
    if (x.kind !== 'test' && x.kind !== 'interview')
      throw new DomainError(
        'validation-failed',
        `${x.name} is not a test or an interview: it has no paper`,
        { status: 400 },
      );
    return {
      id: x.id,
      name: x.name,
      kind: x.kind as 'test' | 'interview',
      maxMarks: x.max_marks !== null ? Number(x.max_marks) : null,
    };
  }

  private async classOf(c: PoolClient, classId: string) {
    const k = await c.query<{ name: string }>(
      `SELECT name FROM classes WHERE id = $1 AND deleted_at IS NULL`,
      [classId],
    );
    if (!k.rows[0]) throw new DomainError('not-found', 'Class not found', { status: 404 });
    return k.rows[0].name;
  }

  /**
   * The school's test subjects and interview parameters (docs/design/57, follow-up). An empty list
   * starts with the school's scholastic subjects and the usual extras; the school changes it.
   */
  async itemsWith(c: PoolClient): Promise<PaperItem[]> {
    const n = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM admission_paper_items`);
    if (!n.rows[0]?.n) {
      const subjects = await c.query<{ name: string }>(
        `SELECT min(btrim(name)) AS name FROM subjects WHERE status = 'active' AND kind::text = 'scholastic'
          GROUP BY lower(btrim(name)) ORDER BY 1 LIMIT 80`,
      );
      const seed: Array<[string, ItemKind]> = [
        ...subjects.rows.map((x): [string, ItemKind] => [x.name, 'test']),
        ...TEST_ITEMS.map((x): [string, ItemKind] => [x, 'test']),
        ...INTERVIEW_ITEMS.map((x): [string, ItemKind] => [x, 'interview']),
      ];
      for (const [i, [name, kind]] of seed.entries())
        await c.query(
          `INSERT INTO admission_paper_items (school_id, name, kind, sort_order) VALUES (app.current_school_id(), $1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [name, kind, i],
        );
    }
    const r = await c.query<{
      id: string;
      name: string;
      kind: ItemKind;
      max_marks: string | null;
      status: 'active' | 'inactive';
      used: number;
      used_in: string[];
    }>(
      `SELECT i.id::text, i.name, i.kind, i.max_marks::text, i.status,
              (SELECT count(DISTINCT pp.paper_id)::int FROM admission_paper_parts pp
                WHERE pp.item_id = i.id AND pp.status = 'active') AS used,
              COALESCE((SELECT array_agg(DISTINCT st.kind) FROM admission_paper_parts pp
                          JOIN admission_papers p ON p.id = pp.paper_id JOIN admission_stages st ON st.id = p.stage_id
                         WHERE pp.item_id = i.id AND pp.status = 'active'), '{}') AS used_in
         FROM admission_paper_items i ORDER BY i.sort_order, lower(i.name)`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      kind: x.kind,
      maxMarks: x.max_marks !== null ? Number(x.max_marks) : null,
      status: x.status,
      used: x.used,
      usedIn: x.used_in as Array<'test' | 'interview'>,
    }));
  }

  /** The list, and the school's scholastic subjects not on it yet. */
  async items(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const items = await this.itemsWith(c);
      return { items, subjects: await this.subjectsMissing(c) };
    });
  }

  private async subjectsMissing(c: PoolClient) {
    const r = await c.query<{ name: string }>(
      `SELECT min(btrim(s.name)) AS name FROM subjects s
        WHERE s.status = 'active' AND s.kind::text = 'scholastic'
          AND NOT EXISTS (SELECT 1 FROM admission_paper_items i WHERE lower(btrim(i.name)) = lower(btrim(s.name)))
        GROUP BY lower(btrim(s.name)) ORDER BY 1 LIMIT 80`,
    );
    return r.rows.map((x) => x.name);
  }

  /**
   * The list saved: entries kept by id, new ones added, the rest deleted (switched off when a paper
   * uses them). An entry used by a paper keeps a kind that still fits it; a rename reaches its papers.
   */
  async saveItems(ctx: RequestContext, dto: PaperItemsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.itemsWith(c);
      const names = new Set<string>();
      for (const x of dto.items) {
        const k = x.name.trim().toLowerCase();
        if (names.has(k))
          throw new DomainError('validation-failed', `${x.name.trim()} is on the list twice`, {
            status: 400,
          });
        names.add(k);
        const was = before.find((b) => b.id === x.id);
        const misfit = was?.usedIn.find((st) => !fits(x.kind, st));
        if (misfit)
          throw new DomainError(
            'validation-failed',
            `${x.name.trim()} is on ${misfit === 'test' ? 'a written test' : 'an interview'} paper: keep it for ${misfit === 'test' ? 'the written test' : 'the interview'} or both`,
            { status: 400 },
          );
      }
      const kept = new Set(dto.items.map((x) => x.id).filter(Boolean));
      for (const old of before)
        if (!kept.has(old.id)) {
          if (old.used)
            await c.query(`UPDATE admission_paper_items SET status = 'inactive' WHERE id = $1`, [
              old.id,
            ]);
          else
            await c.query(
              `DELETE FROM admission_paper_items i WHERE i.id = $1
                 AND NOT EXISTS (SELECT 1 FROM admission_paper_parts pp WHERE pp.item_id = i.id)`,
              [old.id],
            );
        }
      // entries being renamed let go of their names first (two entries may swap names)
      const renamed = dto.items
        .filter((x) => before.some((b) => b.id === x.id && b.name !== x.name.trim()))
        .map((x) => x.id!);
      if (renamed.length)
        await c.query(
          `UPDATE admission_paper_items SET name = '~' || id::text WHERE id::text = ANY($1::text[])`,
          [renamed],
        );
      for (const [i, x] of dto.items.entries()) {
        const fields = [x.name.trim(), x.kind, x.maxMarks ?? null, x.status, i];
        const done =
          x.id && before.some((b) => b.id === x.id)
            ? await c.query(
                `UPDATE admission_paper_items SET name = $2, kind = $3, max_marks = $4, status = $5, sort_order = $6 WHERE id = $1`,
                [x.id, ...fields],
              )
            : null;
        if (!done?.rowCount)
          await c
            .query(
              `INSERT INTO admission_paper_items (school_id, name, kind, max_marks, status, sort_order)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
              fields,
            )
            .catch((e: { code?: string }) => {
              if (e.code === '23505')
                throw new DomainError(
                  'conflict',
                  `${x.name.trim()} is on the list already (perhaps switched off)`,
                  { status: 409 },
                );
              throw e;
            });
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.paper_items',
        entityType: 'admission_paper_items',
        entityId: '0',
        after: { items: dto.items.map((x) => `${x.name.trim()} (${x.kind})`) },
      });
      return { items: await this.itemsWith(c), subjects: await this.subjectsMissing(c) };
    });
  }

  /** The school's scholastic subjects not on the list added to it, for the written test. */
  async importSubjects(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.itemsWith(c);
      const missing = await this.subjectsMissing(c);
      for (const name of missing)
        await c.query(
          `INSERT INTO admission_paper_items (school_id, name, kind, sort_order)
           VALUES (app.current_school_id(), $1, 'test', (SELECT COALESCE(max(sort_order), 0) + 1 FROM admission_paper_items))
           ON CONFLICT DO NOTHING`,
          [name],
        );
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.paper_items_import',
        entityType: 'admission_paper_items',
        entityId: '0',
        after: { added: missing },
      });
      return { added: missing.length, items: await this.itemsWith(c), subjects: [] as string[] };
    });
  }

  /** The stage's papers, one per class (none: null). */
  papersIn(c: PoolClient, stageId: string): Promise<Map<string, Paper>> {
    return papersIn(c, stageId);
  }

  /** A Test or Interview stage: every class with its paper, the other marks stages, and the list's entries. */
  async list(ctx: RequestContext, stageId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stage = await this.stageOf(c, stageId);
      const stages = await c.query<{ id: string; name: string; kind: string }>(
        `SELECT id::text, name, kind FROM admission_stages
          WHERE kind IN ('test', 'interview') AND status = 'active' ORDER BY sort_order, id`,
      );
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
      );
      const papers = await this.papersIn(c, stageId);
      const inUse = new Set(
        [...papers.values()].flatMap((p) => p.parts.map((pt) => pt.itemId)).filter(Boolean),
      );
      // what a part may be: the stage's active entries, and any entry a paper here still uses
      const items = (await this.itemsWith(c))
        .filter((x) => (x.status === 'active' && fits(x.kind, stage.kind)) || inUse.has(x.id))
        .map((x) => ({ id: x.id, name: x.name, maxMarks: x.maxMarks, off: x.status !== 'active' }));
      return {
        stage,
        stages: stages.rows,
        classes: classes.rows.map((k) => ({ ...k, paper: papers.get(k.id) ?? null })),
        items,
      };
    });
  }

  /** Saves a class's paper: parts kept by id, new ones added, the rest switched off; none: no paper. */
  async save(ctx: RequestContext, stageId: string, classId: string, dto: PaperDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stage = await this.stageOf(c, stageId);
      const className = await this.classOf(c, classId);
      await this.saveIn(c, ctx, stage, classId, dto);
      const paper = (await this.papersIn(c, stage.id)).get(classId) ?? null;
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.paper',
        entityType: 'admission_stages',
        entityId: stage.id,
        after: {
          class: className,
          minPercent: dto.minPercent ?? null,
          parts: (paper?.parts ?? []).map((p) => `${p.name} ${String(p.maxMarks)}`),
        },
      });
      return { paper: (await this.papersIn(c, stage.id)).get(classId) ?? null };
    });
  }

  private async saveIn(
    c: PoolClient,
    ctx: RequestContext,
    stage: { id: string; kind: 'test' | 'interview' },
    classId: string,
    dto: PaperDto,
  ) {
    const stageId = stage.id;
    // every part is an entry of the school's list that fits the stage (docs/design/57, follow-up)
    const list = await this.itemsWith(c);
    const current = new Set(
      ((await this.papersIn(c, stageId)).get(classId)?.parts ?? []).map((pt) => pt.itemId),
    );
    const words = stage.kind === 'test' ? 'written test' : 'interview';
    const resolved = dto.parts.map((p) => {
      const item = p.itemId
        ? list.find((x) => x.id === p.itemId)
        : list.find((x) => x.name.toLowerCase() === p.name!.trim().toLowerCase());
      if (!item)
        throw new DomainError(
          'validation-failed',
          p.itemId
            ? 'That subject or parameter is not on the list'
            : `${p.name!.trim()} is not on Subjects and parameters: add it there first`,
          { status: 400 },
        );
      if (!fits(item.kind, stage.kind))
        throw new DomainError('validation-failed', `${item.name} is not for the ${words}`, {
          status: 400,
        });
      if (item.status !== 'active' && !current.has(item.id))
        throw new DomainError('validation-failed', `${item.name} is switched off on the list`, {
          status: 400,
        });
      return { ...p, itemId: item.id, name: item.name };
    });
    const seen = new Set<string>();
    for (const p of resolved) {
      if (seen.has(p.itemId))
        throw new DomainError('validation-failed', `${p.name} is on the paper twice`, {
          status: 400,
        });
      seen.add(p.itemId);
    }
    const paper = await c.query<{ id: string }>(
      `INSERT INTO admission_papers (school_id, stage_id, class_id, min_percent, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4)
       ON CONFLICT (stage_id, class_id) DO UPDATE SET min_percent = EXCLUDED.min_percent, updated_at = now(),
              updated_by = EXCLUDED.updated_by
       RETURNING id::text`,
      [stageId, classId, dto.parts.length ? (dto.minPercent ?? null) : null, ctx.user.id],
    );
    const paperId = paper.rows[0]!.id;
    const kept = dto.parts.map((p) => p.id).filter((x): x is string => Boolean(x));
    // parts left out are switched off first, so a kept part may take a freed name
    await c.query(
      `UPDATE admission_paper_parts SET status = 'inactive'
        WHERE paper_id = $1 AND status = 'active' AND id::text <> ALL($2::text[])`,
      [paperId, kept],
    );
    try {
      for (const [i, p] of resolved.entries()) {
        const fields = [p.name, p.maxMarks, p.passMarks ?? null, i, p.itemId];
        const done = p.id
          ? await c.query(
              `UPDATE admission_paper_parts SET name = $3, max_marks = $4, pass_marks = $5, sort_order = $6, item_id = $7,
                      status = 'active'
                WHERE id = $1 AND paper_id = $2`,
              [p.id, paperId, ...fields],
            )
          : null;
        if (!done?.rowCount)
          await c.query(
            `INSERT INTO admission_paper_parts (school_id, paper_id, name, max_marks, pass_marks, sort_order, item_id)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
            [paperId, ...fields],
          );
      }
    } catch (e) {
      // two parts swapping names in one save
      if ((e as { code?: string }).code === '23505')
        throw new DomainError(
          'conflict',
          'Two parts would have the same name while saving: save the names one at a time',
          { status: 409 },
        );
      throw e;
    }
  }

  /** One class's paper copied to other classes (their parts replaced). */
  async copy(ctx: RequestContext, stageId: string, dto: CopyPaperDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stage = await this.stageOf(c, stageId);
      const from = (await this.papersIn(c, stage.id)).get(dto.fromClassId);
      if (!from)
        throw new DomainError('validation-failed', 'That class has no paper to copy', {
          status: 400,
        });
      const to = dto.toClassIds.filter((x) => x !== dto.fromClassId);
      for (const classId of to) {
        await this.classOf(c, classId);
        // the target's own parts are switched off and the copied ones added
        await this.saveIn(c, ctx, stage, classId, {
          minPercent: from.minPercent,
          parts: from.parts.map((p) => ({
            ...(p.itemId ? { itemId: p.itemId } : { name: p.name }),
            maxMarks: p.maxMarks,
            passMarks: p.passMarks,
          })),
        });
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.paper_copy',
        entityType: 'admission_stages',
        entityId: stage.id,
        after: { fromClassId: dto.fromClassId, toClassIds: to },
      });
      return { copied: to.length };
    });
  }
}
