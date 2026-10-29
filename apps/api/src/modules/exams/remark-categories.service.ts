import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ExamEntryService, REMARKS, type Kind } from './exam-entry.service';
import {
  EXAMS,
  type EntryQueryDto,
  type PutRemarkItemsDto,
  type UpsertRemarkCategoryDto,
} from './exams.dto';

interface Category {
  id: string;
  code: string;
  name: string;
  subject_id: string | null;
  subject_name: string | null;
  class_ids: string[];
  free_text: boolean;
  sort_order: number;
  status: string;
}

/** A subject's remarks: its subject teacher writes them for their sections (as marks). */
const SUBJECT_REMARKS: Kind = {
  permission: EXAMS.marksEnter,
  subjectAware: true,
  lock: 'remarks_locked',
  label: 'Remarks',
};

/**
 * Remark categories (docs/design/65, part 7), as the old module's A / B / C / D lists and its "any
 * other" text: the school names a category, ties it to a subject or not, to some classes or every
 * class, and lets it take free text or only the bank's remarks of the category. A student gets one
 * remark per category in an exam: the class teacher (or a coordinator) writes every category; a
 * subject teacher writes the category of their subject for their sections. The remarks lock of the
 * exam's class closes it.
 */
@Injectable()
export class RemarkCategoriesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly entry: ExamEntryService,
  ) {}

  private shape(r: Category) {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      subjectId: r.subject_id,
      subjectName: r.subject_name,
      classIds: r.class_ids,
      freeText: r.free_text,
      sortOrder: r.sort_order,
      status: r.status,
    };
  }

  private async categories(c: PoolClient, classId?: string) {
    return (
      await c.query<Category>(
        `SELECT rc.id::text, rc.code, rc.name, rc.subject_id::text, sub.name AS subject_name, rc.class_ids::text[] AS class_ids,
                rc.free_text, rc.sort_order, rc.status::text
           FROM remark_categories rc LEFT JOIN subjects sub ON sub.id = rc.subject_id
          WHERE ($1::bigint IS NULL OR (rc.status = 'active' AND (cardinality(rc.class_ids) = 0 OR $1::bigint = ANY(rc.class_ids))))
          ORDER BY rc.sort_order, rc.code`,
        [classId ?? null],
      )
    ).rows;
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      data: (await this.categories(c)).map((r) => this.shape(r)),
    }));
  }

  async upsert(ctx: RequestContext, dto: UpsertRemarkCategoryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO remark_categories (school_id, code, name, subject_id, class_ids, free_text, sort_order, status, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::bigint[], $5, $6, $7::row_status, app.current_user_id())
         ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, subject_id = EXCLUDED.subject_id,
           class_ids = EXCLUDED.class_ids, free_text = EXCLUDED.free_text, sort_order = EXCLUDED.sort_order,
           status = EXCLUDED.status, updated_at = now(), updated_by = app.current_user_id()
         RETURNING id::text`,
        [
          dto.code,
          dto.name,
          dto.subjectId ?? null,
          dto.classIds,
          dto.freeText,
          dto.sortOrder,
          dto.status,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.remark_category.upsert',
        entityType: 'remark_categories',
        entityId: r.rows[0]!.id,
        after: { code: dto.code, name: dto.name, subjectId: dto.subjectId ?? null },
      });
      return { data: (await this.categories(c)).map((x) => this.shape(x)) };
    });
  }

  /** May the caller write this category for the section: the class's remarks right, or its subject's. */
  private async may(
    c: PoolClient,
    tenant: TenantContext,
    yearId: string,
    sectionId: string,
    cat: Category,
    held: (p: string) => boolean,
  ): Promise<boolean> {
    const tryKind = async (kind: Kind, subjectId?: string) => {
      if (!held(kind.permission)) return false;
      try {
        await this.entry.assertMayEnter(c, tenant, yearId, sectionId, kind, subjectId);
        return true;
      } catch (e) {
        if (e instanceof DomainError) return false;
        throw e;
      }
    };
    if (await tryKind(REMARKS)) return true;
    return cat.subject_id ? tryKind(SUBJECT_REMARKS, cat.subject_id) : false;
  }

  async items(ctx: RequestContext, examId: string, q: EntryQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    const held = (p: string) => ctx.permissions?.has(p) ?? false;
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.entry.exam(c, examId, yearId);
      const section = await this.entry.section(c, q.classSectionId, yearId, examId);
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', section.id);
      const cats = await this.categories(c, section.class_id);
      const bank = await c.query<{ category_id: string; code: string; text: string }>(
        `SELECT category_id::text, code, text FROM remark_bank
          WHERE status = 'active' AND category_id IS NOT NULL AND (class_id IS NULL OR class_id = $1)
          ORDER BY sort_order, code`,
        [section.class_id],
      );
      const lock = await c.query<{ locked: boolean }>(
        `SELECT remarks_locked AS locked FROM exam_classes WHERE exam_id = $1 AND class_id = $2`,
        [examId, section.class_id],
      );
      const roster = await this.entry.roster(c, yearId, section.id);
      const saved = await c.query<{
        student_id: string;
        category_id: string;
        text: string;
        bank_code: string | null;
      }>(
        `SELECT student_id::text, category_id::text, text, bank_code FROM exam_remark_items
          WHERE exam_id = $1 AND student_id = ANY($2::bigint[])`,
        [examId, roster.map((r) => r.studentId)],
      );
      const by = new Map<string, Record<string, { text: string; bankCode: string | null }>>();
      for (const x of saved.rows) {
        const m = by.get(x.student_id) ?? {};
        m[x.category_id] = { text: x.text, bankCode: x.bank_code };
        by.set(x.student_id, m);
      }
      const categories = [];
      for (const k of cats)
        categories.push({
          ...this.shape(k),
          may: await this.may(c, tenant, yearId, section.id, k, held),
          bank: bank.rows
            .filter((b) => b.category_id === k.id)
            .map((b) => ({ code: b.code, text: b.text })),
        });
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name },
        section: { id: section.id, code: section.code },
        locked: exam.marks_locked || Boolean(lock.rows[0]?.locked),
        categories,
        rows: roster.map((s) => ({ ...s, items: by.get(s.studentId) ?? {} })),
      };
    });
  }

  async putItems(ctx: RequestContext, examId: string, dto: PutRemarkItemsDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    const held = (p: string) => ctx.permissions?.has(p) ?? false;
    // the class's remarks right, or a subject teacher's marks right (for their subject's category)
    if (!held(EXAMS.remarkEnter) && !held(EXAMS.marksEnter))
      throw new DomainError('forbidden', 'You may not write exam remarks', { status: 403 });
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.entry.exam(c, examId, yearId);
      const section = await this.entry.section(c, dto.classSectionId, yearId, examId);
      if (exam.marks_locked)
        throw new DomainError('exams.entry_locked', 'The exam is locked', { status: 409 });
      await this.entry.assertTypeOpen(c, examId, section.class_id, REMARKS);
      await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
      this.entry.assertRoster(dto.rows, await this.entry.roster(c, yearId, section.id));
      const cats = new Map((await this.categories(c, section.class_id)).map((k) => [k.id, k]));
      const bank = await c.query<{ category_id: string; code: string; text: string }>(
        `SELECT category_id::text, code, text FROM remark_bank
          WHERE status = 'active' AND category_id IS NOT NULL AND (class_id IS NULL OR class_id = $1)`,
        [section.class_id],
      );
      const allowed = new Map<string, boolean>();
      let n = 0;
      for (const r of dto.rows) {
        const cat = cats.get(r.categoryId);
        if (!cat)
          throw new DomainError(
            'exams.remark_category_not_for_class',
            'The remark category is not one of this class',
            { status: 409, extra: { categoryId: r.categoryId } },
          );
        if (!allowed.has(cat.id))
          allowed.set(cat.id, await this.may(c, tenant, yearId, section.id, cat, held));
        if (!allowed.get(cat.id))
          throw new DomainError(
            'exams.not_assigned',
            `Only the class teacher${cat.subject_id ? ` or the ${cat.subject_name ?? 'subject'} teacher` : ''} of the section writes "${cat.name}"`,
            { status: 403, extra: { categoryId: cat.id } },
          );
        const fromBank = r.bankCode
          ? bank.rows.find((b) => b.category_id === cat.id && b.code === r.bankCode)
          : undefined;
        if (r.bankCode && !fromBank)
          throw new DomainError(
            'exams.remark_not_in_bank',
            'The remark is not in the category’s list',
            {
              status: 409,
              extra: { bankCode: r.bankCode },
            },
          );
        const text = r.text?.trim() || fromBank?.text || null;
        if (
          text &&
          !cat.free_text &&
          !bank.rows.some((b) => b.category_id === cat.id && b.text === text)
        )
          throw new DomainError(
            'exams.remark_list_only',
            `"${cat.name}" takes one of its listed remarks only`,
            { status: 409, extra: { categoryId: cat.id, studentId: r.studentId } },
          );
        if (!text) {
          const d = await c.query(
            `DELETE FROM exam_remark_items WHERE exam_id = $1 AND student_id = $2 AND category_id = $3`,
            [examId, r.studentId, cat.id],
          );
          n += d.rowCount ?? 0;
          continue;
        }
        const code =
          fromBank?.code ??
          bank.rows.find((b) => b.category_id === cat.id && b.text === text)?.code ??
          null;
        const u = await c.query(
          `INSERT INTO exam_remark_items (school_id, exam_id, student_id, category_id, text, bank_code, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
           ON CONFLICT (exam_id, student_id, category_id) DO UPDATE SET text = EXCLUDED.text, bank_code = EXCLUDED.bank_code,
             entered_by = app.current_user_id(), updated_at = now()
           WHERE exam_remark_items.text <> EXCLUDED.text OR exam_remark_items.bank_code IS DISTINCT FROM EXCLUDED.bank_code`,
          [examId, r.studentId, cat.id, text, code],
        );
        n += u.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.remark_items.enter',
        entityType: 'exams',
        entityId: examId,
        after: { classSectionId: section.id, rows: dto.rows.length, changed: n },
      });
      return { changed: n };
    });
  }
}
