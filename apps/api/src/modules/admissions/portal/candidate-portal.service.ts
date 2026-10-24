import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdmissionAnswers, PoolClient } from '@edupro/db';
import type { RequestContext } from '../../../common/http/request-context';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV, type Env } from '../../../config/env';
import { FilesService } from '../../files/files.service';
import { PaymentsService } from '../../payments/payments.service';
import { AdmissionCoreService, type AppRow } from '../admission-core.service';
import { startFromEnquiry } from '../enquiry-engine';
import { journey, slotOf } from '../process-engine';
import { publicTenant } from '../public/otp.service';
import { AdmissionScheduleService } from '../schedule.service';
import type { AdmissionCandidate } from './candidate-signin.service';

const IMAGE = /^image\/(png|jpeg|webp)$/;
const IMAGE_OR_PDF = /^(application\/pdf|image\/(png|jpeg|webp))$/;
const MASKED = /^X{4}-X{4}-\w{4}$/;

/**
 * The admission portal of a family (docs/design/39, part 3): the open sessions and classes, their
 * registrations (several children under one sign-in), the form tab by tab with uploads, submit, the
 * registration fee online, the registration number, the form and receipts as PDFs, withdrawing.
 */
@Injectable()
export class CandidatePortalService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly files: FilesService,
    private readonly payments: PaymentsService,
    private readonly schedule: AdmissionScheduleService,
  ) {}

  private t(cand: AdmissionCandidate) {
    return publicTenant(cand.schoolId);
  }

  private async own(c: PoolClient, cand: AdmissionCandidate, id: string): Promise<AppRow> {
    const a = await this.core.row(c, id);
    if (a.applicant_id !== cand.id)
      throw new DomainError('not-found', 'Application not found', { status: 404 });
    return a;
  }

  /** Open sessions of the school with the classes taking registrations now. */
  async sessions(schoolId: string) {
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const s = await c.query<{ name: string; code: string }>(
        `SELECT name, lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
      );
      const r = await c.query<{
        cycle_id: string;
        cycle_code: string;
        cycle_name: string;
        instructions: string | null;
        year: string;
        closes_at: Date;
        class_id: string;
        class_name: string;
        seats: number;
        opens: Date;
        closes: Date;
        age_as_on: string | null;
        dob_from: string | null;
        dob_to: string | null;
        has_form: boolean;
        fee_min: string | null;
        fee_default: string | null;
      }>(
        `SELECT y.id::text AS cycle_id, y.code AS cycle_code, y.name AS cycle_name, y.instructions, ay.name AS year, y.closes_at,
                k.class_id::text, cl.name AS class_name, k.seats, COALESCE(k.opens_at, y.opens_at) AS opens, COALESCE(k.closes_at, y.closes_at) AS closes,
                k.age_as_on::text, k.dob_from::text, k.dob_to::text, k.form_id IS NOT NULL AS has_form,
                (SELECT min(f.registration_fee)::text FROM admission_fees f WHERE f.cycle_id = y.id AND f.class_id = k.class_id) AS fee_min,
                (SELECT f.registration_fee::text FROM admission_fees f JOIN admission_fee_categories fc ON fc.id = f.category_id AND fc.is_default
                  WHERE f.cycle_id = y.id AND f.class_id = k.class_id) AS fee_default
           FROM admission_cycles y JOIN academic_years ay ON ay.id = y.academic_year_id
           JOIN admission_class_criteria k ON k.cycle_id = y.id JOIN classes cl ON cl.id = k.class_id
          WHERE y.status = 'open' AND y.deleted_at IS NULL AND k.status = 'open'
          ORDER BY y.opens_at, cl.display_order`,
      );
      // the merit points each class goes by (its own list, or the session's), shown to families
      const pts = await c.query<{
        cycle_id: string;
        class_id: string;
        name: string;
        points: string;
      }>(
        `SELECT k.cycle_id::text, k.class_id::text, r.name, r.points::text
           FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id
           JOIN admission_point_rules r ON r.cycle_id = k.cycle_id
            AND (CASE WHEN k.own_points THEN r.class_id = k.class_id ELSE r.class_id IS NULL END)
          WHERE y.status = 'open' AND y.deleted_at IS NULL AND k.status = 'open'
          ORDER BY r.sort_order, r.id`,
      );
      const pointsOf = (cycleId: string, classId: string) =>
        pts.rows
          .filter((p) => p.cycle_id === cycleId && p.class_id === classId)
          .map((p) => ({ name: p.name, points: Number(p.points) }));
      const now = Date.now();
      const sessions = new Map<
        string,
        {
          id: string;
          code: string;
          name: string;
          academicYear: string;
          instructions: string | null;
          closesAt: string;
          classes: unknown[];
        }
      >();
      for (const x of r.rows) {
        const sess = sessions.get(x.cycle_id) ?? {
          id: x.cycle_id,
          code: x.cycle_code,
          name: x.cycle_name,
          academicYear: x.year,
          instructions: x.instructions,
          closesAt: x.closes_at.toISOString(),
          classes: [],
        };
        sess.classes.push({
          id: x.class_id,
          name: x.class_name,
          seats: x.seats,
          opensAt: x.opens.toISOString(),
          closesAt: x.closes.toISOString(),
          open: x.has_form && x.opens.getTime() <= now && x.closes.getTime() > now,
          ageAsOn: x.age_as_on,
          dobFrom: x.dob_from,
          dobTo: x.dob_to,
          registrationFee: x.fee_default !== null ? Number(x.fee_default) : null,
          feeFrom: x.fee_min !== null ? Number(x.fee_min) : null,
          points: pointsOf(x.cycle_id, x.class_id),
        });
        sessions.set(x.cycle_id, sess);
      }
      return {
        school: { name: s.rows[0]!.name, code: s.rows[0]!.code },
        sessions: [...sessions.values()],
      };
    });
  }

  async me(cand: AdmissionCandidate) {
    return this.db.tenant(this.t(cand), async (c) => {
      const r = await c.query<{
        id: string;
        number: string | null;
        status: string;
        candidate: string | null;
        class_name: string;
        cycle_name: string;
        year: string;
        progress: number;
        fee: string | null;
        created_at: Date;
        stage: string | null;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.status::text, a.candidate_name AS candidate, cl.name AS class_name,
                y.name AS cycle_name, ay.name AS year, a.progress, a.registration_fee::text AS fee, a.created_at,
                NULL::text AS stage
           FROM applications a JOIN admission_cycles y ON y.id = a.cycle_id JOIN academic_years ay ON ay.id = y.academic_year_id
           JOIN classes cl ON cl.id = a.class_id
          WHERE a.applicant_id = $1 ORDER BY a.created_at DESC`,
        [cand.id],
      );
      return {
        candidate: { name: cand.name, mobile: cand.mobile, email: cand.email },
        applications: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          status: x.status,
          candidate: x.candidate,
          className: x.class_name,
          session: x.cycle_name,
          academicYear: x.year,
          progress: x.progress,
          feeDue:
            x.status === 'submitted' && !x.number && Number(x.fee ?? 0) > 0 ? Number(x.fee) : 0,
          createdAt: x.created_at.toISOString(),
        })),
      };
    });
  }

  async start(
    cand: AdmissionCandidate,
    cycleId: string,
    classId: string,
    enteredBy: string | null = null,
    enquiryToken?: string,
  ) {
    return this.db.tenant(this.t(cand), async (c) => {
      const k = await c.query<{ open: boolean; has_form: boolean; form_id: string | null }>(
        `SELECT (y.status = 'open' AND k.status = 'open' AND COALESCE(k.opens_at, y.opens_at) <= now() AND COALESCE(k.closes_at, y.closes_at) > now()) AS open,
                k.form_id IS NOT NULL AS has_form, k.form_id::text
           FROM admission_class_criteria k JOIN admission_cycles y ON y.id = k.cycle_id
          WHERE k.cycle_id = $1 AND k.class_id = $2 AND y.deleted_at IS NULL`,
        [cycleId, classId],
      );
      const line = k.rows[0];
      if (!line)
        throw new DomainError('not-found', 'This class does not take registrations', {
          status: 404,
        });
      if (!line.has_form)
        throw new DomainError('admissions.no_form', 'This class has no registration form yet', {
          status: 409,
        });
      if (!line.open && !enteredBy)
        throw new DomainError('admissions.closed', 'Registrations for this class are closed', {
          status: 409,
        });
      // the mobile and email the family signed in with start the form's contact answers
      const def = await c.query<{ fields: Array<{ key: string; maps?: string; type?: string }> }>(
        `SELECT def->'fields' AS fields FROM admission_forms WHERE id = $1`,
        [line.form_id],
      );
      const start: Record<string, string> = {};
      for (const f of def.rows[0]?.fields ?? []) {
        if (f.maps === 'sms_mobile' && cand.mobile) start[f.key] = cand.mobile;
        if (f.maps === 'primary_email' && cand.email) start[f.key] = cand.email;
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, status, child_first_name, data, form_id, contact_mobile, contact_email, entered_by)
         VALUES (app.current_school_id(), $1, $2, $3, 'draft', '', $8::jsonb, $4, $5, $6, $7) RETURNING id::text`,
        [
          cycleId,
          classId,
          cand.id,
          line.form_id,
          cand.mobile,
          cand.email,
          enteredBy,
          JSON.stringify(start),
        ],
      );
      // started from an enquiry's invitation: linked, and the child's name and birth date filled in
      if (enquiryToken) {
        const e = await startFromEnquiry(c, r.rows[0]!.id, enquiryToken);
        if (e) {
          const fill: Record<string, string> = {};
          const [first, ...rest] = (e.childName ?? '').trim().split(/\s+/);
          for (const f of def.rows[0]?.fields ?? []) {
            if (f.maps === 'first_name' && first) fill[f.key] = first;
            if (f.maps === 'last_name' && rest.length) fill[f.key] = rest.join(' ');
            if (f.maps === 'dob' && e.childDob) fill[f.key] = e.childDob;
          }
          if (Object.keys(fill).length)
            await c.query(`UPDATE applications SET data = data || $2::jsonb WHERE id = $1`, [
              r.rows[0]!.id,
              JSON.stringify(fill),
            ]);
        }
      }
      await this.core.event(
        c,
        r.rows[0]!.id,
        null,
        'draft',
        enteredBy ? 'Started at the school desk' : 'Started online',
        {
          actorApplicant: enteredBy ? null : cand.id,
          actorUser: enteredBy,
        },
      );
      return { id: r.rows[0]!.id };
    });
  }

  async get(cand: AdmissionCandidate, id: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      const view = await this.core.view(c, a, { maskSecrets: true });
      // the family sees the steps (names and where it stands), not the office's levels or marks
      const steps = (await journey(c, id)).map((s) => ({
        name: s.name,
        kind: s.kind,
        state: s.state,
      }));
      const extra = await c.query<{
        offered_at: Date | null;
        offer_expires_at: Date | null;
        admission_fee: string | null;
        wait_rank: number | null;
        form_points: string | null;
        lines: Array<{ name: string; points: number }> | null;
        confirmed: boolean;
      }>(
        `SELECT offered_at, offer_expires_at, admission_fee::text, wait_rank, form_points::text,
                points_breakdown AS lines, points_confirmed_at IS NOT NULL AS confirmed
           FROM applications WHERE id = $1`,
        [id],
      );
      const corr = await c.query<{ remark: string; due_on: string | null }>(
        `SELECT remark, due_on::text FROM admission_corrections WHERE application_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`,
        [id],
      );
      const slot = await slotOf(c, id);
      const x = extra.rows[0]!;
      return {
        ...view,
        steps,
        slot: slot && ['registered', 'under_review'].includes(a.status) ? slot : null,
        offer:
          x.offered_at && a.status === 'offered'
            ? {
                expiresAt: x.offer_expires_at?.toISOString() ?? null,
                admissionFee: Number(x.admission_fee ?? 0),
              }
            : null,
        waitRank: a.status === 'waitlisted' ? x.wait_rank : null,
        // the merit points from the form (docs/design/40): what gave points; the office's reasons stay inside
        points: x.lines
          ? {
              total: Number(x.form_points ?? 0),
              lines: x.lines
                .filter((l) => l.points !== 0)
                .map((l) => ({ name: l.name, points: l.points })),
              confirmed: x.confirmed,
            }
          : null,
        correction: corr.rows[0]
          ? { remark: corr.rows[0].remark, dueOn: corr.rows[0].due_on }
          : null,
      };
    });
  }

  /** The admit card of the family's test or interview. */
  async admitCard(cand: AdmissionCandidate, id: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      await this.own(c, cand, id);
      const out = await this.schedule.admitCardWith(c, id);
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  /** A masked ID number sent back as shown means "keep it as it is". */
  private unmask(answers: AdmissionAnswers): AdmissionAnswers {
    return Object.fromEntries(
      Object.entries(answers).filter(([, v]) => !(typeof v === 'string' && MASKED.test(v))),
    );
  }

  async saveStep(cand: AdmissionCandidate, id: string, answers: AdmissionAnswers, step: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      return this.core.save(c, a, this.unmask(answers), { step });
    });
  }

  async submit(cand: AdmissionCandidate, id: string, answers: AdmissionAnswers) {
    const out = await this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      return this.core.submit(c, a, this.unmask(answers), { actorApplicant: cand.id });
    });
    if (Object.keys(out.errors).length)
      throw new DomainError('validation-failed', 'Some answers need attention', {
        status: 400,
        extra: { errors: out.errors },
      });
    return { ...out, application: await this.get(cand, id) };
  }

  async pay(cand: AdmissionCandidate, id: string, schoolCode: string, gatewayId?: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      // the registration fee before the registration number, the admission fee on an offer
      const registration =
        a.status === 'submitted' && !a.application_no && Number(a.registration_fee ?? 0) > 0;
      const admission = a.status === 'offered' && Number(a.admission_fee ?? 0) > 0;
      if (!registration && !admission)
        throw new DomainError('admissions.nothing_due', 'Nothing is due on this registration', {
          status: 409,
        });
      if (admission && a.offer_expires_at && a.offer_expires_at.getTime() < Date.now())
        throw new DomainError(
          'admissions.offer_lapsed',
          'The offer has lapsed; please contact the school',
          { status: 409 },
        );
      const fee = registration ? Number(a.registration_fee) : Number(a.admission_fee);
      const intent = await this.payments.createIntent(c, {
        purpose: 'admission_fee',
        entityType: registration ? 'admission_registration' : 'admission_offer',
        entityId: a.id,
        ledger: 'admission',
        amount: fee,
        payer: {
          name: a.candidate_name ?? cand.name ?? 'Candidate',
          email: a.contact_email ?? cand.email ?? `applicant.${cand.id}@example.invalid`,
          mobile: a.contact_mobile ?? cand.mobile ?? '',
        },
        returnUrl: `${this.env.PUBLIC_APP_URL}/${schoolCode.toLowerCase()}/admission/application/${a.id}`,
        createdByApplicant: cand.id,
        requestId: randomUUID(),
        gatewayId: gatewayId ?? null,
      });
      return {
        intent: {
          id: intent.id,
          txnId: intent.txnId,
          amount: intent.amount,
          provider: intent.provider,
        },
        checkout: await this.payments.checkout(intent),
      };
    });
  }

  /** The admission form (after the admission fee), with the admission number. */
  async admissionForm(cand: AdmissionCandidate, id: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      if (!a.admission_no)
        throw new DomainError('not-found', 'No admission form yet', { status: 404 });
      const out = await this.core.formPdf(c, a, { admission: true });
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  /** The gateways that take admission fees (Fees → Payment gateways), for the family to choose. */
  async gateways(cand: AdmissionCandidate) {
    return this.payments.gatewayOptions(this.ctx(cand), 'admission');
  }

  private ctx(cand: AdmissionCandidate): RequestContext {
    return {
      requestId: randomUUID(),
      tenant: publicTenant(cand.schoolId),
      user: {
        id: '0',
        sub: `applicant:${cand.id}`,
        displayName: cand.name ?? 'Candidate',
        memberships: [],
      },
    } as unknown as RequestContext;
  }

  /** An upload slot for one file question of the form, owned by the application. */
  async slot(
    cand: AdmissionCandidate,
    dto: {
      applicationId: string;
      fieldKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
    },
  ) {
    const field = await this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, dto.applicationId);
      if (
        !['draft', 'submitted', 'sent_back'].includes(a.status) ||
        (a.application_no && a.status !== 'sent_back')
      )
        throw new DomainError(
          'admissions.locked',
          'The form is submitted and cannot be changed now',
          { status: 409 },
        );
      const def = await this.core.defOf(c, a);
      const f = def.fields.find(
        (x) => x.key === dto.fieldKey && (x.type === 'file' || x.type === 'photo'),
      );
      if (!f) throw new DomainError('validation-failed', 'Unknown upload', { status: 400 });
      const maxMb = def.settings.maxFileMb ?? 10;
      if (dto.sizeBytes > maxMb * 1024 * 1024)
        throw new DomainError(
          'validation-failed',
          `Sorry, ${dto.fileName} is larger than ${String(maxMb)}MB. Please upload a file up to ${String(maxMb)}MB.`,
          { status: 400 },
        );
      if (
        !(f.type === 'photo' || f.accept === 'image' ? IMAGE : IMAGE_OR_PDF).test(dto.contentType)
      )
        throw new DomainError(
          'validation-failed',
          f.type === 'photo'
            ? `${f.label}: a photo (JPG, PNG or WebP)`
            : `${f.label}: a PDF or a photo`,
          { status: 400 },
        );
      return f;
    });
    void field;
    return this.files.createUpload(this.ctx(cand), {
      fileName: dto.fileName,
      contentType: dto.contentType,
      sizeBytes: dto.sizeBytes,
      classification: 'personal',
      ownerEntityType: 'application',
      ownerEntityId: dto.applicationId,
    });
  }

  /** One of the family's own files (an upload or a generated PDF of its application). */
  /** Notices for candidates that reach this family (no class given, or a class one of its children seeks). */
  private noticesSql = `FROM notices n
     WHERE n.deleted_at IS NULL AND n.audience = 'candidates' AND n.published_at IS NOT NULL AND n.publish_from <= CURRENT_DATE
       AND (n.publish_until IS NULL OR n.publish_until >= CURRENT_DATE) AND (n.publish_at IS NULL OR n.publish_at <= now())
       AND (NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id)
         OR EXISTS (SELECT 1 FROM notice_targets t JOIN applications a ON a.class_id = t.target_id AND a.applicant_id = $1
                     WHERE t.notice_id = n.id AND t.target_type = 'admission_class'))`;

  /**
   * The family's Messages and Notices (docs/design/39, part 5): what the school sent to its registrations
   * from Compose (one per message, the email when several channels went), the automatic admission emails,
   * and the notices for candidates.
   */
  async inbox(cand: AdmissionCandidate) {
    return this.db.tenant(this.t(cand), async (c) => {
      const notices = await c.query<{
        id: string;
        kind: string;
        title: string;
        body: string;
        body_format: string;
        publish_from: string;
        files: Array<{ id: string; name: string | null }>;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- noticesSql is a constant; the applicant is bound
        `SELECT n.id::text, n.kind::text, n.title, n.body, n.body_format, n.publish_from::text,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id::text, 'name', f.original_name) ORDER BY f.id)
                            FROM notice_files nf JOIN files f ON f.id = nf.file_id WHERE nf.notice_id = n.id), '[]'::jsonb) AS files
           ${this.noticesSql} ORDER BY n.is_pinned DESC, n.publish_from DESC, n.id DESC LIMIT 50`,
        [cand.id],
      );
      const messages = await c.query<{
        id: string;
        request_id: string | null;
        channel: string;
        subject: string | null;
        body: string;
        format: string;
        created_at: Date;
      }>(
        `WITH fam AS (SELECT id FROM applications WHERE applicant_id = $1),
              addr AS (SELECT lower(email::text) AS a FROM applicants WHERE id = $1 AND email IS NOT NULL
                       UNION SELECT lower(contact_email) FROM applications WHERE applicant_id = $1 AND contact_email IS NOT NULL)
         SELECT m.id::text, m.message_request_id::text AS request_id, m.channel::text, m.subject, m.body, m.format, m.created_at
           FROM comms_messages m
          WHERE m.id IN (SELECT r.message_id FROM message_request_recipients r
                          WHERE r.person_type = 'candidate' AND r.person_id IN (SELECT id FROM fam) AND r.message_id IS NOT NULL)
             OR (m.channel = 'email' AND lower(m.recipient_address) IN (SELECT a FROM addr)
                 AND m.template_id IN (SELECT id FROM comms_templates WHERE left(code, 10) = 'admission_' AND code <> 'admission_otp'))
          ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
        [cand.id],
      );
      // one entry per compose message: the email when it went by email too
      const byRequest = new Map<string, (typeof messages.rows)[number]>();
      const out: Array<(typeof messages.rows)[number]> = [];
      for (const m of messages.rows) {
        if (!m.request_id) {
          out.push(m);
          continue;
        }
        const had = byRequest.get(m.request_id);
        if (!had) {
          byRequest.set(m.request_id, m);
          out.push(m);
        } else if (had.channel !== 'email' && m.channel === 'email') {
          out[out.indexOf(had)] = m;
          byRequest.set(m.request_id, m);
        }
      }
      return {
        notices: notices.rows.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          bodyFormat: n.body_format,
          publishFrom: n.publish_from,
          files: n.files,
        })),
        messages: out.slice(0, 100).map((m) => ({
          id: m.id,
          channel: m.channel,
          subject: m.subject,
          body: m.body,
          format: m.format,
          at: m.created_at.toISOString(),
        })),
      };
    });
  }

  /** A file of a notice the family may read. */
  async noticeFile(cand: AdmissionCandidate, noticeId: string, fileId: string) {
    if (!/^\d{1,18}$/.test(noticeId) || !/^\d{1,18}$/.test(fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.db.tenant(this.t(cand), async (c) => {
      const ok = await c.query<{ name: string | null; type: string }>(
        // eslint-disable-next-line no-restricted-syntax -- noticesSql is a constant; values are bound
        `SELECT f.original_name AS name, f.content_type AS type FROM notice_files nf JOIN files f ON f.id = nf.file_id
          WHERE nf.notice_id = $2 AND nf.file_id = $3 AND EXISTS (SELECT 1 ${this.noticesSql} AND n.id = $2)`,
        [cand.id, noticeId, fileId],
      );
      if (!ok.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
      const bytes = await this.core.fileBytes(c, fileId);
      if (!bytes) throw new DomainError('not-found', 'File not found', { status: 404 });
      return {
        filename: ok.rows[0].name ?? 'file',
        contentType: ok.rows[0].type,
        base64: bytes.bytes.toString('base64'),
      };
    });
  }

  async file(cand: AdmissionCandidate, fileId: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const f = await c.query<{ owner: string; name: string | null; type: string }>(
        `SELECT f.owner_entity_id::text AS owner, f.original_name AS name, f.content_type AS type FROM files f
          WHERE f.id = $1 AND f.owner_entity_type = 'application' AND f.status = 'ready' AND f.deleted_at IS NULL`,
        [fileId],
      );
      if (!f.rows[0]) throw new DomainError('not-found', 'File not found', { status: 404 });
      await this.own(c, cand, f.rows[0].owner);
      const bytes = await this.core.fileBytes(c, fileId);
      if (!bytes) throw new DomainError('not-found', 'File not found', { status: 404 });
      return {
        filename: f.rows[0].name ?? 'file',
        contentType: f.rows[0].type,
        base64: bytes.bytes.toString('base64'),
      };
    });
  }

  async pdf(cand: AdmissionCandidate, id: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      if (a.status === 'draft')
        throw new DomainError('admissions.not_submitted', 'Submit the form first', { status: 409 });
      const out = await this.core.formPdf(c, a);
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  async receipt(cand: AdmissionCandidate, id: string, receiptId: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      await this.own(c, cand, id);
      const r = await c.query(`SELECT 1 FROM misc_receipts WHERE id = $1 AND application_id = $2`, [
        receiptId,
        id,
      ]);
      if (!r.rowCount) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      const out = await this.core.receiptPdf(c, receiptId);
      return {
        filename: out.filename,
        contentType: 'application/pdf',
        base64: out.bytes.toString('base64'),
      };
    });
  }

  async sibling(cand: AdmissionCandidate, admissionNo: string) {
    if (!/^[A-Za-z0-9/_-]{1,30}$/.test(admissionNo.trim())) return { found: false };
    return this.db.tenant(this.t(cand), async (c) => {
      const s = await this.core.sibling(c, admissionNo);
      return s ? { found: true, ...s } : { found: false };
    });
  }

  async withdraw(cand: AdmissionCandidate, id: string, reason?: string) {
    return this.db.tenant(this.t(cand), async (c) => {
      const a = await this.own(c, cand, id);
      if (['admitted', 'fee_paid', 'cancelled', 'withdrawn'].includes(a.status))
        throw new DomainError(
          'admissions.locked',
          'This registration cannot be withdrawn now; contact the school',
          { status: 409 },
        );
      if (a.status === 'draft' && !a.application_no) {
        await c.query(`DELETE FROM applications WHERE id = $1`, [id]);
        return { removed: true };
      }
      await c.query(
        `UPDATE applications SET status = 'withdrawn', updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.core.event(
        c,
        id,
        a.status,
        'withdrawn',
        reason ? `Withdrawn by the family: ${reason}` : 'Withdrawn by the family',
        { actorApplicant: cand.id },
      );
      return { removed: false };
    });
  }
}
