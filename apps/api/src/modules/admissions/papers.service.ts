import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { papersIn, type Paper } from './part-marks';
import type { CopyPaperDto, PaperDto } from './process.dto';

/** Parts often written in, beyond the school's own subjects (offered as quick picks). */
const TEST_PICKS = ['Mental Ability', 'General Knowledge', 'Reasoning'];
const INTERVIEW_PICKS = [
  'Communication',
  'Confidence',
  'General awareness',
  'Behaviour',
  'Parent interaction',
];

export type { Paper, PaperPart } from './part-marks';

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

  /** The stage's papers, one per class (none: null). */
  papersIn(c: PoolClient, stageId: string): Promise<Map<string, Paper>> {
    return papersIn(c, stageId);
  }

  /** A Test or Interview stage: every class with its paper, the other marks stages, and quick picks. */
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
      const subjects = await c.query<{ name: string }>(
        `SELECT DISTINCT name FROM subjects WHERE status = 'active' AND kind::text = 'scholastic' ORDER BY name LIMIT 60`,
      );
      return {
        stage,
        stages: stages.rows,
        classes: classes.rows.map((k) => ({ ...k, paper: papers.get(k.id) ?? null })),
        picks:
          stage.kind === 'test'
            ? [...new Set([...subjects.rows.map((x) => x.name), ...TEST_PICKS])]
            : INTERVIEW_PICKS,
      };
    });
  }

  /** Saves a class's paper: parts kept by id, new ones added, the rest switched off; none: no paper. */
  async save(ctx: RequestContext, stageId: string, classId: string, dto: PaperDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stage = await this.stageOf(c, stageId);
      const className = await this.classOf(c, classId);
      await this.saveIn(c, ctx, stage.id, classId, dto);
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.paper',
        entityType: 'admission_stages',
        entityId: stage.id,
        after: {
          class: className,
          minPercent: dto.minPercent ?? null,
          parts: dto.parts.map((p) => `${p.name} ${String(p.maxMarks)}`),
        },
      });
      return { paper: (await this.papersIn(c, stage.id)).get(classId) ?? null };
    });
  }

  private async saveIn(
    c: PoolClient,
    ctx: RequestContext,
    stageId: string,
    classId: string,
    dto: PaperDto,
  ) {
    const names = new Set<string>();
    for (const p of dto.parts) {
      const k = p.name.trim().toLowerCase();
      if (names.has(k))
        throw new DomainError('validation-failed', `Two parts are called ${p.name.trim()}`, {
          status: 400,
        });
      names.add(k);
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
      for (const [i, p] of dto.parts.entries()) {
        const fields = [p.name.trim(), p.maxMarks, p.passMarks ?? null, i];
        const done = p.id
          ? await c.query(
              `UPDATE admission_paper_parts SET name = $3, max_marks = $4, pass_marks = $5, sort_order = $6, status = 'active'
                WHERE id = $1 AND paper_id = $2`,
              [p.id, paperId, ...fields],
            )
          : null;
        if (!done?.rowCount)
          await c.query(
            `INSERT INTO admission_paper_parts (school_id, paper_id, name, max_marks, pass_marks, sort_order)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
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
        await this.saveIn(c, ctx, stage.id, classId, {
          minPercent: from.minPercent,
          parts: from.parts.map((p) => ({
            name: p.name,
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
