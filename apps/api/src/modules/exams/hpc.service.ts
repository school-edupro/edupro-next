import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { STORAGE_DRIVER } from '../files/storage';
import { ExamEntryService, INDICATORS } from './exam-entry.service';
import {
  EXAMS,
  type AddPortfolioDto,
  type PortfolioQueryDto,
  type PutHpcFeedbackDto,
  type PutMyFeedbackDto,
} from './exams.dto';
import { hpcPresetSet } from './hpc-preset';

const MAX_PHOTOS = 12;

/**
 * The Holistic Progress Card for Balvatika to Class II (docs/design/65, part 5): besides the levels of
 * the class's HPC set, the child's own words ("All about me", written down by the teacher), the
 * parent's (by the teacher from paper, or by the parent in the parent app) and the teacher's, and
 * portfolio photos. All of it follows the indicators' entry rule and lock of the exam's class.
 */
@Injectable()
export class HpcService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly entry: ExamEntryService,
    private readonly viewer: ViewerService,
    private readonly scopes: ScopePolicy,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** The NCERT foundational-stage set (editable after); a set the school already has stays. */
  async installPreset(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const preset = hpcPresetSet();
      const had = await c.query<{ id: string }>(
        `SELECT id::text FROM indicator_sets WHERE code = $1 AND deleted_at IS NULL`,
        [preset.code],
      );
      const id = had.rows[0]?.id ?? (await this.entry.writeSet(c, preset));
      if (!had.rows[0])
        await this.audit.stage(ctx, c, {
          action: 'exams.indicator_set.hpc',
          entityType: 'indicator_sets',
          entityId: id,
          after: { code: preset.code, items: preset.indicators.length },
        });
      return { id, installed: !had.rows[0] };
    });
  }

  /** The section's entry right, the exam's lock and the class's HPC set. */
  private async open(c: PoolClient, ctx: RequestContext, examId: string, sectionId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    const exam = await this.entry.exam(c, examId, yearId);
    const section = await this.entry.section(c, sectionId, yearId, examId);
    await this.entry.assertMayEnter(c, tenant, yearId, section.id, INDICATORS);
    if (exam.marks_locked)
      throw new DomainError('exams.entry_locked', 'The exam is locked', { status: 409 });
    await this.entry.assertTypeOpen(c, examId, section.class_id, INDICATORS);
    await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
    await this.assertHpc(c, examId, section.class_id);
    return { yearId, section, roster: await this.entry.roster(c, yearId, section.id) };
  }

  private async assertHpc(c: PoolClient, examId: string, classId: string) {
    const set = await this.entry.classSet(c, examId, classId);
    if (set?.kind !== 'hpc')
      throw new DomainError(
        'exams.no_hpc',
        'The class does not use a holistic progress card in this exam',
        { status: 409 },
      );
    return set;
  }

  async putFeedback(ctx: RequestContext, examId: string, dto: PutHpcFeedbackDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { section, roster } = await this.open(c, ctx, examId, dto.classSectionId);
      this.entry.assertRoster(dto.rows, roster);
      let n = 0;
      for (const r of dto.rows) {
        const text = r.text?.trim() || null;
        // what a parent wrote in the app stays theirs
        const mine = await c.query<{ by_family: boolean }>(
          `SELECT by_family FROM hpc_feedback WHERE exam_id = $1 AND student_id = $2 AND kind = $3`,
          [examId, r.studentId, r.kind],
        );
        if (mine.rows[0]?.by_family)
          throw new DomainError(
            'exams.feedback_by_family',
            'The parent wrote this feedback in the parent app: it is kept as they wrote it',
            { status: 409, extra: { studentId: r.studentId } },
          );
        if (!text) {
          const d = await c.query(
            `DELETE FROM hpc_feedback WHERE exam_id = $1 AND student_id = $2 AND kind = $3`,
            [examId, r.studentId, r.kind],
          );
          n += d.rowCount ?? 0;
          continue;
        }
        const u = await c.query(
          `INSERT INTO hpc_feedback (school_id, exam_id, student_id, kind, text, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT (exam_id, student_id, kind) DO UPDATE SET text = EXCLUDED.text, entered_by = app.current_user_id(), updated_at = now()
           WHERE hpc_feedback.text <> EXCLUDED.text`,
          [examId, r.studentId, r.kind, text],
        );
        n += u.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.hpc.feedback',
        entityType: 'exams',
        entityId: examId,
        after: { classSectionId: section.id, rows: dto.rows.length, changed: n },
      });
      return { changed: n };
    });
  }

  // ---- portfolio --------------------------------------------------------------------------------
  async portfolio(ctx: RequestContext, examId: string, q: PortfolioQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      const section = await this.entry.section(c, q.classSectionId, yearId, examId);
      const ids = (await this.entry.roster(c, yearId, section.id))
        .map((r) => r.studentId)
        .filter((id) => !q.studentId || id === q.studentId);
      const r = await c.query<{
        id: string;
        student_id: string;
        caption: string | null;
        indicator_id: string | null;
        indicator: string | null;
        created_at: Date;
      }>(
        `SELECT p.id::text, p.student_id::text, p.caption, p.indicator_id::text, i.name AS indicator, p.created_at
           FROM portfolio_items p LEFT JOIN indicators i ON i.id = p.indicator_id
          WHERE p.exam_id = $1 AND p.student_id = ANY($2::bigint[]) AND p.deleted_at IS NULL
          ORDER BY p.student_id, p.created_at`,
        [examId, ids],
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          studentId: x.student_id,
          caption: x.caption,
          indicatorId: x.indicator_id,
          indicator: x.indicator,
          createdAt: x.created_at.toISOString(),
        })),
      };
    });
  }

  async addPhoto(ctx: RequestContext, examId: string, dto: AddPortfolioDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const { section, roster } = await this.open(c, ctx, examId, dto.classSectionId);
      this.entry.assertRoster([dto], roster);
      const set = await this.assertHpc(c, examId, section.class_id);
      if (dto.indicatorId && !set.indicators.some((i) => i.id === dto.indicatorId))
        throw new DomainError('exams.indicator_not_in_set', 'Indicator is not in the class set', {
          status: 409,
        });
      const n = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM portfolio_items WHERE exam_id = $1 AND student_id = $2 AND deleted_at IS NULL`,
        [examId, dto.studentId],
      );
      if ((n.rows[0]?.n ?? 0) >= MAX_PHOTOS)
        throw new DomainError(
          'exams.portfolio_full',
          `A child has up to ${MAX_PHOTOS} photos in an exam: remove one first`,
          { status: 409 },
        );
      const bytes = Buffer.from(dto.image.base64, 'base64');
      if (bytes.length > 1_000_000)
        throw new DomainError('validation-failed', 'The photo is larger than 1 MB', {
          status: 400,
        });
      const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const jpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
      if (
        (dto.image.contentType === 'image/png' && !png) ||
        (dto.image.contentType === 'image/jpeg' && !jpg)
      )
        throw new DomainError('validation-failed', 'The photo is not a PNG or JPEG', {
          status: 400,
        });
      const key = objectKeyFor(
        tenant.schoolId,
        png ? 'png' : 'jpg',
        `portfolio-${randomBytes(8).toString('hex')}`,
      );
      await this.storage.write(key, bytes, dto.image.contentType);
      const file = await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                            classification, storage_driver, status, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, 'portfolio', 'portfolio_item', 'personal', $6, 'ready',
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          this.storage.bucket,
          key,
          dto.image.contentType,
          bytes.length,
          createHash('sha256').update(bytes).digest('hex'),
          this.storage.name,
        ],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO portfolio_items (school_id, exam_id, student_id, file_id, caption, indicator_id, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id()) RETURNING id::text`,
        [
          examId,
          dto.studentId,
          file.rows[0]!.id,
          dto.caption?.trim() || null,
          dto.indicatorId ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.hpc.photo_add',
        entityType: 'portfolio_items',
        entityId: r.rows[0]!.id,
        after: { examId, studentId: dto.studentId, indicatorId: dto.indicatorId ?? null },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async removePhoto(ctx: RequestContext, examId: string, itemId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const it = await c.query<{ student_id: string; class_section_id: string | null }>(
        `SELECT p.student_id::text, e.class_section_id::text FROM portfolio_items p
           JOIN exams x ON x.id = p.exam_id
           LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = x.academic_year_id AND e.status = 'active'
          WHERE p.id = $1 AND p.exam_id = $2 AND p.deleted_at IS NULL`,
        [itemId, examId],
      );
      const row = it.rows[0];
      if (!row?.class_section_id) throw new DomainError('not-found', 'Photo not found');
      await this.open(c, ctx, examId, row.class_section_id);
      await c.query(`UPDATE portfolio_items SET deleted_at = now() WHERE id = $1`, [itemId]);
      await this.audit.stage(ctx, c, {
        action: 'exams.hpc.photo_remove',
        entityType: 'portfolio_items',
        entityId: itemId,
        after: { examId, studentId: row.student_id },
      });
      return { ok: true };
    });
  }

  /** The photo itself (view, download): staff who read the section's marks. */
  async photo(ctx: RequestContext, examId: string, itemId: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        object_key: string;
        content_type: string;
        class_section_id: string | null;
      }>(
        `SELECT f.object_key, f.content_type, e.class_section_id::text
           FROM portfolio_items p JOIN files f ON f.id = p.file_id AND f.deleted_at IS NULL
           JOIN exams x ON x.id = p.exam_id
           LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = x.academic_year_id AND e.status = 'active'
          WHERE p.id = $1 AND p.exam_id = $2 AND p.deleted_at IS NULL`,
        [itemId, examId],
      );
      const row = r.rows[0];
      if (!row?.class_section_id) throw new DomainError('not-found', 'Photo not found');
      // the same read rule as the indicator sheet
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', row.class_section_id);
      const bytes = await this.storage.read(row.object_key);
      return {
        filename: `portfolio-${itemId}.${row.content_type === 'image/png' ? 'png' : 'jpg'}`,
        contentType: row.content_type,
        base64: bytes.toString('base64'),
      };
    });
  }

  // ---- the parent's own feedback ---------------------------------------------------------------
  private async mineStudent(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, EXAMS.familyFeedback);
    const s = v.kind === 'family' ? v.students.find((x) => x.id === studentId) : undefined;
    if (!s) throw new DomainError('not-found', 'Student not found', { status: 404 });
    return s;
  }

  /** The exams this year whose class uses the HPC: the parent's words, and whether they may write. */
  async myFeedback(ctx: RequestContext, studentId: string) {
    const s = await this.mineStudent(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        exam_id: string;
        code: string;
        name: string;
        open: boolean;
        text: string | null;
        by_family: boolean | null;
      }>(
        `SELECT x.id::text AS exam_id, x.code, x.name,
                NOT x.marks_locked AND NOT ec.indicators_locked AS open, f.text, f.by_family
           FROM exams x
           JOIN class_sections cs ON cs.id = $2
           JOIN exam_classes ec ON ec.exam_id = x.id AND ec.class_id = cs.class_id
           JOIN exam_indicator_sets es ON es.exam_id = x.id AND es.class_id = cs.class_id
           JOIN indicator_sets st ON st.id = es.set_id AND st.kind = 'hpc' AND st.deleted_at IS NULL
           LEFT JOIN hpc_feedback f ON f.exam_id = x.id AND f.student_id = $1 AND f.kind = 'parent'
          WHERE x.academic_year_id = app.current_academic_year_id() AND x.deleted_at IS NULL
          ORDER BY x.starts_on NULLS LAST, x.id`,
        [s.id, s.classSectionId],
      );
      return {
        student: { id: s.id, name: s.name, section: s.section },
        exams: r.rows.map((x) => ({
          examId: x.exam_id,
          code: x.code,
          name: x.name,
          open: x.open,
          text: x.text,
          byFamily: Boolean(x.by_family),
        })),
      };
    });
  }

  async putMyFeedback(ctx: RequestContext, dto: PutMyFeedbackDto) {
    const s = await this.mineStudent(ctx, dto.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const mine = await this.myFeedbackRow(c, s.id, s.classSectionId, dto.examId);
      if (!mine)
        throw new DomainError(
          'not-found',
          'This exam has no holistic progress card for your child',
          {
            status: 404,
          },
        );
      if (!mine.open)
        throw new DomainError(
          'exams.entry_locked',
          'The progress card is closed for changes: please talk to the class teacher',
          { status: 409 },
        );
      await c.query(`SELECT app.assert_year_open($1, 'exams')`, [mine.year_id]);
      await c.query(
        `INSERT INTO hpc_feedback (school_id, exam_id, student_id, kind, text, entered_by, by_family)
         VALUES (app.current_school_id(), $1, $2, 'parent', $3, app.current_user_id(), true)
         ON CONFLICT (exam_id, student_id, kind) DO UPDATE SET text = EXCLUDED.text, entered_by = app.current_user_id(),
           by_family = true, updated_at = now()`,
        [dto.examId, s.id, dto.text.trim()],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.hpc.parent_feedback',
        entityType: 'exams',
        entityId: dto.examId,
        after: { studentId: s.id },
      });
      return { ok: true };
    });
  }

  private async myFeedbackRow(
    c: PoolClient,
    studentId: string,
    sectionId: string | null,
    examId: string,
  ) {
    const r = await c.query<{ open: boolean; year_id: string }>(
      `SELECT NOT x.marks_locked AND NOT ec.indicators_locked AS open, x.academic_year_id::text AS year_id
         FROM exams x
         JOIN class_sections cs ON cs.id = $2
         JOIN exam_classes ec ON ec.exam_id = x.id AND ec.class_id = cs.class_id
         JOIN exam_indicator_sets es ON es.exam_id = x.id AND es.class_id = cs.class_id
         JOIN indicator_sets st ON st.id = es.set_id AND st.kind = 'hpc' AND st.deleted_at IS NULL
        WHERE x.id = $3 AND x.academic_year_id = app.current_academic_year_id() AND x.deleted_at IS NULL
          AND app.student_in_class($1, x.academic_year_id, cs.class_id)`,
      [studentId, sectionId, examId],
    );
    return r.rows[0] ?? null;
  }
}
