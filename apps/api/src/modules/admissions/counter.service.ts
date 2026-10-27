import { Injectable } from '@nestjs/common';
import { ADMISSION_STATUS_BY_CODE as STATUS } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AdmissionAdmitService } from './admit.service';
import type { DeskFeeDto } from './desk.dto';
import { AdmissionDeskService } from './desk.service';

interface Row {
  id: string;
  number: string | null;
  admission_no: string | null;
  status: string;
  candidate: string | null;
  class_name: string;
  session: string;
  category: string | null;
  parent: string | null;
  mobile: string | null;
  registration_fee: string | null;
  admission_fee: string | null;
  /** what is paid of the admission fee so far (parts, docs/design/53) */
  paid: string | null;
  offer_expires_at: Date | null;
}

/** The admission fee paid so far: posted receipts on the admission head (docs/design/53). */
const PAID = `(SELECT COALESCE(sum(m.amount), 0) FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                WHERE m.application_id = a.id AND h.code = 'ADMFEE' AND m.status = 'posted')::text AS paid`;

const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);

/**
 * The admission fee counter for Accounts (docs/design/52, part 2): find a registration by number, name or
 * parent mobile / email and take the registration or admission fee in full, through the same receipts
 * as the Admission desk (RF / AF series). Only the fee essentials are shown: no form answers, documents
 * or remarks. Every route needs `admissions.fee.collect`.
 */
@Injectable()
export class AdmissionCounterService {
  constructor(
    private readonly db: DbService,
    private readonly desk: AdmissionDeskService,
    private readonly admit: AdmissionAdmitService,
  ) {}

  private due(r: Row) {
    const reg = Number(r.registration_fee ?? 0);
    const adm = Number(r.admission_fee ?? 0);
    if (r.status === 'submitted' && !r.number && reg > 0)
      return {
        kind: 'registration' as const,
        head: 'Registration fee',
        amount: reg,
        fee: reg,
        paid: 0,
        note: null,
        lapsed: false,
      };
    const paid = Number(r.paid ?? 0);
    const balance = Math.round((adm - paid) * 100) / 100;
    if (r.status === 'offered' && balance > 0) {
      const lapsed = r.offer_expires_at && r.offer_expires_at.getTime() < Date.now();
      return {
        kind: 'admission' as const,
        head: 'Admission fee',
        // the balance: any part of it may be taken (docs/design/53)
        amount: balance,
        fee: adm,
        paid,
        note: r.offer_expires_at
          ? lapsed
            ? `The offer lapsed on ${istDate(r.offer_expires_at)}; the admission office renews it first`
            : `Pay by ${istDate(r.offer_expires_at)}`
          : null,
        lapsed: Boolean(lapsed),
      };
    }
    return null;
  }

  async find(ctx: RequestContext, q: string, onlyDue: boolean) {
    const words = q.trim();
    const digits = words.replace(/\D/g, '');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- PAID is a fixed fragment; values are bound parameters
        `SELECT a.id::text, a.application_no AS number, a.admission_no, a.status::text, a.candidate_name AS candidate,
                cl.name AS class_name, y.name AS session, k.name AS category,
                COALESCE(NULLIF(btrim(a.data->>'father_name'), ''), NULLIF(btrim(a.data->>'mother_name'), ''), ap.name) AS parent,
                COALESCE(a.contact_mobile, ap.mobile) AS mobile, a.registration_fee::text, a.admission_fee::text, a.offer_expires_at,
                ${PAID}
           FROM applications a JOIN classes cl ON cl.id = a.class_id JOIN applicants ap ON ap.id = a.applicant_id
           JOIN admission_cycles y ON y.id = a.cycle_id LEFT JOIN admission_fee_categories k ON k.id = a.category_id
          WHERE a.status::text <> 'draft'
            AND ($1 = '' OR a.application_no ILIKE '%' || $1 || '%' OR a.admission_no ILIKE '%' || $1 || '%'
                 OR a.candidate_name ILIKE '%' || $1 || '%' OR COALESCE(a.contact_email, ap.email::text) ILIKE '%' || $1 || '%'
                 OR (length($2) >= 4 AND (COALESCE(a.contact_mobile, '') LIKE '%' || $2 || '%' OR ap.mobile LIKE '%' || $2 || '%')))
            AND (NOT $3 OR (a.status::text = 'submitted' AND a.application_no IS NULL AND COALESCE(a.registration_fee, 0) > 0)
                 OR (a.status::text = 'offered' AND COALESCE(a.admission_fee, 0) > (SELECT COALESCE(sum(m.amount), 0)
                      FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
                     WHERE m.application_id = a.id AND h.code = 'ADMFEE' AND m.status = 'posted')))
          ORDER BY a.updated_at DESC LIMIT 50`,
        [words, digits, onlyDue],
      );
      const ids = r.rows.map((x) => x.id);
      const receipts = ids.length
        ? await c.query<{
            id: string;
            application_id: string;
            receipt_no: string;
            amount: string;
            received_on: string;
            head: string;
            mode: string;
            status: string;
          }>(
            `SELECT m.id::text, m.application_id::text, m.receipt_no, m.amount::text, m.received_on::text, h.name AS head, m.mode, m.status
               FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id
              WHERE m.application_id = ANY($1::bigint[]) ORDER BY m.id`,
            [ids],
          )
        : { rows: [] };
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          admissionNo: x.admission_no,
          status: STATUS[x.status] ?? x.status,
          candidate: x.candidate,
          className: x.class_name,
          session: x.session,
          category: x.category,
          parent: x.parent,
          mobile: x.mobile,
          due: this.due(x),
          receipts: receipts.rows
            .filter((m) => m.application_id === x.id)
            .map((m) => ({
              id: m.id,
              receiptNo: m.receipt_no,
              amount: Number(m.amount),
              date: m.received_on,
              head: m.head,
              mode: m.mode,
              status: m.status,
            })),
        })),
      };
    });
  }

  /** The admission receipts this cashier took today, for the day's tally. */
  async today(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        application_id: string;
        receipt_no: string;
        amount: string;
        head: string;
        mode: string;
        candidate: string | null;
        number: string | null;
        status: string;
      }>(
        `SELECT m.id::text, m.application_id::text, m.receipt_no, m.amount::text, h.name AS head, m.mode, a.candidate_name AS candidate,
                COALESCE(a.admission_no, a.application_no) AS number, m.status
           FROM misc_receipts m JOIN fee_heads h ON h.id = m.head_id JOIN applications a ON a.id = m.application_id
          WHERE m.received_by = $1 AND m.received_on = (now() AT TIME ZONE 'Asia/Kolkata')::date
          ORDER BY m.id DESC`,
        [ctx.user.id],
      );
      const rows = r.rows.map((x) => ({
        id: x.id,
        registrationId: x.application_id,
        receiptNo: x.receipt_no,
        amount: Number(x.amount),
        head: x.head,
        mode: x.mode,
        candidate: x.candidate,
        number: x.number,
        status: x.status,
      }));
      return {
        total: rows.filter((x) => x.status === 'posted').reduce((s, x) => s + x.amount, 0),
        data: rows,
      };
    });
  }

  /** The fee due, taken in full (the amount comes from the class and fee category, not the cashier). */
  async collect(
    ctx: RequestContext,
    id: string,
    dto: DeskFeeDto & { kind: 'registration' | 'admission' },
  ) {
    const { kind, ...pay } = dto;
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    if (pay.receivedOn && pay.receivedOn > today)
      throw new DomainError('validation-failed', 'The receipt date cannot be in the future', {
        status: 400,
      });
    const row = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- PAID is a fixed fragment; values are bound parameters
        `SELECT a.id::text, a.application_no AS number, a.admission_no, a.status::text, a.registration_fee::text,
                a.admission_fee::text, a.offer_expires_at, a.candidate_name AS candidate, '' AS class_name, '' AS session,
                NULL AS category, NULL AS parent, NULL AS mobile, ${PAID}
           FROM applications a WHERE a.id = $1`,
        [id],
      );
      return r.rows[0];
    });
    if (!row) throw new DomainError('not-found', 'Registration not found', { status: 404 });
    const due = this.due(row);
    if (!due || due.kind !== kind)
      throw new DomainError('admissions.nothing_due', 'That fee is not due on this registration', {
        status: 409,
      });
    if (kind === 'registration') {
      if (pay.amount !== undefined && Math.abs(pay.amount - due.amount) > 0.004)
        throw new DomainError('validation-failed', 'The registration fee is taken in full', {
          status: 400,
        });
      const out = await this.desk.collect(ctx, id, pay);
      return { receiptId: out.receiptId, receiptNo: out.receiptNo, number: out.number };
    }
    const out = await this.admit.collect(ctx, id, pay);
    return {
      receiptId: out.receiptId,
      receiptNo: out.receiptNo,
      admissionNo: out.admissionNo,
      paid: out.paid,
      balance: out.balance,
    };
  }

  async receiptPdf(ctx: RequestContext, id: string, receiptId: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`SELECT 1 FROM misc_receipts WHERE id = $1 AND application_id = $2`, [
        /^\d{1,18}$/.test(receiptId) ? receiptId : '0',
        id,
      ]);
      if (!r.rows.length) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
    });
    return this.desk.receiptPdf(ctx, receiptId);
  }
}
