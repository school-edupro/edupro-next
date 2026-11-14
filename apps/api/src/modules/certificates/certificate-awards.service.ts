import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { CertificateBulkService } from './certificate-bulk.service';
import type {
  AllotmentDto,
  AllotmentImportDto,
  AwardDto,
  IssueAllotmentsDto,
  ListAllotmentsQueryDto,
} from './certificates.dto';
import { CertificatesService } from './certificates.service';

/**
 * Awards (docs/design/87, phase E): the awards the school gives (a master: the name and the certificate type it is
 * printed on — achievement, merit, participation, award), who received them (allotments: the student, the event, the
 * place, the day; one by one or from a CSV), and their certificates, issued together as a batch.
 */
const AWARD_TYPES = ['ACHIEVEMENT', 'MERIT', 'PARTICIPATION', 'AWARD'];

/** A small CSV reader: quoted fields, commas, new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** dd-mm-yyyy or yyyy-mm-dd → yyyy-mm-dd, else null */
const isoDate = (v: string): string | null => {
  const a = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  const iso = a
    ? `${a[3]!}-${a[2]!.padStart(2, '0')}-${a[1]!.padStart(2, '0')}`
    : /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? v
      : null;
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : null;
};

@Injectable()
export class CertificateAwardsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly certificates: CertificatesService,
    private readonly bulk: CertificateBulkService,
  ) {}

  private async assertType(c: PoolClient, code: string) {
    const r = await c.query<{ audience: string }>(
      `SELECT audience FROM certificate_types WHERE code = $1 AND active`,
      [code],
    );
    if (!r.rows[0] || r.rows[0].audience !== 'STUDENT')
      throw new DomainError(
        'validation-failed',
        'Choose a student certificate type that is switched on',
        {
          status: 400,
        },
      );
  }

  // ---- the awards ----------------------------------------------------------------------------------------------------
  async awards(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.certificates.ensureSetup(c);
      const r = await c.query<{
        id: string;
        name: string;
        type_code: string;
        type_name: string | null;
        description: string | null;
        active: boolean;
        sort_order: number;
        allotted: number;
        issued: number;
      }>(
        `SELECT a.id::text, a.name, a.type_code, t.name AS type_name, a.description, a.active, a.sort_order,
                (SELECT count(*)::int FROM certificate_award_allotments l WHERE l.award_id = a.id) AS allotted,
                (SELECT count(*)::int FROM certificate_award_allotments l WHERE l.award_id = a.id AND l.certificate_id IS NOT NULL) AS issued
           FROM certificate_awards a LEFT JOIN certificate_types t ON t.code = a.type_code
          ORDER BY a.active DESC, a.sort_order, a.name`,
      );
      const types = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM certificate_types WHERE audience = 'STUDENT' AND active
          ORDER BY (code = ANY($1::text[])) DESC, sort_order, name`,
        [AWARD_TYPES],
      );
      return {
        rows: r.rows.map((a) => ({
          id: a.id,
          name: a.name,
          typeCode: a.type_code,
          typeName: a.type_name,
          description: a.description,
          active: a.active,
          sortOrder: a.sort_order,
          allotted: a.allotted,
          issued: a.issued,
        })),
        types: types.rows,
      };
    });
  }

  async saveAward(ctx: RequestContext, id: string | null, dto: AwardDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertType(c, dto.typeCode);
      try {
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE certificate_awards SET name = $2, type_code = $3, description = $4, active = $5, sort_order = $6,
                      updated_at = now(), updated_by = app.current_user_id() WHERE id = $1 RETURNING id::text`,
              [id, dto.name, dto.typeCode, dto.description || null, dto.active, dto.sortOrder],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO certificate_awards (school_id, name, type_code, description, active, sort_order, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id()) RETURNING id::text`,
              [dto.name, dto.typeCode, dto.description || null, dto.active, dto.sortOrder],
            );
        if (!r.rows[0]) throw new DomainError('not-found', 'Award not found');
        await this.audit.stage(ctx, c, {
          action: id ? 'certificate.award.update' : 'certificate.award.create',
          entityType: 'certificate_awards',
          entityId: r.rows[0].id,
          after: { ...dto },
        });
        return { id: r.rows[0].id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError(
            'certificate.award_taken',
            `An award "${dto.name}" is already there`,
            { status: 409 },
          );
        throw e;
      }
    });
  }

  // ---- who received them -----------------------------------------------------------------------------------------------
  async allotments(ctx: RequestContext, q: ListAllotmentsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      const add = (sql: (n: string) => string, v: unknown) => {
        params.push(v);
        where.push(sql(`$${String(params.length)}`));
      };
      if (q.award) add((n) => `l.award_id = ${n}`, q.award);
      if (q.issued === 'yes') where.push('l.certificate_id IS NOT NULL');
      if (q.issued === 'no') where.push('l.certificate_id IS NULL');
      if (q.from) add((n) => `l.awarded_on >= ${n}::date`, q.from);
      if (q.to) add((n) => `l.awarded_on <= ${n}::date`, q.to);
      if (q.q)
        add(
          (n) => `(s.display_name ILIKE ${n} OR s.admission_no ILIKE ${n} OR l.event ILIKE ${n})`,
          `%${q.q}%`,
        );
      const w = where.join(' AND ');
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- the conditions are fixed fragments; values are bound parameters
        `SELECT count(*)::int AS n FROM certificate_award_allotments l JOIN students s ON s.id = l.student_id WHERE ${w}`,
        params,
      );
      const r = await c.query<{
        id: string;
        award: string;
        award_id: string;
        student_id: string;
        name: string;
        admission_no: string;
        class_label: string | null;
        event: string | null;
        position: string | null;
        awarded_on: string;
        remarks: string | null;
        certificate_id: string | null;
        number: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the conditions are fixed fragments; values are bound parameters
        `SELECT l.id::text, a.name AS award, a.id::text AS award_id, s.id::text AS student_id, s.display_name AS name,
                s.admission_no,
                (SELECT c.name || ' – ' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                   JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = en.academic_year_id
                  WHERE en.student_id = s.id AND en.status <> 'cancelled' ORDER BY y.start_date DESC, en.id DESC LIMIT 1) AS class_label,
                l.event, l.position, l.awarded_on::text, l.remarks, l.certificate_id::text, x.number
           FROM certificate_award_allotments l JOIN certificate_awards a ON a.id = l.award_id
           JOIN students s ON s.id = l.student_id LEFT JOIN certificates x ON x.id = l.certificate_id
          WHERE ${w}
          ORDER BY l.awarded_on DESC, a.name, s.display_name
          LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
        [...params, q.size, (q.page - 1) * q.size],
      );
      return {
        total: total.rows[0]?.n ?? 0,
        rows: r.rows.map((x) => ({
          id: x.id,
          award: x.award,
          awardId: x.award_id,
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          classLabel: x.class_label,
          event: x.event,
          position: x.position,
          awardedOn: x.awarded_on,
          remarks: x.remarks,
          certificateId: x.certificate_id,
          number: x.number,
        })),
      };
    });
  }

  async addAllotment(ctx: RequestContext, dto: AllotmentDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await c.query(`SELECT 1 FROM certificate_awards WHERE id = $1 AND active`, [
        dto.awardId,
      ]);
      if (!a.rowCount) throw new DomainError('not-found', 'Award not found');
      const s = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        dto.studentId,
      ]);
      if (!s.rowCount) throw new DomainError('not-found', 'Student not found');
      const r = await c.query<{ id: string }>(
        `INSERT INTO certificate_award_allotments (school_id, award_id, student_id, event, position, awarded_on, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
        [
          dto.awardId,
          dto.studentId,
          dto.event || null,
          dto.position || null,
          dto.awardedOn,
          dto.remarks || null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.allotment.create',
        entityType: 'certificate_award_allotments',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  /** Takes an allotment off (only before its certificate is issued). */
  async removeAllotment(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ certificate_id: string | null }>(
        `SELECT certificate_id::text FROM certificate_award_allotments WHERE id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Allotment not found');
      if (r.rows[0].certificate_id)
        throw new DomainError(
          'certificate.allotment_issued',
          'Its certificate is issued: cancel the certificate instead',
          {
            status: 409,
          },
        );
      await c.query(`DELETE FROM certificate_award_allotments WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'certificate.allotment.remove',
        entityType: 'certificate_award_allotments',
        entityId: id,
      });
      return { removed: true };
    });
  }

  /**
   * Allotments from a CSV — admission_no, award, event, position, date, remarks (the first row may be the headings).
   * Every row is checked first; with errors nothing is saved and each error is named with its line.
   */
  async importAllotments(ctx: RequestContext, dto: AllotmentImportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = parseCsv(dto.csv);
      if (rows[0] && /admission/i.test(rows[0][0] ?? '')) rows.shift();
      if (!rows.length)
        throw new DomainError('validation-failed', 'The file has no rows', { status: 400 });
      if (rows.length > 2000)
        throw new DomainError('validation-failed', 'At most 2000 rows at a time', { status: 400 });
      const awards = new Map(
        (
          await c.query<{ id: string; name: string }>(
            `SELECT id::text, lower(name) AS name FROM certificate_awards WHERE active`,
          )
        ).rows.map((a) => [a.name, a.id]),
      );
      const nos = [...new Set(rows.map((r) => (r[0] ?? '').toLowerCase()).filter(Boolean))];
      const students = new Map(
        (
          await c.query<{ id: string; no: string }>(
            `SELECT id::text, lower(admission_no) AS no FROM students WHERE lower(admission_no) = ANY($1::text[]) AND deleted_at IS NULL`,
            [nos],
          )
        ).rows.map((s) => [s.no, s.id]),
      );
      const errors: string[] = [];
      const ok: Array<{
        award: string;
        student: string;
        event: string;
        position: string;
        date: string;
        remarks: string;
      }> = [];
      rows.forEach((r, i) => {
        const line = i + 2;
        const [no = '', award = '', event = '', position = '', date = '', remarks = ''] = r;
        const student = students.get(no.toLowerCase());
        const awardId = awards.get(award.trim().toLowerCase());
        const day = isoDate(date) ?? (date ? null : new Date().toISOString().slice(0, 10));
        if (!student) errors.push(`Line ${String(line)}: no student with admission no. "${no}"`);
        if (!awardId) errors.push(`Line ${String(line)}: no award named "${award}"`);
        if (!day) errors.push(`Line ${String(line)}: the date "${date}" is not a date`);
        if (event.length > 160 || position.length > 40 || remarks.length > 300)
          errors.push(`Line ${String(line)}: a value is too long`);
        if (student && awardId && day)
          ok.push({ award: awardId, student, event, position, date: day, remarks });
      });
      if (errors.length || dto.dryRun)
        return { rows: rows.length, valid: ok.length, errors: errors.slice(0, 50), saved: 0 };
      for (const x of ok)
        await c.query(
          `INSERT INTO certificate_award_allotments (school_id, award_id, student_id, event, position, awarded_on, remarks, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())`,
          [x.award, x.student, x.event || null, x.position || null, x.date, x.remarks || null],
        );
      await this.audit.stage(ctx, c, {
        action: 'certificate.allotment.import',
        entityType: 'certificate_award_allotments',
        entityId: '0',
        after: { saved: ok.length },
      });
      return { rows: rows.length, valid: ok.length, errors: [], saved: ok.length };
    });
  }

  /** The certificates of chosen allotments, one batch a certificate type, each with its award's fields. */
  async issue(ctx: RequestContext, dto: IssueAllotmentsDto) {
    const tenant = requireTenant(ctx);
    const groups = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const r = await c.query<{
        id: string;
        type_code: string;
        type_id: string;
        type_name: string;
        award: string;
        student_id: string;
        name: string;
        admission_no: string;
        event: string | null;
        position: string | null;
        awarded_on: string;
        certificate_id: string | null;
      }>(
        `SELECT l.id::text, a.type_code, t.id::text AS type_id, t.name AS type_name, a.name AS award, l.student_id::text,
                s.display_name AS name, s.admission_no, l.event, l.position, l.awarded_on::text, l.certificate_id::text
           FROM certificate_award_allotments l JOIN certificate_awards a ON a.id = l.award_id
           JOIN certificate_types t ON t.code = a.type_code JOIN students s ON s.id = l.student_id
          WHERE l.id = ANY($1::bigint[])
          ORDER BY a.name, s.display_name`,
        [dto.allotmentIds],
      );
      const open = r.rows.filter((x) => !x.certificate_id);
      if (!open.length)
        throw new DomainError(
          'validation-failed',
          'The chosen awards already have their certificates',
          { status: 400 },
        );
      const byType = new Map<string, typeof open>();
      for (const x of open) byType.set(x.type_code, [...(byType.get(x.type_code) ?? []), x]);
      const out: Array<{ batchId: string; typeName: string; items: typeof open }> = [];
      for (const [, items] of byType) {
        const b = await c.query<{ id: string }>(
          `INSERT INTO certificate_batches (school_id, type_id, title, scope, created_by)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb, app.current_user_id()) RETURNING id::text`,
          [
            items[0]!.type_id,
            `${items[0]!.type_name} · ${[...new Set(items.map((i) => i.award))].join(', ')}`.slice(
              0,
              200,
            ),
            JSON.stringify({ allotmentIds: items.map((i) => i.id) }),
          ],
        );
        out.push({ batchId: b.rows[0]!.id, typeName: items[0]!.type_name, items });
      }
      return out;
    });
    const batches = [];
    for (const g of groups)
      batches.push(
        await this.bulk.run(
          ctx,
          g.batchId,
          g.typeName,
          g.items.map((x) => ({
            student: {
              id: x.student_id,
              name: x.name,
              admissionNo: x.admission_no,
              rollNo: null,
              classLabel: null,
            },
            dto: {
              typeCode: x.type_code,
              studentId: x.student_id,
              issuedOn: undefined,
              fields: {
                award: x.award,
                ...(x.event ? { event: x.event } : {}),
                ...(x.position ? { position: x.position } : {}),
                awardedOn: x.awarded_on,
              },
            },
            after: (certificateId: string) =>
              this.db
                .tenant(tenant, (c) =>
                  c.query(
                    `UPDATE certificate_award_allotments SET certificate_id = $2 WHERE id = $1`,
                    [x.id, certificateId],
                  ),
                )
                .then(() => undefined),
          })),
        ),
      );
    return { batches };
  }
}
