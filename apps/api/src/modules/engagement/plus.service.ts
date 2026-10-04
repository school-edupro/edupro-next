import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { QUEUES } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { GatePassService } from './gatepass.service';
import { ENV, type Env } from '../../config/env';
import { ViewerService } from '../academics/daily/viewer.service';
import { PaymentsService } from '../payments/payments.service';
import { ReportsService } from '../reports/reports.service';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import type {
  CctvRequestDto,
  ClinicVisitDto,
  ConsentFormDto,
  ConsentFormStatusDto,
  ConsentResponseDto,
  DecideDto,
  EmployeeQueryDto,
  GatePassDecideDto,
  GatePassDto,
  IssueCertificatesDto,
  ListQueryDto,
  VisitorInDto,
} from './plus.dto';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/**
 * Sprint 19: appointments, visitors and gate passes, consent forms with an optional fee, certificates
 * in batch, the clinic, and the last two approval flows (CCTV requests, employee queries). Approvals
 * run on the workflow engine when the school has the definition, else a direct decision.
 */
@Injectable()
export class EngagementPlusService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly workflow: WorkflowService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
    private readonly reports: ReportsService,
    private readonly gate: GatePassService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---- helpers ----------------------------------------------------------------------------------
  private async startIfDefined(
    c: PoolClient,
    ctx: RequestContext,
    entityType: string,
    entityId: string,
    subject: string,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    const def = await c.query<{ code: string }>(
      `SELECT code FROM workflow_definitions WHERE entity_type = $1 AND status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
      [entityType],
    );
    if (!def.rows[0]) return null;
    const inst = await this.workflow.start(c, ctx, {
      definitionCode: def.rows[0].code,
      entityType,
      entityId,
      subject,
      payload,
    });
    return inst.id;
  }

  /** WhatsApp to the guardians of a pupil (those who receive notifications). */
  private async notifyFamily(
    c: PoolClient,
    ctx: RequestContext,
    studentId: string,
    body: string,
  ): Promise<number> {
    const g = await c.query<{ user_id: string | null; mobile: string | null }>(
      `SELECT g.user_id::text, g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND sg.receives_notifications AND g.mobile IS NOT NULL`,
      [studentId],
    );
    let n = 0;
    for (const r of g.rows) {
      const m = await c.query<{ id: string }>(
        `INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, body, status, request_id, created_by)
         VALUES (app.current_school_id(), 'whatsapp', $1, $2, $3, 'queued', app.current_request_id(), app.current_user_id()) RETURNING id::text`,
        [r.user_id, r.mobile, body],
      );
      await this.outbox.enqueue(c, ctx, QUEUES.notifications, 'comms.message', {
        messageId: m.rows[0]!.id,
      });
      n += 1;
    }
    return n;
  }

  private async familyStudent(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    const s = v.kind === 'family' ? v.students.find((x) => x.id === studentId) : undefined;
    if (!s) throw new DomainError('not-found', 'Student not found', { status: 404 });
    return s;
  }

  private paged(q: ListQueryDto, params: unknown[]) {
    params.push(q.size, (q.page - 1) * q.size);
    // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
    return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }

  /** Classmates' birthdays in the next seven days (the child's own section; first name, initial, day only). */
  async myBirthdays(ctx: RequestContext, studentId: string) {
    const s = await this.familyStudent(ctx, studentId);
    if (!s.classSectionId) return { data: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        first_name: string;
        last_name: string | null;
        day: string;
      }>(
        `WITH d AS (SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + g) AS day FROM generate_series(0, 6) g)
         SELECT s.id::text, s.first_name, s.last_name, to_char(d.day, 'YYYY-MM-DD') AS day
           FROM enrolments e JOIN students s ON s.id = e.student_id
           JOIN d ON to_char(s.dob, 'MM-DD') = to_char(d.day, 'MM-DD')
          WHERE e.class_section_id = $1 AND e.status = 'active' AND s.status = 'active' AND s.deleted_at IS NULL
          ORDER BY d.day, s.first_name LIMIT 30`,
        [s.classSectionId],
      );
      return {
        data: r.rows.map((x) => ({
          name: x.last_name ? `${x.first_name} ${x.last_name.slice(0, 1)}.` : x.first_name,
          day: x.day,
          self: x.id === studentId,
        })),
      };
    });
  }

  // ---- appointments -------------------------------------------------------------------------------
  /**
   * Appointments live in AppointmentsService since 0059 (slots, front desk, gate). Only this remains: a
   * request that an approval flow from before then still holds ends here. With a slot it is confirmed or
   * declined; without one it stays in the front-desk queue to be given a slot.
   */
  async applyAppointment(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ) {
    const r = await c.query<{ state: string }>(
      `UPDATE appointments SET status = $2::workflow_status, decision_note = $3, decided_at = now(), updated_at = now(),
              state = CASE WHEN $2 = 'rejected' THEN 'rejected' WHEN starts_at IS NOT NULL THEN 'approved' ELSE state END,
              confirmed_at = CASE WHEN $2 = 'approved' THEN starts_at END
        WHERE id = $1 AND state = 'requested' RETURNING state`,
      [id, outcome, note],
    );
    const state = r.rows[0]?.state;
    if (state === 'approved' || state === 'rejected')
      await c.query(`SELECT app.appointment_notify($1, $2, $3, NULL)`, [id, state, note]);
    await this.audit.stage(ctx, c, {
      action: `engagement.appointment.${outcome}`,
      entityType: 'appointments',
      entityId: id,
      after: { note },
    });
  }

  // ---- visitors ----------------------------------------------------------------------------------
  async visitorIn(ctx: RequestContext, dto: VisitorInDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO visitor_log (school_id, visitor_name, mobile, organisation, purpose, to_meet, id_proof_kind, badge_no, logged_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id()) RETURNING id::text`,
        [
          dto.visitorName,
          dto.mobile ?? null,
          dto.organisation ?? null,
          dto.purpose,
          dto.toMeet ?? null,
          dto.idProofKind ?? null,
          dto.badgeNo ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.visitor.in',
        entityType: 'visitor_log',
        entityId: r.rows[0]!.id,
        after: { visitorName: dto.visitorName, purpose: dto.purpose },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async visitorOut(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE visitor_log SET out_at = now(), state = 'left', out_by = app.current_user_id() WHERE id = $1 AND out_at IS NULL AND state = 'inside'`,
        [id],
      );
      if (!r.rowCount)
        throw new DomainError('not-found', 'Visitor not found or already out', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'engagement.visitor.out',
        entityType: 'visitor_log',
        entityId: id,
      });
      return { ok: true };
    });
  }

  async visitors(ctx: RequestContext, onDate: string | null) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT v.id::text, v.visitor_name, v.mobile, v.organisation, v.purpose, v.to_meet, v.id_proof_kind, v.badge_no, v.in_at, v.out_at, u.display_name AS logged_by
           FROM visitor_log v LEFT JOIN users u ON u.id = v.logged_by
          WHERE (v.in_at AT TIME ZONE 'Asia/Kolkata')::date = COALESCE($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date) ORDER BY v.in_at DESC`,
        [onDate],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        visitorName: String(x.visitor_name),
        mobile: (x.mobile as string | null) ?? null,
        organisation: (x.organisation as string | null) ?? null,
        purpose: String(x.purpose),
        toMeet: (x.to_meet as string | null) ?? null,
        idProofKind: (x.id_proof_kind as string | null) ?? null,
        badgeNo: (x.badge_no as string | null) ?? null,
        inAt: iso(x.in_at)!,
        outAt: iso(x.out_at),
        loggedBy: (x.logged_by as string | null) ?? null,
      }));
    });
  }

  // ---- gate passes -------------------------------------------------------------------------------
  private static readonly PASS = `SELECT p.id::text, p.student_id::text, s.display_name AS student, s.admission_no, p.kind, p.on_date::text, to_char(p.at_time, 'HH24:MI') AS at_time, p.reason,
      p.escort_name, p.escort_relation, p.escort_mobile, p.pass_no, p.status::text, p.issued_at, p.workflow_instance_id::text, u.display_name AS requested_by, p.created_at
    FROM gate_passes p JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = p.requested_by`;

  private toPass(r: Row) {
    return {
      id: String(r.id),
      studentId: String(r.student_id),
      student: String(r.student),
      admissionNo: String(r.admission_no),
      kind: String(r.kind),
      onDate: String(r.on_date),
      atTime: (r.at_time as string | null) ?? null,
      reason: String(r.reason),
      escortName: (r.escort_name as string | null) ?? null,
      escortRelation: (r.escort_relation as string | null) ?? null,
      escortMobile: (r.escort_mobile as string | null) ?? null,
      passNo: (r.pass_no as string | null) ?? null,
      status: String(r.status),
      issuedAt: iso(r.issued_at),
      workflowInstanceId: (r.workflow_instance_id as string | null) ?? null,
      requestedBy: (r.requested_by as string | null) ?? null,
      createdAt: iso(r.created_at)!,
    };
  }

  /**
   * The legacy mobile app's way in (compat): the pass itself is made, approved and numbered by gate pass
   * v2 (GatePassService); this only answers in the old shape.
   */
  async requestGatePass(ctx: RequestContext, dto: GatePassDto, byFamily: boolean) {
    const made = await this.gate.legacyCreate(ctx, dto, byFamily);
    return this.passById(ctx, made.id);
  }

  private async passById(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.toPass(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        (await c.query<Row>(`${EngagementPlusService.PASS} WHERE p.id = $1`, [id])).rows[0]!,
      ),
    );
  }

  async myGatePasses(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family') return { data: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${EngagementPlusService.PASS} WHERE p.student_id = ANY($1::bigint[]) ORDER BY p.created_at DESC LIMIT 50`,
        [v.students.map((s) => s.id)],
      );
      return { data: r.rows.map((x) => this.toPass(x)) };
    });
  }

  async gatePasses(ctx: RequestContext, q: ListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const where = q.status ? `WHERE p.status = $1::workflow_status` : '';
      if (q.status) params.push(q.status);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- constant SELECT and fragments; values bound
        `${EngagementPlusService.PASS.replace('SELECT p.id::text', 'SELECT count(*) OVER () AS total, p.id::text')} ${where} ORDER BY p.status = 'pending' DESC, p.created_at DESC ${this.paged(q, params)}`,
        params,
      );
      return {
        data: r.rows.map((x) => this.toPass(x)),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
      };
    });
  }

  /** The legacy app's approve / reject: only for someone the pass waits on (the v2 approval levels). */
  async decideGatePass(ctx: RequestContext, id: string, dto: GatePassDecideDto) {
    await this.gate.decide(ctx, id, {
      outcome: dto.outcome,
      note: dto.note ?? (dto.outcome === 'rejected' ? 'Not approved' : undefined),
    });
    return this.passById(ctx, id);
  }

  // ---- consent forms ------------------------------------------------------------------------------
  private toForm(r: Row) {
    return {
      id: String(r.id),
      code: String(r.code),
      title: String(r.title),
      description: (r.description as string | null) ?? null,
      fields: (r.fields as unknown[]) ?? [],
      audience: (r.audience as Record<string, string[]>) ?? {},
      feeAmount: (r.fee_amount as string | null) ?? null,
      opensOn: (r.opens_on as string | null) ?? null,
      closesOn: (r.closes_on as string | null) ?? null,
      status: String(r.status),
      responses: Number(r.responses ?? 0),
      createdAt: iso(r.created_at)!,
    };
  }

  private static readonly FORM = `SELECT f.id::text, f.code, f.title, f.description, f.fields, f.audience, f.fee_amount::text, f.opens_on::text, f.closes_on::text, f.status, f.created_at,
      (SELECT count(*) FROM consent_form_responses x WHERE x.form_id = f.id)::int AS responses FROM consent_forms f`;

  async forms(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
      (await c.query<Row>(`${EngagementPlusService.FORM} ORDER BY f.created_at DESC`)).rows.map(
        (x) => this.toForm(x),
      ),
    );
  }

  async saveForm(ctx: RequestContext, dto: ConsentFormDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE consent_forms SET title = $2, description = $3, fields = $4::jsonb, audience = $5::jsonb, fee_amount = $6, opens_on = $7, closes_on = $8, updated_at = now() WHERE id = $1 RETURNING id::text`,
            [
              id,
              dto.title,
              dto.description ?? null,
              JSON.stringify(dto.fields),
              JSON.stringify(dto.audience),
              dto.feeAmount ?? null,
              dto.opensOn ?? null,
              dto.closesOn ?? null,
            ],
          )
        : await c
            .query<{ id: string }>(
              `INSERT INTO consent_forms (school_id, code, title, description, fields, audience, fee_amount, opens_on, closes_on, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, app.current_user_id()) RETURNING id::text`,
              [
                dto.code,
                dto.title,
                dto.description ?? null,
                JSON.stringify(dto.fields),
                JSON.stringify(dto.audience),
                dto.feeAmount ?? null,
                dto.opensOn ?? null,
                dto.closesOn ?? null,
              ],
            )
            .catch((e: { code?: string }) => {
              if (e.code === '23505')
                throw new DomainError('conflict', 'A form with this code exists', { status: 409 });
              throw e;
            });
      if (!r.rows[0]) throw new DomainError('not-found', 'Form not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: id ? 'engagement.consent_form.update' : 'engagement.consent_form.create',
        entityType: 'consent_forms',
        entityId: r.rows[0].id,
        after: dto,
      });
      return this.toForm(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        (await c.query<Row>(`${EngagementPlusService.FORM} WHERE f.id = $1`, [r.rows[0].id]))
          .rows[0]!,
      );
    });
  }

  async setFormStatus(ctx: RequestContext, id: string, dto: ConsentFormStatusDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE consent_forms SET status = $2, updated_at = now() WHERE id = $1`,
        [id, dto.status],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Form not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `engagement.consent_form.${dto.status}`,
        entityType: 'consent_forms',
        entityId: id,
      });
      return this.toForm(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        (await c.query<Row>(`${EngagementPlusService.FORM} WHERE f.id = $1`, [id])).rows[0]!,
      );
    });
  }

  async formResponses(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT x.id::text, x.student_id::text, s.display_name AS student, s.admission_no, x.answers, x.signed_name, x.signed_at, x.payment_intent_id::text, x.paid_at
           FROM consent_form_responses x JOIN students s ON s.id = x.student_id WHERE x.form_id = $1 ORDER BY x.signed_at DESC`,
        [id],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        studentId: String(x.student_id),
        student: String(x.student),
        admissionNo: String(x.admission_no),
        answers: x.answers as Record<string, unknown>,
        signedName: String(x.signed_name),
        signedAt: iso(x.signed_at)!,
        paymentIntentId: (x.payment_intent_id as string | null) ?? null,
        paidAt: iso(x.paid_at),
      }));
    });
  }

  /** Open forms for the family's children, with their own responses. */
  async myForms(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family') return { forms: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const forms = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${EngagementPlusService.FORM} WHERE f.status = 'open' AND (f.opens_on IS NULL OR f.opens_on <= CURRENT_DATE) AND (f.closes_on IS NULL OR f.closes_on >= CURRENT_DATE) ORDER BY f.created_at DESC`,
      );
      const out = [];
      for (const f of forms.rows) {
        const aud = (f.audience as { classIds?: string[]; sectionIds?: string[] }) ?? {};
        const children = [];
        for (const s of v.students) {
          const inAudience =
            (!aud.classIds?.length && !aud.sectionIds?.length) ||
            (s.classSectionId !== null && (aud.sectionIds ?? []).includes(s.classSectionId)) ||
            (aud.classIds?.length
              ? (
                  await c.query(
                    `SELECT 1 FROM class_sections cs WHERE cs.id = $1 AND cs.class_id = ANY($2::bigint[])`,
                    [s.classSectionId, aud.classIds],
                  )
                ).rowCount! > 0
              : false);
          if (!inAudience) continue;
          const resp = await c.query<Row>(
            `SELECT id::text, answers, signed_name, signed_at, payment_intent_id::text, paid_at FROM consent_form_responses WHERE form_id = $1 AND student_id = $2`,
            [f.id, s.id],
          );
          children.push({
            student: { id: s.id, name: s.name },
            response: resp.rows[0]
              ? {
                  id: String(resp.rows[0].id),
                  answers: resp.rows[0].answers,
                  signedName: String(resp.rows[0].signed_name),
                  signedAt: iso(resp.rows[0].signed_at),
                  paymentIntentId: (resp.rows[0].payment_intent_id as string | null) ?? null,
                  paidAt: iso(resp.rows[0].paid_at),
                }
              : null,
          });
        }
        if (children.length) out.push({ ...this.toForm(f), children });
      }
      return { forms: out };
    });
  }

  /** The family signs; a fee creates a payment intent (purpose misc) the existing pay flow completes. */
  async respond(ctx: RequestContext, formId: string, dto: ConsentResponseDto) {
    const student = await this.familyStudent(ctx, dto.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await c.query<{
        fields: Array<{ key: string; required?: boolean; type: string }>;
        fee_amount: string | null;
        status: string;
        title: string;
      }>(`SELECT fields, fee_amount::text, status, title FROM consent_forms WHERE id = $1`, [
        formId,
      ]);
      const form = f.rows[0];
      if (!form || form.status !== 'open')
        throw new DomainError('not-found', 'The form is not open', { status: 404 });
      const dup = await c.query(
        `SELECT 1 FROM consent_form_responses WHERE form_id = $1 AND student_id = $2`,
        [formId, student.id],
      );
      if (dup.rowCount)
        throw new DomainError('conflict', 'This form is already signed for the pupil', {
          status: 409,
        });
      for (const field of form.fields) {
        const v = dto.answers[field.key];
        if (field.required && (v === undefined || v === null || v === '' || v === false))
          throw new DomainError('validation-failed', `${field.key} is required`, { status: 400 });
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO consent_form_responses (school_id, form_id, student_id, answers, signed_by, signed_name, request_id)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, app.current_user_id(), $4, app.current_request_id())
         ON CONFLICT (form_id, student_id) DO UPDATE SET answers = EXCLUDED.answers, signed_by = EXCLUDED.signed_by, signed_name = EXCLUDED.signed_name, signed_at = now()
         RETURNING id::text`,
        [formId, dto.studentId, JSON.stringify(dto.answers), dto.signedName],
      );
      let intentId: string | null = null;
      if (form.fee_amount && Number(form.fee_amount) > 0) {
        const payer = await c.query<{ name: string; email: string | null; mobile: string | null }>(
          `SELECT display_name AS name, email, mobile FROM users WHERE id = app.current_user_id()`,
        );
        const intent = await this.payments.createIntent(c, {
          purpose: 'misc',
          entityType: 'consent_form_response',
          entityId: r.rows[0]!.id,
          ledger: 'misc',
          amount: Number(form.fee_amount),
          payer: {
            name: payer.rows[0]?.name ?? dto.signedName,
            email: payer.rows[0]?.email ?? '',
            mobile: payer.rows[0]?.mobile ?? '',
          },
          returnUrl: `${this.env.PARENT_APP_URL}/consents`,
          createdByUser: ctx.user.id,
          requestId: ctx.requestId,
        });
        intentId = intent.id;
        await c.query(`UPDATE consent_form_responses SET payment_intent_id = $2 WHERE id = $1`, [
          r.rows[0]!.id,
          intentId,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.respond',
        entityType: 'consent_form_responses',
        entityId: r.rows[0]!.id,
        after: { formId, student: student.name, fee: form.fee_amount },
      });
      return { id: r.rows[0]!.id, paymentIntentId: intentId, title: form.title };
    });
  }

  // ---- certificates -------------------------------------------------------------------------------
  /** Issues one certificate per pupil (serial numbers) and queues one PDF for the batch. */
  async issueCertificates(ctx: RequestContext, dto: IssueCertificatesDto) {
    if (!dto.classSectionId && !dto.studentIds?.length)
      throw new DomainError('validation-failed', 'Choose a section or pupils', { status: 400 });
    const tenant = requireTenant(ctx);
    const ids = await this.db.tenant(tenant, async (c) => {
      const t = await c.query(
        `SELECT 1 FROM document_templates WHERE id = $1 AND kind = 'certificate' AND status = 'active' AND deleted_at IS NULL`,
        [dto.templateId],
      );
      if (!t.rowCount)
        throw new DomainError('not-found', 'Certificate template not found or inactive', {
          status: 404,
        });
      const pupils = dto.studentIds?.length
        ? await c.query<{ id: string }>(
            `SELECT id::text FROM students WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
            [dto.studentIds],
          )
        : await c.query<{ id: string }>(
            `SELECT s.id::text FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
              WHERE e.class_section_id = $1 AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active' ORDER BY e.roll_no NULLS LAST, s.display_name`,
            [dto.classSectionId],
          );
      return pupils.rows.map((p) => p.id);
    });
    if (ids.length === 0)
      throw new DomainError('validation-failed', 'No pupils to issue to', { status: 400 });
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'certificate_batch',
        format: 'pdf',
        params: { templateId: dto.templateId },
        title: `Certificates · ${dto.title}`,
      },
      'engagement.certificate.issue',
    );
    return this.db.tenant(tenant, async (c) => {
      const year = new Date().getFullYear();
      let issued = 0;
      for (const sid of ids) {
        const seq = await c.query<{ n: string }>(
          `SELECT (count(*) + 1)::text AS n FROM certificates_issued WHERE issued_on >= make_date($1, 1, 1)`,
          [year],
        );
        await c.query(
          `INSERT INTO certificates_issued (school_id, student_id, template_id, serial_no, title, text, issued_on, export_id, issued_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, app.current_user_id())`,
          [
            sid,
            dto.templateId,
            `CERT/${year}/${String(seq.rows[0]!.n).padStart(5, '0')}`,
            dto.title,
            dto.text ?? null,
            dto.issuedOn ?? null,
            exp.id,
          ],
        );
        issued += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.certificate.issue',
        entityType: 'certificates_issued',
        after: { templateId: dto.templateId, title: dto.title, issued, exportId: exp.id },
      });
      return { issued, exportId: exp.id };
    });
  }

  async certificates(ctx: RequestContext, studentIds: string[] | null) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT ci.id::text, ci.student_id::text, s.display_name AS student, s.admission_no, ci.serial_no, ci.title, ci.text, ci.issued_on::text, ci.export_id::text, x.status AS export_status, t.name AS template
           FROM certificates_issued ci JOIN students s ON s.id = ci.student_id JOIN document_templates t ON t.id = ci.template_id LEFT JOIN exports x ON x.id = ci.export_id
          WHERE ($1::bigint[] IS NULL OR ci.student_id = ANY($1::bigint[])) ORDER BY ci.issued_on DESC, ci.serial_no DESC LIMIT 500`,
        [studentIds],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        studentId: String(x.student_id),
        student: String(x.student),
        admissionNo: String(x.admission_no),
        serialNo: String(x.serial_no),
        title: String(x.title),
        text: (x.text as string | null) ?? null,
        issuedOn: String(x.issued_on),
        exportId: (x.export_id as string | null) ?? null,
        exportStatus: (x.export_status as string | null) ?? null,
        template: String(x.template),
      }));
    });
  }

  async myCertificates(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family') return { data: [] };
    return {
      data: await this.certificates(
        ctx,
        v.students.map((s) => s.id),
      ),
    };
  }

  async myCertificatePdf(ctx: RequestContext, certificateId: string) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    const own = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ title: string }>(
        `SELECT title FROM certificates_issued WHERE id = $1 AND student_id = ANY($2::bigint[])`,
        [certificateId, v.kind === 'family' ? v.students.map((s) => s.id) : []],
      ),
    );
    if (!own.rows[0]) throw new DomainError('not-found', 'Certificate not found', { status: 404 });
    const exp = await this.reports.createRenderedForOwner(
      ctx,
      {
        dataset: 'certificate',
        format: 'pdf',
        params: { certificateId },
        title: `Certificate · ${own.rows[0].title}`,
      },
      'engagement.certificate.render_family',
    );
    return { exportId: exp.id, status: exp.status };
  }

  // ---- clinic ------------------------------------------------------------------------------------
  async clinicVisit(ctx: RequestContext, dto: ClinicVisitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ name: string }>(
        `SELECT display_name AS name FROM students WHERE id = $1 AND deleted_at IS NULL`,
        [dto.studentId],
      );
      if (!s.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO clinic_visits (school_id, student_id, complaint, treatment, temperature_c, referred_to, sent_home, attended_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [
          dto.studentId,
          dto.complaint,
          dto.treatment ?? null,
          dto.temperatureC ?? null,
          dto.referredTo ?? null,
          dto.sentHome,
        ],
      );
      let notified = 0;
      if (dto.notify) {
        notified = await this.notifyFamily(
          c,
          ctx,
          dto.studentId,
          `${s.rows[0].name} visited the school clinic: ${dto.complaint}.${dto.treatment ? ` ${dto.treatment}.` : ''}${dto.sentHome ? ' Please collect your child.' : ''}`,
        );
        if (notified)
          await c.query(`UPDATE clinic_visits SET notified_at = now() WHERE id = $1`, [
            r.rows[0]!.id,
          ]);
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.clinic.visit',
        entityType: 'clinic_visits',
        entityId: r.rows[0]!.id,
        after: {
          studentId: dto.studentId,
          complaint: dto.complaint,
          sentHome: dto.sentHome,
          notified,
        },
      });
      return { id: r.rows[0]!.id, notified };
    });
  }

  async clinicOut(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE clinic_visits SET out_at = now() WHERE id = $1 AND out_at IS NULL`,
        [id],
      );
      if (!r.rowCount)
        throw new DomainError('not-found', 'Visit not found or already closed', { status: 404 });
      return { ok: true };
    });
  }

  private static readonly VISIT = `SELECT v.id::text, v.student_id::text, s.display_name AS student, s.admission_no, v.in_at, v.out_at, v.complaint, v.treatment, v.temperature_c::text, v.referred_to, v.sent_home, v.notified_at, u.display_name AS attended_by
    FROM clinic_visits v JOIN students s ON s.id = v.student_id LEFT JOIN users u ON u.id = v.attended_by`;

  private toVisit(x: Row) {
    return {
      id: String(x.id),
      studentId: String(x.student_id),
      student: String(x.student),
      admissionNo: String(x.admission_no),
      inAt: iso(x.in_at)!,
      outAt: iso(x.out_at),
      complaint: String(x.complaint),
      treatment: (x.treatment as string | null) ?? null,
      temperatureC: (x.temperature_c as string | null) ?? null,
      referredTo: (x.referred_to as string | null) ?? null,
      sentHome: Boolean(x.sent_home),
      notifiedAt: iso(x.notified_at),
      attendedBy: (x.attended_by as string | null) ?? null,
    };
  }

  async clinicVisits(ctx: RequestContext, onDate: string | null) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${EngagementPlusService.VISIT} WHERE ($1::date IS NULL OR (v.in_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) ORDER BY v.in_at DESC LIMIT 200`,
        [onDate],
      );
      return r.rows.map((x) => this.toVisit(x));
    });
  }

  async myHealth(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family') return { children: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const children = [];
      for (const s of v.students) {
        const visits = await c.query<Row>(
          // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
          `${EngagementPlusService.VISIT} WHERE v.student_id = $1 ORDER BY v.in_at DESC LIMIT 20`,
          [s.id],
        );
        const records = await c.query<Row>(
          `SELECT recorded_on::text, height_cm::text, weight_kg::text, bmi::text, blood_group, vision_left, vision_right, dental FROM health_records WHERE student_id = $1 ORDER BY recorded_on DESC LIMIT 10`,
          [s.id],
        );
        children.push({
          student: { id: s.id, name: s.name },
          visits: visits.rows.map((x) => this.toVisit(x)),
          records: records.rows,
        });
      }
      return { children };
    });
  }

  // ---- CCTV requests and employee queries --------------------------------------------------------
  async requestCctv(ctx: RequestContext, dto: CctvRequestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO cctv_requests (school_id, requested_by, student_id, camera, from_at, to_at, reason, request_id)
         VALUES (app.current_school_id(), app.current_user_id(), $1, $2, $3::timestamptz, $4::timestamptz, $5, app.current_request_id()) RETURNING id::text`,
        [dto.studentId ?? null, dto.camera, dto.fromAt, dto.toAt, dto.reason],
      );
      const id = r.rows[0]!.id;
      const wf = await this.startIfDefined(
        c,
        ctx,
        'cctv_request',
        id,
        `CCTV footage: ${dto.camera} (${dto.fromAt.slice(0, 16).replace('T', ' ')})`,
        { camera: dto.camera, reason: dto.reason },
      );
      if (wf)
        await c.query(`UPDATE cctv_requests SET workflow_instance_id = $2 WHERE id = $1`, [id, wf]);
      await this.audit.stage(ctx, c, {
        action: 'engagement.cctv.request',
        entityType: 'cctv_requests',
        entityId: id,
        after: dto,
      });
      return { id, workflowInstanceId: wf };
    });
  }

  async cctvRequests(ctx: RequestContext, q: ListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const where = q.status ? `WHERE r.status = $1::workflow_status` : '';
      if (q.status) params.push(q.status);
      const rows = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values bound
        `SELECT count(*) OVER () AS total, r.id::text, u.display_name AS requested_by, s.display_name AS student, r.camera, r.from_at, r.to_at, r.reason, r.status::text, r.decision_note, r.workflow_instance_id::text, r.created_at
           FROM cctv_requests r LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN students s ON s.id = r.student_id ${where} ORDER BY r.status = 'pending' DESC, r.created_at DESC ${this.paged(q, params)}`,
        params,
      );
      return {
        data: rows.rows.map((x) => ({
          id: String(x.id),
          requestedBy: (x.requested_by as string | null) ?? null,
          student: (x.student as string | null) ?? null,
          camera: String(x.camera),
          fromAt: iso(x.from_at)!,
          toAt: iso(x.to_at)!,
          reason: String(x.reason),
          status: String(x.status),
          decisionNote: (x.decision_note as string | null) ?? null,
          workflowInstanceId: (x.workflow_instance_id as string | null) ?? null,
          createdAt: iso(x.created_at)!,
        })),
        page: { number: q.page, size: q.size, total: Number(rows.rows[0]?.total ?? 0) },
      };
    });
  }

  async decideCctv(ctx: RequestContext, id: string, dto: DecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await c.query<{ status: string; workflow_instance_id: string | null }>(
        `SELECT status::text, workflow_instance_id::text FROM cctv_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur.rows[0]) throw new DomainError('not-found', 'Request not found', { status: 404 });
      if (cur.rows[0].status !== 'pending')
        throw new DomainError('conflict', `Already ${cur.rows[0].status}`, { status: 409 });
      if (cur.rows[0].workflow_instance_id)
        throw new DomainError('engagement.in_workflow', 'Decide it from the approvals inbox', {
          status: 409,
        });
      await this.applySimple(c, ctx, 'cctv_requests', id, dto.outcome, dto.note ?? null);
      return { ok: true };
    });
  }

  async raiseEmployeeQuery(ctx: RequestContext, dto: EmployeeQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emp = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name AS name FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      );
      if (!emp.rows[0])
        throw new DomainError(
          'engagement.not_employee',
          'Only staff members raise employee queries',
          { status: 403 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO employee_queries (school_id, employee_id, category, subject, detail, request_id) VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_request_id()) RETURNING id::text`,
        [emp.rows[0].id, dto.category, dto.subject, dto.detail],
      );
      const id = r.rows[0]!.id;
      const wf = await this.startIfDefined(
        c,
        ctx,
        'employee_query',
        id,
        `${dto.category}: ${dto.subject} · ${emp.rows[0].name}`,
        { category: dto.category },
      );
      if (wf)
        await c.query(`UPDATE employee_queries SET workflow_instance_id = $2 WHERE id = $1`, [
          id,
          wf,
        ]);
      await this.audit.stage(ctx, c, {
        action: 'engagement.employee_query.create',
        entityType: 'employee_queries',
        entityId: id,
        after: dto,
      });
      return { id, workflowInstanceId: wf };
    });
  }

  async employeeQueries(ctx: RequestContext, q: ListQueryDto, mine: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`x.status = $${params.length}::workflow_status`);
      }
      if (mine) where.push('e.user_id = app.current_user_id()');
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values bound
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values bound
        `SELECT count(*) OVER () AS total, x.id::text, e.display_name AS employee, e.employee_code, x.category, x.subject, x.detail, x.status::text, x.answer, x.workflow_instance_id::text, x.created_at
           FROM employee_queries x JOIN employees e ON e.id = x.employee_id ${whereSql} ORDER BY x.status = 'pending' DESC, x.created_at DESC ${this.paged(q, params)}`,
        params,
      );
      return {
        data: rows.rows.map((x) => ({
          id: String(x.id),
          employee: String(x.employee),
          employeeCode: String(x.employee_code),
          category: String(x.category),
          subject: String(x.subject),
          detail: String(x.detail),
          status: String(x.status),
          answer: (x.answer as string | null) ?? null,
          workflowInstanceId: (x.workflow_instance_id as string | null) ?? null,
          createdAt: iso(x.created_at)!,
        })),
        page: { number: q.page, size: q.size, total: Number(rows.rows[0]?.total ?? 0) },
      };
    });
  }

  async answerEmployeeQuery(ctx: RequestContext, id: string, dto: DecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await c.query<{ status: string; workflow_instance_id: string | null }>(
        `SELECT status::text, workflow_instance_id::text FROM employee_queries WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur.rows[0]) throw new DomainError('not-found', 'Query not found', { status: 404 });
      if (cur.rows[0].status !== 'pending')
        throw new DomainError('conflict', `Already ${cur.rows[0].status}`, { status: 409 });
      if (cur.rows[0].workflow_instance_id)
        throw new DomainError('engagement.in_workflow', 'Answer it from the approvals inbox', {
          status: 409,
        });
      await this.applySimple(c, ctx, 'employee_queries', id, dto.outcome, dto.note ?? null);
      return { ok: true };
    });
  }

  /** Decision on the two simple tables (direct or from the workflow). */
  async applySimple(
    c: PoolClient,
    ctx: RequestContext,
    table: 'cctv_requests' | 'employee_queries',
    id: string,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ) {
    await c.query(
      table === 'cctv_requests'
        ? `UPDATE cctv_requests SET status = $2::workflow_status, decision_note = $3, updated_at = now() WHERE id = $1`
        : `UPDATE employee_queries SET status = $2::workflow_status, answer = $3, updated_at = now() WHERE id = $1`,
      [id, outcome, note],
    );
    await this.audit.stage(ctx, c, {
      action: `engagement.${table === 'cctv_requests' ? 'cctv' : 'employee_query'}.${outcome}`,
      entityType: table,
      entityId: id,
      after: { note },
    });
  }

  /** Completion handlers registered by the module for the four entity types. */
  async onWorkflowComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    const note = instance.steps.find((s) => s.status === outcome)?.note ?? null;
    switch (instance.entityType) {
      case 'appointment_request':
        return this.applyAppointment(c, ctx, instance.entityId, outcome, note);
      case 'cctv_request':
        return this.applySimple(c, ctx, 'cctv_requests', instance.entityId, outcome, note);
      case 'employee_query':
        return this.applySimple(c, ctx, 'employee_queries', instance.entityId, outcome, note);
      default:
        return undefined;
    }
  }
}
