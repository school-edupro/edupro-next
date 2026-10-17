import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import type { DietFileDto, DietListDto, DietTypesDto, DietUploadDto } from './hostel-mess.dto';
import { HostelService } from './hostel.service';

type Row = Record<string, unknown>;
export interface DietType {
  id: string;
  code: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  used: number;
}
export interface DietRow {
  studentId: string;
  name: string;
  admissionNo: string | null;
  hostelId: string;
  hostel: string;
  room: string | null;
  diet: string;
  dietName: string;
  noOnionGarlic: boolean;
  allergies: string[];
  notes: string | null;
  /** The allergy written on the student record. */
  allergy: string | null;
  set: boolean;
  updatedAt: string | null;
}
export interface Allergy {
  id: string;
  name: string;
  active: boolean;
  used: number;
}

/** The allergy written on the student record (medical condition), unless it says "none". */
export const RECORD_ALLERGY = `CASE WHEN lower(btrim(COALESCE(st.profile->>'medical_condition', ''))) IN ('', 'na', 'n/a', 'nil', 'none', 'no', '-', '--', 'not applicable')
  THEN NULL ELSE btrim(st.profile->>'medical_condition') END`;

/**
 * The school's diet types and allergies; the first read makes the five the hostel began with (veg the
 * default) and a short allergy list.
 */
export async function dietLists(
  c: PoolClient,
): Promise<{ types: DietType[]; allergies: Allergy[] }> {
  await c.query(
    `INSERT INTO mess_diet_types (school_id, code, name, sort_order, is_default)
     SELECT app.current_school_id(), x.code, x.name, x.n, x.code = 'veg'
       FROM (VALUES ('veg', 'Vegetarian', 1), ('non_veg', 'Non-vegetarian', 2), ('eggetarian', 'Eggetarian', 3),
                    ('jain', 'Jain', 4), ('vegan', 'Vegan', 5)) AS x(code, name, n)
      WHERE NOT EXISTS (SELECT 1 FROM mess_diet_types)`,
  );
  await c.query(
    `INSERT INTO mess_allergies (school_id, name)
     SELECT app.current_school_id(), x.name FROM (VALUES ('Peanuts'), ('Tree nuts'), ('Milk / lactose'), ('Gluten'), ('Egg'),
            ('Soy'), ('Fish'), ('Shellfish')) AS x(name)
      WHERE NOT EXISTS (SELECT 1 FROM mess_allergies)`,
  );
  const t = await c.query<Row>(
    `SELECT t.id::text, t.code, t.name, t.active, t.is_default,
            (SELECT count(*) FROM hostel_diets d WHERE d.diet = t.code)::int AS used
       FROM mess_diet_types t ORDER BY t.sort_order, t.name`,
  );
  const a = await c.query<Row>(
    `SELECT a.id::text, a.name, a.active,
            (SELECT count(*) FROM hostel_diets d WHERE a.name = ANY (d.allergies))::int AS used
       FROM mess_allergies a ORDER BY a.name`,
  );
  return {
    types: t.rows.map((x) => ({
      id: String(x.id),
      code: String(x.code),
      name: String(x.name),
      active: Boolean(x.active),
      isDefault: Boolean(x.is_default),
      used: Number(x.used),
    })),
    allergies: a.rows.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      active: Boolean(x.active),
      used: Number(x.used),
    })),
  };
}

const HEADERS = ['Admission no.', 'Pupil', 'Diet', 'No onion-garlic', 'Allergies', 'Notes'];

/**
 * The kitchen's diet list (0161): every boarder of the hostels the person sees, with the diet the hostel
 * keeps (the school's default when none is set), no onion-garlic, the allergies and the allergy on the
 * student record. Filters, pages, Excel and PDF, an Excel upload, and the school's diet types and
 * allergies.
 */
@Injectable()
export class HostelDietsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hostel: HostelService,
  ) {}

  async lists(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => dietLists(c));
  }

  /** Save the diet types and allergies; one in use must be the default; one in use by a boarder stays. */
  async saveLists(ctx: RequestContext, dto: DietTypesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await dietLists(c);
      for (const t of before.types.filter((x) => !dto.types.some((y) => y.id === x.id)))
        if (t.used)
          throw new DomainError(
            'hostel.diet_used',
            `${t.name} is the diet of ${String(t.used)} boarder(s): switch it off instead`,
            { status: 409 },
          );
        else await c.query(`DELETE FROM mess_diet_types WHERE id = $1`, [t.id]);
      for (const a of before.allergies.filter((x) => !dto.allergies.some((y) => y.id === x.id)))
        if (a.used)
          throw new DomainError(
            'hostel.allergy_used',
            `${a.name} is on ${String(a.used)} boarder(s): switch it off instead`,
            { status: 409 },
          );
        else await c.query(`DELETE FROM mess_allergies WHERE id = $1`, [a.id]);
      // the default moves in two steps (one default per school)
      await c.query(`UPDATE mess_diet_types SET is_default = false`);
      for (const [i, t] of dto.types.entries()) {
        const was = before.types.find((x) => x.id === t.id);
        if (was && was.code !== t.code && was.used)
          throw new DomainError(
            'hostel.diet_used',
            `The code of ${was.name} cannot change: boarders have it`,
            { status: 409 },
          );
        try {
          if (was)
            await c.query(
              `UPDATE mess_diet_types SET code = $2, name = $3, active = $4, is_default = $5, sort_order = $6 WHERE id = $1`,
              [t.id, t.code, t.name, t.active, t.isDefault && t.active, i + 1],
            );
          else
            await c.query(
              `INSERT INTO mess_diet_types (school_id, code, name, active, is_default, sort_order)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
              [t.code, t.name, t.active, t.isDefault && t.active, i + 1],
            );
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new DomainError('hostel.diet_taken', `The code ${t.code} is taken`, {
              status: 409,
            });
          throw e;
        }
      }
      for (const a of dto.allergies) {
        const was = before.allergies.find((x) => x.id === a.id);
        try {
          if (was) {
            await c.query(`UPDATE mess_allergies SET name = $2, active = $3 WHERE id = $1`, [
              a.id,
              a.name,
              a.active,
            ]);
            // a renamed allergy follows on the boarders who have it
            if (was.name !== a.name)
              await c.query(
                `UPDATE hostel_diets SET allergies = array_replace(allergies, $1, $2) WHERE $1 = ANY (allergies)`,
                [was.name, a.name],
              );
          } else
            await c.query(
              `INSERT INTO mess_allergies (school_id, name, active) VALUES (app.current_school_id(), $1, $2)`,
              [a.name, a.active],
            );
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new DomainError('hostel.allergy_taken', `${a.name} is already on the list`, {
              status: 409,
            });
          throw e;
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.diet_types.save',
        entityType: 'mess_diet_types',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
      return dietLists(c);
    });
  }

  /** The boarders today (of one hostel or all the person sees) with their diet, filtered. */
  private async rows(
    ctx: RequestContext,
    c: PoolClient,
    q: Omit<DietListDto, 'page' | 'size'>,
    page?: { page: number; size: number },
  ) {
    const only = await this.hostel.scope(ctx, c);
    if (q.hostelId && only && !only.includes(q.hostelId))
      throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
        status: 403,
      });
    const lists = await dietLists(c);
    const def = lists.types.find((t) => t.isDefault)?.code ?? 'veg';
    const params: unknown[] = [
      q.hostelId ?? null,
      only,
      def,
      q.diet ?? null,
      q.allergy ?? null,
      q.set ?? null,
      q.q ?? null,
    ];
    // eslint-disable-next-line no-restricted-syntax -- RECORD_ALLERGY is a fixed SQL fragment; values are bound
    const base = `FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id LEFT JOIN hostel_blocks bl ON bl.id = r.block_id JOIN students st ON st.id = a.student_id
         LEFT JOIN hostel_diets d ON d.student_id = st.id
        WHERE a.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
          AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
          AND ($1::bigint IS NULL OR h.id = $1) AND ($2::bigint[] IS NULL OR h.id = ANY ($2::bigint[]))
          AND ($4::text IS NULL OR COALESCE(d.diet, $3) = $4)
          AND ($5::text IS NULL OR $5 = ANY (COALESCE(d.allergies, '{}')) OR ($5 = '_record' AND ${RECORD_ALLERGY} IS NOT NULL))
          AND ($6::text IS NULL OR ($6 = 'set') = (d.student_id IS NOT NULL))
          AND ($7::text IS NULL OR st.search_text LIKE '%' || app.search_text($7) || '%')`;
    const total = await c.query<{ n: number }>(
      // eslint-disable-next-line no-restricted-syntax -- the FROM/WHERE is a constant; values bound
      `SELECT count(*)::int AS n ${base}`,
      params,
    );
    const counts = await c.query<{ diet: string; n: number }>(
      // eslint-disable-next-line no-restricted-syntax -- the FROM/WHERE is a constant; values bound
      `SELECT COALESCE(d.diet, $3) AS diet, count(*)::int AS n ${base} GROUP BY 1`,
      params,
    );
    const limit = page
      ? // eslint-disable-next-line no-restricted-syntax -- LIMIT/OFFSET from validated numbers
        `LIMIT ${String(page.size)} OFFSET ${String((page.page - 1) * page.size)}`
      : 'LIMIT 5000';
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- the FROM/WHERE is a constant, LIMIT built from numbers; values bound
      `SELECT st.id::text AS "studentId", st.display_name AS name, st.admission_no AS "admissionNo", h.id::text AS "hostelId", h.name AS hostel,
              COALESCE(bl.name || '-', '') || r.room_no AS room, COALESCE(d.diet, $3) AS diet,
              COALESCE(d.no_onion_garlic, false) AS "noOnionGarlic", COALESCE(d.allergies, '{}') AS allergies, d.notes,
              ${RECORD_ALLERGY} AS allergy, d.student_id IS NOT NULL AS set, d.updated_at AS "updatedAt"
       ${base} ORDER BY h.name, st.display_name, st.id ${limit}`,
      params,
    );
    const name = (code: string) => lists.types.find((t) => t.code === code)?.name ?? code;
    return {
      lists,
      total: total.rows[0]!.n,
      counts: counts.rows.map((x) => ({ diet: x.diet, name: name(x.diet), n: x.n })),
      data: r.rows.map((x) => ({ ...x, dietName: name(String(x.diet)) }) as unknown as DietRow),
    };
  }

  async list(ctx: RequestContext, q: DietListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.rows(ctx, c, q, { page: q.page, size: q.size });
      return { ...r, page: q.page, size: q.size };
    });
  }

  async file(ctx: RequestContext, q: DietFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.rows(ctx, c, q);
      const head = await schoolHead(c);
      const hostel = q.hostelId ? String(r.data[0]?.hostel ?? '') : 'All hostels';
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Kitchen diet list',
          details: [
            hostel,
            r.counts.map((x) => `${x.name} ${String(x.n)}`).join(' · '),
            generatedOn(),
          ].filter(Boolean),
          legend: "Allergy on record: the medical condition written on the pupil's record.",
          columns: [
            { label: 'Sl.', width: 3, right: true },
            { label: 'Pupil', width: 16 },
            { label: 'Adm. no.', width: 7 },
            { label: 'Hostel', width: 10 },
            { label: 'Room', width: 5 },
            { label: 'Diet', width: 9 },
            { label: 'No onion-garlic', width: 6 },
            { label: 'Allergies', width: 14 },
            { label: 'On record', width: 12 },
            { label: 'Notes', width: 14 },
          ],
          rows: r.data.map((x, i) => [
            i + 1,
            String(x.name),
            String(x.admissionNo ?? ''),
            String(x.hostel),
            String(x.room ?? ''),
            String(x.dietName),
            x.noOnionGarlic ? 'Yes' : '',
            (x.allergies as string[]).join(', '),
            String(x.allergy ?? ''),
            String(x.notes ?? ''),
          ]),
          filename: 'hostel-diet-list',
        },
        q.format,
      );
    });
  }

  /** Back to the school's default diet (no allergies, no notes). */
  async clear(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await c.query<{ id: string | null }>(
        `SELECT app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS id`,
        [studentId],
      );
      const only = await this.hostel.scope(ctx, c);
      if (only && !only.includes(h.rows[0]?.id ?? ''))
        throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
          status: 403,
        });
      const r = await c.query(`DELETE FROM hostel_diets WHERE student_id = $1`, [studentId]);
      if (!r.rowCount)
        throw new DomainError('not-found', 'No diet is set for this pupil', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'hostel.diet.clear',
        entityType: 'student',
        entityId: studentId,
      });
      return { ok: true };
    });
  }

  /** The upload format: the boarders of the hostel(s) with what is set now, drop-downs for diet and yes/no. */
  async template(ctx: RequestContext, hostelId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.rows(ctx, c, { hostelId });
      const typeNames = r.lists.types.filter((t) => t.active).map((t) => t.name);
      return {
        bytes: await templateSheet({
          sheet: 'Diets',
          columns: [
            { header: 'Admission no.', width: 16, required: true },
            { header: 'Pupil', width: 28 },
            { header: 'Diet', width: 18, required: true, options: typeNames },
            { header: 'No onion-garlic', width: 16, options: ['Yes', 'No'] },
            { header: 'Allergies', width: 32 },
            { header: 'Notes', width: 40 },
          ],
          guide: [
            'One row per boarder. The admission number finds the pupil; the name is only for you.',
            `Diet: one of ${typeNames.join(', ')} (Hostel → Mess → Diet types).`,
            `Allergies: names from the school's list separated by commas: ${r.lists.allergies
              .filter((a) => a.active)
              .map((a) => a.name)
              .join(', ')}.`,
            'A pupil must hold a hostel bed today. Nothing is saved when any row has a mistake: correct it and upload again.',
          ],
          rows: r.data.map((x) => [
            String(x.admissionNo ?? ''),
            String(x.name),
            String(x.dietName),
            x.noOnionGarlic ? 'Yes' : 'No',
            (x.allergies as string[]).join(', '),
            String(x.notes ?? ''),
          ]),
        }),
        filename: 'hostel-diets.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    });
  }

  /** The diets from an uploaded sheet; every row is checked first and nothing is saved on a mistake. */
  async upload(ctx: RequestContext, dto: DietUploadDto) {
    const rows = await readSheet(dto.fileBase64, HEADERS);
    if (!rows.length)
      throw new DomainError('validation-failed', 'The sheet has no filled row', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const lists = await dietLists(c);
      const errors: Array<{ row: number; message: string }> = [];
      const ready: Array<{
        studentId: string;
        diet: string;
        nog: boolean;
        allergies: string[];
        notes: string | null;
      }> = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const adm = r.cells['Admission no.']!;
        const p = (
          await c.query<{ id: string; hostel: string | null }>(
            `SELECT st.id::text, app.hostel_of(st.id, (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS hostel
               FROM students st WHERE lower(st.admission_no) = lower($1) AND st.deleted_at IS NULL LIMIT 1`,
            [adm],
          )
        ).rows[0];
        const fail = (message: string) => errors.push({ row: r.row, message });
        if (!adm) {
          fail('Admission no. is empty');
          continue;
        }
        if (!p) {
          fail(`No pupil with admission no. ${adm}`);
          continue;
        }
        if (!p.hostel) {
          fail(`${adm} holds no hostel bed today`);
          continue;
        }
        if (only && !only.includes(p.hostel)) {
          fail(`${adm} is not in your hostel`);
          continue;
        }
        if (seen.has(p.id)) {
          fail(`${adm} is on the sheet twice`);
          continue;
        }
        seen.add(p.id);
        const typed = r.cells.Diet!.toLowerCase();
        const t = lists.types.find(
          (x) => x.active && (x.name.toLowerCase() === typed || x.code === typed),
        );
        if (!t) {
          fail(`Diet "${r.cells.Diet!}" is not a diet type in use`);
          continue;
        }
        const yn = r.cells['No onion-garlic']!.toLowerCase();
        if (yn && !['yes', 'no', 'y', 'n'].includes(yn)) {
          fail('No onion-garlic: Yes or No');
          continue;
        }
        const allergies: string[] = [];
        let bad = '';
        for (const a of r.cells
          .Allergies!.split(/[,;]/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          const hit = lists.allergies.find(
            (x) => x.active && x.name.toLowerCase() === a.toLowerCase(),
          );
          if (hit) allergies.push(hit.name);
          else bad = a;
        }
        if (bad) {
          fail(`Allergy "${bad}" is not on the school's list`);
          continue;
        }
        const notes = r.cells.Notes!.slice(0, 200) || null;
        ready.push({ studentId: p.id, diet: t.code, nog: yn.startsWith('y'), allergies, notes });
      }
      if (errors.length) return { saved: 0, errors };
      for (const x of ready)
        await c.query(
          `INSERT INTO hostel_diets (student_id, school_id, diet, no_onion_garlic, allergies, notes, updated_by)
           VALUES ($1, app.current_school_id(), $2, $3, $4::text[], $5, app.current_user_id())
           ON CONFLICT (student_id) DO UPDATE SET diet = EXCLUDED.diet, no_onion_garlic = EXCLUDED.no_onion_garlic,
                allergies = EXCLUDED.allergies, notes = EXCLUDED.notes, updated_at = now(), updated_by = app.current_user_id()`,
          [x.studentId, x.diet, x.nog, [...new Set(x.allergies)], x.notes],
        );
      await this.audit.stage(ctx, c, {
        action: 'hostel.diet.upload',
        entityType: 'hostel_diets',
        entityId: requireTenant(ctx).schoolId,
        after: { rows: ready.length },
      });
      return { saved: ready.length, errors: [] };
    });
  }
}
