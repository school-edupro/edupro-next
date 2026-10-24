import { Injectable } from '@nestjs/common';
import type { AdmissionAnswers } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FilesService } from '../files/files.service';
import { AdmissionCoreService } from './admission-core.service';
import { CandidatePortalService } from './portal/candidate-portal.service';
import type { DeskFeeDto, DeskStartDto } from './desk.dto';

const IMAGE = /^image\/(png|jpeg|webp)$/;
const IMAGE_OR_PDF = /^(application\/pdf|image\/(png|jpeg|webp))$/;

/**
 * The school desk (docs/design/39, part 3): the office registers a walk-in parent — the same form, saved
 * tab by tab — and takes the registration fee at the counter with a receipt in the fee module. The parent
 * can sign in to the portal later with the mobile or email given.
 */
@Injectable()
export class AdmissionDeskService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly portal: CandidatePortalService,
    private readonly files: FilesService,
  ) {}

  /** What the desk needs: the classes taking registrations now and the forms the office filled lately. */
  async overview(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const open = await this.portal.sessions(tenant.schoolId);
    const recent = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        number: string | null;
        status: string;
        candidate: string | null;
        class_name: string;
        mobile: string | null;
        progress: number;
        fee: string | null;
        created_at: Date;
        by: string | null;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.status::text, a.candidate_name AS candidate, cl.name AS class_name,
                COALESCE(a.contact_mobile, ap.mobile) AS mobile, a.progress, a.registration_fee::text AS fee, a.created_at,
                u.display_name AS by
           FROM applications a JOIN classes cl ON cl.id = a.class_id JOIN applicants ap ON ap.id = a.applicant_id
           LEFT JOIN users u ON u.id = a.entered_by
          WHERE a.entered_by IS NOT NULL ORDER BY a.created_at DESC LIMIT 50`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        number: x.number,
        status: x.status,
        candidate: x.candidate,
        className: x.class_name,
        mobile: x.mobile,
        progress: x.progress,
        feeDue: x.status === 'submitted' && !x.number && Number(x.fee ?? 0) > 0 ? Number(x.fee) : 0,
        createdAt: x.created_at.toISOString(),
        enteredBy: x.by,
      }));
    });
    return { sessions: open.sessions, recent };
  }

  async start(ctx: RequestContext, dto: DeskStartDto) {
    const tenant = requireTenant(ctx);
    const cand = await this.db.tenant(tenant, async (c) => {
      const mobile = dto.mobile ?? null;
      const email = dto.email?.toLowerCase() ?? null;
      const found = await c.query<{
        id: string;
        mobile: string | null;
        email: string | null;
        name: string | null;
      }>(
        `SELECT id::text, mobile, email::text AS email, name FROM applicants
          WHERE ($1::text IS NOT NULL AND mobile = $1) OR ($2::text IS NOT NULL AND lower(email::text) = $2) ORDER BY id LIMIT 1`,
        [mobile, email],
      );
      if (found.rows[0]) {
        const f = found.rows[0];
        await c.query(
          `UPDATE applicants SET mobile = COALESCE(mobile, $2), email = COALESCE(email, $3), name = COALESCE(name, $4) WHERE id = $1`,
          [f.id, mobile, email, dto.parentName ?? null],
        );
        return {
          id: f.id,
          schoolId: tenant.schoolId,
          mobile: f.mobile ?? mobile,
          email: f.email ?? email,
          name: f.name ?? dto.parentName ?? null,
        };
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO applicants (school_id, mobile, email, name) VALUES (app.current_school_id(), $1, $2, $3) RETURNING id::text`,
        [mobile, email, dto.parentName ?? null],
      );
      return {
        id: r.rows[0]!.id,
        schoolId: tenant.schoolId,
        mobile,
        email,
        name: dto.parentName ?? null,
      };
    });
    return this.portal.start(cand, dto.cycleId, dto.classId, ctx.user.id);
  }

  async form(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.core.view(c, await this.core.row(c, id), {
        maskSecrets: !ctx.permissions?.has('people.sensitive.view'),
      }),
    );
  }

  async saveStep(ctx: RequestContext, id: string, answers: AdmissionAnswers, step: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      const masked = Object.fromEntries(
        Object.entries(answers).filter(
          ([, v]) => !(typeof v === 'string' && /^X{4}-X{4}-\w{4}$/.test(v)),
        ),
      );
      return this.core.save(c, a, masked, { step, actorUser: ctx.user.id });
    });
  }

  async submit(
    ctx: RequestContext,
    id: string,
    answers: AdmissionAnswers,
    duplicateReason?: string,
  ) {
    if (duplicateReason && !ctx.permissions?.has('admissions.setup.manage'))
      throw new DomainError(
        'permission-denied',
        'Only an admission admin can register the same child twice in a year',
        { status: 403 },
      );
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      const masked = Object.fromEntries(
        Object.entries(answers).filter(
          ([, v]) => !(typeof v === 'string' && /^X{4}-X{4}-\w{4}$/.test(v)),
        ),
      );
      return this.core.submit(c, a, masked, {
        actorUser: ctx.user.id,
        allowDuplicate: duplicateReason ?? null,
      });
    });
    if (Object.keys(out.errors).length)
      throw new DomainError('validation-failed', 'Some answers need attention', {
        status: 400,
        extra: { errors: out.errors },
      });
    return { ...out, application: await this.form(ctx, id) };
  }

  /** The registration fee taken at the desk: a receipt in the fee module, then the registration number. */
  async collect(ctx: RequestContext, id: string, dto: DeskFeeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      const fee = Number(a.registration_fee ?? 0);
      if (a.status !== 'submitted' || a.application_no || !(fee > 0))
        throw new DomainError('admissions.nothing_due', 'Nothing is due on this registration', {
          status: 409,
        });
      const rec = await this.core.postReceipt(c, a, {
        kind: 'registration',
        amount: fee,
        mode: dto.mode,
        reference: dto.reference ?? null,
        instrumentNo: dto.instrumentNo ?? null,
        bankName: dto.bankName ?? null,
        receivedOn: dto.receivedOn ?? null,
        receivedBy: ctx.user.id,
      });
      await this.core.register(c, id, rec.id);
      return {
        receiptId: rec.id,
        receiptNo: rec.receiptNo,
        number: (await this.core.row(c, id)).application_no,
      };
    });
  }

  async slot(
    ctx: RequestContext,
    id: string,
    dto: { fieldKey: string; fileName: string; contentType: string; sizeBytes: number },
  ) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      const def = await this.core.defOf(c, a);
      const f = def.fields.find(
        (x) => x.key === dto.fieldKey && (x.type === 'file' || x.type === 'photo'),
      );
      if (!f) throw new DomainError('validation-failed', 'Unknown upload', { status: 400 });
      if (
        !(f.type === 'photo' || f.accept === 'image' ? IMAGE : IMAGE_OR_PDF).test(dto.contentType)
      )
        throw new DomainError('validation-failed', `${f.label}: wrong file type`, { status: 400 });
      if (dto.sizeBytes > (def.settings.maxFileMb ?? 10) * 1024 * 1024)
        throw new DomainError('validation-failed', `${f.label}: too large`, { status: 400 });
    });
    return this.files.createUpload(ctx, {
      fileName: dto.fileName,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      classification: 'personal',
      ownerEntityType: 'application',
      ownerEntityId: id,
    });
  }

  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = await this.core.formPdf(c, await this.core.row(c, id));
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  async receiptPdf(ctx: RequestContext, receiptId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = await this.core.receiptPdf(c, receiptId);
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  async file(ctx: RequestContext, id: string, fileId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await c.query<{ name: string | null; type: string }>(
        `SELECT original_name AS name, content_type AS type FROM files WHERE id = $1 AND owner_entity_type = 'application' AND owner_entity_id = $2 AND deleted_at IS NULL`,
        [fileId, id],
      );
      if (!f.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
      const bytes = await this.core.fileBytes(c, fileId);
      if (!bytes) throw new DomainError('not-found', 'File not found', { status: 404 });
      return {
        filename: f.rows[0].name ?? 'file',
        contentType: f.rows[0].type,
        base64: bytes.bytes.toString('base64'),
      };
    });
  }
}
