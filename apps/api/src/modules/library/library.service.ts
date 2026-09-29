import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import type {
  AccessionDto,
  CatalogueQueryDto,
  CopyStatusDto,
  FineDto,
  IssueDto,
  LoansQueryDto,
  RenewDto,
  ReturnDto,
  SaleDto,
  StockCheckCloseDto,
  StockCheckScanDto,
  StockCheckStartDto,
} from './library.dto';

export interface LoanRow {
  id: string;
  accessionNo: string;
  title: string;
  author: string | null;
  borrowerKind: 'student' | 'employee';
  borrowerId: string;
  borrower: string;
  borrowerRef: string;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewed: number;
  daysOverdue: number;
  fineAmount: string;
  fineWaived: string;
  finePaidOn: string | null;
  note: string | null;
}

const LOAN_SELECT = `SELECT l.id::text, c.accession_no, t.title, t.author, l.borrower_kind::text, l.borrower_id::text,
       CASE l.borrower_kind WHEN 'student' THEN s.display_name ELSE e.display_name END AS borrower,
       CASE l.borrower_kind WHEN 'student' THEN s.admission_no ELSE e.employee_code END AS borrower_ref,
       l.issued_on::text, l.due_on::text, l.returned_on::text, l.renewed,
       GREATEST(0, (COALESCE(l.returned_on, CURRENT_DATE) - l.due_on))::int AS days_overdue,
       l.fine_amount::text, l.fine_waived::text, l.fine_paid_on::text, l.note
  FROM library_loans l JOIN library_copies c ON c.id = l.copy_id JOIN library_titles t ON t.id = c.title_id
  LEFT JOIN students s ON l.borrower_kind = 'student' AND s.id = l.borrower_id
  LEFT JOIN employees e ON l.borrower_kind = 'employee' AND e.id = l.borrower_id`;

const toLoan = (r: Record<string, unknown>): LoanRow => ({
  id: String(r.id),
  accessionNo: String(r.accession_no),
  title: String(r.title),
  author: (r.author as string | null) ?? null,
  borrowerKind: r.borrower_kind as LoanRow['borrowerKind'],
  borrowerId: String(r.borrower_id),
  borrower: String(r.borrower ?? ''),
  borrowerRef: String(r.borrower_ref ?? ''),
  issuedOn: String(r.issued_on),
  dueOn: String(r.due_on),
  returnedOn: (r.returned_on as string | null) ?? null,
  renewed: Number(r.renewed),
  daysOverdue: Number(r.days_overdue),
  fineAmount: String(r.fine_amount),
  fineWaived: String(r.fine_waived),
  finePaidOn: (r.fine_paid_on as string | null) ?? null,
  note: (r.note as string | null) ?? null,
});

/**
 * Sprint 17: the library — accession (copies of a catalogued title), circulation (issue, renew,
 * return with the loan rules from settings) and fines (computed on return, collected or waived).
 * Titles and copies are also masters (upload by Excel, export) through the master-data framework.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
  ) {}

  private async setting(c: PoolClient, key: string, fallback: number): Promise<number> {
    const r = await c.query<{ v: string | null }>(`SELECT app.setting($1) #>> '{}' AS v`, [key]);
    const n = Number(r.rows[0]?.v);
    return Number.isFinite(n) && r.rows[0]?.v !== null ? n : fallback;
  }

  // ---- catalogue ---------------------------------------------------------------------------------
  async catalogue(ctx: RequestContext, q: CatalogueQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ["t.status = 'active'"];
      const params: unknown[] = [];
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(
          `(t.title ILIKE $${params.length} OR t.author ILIKE $${params.length} OR t.code ILIKE $${params.length} OR t.isbn ILIKE $${params.length})`,
        );
      }
      if (q.category) {
        params.push(q.category);
        where.push(`t.category = $${params.length}`);
      }
      if (q.available === 'true')
        where.push(
          `EXISTS (SELECT 1 FROM library_copies x WHERE x.title_id = t.id AND x.status = 'available')`,
        );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT t.id::text, t.code, t.title, t.author, t.publisher, t.category, t.language, t.location, t.is_reference, t.price::text,
                (SELECT count(*) FROM library_copies x WHERE x.title_id = t.id AND x.status <> 'withdrawn')::int AS copies,
                (SELECT count(*) FROM library_copies x WHERE x.title_id = t.id AND x.status = 'available')::int AS available,
                count(*) OVER () AS total
           FROM library_titles t WHERE ${where.join(' AND ')} ORDER BY t.title LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: r.rows.map(({ total: _t, ...x }) => ({
          id: String(x.id),
          code: String(x.code),
          title: String(x.title),
          author: (x.author as string | null) ?? null,
          publisher: (x.publisher as string | null) ?? null,
          category: (x.category as string | null) ?? null,
          language: (x.language as string | null) ?? null,
          location: (x.location as string | null) ?? null,
          isReference: Boolean(x.is_reference),
          price: (x.price as string | null) ?? null,
          copies: Number(x.copies),
          available: Number(x.available),
        })),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
      };
    });
  }

  async copies(ctx: RequestContext, titleId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT c.id::text, c.accession_no, c.accessioned_on::text, c.source, c.price::text, c.status::text, c.remarks, c.last_verified_on::text,
                (SELECT jsonb_build_object('dueOn', l.due_on::text, 'borrower', COALESCE(s.display_name, e.display_name), 'kind', l.borrower_kind::text)
                   FROM library_loans l LEFT JOIN students s ON l.borrower_kind = 'student' AND s.id = l.borrower_id
                   LEFT JOIN employees e ON l.borrower_kind = 'employee' AND e.id = l.borrower_id
                  WHERE l.copy_id = c.id AND l.returned_on IS NULL) AS loan
           FROM library_copies c WHERE c.title_id = $1 ORDER BY c.accession_no`,
        [titleId],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        accessionNo: String(x.accession_no),
        accessionedOn: String(x.accessioned_on),
        source: (x.source as string | null) ?? null,
        price: (x.price as string | null) ?? null,
        status: String(x.status),
        remarks: (x.remarks as string | null) ?? null,
        lastVerifiedOn: (x.last_verified_on as string | null) ?? null,
        loan: (x.loan as { dueOn: string; borrower: string; kind: string } | null) ?? null,
      }));
    });
  }

  /** Adds copies of a title: given accession numbers, or `count` numbered from the next free integer. */
  async accession(ctx: RequestContext, dto: AccessionDto) {
    if (!dto.accessionNos?.length && !dto.count)
      throw new DomainError('validation-failed', 'Give accession numbers or a count', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await c.query(`SELECT 1 FROM library_titles WHERE id = $1`, [dto.titleId]);
      if (!t.rowCount) throw new DomainError('not-found', 'Title not found', { status: 404 });
      let numbers = dto.accessionNos ?? [];
      if (!numbers.length) {
        const max = await c.query<{ n: string | null }>(
          `SELECT max(accession_no::bigint)::text AS n FROM library_copies WHERE accession_no ~ '^[0-9]+$'`,
        );
        const start = Number(max.rows[0]?.n ?? 0) + 1;
        numbers = Array.from({ length: dto.count! }, (_, i) => String(start + i));
      }
      const created: string[] = [];
      for (const no of numbers) {
        try {
          const r = await c.query<{ id: string }>(
            `INSERT INTO library_copies (school_id, title_id, accession_no, accessioned_on, source, price)
             VALUES (app.current_school_id(), $1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5) RETURNING id::text`,
            [dto.titleId, no, dto.accessionedOn ?? null, dto.source ?? null, dto.price ?? null],
          );
          created.push(r.rows[0]!.id);
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw new DomainError('conflict', `Accession number ${no} already exists`, {
              status: 409,
            });
          throw e;
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'library.accession',
        entityType: 'library_copies',
        after: { titleId: dto.titleId, accessionNos: numbers },
      });
      return { created: created.length, accessionNos: numbers };
    });
  }

  async setCopyStatus(ctx: RequestContext, copyId: string, dto: CopyStatusDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const open = await c.query(
        `SELECT 1 FROM library_loans WHERE copy_id = $1 AND returned_on IS NULL`,
        [copyId],
      );
      if (open.rowCount)
        throw new DomainError(
          'library.copy_on_loan',
          'Return the copy before changing its status',
          { status: 409 },
        );
      const sold = await c.query(`SELECT 1 FROM library_copies WHERE id = $1 AND status = 'sold'`, [
        copyId,
      ]);
      if (sold.rowCount)
        throw new DomainError(
          'library.copy_sold',
          'A sold copy leaves the register; accession a new one instead',
          {
            status: 409,
          },
        );
      const r = await c.query(
        `UPDATE library_copies SET status = $2::library_copy_status, remarks = COALESCE($3, remarks), updated_at = now() WHERE id = $1`,
        [copyId, dto.status, dto.remarks ?? null],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Copy not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'library.copy.status',
        entityType: 'library_copies',
        entityId: copyId,
        after: dto,
      });
      return { ok: true };
    });
  }

  // ---- circulation -------------------------------------------------------------------------------
  private async copyByAccession(c: PoolClient, accessionNo: string) {
    const r = await c.query<{ id: string; status: string; is_reference: boolean; title: string }>(
      `SELECT c.id::text, c.status::text, t.is_reference, t.title FROM library_copies c JOIN library_titles t ON t.id = c.title_id WHERE c.accession_no = $1`,
      [accessionNo],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', `No copy with accession number ${accessionNo}`, {
        status: 404,
      });
    return r.rows[0];
  }

  async issue(ctx: RequestContext, dto: IssueDto): Promise<LoanRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const copy = await this.copyByAccession(c, dto.accessionNo);
      if (copy.is_reference)
        throw new DomainError('library.reference_only', 'Reference copies are not issued', {
          status: 409,
        });
      if (copy.status !== 'available')
        throw new DomainError('library.copy_unavailable', `The copy is ${copy.status}`, {
          status: 409,
        });
      const borrower = await c.query(
        dto.borrowerKind === 'student'
          ? `SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`
          : `SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [dto.borrowerId],
      );
      if (!borrower.rowCount)
        throw new DomainError('not-found', 'Borrower not found', { status: 404 });
      const maxLoans = await this.setting(c, 'library.max_loans', 2);
      const open = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM library_loans WHERE borrower_kind = $1::library_borrower AND borrower_id = $2 AND returned_on IS NULL`,
        [dto.borrowerKind, dto.borrowerId],
      );
      if (Number(open.rows[0]!.n) >= maxLoans)
        throw new DomainError('library.limit', `The borrower already holds ${maxLoans} copies`, {
          status: 409,
        });
      const unpaid = await c.query<{ n: string }>(
        `SELECT COALESCE(sum(fine_amount - fine_waived), 0)::text AS n FROM library_loans WHERE borrower_kind = $1::library_borrower AND borrower_id = $2 AND fine_amount > fine_waived AND fine_paid_on IS NULL`,
        [dto.borrowerKind, dto.borrowerId],
      );
      if (Number(unpaid.rows[0]!.n) > 0)
        throw new DomainError(
          'library.fine_pending',
          `Fines of ₹${unpaid.rows[0]!.n} are pending`,
          { status: 409 },
        );
      const loanDays = await this.setting(c, 'library.loan_days', 14);
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_loans (school_id, copy_id, borrower_kind, borrower_id, due_on, issued_by, note, request_id)
         VALUES (app.current_school_id(), $1, $2::library_borrower, $3, COALESCE($4::date, CURRENT_DATE + make_interval(days => $5)::interval), app.current_user_id(), $6, app.current_request_id())
         RETURNING id::text`,
        [copy.id, dto.borrowerKind, dto.borrowerId, dto.dueOn ?? null, loanDays, dto.note ?? null],
      );
      await c.query(
        `UPDATE library_copies SET status = 'issued', updated_at = now() WHERE id = $1`,
        [copy.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.issue',
        entityType: 'library_loans',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return (await this.loan(c, r.rows[0]!.id))!;
    });
  }

  async renew(ctx: RequestContext, dto: RenewDto): Promise<LoanRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const copy = await this.copyByAccession(c, dto.accessionNo);
      const l = await c.query<{ id: string; renewed: number; due_on: string }>(
        `SELECT id::text, renewed, due_on::text FROM library_loans WHERE copy_id = $1 AND returned_on IS NULL FOR UPDATE`,
        [copy.id],
      );
      if (!l.rows[0])
        throw new DomainError('library.not_on_loan', 'The copy is not on loan', { status: 409 });
      if (l.rows[0].renewed >= 2)
        throw new DomainError('library.renew_limit', 'Renewed twice already', { status: 409 });
      const loanDays = await this.setting(c, 'library.loan_days', 14);
      await c.query(
        `UPDATE library_loans SET due_on = GREATEST(due_on, CURRENT_DATE) + make_interval(days => $2)::interval, renewed = renewed + 1, updated_at = now() WHERE id = $1`,
        [l.rows[0].id, loanDays],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.renew',
        entityType: 'library_loans',
        entityId: l.rows[0].id,
      });
      return (await this.loan(c, l.rows[0].id))!;
    });
  }

  async returnCopy(ctx: RequestContext, dto: ReturnDto): Promise<LoanRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const copy = await this.copyByAccession(c, dto.accessionNo);
      const l = await c.query<{ id: string; due_on: string }>(
        `SELECT id::text, due_on::text FROM library_loans WHERE copy_id = $1 AND returned_on IS NULL FOR UPDATE`,
        [copy.id],
      );
      if (!l.rows[0])
        throw new DomainError('library.not_on_loan', 'The copy is not on loan', { status: 409 });
      const finePerDay = await this.setting(c, 'library.fine_per_day', 2);
      await c.query(
        `UPDATE library_loans SET returned_on = COALESCE($2::date, CURRENT_DATE), returned_by = app.current_user_id(),
                fine_amount = GREATEST(0, (COALESCE($2::date, CURRENT_DATE) - due_on)) * $3::numeric,
                fine_waived = CASE WHEN $4::boolean THEN GREATEST(0, (COALESCE($2::date, CURRENT_DATE) - due_on)) * $3::numeric ELSE 0 END,
                note = COALESCE($5, note), updated_at = now()
          WHERE id = $1`,
        [l.rows[0].id, dto.returnedOn ?? null, finePerDay, dto.waiveFine, dto.note ?? null],
      );
      await c.query(
        `UPDATE library_copies SET status = $2::library_copy_status, updated_at = now() WHERE id = $1`,
        [copy.id, dto.condition],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.return',
        entityType: 'library_loans',
        entityId: l.rows[0].id,
        after: dto,
      });
      return (await this.loan(c, l.rows[0].id))!;
    });
  }

  async fine(ctx: RequestContext, loanId: string, dto: FineDto): Promise<LoanRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = await c.query<{
        fine_amount: string;
        fine_waived: string;
        fine_paid_on: string | null;
      }>(
        `SELECT fine_amount::text, fine_waived::text, fine_paid_on::text FROM library_loans WHERE id = $1 FOR UPDATE`,
        [loanId],
      );
      if (!l.rows[0]) throw new DomainError('not-found', 'Loan not found', { status: 404 });
      const outstanding = Number(l.rows[0].fine_amount) - Number(l.rows[0].fine_waived);
      if (outstanding <= 0 || l.rows[0].fine_paid_on)
        throw new DomainError('library.no_fine', 'Nothing outstanding on this loan', {
          status: 409,
        });
      if (dto.action === 'waive') {
        const amount = Math.min(dto.amount ?? outstanding, outstanding);
        await c.query(
          `UPDATE library_loans SET fine_waived = fine_waived + $2, note = COALESCE($3, note), updated_at = now() WHERE id = $1`,
          [loanId, amount, dto.note ?? null],
        );
      } else {
        await c.query(
          `UPDATE library_loans SET fine_paid_on = CURRENT_DATE, note = COALESCE($2, note), updated_at = now() WHERE id = $1`,
          [loanId, dto.reference ? `paid · ${dto.reference}` : (dto.note ?? null)],
        );
      }
      await this.audit.stage(ctx, c, {
        action: `library.fine.${dto.action}`,
        entityType: 'library_loans',
        entityId: loanId,
        after: dto,
      });
      return (await this.loan(c, loanId))!;
    });
  }

  async loans(ctx: RequestContext, q: LoansQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.status === 'open') where.push('l.returned_on IS NULL');
      if (q.status === 'overdue') where.push('l.returned_on IS NULL AND l.due_on < CURRENT_DATE');
      if (q.status === 'returned') where.push('l.returned_on IS NOT NULL');
      if (q.status === 'fines')
        where.push('l.fine_amount > l.fine_waived AND l.fine_paid_on IS NULL');
      if (q.borrowerKind && q.borrowerId) {
        params.push(q.borrowerKind, q.borrowerId);
        where.push(
          `l.borrower_kind = $${params.length - 1}::library_borrower AND l.borrower_id = $${params.length}`,
        );
      }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(
          `(t.title ILIKE $${params.length} OR c.accession_no ILIKE $${params.length} OR s.display_name ILIKE $${params.length} OR e.display_name ILIKE $${params.length} OR s.admission_no ILIKE $${params.length})`,
        );
      }
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- LOAN_SELECT and the fragments are constants; values are bound
        `${LOAN_SELECT.replace('SELECT l.id::text', 'SELECT count(*) OVER () AS total, l.id::text')}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
         ORDER BY l.returned_on IS NOT NULL, l.due_on, l.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: r.rows.map(toLoan),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
      };
    });
  }

  /** A family's children's loans. */
  async mine(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'library.family.view');
    if (v.kind !== 'family') return { children: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const children = [];
      for (const s of v.students) {
        const r = await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- LOAN_SELECT is a constant; values are bound
          `${LOAN_SELECT} WHERE l.borrower_kind = 'student' AND l.borrower_id = $1 ORDER BY l.returned_on IS NOT NULL, l.due_on DESC LIMIT 50`,
          [s.id],
        );
        children.push({ student: { id: s.id, name: s.name }, loans: r.rows.map(toLoan) });
      }
      return { children };
    });
  }

  private async loan(c: PoolClient, id: string): Promise<LoanRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- LOAN_SELECT is a constant; values are bound
    const r = await c.query<Record<string, unknown>>(`${LOAN_SELECT} WHERE l.id = $1`, [id]);
    return r.rows[0] ? toLoan(r.rows[0]) : null;
  }

  // ---- Sprint 18: sale --------------------------------------------------------------------------
  /** Sells a withdrawn or damaged copy (old stock, duplicates): the copy becomes `sold`. */
  async sell(ctx: RequestContext, dto: SaleDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const copy = await this.copyByAccession(c, dto.accessionNo);
      if (!['withdrawn', 'damaged', 'available'].includes(copy.status))
        throw new DomainError('library.copy_unavailable', `The copy is ${copy.status}`, {
          status: 409,
        });
      if (copy.status === 'available' && copy.is_reference)
        throw new DomainError('library.reference_only', 'Reference copies are not sold', {
          status: 409,
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_sales (school_id, copy_id, buyer_kind, buyer_id, buyer_name, price, receipt_ref, sold_by, note)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), $7) RETURNING id::text`,
        [
          copy.id,
          dto.buyerKind,
          dto.buyerId ?? null,
          dto.buyerName ?? null,
          dto.price,
          dto.receiptRef ?? null,
          dto.note ?? null,
        ],
      );
      await c.query(`UPDATE library_copies SET status = 'sold', updated_at = now() WHERE id = $1`, [
        copy.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'library.sale',
        entityType: 'library_sales',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return {
        id: r.rows[0]!.id,
        accessionNo: dto.accessionNo,
        title: copy.title,
        price: dto.price,
      };
    });
  }

  async sales(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT s.id::text, c.accession_no, t.title, s.buyer_kind, COALESCE(s.buyer_name, st.display_name, e.display_name) AS buyer, s.price::text, s.receipt_ref, s.sold_on::text, u.display_name AS sold_by
           FROM library_sales s JOIN library_copies c ON c.id = s.copy_id JOIN library_titles t ON t.id = c.title_id
           LEFT JOIN students st ON s.buyer_kind = 'student' AND st.id = s.buyer_id
           LEFT JOIN employees e ON s.buyer_kind = 'employee' AND e.id = s.buyer_id
           LEFT JOIN users u ON u.id = s.sold_by
          ORDER BY s.sold_on DESC, s.id DESC LIMIT 200`,
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        accessionNo: String(x.accession_no),
        title: String(x.title),
        buyerKind: String(x.buyer_kind),
        buyer: (x.buyer as string | null) ?? null,
        price: String(x.price),
        receiptRef: (x.receipt_ref as string | null) ?? null,
        soldOn: String(x.sold_on),
        soldBy: (x.sold_by as string | null) ?? null,
      }));
    });
  }

  // ---- Sprint 18: digital library --------------------------------------------------------------
  /** Items the caller may open: staff see everything active; families see 'everyone' and 'students'. */
  async digital(ctx: RequestContext, permission: string) {
    const v = await this.viewer.resolve(ctx, permission);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT d.id::text, d.code, d.title, d.author, d.kind, d.url, d.file_id::text, d.category, d.audience, d.band::text, d.description
           FROM library_digital_items d
          WHERE d.status = 'active' AND ($1::boolean OR d.audience IN ('everyone', 'students'))
          ORDER BY d.category NULLS LAST, d.title`,
        [v.kind === 'staff'],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        code: String(x.code),
        title: String(x.title),
        author: (x.author as string | null) ?? null,
        kind: String(x.kind),
        url: (x.url as string | null) ?? null,
        fileId: (x.file_id as string | null) ?? null,
        category: (x.category as string | null) ?? null,
        audience: String(x.audience),
        band: (x.band as string | null) ?? null,
        description: (x.description as string | null) ?? null,
      }));
    });
  }

  // ---- Sprint 18: stock verification -------------------------------------------------------------
  async startStockCheck(ctx: RequestContext, dto: StockCheckStartDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const open = await c.query(`SELECT 1 FROM library_stock_checks WHERE status = 'open'`);
      if (open.rowCount)
        throw new DomainError(
          'library.check_open',
          'A stock check is already open; close it first',
          { status: 409 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_stock_checks (school_id, name, started_by, note) VALUES (app.current_school_id(), $1, app.current_user_id(), $2) RETURNING id::text`,
        [dto.name, dto.note ?? null],
      );
      const id = r.rows[0]!.id;
      // every copy that should be on the shelves (issued copies count as accounted for)
      await c.query(
        `INSERT INTO library_stock_check_items (school_id, check_id, copy_id, outcome)
         SELECT app.current_school_id(), $1, c.id, CASE WHEN c.status = 'issued' THEN 'on_loan' ELSE 'pending' END
           FROM library_copies c WHERE c.status IN ('available', 'issued', 'damaged')`,
        [id],
      );
      await c.query(
        `UPDATE library_stock_checks SET expected = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1) WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.stock.start',
        entityType: 'library_stock_checks',
        entityId: id,
        after: dto,
      });
      return this.stockCheck(c, id);
    });
  }

  async scanStockCheck(ctx: RequestContext, id: string, dto: StockCheckScanDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const chk = await c.query<{ status: string }>(
        `SELECT status FROM library_stock_checks WHERE id = $1`,
        [id],
      );
      if (!chk.rows[0])
        throw new DomainError('not-found', 'Stock check not found', { status: 404 });
      if (chk.rows[0].status !== 'open')
        throw new DomainError('conflict', 'The stock check is closed', { status: 409 });
      const r = await c.query<{ n: string }>(
        `WITH hit AS (
           UPDATE library_stock_check_items i SET outcome = 'found', found_on = CURRENT_DATE
             FROM library_copies c WHERE i.copy_id = c.id AND i.check_id = $1 AND c.accession_no = ANY($2::text[]) AND i.outcome <> 'found'
           RETURNING i.copy_id)
         UPDATE library_copies c SET last_verified_on = CURRENT_DATE, updated_at = now() FROM hit WHERE c.id = hit.copy_id
         RETURNING 1 AS n`,
        [id, dto.accessionNos],
      );
      const unknown = await c.query<{ no: string }>(
        `SELECT x.no FROM unnest($1::text[]) AS x(no) WHERE NOT EXISTS (SELECT 1 FROM library_copies c WHERE c.accession_no = x.no)`,
        [dto.accessionNos],
      );
      await c.query(
        `UPDATE library_stock_checks SET found = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'found') WHERE id = $1`,
        [id],
      );
      return {
        ...(await this.stockCheck(c, id)),
        scanned: dto.accessionNos.length,
        marked: r.rowCount ?? 0,
        unknown: unknown.rows.map((x) => x.no),
      };
    });
  }

  async closeStockCheck(ctx: RequestContext, id: string, dto: StockCheckCloseDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const chk = await c.query<{ status: string }>(
        `SELECT status FROM library_stock_checks WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!chk.rows[0])
        throw new DomainError('not-found', 'Stock check not found', { status: 404 });
      if (chk.rows[0].status !== 'open')
        throw new DomainError('conflict', 'The stock check is closed', { status: 409 });
      await c.query(
        `UPDATE library_stock_check_items SET outcome = 'missing' WHERE check_id = $1 AND outcome = 'pending'`,
        [id],
      );
      if (dto.markMissingLost)
        await c.query(
          `UPDATE library_copies c SET status = 'lost', remarks = COALESCE(c.remarks || ' · ', '') || 'missing at stock check', updated_at = now()
             FROM library_stock_check_items i WHERE i.copy_id = c.id AND i.check_id = $1 AND i.outcome = 'missing'`,
          [id],
        );
      await c.query(
        `UPDATE library_stock_checks SET status = 'closed', finished_on = CURRENT_DATE, closed_by = app.current_user_id(), note = COALESCE($2, note),
                found = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'found'),
                missing = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'missing')
          WHERE id = $1`,
        [id, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.stock.close',
        entityType: 'library_stock_checks',
        entityId: id,
        after: dto,
      });
      return this.stockCheck(c, id);
    });
  }

  async stockChecks(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM library_stock_checks ORDER BY started_on DESC, id DESC LIMIT 20`,
      );
      const out = [];
      for (const x of r.rows) out.push(await this.stockCheck(c, x.id));
      return out;
    });
  }

  private async stockCheck(c: PoolClient, id: string) {
    const r = await c.query<Record<string, unknown>>(
      `SELECT s.id::text, s.name, s.started_on::text, s.finished_on::text, s.status, s.expected, s.found, s.missing, s.note,
              (SELECT jsonb_agg(jsonb_build_object('accessionNo', c.accession_no, 'title', t.title, 'outcome', i.outcome) ORDER BY c.accession_no)
                 FROM library_stock_check_items i JOIN library_copies c ON c.id = i.copy_id JOIN library_titles t ON t.id = c.title_id
                WHERE i.check_id = s.id AND i.outcome IN ('pending', 'missing')) AS open_items
         FROM library_stock_checks s WHERE s.id = $1`,
      [id],
    );
    const x = r.rows[0]!;
    return {
      id: String(x.id),
      name: String(x.name),
      startedOn: String(x.started_on),
      finishedOn: (x.finished_on as string | null) ?? null,
      status: String(x.status),
      expected: Number(x.expected),
      found: Number(x.found),
      missing: Number(x.missing),
      note: (x.note as string | null) ?? null,
      openItems:
        (x.open_items as Array<{ accessionNo: string; title: string; outcome: string }>) ?? [],
    };
  }
}
