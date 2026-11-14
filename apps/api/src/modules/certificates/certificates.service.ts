import { Inject, Injectable } from '@nestjs/common';
import {
  CERTIFICATE_BLOCK_CSS,
  CERTIFICATE_TEMPLATES,
  certificateBlocks,
  certificateImageIds,
  documentHtml,
  renderTemplate,
  type CertificateSign,
  type PoolClient,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { FeeLedgerService, type Ledger } from '../fees/fee-ledger.service';
import { STORAGE_DRIVER } from '../files/storage';
import { ReportsService } from '../reports/reports.service';
import { runChecks, type CertificateCheck, type CertificateRules } from './certificate-checks';
import { employeeData, feePaidData, schoolData, studentData } from './certificate-data';
import { checkFields, fieldDefaults, fieldsOf, fieldText } from './certificate-fields';
import { assertSafeTemplate } from './certificate-safety';
import { CertificateVerifyService } from './certificate-verify.service';
import {
  CERTIFICATE,
  type CertificatesFileQueryDto,
  type IssueCertificateDto,
  type ListCertificatesQueryDto,
  type PreviewCertificateDto,
  type TemplatePreviewDto,
} from './certificates.dto';

/**
 * The certificate register (docs/design/87, phase A): one register for every certificate the school issues. A type
 * names its prefix, template, checks and how many a person may hold; issuing runs the checks (the principal may
 * override a failed one with a reason), takes the next number of the type and year (row-locked, never reused) and, for
 * the TC, the next book Sl. No.; it freezes every printed field and the template version, so a reprint or a duplicate
 * is the same paper. The TC is issued here from every route (the student's profile, the withdrawal, the register).
 */
export interface TypeRow {
  id: string;
  /** request settings (phase C) */
  request?: unknown;
  description: string | null;
  fields: unknown;
  variants: Array<{ templateId: string; label: string }>;
  issuers: string[];
  built_in: boolean;
  code: string;
  name: string;
  audience: 'STUDENT' | 'STAFF';
  prefix: string;
  template_id: string | null;
  template_name: string | null;
  rules: CertificateRules;
  multiple: 'ONE' | 'YEAR' | 'ANY';
  uses_book: boolean;
  active: boolean;
  sort_order: number;
}

export interface IssueOptions {
  /** issued from this withdrawal (its departments that gate the TC are cleared) */
  withdrawalId?: string | null;
  leavingOn?: string | null;
  /** the withdrawal is still in progress: the student stays on the rolls until it completes */
  keepStatus?: boolean;
}

export interface CertificateRow {
  id: string;
  typeCode: string;
  typeName: string;
  number: string;
  copyNo: number;
  originalId: string | null;
  studentId: string | null;
  /** the student's name, or the employee's on a staff certificate */
  studentName: string | null;
  /** the admission no., or the employee code */
  admissionNo: string | null;
  employeeId: string | null;
  className: string | null;
  status: 'issued' | 'cancelled';
  issuedOn: string;
  issuedBy: string | null;
  purpose: string | null;
  bookNo: number | null;
  slNo: number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  checks: CertificateCheck[];
  exportId: string | null;
  transferCertificateId: string | null;
  legacy: boolean;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
}

const SELECT = `SELECT x.id::text, t.code AS type_code, t.name AS type_name, x.number, x.copy_no, x.original_id::text,
        x.student_id::text, COALESCE(s.display_name, em.display_name) AS student_name,
        COALESCE(s.admission_no, em.employee_code) AS admission_no, x.employee_id::text,
        COALESCE(x.data->'student'->>'className', x.data->'employee'->>'designation') AS class_name,
        x.status, x.issued_on::text, u.display_name AS issued_by, x.purpose, x.book_no, x.sl_no, x.override_reason,
        ou.display_name AS override_by, x.checks, x.export_id::text, x.transfer_certificate_id::text, x.legacy,
        x.cancelled_at, cu.display_name AS cancelled_by, x.cancel_reason, x.created_at
   FROM certificates x
   JOIN certificate_types t ON t.id = x.type_id
   LEFT JOIN students s ON s.id = x.student_id
   LEFT JOIN employees em ON em.id = x.employee_id
   LEFT JOIN users u ON u.id = x.issued_by
   LEFT JOIN users ou ON ou.id = x.override_by
   LEFT JOIN users cu ON cu.id = x.cancelled_by`;

interface Db {
  id: string;
  type_code: string;
  type_name: string;
  number: string;
  copy_no: number;
  original_id: string | null;
  student_id: string | null;
  student_name: string | null;
  admission_no: string | null;
  employee_id: string | null;
  class_name: string | null;
  status: 'issued' | 'cancelled';
  issued_on: string;
  issued_by: string | null;
  purpose: string | null;
  book_no: number | null;
  sl_no: number | null;
  override_reason: string | null;
  override_by: string | null;
  checks: CertificateCheck[];
  export_id: string | null;
  transfer_certificate_id: string | null;
  legacy: boolean;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: Date;
}

const toRow = (r: Db): CertificateRow => ({
  id: r.id,
  typeCode: r.type_code,
  typeName: r.type_name,
  number: r.number,
  copyNo: r.copy_no,
  originalId: r.original_id,
  studentId: r.student_id,
  studentName: r.student_name,
  admissionNo: r.admission_no,
  employeeId: r.employee_id,
  className: r.class_name,
  status: r.status,
  issuedOn: r.issued_on,
  issuedBy: r.issued_by,
  purpose: r.purpose,
  bookNo: r.book_no,
  slNo: r.sl_no,
  overrideReason: r.override_reason,
  overrideBy: r.override_by,
  checks: Array.isArray(r.checks) ? r.checks : [],
  exportId: r.export_id,
  transferCertificateId: r.transfer_certificate_id,
  legacy: r.legacy,
  cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
  cancelledBy: r.cancelled_by,
  cancelReason: r.cancel_reason,
  createdAt: r.created_at.toISOString(),
});

const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
/** "14-11-2026 09:40 AM" in the school's time zone */
export function stamp(d: Date, timeZone?: string | null): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(d);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone || 'Asia/Kolkata');
  } catch {
    parts = fmt('Asia/Kolkata');
  }
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** The ready request settings of the built-in types (as migration 0384 set them for the schools of the time). */
const everyday = {
  open: { parent: true, student: true, staff: false },
  purposes: [],
  maxCopies: 2,
  fee: null,
  levels: [{ kind: 'office' }],
};
const DEFAULT_REQUESTS: Record<string, unknown> = {
  ...Object.fromEntries(
    [
      'BONAFIDE',
      'DOB',
      'STUDY',
      'FEE_PAID',
      'SCHOLAR',
      'BOARD_REG',
      'NOC',
      'TRAVEL_NOC',
      'VISA',
      'DOMICILE',
      'CASTE',
      'DOB_JUST',
    ].map((k) => [k, everyday]),
  ),
  ...Object.fromEntries(
    ['TC', 'CHARACTER'].map((k) => [
      k,
      {
        open: { parent: true, student: false, staff: false },
        purposes: [],
        maxCopies: 1,
        fee: null,
        levels: [{ kind: 'office' }, { kind: 'signatory' }],
      },
    ]),
  ),
  ...Object.fromEntries(
    ['EXPERIENCE', 'SERVICE', 'STAFF_VISA'].map((k) => [
      k,
      {
        open: { parent: false, student: false, staff: true },
        purposes: [],
        maxCopies: 1,
        fee: null,
        levels: [{ kind: 'office' }],
      },
    ]),
  ),
};

/** The requests side of an issue (set by CertificateRequestsService; phase C). */
export interface RequestHook {
  check(
    c: PoolClient,
    requestId: string,
    typeId: string,
    person: { kind: 'student' | 'employee'; id: string },
  ): Promise<{ purpose: string | null }>;
  issued(
    c: PoolClient,
    ctx: RequestContext,
    requestId: string,
    certificateId: string,
    number: string,
  ): Promise<void>;
}

@Injectable()
export class CertificatesService {
  requestHook: RequestHook | null = null;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly ledgers: FeeLedgerService,
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly verify: CertificateVerifyService,
  ) {}

  // ---- set-up ------------------------------------------------------------------------------------------------------
  /**
   * The school's types and their ready templates, made on first use (a school added after a migration starts with
   * them): the built-in types, each ready template (remembering its ready layout), each type's default template and
   * its variants.
   */
  async ensureSetup(c: PoolClient): Promise<void> {
    const ready = CERTIFICATE_TEMPLATES.map((t) => t.code);
    const st = (
      await c.query<{
        types: number;
        unlinked: number;
        have: string[];
        unset: number;
        messages: boolean;
      }>(
        `SELECT (SELECT count(*)::int FROM certificate_types WHERE built_in) AS types,
                (SELECT count(*)::int FROM certificate_types WHERE built_in AND template_id IS NULL) AS unlinked,
                (SELECT count(*)::int FROM certificate_types WHERE built_in AND request = '{}'::jsonb) AS unset,
                EXISTS (SELECT 1 FROM comms_templates WHERE code = 'certificate_request_ready') AS messages,
                (SELECT COALESCE(array_agg(ready_code), '{}') FROM document_templates
                  WHERE ready_code = ANY($1::text[]) AND deleted_at IS NULL) AS have`,
        [ready],
      )
    ).rows[0]!;
    const builtIn = new Set(
      CERTIFICATE_TEMPLATES.filter((t) => !t.variantOf).map((t) => t.typeCode),
    ).size;
    if (
      st.types >= builtIn &&
      st.unlinked === 0 &&
      st.unset === 0 &&
      st.messages &&
      ready.every((r) => st.have.includes(r))
    )
      return;
    await c.query(`SELECT app.certificate_types_seed(app.current_school_id())`);
    await c.query(`SELECT app.certificate_seed_templates(app.current_school_id())`);
    // the ready request settings (docs/design/87, phase C) for a type not yet set
    for (const [code, settings] of Object.entries(DEFAULT_REQUESTS))
      await c.query(
        `UPDATE certificate_types SET request = $2::jsonb WHERE code = $1 AND built_in AND request = '{}'::jsonb`,
        [code, JSON.stringify(settings)],
      );
    for (const t of CERTIFICATE_TEMPLATES) {
      await c.query(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables, ready_code, created_by, updated_by)
         SELECT app.current_school_id(), $1, $2, $3::template_kind, $4, $5, $6, $7, '[]'::jsonb, $1, app.current_user_id(), app.current_user_id()
         ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO NOTHING`,
        [t.code, t.name, t.kind, t.pageWidth, t.pageHeight, t.bodyHtml, t.stylesCss],
      );
      await c.query(
        `UPDATE document_templates SET ready_code = code WHERE code = $1 AND ready_code IS NULL AND deleted_at IS NULL`,
        [t.code],
      );
      if (t.variantOf)
        await c.query(
          `UPDATE certificate_types ct SET variants = ct.variants || jsonb_build_array(jsonb_build_object('templateId', d.id::text, 'label', d.name))
             FROM document_templates d
            WHERE ct.code = $1 AND d.code = $2 AND d.deleted_at IS NULL
              AND NOT ct.variants @> jsonb_build_array(jsonb_build_object('templateId', d.id::text))`,
          [t.variantOf, t.code],
        );
      else
        await c.query(
          `UPDATE certificate_types SET template_id = (SELECT id FROM document_templates WHERE code = $2 AND deleted_at IS NULL)
            WHERE code = $1 AND template_id IS NULL`,
          [t.typeCode, t.code],
        );
    }
  }

  async typeOf(c: PoolClient, code: string): Promise<TypeRow> {
    const r = await c.query<TypeRow>(
      `SELECT t.id::text, t.code, t.name, t.audience, t.prefix, t.template_id::text, d.name AS template_name, t.rules,
              t.multiple, t.uses_book, t.active, t.sort_order, t.description, t.fields, t.variants, t.issuers, t.built_in, t.request
         FROM certificate_types t LEFT JOIN document_templates d ON d.id = t.template_id AND d.deleted_at IS NULL
        WHERE t.code = $1`,
      [code],
    );
    const t = r.rows[0];
    if (!t) throw new DomainError('not-found', 'Certificate type not found');
    if (!t.active)
      throw new DomainError('certificate.type_inactive', `${t.name} is switched off`, {
        status: 409,
      });
    return t;
  }

  /** The types for the issue screen and the register's filter: their checks and the fields each asks for. */
  async types(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureSetup(c);
      const r = await c.query<TypeRow & { issued: number }>(
        `SELECT t.id::text, t.code, t.name, t.audience, t.prefix, t.template_id::text, d.name AS template_name, t.rules,
              t.multiple, t.uses_book, t.active, t.sort_order, t.description, t.fields, t.variants, t.issuers, t.built_in,
                (SELECT count(*)::int FROM certificates x WHERE x.type_id = t.id AND x.copy_no = 0) AS issued
           FROM certificate_types t LEFT JOIN document_templates d ON d.id = t.template_id AND d.deleted_at IS NULL
          ORDER BY t.sort_order, t.name`,
      );
      return {
        rows: r.rows.map((t) => ({
          code: t.code,
          name: t.name,
          audience: t.audience,
          prefix: t.prefix,
          template: t.template_name,
          rules: t.rules,
          multiple: t.multiple,
          usesBook: t.uses_book,
          active: t.active,
          issued: t.issued,
          description: t.description,
          builtIn: t.built_in,
          variants: t.variants,
          restricted: t.issuers.length > 0,
          fields: fieldsOf(t.code, t.fields),
        })),
        can: this.can(ctx),
      };
    });
  }

  private can(ctx: RequestContext) {
    const has = (p: string) => ctx.permissions?.has(p) ?? false;
    return {
      issue: has(CERTIFICATE.issue),
      cancel: has(CERTIFICATE.cancel),
      override: has(CERTIFICATE.override),
      setup: has(CERTIFICATE.setup),
    };
  }

  // ---- what a certificate would print ------------------------------------------------------------------------------
  private async ledgerOf(
    ctx: RequestContext,
    type: TypeRow,
    studentId: string | undefined,
  ): Promise<Ledger | null> {
    if (!type.rules.fees || type.audience !== 'STUDENT' || !studentId) return null;
    try {
      return await this.ledgers.ledger(ctx, studentId);
    } catch (error) {
      if (error instanceof DomainError && error.status === 404) return null;
      throw error;
    }
  }

  /** Whoever the type is restricted to (its issuers' roles); the set-up right may always issue. */
  private async assertIssuer(c: PoolClient, ctx: RequestContext, type: TypeRow): Promise<void> {
    if (!type.issuers.length || (ctx.permissions?.has(CERTIFICATE.setup) ?? false)) return;
    const r = await c.query<{ ok: boolean; names: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM user_roles ur
                       WHERE ur.user_id = app.current_user_id() AND ur.role_id = ANY($1::bigint[]) AND ur.revoked_at IS NULL
                         AND (ur.valid_from IS NULL OR ur.valid_from::date <= CURRENT_DATE)
                         AND (ur.valid_to IS NULL OR ur.valid_to::date >= CURRENT_DATE)) AS ok,
              (SELECT string_agg(name, ', ' ORDER BY name) FROM roles WHERE id = ANY($1::bigint[])) AS names`,
      [type.issuers],
    );
    if (!r.rows[0]?.ok)
      throw new DomainError(
        'permission-denied',
        `${type.name} is issued by: ${r.rows[0]?.names ?? 'the roles set on the type'}`,
        { status: 403 },
      );
  }

  /** The layout a certificate is made with: the type's template, or one of its variants. */
  private async templateOf(c: PoolClient, type: TypeRow, variant?: string) {
    if (
      variant &&
      variant !== type.template_id &&
      !type.variants.some((v) => v.templateId === variant)
    )
      throw new DomainError('validation-failed', `That layout is not one of ${type.name}'s`, {
        status: 400,
      });
    const id = variant ?? type.template_id;
    if (!id) return undefined;
    return (
      await c.query<{
        version_id: string;
        body_html: string;
        styles_css: string;
        page_width: string;
        page_height: string;
      }>(
        `SELECT v.id::text AS version_id, v.body_html, v.styles_css, v.page_width, v.page_height
           FROM document_template_versions v JOIN document_templates d ON d.id = v.template_id AND d.deleted_at IS NULL
          WHERE v.template_id = $1 ORDER BY v.version DESC LIMIT 1`,
        [id],
      )
    ).rows[0];
  }

  /**
   * The signature boxes as they print (docs/design/87, phase B): Prepared by — whoever issues it, with their signature
   * image, name, Emp. ID · designation and the date and time; Checked by — left to sign; the signatory (the principal)
   * with the signature image when the settings print it. Frozen with the certificate.
   */
  private async signs(
    c: PoolClient,
    ctx: RequestContext,
  ): Promise<{ signs: CertificateSign[]; footerNote: string }> {
    const r = (
      await c.query<{
        title: string | null;
        print_signature: boolean | null;
        print_preparer: boolean | null;
        footer_note: string | null;
        s_name: string | null;
        s_code: string | null;
        s_designation: string | null;
        s_file: string | null;
        p_name: string | null;
        p_code: string | null;
        p_designation: string | null;
        p_file: string | null;
        timezone: string | null;
      }>(
        `SELECT cs.signatory_title AS title, cs.print_signature, cs.print_preparer, cs.footer_note,
                e.display_name AS s_name, e.employee_code AS s_code, e.designation AS s_designation, e.signature_file_id::text AS s_file,
                me.display_name AS p_name, me.employee_code AS p_code, me.designation AS p_designation,
                me.signature_file_id::text AS p_file, sc.timezone
           FROM schools sc
           LEFT JOIN certificate_settings cs ON cs.school_id = sc.id
           LEFT JOIN employees e ON e.id = cs.signatory_employee_id AND e.deleted_at IS NULL
           LEFT JOIN LATERAL (SELECT x.display_name, x.employee_code, x.designation, x.signature_file_id FROM employees x
                               WHERE x.user_id = app.current_user_id() AND x.deleted_at IS NULL
                               ORDER BY (x.status = 'active') DESC, x.id LIMIT 1) me ON true
          WHERE sc.id = app.current_school_id()`,
      )
    ).rows[0];
    const preparer = r?.print_preparer ?? true;
    return {
      signs: [
        {
          title: 'Prepared by',
          ...(preparer
            ? {
                name: r?.p_name ?? ctx.user.displayName,
                empId: r?.p_code ?? null,
                designation: r?.p_designation ?? null,
                at: `Issued on ${stamp(new Date(), r?.timezone)}`,
                fileId: r?.p_file ?? null,
              }
            : {}),
        },
        { title: 'Checked by' },
        {
          title: r?.title ?? 'Principal',
          name: r?.s_name ?? null,
          empId: r?.s_code ?? null,
          designation: r?.s_designation ?? null,
          fileId: (r?.print_signature ?? true) ? (r?.s_file ?? null) : null,
        },
      ],
      footerNote: r?.footer_note ?? '',
    };
  }

  /** The logo and the signature images, as data URIs (the preview; the workers load the same for the PDF). */
  private async assets(c: PoolClient, data: Record<string, unknown>) {
    const ids = certificateImageIds(data);
    const r = await c.query<{
      id: string;
      object_key: string;
      content_type: string | null;
      logo: boolean;
    }>(
      `WITH l AS (SELECT NULLIF(branding->>'logoFileId', '') AS id FROM schools WHERE id = app.current_school_id())
       SELECT f.id::text, f.object_key, f.content_type, (f.id::text = (SELECT id FROM l)) AS logo
         FROM files f
        WHERE f.deleted_at IS NULL AND (f.id::text = ANY($1::text[]) OR f.id::text = (SELECT id FROM l))`,
      [ids],
    );
    let logo: string | null = null;
    const images: Record<string, string> = {};
    for (const f of r.rows) {
      try {
        const bytes = await this.storage.read(f.object_key);
        const uri = `data:${f.content_type ?? 'image/png'};base64,${bytes.toString('base64')}`;
        if (f.logo) logo = uri;
        if (ids.includes(f.id)) images[f.id] = uri;
      } catch {
        // a file that cannot be read prints without its image
      }
    }
    return { logo, images };
  }

  /** The paper: the template with EduPro's blocks, on its page. */
  private paperHtml(
    t: { body_html: string; styles_css: string; page_width: string; page_height: string },
    data: Record<string, unknown>,
    assets: { logo: string | null; images: Record<string, string> },
  ): string {
    const qr = data.qr as { url: string; image: string } | undefined;
    return documentHtml({
      body: renderTemplate(t.body_html, {
        ...data,
        blocks: certificateBlocks(data, { ...assets, qr: qr ?? null }),
      }),
      css: CERTIFICATE_BLOCK_CSS + t.styles_css,
      pageWidth: t.page_width,
      pageHeight: t.page_height,
    });
  }

  private async build(
    c: PoolClient,
    ctx: RequestContext,
    type: TypeRow,
    dto: PreviewCertificateDto,
    ledger: Ledger | null,
    opts: IssueOptions,
  ) {
    const tenant = requireTenant(ctx);
    await this.assertIssuer(c, ctx, type);
    const year = tenant.academicYearId
      ? (
          await c.query<{ code: string }>(`SELECT code FROM academic_years WHERE id = $1`, [
            tenant.academicYearId,
          ])
        ).rows[0]?.code
      : undefined;
    if (!year)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    const today = todayIso();
    const issuedOn = dto.issuedOn ?? today;
    const specs = fieldsOf(type.code, type.fields);
    const keys = new Set(specs.map((f) => f.key));
    const given = Object.fromEntries(Object.entries(dto.fields).filter(([k]) => keys.has(k)));
    const template = await this.templateOf(c, type, dto.variant);
    const paper = await this.signs(c, ctx);
    const school = await schoolData(c);
    const cert = {
      name: type.name,
      typeCode: type.code,
      number: '',
      issuedOn: dmy(issuedOn),
      purpose: dto.purpose ?? '',
      bookNo: null as number | null,
      slNo: null as number | null,
      issuedBy: ctx.user.displayName,
    };
    const none = {
      today: issuedOn,
      leavingOn: null,
      requestedOn: null,
      reason: null,
      subjects: '',
      paidTo: '',
      concession: '',
      workingDays: 0,
      present: 0,
    };

    if (type.audience === 'STAFF') {
      if (!dto.employeeId)
        throw new DomainError('validation-failed', 'Choose the employee', { status: 400 });
      const employee = await employeeData(c, dto.employeeId);
      if (!employee) throw new DomainError('not-found', 'Employee not found');
      const fields: Record<string, string | number> = {
        ...fieldDefaults(type.code, none),
        ...given,
      };
      const checks = await runChecks(c, {
        audience: 'STAFF',
        studentId: dto.employeeId,
        typeId: type.id,
        rules: type.rules,
        multiple: type.multiple,
        asOf: today,
        yearCode: year,
        ledger: null,
      });
      return {
        year,
        issuedOn,
        leavingOn: null as string | null,
        checks,
        problems: checkFields(specs, fields),
        fields,
        specs,
        template,
        withdrawal: null,
        student: null as Record<string, unknown> | null,
        person: {
          kind: 'employee' as 'student' | 'employee',
          id: dto.employeeId,
          name: String(employee.name),
          no: String(employee.code),
          detail: String(employee.designation ?? ''),
          left: Boolean(employee.left),
        },
        data: {
          school,
          employee,
          fields,
          text: fieldText(specs, fields),
          cert,
          signs: paper.signs,
          footerNote: paper.footerNote,
          today: dmy(today),
        } as Record<string, unknown> & { cert: typeof cert },
      };
    }

    if (!dto.studentId)
      throw new DomainError('validation-failed', 'Choose the student', { status: 400 });
    const studentId = dto.studentId;
    const sd = await studentData(c, studentId, null);
    if (!sd) throw new DomainError('not-found', 'Student not found');
    const wd = (
      await c.query<{
        id: string;
        leaving_on: string | null;
        requested_on: string | null;
        reason: string | null;
      }>(
        `SELECT id::text, leaving_on::text, requested_on::text, reason FROM student_withdrawals
          WHERE student_id = $1 AND status NOT IN ('cancelled', 'revoked') ORDER BY created_at DESC LIMIT 1`,
        [studentId],
      )
    ).rows[0];
    const leavingOn = opts.leavingOn ?? wd?.leaving_on ?? null;
    const st = sd.student;
    const fields: Record<string, string | number> = {
      ...fieldDefaults(type.code, {
        ...none,
        leavingOn,
        requestedOn: wd?.requested_on ?? null,
        reason: wd?.reason ?? null,
        subjects: sd.subjects,
        paidTo: String(sd.fees.paidTo ?? ''),
        concession: String(sd.fees.concession ?? 'No'),
        workingDays: Number(sd.attendance.workingDays ?? 0),
        present: Number(sd.attendance.present ?? 0),
        board: String(school.board ?? ''),
        registrationNo: String(st.registrationNo ?? ''),
        year,
      }),
      ...given,
    };
    const checks = await runChecks(c, {
      studentId,
      typeId: type.id,
      rules: type.rules,
      multiple: type.multiple,
      asOf: leavingOn && leavingOn < today ? leavingOn : today,
      withdrawalId: opts.withdrawalId ?? null,
      yearCode: year,
      ledger,
    });
    const asDate = (v: string | number | undefined) =>
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? dmy(v) : String(v ?? '');
    const tc =
      type.code === 'TC'
        ? {
            lastClass: [st.className, st.section].filter(Boolean).join(' – '),
            lastClassWords: st.classWords,
            examResult: fields.examResult ?? '',
            failed: fields.failed ?? '',
            subjects: fields.subjects ?? '',
            promotion: fields.promotion ?? '',
            duesMonth: fields.duesMonth ?? '',
            concession: fields.concession ?? '',
            workingDays: fields.workingDays ?? '',
            daysPresent: fields.daysPresent ?? '',
            ncc: fields.ncc ?? '',
            activities: fields.activities ?? '',
            conduct: fields.conduct ?? '',
            applicationDate: asDate(fields.applicationDate),
            struckOffDate: asDate(fields.struckOffDate),
            reason: fields.reason ?? '',
            remarks: fields.remarks ?? '',
          }
        : undefined;
    const fees =
      type.code === 'FEE_PAID'
        ? await feePaidData(c, studentId, tenant.academicYearId ?? null)
        : undefined;
    return {
      year,
      issuedOn,
      leavingOn,
      checks,
      problems: checkFields(specs, fields),
      fields,
      specs,
      template,
      withdrawal: wd ?? null,
      student: st as Record<string, unknown> | null,
      person: {
        kind: 'student' as 'student' | 'employee',
        id: studentId,
        name: String(st.name),
        no: String(st.admissionNo),
        detail: String(st.classLabel ?? ''),
        left: Boolean(st.left),
      },
      data: {
        school,
        student: st,
        attendance: sd.attendance,
        ...(tc ? { tc } : {}),
        ...(fees ? { fees } : {}),
        fields,
        text: fieldText(specs, fields),
        cert,
        signs: paper.signs,
        footerNote: paper.footerNote,
        today: dmy(today),
      } as Record<string, unknown> & { cert: typeof cert },
    };
  }

  /** What the certificate would print, its checks and the fields it asks for, before it is issued (nothing saved). */
  async preview(ctx: RequestContext, dto: PreviewCertificateDto) {
    const tenant = requireTenant(ctx);
    const type = await this.db.tenant(tenant, async (c) => {
      await this.ensureSetup(c);
      return this.typeOf(c, dto.typeCode);
    });
    const ledger = await this.ledgerOf(ctx, type, dto.studentId);
    return this.db.tenant(tenant, async (c) => {
      const b = await this.build(c, ctx, type, dto, ledger, {});
      const data = {
        ...b.data,
        cert: {
          ...b.data.cert,
          number: `${type.prefix}/${b.year}/(next)`,
          bookNo: type.uses_book ? '(next)' : null,
          slNo: '(next)',
          copyNo: 0,
          duplicate: false,
        },
        qr: await this.verify.samplePageQr(c),
      };
      const assets = await this.assets(c, data);
      return {
        type: {
          code: type.code,
          name: type.name,
          audience: type.audience,
          usesBook: type.uses_book,
          multiple: type.multiple,
        },
        person: b.person,
        student:
          b.person.kind === 'student'
            ? {
                id: b.person.id,
                name: b.person.name,
                admissionNo: b.person.no,
                className: b.student?.className,
                section: b.student?.section,
                left: b.person.left,
              }
            : null,
        checks: b.checks,
        failed: b.checks.filter((x) => !x.ok).length,
        held: b.checks.some((x) => x.key === 'one' && !x.ok),
        fields: b.specs,
        values: b.fields,
        problems: b.problems,
        variants: type.variants.length
          ? [
              { templateId: type.template_id, label: type.template_name ?? 'Standard' },
              ...type.variants,
            ]
          : [],
        variant: dto.variant ?? type.template_id,
        html: b.template ? this.paperHtml(b.template, data, assets) : null,
        can: this.can(ctx),
      };
    });
  }

  /**
   * A template as it would print, while it is being edited (docs/design/87, phase B): the body and styles given, with
   * a student or employee — the one chosen, else the school's first on the rolls — and each typed field shown as
   * [its label].
   */
  async templatePreview(ctx: RequestContext, dto: TemplatePreviewDto) {
    assertSafeTemplate(dto.bodyHtml, dto.stylesCss);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.ensureSetup(c);
      const type = await this.typeOf(c, dto.typeCode).catch((e: unknown) => {
        // a switched-off type is still shown while its template is edited
        if (e instanceof DomainError && e.type === 'certificate.type_inactive')
          return c
            .query<TypeRow>(
              `SELECT t.id::text, t.code, t.name, t.audience, t.prefix, t.template_id::text, NULL AS template_name, t.rules,
                      t.multiple, t.uses_book, t.active, t.sort_order, t.description, t.fields, t.variants, t.issuers, t.built_in
                 FROM certificate_types t WHERE t.code = $1`,
              [dto.typeCode],
            )
            .then((r) => r.rows[0]!);
        throw e;
      });
      const sample =
        type.audience === 'STAFF'
          ? (dto.employeeId ??
            (
              await c.query<{ id: string }>(
                `SELECT id::text FROM employees WHERE status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
              )
            ).rows[0]?.id)
          : (dto.studentId ??
            (
              await c.query<{ id: string }>(
                `SELECT s.id::text FROM students s WHERE s.status = 'active' AND s.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM enrolments e WHERE e.student_id = s.id AND e.status = 'active')
                  ORDER BY s.id LIMIT 1`,
              )
            ).rows[0]?.id);
      if (!sample)
        throw new DomainError(
          'certificate.no_sample',
          type.audience === 'STAFF'
            ? 'No employee to show the template with'
            : 'No student on the rolls to show the template with',
          { status: 409 },
        );
      const b = await this.build(
        c,
        ctx,
        { ...type, issuers: [] },
        {
          typeCode: type.code,
          ...(type.audience === 'STAFF' ? { employeeId: sample } : { studentId: sample }),
          fields: {},
        },
        null,
        {},
      );
      const shown: Record<string, string | number> = { ...b.fields };
      for (const f of b.specs)
        if (shown[f.key] === undefined || String(shown[f.key]).trim() === '')
          shown[f.key] = `[${f.label}]`;
      const data = {
        ...b.data,
        fields: shown,
        text: fieldText(b.specs, shown),
        cert: {
          ...b.data.cert,
          number: `${type.prefix}/${b.year}/00001`,
          bookNo: type.uses_book ? 1 : null,
          slNo: type.uses_book ? 1 : null,
          purpose: '[purpose]',
          copyNo: 0,
          duplicate: false,
        },
        qr: await this.verify.samplePageQr(c),
      };
      const assets = await this.assets(c, data);
      return {
        person: b.person,
        html: this.paperHtml(
          {
            body_html: dto.bodyHtml,
            styles_css: dto.stylesCss,
            page_width: dto.pageWidth,
            page_height: dto.pageHeight,
          },
          data,
          assets,
        ),
      };
    });
  }

  // ---- issue -------------------------------------------------------------------------------------------------------
  private assertOverride(ctx: RequestContext) {
    if (!(ctx.permissions?.has(CERTIFICATE.override) ?? false))
      throw new DomainError(
        'permission-denied',
        'A check has failed: only the principal (the certificate override right) may issue it anyway',
        { status: 403, extra: { permission: CERTIFICATE.override } },
      );
    if (ctx.user.impersonation)
      throw new DomainError(
        'impersonation-restricted',
        'Privileged actions are not available while impersonating',
        {
          status: 403,
        },
      );
    const fresh =
      ctx.user.mfa &&
      (ctx.user.authTime === undefined ||
        Math.floor(Date.now() / 1000) - ctx.user.authTime <= this.env.MFA_FRESHNESS_MINUTES * 60);
    if (!fresh)
      throw new DomainError(
        'mfa-required',
        'Issuing past a failed check requires a recent multi-factor sign-in',
        {
          status: 403,
        },
      );
  }

  /**
   * Issues a certificate. The checks run first: a certificate already held (by the type's rule) stops it; any other
   * failed check stops it unless an override reason comes with it from the principal. The TC also ends the student's
   * enrolment (unless the withdrawal is still running) and keeps its transfer certificate row for the withdrawal.
   */
  async issue(
    ctx: RequestContext,
    dto: IssueCertificateDto,
    opts: IssueOptions = {},
  ): Promise<CertificateRow> {
    const tenant = requireTenant(ctx);
    const type = await this.db.tenant(tenant, async (c) => {
      await this.ensureSetup(c);
      return this.typeOf(c, dto.typeCode);
    });
    const ledger = await this.ledgerOf(ctx, type, dto.studentId);
    const id = await this.db.tenant(tenant, async (c) => {
      // one issue at a time for a person and a type (two clicks never make two TCs)
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('certificate:' || $1 || ':' || $2))`, [
        type.id,
        dto.studentId ?? `e${dto.employeeId ?? ''}`,
      ]);
      const b = await this.build(c, ctx, type, dto, ledger, opts);
      if (dto.requestId) {
        if (!this.requestHook) throw new Error('certificate requests are not wired');
        await this.requestHook.check(c, dto.requestId, type.id, b.person);
      }
      if (b.problems.length)
        throw new DomainError('validation-failed', b.problems.join('; '), {
          status: 400,
          extra: { problems: b.problems },
        });
      if (!b.template)
        throw new DomainError('template.missing', `${type.name} has no template`, { status: 409 });
      const held = b.checks.find((x) => x.key === 'one' && !x.ok);
      if (held) throw new DomainError('certificate.already_held', held.detail, { status: 409 });
      const failed = b.checks.filter((x) => !x.ok);
      if (failed.length) {
        if (!dto.overrideReason)
          throw new DomainError(
            'certificate.checks_failed',
            `Not cleared: ${failed.map((x) => `${x.label} (${x.detail})`).join('; ')}`,
            { status: 409, extra: { checks: b.checks } },
          );
        this.assertOverride(ctx);
      }
      const no = (
        await c.query<{ number: string; serial: number }>(
          `SELECT * FROM app.next_certificate_no($1, $2, $3)`,
          [type.code, type.prefix, b.year],
        )
      ).rows[0]!;
      const book = type.uses_book
        ? (
            await c.query<{ sl_no: number; book_no: number }>(
              `SELECT * FROM app.next_certificate_sl()`,
            )
          ).rows[0]!
        : null;
      const data = {
        ...b.data,
        cert: {
          ...b.data.cert,
          number: no.number,
          bookNo: book?.book_no ?? null,
          slNo: book?.sl_no ?? null,
        },
      };
      let tcId: string | null = null;
      if (type.code === 'TC') {
        const s = (
          await c.query<{ status: string }>(`SELECT status::text FROM students WHERE id = $1`, [
            dto.studentId,
          ])
        ).rows[0]!;
        const feesOk = b.checks.find((x) => x.key === 'fees')?.ok ?? true;
        tcId = (
          await c.query<{ id: string }>(
            `INSERT INTO transfer_certificates (school_id, student_id, academic_year_id, tc_no, serial, issued_on, reason, last_class, conduct,
                                                promotion_status, dues_cleared, remarks, snapshot, template_id, issued_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, app.current_user_id())
             RETURNING id::text`,
            [
              dto.studentId,
              tenant.academicYearId,
              no.number,
              no.serial,
              b.issuedOn,
              String(b.fields.reason ?? ''),
              [b.student?.classCode, b.student?.section].filter(Boolean).join('-') || null,
              String(b.fields.conduct ?? 'Good'),
              String(b.fields.promotion ?? '') || null,
              feesOk,
              String(b.fields.remarks ?? '') || null,
              JSON.stringify(b.student),
              type.template_id,
            ],
          )
        ).rows[0]!.id;
        if (s.status === 'active' && !opts.keepStatus) {
          const leftOn = String(b.fields.struckOffDate ?? b.issuedOn);
          await c.query(`SELECT set_config('app.status_reason', $1, true)`, [
            `transfer certificate ${no.number}`,
          ]);
          await c.query(
            `UPDATE students SET status = 'inactive', left_on = $2::date, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
            [dto.studentId, leftOn],
          );
          await c.query(
            `UPDATE enrolments SET status = 'transferred', ended_on = $2::date, updated_at = now(), updated_by = app.current_user_id()
              WHERE student_id = $1 AND status = 'active'`,
            [dto.studentId, leftOn],
          );
        }
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO certificates (school_id, type_id, number, serial, year_code, student_id, issued_on, issued_by, purpose, data,
                                   template_version_id, checks, override_reason, override_by, book_no, sl_no, transfer_certificate_id,
                                   employee_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date, app.current_user_id(), $7, $8::jsonb, $9, $10::jsonb,
                 $11, CASE WHEN $11::text IS NULL THEN NULL ELSE app.current_user_id() END, $12, $13, $14, $15)
         RETURNING id::text`,
        [
          type.id,
          no.number,
          no.serial,
          b.year,
          b.person.kind === 'student' ? b.person.id : null,
          b.issuedOn,
          dto.purpose || null,
          JSON.stringify(data),
          b.template.version_id,
          JSON.stringify(b.checks),
          failed.length ? dto.overrideReason : null,
          book?.book_no ?? null,
          book?.sl_no ?? null,
          tcId,
          b.person.kind === 'employee' ? b.person.id : null,
        ],
      );
      const id = r.rows[0]!.id;
      await this.verify.stamp(c, id);
      if (dto.requestId && this.requestHook) {
        await c.query(`UPDATE certificates SET request_id = $2 WHERE id = $1`, [id, dto.requestId]);
        await this.requestHook.issued(c, ctx, dto.requestId, id, no.number);
      }
      await this.audit.stage(ctx, c, {
        action: 'certificate.issue',
        entityType: 'certificates',
        entityId: id,
        after: {
          number: no.number,
          type: type.code,
          ...(b.person.kind === 'student'
            ? { studentId: b.person.id }
            : { employeeId: b.person.id }),
          ...(failed.length
            ? { override: dto.overrideReason, failed: failed.map((x) => x.key) }
            : {}),
          ...(book ? { bookNo: book.book_no, slNo: book.sl_no } : {}),
        },
      });
      return id;
    });
    await this.queue(ctx, id);
    return this.get(ctx, id);
  }

  /** A duplicate of an issued certificate: the same number and paper, printed DUPLICATE (copy n). */
  async duplicate(ctx: RequestContext, id: string, reason: string): Promise<CertificateRow> {
    const tenant = requireTenant(ctx);
    const dupId = await this.db.tenant(tenant, async (c) => {
      const o = (
        await c.query<{ id: string; original_id: string | null }>(
          `SELECT id::text, original_id::text FROM certificates WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!o) throw new DomainError('not-found', 'Certificate not found');
      const originalId = o.original_id ?? o.id;
      // the original locked: copy numbers are taken one at a time
      const orig = (
        await c.query<{ status: string; template_version_id: string | null; number: string }>(
          `SELECT status, template_version_id::text, number FROM certificates WHERE id = $1 FOR UPDATE`,
          [originalId],
        )
      ).rows[0]!;
      if (orig.status !== 'issued')
        throw new DomainError('certificate.cancelled', 'A cancelled certificate has no duplicate', {
          status: 409,
        });
      if (!orig.template_version_id)
        throw new DomainError(
          'certificate.no_version',
          'This certificate was made before the register kept its paper: issue it again or reprint the TC',
          { status: 409 },
        );
      const r = await c.query<{ id: string; copy_no: number }>(
        `INSERT INTO certificates (school_id, type_id, number, serial, year_code, copy_no, original_id, student_id, employee_id,
                                   issued_on, issued_by, purpose, data, template_version_id, checks, book_no, sl_no, legacy, legacy_ref)
         SELECT school_id, type_id, number, serial, year_code,
                (SELECT max(copy_no) + 1 FROM certificates WHERE id = $1 OR original_id = $1), id, student_id, employee_id,
                CURRENT_DATE, app.current_user_id(), purpose,
                jsonb_set(data, '{cert,duplicateReason}', to_jsonb($2::text)) - 'qr', template_version_id, checks, book_no, sl_no, legacy, legacy_ref
           FROM certificates WHERE id = $1
         RETURNING id::text, copy_no`,
        [originalId, reason],
      );
      const dup = r.rows[0]!;
      await this.verify.stamp(c, dup.id);
      await this.audit.stage(ctx, c, {
        action: 'certificate.duplicate',
        entityType: 'certificates',
        entityId: dup.id,
        after: { number: orig.number, copyNo: dup.copy_no, reason },
      });
      return dup.id;
    });
    await this.queue(ctx, dupId);
    return this.get(ctx, dupId);
  }

  /** Cancels an issued certificate (and its duplicates); its number is never given again. A TC's row is cancelled too. */
  async cancel(ctx: RequestContext, id: string, reason: string): Promise<CertificateRow> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const x = (
        await c.query<{ status: string; number: string; copy_no: number; tc: string | null }>(
          `SELECT status, number, copy_no, transfer_certificate_id::text AS tc FROM certificates WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!x) throw new DomainError('not-found', 'Certificate not found');
      if (x.status === 'cancelled')
        throw new DomainError(
          'certificate.already_cancelled',
          'The certificate is already cancelled',
          { status: 409 },
        );
      await this.cancelRows(c, id, reason);
      if (x.tc && x.copy_no === 0)
        await c.query(
          `UPDATE transfer_certificates SET status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_id(), cancel_reason = $2
            WHERE id = $1 AND status = 'issued'`,
          [x.tc, reason],
        );
      await this.audit.stage(ctx, c, {
        action: 'certificate.cancel',
        entityType: 'certificates',
        entityId: id,
        before: { status: x.status },
        after: { status: 'cancelled', number: x.number, copyNo: x.copy_no, reason },
      });
    });
    return this.get(ctx, id);
  }

  /** The register rows of a certificate (an original takes its duplicates with it). */
  async cancelRows(c: PoolClient, id: string, reason: string) {
    await c.query(
      `UPDATE certificates SET status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_user_id(), cancel_reason = $2
        WHERE (id = $1 OR original_id = $1) AND status = 'issued'`,
      [id, reason],
    );
  }

  /** The TC's register row, when a TC is cancelled from its own screen. */
  async cancelForTc(c: PoolClient, tcId: string, reason: string) {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM certificates WHERE transfer_certificate_id = $1 AND copy_no = 0`,
      [tcId],
    );
    if (r.rows[0]) await this.cancelRows(c, r.rows[0].id, reason);
  }

  /** (Re)makes the PDF: the frozen data through the template version it was made with. */
  async render(ctx: RequestContext, id: string): Promise<CertificateRow> {
    await this.queue(ctx, id);
    return this.get(ctx, id);
  }

  private async queue(ctx: RequestContext, id: string): Promise<string> {
    const tenant = requireTenant(ctx);
    const x = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        number: string;
        copy_no: number;
        version: string | null;
        tc: string | null;
        tc_template: string | null;
        type_name: string;
      }>(
        `SELECT x.number, x.copy_no, x.template_version_id::text AS version, x.transfer_certificate_id::text AS tc,
                COALESCE(tc.template_id, (SELECT id FROM document_templates WHERE kind = 'transfer_certificate' AND status = 'active'
                                           AND deleted_at IS NULL ORDER BY id LIMIT 1))::text AS tc_template,
                t.name AS type_name
           FROM certificates x JOIN certificate_types t ON t.id = x.type_id
           LEFT JOIN transfer_certificates tc ON tc.id = x.transfer_certificate_id
          WHERE x.id = $1`,
        [id],
      );
      return r.rows[0];
    });
    if (!x) throw new DomainError('not-found', 'Certificate not found');
    if (x.version) await this.db.tenant(tenant, (c) => this.verify.stamp(c, id));
    const title = `${x.type_name} ${x.number}${x.copy_no ? ` (duplicate ${String(x.copy_no)})` : ''}`;
    let exp;
    if (x.version)
      exp = await this.reports.createRenderedForOwner(
        ctx,
        { dataset: 'certificate_doc', format: 'pdf', params: { certificateId: id }, title },
        'certificate.render',
      );
    else if (x.tc && x.tc_template)
      // a TC issued before the register kept its paper: printed as it was, from the TC template
      exp = await this.reports.createRenderedForOwner(
        ctx,
        {
          dataset: 'document',
          format: 'pdf',
          params: { templateId: x.tc_template, entity: 'transfer_certificate', entityId: x.tc },
          title,
        },
        'certificate.render',
      );
    else
      throw new DomainError('certificate.no_version', 'This certificate has no paper to print', {
        status: 409,
      });
    await this.db.tenant(tenant, async (c) => {
      await c.query(`UPDATE certificates SET export_id = $2 WHERE id = $1`, [id, exp.id]);
      if (x.tc && x.copy_no === 0)
        await c.query(`UPDATE transfer_certificates SET export_id = $2 WHERE id = $1`, [
          x.tc,
          exp.id,
        ]);
    });
    return exp.id;
  }

  // ---- the register ------------------------------------------------------------------------------------------------
  async get(ctx: RequestContext, id: string): Promise<CertificateRow> {
    const row = await this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
      const r = await c.query<Db>(`${SELECT} WHERE x.id = $1`, [id]);
      return r.rows[0];
    });
    if (!row) throw new DomainError('not-found', 'Certificate not found');
    return toRow(row);
  }

  /** One certificate with its copies and what it printed (the detail page). */
  async detail(ctx: RequestContext, id: string) {
    const row = await this.get(ctx, id);
    const originalId = row.originalId ?? row.id;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const copies = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
        `${SELECT} WHERE x.id = $1 OR x.original_id = $1 ORDER BY x.copy_no`,
        [originalId],
      );
      const d = await c.query<{
        data: Record<string, unknown>;
        version: number | null;
        template: string | null;
      }>(
        `SELECT x.data, v.version, dt.name AS template
           FROM certificates x LEFT JOIN document_template_versions v ON v.id = x.template_version_id
           LEFT JOIN document_templates dt ON dt.id = v.template_id
          WHERE x.id = $1`,
        [id],
      );
      return {
        ...row,
        copies: copies.rows.map(toRow),
        data: d.rows[0]?.data ?? {},
        template: d.rows[0]?.template
          ? { name: d.rows[0].template, version: d.rows[0].version }
          : null,
        can: this.can(ctx),
      };
    });
  }

  private where(q: ListCertificatesQueryDto) {
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('$?', `$${String(params.length)}`));
    };
    if (q.type) add('t.code = $?', q.type);
    if (q.status) add('x.status = $?', q.status);
    if (q.copy === 'original') where.push('x.copy_no = 0');
    if (q.copy === 'duplicate') where.push('x.copy_no > 0');
    if (q.override === 'yes') where.push('x.override_reason IS NOT NULL');
    if (q.from) add('x.issued_on >= $?::date', q.from);
    if (q.to) add('x.issued_on <= $?::date', q.to);
    if (q.year) add('x.year_code = $?', q.year);
    if (q.q) {
      params.push(`%${q.q}%`);
      const n = `$${String(params.length)}`;
      where.push(
        `(x.number ILIKE ${n} OR s.display_name ILIKE ${n} OR s.admission_no ILIKE ${n} OR em.display_name ILIKE ${n} OR em.employee_code ILIKE ${n})`,
      );
    }
    return { sql: where.join(' AND '), params };
  }

  async list(ctx: RequestContext, q: ListCertificatesQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.ensureSetup(c);
      const w = this.where(q);
      const from = `FROM certificates x JOIN certificate_types t ON t.id = x.type_id LEFT JOIN students s ON s.id = x.student_id
                      LEFT JOIN employees em ON em.id = x.employee_id`;
      const figures = (
        await c.query<{
          total: number;
          issued: number;
          cancelled: number;
          duplicates: number;
          overrides: number;
          month: number;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- from and w.sql are fixed fragments; values are bound parameters
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE x.status = 'issued' AND x.copy_no = 0)::int AS issued,
                  count(*) FILTER (WHERE x.status = 'cancelled')::int AS cancelled,
                  count(*) FILTER (WHERE x.copy_no > 0)::int AS duplicates,
                  count(*) FILTER (WHERE x.override_reason IS NOT NULL)::int AS overrides,
                  count(*) FILTER (WHERE x.issued_on >= date_trunc('month', CURRENT_DATE))::int AS month
             ${from} WHERE ${w.sql}`,
          w.params,
        )
      ).rows[0]!;
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT and w.sql are fixed fragments; values are bound parameters
        `${SELECT} WHERE ${w.sql} ORDER BY x.issued_on DESC, x.id DESC LIMIT $${String(w.params.length + 1)} OFFSET $${String(w.params.length + 2)}`,
        [...w.params, q.size, (q.page - 1) * q.size],
      );
      const years = await c.query<{ year_code: string }>(
        `SELECT DISTINCT year_code FROM certificates WHERE year_code IS NOT NULL ORDER BY year_code DESC LIMIT 20`,
      );
      return {
        rows: r.rows.map(toRow),
        total: figures.total,
        figures,
        years: years.rows.map((y) => y.year_code),
        can: this.can(ctx),
      };
    });
  }

  /** Students to issue to (on the rolls or past), by name or admission no., for the issue screen. */
  async students(ctx: RequestContext, q: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        status: string;
        class_label: string | null;
        left_on: string | null;
      }>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no, s.status::text, s.left_on::text,
                (SELECT c.name || ' – ' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                   JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = e.academic_year_id
                  WHERE e.student_id = s.id AND e.status <> 'cancelled' ORDER BY y.start_date DESC, e.id DESC LIMIT 1) AS class_label
           FROM students s
          WHERE s.deleted_at IS NULL AND s.merged_into_id IS NULL
            AND (s.display_name ILIKE $1 OR s.admission_no ILIKE $1)
          ORDER BY (s.status = 'active') DESC, s.display_name LIMIT 20`,
        [`%${q}%`],
      );
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          name: x.name,
          admissionNo: x.admission_no,
          className: x.class_label,
          left: x.status !== 'active',
          leftOn: x.left_on,
        })),
      };
    });
  }

  /** Employees to issue to (in service or past), by name or employee code: staff certificates and the signatory. */
  async employees(ctx: RequestContext, q: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        code: string;
        designation: string | null;
        status: string;
      }>(
        `SELECT id::text, display_name AS name, employee_code AS code, designation, status::text
           FROM employees
          WHERE deleted_at IS NULL AND (display_name ILIKE $1 OR employee_code ILIKE $1)
          ORDER BY (status = 'active') DESC, display_name LIMIT 20`,
        [`%${q}%`],
      );
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          name: x.name,
          code: x.code,
          designation: x.designation,
          left: x.status !== 'active',
        })),
      };
    });
  }

  async forStudent(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
        `${SELECT} WHERE x.student_id = $1 ORDER BY x.issued_on DESC, x.id DESC`,
        [studentId],
      );
      return { rows: r.rows.map(toRow), can: this.can(ctx) };
    });
  }

  /** The register as Excel or PDF, with the filters shown. */
  async file(ctx: RequestContext, q: CertificatesFileQueryDto) {
    const { rows } = await this.list(ctx, { ...q, page: 1, size: 200 });
    let all = rows;
    // the register may be long: read it whole, a page at a time
    for (let page = 2; all.length === (page - 1) * 200 && page <= 100; page++)
      all = all.concat((await this.list(ctx, { ...q, page, size: 200 })).rows);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const filters = [
      q.type ? `Type ${q.type}` : 'All types',
      q.status ? (q.status === 'issued' ? 'Issued' : 'Cancelled') : null,
      q.copy ? (q.copy === 'original' ? 'Originals' : 'Duplicates') : null,
      q.override ? 'Issued past a failed check' : null,
      q.year ? `Year ${q.year}` : null,
      q.from || q.to ? `${q.from ? dmy(q.from) : '…'} to ${q.to ? dmy(q.to) : '…'}` : null,
      q.q ? `"${q.q}"` : null,
      `${String(all.length)} certificate(s)`,
    ].filter(Boolean) as string[];
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Certificate register',
        details: [filters.join(' · '), generatedOn()],
        legend:
          'Copy: 0 the original, 1, 2 … a duplicate. Override: issued by the principal past a failed check.',
        columns: [
          { label: 'Sr', width: 3, right: true },
          { label: 'Number', width: 11 },
          { label: 'Copy', width: 3, right: true },
          { label: 'Type', width: 10 },
          { label: 'Issued on', width: 7 },
          { label: 'Admission no.', width: 7 },
          { label: 'Student', width: 13 },
          { label: 'Class', width: 6 },
          { label: 'Book / Sl. no.', width: 6 },
          { label: 'Purpose', width: 10 },
          { label: 'Issued by', width: 9 },
          { label: 'Override', width: 4 },
          { label: 'Status', width: 6 },
        ],
        rows: all.map((x, i) => [
          i + 1,
          x.number,
          x.copyNo,
          x.typeName,
          dmy(x.issuedOn),
          x.admissionNo ?? '',
          x.studentName ?? '',
          x.className ?? '',
          x.bookNo ? `${String(x.bookNo)} / ${String(x.slNo ?? '')}` : '',
          x.purpose ?? '',
          x.issuedBy ?? '',
          x.overrideReason ? 'Yes' : '',
          x.status === 'issued'
            ? 'Issued'
            : `Cancelled${x.cancelReason ? `: ${x.cancelReason}` : ''}`,
        ]),
        filename: 'certificate-register',
      },
      q.format,
    );
  }
}
