import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { parseCsv } from '../people/csv';
import type { BoardListQueryDto, BoardUploadDto } from './board-results.dto';

export interface BoardImportRow {
  id: string;
  board: string;
  classLabel: string;
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  unmatchedRows: number;
  report: Array<{ row: number; column: string; message: string }>;
  createdAt: string;
  committedAt: string | null;
}

interface ParsedRow {
  rollNo: string;
  candidateName: string | null;
  subjectCode: string;
  subjectName: string | null;
  theory: number | null;
  practical: number | null;
  total: number | null;
  grade: string | null;
  result: string | null;
  studentId: string | null;
  raw: Record<string, unknown>;
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_./-]+/g, '');
const num = (v: unknown): number | null => {
  if (
    v === null ||
    v === undefined ||
    String(v).trim() === '' ||
    /^(ab|abs|-)$/i.test(String(v).trim())
  )
    return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Sprint 18: board result import (CBSE files). Two shapes are accepted: one row per pupil per subject
 * (ROLL NO, NAME, SUB CODE, SUB NAME, THEORY, PRACTICAL, TOTAL, GRADE, RESULT) and the compact one row
 * per pupil (ROLL NO, NAME, SUB1, SUB1 MARKS, SUB1 GRADE … RESULT). Pupils match by board roll number
 * (enrolments.board_roll_no), else by name within the class; unmatched rows are kept with the roll
 * number so the analysis still works and a later roll-number upload links them.
 */
@Injectable()
export class BoardResultsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async validate(ctx: RequestContext, dto: BoardUploadDto): Promise<BoardImportRow> {
    const tenant = requireTenant(ctx);
    const { header, rows } = await readFile(dto);
    if (rows.length === 0)
      throw new DomainError('validation-failed', 'The file has no data rows', { status: 400 });
    const parsed = parseRows(header, rows);
    if (parsed.rejects.length && parsed.rows.length === 0)
      throw new DomainError(
        'validation-failed',
        `${parsed.rejects[0]!.message} (row ${parsed.rejects[0]!.row})`,
        { status: 400 },
      );
    return this.db.tenant(tenant, async (c) => {
      const classLabel =
        dto.classLabel === '10' ? 'X' : dto.classLabel === '12' ? 'XII' : dto.classLabel;
      const pupils = await c.query<{ id: string; name: string; roll: string | null }>(
        `SELECT s.id::text, s.display_name AS name, e.board_roll_no AS roll
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE e.academic_year_id = app.current_academic_year_id() AND e.status = 'active' AND k.code = $1`,
        [classLabel],
      );
      const byRoll = new Map(pupils.rows.filter((p) => p.roll).map((p) => [String(p.roll), p.id]));
      const byName = new Map(pupils.rows.map((p) => [norm(p.name), p.id]));
      let unmatched = 0;
      const seenUnmatched = new Set<string>();
      for (const r of parsed.rows) {
        r.studentId =
          byRoll.get(r.rollNo) ??
          (r.candidateName ? (byName.get(norm(r.candidateName)) ?? null) : null);
        if (!r.studentId && !seenUnmatched.has(r.rollNo)) {
          seenUnmatched.add(r.rollNo);
          unmatched += 1;
          parsed.rejects.push({
            row: 0,
            column: 'ROLL NO',
            message: `No pupil of class ${classLabel} matches roll ${r.rollNo}${r.candidateName ? ` (${r.candidateName})` : ''}; stored unlinked`,
          });
        }
      }
      const hardRejects = parsed.rejects.filter((x) => x.row > 0);
      const status = hardRejects.length ? 'failed' : 'validated';
      const ins = await c.query<{ id: string }>(
        `INSERT INTO board_result_imports (school_id, academic_year_id, board, class_label, file_name, status, total_rows, ok_rows, rejected_rows, unmatched_rows, report, payload, requested_by, request_id)
         VALUES (app.current_school_id(), app.current_academic_year_id(), $1, $2, $3, $4::import_status, $5, $6, $7, $8, $9::jsonb, $10::jsonb, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          dto.board,
          classLabel,
          dto.fileName ?? null,
          status,
          rows.length,
          parsed.rows.length,
          hardRejects.length,
          unmatched,
          JSON.stringify(parsed.rejects.slice(0, 500)),
          JSON.stringify(status === 'validated' ? parsed.rows : []),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.validate',
        entityType: 'board_result_imports',
        entityId: ins.rows[0]!.id,
        after: { board: dto.board, classLabel, rows: rows.length, unmatched },
      });
      return (await this.getImport(c, ins.rows[0]!.id))!;
    });
  }

  async commit(ctx: RequestContext, importId: string): Promise<BoardImportRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = await c.query<{
        status: string;
        board: string;
        class_label: string;
        payload: ParsedRow[];
      }>(
        `SELECT status::text, board, class_label, payload FROM board_result_imports WHERE id = $1`,
        [importId],
      );
      const row = imp.rows[0];
      if (!row) throw new DomainError('not-found', 'Import not found', { status: 404 });
      if (row.status !== 'validated')
        throw new DomainError('conflict', `Import is ${row.status}`, { status: 409 });
      for (const r of row.payload)
        await c.query(
          `INSERT INTO board_results (school_id, academic_year_id, board, class_label, roll_no, candidate_name, student_id, subject_code, subject_name, theory, practical, total, grade, result, import_id, raw)
           VALUES (app.current_school_id(), app.current_academic_year_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
           ON CONFLICT (academic_year_id, board, class_label, roll_no, subject_code) DO UPDATE SET candidate_name = EXCLUDED.candidate_name, student_id = COALESCE(EXCLUDED.student_id, board_results.student_id),
             subject_name = EXCLUDED.subject_name, theory = EXCLUDED.theory, practical = EXCLUDED.practical, total = EXCLUDED.total, grade = EXCLUDED.grade, result = EXCLUDED.result, import_id = EXCLUDED.import_id, raw = EXCLUDED.raw`,
          [
            row.board,
            row.class_label,
            r.rollNo,
            r.candidateName,
            r.studentId,
            r.subjectCode,
            r.subjectName,
            r.theory,
            r.practical,
            r.total,
            r.grade,
            r.result,
            importId,
            JSON.stringify(r.raw),
          ],
        );
      await c.query(
        `UPDATE board_result_imports SET status = 'committed', committed_at = now() WHERE id = $1`,
        [importId],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.commit',
        entityType: 'board_results',
        entityId: importId,
        after: { rows: row.payload.length },
      });
      return (await this.getImport(c, importId))!;
    });
  }

  async imports(ctx: RequestContext): Promise<BoardImportRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT id::text, board, class_label, file_name, status::text, total_rows, ok_rows, rejected_rows, unmatched_rows, report, created_at, committed_at
           FROM board_result_imports WHERE academic_year_id = app.current_academic_year_id() ORDER BY created_at DESC LIMIT 20`,
      );
      return r.rows.map(toImport);
    });
  }

  async list(ctx: RequestContext, q: BoardListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where = ['r.academic_year_id = app.current_academic_year_id()'];
      const params: unknown[] = [];
      if (q.board) {
        params.push(q.board);
        where.push(`r.board = $${params.length}`);
      }
      if (q.classLabel) {
        params.push(q.classLabel);
        where.push(`r.class_label = $${params.length}`);
      }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(
          `(r.roll_no ILIKE $${params.length} OR r.candidate_name ILIKE $${params.length} OR s.display_name ILIKE $${params.length} OR r.subject_name ILIKE $${params.length})`,
        );
      }
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT r.id::text, r.board, r.class_label, r.roll_no, r.candidate_name, r.student_id::text, s.display_name AS student, s.admission_no,
                r.subject_code, r.subject_name, r.theory::text, r.practical::text, r.total::text, r.grade, r.result, count(*) OVER () AS total_rows
           FROM board_results r LEFT JOIN students s ON s.id = r.student_id
          WHERE ${where.join(' AND ')} ORDER BY r.class_label, r.roll_no, r.subject_code LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const analysis = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT r.class_label, r.subject_code, max(r.subject_name) AS subject_name, count(*)::int AS candidates,
                round(avg(r.total), 2)::text AS mean, max(r.total)::text AS highest, min(r.total)::text AS lowest,
                count(*) FILTER (WHERE r.total >= 33)::int AS passed,
                count(*) FILTER (WHERE r.total >= 90)::int AS distinctions,
                count(*) FILTER (WHERE r.student_id IS NULL)::int AS unlinked
           FROM board_results r WHERE ${where.slice(0, 3).join(' AND ')} GROUP BY r.class_label, r.subject_code ORDER BY r.class_label, r.subject_code`,
        params.slice(0, params.length - 2).filter((_, i) => i < 2 || !q.q),
      );
      return {
        data: r.rows.map(({ total_rows: _t, ...x }) => x),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total_rows ?? 0) },
        analysis: analysis.rows,
      };
    });
  }

  private async getImport(c: PoolClient, id: string): Promise<BoardImportRow | null> {
    const r = await c.query<Record<string, unknown>>(
      `SELECT id::text, board, class_label, file_name, status::text, total_rows, ok_rows, rejected_rows, unmatched_rows, report, created_at, committed_at FROM board_result_imports WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toImport(r.rows[0]) : null;
  }
}

const toImport = (r: Record<string, unknown>): BoardImportRow => ({
  id: String(r.id),
  board: String(r.board),
  classLabel: String(r.class_label),
  fileName: (r.file_name as string | null) ?? null,
  status: r.status as BoardImportRow['status'],
  totalRows: Number(r.total_rows),
  okRows: Number(r.ok_rows),
  rejectedRows: Number(r.rejected_rows),
  unmatchedRows: Number(r.unmatched_rows),
  report: (r.report as BoardImportRow['report']) ?? [],
  createdAt: new Date(r.created_at as string).toISOString(),
  committedAt: r.committed_at ? new Date(r.committed_at as string).toISOString() : null,
});

/** Column index by any of several header spellings. */
function col(header: string[], ...names: string[]): number {
  const wanted = names.map(norm);
  return header.findIndex((h) => wanted.includes(norm(String(h ?? ''))));
}

function parseRows(
  header: string[],
  rows: Array<Array<string | number | boolean | Date | null>>,
): { rows: ParsedRow[]; rejects: Array<{ row: number; column: string; message: string }> } {
  const out: ParsedRow[] = [];
  const rejects: Array<{ row: number; column: string; message: string }> = [];
  const roll = col(header, 'roll no', 'rollno', 'roll', 'roll number');
  const name = col(header, 'name', 'candidate name', 'student name');
  const subCode = col(header, 'sub code', 'subject code', 'subcode', 'code');
  const subName = col(header, 'sub name', 'subject name', 'subject');
  const theory = col(header, 'theory', 'th', 'theory marks');
  const practical = col(header, 'practical', 'pr', 'ia', 'practical/ia', 'internal');
  const total = col(header, 'total', 'marks', 'total marks');
  const grade = col(header, 'grade', 'grd', 'positional grade');
  const result = col(header, 'result', 'res');
  if (roll < 0) {
    rejects.push({ row: 1, column: 'ROLL NO', message: 'A ROLL NO column is required' });
    return { rows: out, rejects };
  }
  const cell = (r: Array<unknown>, i: number) =>
    i >= 0 && r[i] !== null && r[i] !== undefined ? String(r[i]).trim() : '';
  if (subCode >= 0) {
    // long shape: one row per pupil per subject
    rows.forEach((r, i) => {
      const rollNo = cell(r, roll);
      const code = cell(r, subCode);
      if (!rollNo || !code) {
        rejects.push({ row: i + 2, column: rollNo ? 'SUB CODE' : 'ROLL NO', message: 'Required' });
        return;
      }
      out.push({
        rollNo,
        candidateName: cell(r, name) || null,
        subjectCode: code,
        subjectName: cell(r, subName) || null,
        theory: num(cell(r, theory)),
        practical: num(cell(r, practical)),
        total:
          num(cell(r, total)) ??
          ((num(cell(r, theory)) ?? 0) + (num(cell(r, practical)) ?? 0) || null),
        grade: cell(r, grade) || null,
        result: cell(r, result) || null,
        studentId: null,
        raw: Object.fromEntries(header.map((h, k) => [String(h), r[k] ?? null])),
      });
    });
    return { rows: out, rejects };
  }
  // compact shape: SUB1, SUB1 MARKS|MRK1, SUB1 GRADE|GRD1 ... up to six
  const groups: Array<{ code: number; marks: number; grade: number }> = [];
  for (let n = 1; n <= 8; n += 1) {
    const c = col(header, `sub${n}`, `subject${n}`, `sub ${n}`);
    if (c < 0) continue;
    groups.push({
      code: c,
      marks: col(header, `sub${n} marks`, `mrk${n}`, `marks${n}`, `sub ${n} marks`, `total${n}`),
      grade: col(header, `sub${n} grade`, `grd${n}`, `grade${n}`, `sub ${n} grade`),
    });
  }
  if (groups.length === 0) {
    rejects.push({
      row: 1,
      column: 'SUB CODE',
      message: 'Neither SUB CODE nor SUB1 … SUBn columns were found',
    });
    return { rows: out, rejects };
  }
  rows.forEach((r, i) => {
    const rollNo = cell(r, roll);
    if (!rollNo) {
      rejects.push({ row: i + 2, column: 'ROLL NO', message: 'Required' });
      return;
    }
    for (const g of groups) {
      const code = cell(r, g.code);
      if (!code) continue;
      out.push({
        rollNo,
        candidateName: cell(r, name) || null,
        subjectCode: code.split(/\s+/)[0]!,
        subjectName: code.includes(' ') ? code.slice(code.indexOf(' ') + 1) : null,
        theory: null,
        practical: null,
        total: num(cell(r, g.marks)),
        grade: cell(r, g.grade) || null,
        result: cell(r, result) || null,
        studentId: null,
        raw: Object.fromEntries(header.map((h, k) => [String(h), r[k] ?? null])),
      });
    }
  });
  return { rows: out, rejects };
}

async function readFile(
  dto: BoardUploadDto,
): Promise<{ header: string[]; rows: Array<Array<string | number | boolean | Date | null>> }> {
  if (dto.csv) {
    const p = parseCsv(dto.csv);
    return { header: p.header, rows: p.rows };
  }
  const buf = Buffer.from(dto.contentBase64!, 'base64');
  if (buf.length > 4 * 1024 * 1024)
    throw new DomainError('validation-failed', 'File larger than 4 MB', { status: 400 });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new DomainError('validation-failed', 'Not a readable .xlsx file', { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new DomainError('validation-failed', 'The workbook has no sheet', { status: 400 });
  const header: string[] = [];
  const rows: Array<Array<string | number | boolean | Date | null>> = [];
  ws.eachRow((row, n) => {
    const cells: Array<string | number | boolean | Date | null> = [];
    const count = Math.max(row.cellCount, header.length);
    for (let i = 1; i <= count; i += 1) {
      const v = row.getCell(i).value;
      cells.push(
        v === null || v === undefined
          ? null
          : typeof v === 'object' && !(v instanceof Date)
            ? String(
                (v as { result?: unknown; text?: unknown }).result ??
                  (v as { text?: unknown }).text ??
                  '',
              )
            : (v as string | number | boolean | Date),
      );
    }
    if (n === 1) header.push(...cells.map((c) => (c === null ? '' : String(c))));
    else if (cells.some((c) => c !== null && String(c).trim() !== '')) rows.push(cells);
  });
  return { header, rows };
}
