import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { MiscFeesService } from '../fees/misc-fees.service';
import type { ChargeDto, ChargeExportDto, ChargeListDto, ChargePreviewDto } from './library.dto';
import { libraryFile } from './library-file';
import { announceMiscFee, LIBRARY_HEADS, libraryHead, libraryYear } from './library-misc';

const HEAD = LIBRARY_HEADS.book;
const FINE_HEAD = LIBRARY_HEADS.fine;
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round = (n: number) => Math.round(n * 100) / 100;
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** The open loan of a copy (by its number, an old one too) with what the charge is worked out from. */
interface OpenLoan {
  loan_id: string;
  copy_id: string;
  accession_no: string;
  title: string;
  borrower_kind: 'student' | 'employee';
  borrower_id: string;
  borrower: string;
  borrower_ref: string;
  issued_on: string;
  due_on: string;
  price: string | null;
}

/**
 * Lost and damaged books (docs/design/36-library.md, part 3 of the register work). A book on loan is
 * reported lost: its price (the copy's, else the title's) + the processing fee + the late fine to that
 * day, the librarian may change it with a reason; or it comes back damaged: what the librarian enters (a
 * share of the price suggested). The charge is announced at once as a misc fee on the pupil or the staff
 * member (0216; no approval step): the parent sees a pupil's, the fees counter collects it, the library
 * sees it due or paid, and it stops
 * new issues and the leaving check until paid. A lost book found again before it is paid: the price and
 * the fee come off through a misc fee change request the fees office approves.
 */
@Injectable()
export class LibraryChargesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly misc: MiscFeesService,
  ) {}

  private async setting(c: PoolClient, key: string, fallback: number) {
    const r = await c.query<{ v: string | null }>(`SELECT app.setting($1) #>> '{}' AS v`, [key]);
    const n = Number(r.rows[0]?.v);
    return r.rows[0]?.v !== null && r.rows[0]?.v !== undefined && Number.isFinite(n) ? n : fallback;
  }

  private async openLoan(c: PoolClient, accessionNo: string, lock = false): Promise<OpenLoan> {
    const r = await c.query<OpenLoan>(
      // eslint-disable-next-line no-restricted-syntax -- a fixed lock clause; values are bound
      `SELECT ln.id::text AS loan_id, x.id::text AS copy_id, x.accession_no, t.title,
              ln.borrower_kind::text AS borrower_kind, ln.borrower_id::text AS borrower_id,
              COALESCE(st.display_name, e.display_name) AS borrower,
              COALESCE(st.admission_no, e.employee_code) AS borrower_ref,
              ln.issued_on::text, ln.due_on::text, COALESCE(x.price, t.price)::text AS price
         FROM library_copies x
         JOIN library_titles t ON t.id = x.title_id
         JOIN library_loans ln ON ln.copy_id = x.id AND ln.returned_on IS NULL
         LEFT JOIN students st ON ln.borrower_kind = 'student' AND st.id = ln.borrower_id
         LEFT JOIN employees e ON ln.borrower_kind = 'employee' AND e.id = ln.borrower_id
        WHERE x.id = app.library_copy_by_number($1)${lock ? ' FOR UPDATE OF ln, x' : ''}`,
      [accessionNo],
    );
    if (!r.rows[0])
      throw new DomainError(
        'library.not_on_loan',
        `${accessionNo} is not on loan: a charge is for a book a borrower has`,
        { status: 409 },
      );
    return r.rows[0];
  }

  /** The late fine of a loan to a day, by the borrower's rule (grace days, highest fine). */
  private async lateFine(c: PoolClient, l: OpenLoan, on: string) {
    const rule = await c.query<{
      fine_per_day: string;
      max_fine: string | null;
      grace_days: number;
    }>(
      `SELECT fine_per_day::text, max_fine::text, grace_days FROM app.library_rule($1::library_borrower, $2)`,
      [l.borrower_kind, l.borrower_id],
    );
    const x = rule.rows[0];
    const perDay = x ? Number(x.fine_per_day) : await this.setting(c, 'library.fine_per_day', 2);
    const grace = x?.grace_days ?? 0;
    const days = Math.round((Date.parse(on) - Date.parse(l.due_on)) / 86_400_000);
    const fine = Math.max(0, days - grace) * perDay;
    const max = x?.max_fine === null || x?.max_fine === undefined ? Infinity : Number(x.max_fine);
    return { fine: round(Math.min(fine, max)), daysLate: Math.max(0, days) };
  }

  /** What a charge would be, before it is raised. */
  async preview(ctx: RequestContext, dto: ChargePreviewDto) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.work(c, dto.accessionNo, dto.kind, dto.on),
    );
  }

  private async work(c: PoolClient, accessionNo: string, kind: 'lost' | 'damaged', on?: string) {
    const l = await this.openLoan(c, accessionNo);
    const day = on ?? today();
    if (day < l.issued_on)
      throw new DomainError(
        'validation-failed',
        `The day is before the book was issued (${dmy(l.issued_on)})`,
        {
          status: 400,
        },
      );
    const price = round(Number(l.price ?? 0));
    const fee = kind === 'lost' ? await this.setting(c, 'library.lost_processing_fee', 50) : 0;
    const share = await this.setting(c, 'library.damage_share_pct', 25);
    // the late fine: on the charge of a lost book; a damaged one's stays a library fine
    const { fine, daysLate } = await this.lateFine(c, l, day);
    const suggested = kind === 'lost' ? round(price + fee + fine) : round((price * share) / 100);
    return {
      kind,
      on: day,
      loanId: l.loan_id,
      copyId: l.copy_id,
      accessionNo: l.accession_no,
      title: l.title,
      borrowerKind: l.borrower_kind,
      borrower: l.borrower,
      borrowerRef: l.borrower_ref,
      issuedOn: l.issued_on,
      dueOn: l.due_on,
      daysLate,
      price,
      processingFee: fee,
      lateFine: fine,
      sharePct: share,
      suggested,
      // a pupil or a staff member: both pay at the fees counter (misc fees for staff, 0216)
      canCharge: true,
    };
  }

  /** A library misc head (made the first time): lost or damaged books, late fines. */
  private head(c: PoolClient, h: { code: string; name: string; order: number }) {
    return libraryHead(c, h);
  }

  /** The book reported lost, or returned damaged, and the charge announced on the borrower. */
  async charge(ctx: RequestContext, dto: ChargeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = await this.openLoan(c, dto.accessionNo, true);
      const w = await this.work(c, dto.accessionNo, dto.kind, dto.on);
      const amount = round(dto.amount ?? w.suggested);
      if (!(amount > 0))
        throw new DomainError('validation-failed', 'The charge must be more than ₹0', {
          status: 400,
        });
      const changed = Math.abs(amount - w.suggested) >= 0.005;
      const reason = dto.reason?.trim() || null;
      if (dto.kind === 'damaged' && !reason)
        throw new DomainError('validation-failed', 'Say what is damaged', { status: 400 });
      if (dto.kind === 'lost' && changed && !reason)
        throw new DomainError(
          'validation-failed',
          `The charge differs from ${rupees(w.suggested)}: give the reason`,
          { status: 400 },
        );
      const yearId = await this.yearOf(c, ctx);
      // the loan closes: a lost book on the day reported (its late fine goes on the charge), a damaged
      // one on its return (its late fine stays a library fine)
      if (dto.kind === 'lost') {
        await c.query(
          `UPDATE library_loans SET returned_on = $2::date, returned_by = app.current_user_id(), fine_amount = 0, fine_waived = 0,
                  note = concat_ws(' · ', note, $3::text), updated_at = now()
            WHERE id = $1`,
          [l.loan_id, w.on, `Lost: charged ${rupees(amount)} as a misc fee`],
        );
      } else {
        const rule = await this.lateFine(c, l, w.on);
        await c.query(
          `UPDATE library_loans SET returned_on = $2::date, returned_by = app.current_user_id(), fine_amount = $3::numeric,
                  fine_waived = CASE WHEN $4::boolean THEN $3::numeric ELSE 0 END,
                  note = concat_ws(' · ', note, $5::text), updated_at = now()
            WHERE id = $1`,
          [
            l.loan_id,
            w.on,
            rule.fine,
            dto.waiveFine ?? false,
            `Damaged: charged ${rupees(amount)} as a misc fee`,
          ],
        );
        if (dto.waiveFine && rule.fine > 0)
          await c.query(
            `INSERT INTO library_fine_waivers (school_id, loan_id, amount, reason, waived_on, by_user, by_name)
             VALUES (app.current_school_id(), $1, $2, $3, $4::date, app.current_user_id(), $5)`,
            [
              l.loan_id,
              rule.fine,
              `Waived when returned damaged: ${reason!}`,
              w.on,
              ctx.user.displayName,
            ],
          );
      }
      await c.query(
        `UPDATE library_copies SET status = $2::library_copy_status, status_on = $3::date, status_reason = $4,
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          l.copy_id,
          dto.kind,
          w.on,
          reason ?? (dto.kind === 'lost' ? `Lost by ${l.borrower}` : null),
        ],
      );
      // the misc fee, announced at once on the pupil or the staff member
      const remark =
        dto.kind === 'lost'
          ? `Price ${rupees(w.price)} + processing fee ${rupees(w.processingFee)} + late fine ${rupees(w.lateFine)}${changed ? `; charged ${rupees(amount)}: ${reason!}` : ''}`
          : `Damage: ${reason!}`;
      const made = await this.announce(c, ctx, {
        kind: dto.kind,
        loanId: l.loan_id,
        copyId: l.copy_id,
        borrowerKind: l.borrower_kind,
        borrowerId: l.borrower_id,
        on: w.on,
        price: w.price,
        processingFee: w.processingFee,
        lateFine: w.lateFine,
        amount,
        reason,
        title: `${dto.kind === 'lost' ? 'Lost book' : 'Damaged book'}: ${l.title} (${l.accession_no})`,
        remark,
        yearId,
      });
      const fee = { rows: [{ id: made.miscFeeId }] };
      const ch = { rows: [{ id: made.chargeId }] };
      // a damaged book returned late: its late fine goes to the fees counter too
      if (dto.kind === 'damaged') await this.raiseLateIn(c, ctx, l.loan_id);
      await c.query(
        `INSERT INTO library_copy_events (school_id, copy_id, what, from_status, to_status, on_date, reason, amount, by_user, by_name)
         VALUES (app.current_school_id(), $1, $2, 'issued', $2, $3::date, $4, $5, app.current_user_id(), $6)`,
        [
          l.copy_id,
          dto.kind,
          w.on,
          `${dto.kind === 'lost' ? 'Lost' : 'Returned damaged'} by ${l.borrower} (${l.borrower_ref}): ${remark}`,
          amount,
          ctx.user.displayName,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: `library.charge.${dto.kind}`,
        entityType: 'library_charges',
        entityId: ch.rows[0]!.id,
        after: { ...dto, amount, suggested: w.suggested, miscFeeId: fee.rows[0]!.id },
      });
      return {
        id: ch.rows[0]!.id,
        amount,
        miscFeeId: fee.rows[0]!.id,
        borrower: l.borrower,
        title: l.title,
      };
    });
  }

  /**
   * A library charge announced at once as a misc fee on the pupil or the staff member (no approval step):
   * the misc fee under the library's head, the borrower's line, the library's record of it.
   */
  private async announce(
    c: PoolClient,
    ctx: RequestContext,
    x: {
      kind: 'lost' | 'damaged' | 'late';
      loanId: string;
      copyId: string;
      borrowerKind: 'student' | 'employee';
      borrowerId: string;
      on: string;
      price: number;
      processingFee: number;
      lateFine: number;
      amount: number;
      reason: string | null;
      title: string;
      remark: string;
      yearId: string;
    },
  ): Promise<{ chargeId: string; miscFeeId: string; lineId: string }> {
    const headId = await this.head(c, x.kind === 'late' ? FINE_HEAD : HEAD);
    const made = await announceMiscFee(c, {
      yearId: x.yearId,
      headId,
      title: x.title,
      amount: x.amount,
      remark: x.remark,
      kind: x.borrowerKind,
      personId: x.borrowerId,
    });

    const ch = await c.query<{ id: string }>(
      `INSERT INTO library_charges (school_id, loan_id, copy_id, borrower_kind, borrower_id, kind, on_date, price,
                                    processing_fee, late_fine, amount, reason, misc_fee_id, misc_line_id,
                                    created_by, created_by_name)
       VALUES (app.current_school_id(), $1, $2, $3::library_borrower, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13,
               app.current_user_id(), $14)
       RETURNING id::text`,
      [
        x.loanId,
        x.copyId,
        x.borrowerKind,
        x.borrowerId,
        x.kind,
        x.on,
        x.price,
        x.processingFee,
        x.lateFine,
        x.amount,
        x.reason,
        made.miscFeeId,
        made.lineId,
        ctx.user.displayName,
      ],
    );
    return { chargeId: ch.rows[0]!.id, miscFeeId: made.miscFeeId, lineId: made.lineId };
  }

  /** The year a charge is announced in: the active one, else the working one. */
  private yearOf(c: PoolClient, ctx: RequestContext) {
    return libraryYear(c, ctx);
  }

  /**
   * A returned book's late fine (what is left after a waiver at the desk) announced as a misc fee on the
   * borrower; nothing when there is none, it is paid or it is already announced. Returns the amount.
   */
  async raiseLateIn(c: PoolClient, ctx: RequestContext, loanId: string): Promise<number> {
    const r = await c.query<{
      copy_id: string;
      borrower_kind: 'student' | 'employee';
      borrower_id: string;
      left: string;
      returned_on: string | null;
      due_on: string;
      title: string;
      accession_no: string;
    }>(
      `SELECT l.copy_id::text, l.borrower_kind::text AS borrower_kind, l.borrower_id::text,
              (l.fine_amount - l.fine_waived)::text AS left, l.returned_on::text, l.due_on::text, t.title, x.accession_no
         FROM library_loans l JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
        WHERE l.id = $1 AND l.fine_paid_on IS NULL AND l.fine_receipt_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM library_charges ch WHERE ch.loan_id = l.id AND ch.kind = 'late')`,
      [loanId],
    );
    const l = r.rows[0];
    const amount = round(Number(l?.left ?? 0));
    if (!l || !(amount > 0)) return 0;
    const on = l.returned_on ?? today();
    const late = Math.max(0, Math.round((Date.parse(on) - Date.parse(l.due_on)) / 86_400_000));
    await this.announce(c, ctx, {
      kind: 'late',
      loanId,
      copyId: l.copy_id,
      borrowerKind: l.borrower_kind,
      borrowerId: l.borrower_id,
      on,
      price: 0,
      processingFee: 0,
      lateFine: amount,
      amount,
      reason: null,
      title: `Late fine: ${l.title} (${l.accession_no})`,
      remark: `Returned on ${dmy(on)}, ${String(late)} days after ${dmy(l.due_on)}`,
      yearId: await this.yearOf(c, ctx),
    });
    return amount;
  }

  /** Old fines not yet sent to the fees counter (from before 0217): announced now, the ones given or all. */
  async sendUnsent(ctx: RequestContext, loanIds?: string[]) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT l.id::text FROM library_loans l JOIN library_copies x ON x.id = l.copy_id
          WHERE l.fine_amount > l.fine_waived AND l.fine_paid_on IS NULL AND l.fine_receipt_id IS NULL
            AND l.returned_on IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM library_charges ch WHERE ch.loan_id = l.id AND ch.kind = 'late')
            AND ($1::bigint[] IS NULL OR l.id = ANY($1::bigint[]))
          ORDER BY l.id`,
        [loanIds?.length ? loanIds : null],
      );
      let sent = 0;
      let total = 0;
      for (const x of r.rows) {
        const a = await this.raiseLateIn(c, ctx, x.id);
        if (a > 0) {
          sent += 1;
          total += a;
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'library.fines.send',
        entityType: 'library_loans',
        entityId: r.rows[0]?.id ?? requireTenant(ctx).schoolId,
        after: { sent, total: round(total) },
      });
      return { sent, total: round(total) };
    });
  }

  /**
   * A late fine already at the fees counter waived in part or in full: a misc fee change request the fees
   * office approves (nothing paid and all waived: the fee is closed).
   */
  async askWaiver(ctx: RequestContext, chargeId: string, dto: { amount?: number; reason: string }) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        misc_fee_id: string;
        misc_line_id: string;
        line_amount: string;
        paid: string;
        title: string;
        borrower: string;
        pending: boolean;
      }>(
        `SELECT ch.misc_fee_id::text, ch.misc_line_id::text, l.amount::text AS line_amount, l.paid::text, f.title,
                COALESCE(st.display_name, e.display_name) AS borrower,
                EXISTS (SELECT 1 FROM misc_fee_requests q WHERE q.misc_fee_id = ch.misc_fee_id AND q.status = 'pending') AS pending
           FROM library_charges ch
           JOIN misc_fee_students l ON l.id = ch.misc_line_id JOIN misc_fees f ON f.id = ch.misc_fee_id
           LEFT JOIN students st ON ch.borrower_kind = 'student' AND st.id = ch.borrower_id
           LEFT JOIN employees e ON ch.borrower_kind = 'employee' AND e.id = ch.borrower_id
          WHERE ch.id = $1 AND l.status = 'open' AND f.status = 'announced'`,
        [chargeId],
      );
      const x = r.rows[0];
      if (!x)
        throw new DomainError('library.no_fine', 'Nothing is due on this charge', { status: 409 });
      if (x.pending)
        throw new DomainError(
          'misc.request_open',
          'A change is already waiting for the fees office',
          {
            status: 409,
          },
        );
      const due = round(Number(x.line_amount) - Number(x.paid));
      const waive = round(Math.min(dto.amount ?? due, due));
      if (!(waive > 0))
        throw new DomainError('validation-failed', 'Give the amount to waive', { status: 400 });
      const keep = round(Number(x.line_amount) - waive);
      const requestId =
        keep > 0
          ? await this.misc.requestChangeIn(c, ctx, {
              kind: 'pupil_change',
              miscFeeId: x.misc_fee_id,
              lineId: x.misc_line_id,
              amount: keep,
              fromAmount: x.line_amount,
              reason: dto.reason,
              subject: `${x.title}: ${x.borrower}: amount Rs. ${x.line_amount} to Rs. ${keep.toFixed(2)}`,
            })
          : await this.misc.requestChangeIn(c, ctx, {
              kind: 'close',
              miscFeeId: x.misc_fee_id,
              reason: dto.reason,
              subject: `${x.title}: waived`,
            });
      await this.audit.stage(ctx, c, {
        action: 'library.fine.waive_request',
        entityType: 'library_charges',
        entityId: chargeId,
        after: { waive, reason: dto.reason, requestId },
      });
      return { requestId, waive };
    });
  }

  /** The lost and damaged books charged, with what the fees counter has taken (late fines: the Fines page). */
  private async rowsOf(c: PoolClient, q: ChargeListDto) {
    const r = await c.query<Record<string, unknown>>(
      `SELECT ch.id::text, ch.kind, ch.on_date::text, ch.price::text, ch.processing_fee::text, ch.late_fine::text,
              ch.amount::text, ch.reason, ch.found_on::text, ch.borrower_kind::text,
              COALESCE(st.display_name, e.display_name) AS borrower, COALESCE(st.admission_no, e.employee_code) AS borrower_ref,
              x.accession_no, t.id::text AS title_id, t.title, l.amount::text AS due_amount, l.paid::text, l.status AS line_status,
              f.status AS fee_status, rq.status AS request_status, ch.created_by_name,
              pr.paid_on::text, pr.receipts
         FROM library_charges ch
         JOIN library_copies x ON x.id = ch.copy_id JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN students st ON ch.borrower_kind = 'student' AND st.id = ch.borrower_id
         LEFT JOIN employees e ON ch.borrower_kind = 'employee' AND e.id = ch.borrower_id
         LEFT JOIN misc_fee_students l ON l.id = ch.misc_line_id
         LEFT JOIN misc_fees f ON f.id = ch.misc_fee_id
         LEFT JOIN misc_fee_requests rq ON rq.id = ch.found_request_id
         LEFT JOIN LATERAL (
           SELECT max(m.received_on) AS paid_on, string_agg(m.receipt_no, ', ' ORDER BY m.received_on) AS receipts
             FROM misc_receipts m WHERE m.misc_fee_student_id = ch.misc_line_id AND m.status = 'posted') pr ON true
        WHERE ch.kind <> 'late'
          AND ($1::library_borrower IS NULL OR ch.borrower_kind = $1)
          AND ($2::text IS NULL OR COALESCE(st.display_name, e.display_name) ILIKE $2 OR COALESCE(st.admission_no, e.employee_code) ILIKE $2
               OR t.title ILIKE $2 OR x.accession_no ILIKE $2)
        ORDER BY ch.on_date DESC, ch.id DESC`,
      [q.borrower ?? null, q.q ? `%${q.q.replace(/[\\%_]/g, (k) => `\\${k}`)}%` : null],
    );
    const rows = r.rows.map((x) => {
      const amount = Number(x.due_amount ?? x.amount);
      const paid = Number(x.paid ?? 0);
      const state =
        x.fee_status === 'closed' || x.line_status === 'cancelled'
          ? 'cancelled'
          : paid >= amount - 0.005
            ? 'paid'
            : x.request_status === 'pending'
              ? 'found_pending'
              : 'due';
      return {
        id: String(x.id),
        kind: String(x.kind),
        on: String(x.on_date),
        borrowerKind: String(x.borrower_kind),
        borrower: String(x.borrower ?? ''),
        borrowerRef: String(x.borrower_ref ?? ''),
        accessionNo: String(x.accession_no),
        titleId: String(x.title_id),
        title: String(x.title),
        price: Number(x.price),
        processingFee: Number(x.processing_fee),
        lateFine: Number(x.late_fine),
        charged: Number(x.amount),
        amount,
        paid,
        due: Math.max(0, round(amount - paid)),
        paidOn: x.paid_on as string | null,
        receipts: x.receipts as string | null,
        reason: x.reason as string | null,
        foundOn: x.found_on as string | null,
        state,
        by: x.created_by_name as string | null,
      };
    });
    const want = q.status ?? 'due';
    // the days: charged on, or for what is paid the day it was paid
    const day = (x: (typeof rows)[number]) => (want === 'paid' ? (x.paidOn ?? x.on) : x.on);
    const dated = rows.filter((x) => (!q.from || day(x) >= q.from) && (!q.to || day(x) <= q.to));
    const shown =
      want === 'all'
        ? dated
        : dated.filter((x) =>
            want === 'due' ? x.state === 'due' || x.state === 'found_pending' : x.state === want,
          );
    return { rows: shown, dated, want };
  }

  async list(ctx: RequestContext, q: ChargeListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows, dated } = await this.rowsOf(c, q);
      return {
        rows: rows.slice(0, 500),
        total: rows.length,
        totals: {
          charged: round(rows.reduce((n, x) => n + x.amount, 0)),
          paid: round(rows.reduce((n, x) => n + x.paid, 0)),
          due: round(rows.reduce((n, x) => n + (x.state === 'cancelled' ? 0 : x.due), 0)),
        },
        counts: {
          due: dated.filter((x) => x.state === 'due' || x.state === 'found_pending').length,
          paid: dated.filter((x) => x.state === 'paid').length,
          cancelled: dated.filter((x) => x.state === 'cancelled').length,
          dueAmount: round(
            dated
              .filter((x) => x.state !== 'paid' && x.state !== 'cancelled')
              .reduce((n, x) => n + x.due, 0),
          ),
        },
      };
    });
  }

  /** The charges list as filtered, as Excel or PDF. */
  async export(ctx: RequestContext, q: ChargeExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { rows, want } = await this.rowsOf(c, q);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const STATE: Record<string, string> = {
        due: 'Due at the fees counter',
        found_pending: 'Found again: the fees office is deciding',
        paid: 'Paid',
        cancelled: 'Cancelled',
      };
      const NAME: Record<string, string> = {
        due: 'Lost and damaged books: due',
        paid: 'Lost and damaged books: paid',
        cancelled: 'Lost and damaged books: cancelled',
        all: 'Lost and damaged books charged',
      };
      const words =
        [
          q.from || q.to
            ? `${want === 'paid' ? 'Paid' : 'Charged'} ${q.from ?? '…'} to ${q.to ?? '…'}`
            : null,
          q.borrower ? (q.borrower === 'student' ? 'Pupils' : 'Staff') : null,
          q.q ? `search "${q.q}"` : null,
        ]
          .filter(Boolean)
          .join('; ') || 'Every charge';
      await this.audit.stage(ctx, c, {
        action: 'library.charges.export',
        entityType: 'library_charges',
        entityId: requireTenant(ctx).schoolId,
        after: { status: want, format: q.format, rows: rows.length, words },
      });
      const sum = (f: (x: (typeof rows)[number]) => number) =>
        round(rows.reduce((n, x) => n + f(x), 0));
      return libraryFile({
        format: q.format,
        name: NAME[want]!,
        slug: `Library-charges-${want}`,
        school,
        by: ctx.user.displayName,
        words,
        columns: [
          { label: 'Charged on', type: 'date' },
          { label: 'Lost / damaged', width: 1.4 },
          { label: 'Borrower' },
          { label: 'Adm./emp. no.', width: 1.6 },
          { label: 'Book' },
          { label: 'Book no.', width: 1.4 },
          { label: 'Price (₹)', type: 'money' },
          { label: 'Processing fee (₹)', type: 'money' },
          { label: 'Late fine (₹)', type: 'money' },
          { label: 'Charged (₹)', type: 'money' },
          { label: 'Paid (₹)', type: 'money' },
          { label: 'Due (₹)', type: 'money' },
          { label: 'Paid on', type: 'date' },
          { label: 'Receipts', width: 1.8 },
          { label: 'State', width: 2.2 },
          { label: 'Reason', width: 2.4 },
        ],
        rows: rows.map((x) => [
          x.on,
          x.kind === 'lost' ? 'Lost' : 'Damaged',
          x.borrower,
          x.borrowerRef,
          x.title,
          x.accessionNo,
          x.price,
          x.processingFee,
          x.lateFine,
          x.amount,
          x.paid,
          x.state === 'cancelled' ? 0 : x.due,
          x.state === 'paid' ? x.paidOn : null,
          x.receipts,
          STATE[x.state] ?? x.state,
          x.reason,
        ]),
        totals: [
          'Total',
          '',
          '',
          '',
          '',
          '',
          sum((x) => x.price),
          sum((x) => x.processingFee),
          sum((x) => x.lateFine),
          sum((x) => x.amount),
          sum((x) => x.paid),
          sum((x) => (x.state === 'cancelled' ? 0 : x.due)),
          '',
          '',
          '',
          '',
        ],
      });
    });
  }

  /**
   * A lost copy found again (called with the copy's status change): when its charge is not paid, the
   * price and the fee come off through a misc fee change request (the late fine stays; nothing left: the
   * fee is closed). Returns what was done, in words, for the copy's history.
   */
  async foundIn(
    c: PoolClient,
    ctx: RequestContext,
    copyId: string,
    on: string,
  ): Promise<string | null> {
    const r = await c.query<{
      id: string;
      late_fine: string;
      misc_fee_id: string;
      misc_line_id: string;
      line_amount: string;
      paid: string;
      title: string;
      borrower: string;
    }>(
      `SELECT ch.id::text, ch.late_fine::text, ch.misc_fee_id::text, ch.misc_line_id::text, l.amount::text AS line_amount,
              l.paid::text, f.title, COALESCE(st.display_name, e.display_name) AS borrower
         FROM library_charges ch
         JOIN misc_fee_students l ON l.id = ch.misc_line_id JOIN misc_fees f ON f.id = ch.misc_fee_id
         LEFT JOIN students st ON ch.borrower_kind = 'student' AND st.id = ch.borrower_id
         LEFT JOIN employees e ON ch.borrower_kind = 'employee' AND e.id = ch.borrower_id
        WHERE ch.copy_id = $1 AND ch.kind = 'lost' AND ch.found_on IS NULL
          AND l.status = 'open' AND f.status = 'announced'
        ORDER BY ch.id DESC LIMIT 1 FOR UPDATE OF ch`,
      [copyId],
    );
    const ch = r.rows[0];
    if (!ch) return null;
    const paid = Number(ch.paid);
    const keep = Math.max(Number(ch.late_fine), paid);
    if (keep >= Number(ch.line_amount) - 0.005) return null;
    const reason = `The lost book was found again on ${dmy(on)}: the price and the processing fee come off (the late fine stays)`;
    const requestId =
      keep > 0
        ? await this.misc.requestChangeIn(c, ctx, {
            kind: 'pupil_change',
            miscFeeId: ch.misc_fee_id,
            lineId: ch.misc_line_id,
            amount: keep,
            fromAmount: ch.line_amount,
            reason,
            subject: `${ch.title}: ${ch.borrower}: amount Rs. ${ch.line_amount} to Rs. ${keep.toFixed(2)}`,
          })
        : await this.misc.requestChangeIn(c, ctx, {
            kind: 'close',
            miscFeeId: ch.misc_fee_id,
            reason,
            subject: `${ch.title}: no more collection`,
          });
    await c.query(
      `UPDATE library_charges SET found_on = $2::date, found_request_id = $3 WHERE id = $1`,
      [ch.id, on, requestId],
    );
    return keep > 0
      ? `The charge comes down to ${rupees(keep)} once the fees office approves`
      : 'The charge is cancelled once the fees office approves';
  }
}
