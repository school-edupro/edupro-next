import { messageTag } from './message-tag';
import { Injectable } from '@nestjs/common';
import {
  fieldState,
  isEmptyAnswer,
  loadProfileLists,
  PROFILE_FIELD_BY_KEY,
  ProfileWriteError,
  refreshCompleteness,
  validateChanges,
  writeStudentProfile,
  type AdmissionAnswer,
  type AdmissionAnswers,
  type PoolClient,
  type SiblingAnswer,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionCoreService, type AppRow } from './admission-core.service';
import { seriesNumber } from './number-series';
import type {
  AdmitBulkDto,
  AdmitDto,
  CancelDto,
  RefundDecisionDto,
  RefundPayDto,
  RefundsQueryDto,
} from './admit.dto';
import type { DeskFeeDto } from './desk.dto';

const DOC_KINDS = new Set([
  'photo',
  'birth_certificate',
  'aadhaar',
  'transfer_certificate',
  'address_proof',
  'category_certificate',
  'medical',
  'pan',
  'bank',
  'qualification',
  'other',
  'alumni_proof',
  'sibling_proof',
  'achievement',
]);
const BEFORE_FEE = [
  'draft',
  'submitted',
  'registered',
  'under_review',
  'sent_back',
  'waitlisted',
  'offered',
  'rejected',
];
const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
const money = (n: number) =>
  `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ADMISSION_ADMIT = 'admissions.application.admit';
export const ADMISSION_CANCEL = 'admissions.application.cancel';
export const REFUND_APPROVE = 'fees.refund.approve';

/**
 * Online admission, part 6 (docs/design/39): the admission fee (online or at the desk) with the admission
 * number given on payment, the admission form; Admit into the student master — the form's mapped answers,
 * the additional fields, the documents and photos, the sibling's parents, a class-section — one by one or
 * in bulk; cancellation, with the admission fee refunded less the session's deduction once the fee
 * module's refund approvers agree.
 */
@Injectable()
export class AdmissionAdmitService {
  constructor(
    private readonly db: DbService,
    private readonly core: AdmissionCoreService,
    private readonly audit: AuditService,
  ) {}

  /** The school's admission number series continued (prefix kept), never one given before. */
  private async nextAdmissionNo(c: PoolClient): Promise<string> {
    await c.query(
      `SELECT pg_advisory_xact_lock(hashtext('admission_no:' || app.current_school_id()::text))`,
    );
    const last = await c.query<{ no: string }>(
      `SELECT no FROM (
         SELECT admission_no AS no, created_at AS at FROM students WHERE deleted_at IS NULL AND admission_no ~ '[0-9]+$'
         UNION ALL SELECT admission_no, fee_paid_at FROM applications WHERE admission_no IS NOT NULL AND admission_no ~ '[0-9]+$') x
        ORDER BY at DESC NULLS LAST LIMIT 1`,
    );
    const m = last.rows[0] ? /^(.*?)(\d+)$/.exec(last.rows[0].no) : null;
    if (!m)
      return (await c.query<{ no: string }>(`SELECT app.next_admission_no() AS no`)).rows[0]!.no;
    let n = BigInt(m[2]!);
    for (let i = 0; i < 1000; i += 1) {
      n += 1n;
      const candidate = `${m[1]!}${n.toString().padStart(m[2]!.length, '0')}`;
      const taken = await c.query(
        `SELECT 1 FROM students WHERE admission_no = $1 UNION ALL SELECT 1 FROM applications WHERE admission_no = $1 LIMIT 1`,
        [candidate],
      );
      if (!taken.rows.length) return candidate;
    }
    return (await c.query<{ no: string }>(`SELECT app.next_admission_no() AS no`)).rows[0]!.no;
  }

  /** The admission fee is in (or none is due): the admission number, the admission form, the email. */
  async feePaid(
    c: PoolClient,
    appId: string,
    receiptId: string | null,
    who: { actorUser?: string | null },
  ) {
    const a = await this.core.row(c, appId);
    if (a.status !== 'offered') return;
    // the session's admission number series for the class (docs/design/48); else the school's series
    await c.query(
      `SELECT pg_advisory_xact_lock(hashtext('admission_no:' || app.current_school_id()::text))`,
    );
    const no =
      (await seriesNumber(c, 'admission', {
        cycle_id: a.cycle_id,
        class_id: a.class_id,
        data: a.data as AdmissionAnswers | null,
      })) ?? (await this.nextAdmissionNo(c));
    await c.query(
      `UPDATE applications SET status = 'fee_paid', admission_no = $2, admission_receipt_id = $3, fee_paid_at = now(), updated_at = now()
        WHERE id = $1`,
      [appId, no, receiptId],
    );
    await this.core.event(
      c,
      appId,
      'offered',
      'fee_paid',
      `Admission fee ${receiptId ? 'received' : 'not due'}; admission no. ${no}`,
      who,
    );
    await c.query(
      `UPDATE admission_offers SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE application_id = $1`,
      [appId],
    );
    const after = await this.core.row(c, appId);
    const attachments: Array<{ fileId: string; name: string }> = [];
    const form = await this.core.storeAdmissionFormPdf(c, after);
    if (form) attachments.push(form);
    if (receiptId) {
      const rec = await this.core.storeReceiptPdf(c, receiptId);
      if (rec) attachments.push(rec);
    }
    const receipt = receiptId
      ? (
          await c.query<{ receipt_no: string; amount: string }>(
            `SELECT receipt_no, amount::text FROM misc_receipts WHERE id = $1`,
            [receiptId],
          )
        ).rows[0]
      : null;
    await c.query(
      `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10::jsonb)`,
      [
        'admission_fee_paid',
        after.contact_mobile,
        after.contact_email,
        JSON.stringify({
          ...messageTag('status', { applicationId: after.id }),
          name: after.candidate_name ?? '',
          number: no,
          class: after.class_name,
          school: '',
          amount: receipt ? Number(receipt.amount).toLocaleString('en-IN') : '0',
        }),
        'Admission confirmed',
        `The admission fee of ${after.candidate_name ?? 'your ward'} is received. The admission number is below.`,
        no,
        JSON.stringify([
          ['Candidate', after.candidate_name ?? ''],
          ['Class', after.class_name],
          ['Admission no.', no],
          ...(receipt
            ? [
                ['Receipt no.', receipt.receipt_no],
                ['Amount', money(Number(receipt.amount))],
              ]
            : []),
        ]),
        'The admission form and the receipt are attached and stay in the admission portal. The school will tell you the class-section before the session starts.',
        JSON.stringify(attachments),
      ],
    );
  }

  /** The admission fee paid online (payment intent of kind admission_offer). */
  async onAdmissionPaid(
    c: PoolClient,
    intent: {
      entityType: string | null;
      entityId: string | null;
      amount: string;
      charge?: string;
      txnId: string;
      providerRef?: string | null;
    },
  ) {
    if (intent.entityType !== 'admission_offer' || !intent.entityId) return;
    const a = await this.core.row(c, intent.entityId);
    if (a.status !== 'offered') return;
    const amount = Number(intent.amount) - Number(intent.charge ?? 0);
    const rec = await this.core.postReceipt(c, a, {
      kind: 'admission',
      amount,
      mode: 'online',
      reference: intent.providerRef ?? intent.txnId,
    });
    await c.query(`UPDATE applications SET admission_receipt_id = $2 WHERE id = $1`, [
      a.id,
      rec.id,
    ]);
    await this.feePaid(c, a.id, rec.id, {});
  }

  /** The admission fee taken at the counter (or confirmed when none is due). */
  async collect(ctx: RequestContext, id: string, dto: DeskFeeDto) {
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      if (a.status !== 'offered')
        throw new DomainError('admissions.nothing_due', 'No admission offer waits for its fee', {
          status: 409,
        });
      if (a.offer_expires_at && a.offer_expires_at.getTime() < Date.now())
        throw new DomainError(
          'admissions.offer_lapsed',
          `The offer lapsed on ${istDate(a.offer_expires_at)}; renew it from Selection first`,
          {
            status: 409,
          },
        );
      const fee = Number(a.admission_fee ?? 0);
      let rec: { id: string; receiptNo: string } | null = null;
      if (fee > 0)
        rec = await this.core.postReceipt(c, a, {
          kind: 'admission',
          amount: fee,
          mode: dto.mode,
          reference: dto.reference ?? null,
          instrumentNo: dto.instrumentNo ?? null,
          bankName: dto.bankName ?? null,
          receivedOn: dto.receivedOn ?? null,
          receivedBy: ctx.user.id,
          remarks: dto.remarks ?? null,
          modeLabel: dto.modeLabel ?? null,
          instrumentDate: dto.instrumentDate ?? null,
        });
      await this.feePaid(c, id, rec?.id ?? null, { actorUser: ctx.user.id });
      await this.audit.stage(ctx, c, {
        action: 'admissions.admission_fee.collect',
        entityType: 'applications',
        entityId: id,
        after: { amount: fee, mode: dto.mode, receiptNo: rec?.receiptNo ?? null },
      });
      return {
        receiptId: rec?.id ?? null,
        receiptNo: rec?.receiptNo ?? null,
        admissionNo: (await this.core.row(c, id)).admission_no,
      };
    });
    return out;
  }

  async admissionFormPdf(c: PoolClient, a: AppRow) {
    if (!a.admission_no)
      throw new DomainError('not-found', 'No admission form yet: it comes with the admission fee', {
        status: 404,
      });
    const out = await this.core.formPdf(c, a, { admission: true });
    return {
      filename: out.filename,
      contentType: 'application/pdf',
      base64: out.bytes.toString('base64'),
    };
  }

  async admissionForm(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.admissionFormPdf(c, await this.core.row(c, id)),
    );
  }

  // ---- Admit ------------------------------------------------------------------------------------
  /** Who waits to be admitted in a class of a session, and the class's sections in the session's year. */
  async admitList(ctx: RequestContext, cycleId: string, classId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await c.query<{ year_id: string; year: string; cycle: string; class_name: string }>(
        `SELECT y.academic_year_id::text AS year_id, ay.name AS year, y.name AS cycle, cl.name AS class_name
           FROM admission_cycles y JOIN academic_years ay ON ay.id = y.academic_year_id JOIN classes cl ON cl.id = $2
          WHERE y.id = $1 AND y.deleted_at IS NULL`,
        [cycleId, classId],
      );
      if (!y.rows[0]) throw new DomainError('not-found', 'Session not found', { status: 404 });
      const sections = await c.query<{
        id: string;
        name: string;
        capacity: number | null;
        enrolled: number;
      }>(
        `SELECT cs.id::text, cs.name, cs.capacity,
                (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS enrolled
           FROM class_sections cs WHERE cs.academic_year_id = $1 AND cs.class_id = $2 AND cs.deleted_at IS NULL ORDER BY cs.name`,
        [y.rows[0].year_id, classId],
      );
      const list = await c.query<{
        id: string;
        number: string | null;
        admission_no: string | null;
        candidate: string | null;
        gender: string;
        category: string | null;
        status: string;
        fee_paid_at: Date | null;
        student_id: string | null;
        section: string | null;
      }>(
        `SELECT a.id::text, a.application_no AS number, a.admission_no, a.candidate_name AS candidate, a.child_gender::text AS gender,
                k.name AS category, a.status::text, a.fee_paid_at, a.student_id::text,
                (SELECT cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                  WHERE e.student_id = a.student_id AND e.academic_year_id = $3 ORDER BY e.id DESC LIMIT 1) AS section
           FROM applications a LEFT JOIN admission_fee_categories k ON k.id = a.category_id
          WHERE a.cycle_id = $1 AND a.class_id = $2 AND a.status IN ('fee_paid', 'admitted')
          ORDER BY a.status, a.admission_no, a.id`,
        [cycleId, classId, y.rows[0].year_id],
      );
      return {
        session: { id: cycleId, name: y.rows[0].cycle, academicYear: y.rows[0].year },
        class: { id: classId, name: y.rows[0].class_name },
        sections: sections.rows,
        candidates: list.rows.map((x) => ({
          id: x.id,
          number: x.number,
          admissionNo: x.admission_no,
          candidate: x.candidate,
          gender: x.gender,
          category: x.category,
          status: x.status,
          feePaidAt: x.fee_paid_at?.toISOString() ?? null,
          studentId: x.student_id,
          section: x.section,
        })),
      };
    });
  }

  /** The answers that go to the student master: mapped fields, as the profile catalogue takes them. */
  private mapped(
    def: Awaited<ReturnType<AdmissionCoreService['defOf']>>,
    data: Record<string, AdmissionAnswer | undefined>,
  ) {
    const raw: Record<string, unknown> = {};
    for (const f of def.fields) {
      if (
        !f.maps ||
        ['file', 'photo', 'siblings', 'marks', 'subjects', 'heading', 'note'].includes(f.type)
      )
        continue;
      if (!fieldState(f, data).shown) continue;
      const v = data[f.key];
      if (isEmptyAnswer(v)) continue;
      if (!PROFILE_FIELD_BY_KEY.has(f.maps)) continue;
      raw[f.maps] =
        typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : v;
    }
    return raw;
  }

  async admitWith(c: PoolClient, ctx: RequestContext, id: string, dto: AdmitDto) {
    const a = await this.core.row(c, id);
    if (a.status !== 'fee_paid')
      throw new DomainError(
        'admissions.not_ready',
        a.status === 'admitted'
          ? 'Already admitted'
          : 'Only candidates who paid the admission fee are admitted',
        {
          status: 409,
        },
      );
    const y = await c.query<{
      year_id: string;
      starts: string;
      year: string;
      status: string;
      flag: boolean | null;
    }>(
      `SELECT y.academic_year_id::text AS year_id, ay.start_date::text AS starts, ay.name AS year, ay.status::text,
              (ay.locks ->> 'academics')::boolean AS flag
         FROM admission_cycles y JOIN academic_years ay ON ay.id = y.academic_year_id WHERE y.id = $1`,
      [a.cycle_id],
    );
    const yearId = y.rows[0]!.year_id;
    // the year's class work must be open to enrol (the same rule as app.assert_year_open), said plainly
    const yr = y.rows[0]!;
    if (yr.status === 'closed' || (yr.status === 'locked' ? yr.flag !== false : Boolean(yr.flag)))
      throw new DomainError(
        'admissions.year_locked',
        `${yr.year} is ${yr.status === 'closed' ? 'closed' : 'locked'} for class work: reopen its Academics stage under System → Years, then admit`,
        { status: 409 },
      );
    const sec = await c.query<{
      id: string;
      name: string;
      capacity: number | null;
      enrolled: number;
    }>(
      `SELECT cs.id::text, cs.name, cs.capacity, (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS enrolled
         FROM class_sections cs WHERE cs.id = $1 AND cs.class_id = $2 AND cs.academic_year_id = $3 AND cs.deleted_at IS NULL`,
      [dto.classSectionId, a.class_id, yearId],
    );
    if (!sec.rows[0])
      throw new DomainError(
        'validation-failed',
        `Choose a section of ${a.class_name} in the session's year`,
        { status: 400 },
      );
    const def = await this.core.defOf(c, a);
    const data = this.core.plainData(def, a.data);
    const raw = this.mapped(def, data);
    raw.admitted_on = dto.joinedOn ?? y.rows[0]!.starts;
    if (!raw.first_name) raw.first_name = a.child_first_name;
    delete raw.admission_no;
    const lists = await loadProfileLists(c);
    const checked = validateChanges(raw, lists);
    const skipped: Record<string, string> = { ...checked.errors };
    let values = checked.values;
    const ins = await c.query<{ id: string }>(
      `INSERT INTO students (school_id, admission_no, first_name, gender, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, 'unspecified', app.current_user_id(), app.current_user_id()) RETURNING id::text`,
      [a.admission_no, String(values.first_name ?? a.child_first_name)],
    );
    const studentId = ins.rows[0]!.id;
    // a sibling in the school: the new pupil shares a parent's record only when it is the same person
    // (the form gives that parent's mobile or email as on the record); otherwise the form's parents get
    // their own records, so a sibling's parents are never overwritten
    const sibField = def.fields.find((f) => f.type === 'siblings');
    const sibs = sibField
      ? ((data[sibField.key] as { list?: SiblingAnswer[] } | undefined)?.list ?? [])
      : [];
    const sibNo = sibs.find((s) => s.admissionNo?.trim())?.admissionNo?.trim();
    if (sibNo) {
      const sib = await c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE admission_no = $1 AND deleted_at IS NULL AND id <> $2`,
        [sibNo, studentId],
      );
      if (sib.rows[0]) {
        const norm = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '').slice(-10) : '');
        const mail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
        const parents = await c.query<{
          guardian_id: string;
          relation: string;
          mobile: string | null;
          email: string | null;
        }>(
          `SELECT sg.guardian_id::text, sg.relation::text, g.mobile, g.email::text FROM student_guardians sg
             JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL WHERE sg.student_id = $1`,
          [sib.rows[0].id],
        );
        for (const p of parents.rows) {
          if (p.relation !== 'father' && p.relation !== 'mother') continue;
          const sameMobile =
            Boolean(p.mobile) && norm(p.mobile) === norm(values[`${p.relation}_mobile`]);
          const sameEmail =
            Boolean(p.email) && mail(p.email) === mail(values[`${p.relation}_email`]);
          if (!sameMobile && !sameEmail) continue;
          await c.query(
            `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, receives_notifications, created_by)
             SELECT app.current_school_id(), $1, sg.guardian_id, sg.relation, sg.is_primary, sg.receives_notifications, app.current_user_id()
               FROM student_guardians sg WHERE sg.student_id = $2 AND sg.guardian_id = $3 ON CONFLICT DO NOTHING`,
            [studentId, sib.rows[0].id, p.guardian_id],
          );
        }
        if (PROFILE_FIELD_BY_KEY.has('sibling_admission_no'))
          values = { ...values, sibling_admission_no: sibNo };
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await c.query('SAVEPOINT admit_profile');
      try {
        await writeStudentProfile(c, studentId, values);
        await c.query('RELEASE SAVEPOINT admit_profile');
        break;
      } catch (error) {
        await c.query('ROLLBACK TO SAVEPOINT admit_profile');
        if (!(error instanceof ProfileWriteError) || attempt === 2) throw error;
        Object.assign(skipped, error.errors);
        values = Object.fromEntries(Object.entries(values).filter(([k]) => !(k in error.errors)));
      }
    }
    // the answers kept as additional student fields ("copy to student master")
    const extra: Record<string, unknown> = {};
    for (const f of def.fields)
      if (
        f.copy &&
        !f.maps &&
        !['file', 'photo'].includes(f.type) &&
        fieldState(f, data).shown &&
        !isEmptyAnswer(data[f.key])
      )
        extra[f.key] = data[f.key];
    if (Object.keys(extra).length)
      await c.query(
        `UPDATE students SET profile = jsonb_set(COALESCE(profile, '{}'::jsonb), '{extra}', COALESCE(profile->'extra', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
        [studentId, JSON.stringify(extra)],
      );
    // documents and photos: the files move to the pupil (or the parent, for a parent's photo)
    let docs = 0;
    for (const f of def.fields) {
      if (f.type !== 'file' && f.type !== 'photo') continue;
      const ids = Array.isArray(data[f.key])
        ? (data[f.key] as string[]).filter((x) => /^\d{1,18}$/.test(x))
        : [];
      if (!ids.length || !fieldState(f, data).shown) continue;
      const party = /father/.test(f.key)
        ? 'father'
        : /mother/.test(f.key)
          ? 'mother'
          : /guardian/.test(f.key)
            ? 'guardian'
            : null;
      if (f.type === 'photo' && party) {
        await c.query(
          `UPDATE guardians g SET photo_file_id = $3 FROM student_guardians sg
            WHERE sg.guardian_id = g.id AND sg.student_id = $1 AND sg.relation::text = $2 AND g.photo_file_id IS NULL`,
          [studentId, party, ids[0]],
        );
        continue;
      }
      if (f.type === 'photo' || f.docKind === 'photo')
        await c.query(
          `UPDATE students SET photo_file_id = $2 WHERE id = $1 AND photo_file_id IS NULL`,
          [studentId, ids[0]],
        );
      const kind =
        f.docKind && DOC_KINDS.has(f.docKind) ? f.docKind : f.type === 'photo' ? 'photo' : 'other';
      for (const fid of ids) {
        await c.query(
          `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, created_by)
           VALUES (app.current_school_id(), 'student', $1, $2::document_kind, $3, $4, app.current_user_id())`,
          [studentId, kind, fid, f.label.slice(0, 120)],
        );
        await c.query(
          `UPDATE files SET owner_entity_type = 'student', owner_entity_id = $2 WHERE id = $1 AND owner_entity_type = 'application'`,
          [fid, studentId],
        );
        docs += 1;
      }
    }
    // no roll number given: the next one in the section
    const roll =
      dto.rollNo ??
      (
        await c.query<{ n: number }>(
          `SELECT COALESCE(max(roll_no), 0)::int + 1 AS n FROM enrolments
            WHERE class_section_id = $1 AND academic_year_id = $2 AND status = 'active'`,
          [dto.classSectionId, yearId],
        )
      ).rows[0]!.n;
    const enrol = await c.query<{ id: string }>(
      `SELECT app.enrol_student($1, $2, $3, $4, $5::date)::text AS id`,
      [
        studentId,
        yearId,
        dto.classSectionId,
        roll,
        typeof raw.admitted_on === 'string' ? raw.admitted_on : y.rows[0]!.starts,
      ],
    );
    await refreshCompleteness(c, studentId);
    await c.query(
      `UPDATE applications SET student_id = $2, status = 'admitted', admitted_at = now(), updated_at = now() WHERE id = $1`,
      [id, studentId],
    );
    await this.core.event(
      c,
      id,
      'fee_paid',
      'admitted',
      `Admitted to ${a.class_name} ${sec.rows[0].name} as ${a.admission_no ?? ''}`,
      {
        actorUser: ctx.user.id,
      },
    );
    await c.query(`SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9)`, [
      'admission_admitted',
      a.contact_mobile,
      a.contact_email,
      JSON.stringify({
        ...messageTag('status', { applicationId: a.id }),
        name: a.candidate_name ?? '',
        number: a.admission_no ?? '',
        class: `${a.class_name} ${sec.rows[0].name}`,
        school: '',
      }),
      'Welcome to the school',
      `${a.candidate_name ?? 'Your ward'} is admitted to ${a.class_name} ${sec.rows[0].name}.`,
      a.admission_no,
      JSON.stringify([
        ['Student', a.candidate_name ?? ''],
        ['Admission no.', a.admission_no ?? ''],
        ['Class-section', `${a.class_name} ${sec.rows[0].name}`],
      ]),
      'From now on use the parent app: sign in with the mobile number or email you gave in the form; a code comes to it. Fees, attendance, notices and the school diary are there.',
    ]);
    return {
      applicationId: id,
      studentId,
      admissionNo: a.admission_no,
      enrolmentId: enrol.rows[0]!.id,
      section: sec.rows[0].name,
      documents: docs,
      skipped,
    };
  }

  async admit(ctx: RequestContext, id: string, dto: AdmitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = await this.admitWith(c, ctx, id, dto);
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.admit',
        entityType: 'applications',
        entityId: id,
        after: {
          studentId: out.studentId,
          admissionNo: out.admissionNo,
          section: out.section,
          skipped: Object.keys(out.skipped),
        },
      });
      return out;
    });
  }

  /** Many at once: each in its own step, so one that cannot be admitted does not stop the others. */
  async admitBulk(ctx: RequestContext, dto: AdmitBulkDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const results: Array<{
        applicationId: string;
        ok: boolean;
        admissionNo?: string | null;
        section?: string;
        error?: string;
      }> = [];
      for (const item of dto.items) {
        await c.query('SAVEPOINT admit_one');
        try {
          const out = await this.admitWith(c, ctx, item.applicationId, {
            classSectionId: item.classSectionId,
            rollNo: item.rollNo,
            joinedOn: dto.joinedOn,
          });
          await c.query('RELEASE SAVEPOINT admit_one');
          results.push({
            applicationId: item.applicationId,
            ok: true,
            admissionNo: out.admissionNo,
            section: out.section,
          });
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT admit_one');
          if (!(error instanceof DomainError)) throw error;
          results.push({ applicationId: item.applicationId, ok: false, error: error.message });
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.admit_bulk',
        entityType: 'applications',
        entityId: '0',
        after: {
          admitted: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
      });
      return { admitted: results.filter((r) => r.ok).length, results };
    });
  }

  // ---- cancellation and refund ------------------------------------------------------------------
  /** What cancelling would do: the refund of the admission fee less the session's deduction. */
  private async refundPlan(c: PoolClient, a: AppRow) {
    if (!a.admission_receipt_id) return null;
    const r = await c.query<{ amount: string; status: string; pct: string }>(
      `SELECT m.amount::text, m.status, y.refund_deduction_pct::text AS pct FROM misc_receipts m
         JOIN applications a ON a.id = $2 JOIN admission_cycles y ON y.id = a.cycle_id WHERE m.id = $1`,
      [a.admission_receipt_id, a.id],
    );
    const x = r.rows[0];
    if (!x || x.status !== 'posted' || !(Number(x.amount) > 0)) return null;
    const paid = Number(x.amount);
    const pct = Number(x.pct);
    const deduction = Math.round(paid * pct) / 100;
    return {
      receiptId: a.admission_receipt_id,
      paid,
      pct,
      deduction,
      amount: Math.round((paid - deduction) * 100) / 100,
    };
  }

  async cancelPreview(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      return {
        status: a.status,
        refund: ['fee_paid', 'admitted'].includes(a.status) ? await this.refundPlan(c, a) : null,
      };
    });
  }

  async cancel(ctx: RequestContext, id: string, dto: CancelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.core.row(c, id);
      if (['cancelled', 'withdrawn'].includes(a.status))
        throw new DomainError('admissions.cancelled', 'Already cancelled', { status: 409 });
      // once a pupil, the admission is cancelled on the student page: approval, the school fee settled
      if (a.status === 'admitted' && a.student_id)
        throw new DomainError(
          'admissions.cancel_on_student_page',
          'The candidate is admitted: use Cancel admission on the student page (with approval; the school fee is settled there)',
          { status: 409 },
        );
      if (!BEFORE_FEE.includes(a.status) && !['fee_paid', 'admitted'].includes(a.status))
        throw new DomainError(
          'admissions.cannot_cancel',
          'This registration cannot be cancelled now',
          { status: 409 },
        );
      let refund: { id: string; amount: number } | null = null;
      if (['fee_paid', 'admitted'].includes(a.status)) {
        const plan = await this.refundPlan(c, a);
        if (plan) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO admission_refunds (school_id, application_id, receipt_id, paid_amount, deduction_pct, deduction, amount, reason, requested_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
            [
              id,
              plan.receiptId,
              plan.paid.toFixed(2),
              plan.pct,
              plan.deduction.toFixed(2),
              plan.amount.toFixed(2),
              dto.reason,
              ctx.user.id,
            ],
          );
          refund = { id: r.rows[0]!.id, amount: plan.amount };
        }
      }
      await c.query(
        `UPDATE applications SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
        [id, dto.reason],
      );
      await c.query(
        `UPDATE admission_corrections SET status = 'cancelled' WHERE application_id = $1 AND status = 'open'`,
        [id],
      );
      await this.core.event(
        c,
        id,
        a.status,
        'cancelled',
        `${['fee_paid', 'admitted'].includes(a.status) ? 'Admission' : 'Registration'} cancelled: ${dto.reason}${refund ? ` · refund of ${money(refund.amount)} sent for approval` : ''}`,
        { actorUser: ctx.user.id },
      );
      await c.query(
        `SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, NULL, $7::jsonb, $8)`,
        [
          'admission_cancelled',
          a.contact_mobile,
          a.contact_email,
          JSON.stringify({
            ...messageTag('status', { applicationId: a.id }),
            name: a.candidate_name ?? '',
            number: a.application_no ?? '',
            class: a.class_name,
            school: '',
          }),
          ['fee_paid', 'admitted'].includes(a.status)
            ? 'Admission cancelled'
            : 'Registration cancelled',
          `The ${['fee_paid', 'admitted'].includes(a.status) ? 'admission' : 'registration'} of ${a.candidate_name ?? 'your ward'} for ${a.class_name} is cancelled.`,
          JSON.stringify([
            ['Registration no.', a.application_no ?? ''],
            ...(a.admission_no ? [['Admission no.', a.admission_no]] : []),
            ['Reason', dto.reason],
            ...(refund ? [['Refund', `${money(refund.amount)} after approval`]] : []),
          ]),
          refund
            ? 'The refund of the admission fee (less the deduction) is made after the school approves it. The registration fee is not refunded.'
            : 'The registration fee is not refunded.',
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.application.cancel',
        entityType: 'applications',
        entityId: id,
        before: { status: a.status },
        after: { reason: dto.reason, refund: refund?.amount ?? null },
      });
      return { status: 'cancelled', refund };
    });
  }

  async refunds(ctx: RequestContext, q: RefundsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        application_id: string;
        number: string | null;
        admission_no: string | null;
        candidate: string | null;
        class_name: string;
        receipt_no: string;
        paid_amount: string;
        deduction_pct: string;
        deduction: string;
        amount: string;
        reason: string;
        status: string;
        requested_at: Date;
        requested_by: string | null;
        decided_at: Date | null;
        decided_by: string | null;
        decision_note: string | null;
        mode: string | null;
        reference: string | null;
        paid_on: string | null;
      }>(
        `SELECT f.id::text, f.application_id::text, a.application_no AS number, a.admission_no, a.candidate_name AS candidate, cl.name AS class_name,
                m.receipt_no, f.paid_amount::text, f.deduction_pct::text, f.deduction::text, f.amount::text, f.reason, f.status, f.requested_at,
                ur.display_name AS requested_by, f.decided_at, ud.display_name AS decided_by, f.decision_note, f.mode, f.reference, f.paid_on::text
           FROM admission_refunds f JOIN applications a ON a.id = f.application_id JOIN classes cl ON cl.id = a.class_id
           JOIN misc_receipts m ON m.id = f.receipt_id LEFT JOIN users ur ON ur.id = f.requested_by LEFT JOIN users ud ON ud.id = f.decided_by
          WHERE ($1::text IS NULL OR f.status = $1) AND ($2::bigint IS NULL OR a.cycle_id = $2::bigint)
          ORDER BY f.requested_at DESC LIMIT 500`,
        [q.status ?? null, q.cycleId ?? null],
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          applicationId: x.application_id,
          number: x.number,
          admissionNo: x.admission_no,
          candidate: x.candidate,
          className: x.class_name,
          receiptNo: x.receipt_no,
          paidAmount: Number(x.paid_amount),
          deductionPct: Number(x.deduction_pct),
          deduction: Number(x.deduction),
          amount: Number(x.amount),
          reason: x.reason,
          status: x.status,
          requestedAt: x.requested_at.toISOString(),
          requestedBy: x.requested_by,
          decidedAt: x.decided_at?.toISOString() ?? null,
          decidedBy: x.decided_by,
          decisionNote: x.decision_note,
          mode: x.mode,
          reference: x.reference,
          paidOn: x.paid_on,
        })),
      };
    });
  }

  async decideRefund(ctx: RequestContext, id: string, dto: RefundDecisionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ status: string; requested_by: string | null }>(
        `SELECT status, requested_by::text FROM admission_refunds WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Refund not found', { status: 404 });
      if (r.rows[0].status !== 'requested')
        throw new DomainError('admissions.refund_decided', 'This refund is already decided', {
          status: 409,
        });
      await c.query(
        `UPDATE admission_refunds SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
        [id, dto.approve ? 'approved' : 'rejected', ctx.user.id, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: dto.approve ? 'admissions.refund.approve' : 'admissions.refund.reject',
        entityType: 'admission_refunds',
        entityId: id,
        after: { note: dto.note ?? null },
      });
      return { status: dto.approve ? 'approved' : 'rejected' };
    });
  }

  async payRefund(ctx: RequestContext, id: string, dto: RefundPayDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ status: string; application_id: string; amount: string }>(
        `SELECT status, application_id::text, amount::text FROM admission_refunds WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Refund not found', { status: 404 });
      if (r.rows[0].status !== 'approved')
        throw new DomainError('admissions.refund_not_approved', 'Approve the refund first', {
          status: 409,
        });
      await c.query(
        `UPDATE admission_refunds SET status = 'paid', mode = $2, reference = $3, paid_on = COALESCE($4::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), paid_by = $5 WHERE id = $1`,
        [id, dto.mode, dto.reference ?? null, dto.paidOn ?? null, ctx.user.id],
      );
      await this.core.event(
        c,
        r.rows[0].application_id,
        'cancelled',
        'cancelled',
        `Admission fee refund of ${money(Number(r.rows[0].amount))} paid (${dto.mode})`,
        {
          actorUser: ctx.user.id,
        },
      );
      await this.audit.stage(ctx, c, {
        action: 'admissions.refund.pay',
        entityType: 'admission_refunds',
        entityId: id,
        after: { mode: dto.mode, reference: dto.reference ?? null },
      });
      return { status: 'paid' };
    });
  }
}
