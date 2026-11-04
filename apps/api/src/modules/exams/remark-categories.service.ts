import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ExamEntryService, REMARKS, type Kind } from './exam-entry.service';
import {
  EXAMS,
  type EntryQueryDto,
  type PutRemarkItemsDto,
  type SectionSheetUploadDto,
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
  area: 'remarks',
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
    if (cat.subject_id && (await tryKind(SUBJECT_REMARKS, cat.subject_id))) return true;
    return this.mappedTo(c, tenant, yearId, sectionId, cat.id, held);
  }

  /** A Remarks teacher assignment of the section names the category for the caller (docs/design/71). */
  private async mappedTo(
    c: PoolClient,
    tenant: TenantContext,
    yearId: string,
    sectionId: string,
    categoryId: string,
    held: (p: string) => boolean,
  ): Promise<boolean> {
    if (!held(EXAMS.marksEnter) && !held(EXAMS.remarkEnter)) return false;
    const allowed = await this.scopes.filter(tenant, EXAMS.marksEnter, 'class_section');
    if (allowed !== null && !allowed.includes(sectionId)) return false;
    const r = await c.query(
      `SELECT 1 FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL
          AND ta.kind::text = 'remarks' AND $3::bigint = ANY(ta.remark_category_ids)
        LIMIT 1`,
      [sectionId, yearId, categoryId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Who writes each category in the section: the class teacher, its subject's teacher, the teachers named. */
  private async writers(c: PoolClient, yearId: string, sectionId: string, cats: Category[]) {
    const mapped = await c.query<{ name: string; ids: string[] }>(
      `SELECT e.display_name || ' (' || e.employee_code || ')' AS name, ta.remark_category_ids::text[] AS ids
         FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL AND ta.kind::text = 'remarks'
        ORDER BY e.display_name`,
      [sectionId, yearId],
    );
    return new Map(
      cats.map((k) => [
        k.id,
        [
          'Class teacher',
          ...(k.subject_id ? [`${k.subject_name ?? 'Subject'} teacher`] : []),
          ...mapped.rows.filter((m) => m.ids.includes(k.id)).map((m) => m.name),
        ],
      ]),
    );
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
      const by2 = await this.writers(c, yearId, section.id, cats);
      const categories = [];
      for (const k of cats)
        categories.push({
          ...this.shape(k),
          may: await this.may(c, tenant, yearId, section.id, k, held),
          /** who writes it in this section (docs/design/71) */
          writtenBy: by2.get(k.id) ?? [],
          bank: bank.rows
            .filter((b) => b.category_id === k.id)
            .map((b) => ({ code: b.code, text: b.text })),
        });
      const className = (
        await c.query<{ name: string }>(`SELECT name FROM classes WHERE id = $1`, [
          section.class_id,
        ])
      ).rows[0]?.name;
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name },
        section: { id: section.id, code: section.code },
        locked: exam.marks_locked || Boolean(lock.rows[0]?.locked),
        /** why the caller has nothing to write here, if so */
        reason: !categories.length
          ? `No remark category is set for ${className ?? 'this class'} (Exams → Set-up → Remark categories and bank)`
          : !categories.some((k) => k.may)
            ? 'You write no remark category in this section: the class teacher writes them, a subject teacher their subject’s, or a teacher named in Teacher assignments → Remarks'
            : null,
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
            `Only the class teacher${cat.subject_id ? `, the ${cat.subject_name ?? 'subject'} teacher` : ''} or a teacher named in Teacher assignments writes "${cat.name}" in the section`,
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

  // ---- remarks by Excel (docs/design/71) -------------------------------------------------------------
  private remarkColumns(sheet: Awaited<ReturnType<RemarkCategoriesService['items']>>) {
    const cols = sheet.categories
      .filter((k) => k.may)
      .map((k) => ({
        id: k.id,
        header: `${k.code} · ${k.name}`.slice(0, 120),
        name: k.name,
        freeText: k.freeText,
        bank: k.bank,
      }));
    if (!cols.length)
      throw new DomainError('exams.not_assigned', sheet.reason ?? 'You write no remark category', {
        status: 403,
      });
    return cols;
  }

  /** The categories of a section the caller writes, as a sheet to fill (what is written already in it). */
  async itemsExcel(ctx: RequestContext, examId: string, q: EntryQueryDto) {
    const sheet = await this.items(ctx, examId, q);
    const cols = this.remarkColumns(sheet);
    const bytes = await templateSheet({
      sheet: 'Remarks',
      columns: [
        { header: 'Admission no', width: 16, required: true, format: 'text' },
        { header: 'Roll no', width: 8 },
        { header: 'Name', width: 28 },
        ...cols.map((k) => ({
          header: k.header,
          width: 40,
          ...(k.bank.length ? { options: k.bank.map((b) => b.text), allowNew: k.freeText } : {}),
          note: k.freeText
            ? 'Your remark, or one of the list (up to 600 letters)'
            : 'One of the listed remarks only',
        })),
      ],
      guide: [
        `${sheet.exam.name} · ${sheet.section.code}`,
        'One remark per pupil and category. A category that takes its list only accepts a listed remark (or its code).',
        'Leave a cell empty to keep what is written.',
        'Only the categories you write are in the sheet. Do not change the Admission no column; upload the sheet on the remarks page, check, then save.',
      ],
      rows: sheet.rows.map((r) => [
        r.admissionNo,
        r.rollNo,
        r.name,
        ...cols.map((k) => r.items[k.id]?.text ?? null),
      ]),
    });
    return {
      filename: `remarks-${sheet.exam.code}-${sheet.section.code}.xlsx`
        .toLowerCase()
        .replace(/[^\w.-]+/g, '-'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  /** A filled remarks sheet: every cell checked (a listed remark where only the list goes); `apply` saves. */
  async itemsUpload(ctx: RequestContext, examId: string, dto: SectionSheetUploadDto) {
    const sheet = await this.items(ctx, examId, { classSectionId: dto.classSectionId });
    const cols = this.remarkColumns(sheet);
    const rows = await readSheet(
      dto.file,
      ['Admission no'],
      cols.map((k) => k.header),
    );
    const byNo = new Map(sheet.rows.map((r) => [r.admissionNo.trim().toLowerCase(), r]));
    const seen = new Set<string>();
    const checked = rows.map(({ row, cells }) => {
      const no = cells['Admission no']!.trim();
      const student = byNo.get(no.toLowerCase());
      const values: Record<string, string> = {};
      const parsed: Array<{ categoryId: string; text: string; bankCode: string | null }> = [];
      let error: string | null = null;
      if (!student) error = `No student with admission no ${no} in ${sheet.section.code}`;
      else if (seen.has(student.studentId)) error = 'The student is in the sheet twice';
      if (student) seen.add(student.studentId);
      for (const k of cols) {
        const raw = (cells[k.header] ?? '').trim();
        values[k.header] = raw;
        if (raw === '' || error) continue;
        const listed = k.bank.find(
          (b) => b.text === raw || b.code.toLowerCase() === raw.toLowerCase(),
        );
        if (listed) parsed.push({ categoryId: k.id, text: listed.text, bankCode: listed.code });
        else if (!k.freeText) error = `${k.name}: takes one of its listed remarks only`;
        else if (raw.length > 600) error = `${k.name}: more than 600 letters`;
        else parsed.push({ categoryId: k.id, text: raw, bankCode: null });
      }
      return { row, admissionNo: no, name: student?.name ?? null, student, values, parsed, error };
    });
    const errors = checked.filter((x) => x.error).length;
    const preview = {
      columns: cols.map((k) => k.header),
      rows: checked.map((x) => ({
        row: x.row,
        admissionNo: x.admissionNo,
        name: x.name,
        values: x.values,
        error: x.error,
      })),
      ready: checked.filter((x) => !x.error && x.parsed.length).length,
      errors,
      applied: false,
    };
    if (!dto.apply || errors || !preview.ready) return preview;
    const all = checked.flatMap((x) =>
      x.parsed.map((v) => ({ studentId: x.student!.studentId, ...v })),
    );
    for (let i = 0; i < all.length; i += 3000)
      await this.putItems(ctx, examId, {
        classSectionId: dto.classSectionId,
        rows: all.slice(i, i + 3000),
      });
    return { ...preview, applied: true };
  }
}
