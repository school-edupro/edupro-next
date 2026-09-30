import { Injectable } from '@nestjs/common';
import {
  EDITABLE_PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  ProfileWriteError,
  QUICK_ADD_KEYS,
  decryptField,
  encryptField,
  loadProfileLists,
  maskValue,
  optionsOf,
  readStudentProfile,
  refreshCompleteness,
  validateChanges,
  writeStudentProfile,
  type PoolClient,
  type ProfileField,
  type ProfileValue,
} from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readFile, type Cell } from '../masters/masters.service';
import type { BulkTemplateQueryDto, BulkUploadDto } from './people.dto';
import { PEOPLE } from './people.permissions';
import { StudentsService } from './students.service';

export type BulkMode = 'update' | 'create';
const IMPORT_NAME: Record<BulkMode, string> = {
  update: 'student_profile_update',
  create: 'student_profile_create',
};
const MAX_ROWS = 5000;
/** Typed into a cell to empty that field on purpose (a blank cell means "no change"). */
export const CLEAR_WORD = 'CLEAR';
const SECTION_COLUMN = { key: 'class_section', label: 'Class-Section' };
const NAME_COLUMN = { key: 'student_name', label: 'Student Name (reference)' };
/** Separate Class and Section columns (the data collection workbook). */
const CLASS_COLUMN = '__class';
const SECTION_ONLY = '__section';

export interface PayloadRow {
  row: number;
  admissionNo: string;
  name: string;
  studentId?: string;
  classSectionId?: string;
  rollNo?: number;
  /** Values to write; sensitive ones stored encrypted (`enc:` prefix) until commit. */
  values: Record<string, ProfileValue>;
  /** For the preview: from / to per changed key, sensitive values masked. */
  changes: Record<string, { from: ProfileValue; to: ProfileValue }>;
}
export interface Problem {
  row: number;
  admissionNo?: string;
  column: string;
  message: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === 'boolean') return c ? 'Yes' : 'No';
  return String(c).trim();
}

/**
 * Student profiles in bulk from Excel: a template pre-filled with current values (update) or empty
 * (create), a validate step that shows every change as old → new and every bad cell with the reason,
 * and a commit that applies only the valid rows, each in its own savepoint, audited per student.
 */
@Injectable()
export class StudentBulkService {
  constructor(
    private readonly db: DbService,
    private readonly students: StudentsService,
    private readonly audit: AuditService,
  ) {}

  private assertAllowed(ctx: RequestContext, mode: BulkMode) {
    const need = mode === 'update' ? PEOPLE.studentEdit : PEOPLE.studentCreate;
    if (!ctx.permissions?.has(need) || !ctx.permissions.has(PEOPLE.importRun))
      throw new DomainError('forbidden', 'You cannot run this upload', { status: 403 });
  }

  private columnsFor(mode: BulkMode, keys?: string[]): ProfileField[] {
    const chosen = keys?.length
      ? EDITABLE_PROFILE_FIELDS.filter((f) => keys.includes(f.key))
      : EDITABLE_PROFILE_FIELDS;
    if (mode === 'update') return chosen.filter((f) => f.key !== 'admission_no');
    // create: the quick-add fields first, then the rest in catalogue order
    const quick = QUICK_ADD_KEYS.map((k) => PROFILE_FIELD_BY_KEY.get(k)!).filter(
      (f) => f.key !== 'admission_no',
    );
    return [...quick, ...chosen.filter((f) => !quick.includes(f) && f.key !== 'admission_no')];
  }

  /** The Excel template: instructions, drop-down lists and (update) the current values. */
  async template(
    ctx: RequestContext,
    q: BulkTemplateQueryDto,
  ): Promise<{ fileName: string; bytes: Buffer }> {
    this.assertAllowed(ctx, q.mode);
    const tenant = requireTenant(ctx);
    const keys = q.fields
      ? q.fields
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : undefined;
    const unknown = (keys ?? []).filter((k) => !PROFILE_FIELD_BY_KEY.has(k));
    if (unknown.length)
      throw new DomainError('validation-failed', `Unknown field(s): ${unknown.join(', ')}`, {
        status: 400,
      });
    const cols = this.columnsFor(q.mode, keys);
    return this.db.tenant(tenant, async (c) => {
      const lists = await loadProfileLists(c);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      const info = wb.addWorksheet('Instructions');
      const lines = [
        q.mode === 'update'
          ? 'Update students by admission number'
          : 'Add new students (one per row)',
        '',
        q.mode === 'update'
          ? '1. Admission No identifies the student. Do not change it.'
          : '1. Admission No, Class-Section (e.g. VI-A) and the columns marked * are required.',
        '2. Only the columns in the file are touched. A blank cell means "no change".',
        `3. Type ${CLEAR_WORD} in a cell to empty that field on purpose.`,
        '4. Dates as DD-MM-YYYY. Mobile numbers as 10 digits. Use the drop-downs for list columns.',
        '5. Aadhaar, PAN and bank account numbers are not pre-filled; type a number only to replace it.',
        '6. You may delete columns you do not need, but keep the header row as it is.',
        '7. Upload the file on People → Students → Bulk update; check the preview, then commit.',
      ];
      lines.forEach((l, i) => {
        info.getCell(i + 1, 1).value = l;
      });
      info.getCell(1, 1).font = { bold: true, size: 14 };
      info.getColumn(1).width = 110;

      const listSheet = wb.addWorksheet('Lists', { state: 'hidden' });
      const listRef = new Map<string, string>();
      const listCodes = [
        ...new Set(cols.map((f) => f.list).filter((l): l is string => Boolean(l))),
      ];
      listCodes.forEach((code, i) => {
        const opts = optionsOf(
          cols.find((f) => f.list === code)!,
          lists,
        );
        const col = listSheet.getColumn(i + 1);
        listSheet.getCell(1, i + 1).value = code;
        opts.forEach((o, j) => {
          listSheet.getCell(j + 2, i + 1).value = o;
        });
        const letter = col.letter;
        listRef.set(code, `Lists!$${letter}$2:$${letter}$${String(Math.max(opts.length + 1, 2))}`);
      });

      const ws = wb.addWorksheet('Students', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
      });
      const header = [
        { key: 'admission_no', label: 'Admission No', required: true },
        ...(q.mode === 'update'
          ? [{ key: NAME_COLUMN.key, label: NAME_COLUMN.label, required: false }]
          : [
              { key: SECTION_COLUMN.key, label: SECTION_COLUMN.label, required: true },
              { key: 'roll_no', label: 'Roll No', required: false },
            ]),
        ...cols.map((f) => ({
          key: f.key,
          label: f.label,
          required:
            q.mode === 'create' &&
            (QUICK_ADD_KEYS as readonly string[]).includes(f.key) &&
            !['last_name', 'father_name', 'mother_name', 'admitted_on'].includes(f.key),
        })),
      ];
      header.forEach((h, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.value = h.required ? `${h.label} *` : h.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A4A' } };
        cell.alignment = { wrapText: true, vertical: 'middle' };
        const f = PROFILE_FIELD_BY_KEY.get(h.key);
        if (f?.help || f?.sensitive)
          cell.note = [
            f.help,
            f.sensitive ? 'Not pre-filled; type a number only to replace it.' : null,
          ]
            .filter(Boolean)
            .join(' ');
        ws.getColumn(i + 1).width = Math.min(Math.max(h.label.length + 4, 14), 36);
      });
      ws.getRow(1).height = 32;

      if (q.mode === 'update') {
        const params: unknown[] = [tenant.academicYearId ?? null];
        let where = '';
        if (q.classSectionId) {
          params.push(q.classSectionId);
          where = ' AND e.class_section_id = $2';
        }
        const ids = await c.query<{ id: string }>(
          // eslint-disable-next-line no-restricted-syntax -- where is a fixed fragment; values are bound
          `SELECT s.id::text FROM students s
             JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $1 AND e.status = 'active'
            WHERE s.deleted_at IS NULL AND s.status = 'active'${where}
            ORDER BY e.class_section_id, e.roll_no NULLS LAST, s.display_name
            LIMIT ${String(MAX_ROWS)}`,
          params,
        );
        let r = 2;
        for (const { id } of ids.rows) {
          const snap = await readStudentProfile(c, id, { showSensitive: false });
          if (!snap) continue;
          ws.getCell(r, 1).value = snap.admissionNo;
          ws.getCell(r, 2).value = snap.displayName;
          cols.forEach((f, i) => {
            const v = snap.values[f.key];
            if (v === null || v === undefined || f.sensitive) return;
            ws.getCell(r, i + 3).value =
              f.type === 'date' && typeof v === 'string'
                ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`
                : v;
          });
          r += 1;
        }
      }
      // drop-downs and text format for every data row we allow
      const lastRow = MAX_ROWS + 1;
      header.forEach((h, i) => {
        const f = PROFILE_FIELD_BY_KEY.get(h.key);
        const col = ws.getColumn(i + 1);
        col.numFmt = '@'; // keep leading zeros in numbers such as Aadhaar and PIN
        if (f?.list && listRef.has(f.list)) {
          for (let r = 2; r <= Math.min(lastRow, 1001); r += 1)
            ws.getCell(r, i + 1).dataValidation = {
              type: 'list',
              allowBlank: true,
              formulae: [listRef.get(f.list)!],
              showErrorMessage: false,
            };
        }
      });
      const bytes = Buffer.from(await wb.xlsx.writeBuffer());
      const stamp = new Date().toISOString().slice(0, 10);
      return { fileName: `students-${q.mode}-${stamp}.xlsx`, bytes };
    });
  }

  /** Dry run: parse, match, validate, compute the diff; keeps the result for commit. */
  async validate(ctx: RequestContext, dto: BulkUploadDto) {
    this.assertAllowed(ctx, dto.mode);
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('validation-failed', 'Select an academic year first', { status: 400 });
    // our template ('Students') or the data collection workbook ('Student Data Entry', whose field names
    // sit in row 2 under a section band)
    const { header, rows, rowNumbers } = await readFile(dto, {
      sheets: ['Students', 'Student Data Entry'],
      isHeader: (cells) => cells.some((h) => norm(h.replace(/\*/g, '')) === 'admissionno'),
    });
    if (rows.length === 0)
      throw new DomainError('validation-failed', 'The file has no data rows', { status: 400 });
    if (rows.length > MAX_ROWS)
      throw new DomainError('validation-failed', `At most ${String(MAX_ROWS)} rows per upload`, {
        status: 400,
      });

    // header → key: accepts the label (with or without *) or the key itself
    const byLabel = new Map<string, string>();
    for (const f of EDITABLE_PROFILE_FIELDS) {
      byLabel.set(norm(f.label), f.key);
      byLabel.set(norm(f.key), f.key);
    }
    byLabel.set(norm(SECTION_COLUMN.label), SECTION_COLUMN.key);
    byLabel.set(norm('Class Section'), SECTION_COLUMN.key);
    byLabel.set(norm(NAME_COLUMN.label), NAME_COLUMN.key);
    byLabel.set(norm('Roll No'), 'roll_no');
    byLabel.set(norm('Class'), CLASS_COLUMN);
    byLabel.set(norm('Section'), SECTION_ONLY);
    const colKey: Array<string | null> = header.map(
      (h) => byLabel.get(norm(h.replace(/\*/g, ''))) ?? null,
    );
    const ignored = header
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => h.trim() && colKey[i] === null && !/^s\.?\s*no\.?$/i.test(h.trim()))
      .map(({ h }) => h);
    const has = (k: string) => colKey.includes(k);
    if (!has('admission_no'))
      throw new DomainError('validation-failed', 'The file needs an "Admission No" column', {
        status: 400,
      });
    if (dto.mode === 'create' && !has(SECTION_COLUMN.key) && !has(CLASS_COLUMN))
      throw new DomainError(
        'validation-failed',
        'The file needs a "Class-Section" column (e.g. VI-A), or "Class" and "Section" columns',
        { status: 400 },
      );

    return this.db.tenant(tenant, async (c) => {
      const lists = await loadProfileLists(c);
      const existing = new Map<string, string>();
      const ex = await c.query<{ id: string; admission_no: string }>(
        'SELECT id::text, admission_no FROM students WHERE deleted_at IS NULL',
      );
      for (const x of ex.rows) existing.set(x.admission_no.toUpperCase(), x.id);
      const sections = new Map<string, string>();
      const sec = await c.query<{ label: string; id: string }>(
        `SELECT c.code || '-' || cs.name AS label, cs.id::text AS id FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL`,
        [tenant.academicYearId],
      );
      for (const x of sec.rows) sections.set(norm(x.label), x.id);
      // class by code or name ("VI", "Class VI", "Nursery") → its sections of the year
      const byClass = new Map<string, Array<{ name: string; id: string }>>();
      const cls = await c.query<{ code: string; name: string; section: string; id: string }>(
        `SELECT c.code, c.name, cs.name AS section, cs.id::text AS id FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL`,
        [tenant.academicYearId],
      );
      for (const x of cls.rows)
        for (const k of new Set([
          norm(x.code),
          norm(x.name),
          norm(x.name.replace(/^class\s+/i, '')),
        ]))
          byClass.set(k, [...(byClass.get(k) ?? []), { name: x.section, id: x.id }]);

      const problems: Problem[] = [];
      const payload: PayloadRow[] = [];
      const seen = new Set<string>();
      let unchanged = 0;
      let counted = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const rowNo = rowNumbers[i] ?? i + 2;
        const cells = rows[i]!;
        const raw: Record<string, string | null> = {};
        let admissionNo = '';
        let sectionLabel = '';
        let className = '';
        let sectionOnly = '';
        let rollText = '';
        colKey.forEach((k, ci) => {
          if (!k) return;
          const t = cellText(cells[ci] ?? null);
          if (k === 'admission_no') admissionNo = t;
          else if (k === SECTION_COLUMN.key) sectionLabel = t;
          else if (k === CLASS_COLUMN) className = t;
          else if (k === SECTION_ONLY) sectionOnly = t;
          else if (k === 'roll_no') rollText = t;
          else if (k === NAME_COLUMN.key) return;
          else if (t.toUpperCase() === CLEAR_WORD) raw[k] = null;
          else if (t !== '') {
            const f = PROFILE_FIELD_BY_KEY.get(k);
            // a masked number coming back from a template means "no change"
            if (f?.sensitive && /^X{2,}/i.test(t)) return;
            raw[k] = t;
          }
        });
        if (!admissionNo && !sectionLabel && !className && !Object.keys(raw).length) continue;
        counted += 1;
        const rowProblems: Problem[] = [];
        const bad = (column: string, message: string) =>
          rowProblems.push({ row: rowNo, admissionNo: admissionNo || undefined, column, message });
        if (!admissionNo)
          bad(
            'Admission No',
            raw.registration_no
              ? `no admission number yet (registration ${String(raw.registration_no)}); add it once the student is admitted`
              : 'is required',
          );
        const key = admissionNo.toUpperCase();
        if (admissionNo && seen.has(key)) bad('Admission No', 'appears twice in this file');
        seen.add(key);
        const studentId = existing.get(key);
        if (dto.mode === 'update' && admissionNo && !studentId)
          bad('Admission No', 'no student with this admission number');
        if (dto.mode === 'create' && studentId)
          bad('Admission No', 'already exists; use Bulk update for existing students');
        let classSectionId: string | undefined;
        let rollNo: number | undefined;
        if (dto.mode === 'create') {
          if (sectionLabel) {
            classSectionId = sections.get(norm(sectionLabel));
            if (!classSectionId)
              bad(SECTION_COLUMN.label, `no section "${sectionLabel}" in the working year`);
          } else if (className) {
            const options = byClass.get(norm(className)) ?? [];
            const pick = sectionOnly
              ? options.find((o) => norm(o.name) === norm(sectionOnly))
              : options.length === 1
                ? options[0]
                : undefined;
            classSectionId = pick?.id;
            if (!options.length) bad('Class', `no class "${className}" in the working year`);
            else if (!pick)
              bad(
                'Section',
                sectionOnly
                  ? `class ${className} has no section "${sectionOnly}" (sections: ${options.map((o) => o.name).join(', ')})`
                  : `class ${className} has ${String(options.length)} sections; fill the Section column`,
              );
          } else bad(SECTION_COLUMN.label, 'is required, e.g. VI-A');
        }
        if (rollText) {
          const n = Number(rollText);
          if (!Number.isInteger(n) || n < 1 || n > 999)
            bad('Roll No', 'a whole number from 1 to 999');
          else rollNo = n;
        }
        const { values, errors } = validateChanges(raw, lists);
        for (const [k, msg] of Object.entries(errors))
          bad(PROFILE_FIELD_BY_KEY.get(k)?.label ?? k, msg.replace(/^[^:]+: /, ''));
        if (dto.mode === 'create') {
          for (const k of QUICK_ADD_KEYS) {
            if (
              ['admission_no', 'last_name', 'father_name', 'mother_name', 'admitted_on'].includes(k)
            )
              continue;
            if (values[k] === null || values[k] === undefined)
              bad(PROFILE_FIELD_BY_KEY.get(k)!.label, 'is required');
          }
          if (!values.father_name && !values.mother_name)
            bad("Father's Name", "father's or mother's name is required");
        }
        if (rowProblems.length) {
          problems.push(...rowProblems);
          continue;
        }
        // diff against the current profile (update); every value is new (create)
        const changes: PayloadRow['changes'] = {};
        let name = '';
        if (dto.mode === 'update') {
          const snap = await readStudentProfile(c, studentId!, { showSensitive: false });
          name = snap?.displayName ?? '';
          for (const [k, to] of Object.entries(values)) {
            const f = PROFILE_FIELD_BY_KEY.get(k)!;
            const from = snap?.values[k] ?? null;
            if (from === to && (!f.sensitive || to === null)) continue;
            changes[k] = {
              from,
              to: f.sensitive && to !== null ? maskValue(String(to), f.type) : to,
            };
          }
          if (!Object.keys(changes).length && rollNo === undefined) {
            unchanged += 1;
            continue;
          }
        } else {
          name = [values.first_name, values.last_name].filter(Boolean).join(' ');
          for (const [k, to] of Object.entries(values)) {
            const f = PROFILE_FIELD_BY_KEY.get(k)!;
            changes[k] = {
              from: null,
              to: f.sensitive && to !== null ? maskValue(String(to), f.type) : to,
            };
          }
        }
        const stored: Record<string, ProfileValue> = {};
        for (const [k, v] of Object.entries(values)) {
          if (dto.mode === 'update' && !(k in changes)) continue;
          const f = PROFILE_FIELD_BY_KEY.get(k)!;
          stored[k] = f.sensitive && v !== null ? `enc:${encryptField(String(v))}` : v;
        }
        payload.push({
          row: rowNo,
          admissionNo,
          name,
          studentId,
          classSectionId,
          rollNo,
          values: stored,
          changes,
        });
      }
      const rejectedRows = new Set(problems.map((p) => p.row)).size;
      const why = (h: string) => {
        const n = norm(h.replace(/\*/g, ''));
        if (n === 'schoolbranch') return 'not used: the school is the one you are working in';
        if (n === 'schooludisecode') return 'not used: comes from the school profile';
        if (n === 'ageason31mar' || n === 'staffward') return 'not used: calculated automatically';
        if (n === 'academicyear') return 'not used: the working year applies';
        return 'Column not recognised; ignored';
      };
      for (const h of [...ignored].reverse())
        problems.unshift({ row: 1, column: h, message: why(h) });
      if (
        dto.mode === 'update' &&
        (has(CLASS_COLUMN) || has(SECTION_ONLY) || has(SECTION_COLUMN.key))
      )
        problems.unshift({
          row: 1,
          column: 'Class / Section',
          message: 'not changed by an update: move students between sections through enrolment',
        });
      const imp = await c.query<{ id: string }>(
        `INSERT INTO master_imports (school_id, master, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, 'validated', $3, $4, $5, $6::jsonb, $7::jsonb, app.current_user_id(), $8)
         RETURNING id::text`,
        [
          IMPORT_NAME[dto.mode],
          dto.fileName ?? null,
          counted,
          payload.length,
          rejectedRows,
          JSON.stringify(problems),
          JSON.stringify(payload),
          ctx.requestId,
        ],
      );
      return this.summaryIn(c, imp.rows[0]!.id, unchanged);
    });
  }

  /** The checked upload as the screen shows it: counts, problems and the old → new preview. */
  async summary(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.summaryIn(c, id));
  }

  private async summaryIn(c: PoolClient, id: string, unchangedKnown?: number) {
    const r = await c.query<{
      master: string;
      file_name: string | null;
      status: string;
      total_rows: number;
      ok_rows: number;
      rejected_rows: number;
      inserted_rows: number;
      updated_rows: number;
      report: Problem[];
      payload: PayloadRow[];
      created_at: Date;
      committed_at: Date | null;
    }>(
      `SELECT master, file_name, status::text, total_rows, ok_rows, rejected_rows, inserted_rows, updated_rows, report, payload,
              created_at, committed_at
         FROM master_imports WHERE id = $1 AND master IN ('student_profile_update', 'student_profile_create')`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Upload not found');
    return {
      id,
      mode: (x.master === 'student_profile_create' ? 'create' : 'update') as BulkMode,
      fileName: x.file_name,
      status: x.status,
      totalRows: x.total_rows,
      readyRows: x.ok_rows,
      rejectedRows: x.rejected_rows,
      unchangedRows: unchangedKnown ?? Math.max(x.total_rows - x.ok_rows - x.rejected_rows, 0),
      applied: x.inserted_rows + x.updated_rows,
      createdAt: x.created_at.toISOString(),
      committedAt: x.committed_at?.toISOString() ?? null,
      problems: x.report.slice(0, 1000),
      preview: x.payload.slice(0, 500).map((p) => ({
        row: p.row,
        admissionNo: p.admissionNo,
        name: p.name,
        rollNo: p.rollNo ?? null,
        changes: Object.entries(p.changes).map(([k, v]) => ({
          field: PROFILE_FIELD_BY_KEY.get(k)?.label ?? k,
          from: v.from,
          to: v.to,
        })),
      })),
    };
  }

  private decode(values: Record<string, ProfileValue>): Record<string, ProfileValue> {
    const out: Record<string, ProfileValue> = {};
    for (const [k, v] of Object.entries(values))
      out[k] = typeof v === 'string' && v.startsWith('enc:') ? decryptField(v.slice(4)) : v;
    return out;
  }

  /** Applies the validated rows; each row in a savepoint so one failure does not stop the rest. */
  async commit(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        master: string;
        status: string;
        payload: PayloadRow[];
        report: Problem[];
        created_at: Date;
      }>(
        `SELECT master, status::text, payload, report, created_at FROM master_imports
          WHERE id = $1 AND master IN ('student_profile_update', 'student_profile_create') FOR UPDATE`,
        [id],
      );
      const imp = r.rows[0];
      if (!imp) throw new DomainError('not-found', 'Upload not found');
      const mode: BulkMode = imp.master === 'student_profile_create' ? 'create' : 'update';
      this.assertAllowed(ctx, mode);
      if (imp.status !== 'validated')
        throw new DomainError('conflict', 'This upload was already committed', { status: 409 });
      if (Date.now() - imp.created_at.getTime() > 24 * 3600 * 1000)
        throw new DomainError(
          'validation-failed',
          'This check is older than a day; upload the file again',
          { status: 400 },
        );
      let done = 0;
      const failures: Problem[] = [];
      for (const p of imp.payload) {
        await c.query('SAVEPOINT bulk_row');
        try {
          const values = this.decode(p.values);
          let studentId = p.studentId;
          if (mode === 'create') {
            const ins = await c.query<{ id: string }>(
              `INSERT INTO students (school_id, admission_no, first_name, gender, created_by, updated_by)
               VALUES (app.current_school_id(), $1, $2, 'unspecified', app.current_user_id(), app.current_user_id()) RETURNING id::text`,
              [p.admissionNo, values.first_name],
            );
            studentId = ins.rows[0]!.id;
            if (!values.admitted_on) values.admitted_on = new Date().toISOString().slice(0, 10);
            const parent = values.father_name ? 'father' : 'mother';
            if (values.sms_mobile && !values[`${parent}_mobile`])
              values[`${parent}_mobile`] = values.sms_mobile;
          }
          await writeStudentProfile(c, studentId!, values);
          if (mode === 'create')
            await this.enrol(
              c,
              tenant.academicYearId!,
              studentId!,
              p.classSectionId!,
              p.rollNo,
              values.admitted_on as string,
            );
          else if (p.rollNo !== undefined)
            await c.query(
              `UPDATE enrolments SET roll_no = $3, updated_at = now() WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active'`,
              [studentId, tenant.academicYearId, p.rollNo],
            );
          await refreshCompleteness(c, studentId!);
          await this.audit.stage(ctx, c, {
            action: mode === 'create' ? 'people.student.create' : 'people.student.profile.edit',
            entityType: 'students',
            entityId: studentId!,
            before: Object.fromEntries(Object.entries(p.changes).map(([k, v]) => [k, v.from])),
            after: {
              ...Object.fromEntries(Object.entries(p.changes).map(([k, v]) => [k, v.to])),
              bulkUpload: id,
            },
          });
          await c.query('RELEASE SAVEPOINT bulk_row');
          done += 1;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT bulk_row');
          const e = error as { code?: string; message?: string };
          const message =
            error instanceof ProfileWriteError
              ? Object.values(error.errors).join('; ')
              : e.code === '23505'
                ? 'duplicate admission or roll number'
                : (e.message ?? 'could not be saved');
          failures.push({ row: p.row, admissionNo: p.admissionNo, column: 'Row', message });
        }
      }
      await c.query(
        `UPDATE master_imports SET status = 'committed', committed_at = now(), inserted_rows = $2, updated_rows = $3,
                report = report || $4::jsonb WHERE id = $1`,
        [id, mode === 'create' ? done : 0, mode === 'update' ? done : 0, JSON.stringify(failures)],
      );
      return { id, mode, applied: done, failed: failures.length, failures };
    });
  }

  private async enrol(
    c: PoolClient,
    yearId: string,
    studentId: string,
    sectionId: string,
    rollNo: number | undefined,
    joinedOn: string,
  ) {
    let roll = rollNo;
    if (roll === undefined) {
      const n = await c.query<{ n: number }>(
        `SELECT COALESCE(max(roll_no), 0) + 1 AS n FROM enrolments WHERE class_section_id = $1 AND academic_year_id = $2 AND status = 'active'`,
        [sectionId, yearId],
      );
      roll = n.rows[0]?.n ?? 1;
    }
    await c.query('SELECT app.enrol_student($1, $2, $3, $4, $5::date)', [
      studentId,
      yearId,
      sectionId,
      roll,
      joinedOn,
    ]);
  }

  /** Recent profile uploads of the school. */
  async list(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        master: string;
        file_name: string | null;
        status: string;
        total_rows: number;
        ok_rows: number;
        rejected_rows: number;
        inserted_rows: number;
        updated_rows: number;
        created_at: Date;
        committed_at: Date | null;
        requested_by: string | null;
      }>(
        `SELECT m.id::text, m.master, m.file_name, m.status::text, m.total_rows, m.ok_rows, m.rejected_rows, m.inserted_rows,
                m.updated_rows, m.created_at, m.committed_at, u.display_name AS requested_by
           FROM master_imports m LEFT JOIN users u ON u.id = m.requested_by
          WHERE m.master IN ('student_profile_update', 'student_profile_create')
          ORDER BY m.created_at DESC LIMIT 20`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        mode: x.master === 'student_profile_create' ? 'create' : 'update',
        fileName: x.file_name,
        status: x.status,
        totalRows: x.total_rows,
        readyRows: x.ok_rows,
        rejectedRows: x.rejected_rows,
        applied: x.inserted_rows + x.updated_rows,
        createdAt: x.created_at.toISOString(),
        committedAt: x.committed_at?.toISOString() ?? null,
        requestedBy: x.requested_by,
      }));
    });
  }

  /** Every row's outcome as an Excel file (validation problems and commit failures). */
  async resultFile(ctx: RequestContext, id: string): Promise<{ fileName: string; bytes: Buffer }> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ payload: PayloadRow[]; report: Problem[]; status: string }>(
        `SELECT payload, report, status::text FROM master_imports WHERE id = $1 AND master IN ('student_profile_update', 'student_profile_create')`,
        [id],
      );
      const imp = r.rows[0];
      if (!imp) throw new DomainError('not-found', 'Upload not found');
      const failedRows = new Set(imp.report.map((p) => p.row));
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Result');
      ws.addRow(['Row', 'Admission No', 'Student', 'Outcome', 'Field', 'Detail']);
      ws.getRow(1).font = { bold: true };
      for (const p of imp.payload)
        if (!failedRows.has(p.row))
          ws.addRow([
            p.row,
            p.admissionNo,
            p.name,
            imp.status === 'committed' ? 'Saved' : 'Ready',
            Object.keys(p.changes).length === 1
              ? (PROFILE_FIELD_BY_KEY.get(Object.keys(p.changes)[0]!)?.label ?? '')
              : `${String(Object.keys(p.changes).length)} fields`,
            Object.entries(p.changes)
              .map(
                ([k, v]) =>
                  `${PROFILE_FIELD_BY_KEY.get(k)?.label ?? k}: ${String(v.from ?? '—')} → ${String(v.to ?? '(cleared)')}`,
              )
              .join('; ')
              .slice(0, 32000),
          ]);
      for (const p of imp.report)
        ws.addRow([p.row, p.admissionNo ?? '', '', 'Not saved', p.column, p.message]);
      [8, 16, 28, 12, 28, 100].forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });
      return {
        fileName: `student-upload-${id}-result.xlsx`,
        bytes: Buffer.from(await wb.xlsx.writeBuffer()),
      };
    });
  }
}
