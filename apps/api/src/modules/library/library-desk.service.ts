import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { DeskBookDto, DeskClassDto, DeskIssueDto, DeskReturnDto } from './library.dto';
import { LibraryService, type LoanRow } from './library.service';

type Kind = 'student' | 'employee';
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;

export interface DeskBorrower {
  kind: Kind;
  id: string;
  name: string;
  ref: string;
  /** a pupil's class and section, a staff member's designation */
  place: string | null;
  rollNo: number | null;
  photoFileId: string | null;
  active: boolean;
  rule: { label: string; maxBooks: number; loanDays: number };
  holding: number;
  finesDue: number;
  chargesDue: number;
  /** why no book can be issued now, if none can */
  blocked: string | null;
  loans: LoanRow[];
}

/**
 * The circulation desk (docs/design/36-library.md, "The circulation desk"): a borrower found by admission
 * number, employee code or name with what they may borrow and owe; a book found by its number (an old
 * one too) with what stands in the way of issuing it or what returning it costs; several books issued
 * to one borrower at once (all or none, one due date for the batch if given); several returned at once;
 * the books a class holds.
 */
@Injectable()
export class LibraryDeskService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly library: LibraryService,
  ) {}

  private async borrowerIn(c: PoolClient, kind: Kind, id: string): Promise<DeskBorrower> {
    const r = await c.query<{
      name: string;
      ref: string;
      place: string | null;
      roll_no: number | null;
      photo: string | null;
      active: boolean;
    }>(
      kind === 'student'
        ? `SELECT s.display_name AS name, s.admission_no AS ref, s.photo_file_id::text AS photo,
                  (s.status::text = 'active') AS active, en.roll_no,
                  (SELECT k.name || '-' || cs.name FROM class_sections cs JOIN classes k ON k.id = cs.class_id
                    WHERE cs.id = en.class_section_id) AS place
             FROM students s
             LEFT JOIN LATERAL (SELECT e.class_section_id, e.roll_no FROM enrolments e
                                 WHERE e.student_id = s.id AND e.status = 'active'
                                 ORDER BY (e.academic_year_id = app.current_academic_year_id()) DESC NULLS LAST, e.id DESC LIMIT 1) en ON true
            WHERE s.id = $1 AND s.deleted_at IS NULL`
        : `SELECT e.display_name AS name, e.employee_code AS ref, e.photo_file_id::text AS photo,
                  (e.status::text = 'active') AS active, NULL::int AS roll_no,
                  concat_ws(' · ', NULLIF(e.designation, ''), NULLIF(e.department, '')) AS place
             FROM employees e WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Borrower not found', { status: 404 });
    const rule = await this.library.ruleFor(c, kind, id);
    const owed = await c.query<{ fines: string; charges: string }>(
      `SELECT COALESCE((SELECT sum(fine_amount - fine_waived) FROM library_loans
                         WHERE borrower_kind = $1::library_borrower AND borrower_id = $2
                           AND fine_amount > fine_waived AND fine_paid_on IS NULL), 0)::text AS fines,
              app.library_charges_due($1::library_borrower, $2)::text AS charges`,
      [kind, id],
    );
    const loans = (await this.library.loansOf(c, kind, id)).sort((a, b) =>
      a.dueOn.localeCompare(b.dueOn),
    );
    const finesDue = round(Number(owed.rows[0]!.fines));
    const chargesDue = round(Number(owed.rows[0]!.charges));
    const blocked = !x.active
      ? kind === 'student'
        ? 'The pupil is not active'
        : 'The staff member is not active'
      : rule.maxBooks === 0
        ? `Borrowing is not allowed (${rule.label}: 0 books)`
        : finesDue > 0
          ? `₹${finesDue.toFixed(2)} of fines to pay first`
          : chargesDue > 0
            ? `₹${chargesDue.toFixed(2)} for a lost or damaged book to pay at the fees counter first`
            : loans.length >= rule.maxBooks
              ? `Already holds ${String(loans.length)} of ${String(rule.maxBooks)} books`
              : null;
    return {
      kind,
      id,
      name: x.name,
      ref: x.ref,
      place: x.place || null,
      rollNo: x.roll_no,
      photoFileId: x.photo,
      active: x.active,
      rule: { label: rule.label, maxBooks: rule.maxBooks, loanDays: rule.loanDays },
      holding: loans.length,
      finesDue,
      chargesDue,
      blocked,
      loans,
    };
  }

  /**
   * A borrower by admission number or employee code (exact, any case), else the pupils and staff whose
   * name has what was typed.
   */
  async findBorrower(ctx: RequestContext, q: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const term = q.trim();
      const exact = await c.query<{ kind: Kind; id: string }>(
        `SELECT 'student' AS kind, id::text FROM students WHERE deleted_at IS NULL AND upper(admission_no) = upper($1)
         UNION ALL
         SELECT 'employee', id::text FROM employees WHERE deleted_at IS NULL AND upper(employee_code) = upper($1)`,
        [term],
      );
      if (exact.rows.length === 1)
        return {
          borrower: await this.borrowerIn(c, exact.rows[0]!.kind, exact.rows[0]!.id),
          matches: [],
        };
      const like = `%${term.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      const r = await c.query<{
        kind: Kind;
        id: string;
        name: string;
        ref: string;
        place: string | null;
      }>(
        `(SELECT 'student' AS kind, s.id::text, s.display_name AS name, s.admission_no AS ref,
                 (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                    JOIN classes k ON k.id = cs.class_id WHERE e.student_id = s.id AND e.status = 'active'
                   ORDER BY e.id DESC LIMIT 1) AS place
            FROM students s WHERE s.deleted_at IS NULL AND s.status::text = 'active'
             AND (s.display_name ILIKE $1 OR s.admission_no ILIKE $1)
           ORDER BY s.display_name LIMIT 15)
         UNION ALL
         (SELECT 'employee', e.id::text, e.display_name, e.employee_code, NULLIF(e.designation, '')
            FROM employees e WHERE e.deleted_at IS NULL AND e.status::text = 'active'
             AND (e.display_name ILIKE $1 OR e.employee_code ILIKE $1)
           ORDER BY e.display_name LIMIT 15)`,
        [like],
      );
      return { borrower: null, matches: r.rows };
    });
  }

  async borrower(ctx: RequestContext, kind: Kind, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.borrowerIn(c, kind, id));
  }

  /**
   * A book by its number (an old one too). For issue: the copy and what stands in the way; for return:
   * its open loan with the borrower and the late fine to today.
   */
  async book(ctx: RequestContext, dto: DeskBookDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        accession_no: string;
        status: string;
        title: string;
        author: string | null;
        subject: string | null;
        material: string | null;
        not_issued: boolean;
        library: string;
      }>(
        `SELECT x.id::text, x.accession_no, x.status::text, t.title, t.author, s.name::text AS subject, m.name AS material,
                (t.is_reference OR NOT COALESCE(m.issuable, true)) AS not_issued, l.name AS library
           FROM library_copies x JOIN library_titles t ON t.id = x.title_id JOIN library_libraries l ON l.id = x.library_id
           LEFT JOIN library_subjects s ON s.id = t.subject_id LEFT JOIN library_material_types m ON m.id = t.material_type_id
          WHERE x.id = app.library_copy_by_number($1)`,
        [dto.accessionNo],
      );
      const x = r.rows[0];
      if (!x)
        throw new DomainError('not-found', `No book has the number ${dto.accessionNo}`, {
          status: 404,
        });
      const book = {
        copyId: x.id,
        accessionNo: x.accession_no,
        title: x.title,
        author: x.author,
        subject: x.subject,
        material: x.material,
        library: x.library,
        status: x.status,
        // the number typed was an old one: the copy's own now
        formerly:
          x.accession_no.toUpperCase() !== dto.accessionNo.trim().toUpperCase()
            ? dto.accessionNo.trim()
            : null,
      };
      const open = await c.query<{ id: string }>(
        `SELECT id::text FROM library_loans WHERE copy_id = $1 AND returned_on IS NULL`,
        [x.id],
      );
      const loan = open.rows[0] ? await this.library.loan(c, open.rows[0].id) : null;
      if (dto.for === 'issue') {
        const problem = x.not_issued
          ? 'Reference only: read in the library, not issued'
          : loan
            ? `On loan to ${loan.borrower} (${loan.borrowerRef}) till ${loan.dueOn}`
            : x.status !== 'available'
              ? `The copy is ${x.status}`
              : null;
        return { book, problem, loan: null, fine: 0 };
      }
      if (!loan) return { book, problem: 'The book is not on loan', loan: null, fine: 0 };
      const rule = await this.library.ruleFor(c, loan.borrowerKind as Kind, loan.borrowerId);
      const late = Math.max(
        0,
        Math.round((Date.parse(today()) - Date.parse(loan.dueOn)) / 86_400_000),
      );
      const fine = round(
        Math.min(Math.max(0, late - rule.graceDays) * rule.finePerDay, rule.maxFine ?? Infinity),
      );
      const who = await this.borrowerIn(c, loan.borrowerKind as Kind, loan.borrowerId);
      return {
        book,
        problem: null,
        loan: {
          ...loan,
          place: who.place,
          rollNo: who.rollNo,
          renewalsLeft: rule.renewals - loan.renewed,
        },
        fine,
      };
    });
  }

  /** Several books issued to one borrower, all or none; each failure names its book. */
  async issueMany(ctx: RequestContext, dto: DeskIssueDto) {
    const seen = new Set<string>();
    for (const a of dto.accessionNos) {
      const k = a.trim().toUpperCase();
      if (seen.has(k))
        throw new DomainError('validation-failed', `${a} is in the list twice`, { status: 400 });
      seen.add(k);
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const loans: LoanRow[] = [];
      for (const accessionNo of dto.accessionNos) {
        try {
          loans.push(
            await this.library.issueIn(c, ctx, {
              accessionNo,
              borrowerKind: dto.borrowerKind,
              borrowerId: dto.borrowerId,
              dueOn: dto.dueOn,
            }),
          );
        } catch (error) {
          if (error instanceof DomainError)
            throw new DomainError(
              error.type,
              `${accessionNo}: ${error.message} — nothing was issued`,
              {
                status: error.status,
              },
            );
          throw error;
        }
      }
      return { loans };
    });
  }

  /** Several books returned in good condition, all or none; each with its late fine. */
  async returnMany(ctx: RequestContext, dto: DeskReturnDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const loans: LoanRow[] = [];
      for (const accessionNo of dto.accessionNos) {
        try {
          loans.push(
            await this.library.returnIn(c, ctx, {
              accessionNo,
              returnedOn: dto.returnedOn,
              condition: 'available',
              waiveFine: false,
            }),
          );
        } catch (error) {
          if (error instanceof DomainError)
            throw new DomainError(
              error.type,
              `${accessionNo}: ${error.message} — nothing was returned`,
              {
                status: error.status,
              },
            );
          throw error;
        }
      }
      const fines = round(
        loans.reduce((n, l) => n + Number(l.fineAmount) - Number(l.fineWaived), 0),
      );
      return { loans, fines };
    });
  }

  /** The classes and sections of the working year, for the desk's class list. */
  async sections(ctx: RequestContext) {
    const yearId = requireTenant(ctx).academicYearId;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; class_id: string; class: string; name: string }>(
        `SELECT cs.id::text, k.id::text AS class_id, k.name AS class, cs.name
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.deleted_at IS NULL AND k.deleted_at IS NULL AND ($1::bigint IS NULL OR cs.academic_year_id = $1)
          ORDER BY k.display_order, k.code, cs.name`,
        [yearId ?? null],
      );
      const classes = new Map<
        string,
        { id: string; name: string; sections: Array<{ id: string; name: string }> }
      >();
      for (const x of r.rows) {
        const k = classes.get(x.class_id) ?? { id: x.class_id, name: x.class, sections: [] };
        k.sections.push({ id: x.id, name: x.name });
        classes.set(x.class_id, k);
      }
      return { classes: [...classes.values()] };
    });
  }

  /** The books the pupils of a class (or one section) hold now, by pupil. */
  async classLoans(ctx: RequestContext, dto: DeskClassDto) {
    const yearId = requireTenant(ctx).academicYearId;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT l.id::text, x.accession_no, x.barcode, t.title, t.author, st.id::text AS student_id, st.display_name AS student,
                st.admission_no, k.name || '-' || cs.name AS place, e.roll_no, l.issued_on::text, l.due_on::text,
                GREATEST(0, CURRENT_DATE - l.due_on)::int AS days_overdue
           FROM library_loans l
           JOIN library_copies x ON x.id = l.copy_id JOIN library_titles t ON t.id = x.title_id
           JOIN students st ON l.borrower_kind = 'student' AND st.id = l.borrower_id
           JOIN enrolments e ON e.student_id = st.id AND e.status = 'active'
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE l.returned_on IS NULL AND cs.class_id = $1 AND ($2::bigint IS NULL OR cs.id = $2)
            AND ($3::bigint IS NULL OR cs.academic_year_id = $3)
          ORDER BY cs.name, e.roll_no NULLS LAST, st.display_name, x.accession_no`,
        [dto.classId, dto.sectionId ?? null, yearId ?? null],
      );
      return {
        rows: r.rows.map((x) => ({
          loanId: String(x.id),
          accessionNo: String(x.accession_no),
          barcode: x.barcode as string | null,
          title: String(x.title),
          author: x.author as string | null,
          studentId: String(x.student_id),
          student: String(x.student),
          admissionNo: String(x.admission_no),
          place: String(x.place),
          rollNo: x.roll_no as number | null,
          issuedOn: String(x.issued_on),
          dueOn: String(x.due_on),
          daysOverdue: Number(x.days_overdue),
        })),
      };
    });
  }
}
