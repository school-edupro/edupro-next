import { Injectable } from '@nestjs/common';
import {
  ADMISSION_FORM_TEMPLATES,
  EDITABLE_PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  PROFILE_LIST_DEFAULTS,
  defProblems,
  loadProfileLists,
  type AdmissionAnswers,
  type AdmissionField,
  type AdmissionFormDef,
  type PoolClient,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CopyFormDto, SaveFormDto, UpdateFormDto } from './forms.dto';

export interface FormRow {
  id: string;
  name: string;
  description: string | null;
  def: AdmissionFormDef;
  status: 'active' | 'archived';
  template: string | null;
  usedBy: Array<{ cycle: string; className: string }>;
  updatedAt: string;
  updatedBy: string | null;
}

/** Document kinds a file field may file under on Admit (photos of the parents go to their records). */
export const ADMISSION_DOC_KINDS: Array<{ id: string; label: string }> = [
  { id: 'photo', label: 'Student photo' },
  { id: 'father_photo', label: 'Father photo' },
  { id: 'mother_photo', label: 'Mother photo' },
  { id: 'guardian_photo', label: 'Guardian photo' },
  { id: 'birth_certificate', label: 'Birth certificate' },
  { id: 'address_proof', label: 'Residence proof' },
  { id: 'aadhaar', label: 'Aadhaar card' },
  { id: 'transfer_certificate', label: 'Transfer certificate' },
  { id: 'category_certificate', label: 'Caste / category certificate' },
  { id: 'medical', label: 'Medical / disability certificate' },
  { id: 'qualification', label: 'Previous report card / certificate' },
  { id: 'alumni_proof', label: 'Alumni proof' },
  { id: 'sibling_proof', label: 'Sibling proof' },
  { id: 'achievement', label: 'Achievement certificate' },
  { id: 'other', label: 'Other document' },
];

const GEO: Record<string, string> = { cities: 'City', states: 'State', countries: 'Country' };

/**
 * Admission forms (docs/design/39, part 1): the form builder's forms — tabs, fields, rules, the
 * mapping to the student master — and the options each field offers from the school's lists and masters.
 */
@Injectable()
export class AdmissionFormsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Every option list a form may use, by list code and master (the builder and the fill screens). */
  async optionsWith(c: PoolClient): Promise<Record<string, string[]>> {
    const lists = await loadProfileLists(c);
    const out: Record<string, string[]> = {};
    for (const code of Object.keys(PROFILE_LIST_DEFAULTS))
      out[code] = lists[code]?.length ? lists[code]! : (PROFILE_LIST_DEFAULTS[code] ?? []);
    for (const [code, values] of Object.entries(lists)) out[code] = values;
    const classes = await c.query<{ name: string }>(
      `SELECT name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
    );
    out['@classes'] = classes.rows.map((x) => x.name);
    const subjects = await c.query<{ name: string }>(
      `SELECT DISTINCT name FROM subjects WHERE deleted_at IS NULL ORDER BY name`,
    );
    out['@subjects'] = subjects.rows.map((x) => x.name);
    out['@cities'] = out.City ?? [];
    out['@states'] = out.State ?? [];
    out['@countries'] = out.Country ?? [];
    out['@houses'] = out.House ?? [];
    // each state's cities (System setup → cities), for a city list that follows a state field
    const byState = await c.query<{ state: string; cities: string[] }>(
      `SELECT st.name AS state, array_agg(ci.name ORDER BY ci.name) AS cities
         FROM cities ci JOIN states st ON st.id = ci.state_id
        WHERE ci.status = 'active' AND st.status = 'active' GROUP BY st.name`,
    );
    for (const r of byState.rows) out[`@cities@${r.state}`] = r.cities;
    return out;
  }

  /** The options of one field: typed, a school list, or a master. */
  static optionsOf(
    f: AdmissionField,
    all: Record<string, string[]>,
    answers?: AdmissionAnswers,
  ): string[] | undefined {
    if (f.options?.length) return f.options;
    // a city list that follows a state field: that state's cities (all of them when the state has none
    // set up); nothing until a state is chosen
    if (f.source === 'cities' && f.dependsOn && answers) {
      const st = answers[f.dependsOn];
      if (typeof st !== 'string' || !st) return [];
      return all[`@cities@${st}`] ?? all['@cities'] ?? [];
    }
    if (f.list) return all[f.list] ?? [];
    if (f.source) return all[`@${f.source}`] ?? [];
    if (f.type === 'yesno') return undefined;
    return undefined;
  }

  async meta(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const options = await this.optionsWith(c);
      const extra = await c.query<{
        key: string;
        label: string;
        type: string;
        list: string | null;
      }>(
        `SELECT key, label, type, list FROM student_extra_fields WHERE status = 'active' ORDER BY sort_order, label`,
      );
      return {
        templates: ADMISSION_FORM_TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          steps: t.def.steps.length,
          fields: t.def.fields.length,
        })),
        options,
        lists: Object.keys(options)
          .filter((k) => !k.startsWith('@'))
          .sort(),
        studentFields: EDITABLE_PROFILE_FIELDS.filter((f) => f.section !== 'documents').map(
          (f) => ({
            key: f.key,
            label: f.label,
            section: f.section,
            type: f.type,
            list: f.list ?? null,
          }),
        ),
        extraFields: extra.rows,
        docKinds: ADMISSION_DOC_KINDS,
      };
    });
  }

  private async rowWith(c: PoolClient, id: string): Promise<FormRow> {
    const r = await c.query<{
      id: string;
      name: string;
      description: string | null;
      def: AdmissionFormDef;
      status: 'active' | 'archived';
      template: string | null;
      updated_at: Date;
      updated_by: string | null;
    }>(
      `SELECT f.id::text, f.name, f.description, f.def, f.status, f.template, f.updated_at, u.display_name AS updated_by
         FROM admission_forms f LEFT JOIN users u ON u.id = f.updated_by WHERE f.id = $1`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Form not found', { status: 404 });
    const used = await c.query<{ cycle: string; class_name: string }>(
      `SELECT y.name AS cycle, cl.name AS class_name FROM admission_class_criteria k
         JOIN admission_cycles y ON y.id = k.cycle_id JOIN classes cl ON cl.id = k.class_id
        WHERE k.form_id = $1 AND y.deleted_at IS NULL ORDER BY y.opens_at DESC, cl.display_order`,
      [id],
    );
    return {
      id: x.id,
      name: x.name,
      description: x.description,
      def: x.def,
      status: x.status,
      template: x.template,
      usedBy: used.rows.map((u) => ({ cycle: u.cycle, className: u.class_name })),
      updatedAt: x.updated_at.toISOString(),
      updatedBy: x.updated_by,
    };
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        steps: number;
        fields: number;
        used: number;
        updated_at: Date;
      }>(
        `SELECT f.id::text, f.name, f.description, f.status, jsonb_array_length(f.def->'steps') AS steps,
                jsonb_array_length(f.def->'fields') AS fields,
                (SELECT count(*)::int FROM admission_class_criteria k WHERE k.form_id = f.id) AS used, f.updated_at
           FROM admission_forms f ORDER BY f.status, f.name`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        status: x.status,
        steps: x.steps,
        fields: x.fields,
        classes: x.used,
        updatedAt: x.updated_at.toISOString(),
      }));
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const form = await this.rowWith(c, id);
      return { ...form, options: await this.optionsWith(c) };
    });
  }

  /** The builder's checks plus the student-master mapping; creates the additional fields asked for. */
  private async check(c: PoolClient, def: AdmissionFormDef): Promise<void> {
    const problems = defProblems(def);
    const options = await this.optionsWith(c);
    const mappedTwice = new Map<string, string>();
    for (const f of def.fields) {
      if (f.list && !options[f.list])
        problems.push(`${f.label}: the list ${f.list} does not exist`);
      if (f.maps) {
        const m = PROFILE_FIELD_BY_KEY.get(f.maps);
        if (!m || m.store.t === 'auto' || m.store.t === 'enrol')
          problems.push(`${f.label}: the student-master field ${f.maps} cannot take a value`);
        else {
          if (m.list) {
            const same =
              f.list === m.list || (f.source && GEO[f.source] === m.list) || f.type === 'yesno';
            if (!same)
              problems.push(
                `${f.label}: use the ${m.list} list, as the student-master field ${m.label} does`,
              );
          }
          const other = mappedTwice.get(f.maps);
          // the same master field from two form fields is fine only when they never both show
          // (e.g. Class IX and XI wording); the builder warns, the mapping keeps the last answered
          if (other && !(f.rules?.length || def.fields.find((x) => x.key === other)?.rules?.length))
            problems.push(`${f.label} and another field both fill ${m.label}`);
          mappedTwice.set(f.maps, f.key);
        }
      }
      if ((f.type === 'file' || f.type === 'photo') && f.docKind)
        if (!ADMISSION_DOC_KINDS.some((k) => k.id === f.docKind))
          problems.push(`${f.label}: unknown document kind ${f.docKind}`);
    }
    if (problems.length)
      throw new DomainError('validation-failed', problems.slice(0, 8).join('. '), {
        status: 400,
        extra: { errors: problems },
      });
    // "copy to student master": an additional field per answer the catalogue has no field for
    for (const [i, f] of def.fields.entries()) {
      if (!f.copy || f.maps || f.type === 'file' || f.type === 'photo') continue;
      if (PROFILE_FIELD_BY_KEY.has(f.key)) continue;
      await c.query(
        `INSERT INTO student_extra_fields (school_id, key, label, type, list, sort_order, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
         ON CONFLICT (school_id, key) DO UPDATE SET status = 'active'`,
        [f.key, f.label.slice(0, 120), f.type, f.list ?? null, i],
      );
    }
  }

  async create(ctx: RequestContext, dto: SaveFormDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const def =
        (dto.def as AdmissionFormDef | undefined) ??
        structuredClone(ADMISSION_FORM_TEMPLATES.find((t) => t.id === dto.template)!.def);
      await this.check(c, def);
      const r = await c
        .query<{ id: string }>(
          `INSERT INTO admission_forms (school_id, name, description, def, template, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [dto.name, dto.description ?? null, JSON.stringify(def), dto.template ?? null],
        )
        .catch((e: { code?: string }) => {
          if (e.code === '23505')
            throw new DomainError('conflict', 'A form with this name already exists', {
              status: 409,
            });
          throw e;
        });
      await this.audit.stage(ctx, c, {
        action: 'admissions.form.create',
        entityType: 'admission_forms',
        entityId: r.rows[0]!.id,
        after: { name: dto.name, template: dto.template ?? null, fields: def.fields.length },
      });
      return this.rowWith(c, r.rows[0]!.id);
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateFormDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.rowWith(c, id);
      const def = dto.def as AdmissionFormDef;
      await this.check(c, def);
      await c
        .query(
          `UPDATE admission_forms SET name = $2, description = $3, def = $4::jsonb, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, dto.name, dto.description ?? null, JSON.stringify(def)],
        )
        .catch((e: { code?: string }) => {
          if (e.code === '23505')
            throw new DomainError('conflict', 'A form with this name already exists', {
              status: 409,
            });
          throw e;
        });
      await this.audit.stage(ctx, c, {
        action: 'admissions.form.update',
        entityType: 'admission_forms',
        entityId: id,
        before: { name: before.name, fields: before.def.fields.length },
        after: { name: dto.name, fields: def.fields.length },
      });
      return this.rowWith(c, id);
    });
  }

  async copy(ctx: RequestContext, id: string, dto: CopyFormDto) {
    const src = await this.db.tenant(requireTenant(ctx), (c) => this.rowWith(c, id));
    return this.create(ctx, {
      name: dto.name,
      description: src.description ?? undefined,
      def: src.def,
    } as SaveFormDto);
  }

  async setStatus(ctx: RequestContext, id: string, status: 'active' | 'archived') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.rowWith(c, id);
      if (status === 'archived') {
        const open = await c.query(
          `SELECT 1 FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id
            WHERE k.form_id = $1 AND y.status = 'open' AND y.deleted_at IS NULL LIMIT 1`,
          [id],
        );
        if (open.rowCount)
          throw new DomainError(
            'admissions.form_in_use',
            'An open admission session uses this form; close it or pick another form first',
            { status: 409 },
          );
      }
      await c.query(
        `UPDATE admission_forms SET status = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, status],
      );
      await this.audit.stage(ctx, c, {
        action: `admissions.form.${status === 'archived' ? 'archive' : 'restore'}`,
        entityType: 'admission_forms',
        entityId: id,
      });
      return this.rowWith(c, id);
    });
  }
}
