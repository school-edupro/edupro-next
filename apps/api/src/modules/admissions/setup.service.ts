import { Injectable } from '@nestjs/common';
import type { AdmissionCondition, PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { qrPng } from '../engagement/visitor-card';
import { vacancyPosterPdf } from '../people/vacancy-poster';
import type {
  AdmissionSettingsDto,
  FeeCategoriesDto,
  SessionClassesDto,
  SessionFeesDto,
  SessionSettingsDto,
} from './setup.dto';

export interface AdmissionSettings {
  signinChannels: Array<'email' | 'sms' | 'whatsapp'>;
  regReceiptPrefix: string;
  admReceiptPrefix: string;
}
export interface FeeCategory {
  id: string;
  code: string;
  name: string;
  logic: 'all' | 'any';
  conditions: AdmissionCondition[];
  isDefault: boolean;
  status: 'active' | 'inactive';
  sortOrder: number;
}

/** What a school starts with: categories decided from the ready forms' answers. */
const DEFAULT_CATEGORIES: Array<Omit<FeeCategory, 'id' | 'status' | 'sortOrder'>> = [
  {
    code: 'ews',
    name: 'EWS / DG',
    logic: 'any',
    conditions: [{ field: 'ews', op: 'eq', value: 'Yes' }],
    isDefault: false,
  },
  {
    code: 'staff_ward',
    name: 'Staff ward',
    logic: 'any',
    conditions: [{ field: 'staff_child', op: 'not_empty' }],
    isDefault: false,
  },
  {
    code: 'sibling',
    name: 'Sibling in school',
    logic: 'any',
    conditions: [{ field: 'siblings', op: 'gt', value: '0' }],
    isDefault: false,
  },
  {
    code: 'alumni',
    name: 'Alumni parent',
    logic: 'any',
    conditions: [
      { field: 'father_alumnus', op: 'eq', value: 'Yes' },
      { field: 'mother_alumnus', op: 'eq', value: 'Yes' },
    ],
    isDefault: false,
  },
  { code: 'general', name: 'General', logic: 'any', conditions: [], isDefault: true },
];

const IST = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

/**
 * Admission set-up and sessions (docs/design/39, part 2): sign-in channels and receipt series, fee
 * categories, the session's classes (form, seats, window, eligibility) and its fee table, the public
 * link, QR and poster. Registration and admission fees post in the fee module under their own heads.
 */
@Injectable()
export class AdmissionSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async settingsWith(c: PoolClient): Promise<AdmissionSettings> {
    await c.query(
      `INSERT INTO admission_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    const r = await c.query<{
      signin_channels: string[];
      reg_receipt_prefix: string;
      adm_receipt_prefix: string;
    }>(
      `SELECT signin_channels, reg_receipt_prefix, adm_receipt_prefix FROM admission_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0]!;
    return {
      signinChannels: x.signin_channels as AdmissionSettings['signinChannels'],
      regReceiptPrefix: x.reg_receipt_prefix,
      admReceiptPrefix: x.adm_receipt_prefix,
    };
  }

  async categoriesWith(c: PoolClient, activeOnly = false): Promise<FeeCategory[]> {
    const have = await c.query(`SELECT 1 FROM admission_fee_categories LIMIT 1`);
    if (!have.rowCount)
      for (const [i, d] of DEFAULT_CATEGORIES.entries())
        await c.query(
          `INSERT INTO admission_fee_categories (school_id, code, name, conditions, logic, sort_order, is_default)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [d.code, d.name, JSON.stringify(d.conditions), d.logic, i, d.isDefault],
        );
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      logic: 'all' | 'any';
      conditions: AdmissionCondition[];
      is_default: boolean;
      status: 'active' | 'inactive';
      sort_order: number;
    }>(
      `SELECT id::text, code, name, logic, conditions, is_default, status, sort_order FROM admission_fee_categories
        WHERE ($1 = false OR status = 'active') ORDER BY sort_order, name`,
      [activeOnly],
    );
    return r.rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      logic: x.logic,
      conditions: x.conditions,
      isDefault: x.is_default,
      status: x.status,
      sortOrder: x.sort_order,
    }));
  }

  /** The fee heads registration and admission fees post under (ledger "admission"). */
  async feeHeadsWith(c: PoolClient): Promise<{ registration: string; admission: string }> {
    const out: Record<string, string> = {};
    for (const [code, name, order] of [
      ['ADMREG', 'Registration fee', 901],
      ['ADMFEE', 'Admission fee', 902],
    ] as const) {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM fee_heads WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
        [code],
      );
      out[code] =
        r.rows[0]?.id ??
        (
          await c.query<{ id: string }>(
            `INSERT INTO fee_heads (school_id, code, name, kind, ledger, refundable, sort_order, created_by)
             VALUES (app.current_school_id(), $1, $2, 'misc', 'admission', $3, $4, app.current_user_id()) RETURNING id::text`,
            [code, name, code === 'ADMFEE', order],
          )
        ).rows[0]!.id;
    }
    return { registration: out.ADMREG!, admission: out.ADMFEE! };
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      settings: await this.settingsWith(c),
      categories: await this.categoriesWith(c),
    }));
  }

  async saveSettings(ctx: RequestContext, dto: AdmissionSettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.settingsWith(c);
      if (dto.regReceiptPrefix === dto.admReceiptPrefix)
        throw new DomainError(
          'validation-failed',
          'Registration and admission receipts need different prefixes',
          { status: 400 },
        );
      await c.query(
        `UPDATE admission_settings SET signin_channels = $1, reg_receipt_prefix = $2, adm_receipt_prefix = $3, updated_at = now(), updated_by = app.current_user_id()
          WHERE school_id = app.current_school_id()`,
        [dto.signinChannels, dto.regReceiptPrefix, dto.admReceiptPrefix],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.settings',
        entityType: 'admission_settings',
        entityId: requireTenant(ctx).schoolId,
        before: { ...before },
        after: { ...dto },
      });
      return this.settingsWith(c);
    });
  }

  async saveCategories(ctx: RequestContext, dto: FeeCategoriesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.categoriesWith(c);
      for (const [i, k] of dto.categories.entries()) {
        if (k.id) {
          await c.query(
            `UPDATE admission_fee_categories SET code = $2, name = $3, logic = $4, conditions = $5::jsonb, is_default = $6, status = $7, sort_order = $8 WHERE id = $1`,
            [k.id, k.code, k.name, k.logic, JSON.stringify(k.conditions), k.isDefault, k.status, i],
          );
        } else
          await c
            .query(
              `INSERT INTO admission_fee_categories (school_id, code, name, logic, conditions, is_default, status, sort_order)
             VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6, $7)`,
              [k.code, k.name, k.logic, JSON.stringify(k.conditions), k.isDefault, k.status, i],
            )
            .catch((e: { code?: string }) => {
              if (e.code === '23505')
                throw new DomainError('conflict', `The category code ${k.code} already exists`, {
                  status: 409,
                });
              throw e;
            });
      }
      // a category left out of the list is switched off (fees and applications keep pointing to it)
      const keep = dto.categories.map((k) => k.code);
      await c.query(
        `UPDATE admission_fee_categories SET status = 'inactive', is_default = false WHERE code <> ALL($1::text[])`,
        [keep],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.setup.categories',
        entityType: 'admission_fee_categories',
        entityId: requireTenant(ctx).schoolId,
        before: { categories: before.map((x) => x.name) },
        after: {
          categories: dto.categories.map(
            (x) => `${x.name}${x.status === 'inactive' ? ' (off)' : ''}`,
          ),
        },
      });
      return this.categoriesWith(c);
    });
  }

  // ---- the session ---------------------------------------------------------------------------------
  private async cycleWith(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Admission session not found', { status: 404 });
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      status: string;
      opens_at: Date;
      closes_at: Date;
      instructions: string | null;
      refund_deduction_pct: string;
      year: string;
      year_id: string;
    }>(
      `SELECT y.id::text, y.code, y.name, y.status::text, y.opens_at, y.closes_at, y.instructions, y.refund_deduction_pct::text,
              ay.name AS year, ay.id::text AS year_id
         FROM admission_cycles y JOIN academic_years ay ON ay.id = y.academic_year_id WHERE y.id = $1 AND y.deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Admission session not found', { status: 404 });
    return r.rows[0];
  }

  async plan(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.cycleWith(c, id);
      const lines = await c.query<{
        class_id: string;
        class_name: string;
        form_id: string | null;
        form_name: string | null;
        seats: number;
        opens_at: Date | null;
        closes_at: Date | null;
        age_as_on: string | null;
        dob_from: string | null;
        dob_to: string | null;
        notes: string | null;
        status: string;
        applications: number;
        registered: number;
      }>(
        `SELECT k.class_id::text, cl.name AS class_name, k.form_id::text, f.name AS form_name, k.seats, k.opens_at, k.closes_at,
                k.age_as_on::text, k.dob_from::text, k.dob_to::text, k.notes, k.status,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = k.cycle_id AND a.class_id = k.class_id) AS applications,
                (SELECT count(*)::int FROM applications a WHERE a.cycle_id = k.cycle_id AND a.class_id = k.class_id AND a.application_no IS NOT NULL) AS registered
           FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id LEFT JOIN admission_forms f ON f.id = k.form_id
          WHERE k.cycle_id = $1 ORDER BY cl.display_order, cl.name`,
        [id],
      );
      const fees = await c.query<{
        class_id: string;
        category_id: string;
        registration_fee: string;
        admission_fee: string;
      }>(
        `SELECT class_id::text, category_id::text, registration_fee::text, admission_fee::text FROM admission_fees WHERE cycle_id = $1`,
        [id],
      );
      const classes = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
      );
      const forms = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM admission_forms WHERE status = 'active' ORDER BY name`,
      );
      return {
        session: {
          id: y.id,
          code: y.code,
          name: y.name,
          status: y.status,
          opensAt: y.opens_at.toISOString(),
          closesAt: y.closes_at.toISOString(),
          instructions: y.instructions,
          refundDeductionPct: Number(y.refund_deduction_pct),
          academicYear: y.year,
          url: await this.publicUrl(c, base, y.code),
        },
        classes: lines.rows.map((x) => ({
          classId: x.class_id,
          className: x.class_name,
          formId: x.form_id,
          formName: x.form_name,
          seats: x.seats,
          opensAt: x.opens_at?.toISOString() ?? null,
          closesAt: x.closes_at?.toISOString() ?? null,
          ageAsOn: x.age_as_on,
          dobFrom: x.dob_from,
          dobTo: x.dob_to,
          notes: x.notes,
          status: x.status,
          applications: x.applications,
          registered: x.registered,
        })),
        fees: fees.rows.map((x) => ({
          classId: x.class_id,
          categoryId: x.category_id,
          registrationFee: Number(x.registration_fee),
          admissionFee: Number(x.admission_fee),
        })),
        categories: await this.categoriesWith(c),
        allClasses: classes.rows,
        forms: forms.rows,
      };
    });
  }

  async saveClasses(ctx: RequestContext, id: string, dto: SessionClassesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cycleWith(c, id);
      const keep = dto.classes.map((k) => k.classId);
      if (new Set(keep).size !== keep.length)
        throw new DomainError('validation-failed', 'A class is listed twice', { status: 400 });
      const gone = await c.query<{ name: string }>(
        `SELECT cl.name FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          WHERE k.cycle_id = $1 AND k.class_id <> ALL($2::bigint[])
            AND EXISTS (SELECT 1 FROM applications a WHERE a.cycle_id = k.cycle_id AND a.class_id = k.class_id)`,
        [id, keep],
      );
      if (gone.rowCount)
        throw new DomainError(
          'admissions.class_has_applications',
          `${gone.rows.map((x) => x.name).join(', ')} already has applications: close the class instead of removing it`,
          { status: 409 },
        );
      await c.query(
        `DELETE FROM admission_fees WHERE cycle_id = $1 AND class_id <> ALL($2::bigint[])`,
        [id, keep],
      );
      await c.query(
        `DELETE FROM admission_class_criteria WHERE cycle_id = $1 AND class_id <> ALL($2::bigint[])`,
        [id, keep],
      );
      for (const k of dto.classes)
        await c.query(
          `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, form_id, seats, opens_at, closes_at, age_as_on, dob_from, dob_to, notes, status)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::date, $8::date, $9::date, $10, $11)
           ON CONFLICT (cycle_id, class_id) DO UPDATE SET form_id = EXCLUDED.form_id, seats = EXCLUDED.seats, opens_at = EXCLUDED.opens_at,
             closes_at = EXCLUDED.closes_at, age_as_on = EXCLUDED.age_as_on, dob_from = EXCLUDED.dob_from, dob_to = EXCLUDED.dob_to,
             notes = EXCLUDED.notes, status = EXCLUDED.status`,
          [
            id,
            k.classId,
            k.formId,
            k.seats,
            k.opensAt ?? null,
            k.closesAt ?? null,
            k.ageAsOn ?? null,
            k.dobFrom ?? null,
            k.dobTo ?? null,
            k.notes ?? null,
            k.status,
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.classes',
        entityType: 'admission_cycles',
        entityId: id,
        after: { classes: dto.classes.length },
      });
    });
  }

  async saveFees(ctx: RequestContext, id: string, dto: SessionFeesDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cycleWith(c, id);
      await this.feeHeadsWith(c);
      const lines = await c.query<{ class_id: string }>(
        `SELECT class_id::text FROM admission_class_criteria WHERE cycle_id = $1`,
        [id],
      );
      const classIds = new Set(lines.rows.map((x) => x.class_id));
      for (const f of dto.fees) {
        if (!classIds.has(f.classId))
          throw new DomainError('validation-failed', 'A fee is for a class not in this session', {
            status: 400,
          });
        await c.query(
          `INSERT INTO admission_fees (school_id, cycle_id, class_id, category_id, registration_fee, admission_fee)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5)
           ON CONFLICT (cycle_id, class_id, category_id) DO UPDATE SET registration_fee = EXCLUDED.registration_fee, admission_fee = EXCLUDED.admission_fee`,
          [id, f.classId, f.categoryId, f.registrationFee.toFixed(2), f.admissionFee.toFixed(2)],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.cycle.fees',
        entityType: 'admission_cycles',
        entityId: id,
        after: { rows: dto.fees.length },
      });
    });
  }

  async saveSessionSettings(ctx: RequestContext, id: string, dto: SessionSettingsDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cycleWith(c, id);
      await c.query(
        `UPDATE admission_cycles SET refund_deduction_pct = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, dto.refundDeductionPct],
      );
    });
  }

  private async publicUrl(c: PoolClient, base: string, code: string) {
    const r = await c.query<{ code: string }>(
      `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
    );
    return `${(base || '').replace(/\/$/, '')}/${r.rows[0]!.code}/admission?session=${encodeURIComponent(code)}`;
  }

  async share(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.cycleWith(c, id);
      const url = await this.publicUrl(c, base, y.code);
      return {
        url,
        filename: `${y.code}-qr.png`,
        contentType: 'image/png',
        base64: (await qrPng(url)).toString('base64'),
      };
    });
  }

  async poster(ctx: RequestContext, id: string, base: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await this.cycleWith(c, id);
      const s = (
        await c.query<{ name: string; address: string | null; contact: string | null }>(
          `SELECT name,
                  NULLIF(concat_ws(', ', NULLIF(address->>'line1', ''), NULLIF(address->>'city', ''), NULLIF(address->>'state', ''),
                         NULLIF(COALESCE(address->>'pincode', address->>'pin'), '')), '') AS address,
                  NULLIF(concat_ws(' · ', NULLIF('Phone ' || NULLIF(contact->>'phone', ''), ''), NULLIF(contact->>'email', '')), '') AS contact
             FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!;
      const classes = await c.query<{ name: string; seats: number; reg: string | null }>(
        `SELECT cl.name, k.seats, (SELECT min(f.registration_fee)::text FROM admission_fees f WHERE f.cycle_id = k.cycle_id AND f.class_id = k.class_id) AS reg
           FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          WHERE k.cycle_id = $1 AND k.status = 'open' ORDER BY cl.display_order`,
        [id],
      );
      const bytes = await vacancyPosterPdf({
        school: s.name,
        address: s.address,
        contact: s.contact,
        code: y.code,
        title: `Admissions open: ${y.name}`,
        subline: `Academic year ${y.year} · ${classes.rows.map((x) => x.name).join(', ')}`,
        rows: classes.rows
          .slice(0, 12)
          .map((x) => [
            x.name,
            `${x.seats ? `${String(x.seats)} seats` : 'Seats as available'}${x.reg ? ` · registration fee from Rs ${Number(x.reg).toLocaleString('en-IN')}` : ''}`,
          ]),
        description: y.instructions,
        closes: IST(y.closes_at),
        url: await this.publicUrl(c, base, y.code),
      });
      return {
        filename: `${y.code}-poster.pdf`,
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      };
    });
  }
}
