import { Injectable } from '@nestjs/common';
import { loadProfileLists, PROFILE_LIST_DEFAULTS, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet, type TemplateColumn } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService } from './admission-core.service';
import { tablePdf } from './admission-pdf';
import type { ScoreRowDto } from './scores.dto';

export type ScoreTableName = 'qualification' | 'locality' | 'alumni_school';
export const SCORE_TABLES: ScoreTableName[] = ['qualification', 'locality', 'alumni_school'];

const SQL_TABLE: Record<ScoreTableName, string> = {
  qualification: 'admission_qualifications',
  locality: 'admission_localities',
  alumni_school: 'admission_alumni_schools',
};
const TITLE: Record<ScoreTableName, string> = {
  qualification: 'Qualifications',
  locality: 'Localities',
  alumni_school: 'Alumni schools',
};
const num = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** One row of a score table as the screens show it. */
export interface ScoreRow {
  id: string;
  name: string;
  fatherScore?: number;
  motherScore?: number;
  fatherWeight?: number;
  motherWeight?: number;
  classId?: string | null;
  className?: string | null;
  band?: string | null;
  area?: string | null;
  passoutClass?: string;
  score?: number;
}

/**
 * The school's merit score tables (docs/design/48, part 1): qualifications with a father's and a
 * mother's score, localities with a distance band and a score (a class or every class), alumni schools
 * by pass-out class. Each: add, edit, archive, Excel in and out; reused by every session's criteria.
 */
@Injectable()
export class AdmissionScoreTablesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly core: AdmissionCoreService,
  ) {}

  private table(t: string): ScoreTableName {
    if (!(SCORE_TABLES as string[]).includes(t))
      throw new DomainError('not-found', 'Unknown score table', { status: 404 });
    return t as ScoreTableName;
  }

  private async rowsWith(c: PoolClient, t: ScoreTableName): Promise<ScoreRow[]> {
    if (t === 'qualification') {
      const r = await c.query<Record<string, string>>(
        `SELECT id::text, name, father_score::text, mother_score::text, father_weight::text, mother_weight::text
           FROM admission_qualifications WHERE status = 'active' ORDER BY lower(name)`,
      );
      return r.rows.map((x) => ({
        id: x.id!,
        name: x.name!,
        fatherScore: num(x.father_score),
        motherScore: num(x.mother_score),
        fatherWeight: num(x.father_weight),
        motherWeight: num(x.mother_weight),
      }));
    }
    if (t === 'locality') {
      const r = await c.query<Record<string, string | null>>(
        `SELECT l.id::text, l.name, l.class_id::text, cl.name AS class_name, l.band, l.area, l.score::text
           FROM admission_localities l LEFT JOIN classes cl ON cl.id = l.class_id
          WHERE l.status = 'active' ORDER BY cl.display_order NULLS FIRST, l.score DESC, lower(l.name)`,
      );
      return r.rows.map((x) => ({
        id: x.id!,
        name: x.name!,
        classId: x.class_id,
        className: x.class_name,
        band: x.band,
        area: x.area,
        score: num(x.score),
      }));
    }
    const r = await c.query<Record<string, string>>(
      `SELECT id::text, name, passout_class, score::text FROM admission_alumni_schools
        WHERE status = 'active' ORDER BY lower(name), passout_class`,
    );
    return r.rows.map((x) => ({
      id: x.id!,
      name: x.name!,
      passoutClass: x.passout_class!,
      score: num(x.score),
    }));
  }

  private async classesWith(c: PoolClient) {
    const r = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
    );
    return r.rows;
  }

  /** The school's lists the tables pick from: Education, Locality, AlumniClass (built-in when empty). */
  private async optionsWith(c: PoolClient) {
    const lists = await loadProfileLists(c);
    const of = (code: string) =>
      lists[code]?.length ? lists[code]! : (PROFILE_LIST_DEFAULTS[code] ?? []);
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    const schools = await c.query<{ name: string }>(
      `SELECT DISTINCT btrim(name) AS name FROM admission_alumni_schools WHERE status = 'active' ORDER BY 1`,
    );
    return {
      qualification: of('Education'),
      locality: of('Locality'),
      passout: of('AlumniClass'),
      schools: [
        ...new Set(
          [school.rows[0]?.name ?? '', ...schools.rows.map((x) => x.name)].filter(Boolean),
        ),
      ],
    };
  }

  /**
   * A name used in a table kept in the school's list it belongs to (Education, Locality, AlumniClass),
   * so the form offers it; a list still on its built-in values gets them first, so none is lost.
   */
  private async keepInList(c: PoolClient, code: string, value: string) {
    const v = value.trim();
    if (!v) return;
    const have = await c.query<{ value: string }>(
      `SELECT value FROM profile_lists WHERE list_code = $1 AND status = 'active'`,
      [code],
    );
    if (have.rows.some((x) => x.value.trim().toLowerCase() === v.toLowerCase())) return;
    const start = have.rows.length ? [] : (PROFILE_LIST_DEFAULTS[code] ?? []);
    const values = [...start.filter((x) => x.toLowerCase() !== v.toLowerCase()), v];
    let order =
      (
        await c.query<{ n: number }>(
          `SELECT COALESCE(max(sort_order), 0)::int AS n FROM profile_lists WHERE list_code = $1`,
          [code],
        )
      ).rows[0]?.n ?? 0;
    for (const x of values) {
      order += 1;
      await c.query(
        `INSERT INTO profile_lists (school_id, list_code, value, sort_order) VALUES (app.current_school_id(), $1, $2, $3)
         ON CONFLICT (school_id, list_code, value) DO UPDATE SET status = 'active'`,
        [code, x, order],
      );
    }
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      qualification: await this.rowsWith(c, 'qualification'),
      locality: await this.rowsWith(c, 'locality'),
      alumni_school: await this.rowsWith(c, 'alumni_school'),
      classes: await this.classesWith(c),
      options: await this.optionsWith(c),
    }));
  }

  /** Localities added to the school's Locality list (the master the form and the table pick from). */
  async addLocalities(ctx: RequestContext, names: string[]) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
      for (const n of clean) await this.keepInList(c, 'Locality', n);
      if (clean.length)
        await this.audit.stage(ctx, c, {
          action: 'admissions.score_table.localities',
          entityType: 'profile_lists',
          after: { added: clean.length },
        });
      return { added: clean.length, options: await this.optionsWith(c) };
    });
  }

  /** One row added (id null) or changed; the same name (and class / pass-out class) twice is refused. */
  private async putWith(c: PoolClient, t: ScoreTableName, id: string | null, d: ScoreRowDto) {
    const name = d.name.trim();
    const params: unknown[] = [];
    let sql: string;
    if (t === 'qualification') {
      params.push(
        name,
        d.fatherScore ?? 0,
        d.motherScore ?? 0,
        d.fatherWeight ?? 0,
        d.motherWeight ?? 0,
        id,
      );
      sql = id
        ? `UPDATE admission_qualifications SET name = $1, father_score = $2, mother_score = $3, father_weight = $4, mother_weight = $5, updated_at = now()
            WHERE id = $6 AND status = 'active' RETURNING id::text`
        : `INSERT INTO admission_qualifications (school_id, name, father_score, mother_score, father_weight, mother_weight)
           SELECT app.current_school_id(), $1, $2, $3, $4, $5 WHERE $6::bigint IS NULL RETURNING id::text`;
    } else if (t === 'locality') {
      params.push(
        name,
        d.classId ?? null,
        d.band?.trim() || null,
        d.area?.trim() || null,
        d.score ?? 0,
        id,
      );
      sql = id
        ? `UPDATE admission_localities SET name = $1, class_id = $2, band = $3, area = $4, score = $5, updated_at = now()
            WHERE id = $6 AND status = 'active' RETURNING id::text`
        : `INSERT INTO admission_localities (school_id, name, class_id, band, area, score)
           SELECT app.current_school_id(), $1, $2, $3, $4, $5 WHERE $6::bigint IS NULL RETURNING id::text`;
    } else {
      const passout = d.passoutClass?.trim() ?? '';
      if (!passout)
        throw new DomainError(
          'validation-failed',
          'Give the pass-out class (10, 12, Both, Others)',
          {
            status: 400,
          },
        );
      params.push(name, passout, d.score ?? 0, id);
      sql = id
        ? `UPDATE admission_alumni_schools SET name = $1, passout_class = $2, score = $3, updated_at = now()
            WHERE id = $4 AND status = 'active' RETURNING id::text`
        : `INSERT INTO admission_alumni_schools (school_id, name, passout_class, score)
           SELECT app.current_school_id(), $1, $2, $3 WHERE $4::bigint IS NULL RETURNING id::text`;
    }
    try {
      await c.query('SAVEPOINT score_row');
      const r = await c.query<{ id: string }>(sql, params);
      await c.query('RELEASE SAVEPOINT score_row');
      if (!r.rows[0]) throw new DomainError('not-found', 'Row not found', { status: 404 });
      // the name (and the pass-out class) kept in the list the form picks from
      if (t === 'qualification') await this.keepInList(c, 'Education', name);
      if (t === 'locality') await this.keepInList(c, 'Locality', name);
      if (t === 'alumni_school' && d.passoutClass)
        await this.keepInList(c, 'AlumniClass', d.passoutClass);
      return r.rows[0].id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        await c.query('ROLLBACK TO SAVEPOINT score_row');
        throw new DomainError(
          'conflict',
          t === 'alumni_school'
            ? `“${name}” with that pass-out class is in the table already`
            : t === 'locality'
              ? `“${name}” is in the list already for that class`
              : `“${name}” is in the table already`,
          { status: 409 },
        );
      }
      throw e;
    }
  }

  async save(ctx: RequestContext, table: string, id: string | null, dto: ScoreRowDto) {
    const t = this.table(table);
    if (id && !/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Row not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rowId = await this.putWith(c, t, id, dto);
      await this.audit.stage(ctx, c, {
        action: `admissions.score_table.${id ? 'update' : 'create'}`,
        entityType: SQL_TABLE[t],
        entityId: rowId,
        after: { ...dto },
      });
      return { rows: await this.rowsWith(c, t) };
    });
  }

  async archive(ctx: RequestContext, table: string, id: string) {
    const t = this.table(table);
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Row not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- SQL_TABLE holds fixed table names
        `UPDATE ${SQL_TABLE[t]} SET status = 'inactive', updated_at = now() WHERE id = $1 AND status = 'active'`,
        [id],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Row not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'admissions.score_table.archive',
        entityType: SQL_TABLE[t],
        entityId: id,
      });
      return { rows: await this.rowsWith(c, t) };
    });
  }

  /** The qualifications of the school's Education list not yet in the table, with 0 scores to fill. */
  async fromEducationList(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lists = await loadProfileLists(c);
      const have = new Set(
        (await this.rowsWith(c, 'qualification')).map((x) => x.name.trim().toLowerCase()),
      );
      const names = [...new Set((lists.Education ?? []).map((x) => x.trim()))].filter(
        (n) => n && !have.has(n.toLowerCase()),
      );
      for (const n of names)
        await c.query(
          `INSERT INTO admission_qualifications (school_id, name) VALUES (app.current_school_id(), $1)`,
          [n],
        );
      if (names.length)
        await this.audit.stage(ctx, c, {
          action: 'admissions.score_table.from_list',
          entityType: 'admission_qualifications',
          after: { added: names.length },
        });
      return { added: names.length, rows: await this.rowsWith(c, 'qualification') };
    });
  }

  private columns(
    t: ScoreTableName,
    classes: string[],
    o: { qualification: string[]; locality: string[]; passout: string[]; schools: string[] } = {
      qualification: [],
      locality: [],
      passout: [],
      schools: [],
    },
  ): TemplateColumn[] {
    const pick = (options: string[]) =>
      options.length ? { options, allowNew: true as const } : {};
    if (t === 'qualification')
      return [
        { header: 'Qualification', width: 34, required: true, ...pick(o.qualification) },
        { header: 'Father score', width: 14, format: 'number' },
        { header: 'Mother score', width: 14, format: 'number' },
        { header: 'Father weight', width: 14, format: 'number' },
        { header: 'Mother weight', width: 14, format: 'number' },
      ];
    if (t === 'locality')
      return [
        { header: 'Locality', width: 34, required: true, ...pick(o.locality) },
        { header: 'Class', width: 16, options: classes, note: 'empty: every class' },
        { header: 'Distance band', width: 16, note: 'e.g. 0-8 km, 8-15 km, 15-above' },
        { header: 'Area', width: 10 },
        { header: 'Score', width: 10, required: true, format: 'number' },
      ];
    return [
      { header: 'School', width: 34, required: true, ...pick(o.schools) },
      {
        header: 'Pass-out class',
        width: 16,
        required: true,
        note: 'as the form asks it (e.g. X, XII); 10 and X are the same',
        ...pick(o.passout.length ? o.passout : ['X', 'XII']),
      },
      { header: 'Score', width: 10, required: true, format: 'number' },
    ];
  }

  /** The table as an Excel sheet to correct and upload again (the rows in it), or an empty format. */
  async sheet(ctx: RequestContext, table: string, withRows: boolean) {
    const t = this.table(table);
    const { rows, classes, options, school } = await this.db.tenant(
      requireTenant(ctx),
      async (c) => ({
        rows: await this.rowsWith(c, t),
        classes: await this.classesWith(c),
        options: await this.optionsWith(c),
        school: (
          await c.query<{ name: string }>(
            `SELECT name FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]?.name,
      }),
    );
    const cells = (r: ScoreRow): Array<string | number | null> =>
      t === 'qualification'
        ? [r.name, r.fatherScore!, r.motherScore!, r.fatherWeight!, r.motherWeight!]
        : t === 'locality'
          ? [r.name, r.className ?? '', r.band ?? '', r.area ?? '', r.score!]
          : [r.name, r.passoutClass!, r.score!];
    const bytes = await templateSheet({
      sheet: TITLE[t],
      columns: this.columns(
        t,
        classes.map((x) => x.name),
        options,
      ),
      guide: [
        'One row a line of the table. A row whose name (and class, or pass-out class) is already in the table changes it; a new one is added.',
        'Rows left out of the sheet stay as they are; archive a line on the screen to take it out.',
        'If a row is wrong nothing is saved: correct the rows listed and upload the sheet again.',
      ],
      rows: withRows ? rows.map(cells) : undefined,
      examples:
        t === 'qualification'
          ? [
              [options.qualification[0] ?? 'Graduate', 13, 14, 0, 0],
              [options.qualification[1] ?? 'Senior Secondary', 9, 10, 0, 0],
            ]
          : t === 'locality'
            ? [
                [options.locality[0] ?? 'Sunder Vihar', '', '8-15 km', 'C', 30],
                ['Beyond 15 km', '', '15-above', 'D', 20],
              ]
            : [
                [school ?? 'Our school', 'XII', 12],
                [school ?? 'Our school', 'X', 10],
              ],
    });
    return {
      bytes,
      filename: `${TITLE[t].toLowerCase().replace(/\s+/g, '-')}${withRows ? '' : '-format'}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** The table as a PDF on the school's letterhead. */
  async pdf(ctx: RequestContext, table: string) {
    const t = this.table(table);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await this.rowsWith(c, t);
      const sc = (
        await c.query<{
          name: string;
          address: string | null;
          contact: string | null;
          logo: string | null;
        }>(
          `SELECT name, NULLIF(concat_ws(', ', NULLIF(btrim(address->>'line1'), ''), NULLIF(btrim(address->>'city'), ''), NULLIF(btrim(address->>'state'), '')), '') AS address,
                  NULLIF(btrim(contact->>'phone'), '') AS contact, NULLIF(branding->>'logoFileId', '') AS logo
             FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!;
      const cols =
        t === 'qualification'
          ? [
              { h: 'Qualification', w: 215 },
              { h: 'Father score', w: 75 },
              { h: 'Mother score', w: 75 },
              { h: 'Father weight', w: 75 },
              { h: 'Mother weight', w: 75 },
            ]
          : t === 'locality'
            ? [
                { h: 'Locality', w: 185 },
                { h: 'Class', w: 90 },
                { h: 'Distance band', w: 100 },
                { h: 'Area', w: 60 },
                { h: 'Score', w: 80 },
              ]
            : [
                { h: 'School', w: 255 },
                { h: 'Pass-out class', w: 130 },
                { h: 'Score', w: 130 },
              ];
      const bytes = await tablePdf({
        school: {
          name: sc.name,
          address: sc.address,
          contact: sc.contact ? `Phone ${sc.contact}` : null,
        },
        logo: await this.core.fileBytes(c, sc.logo),
        title: `Merit score table: ${TITLE[t]}`,
        subtitle: `${String(rows.length)} lines`,
        columns: cols,
        rows: rows.map((r) =>
          (t === 'qualification'
            ? [r.name, r.fatherScore, r.motherScore, r.fatherWeight, r.motherWeight]
            : t === 'locality'
              ? [r.name, r.className ?? 'Every class', r.band ?? '', r.area ?? '', r.score]
              : [r.name, r.passoutClass, r.score]
          ).map((v) => String(v ?? '')),
        ),
        printedAt: new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      });
      return {
        bytes,
        filename: `${TITLE[t].toLowerCase().replace(/\s+/g, '-')}.pdf`,
        contentType: 'application/pdf',
      };
    });
  }

  /** A sheet in: every row checked first, then all saved (a row matching one in the table changes it). */
  async importSheet(ctx: RequestContext, table: string, fileBase64: string) {
    const t = this.table(table);
    const headers = this.columns(t, []).map((x) => x.header);
    const rows = await readSheet(fileBase64, headers);
    if (!rows.length)
      throw new DomainError('validation-failed', 'The sheet has no filled row', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const classes = new Map(
        (await this.classesWith(c)).map((x) => [x.name.trim().toLowerCase(), x.id]),
      );
      const existing = await this.rowsWith(c, t);
      const keyOf = (name: string, extra: string | null) =>
        `${name.trim().toLowerCase()}|${(extra ?? '').trim().toLowerCase()}`;
      const byKey = new Map(
        existing.map((r) => [
          keyOf(
            r.name,
            t === 'locality' ? (r.classId ?? '') : t === 'alumni_school' ? r.passoutClass! : '',
          ),
          r.id,
        ]),
      );
      const errors: Array<{ row: number; message: string }> = [];
      const ready: Array<{ row: number; id: string | null; dto: ScoreRowDto }> = [];
      const seen = new Set<string>();
      const numberIn = (v: string, label: string, row: number) => {
        if (v === '') return 0;
        const n = Number(v);
        if (!Number.isFinite(n) || Math.abs(n) > 1000) {
          errors.push({ row, message: `${label} “${v}” is not a number` });
          return 0;
        }
        return n;
      };
      for (const { row, cells } of rows) {
        const v = (k: string) => (cells[k] ?? '').trim();
        const name = v(headers[0]!);
        if (!name) {
          errors.push({ row, message: `the ${headers[0]!.toLowerCase()} is missing` });
          continue;
        }
        if (name.length > 120) {
          errors.push({ row, message: 'the name is longer than 120 letters' });
          continue;
        }
        let dto: ScoreRowDto;
        let extra = '';
        if (t === 'qualification') {
          dto = {
            name,
            fatherScore: numberIn(v('Father score'), 'Father score', row),
            motherScore: numberIn(v('Mother score'), 'Mother score', row),
            fatherWeight: numberIn(v('Father weight'), 'Father weight', row),
            motherWeight: numberIn(v('Mother weight'), 'Mother weight', row),
          };
        } else if (t === 'locality') {
          const cls = v('Class');
          const classId = cls ? (classes.get(cls.toLowerCase()) ?? null) : null;
          if (cls && !classId) {
            errors.push({ row, message: `class “${cls}” is not a class of the school` });
            continue;
          }
          if (v('Score') === '') {
            errors.push({ row, message: 'the score is missing' });
            continue;
          }
          dto = {
            name,
            classId,
            band: v('Distance band') || null,
            area: v('Area') || null,
            score: numberIn(v('Score'), 'Score', row),
          };
          extra = classId ?? '';
        } else {
          const passout = v('Pass-out class');
          if (!passout) {
            errors.push({ row, message: 'the pass-out class is missing' });
            continue;
          }
          if (v('Score') === '') {
            errors.push({ row, message: 'the score is missing' });
            continue;
          }
          dto = { name, passoutClass: passout, score: numberIn(v('Score'), 'Score', row) };
          extra = passout;
        }
        const k = keyOf(name, extra);
        if (seen.has(k)) {
          errors.push({ row, message: `“${name}” is in the sheet twice` });
          continue;
        }
        seen.add(k);
        ready.push({ row, id: byKey.get(k) ?? null, dto });
      }
      if (errors.length)
        throw new DomainError(
          'validation-failed',
          `${String(errors.length)} row${errors.length === 1 ? ' needs' : 's need'} attention; nothing was saved`,
          { status: 400, extra: { rows: errors.slice(0, 50) } },
        );
      for (const r of ready) await this.putWith(c, t, r.id, r.dto);
      const added = ready.filter((r) => !r.id).length;
      await this.audit.stage(ctx, c, {
        action: 'admissions.score_table.import',
        entityType: SQL_TABLE[t],
        after: { added, changed: ready.length - added },
      });
      return { added, changed: ready.length - added, rows: await this.rowsWith(c, t) };
    });
  }
}
