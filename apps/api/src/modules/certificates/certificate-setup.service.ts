import { Injectable } from '@nestjs/common';
import { CERTIFICATE_TEMPLATES, readyTemplate, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { CHECK_LABELS } from './certificate-checks';
import { checkCustomFields, fieldsOf, type FieldSpec } from './certificate-fields';
import { assertSafeTemplate } from './certificate-safety';
import {
  RequestSettingsSchema,
  type CreateTemplateDto,
  type CreateTypeDto,
  type RequestSettings,
  type SaveTemplateDto,
  type SettingsDto,
  type UpdateRequestSettingsDto,
  type UpdateTypeDto,
} from './certificates.dto';
import { CertificatesService, type TypeRow } from './certificates.service';

/** The field list of the template editor: every placeholder, grouped, with what it prints. */
function catalogue(audience: 'STUDENT' | 'STAFF', fields: FieldSpec[]) {
  const g = (group: string, items: Array<[string, string]>) => ({
    group,
    items: items.map(([token, label]) => ({ token, label })),
  });
  const person =
    audience === 'STAFF'
      ? [
          g('Employee', [
            ['{{employee.name}}', 'Name'],
            ['{{employee.code}}', 'Employee ID'],
            ['{{employee.designation}}', 'Designation'],
            ['{{employee.department}}', 'Department'],
            ['{{employee.employeeType}}', 'Teaching / non-teaching'],
            ['{{employee.joinedOn}}', 'Date of joining'],
            ['{{employee.leftOn}}', 'Date of leaving'],
            ['{{employee.dob}}', 'Date of birth'],
            ['{{employee.fatherName}}', "Father's name"],
            ['{{employee.nationality}}', 'Nationality'],
            ['{{employee.honorific}}', 'Mr. / Ms.'],
            ['{{employee.childOf}}', 'son / daughter'],
            ['{{employee.pronoun}}', 'he / she'],
            ['{{employee.pronounObj}}', 'him / her'],
            ['{{employee.pronounPoss}}', 'his / her'],
            ['{{employee.pronounSubjCap}}', 'He / She'],
            ['{{employee.pronounPossCap}}', 'His / Her'],
          ]),
        ]
      : [
          g('Student', [
            ['{{student.name}}', 'Name'],
            ['{{student.admissionNo}}', 'Admission no.'],
            ['{{student.dob}}', 'Date of birth (figures)'],
            ['{{student.dobWords}}', 'Date of birth (words)'],
            ['{{student.gender}}', 'Gender'],
            ['{{student.nationality}}', 'Nationality'],
            ['{{student.religion}}', 'Religion'],
            ['{{student.category}}', 'Category'],
            ['{{student.caste}}', 'Caste'],
            ['{{student.motherTongue}}', 'Mother tongue'],
            ['{{student.placeOfBirth}}', 'Place of birth'],
            ['{{student.address}}', 'Address'],
            ['{{student.house}}', 'House'],
            ['{{student.pen}}', 'PEN'],
            ['{{student.apaar}}', 'APAAR ID'],
            ['{{student.srn}}', 'SRN'],
            ['{{student.registrationNo}}', 'Registration no.'],
          ]),
          g('Parents', [
            ['{{student.fatherName}}', "Father's name"],
            ['{{student.motherName}}', "Mother's name"],
            ['{{student.guardianName}}', "Guardian's name"],
          ]),
          g('Admission and class', [
            ['{{student.admittedOn}}', 'Date of admission'],
            ['{{student.admissionClassLabel}}', 'Class at admission'],
            ['{{student.classLabel}}', 'Class and section ("Class VIII – A")'],
            ['{{student.className}}', 'Class'],
            ['{{student.section}}', 'Section'],
            ['{{student.classWords}}', 'Class in words ("Eighth")'],
            ['{{student.rollNo}}', 'Roll no.'],
            ['{{student.academicYear}}', 'Academic year'],
            ['{{student.leftOn}}', 'Date of leaving'],
            ['{{#if student.left}}…{{else}}…{{/if}}', 'Left the school, or still studying'],
          ]),
          g('Attendance and fees', [
            ['{{attendance.workingDays}}', 'Working days this year'],
            ['{{attendance.present}}', 'Days present'],
            ['{{attendance.percent}}', 'Attendance %'],
            ['{{fees.year}}', 'Fee paid: the year'],
            ['{{fees.total}}', 'Fee paid: total'],
            ['{{fees.totalWords}}', 'Fee paid: total in words'],
            ['{{#each fees.heads}}{{name}} {{amount}}{{/each}}', 'Fee paid: each head'],
          ]),
          g('Words', [
            ['{{student.childOf}}', 'son / daughter'],
            ['{{student.pronoun}}', 'he / she'],
            ['{{student.pronounObj}}', 'him / her'],
            ['{{student.pronounPoss}}', 'his / her'],
            ['{{student.pronounSubjCap}}', 'He / She'],
            ['{{student.pronounPossCap}}', 'His / Her'],
          ]),
        ];
  return [
    g('Blocks (EduPro prints them)', [
      ['{{{blocks.letterhead}}}', 'Letterhead: logo, school, address, affiliation'],
      ['{{{blocks.signatures}}}', 'Signature boxes: prepared, checked, the principal'],
      ['{{{blocks.duplicate}}}', 'DUPLICATE on a copy'],
      ['{{{blocks.footer}}}', 'Number, date and the check QR'],
    ]),
    g('Certificate', [
      ['{{cert.number}}', 'Number'],
      ['{{cert.issuedOn}}', 'Date of issue'],
      ['{{cert.purpose}}', 'Purpose'],
      ['{{cert.name}}', 'Type'],
      ['{{cert.bookNo}}', 'Book no. (TC)'],
      ['{{cert.slNo}}', 'Sl. no. (TC)'],
      ['{{#if cert.purpose}}…{{/if}}', 'Only when a purpose is given'],
    ]),
    g('School', [
      ['{{school.name}}', 'Name'],
      ['{{school.addressLine}}', 'Address'],
      ['{{school.phone}}', 'Phone'],
      ['{{school.email}}', 'E-mail'],
      ['{{school.affiliationNo}}', 'Affiliation no.'],
      ['{{school.board}}', 'Board'],
      ['{{school.schoolNo}}', 'School no.'],
    ]),
    ...person,
    ...(fields.length
      ? [
          g(
            'Fields typed at issue',
            fields.map((f): [string, string] => [
              f.kind === 'date' ? `{{text.${f.key}}}` : `{{fields.${f.key}}}`,
              f.label,
            ]),
          ),
        ]
      : []),
  ];
}

/** A type's request settings, read with their defaults (closed, one copy, no fee, no levels). */
/** The number the next certificate of a type gets this year, as `app.next_certificate_no` makes it. */
export const nextNumber = (prefix: string, year: string | null, last: number) =>
  year ? `${prefix}/${year}/${String(last + 1).padStart(5, '0')}` : null;

export function requestSettings(raw: unknown): RequestSettings {
  const parsed = RequestSettingsSchema.safeParse(
    raw && typeof raw === 'object' && Object.keys(raw).length
      ? raw
      : { open: { parent: false, student: false, staff: false } },
  );
  return parsed.success
    ? parsed.data
    : {
        open: { parent: false, student: false, staff: false },
        purposes: [],
        maxCopies: 1,
        fee: null,
        levels: [],
      };
}

const genericBody = (name: string, audience: 'STUDENT' | 'STAFF') =>
  `<div class="cert">{{{blocks.duplicate}}}{{{blocks.letterhead}}}
<div class="ids"><span>No. <strong>{{cert.number}}</strong></span><span>Date <strong>{{cert.issuedOn}}</strong></span></div>
<h2>${name.replace(/[<>&"]/g, '')}</h2>
<p class="body">This is to certify that ${
    audience === 'STAFF'
      ? '{{employee.honorific}} <strong>{{employee.name}}</strong>, employee ID <strong>{{employee.code}}</strong>, is working in this school as <strong>{{employee.designation}}</strong>.'
      : '<strong>{{student.name}}</strong>, {{student.childOf}} of <strong>{{student.fatherName}}</strong>, admission no. <strong>{{student.admissionNo}}</strong>, is a student of this school, studying in <strong>{{student.classLabel}}</strong>.'
  }{{#if cert.purpose}} This certificate is issued for the purpose of <strong>{{cert.purpose}}</strong>.{{/if}}</p>
{{{blocks.signatures}}}{{{blocks.footer}}}</div>`;

/**
 * Certificate set-up (docs/design/87, phase B): the types and their checks, fields, layouts and who issues them; the
 * school's own types; the templates with their versions, the field list and a live preview; who signs.
 */
@Injectable()
export class CertificateSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly certificates: CertificatesService,
  ) {}

  /** The set-up page: figures, what to look at, the types, the templates, who signs. */
  async overview(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.certificates.ensureSetup(c);
      const year = await this.yearCode(c, ctx);
      const types = await c.query<{
        code: string;
        name: string;
        audience: string;
        prefix: string;
        template: string | null;
        template_id: string | null;
        rules: Record<string, unknown>;
        multiple: string;
        active: boolean;
        built_in: boolean;
        issuers: string[];
        fields: unknown[];
        variants: unknown[];
        issued: number;
        issued_year: number;
        last_serial: number;
        waiting: number;
        request: unknown;
      }>(
        `SELECT t.code, t.name, t.audience, t.prefix, d.name AS template, t.template_id::text, t.rules, t.multiple, t.active,
                t.built_in, t.issuers, t.fields, t.variants, t.request,
                (SELECT count(*)::int FROM certificates x WHERE x.type_id = t.id AND x.copy_no = 0) AS issued,
                (SELECT count(*)::int FROM certificates x WHERE x.type_id = t.id AND x.copy_no = 0 AND x.year_code = $1) AS issued_year,
                COALESCE((SELECT s.last_serial FROM certificate_series s WHERE s.type_code = t.code AND s.year_code = $1), 0) AS last_serial,
                (SELECT count(*)::int FROM certificate_requests r WHERE r.type_id = t.id AND r.status IN ('submitted', 'approved')) AS waiting
           FROM certificate_types t LEFT JOIN document_templates d ON d.id = t.template_id AND d.deleted_at IS NULL
          ORDER BY t.audience DESC, t.sort_order, t.name`,
        [year],
      );
      const templates = await this.templates(c);
      const settings = await this.settingsOf(c);
      const missing = types.rows.filter((t) => t.active && !t.template);
      return {
        figures: {
          types: types.rows.length,
          active: types.rows.filter((t) => t.active).length,
          own: types.rows.filter((t) => !t.built_in).length,
          templates: templates.length,
          restricted: types.rows.filter((t) => t.issuers.length > 0).length,
          signatory: !!settings.signatory,
          online: types.rows.filter((t) => {
            const o = requestSettings(t.request).open;
            return t.active && (o.parent || o.student || o.staff);
          }).length,
          withFee: types.rows.filter((t) => (requestSettings(t.request).fee ?? 0) > 0).length,
          issued: types.rows.reduce((n, t) => n + t.issued, 0),
          issuedYear: types.rows.reduce((n, t) => n + t.issued_year, 0),
          toFix: missing.length,
        },
        yearCode: year,
        checks: [
          ...(settings.signatory
            ? settings.signatory.hasSignature || !settings.printSignature
              ? []
              : [
                  {
                    text: `${settings.signatory.name} has no signature image on the employee record: the box prints empty`,
                    href: `/people/employees/${settings.signatory.id}`,
                  },
                ]
            : [
                {
                  text: 'No signatory: the principal box prints without a name or signature',
                  href: '/certificates/setup/settings',
                },
              ]),
          ...missing.map((t) => ({
            text: `${t.name} has no template and cannot be issued`,
            href: `/certificates/setup/types/${t.code}`,
          })),
        ],
        types: types.rows.map((t) => ({
          code: t.code,
          name: t.name,
          audience: t.audience,
          prefix: t.prefix,
          template: t.template,
          templateId: t.template_id,
          rules: t.rules,
          multiple: t.multiple,
          active: t.active,
          builtIn: t.built_in,
          restricted: t.issuers.length > 0,
          ownFields: t.fields.length,
          variants: t.variants.length,
          issued: t.issued,
          issuedYear: t.issued_year,
          waiting: t.waiting,
          nextNumber: nextNumber(t.prefix, year, t.last_serial),
          request: requestSettings(t.request),
        })),
        templates,
        settings,
      };
    });
  }

  /**
   * The certificate templates. `forType`: those a type may print with — the reprint layout of certificates brought from
   * the old system (phase F) is the school's to edit, never a type's.
   */
  private async templates(c: PoolClient, forType = false) {
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      kind: string;
      version: number;
      ready_code: string | null;
      updated_at: Date;
      used_by: string[] | null;
      made: number;
      page_width: string;
      page_height: string;
    }>(
      `SELECT d.id::text, d.code, d.name, d.kind::text, d.version, d.ready_code, d.updated_at, d.page_width, d.page_height,
              (SELECT array_agg(t.name ORDER BY t.sort_order) FROM certificate_types t
                WHERE t.template_id = d.id OR t.variants @> jsonb_build_array(jsonb_build_object('templateId', d.id::text))) AS used_by,
              (SELECT count(*)::int FROM certificates x JOIN document_template_versions v ON v.id = x.template_version_id
                WHERE v.template_id = d.id) AS made
         FROM document_templates d
        WHERE d.deleted_at IS NULL AND d.kind::text IN ('transfer_certificate', 'bonafide', 'certificate')
          AND (NOT $1 OR d.ready_code IS DISTINCT FROM 'cert_legacy')
        ORDER BY (d.ready_code IS NULL), d.name`,
      [forType],
    );
    return r.rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      kind: x.kind,
      version: x.version,
      ready: !!x.ready_code,
      updatedAt: x.updated_at.toISOString(),
      usedBy: x.used_by ?? [],
      made: x.made,
      pageWidth: x.page_width,
      pageHeight: x.page_height,
    }));
  }

  /** The code of the selected academic year (e.g. 2026-27): the year a certificate issued now is numbered in. */
  private async yearCode(c: PoolClient, ctx: RequestContext): Promise<string | null> {
    const id = requireTenant(ctx).academicYearId;
    if (!id) return null;
    return (
      (await c.query<{ code: string }>(`SELECT code FROM academic_years WHERE id = $1`, [id]))
        .rows[0]?.code ?? null
    );
  }

  // ---- types ---------------------------------------------------------------------------------------------------------
  private async typeRow(c: PoolClient, code: string): Promise<TypeRow> {
    const r = await c.query<TypeRow>(
      `SELECT t.id::text, t.code, t.name, t.audience, t.prefix, t.template_id::text, d.name AS template_name, t.rules,
              t.multiple, t.uses_book, t.active, t.sort_order, t.description, t.fields, t.variants, t.issuers, t.built_in,
              t.request
         FROM certificate_types t LEFT JOIN document_templates d ON d.id = t.template_id AND d.deleted_at IS NULL
        WHERE t.code = $1`,
      [code],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Certificate type not found');
    return r.rows[0];
  }

  /** One type with what its form chooses from: the templates, the roles. */
  async type(ctx: RequestContext, code: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.certificates.ensureSetup(c);
      const t = await this.typeRow(c, code);
      const roles = await c.query<{ id: string; name: string; code: string; issues: boolean }>(
        `SELECT r.id::text, r.name, r.code,
                EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.permission_code = 'certificate.register.issue') AS issues
           FROM roles r
          WHERE (r.school_id IS NULL OR r.school_id = app.current_school_id()) AND r.deleted_at IS NULL AND r.status = 'active'
          ORDER BY r.name`,
      );
      const year = await this.yearCode(c, ctx);
      const n = (
        await c.query<{
          issued: number;
          issued_year: number;
          waiting: number;
          last_serial: number;
        }>(
          `SELECT (SELECT count(*)::int FROM certificates WHERE type_id = $1 AND copy_no = 0) AS issued,
                  (SELECT count(*)::int FROM certificates WHERE type_id = $1 AND copy_no = 0 AND year_code = $2) AS issued_year,
                  (SELECT count(*)::int FROM certificate_requests WHERE type_id = $1 AND status IN ('submitted', 'approved')) AS waiting,
                  COALESCE((SELECT last_serial FROM certificate_series WHERE type_code = $3 AND year_code = $2), 0) AS last_serial`,
          [t.id, year, t.code],
        )
      ).rows[0]!;
      const classes =
        t.audience === 'STAFF'
          ? []
          : (
              await c.query<{ code: string; name: string }>(
                `SELECT DISTINCT ON (upper(code)) upper(code) AS code, name FROM classes
                  WHERE deleted_at IS NULL AND status = 'active' ORDER BY upper(code), display_order`,
              )
            ).rows;
      return {
        code: t.code,
        name: t.name,
        description: t.description,
        audience: t.audience,
        prefix: t.prefix,
        templateId: t.template_id,
        variants: t.variants,
        rules: t.rules,
        multiple: t.multiple,
        usesBook: t.uses_book,
        active: t.active,
        sortOrder: t.sort_order,
        issuers: t.issuers,
        builtIn: t.built_in,
        ownFields: fieldsOf(t.code, []),
        fields: Array.isArray(t.fields) ? (t.fields as FieldSpec[]) : [],
        issued: n.issued,
        issuedYear: n.issued_year,
        waiting: n.waiting,
        yearCode: year,
        nextNumber: nextNumber(t.prefix, year, n.last_serial),
        classes,
        checks: Object.entries(CHECK_LABELS).map(([key, label]) => ({ key, label })),
        templates: await this.templates(c, true),
        roles: roles.rows,
        request: requestSettings(t.request),
      };
    });
  }

  private async assertTemplates(c: PoolClient, ids: string[]) {
    if (!ids.length) return;
    const r = await c.query<{ n: number }>(
      `SELECT count(DISTINCT id)::int AS n FROM document_templates
        WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND kind::text IN ('transfer_certificate', 'bonafide', 'certificate')
          AND ready_code IS DISTINCT FROM 'cert_legacy'`,
      [ids],
    );
    if ((r.rows[0]?.n ?? 0) !== new Set(ids).size)
      throw new DomainError('validation-failed', 'Choose certificate templates of this school', {
        status: 400,
      });
  }

  async updateType(ctx: RequestContext, code: string, dto: UpdateTypeDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.typeRow(c, code);
      const problems = checkCustomFields(code, dto.fields as FieldSpec[]);
      if (problems.length)
        throw new DomainError('validation-failed', problems.join('; '), { status: 400 });
      await this.assertTemplates(c, [
        ...(dto.templateId ? [dto.templateId] : []),
        ...dto.variants.map((v) => v.templateId),
      ]);
      if (dto.active && !dto.templateId)
        throw new DomainError('validation-failed', 'An active type needs its template', {
          status: 400,
        });
      if (dto.issuers.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM roles WHERE id = ANY($1::bigint[])
              AND (school_id IS NULL OR school_id = app.current_school_id()) AND deleted_at IS NULL`,
          [dto.issuers],
        );
        if ((r.rows[0]?.n ?? 0) !== new Set(dto.issuers).size)
          throw new DomainError('validation-failed', 'Choose roles of this school', {
            status: 400,
          });
      }
      try {
        await c.query(
          `UPDATE certificate_types SET name = $2, description = $3, prefix = $4, template_id = $5, variants = $6::jsonb,
                  rules = $7::jsonb, multiple = $8, active = $9, sort_order = $10, issuers = $11::jsonb, fields = $12::jsonb,
                  updated_at = now(), updated_by = app.current_user_id()
            WHERE code = $1`,
          [
            code,
            dto.name,
            dto.description || null,
            dto.prefix,
            dto.templateId,
            JSON.stringify(dto.variants.filter((v) => v.templateId !== dto.templateId)),
            JSON.stringify(dto.rules),
            dto.multiple,
            dto.active,
            dto.sortOrder,
            JSON.stringify(dto.issuers),
            JSON.stringify(dto.fields),
          ],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError(
            'certificate.prefix_taken',
            `Another type already uses ${dto.prefix}`,
            {
              status: 409,
            },
          );
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'certificate.type.update',
        entityType: 'certificate_types',
        entityId: before.id,
        before: {
          name: before.name,
          prefix: before.prefix,
          active: before.active,
          rules: before.rules,
        },
        after: { name: dto.name, prefix: dto.prefix, active: dto.active, rules: dto.rules },
      });
    });
    return this.type(ctx, code);
  }

  /**
   * Who may ask for a type online and how it is decided (phase C): open to parents, students or staff; the purposes to
   * choose from; how many copies; a fee a copy (a misc fee on the student); the approval levels in order.
   */
  async saveRequestSettings(ctx: RequestContext, code: string, dto: UpdateRequestSettingsDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.typeRow(c, code);
      if (t.audience === 'STAFF' && (dto.open.parent || dto.open.student))
        throw new DomainError(
          'validation-failed',
          'A staff certificate is asked for by staff only',
          {
            status: 400,
          },
        );
      if (t.audience === 'STUDENT' && dto.open.staff)
        throw new DomainError(
          'validation-failed',
          'A student certificate is asked for by parents or students',
          {
            status: 400,
          },
        );
      if (dto.fee && t.audience === 'STAFF')
        throw new DomainError('validation-failed', 'A staff certificate carries no fee', {
          status: 400,
        });
      if ((dto.open.parent || dto.open.student || dto.open.staff) && !dto.levels.length)
        throw new DomainError('validation-failed', 'Set at least one approval level', {
          status: 400,
        });
      const roleIds = dto.levels.flatMap((l) => (l.kind === 'role' ? [l.roleId] : []));
      if (roleIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT id)::int AS n FROM roles WHERE id = ANY($1::bigint[])
              AND (school_id IS NULL OR school_id = app.current_school_id()) AND deleted_at IS NULL`,
          [roleIds],
        );
        if ((r.rows[0]?.n ?? 0) !== new Set(roleIds).size)
          throw new DomainError('validation-failed', 'Choose roles of this school', {
            status: 400,
          });
      }
      const userIds = dto.levels.flatMap((l) => (l.kind === 'user' ? [l.userId] : []));
      if (userIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT user_id)::int AS n FROM user_school_memberships
            WHERE user_id = ANY($1::bigint[]) AND school_id = app.current_school_id()`,
          [userIds],
        );
        if ((r.rows[0]?.n ?? 0) !== new Set(userIds).size)
          throw new DomainError('validation-failed', 'Choose people of this school', {
            status: 400,
          });
      }
      await c.query(
        `UPDATE certificate_types SET request = $2::jsonb, updated_at = now(), updated_by = app.current_user_id() WHERE code = $1`,
        [code, JSON.stringify(dto)],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.type.requests',
        entityType: 'certificate_types',
        entityId: t.id,
        before: { request: t.request },
        after: { request: dto },
      });
    });
    return this.type(ctx, code);
  }

  /** A type of the school's own, with a copy of a template to start from. */
  async createType(ctx: RequestContext, dto: CreateTypeDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.certificates.ensureSetup(c);
      const taken = await c.query(
        `SELECT 1 FROM certificate_types WHERE code = $1 OR prefix = $2`,
        [dto.code, dto.prefix],
      );
      if (taken.rowCount)
        throw new DomainError('certificate.type_taken', 'That code or prefix is already used', {
          status: 409,
        });
      let body = genericBody(dto.name, dto.audience);
      let css = readyTemplate('cert_bonafide')!.stylesCss;
      let kind = 'certificate';
      let page = { w: '210mm', h: '297mm' };
      if (dto.copyTemplateId) {
        const s = (
          await c.query<{
            body_html: string;
            styles_css: string;
            kind: string;
            page_width: string;
            page_height: string;
          }>(
            `SELECT body_html, styles_css, kind::text, page_width, page_height FROM document_templates
              WHERE id = $1 AND deleted_at IS NULL AND kind::text IN ('transfer_certificate', 'bonafide', 'certificate')`,
            [dto.copyTemplateId],
          )
        ).rows[0];
        if (!s) throw new DomainError('not-found', 'Template not found');
        body = s.body_html;
        css = s.styles_css;
        kind = s.kind === 'transfer_certificate' ? 'certificate' : s.kind;
        page = { w: s.page_width, h: s.page_height };
      }
      const tpl = (
        await c.query<{ id: string }>(
          `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::template_kind, $4, $5, $6, $7, '[]'::jsonb, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [`cert_own_${dto.code.toLowerCase()}`, dto.name, kind, page.w, page.h, body, css],
        )
      ).rows[0]!;
      const t = (
        await c.query<{ id: string }>(
          `INSERT INTO certificate_types (school_id, code, name, audience, prefix, template_id, rules, multiple, sort_order, built_in, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, '{"state": "any"}'::jsonb, 'ANY', 500, false, app.current_user_id())
           RETURNING id::text`,
          [dto.code, dto.name, dto.audience, dto.prefix, tpl.id],
        )
      ).rows[0]!;
      await this.audit.stage(ctx, c, {
        action: 'certificate.type.create',
        entityType: 'certificate_types',
        entityId: t.id,
        after: { code: dto.code, name: dto.name, audience: dto.audience, prefix: dto.prefix },
      });
    });
    return this.type(ctx, dto.code);
  }

  // ---- templates -------------------------------------------------------------------------------------------------------
  async template(ctx: RequestContext, id: string, typeCode?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          kind: string;
          page_width: string;
          page_height: string;
          body_html: string;
          styles_css: string;
          version: number;
          ready_code: string | null;
        }>(
          `SELECT id::text, code, name, kind::text, page_width, page_height, body_html, styles_css, version, ready_code
             FROM document_templates WHERE id = $1 AND deleted_at IS NULL AND kind::text IN ('transfer_certificate', 'bonafide', 'certificate')`,
          [id],
        )
      ).rows[0];
      if (!t) throw new DomainError('not-found', 'Template not found');
      const versions = await c.query<{
        version: number;
        created_at: Date;
        by: string | null;
        made: number;
      }>(
        `SELECT v.version, v.created_at, u.display_name AS by,
                (SELECT count(*)::int FROM certificates x WHERE x.template_version_id = v.id) AS made
           FROM document_template_versions v LEFT JOIN users u ON u.id = v.created_by
          WHERE v.template_id = $1 ORDER BY v.version DESC LIMIT 50`,
        [id],
      );
      const types = await c.query<{
        code: string;
        name: string;
        audience: 'STUDENT' | 'STAFF';
        fields: unknown;
      }>(
        `SELECT code, name, audience, fields FROM certificate_types
          WHERE template_id = $1 OR variants @> jsonb_build_array(jsonb_build_object('templateId', $1::text))
          ORDER BY sort_order`,
        [id],
      );
      const all = await c.query<{
        code: string;
        name: string;
        audience: 'STUDENT' | 'STAFF';
        fields: unknown;
      }>(`SELECT code, name, audience, fields FROM certificate_types ORDER BY sort_order, name`);
      const forType =
        all.rows.find((x) => x.code === typeCode) ??
        types.rows[0] ??
        all.rows.find((x) => x.code === 'BONAFIDE');
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        kind: t.kind,
        pageWidth: t.page_width,
        pageHeight: t.page_height,
        bodyHtml: t.body_html,
        stylesCss: t.styles_css,
        version: t.version,
        ready: !!t.ready_code,
        usedBy: types.rows.map((x) => ({ code: x.code, name: x.name })),
        types: all.rows.map((x) => ({ code: x.code, name: x.name, audience: x.audience })),
        forType: forType?.code ?? null,
        catalogue: catalogue(
          forType?.audience ?? 'STUDENT',
          forType ? fieldsOf(forType.code, forType.fields) : [],
        ),
        versions: versions.rows.map((v) => ({
          version: v.version,
          at: v.created_at.toISOString(),
          by: v.by,
          made: v.made,
        })),
      };
    });
  }

  private async writeTemplate(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    t: {
      name?: string;
      pageWidth: string;
      pageHeight: string;
      bodyHtml: string;
      stylesCss: string;
    },
    action: string,
  ) {
    assertSafeTemplate(t.bodyHtml, t.stylesCss);
    const r = await c.query<{ version: number }>(
      `UPDATE document_templates SET name = COALESCE($2, name), page_width = $3, page_height = $4, body_html = $5,
              styles_css = $6, updated_at = now(), updated_by = app.current_user_id()
        WHERE id = $1 AND deleted_at IS NULL AND kind::text IN ('transfer_certificate', 'bonafide', 'certificate')
        RETURNING version`,
      [id, t.name ?? null, t.pageWidth, t.pageHeight, t.bodyHtml, t.stylesCss],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Template not found');
    await this.audit.stage(ctx, c, {
      action,
      entityType: 'document_templates',
      entityId: id,
      after: { version: r.rows[0].version, name: t.name },
    });
  }

  /** Saves the template: a new version (the certificates made before keep the one they used). */
  async saveTemplate(ctx: RequestContext, id: string, dto: SaveTemplateDto) {
    await this.db.tenant(requireTenant(ctx), (c) =>
      this.writeTemplate(c, ctx, id, dto, 'certificate.template.save'),
    );
    return this.template(ctx, id);
  }

  /** Back to EduPro's ready layout (a ready template only). */
  async resetTemplate(ctx: RequestContext, id: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ ready_code: string | null }>(
          `SELECT ready_code FROM document_templates WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      const ready = r?.ready_code ? readyTemplate(r.ready_code) : undefined;
      if (!ready)
        throw new DomainError('certificate.not_ready', 'Only a ready template has a ready layout', {
          status: 409,
        });
      await this.writeTemplate(
        c,
        ctx,
        id,
        {
          pageWidth: ready.pageWidth,
          pageHeight: ready.pageHeight,
          bodyHtml: ready.bodyHtml,
          stylesCss: ready.stylesCss,
        },
        'certificate.template.reset',
      );
    });
    return this.template(ctx, id);
  }

  /** An earlier version used again (as a new version). */
  async restoreTemplate(ctx: RequestContext, id: string, version: number) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const v = (
        await c.query<{
          body_html: string;
          styles_css: string;
          page_width: string;
          page_height: string;
        }>(
          `SELECT body_html, styles_css, page_width, page_height FROM document_template_versions
            WHERE template_id = $1 AND version = $2`,
          [id, version],
        )
      ).rows[0];
      if (!v) throw new DomainError('not-found', 'Version not found');
      await this.writeTemplate(
        c,
        ctx,
        id,
        {
          pageWidth: v.page_width,
          pageHeight: v.page_height,
          bodyHtml: v.body_html,
          stylesCss: v.styles_css,
        },
        'certificate.template.restore',
      );
    });
    return this.template(ctx, id);
  }

  /** A copy of a template, to change without touching the one in use. */
  async copyTemplate(ctx: RequestContext, dto: CreateTemplateDto) {
    const id = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables, created_by, updated_by)
         SELECT school_id, 'cert_copy_' || to_char(now(), 'YYMMDDHH24MISSMS'), $2, kind, page_width, page_height, body_html, styles_css,
                '[]'::jsonb, app.current_user_id(), app.current_user_id()
           FROM document_templates WHERE id = $1 AND deleted_at IS NULL AND kind::text IN ('transfer_certificate', 'bonafide', 'certificate')
         RETURNING id::text`,
        [dto.copyOf, dto.name],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Template not found');
      await this.audit.stage(ctx, c, {
        action: 'certificate.template.copy',
        entityType: 'document_templates',
        entityId: r.rows[0].id,
        after: { copyOf: dto.copyOf, name: dto.name },
      });
      return r.rows[0].id;
    });
    return this.template(ctx, id);
  }

  // ---- who signs -----------------------------------------------------------------------------------------------------
  private async settingsOf(c: PoolClient) {
    const r = (
      await c.query<{
        signatory_employee_id: string | null;
        signatory_title: string | null;
        print_signature: boolean | null;
        print_preparer: boolean | null;
        footer_note: string | null;
        name: string | null;
        code: string | null;
        designation: string | null;
        has_signature: boolean | null;
      }>(
        `SELECT cs.signatory_employee_id::text, cs.signatory_title, cs.print_signature, cs.print_preparer, cs.footer_note,
                e.display_name AS name, e.employee_code AS code, e.designation, e.signature_file_id IS NOT NULL AS has_signature
           FROM schools sc LEFT JOIN certificate_settings cs ON cs.school_id = sc.id
           LEFT JOIN employees e ON e.id = cs.signatory_employee_id
          WHERE sc.id = app.current_school_id()`,
      )
    ).rows[0];
    return {
      signatory: r?.signatory_employee_id
        ? {
            id: r.signatory_employee_id,
            name: r.name ?? '',
            code: r.code ?? '',
            designation: r.designation,
            hasSignature: !!r.has_signature,
          }
        : null,
      signatoryTitle: r?.signatory_title ?? 'Principal',
      printSignature: r?.print_signature ?? true,
      printPreparer: r?.print_preparer ?? true,
      footerNote: r?.footer_note ?? '',
    };
  }

  async settings(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.settingsOf(c));
  }

  async saveSettings(ctx: RequestContext, dto: SettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (dto.signatoryEmployeeId) {
        const e = await c.query(`SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`, [
          dto.signatoryEmployeeId,
        ]);
        if (!e.rowCount) throw new DomainError('not-found', 'Employee not found');
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO certificate_settings (school_id, signatory_employee_id, signatory_title, print_signature, print_preparer, footer_note, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET signatory_employee_id = EXCLUDED.signatory_employee_id,
            signatory_title = EXCLUDED.signatory_title, print_signature = EXCLUDED.print_signature,
            print_preparer = EXCLUDED.print_preparer, footer_note = EXCLUDED.footer_note, updated_at = now(),
            updated_by = app.current_user_id()
         RETURNING id::text`,
        [
          dto.signatoryEmployeeId,
          dto.signatoryTitle,
          dto.printSignature,
          dto.printPreparer,
          dto.footerNote || null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.settings.save',
        entityType: 'certificate_settings',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return this.settingsOf(c);
    });
  }

  /** The ready templates EduPro ships (their names), for the set-up page's notes. */
  readyCount() {
    return CERTIFICATE_TEMPLATES.length;
  }
}
