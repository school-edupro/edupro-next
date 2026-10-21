import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  BookListDto,
  BookMatchDto,
  CopiesDto,
  CopyEditDto,
  CopyStatusChangeDto,
  NewBookDto,
  SuggestDto,
  TitleDto,
} from './library-books.dto';
import { bookFilter, bookSort } from './library-filter';
import { LIBRARY } from './library.dto';

type Copy = CopiesDto | CopyEditDto;
/** Queries made one after another (they share one client), their results in order. */
async function sequence<T extends unknown[]>(tasks: {
  [K in keyof T]: () => Promise<T[K]>;
}): Promise<T> {
  const out: unknown[] = [];
  for (const t of tasks) out.push(await t());
  return out as T;
}
const STATUS_WORD: Record<string, string> = {
  withdrawn: 'Withdrawn',
  lost: 'Lost',
  lost_paid: 'Lost and paid',
  found: 'Found again',
  damaged: 'Damaged',
  available: 'Back in use',
};

/**
 * The book master (docs/design/36-library.md, part 2): a title entered once and linked to the set-up
 * masters, its people in order, its copies with library, shelf and rack, barcode, how each came and its
 * status with the reason; accession numbers from the series of the copy's library and the title's
 * material type (under a lock, skipping numbers taken), or typed. Every change is audited; a copy keeps
 * its history.
 */
@Injectable()
export class LibraryBooksService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private can(ctx: RequestContext) {
    return ctx.permissions?.has(LIBRARY.manage) ?? false;
  }

  // ---- reading ---------------------------------------------------------------------------------------

  /** The titles, with how many of their copies (that match) there are, on the shelf and out. */
  async list(ctx: RequestContext, q: BookListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.library_seed(app.current_school_id())`);
      const f = bookFilter(q);
      const inCopies = `x.status <> 'sold'${f.copy ? ` AND ${f.copy}` : ''}`;
      const where = f.copy
        ? // eslint-disable-next-line no-restricted-syntax -- fragments of bookFilter; values are bound
          `${f.title} AND EXISTS (SELECT 1 FROM library_copies x WHERE x.title_id = t.id AND ${inCopies})`
        : f.title;
      const size = f.arg(q.size);
      const offset = f.arg((q.page - 1) * q.size);
      const r = await c.query<{
        id: string;
        code: string;
        title: string;
        subtitle: string | null;
        author: string | null;
        material: string | null;
        subject: string | null;
        publisher: string | null;
        year: number | null;
        isbn: string | null;
        call_no: string | null;
        copies: number;
        available: number;
        issued: number;
        total: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments of bookFilter and bookSort; values are bound
        `SELECT t.id::text, t.code, t.title, t.subtitle, t.author, m.name AS material, s.name::text AS subject,
                t.publisher, t.year, t.isbn, t.call_no,
                (SELECT count(*) FROM library_copies x WHERE x.title_id = t.id AND ${inCopies} AND x.status <> 'withdrawn')::int AS copies,
                (SELECT count(*) FROM library_copies x WHERE x.title_id = t.id AND ${inCopies} AND x.status = 'available')::int AS available,
                (SELECT count(*) FROM library_copies x WHERE x.title_id = t.id AND ${inCopies} AND x.status = 'issued')::int AS issued,
                count(*) OVER () AS total
           FROM library_titles t
           LEFT JOIN library_material_types m ON m.id = t.material_type_id
           LEFT JOIN library_subjects s ON s.id = t.subject_id
          WHERE ${where}
          ORDER BY ${bookSort(q, 'title')}
          LIMIT ${size} OFFSET ${offset}`,
        f.args,
      );
      return {
        data: r.rows.map(({ total: _t, call_no, ...x }) => ({ ...x, callNo: call_no })),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
        can: { manage: this.can(ctx) },
      };
    });
  }

  /** The copies (the accession register), each with its title, place, status and who has it. */
  async register(ctx: RequestContext, q: BookListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = bookFilter(q);
      const size = f.arg(q.size);
      const offset = f.arg((q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments of bookFilter and bookSort; values are bound
        `SELECT x.id::text, x.accession_no, t.id::text AS title_id, t.title, t.author, l.name AS library,
                sh.code AS shelf, x.rack, x.barcode, x.status::text, x.accessioned_on::text, x.acquisition,
                COALESCE(x.price, t.price)::text AS price, x.last_verified_on::text,
                ln.borrower, ln.due_on::text AS due_on, count(*) OVER () AS total
           FROM library_copies x
           JOIN library_titles t ON t.id = x.title_id
           JOIN library_libraries l ON l.id = x.library_id
           LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(st.display_name, e.display_name) AS borrower, lo.due_on
               FROM library_loans lo
               LEFT JOIN students st ON lo.borrower_kind = 'student' AND st.id = lo.borrower_id
               LEFT JOIN employees e ON lo.borrower_kind = 'employee' AND e.id = lo.borrower_id
              WHERE lo.copy_id = x.id AND lo.returned_on IS NULL LIMIT 1) ln ON true
          WHERE ${f.title}${f.copy ? ` AND ${f.copy}` : ''}
          ORDER BY ${bookSort(q, 'copy')}
          LIMIT ${size} OFFSET ${offset}`,
        f.args,
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          accessionNo: String(x.accession_no),
          titleId: String(x.title_id),
          title: String(x.title),
          author: x.author as string | null,
          library: String(x.library),
          shelf: x.shelf as string | null,
          rack: x.rack as string | null,
          barcode: x.barcode as string | null,
          status: String(x.status),
          accessionedOn: String(x.accessioned_on),
          acquisition: x.acquisition as string | null,
          price: x.price as string | null,
          lastVerifiedOn: x.last_verified_on as string | null,
          borrower: x.borrower as string | null,
          dueOn: x.due_on as string | null,
        })),
        page: { number: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
        can: { manage: this.can(ctx) },
      };
    });
  }

  /** What the book form picks from, and the next accession number of each series. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.library_seed(app.current_school_id())`);
      // one after the other: a client runs one query at a time
      const q = async <T extends QueryResultRow>(sql: string) => (await c.query<T>(sql)).rows;
      const [libraries, materialTypes, subjects, languages, shelves, vendors, classes, series] =
        await sequence([
          () =>
            q<{ id: string; code: string; name: string }>(
              `SELECT id::text, code, name FROM library_libraries WHERE status = 'active' ORDER BY code`,
            ),
          () =>
            q<{ id: string; code: string; name: string; issuable: boolean }>(
              `SELECT id::text, code, name, issuable FROM library_material_types WHERE status = 'active' ORDER BY sort_order, code`,
            ),
          () =>
            q<{ id: string; name: string; classNo: string | null; subSubjects: string[] }>(
              `SELECT id::text, name::text, class_no AS "classNo", sub_subjects AS "subSubjects" FROM library_subjects WHERE status = 'active' ORDER BY name`,
            ),
          () =>
            q<{ id: string; name: string }>(
              `SELECT id::text, name::text FROM library_languages WHERE status = 'active' ORDER BY name`,
            ),
          () =>
            q<{
              id: string;
              libraryId: string;
              code: string;
              name: string | null;
              racks: string[];
            }>(
              `SELECT id::text, library_id::text AS "libraryId", code, name, racks FROM library_shelves WHERE status = 'active' ORDER BY code`,
            ),
          () =>
            q<{ id: string; code: string; name: string }>(
              `SELECT id::text, code, name FROM library_vendors WHERE status = 'active' ORDER BY name`,
            ),
          () =>
            q<{ id: string; code: string; name: string }>(
              `SELECT id::text, code, name FROM classes WHERE status = 'active' AND deleted_at IS NULL ORDER BY display_order, code`,
            ),
          () =>
            q<{ libraryId: string; materialTypeId: string; next: string }>(
              `SELECT library_id::text AS "libraryId", material_type_id::text AS "materialTypeId",
                    prefix || lpad(next_no::text, digits, '0') AS next
               FROM library_accession_series WHERE status = 'active'`,
            ),
        ]);
      return {
        libraries,
        materialTypes,
        subjects,
        languages,
        shelves,
        vendors,
        classes,
        series,
        can: { manage: this.can(ctx) },
      };
    });
  }

  /** Names to pick from as one types (authors, publishers): the set-up's, then those books already use. */
  async suggest(ctx: RequestContext, q: SuggestDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const table = q.kind === 'author' ? 'library_authors' : 'library_publishers';
      const r = await c.query<{ name: string }>(
        // eslint-disable-next-line no-restricted-syntax -- one of two fixed table names
        `SELECT name::text FROM ${table} WHERE status = 'active' AND name ILIKE $1
          ORDER BY (name ILIKE $2) DESC, name LIMIT 20`,
        [`%${q.q}%`, `${q.q}%`],
      );
      return { names: r.rows.map((x) => x.name) };
    });
  }

  /** Titles that look the same (the ISBN, or the title word for word): add copies to it instead. */
  async match(ctx: RequestContext, q: BookMatchDto) {
    const isbn = (q.isbn ?? '').replace(/[\s-]/g, '').toUpperCase();
    const title = (q.title ?? '').trim();
    if (!isbn && title.length < 3) return { data: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        title: string;
        author: string | null;
        year: number | null;
        edition: string | null;
        copies: number;
        by: string;
      }>(
        `SELECT t.id::text, t.title, t.author, t.year, t.edition,
                (SELECT count(*) FROM library_copies x WHERE x.title_id = t.id AND x.status NOT IN ('withdrawn', 'sold'))::int AS copies,
                CASE WHEN $1 <> '' AND regexp_replace(COALESCE(t.isbn, ''), '[^0-9X]', '', 'g') = $1 THEN 'isbn' ELSE 'title' END AS by
           FROM library_titles t
          WHERE t.status = 'active' AND ($3::bigint IS NULL OR t.id <> $3)
            AND (($1 <> '' AND regexp_replace(COALESCE(t.isbn, ''), '[^0-9X]', '', 'g') = $1)
                 OR ($2 <> '' AND lower(t.title) = lower($2)))
          ORDER BY t.title LIMIT 5`,
        [isbn, title, q.except ?? null],
      );
      return { data: r.rows };
    });
  }

  /** One title: its details and links, people, copies (where, how they came, status, who has it), loans, history. */
  async view(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Book not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = (
        await c.query<Record<string, unknown>>(
          `SELECT t.id::text, t.code, t.title, t.subtitle, t.material_type_id::text, m.name AS material, m.issuable,
                  t.subject_id::text, s.name::text AS subject, t.sub_subject, t.call_no, t.keywords,
                  t.class_id::text, cl.name AS class, t.publisher_id::text, t.publisher, t.publication_place,
                  t.year, t.edition, t.volume, t.pages, t.isbn, t.language_id::text, t.language, t.price::text,
                  t.is_reference, t.notes, t.location, t.status::text, t.created_at, t.updated_at
             FROM library_titles t
             LEFT JOIN library_material_types m ON m.id = t.material_type_id
             LEFT JOIN library_subjects s ON s.id = t.subject_id
             LEFT JOIN classes cl ON cl.id = t.class_id
            WHERE t.id = $1`,
          [id],
        )
      ).rows[0];
      if (!t) throw new DomainError('not-found', 'Book not found', { status: 404 });
      const people = await c.query<{ name: string; role: string }>(
        `SELECT a.name::text, ta.role FROM library_title_authors ta JOIN library_authors a ON a.id = ta.author_id
          WHERE ta.title_id = $1 ORDER BY ta.position, ta.id`,
        [id],
      );
      const copies = await c.query<Record<string, unknown>>(
        `SELECT x.id::text, x.accession_no, x.accessioned_on::text, x.library_id::text, l.code AS library_code, l.name AS library,
                x.shelf_id::text, sh.code AS shelf, sh.name AS shelf_holds, x.rack, x.barcode, x.status::text, x.status_on::text,
                x.status_reason, x.acquisition, x.vendor_id::text, v.name AS vendor, x.donor, x.bill_no, x.bill_date::text, x.po_no,
                x.price::text, x.remarks, x.last_verified_on::text,
                (SELECT jsonb_build_object('dueOn', ln.due_on::text, 'borrower', COALESCE(st.display_name, e.display_name),
                                           'ref', COALESCE(st.admission_no, e.employee_code), 'kind', ln.borrower_kind::text)
                   FROM library_loans ln LEFT JOIN students st ON ln.borrower_kind = 'student' AND st.id = ln.borrower_id
                   LEFT JOIN employees e ON ln.borrower_kind = 'employee' AND e.id = ln.borrower_id
                  WHERE ln.copy_id = x.id AND ln.returned_on IS NULL) AS loan
           FROM library_copies x
           JOIN library_libraries l ON l.id = x.library_id
           LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
           LEFT JOIN library_vendors v ON v.id = x.vendor_id
          WHERE x.title_id = $1
          ORDER BY (x.status IN ('withdrawn', 'sold')), x.accession_no`,
        [id],
      );
      const loans = await c.query<Record<string, unknown>>(
        `SELECT ln.id::text, x.accession_no, ln.borrower_kind::text AS kind,
                COALESCE(st.display_name, e.display_name) AS borrower, COALESCE(st.admission_no, e.employee_code) AS ref,
                ln.issued_on::text, ln.due_on::text, ln.returned_on::text, ln.renewed, ln.fine_amount::text, ln.fine_waived::text
           FROM library_loans ln JOIN library_copies x ON x.id = ln.copy_id
           LEFT JOIN students st ON ln.borrower_kind = 'student' AND st.id = ln.borrower_id
           LEFT JOIN employees e ON ln.borrower_kind = 'employee' AND e.id = ln.borrower_id
          WHERE x.title_id = $1 ORDER BY ln.issued_on DESC, ln.id DESC LIMIT 200`,
        [id],
      );
      const events = await c.query<Record<string, unknown>>(
        `SELECT ev.at, x.accession_no, ev.what, ev.from_status, ev.to_status, ev.on_date::text, ev.reason, ev.amount::text, ev.by_name
           FROM library_copy_events ev JOIN library_copies x ON x.id = ev.copy_id
          WHERE x.title_id = $1 ORDER BY ev.at DESC, ev.id DESC LIMIT 300`,
        [id],
      );
      return {
        id: String(t.id),
        code: String(t.code),
        title: String(t.title),
        subtitle: t.subtitle as string | null,
        people: people.rows,
        materialTypeId: t.material_type_id as string | null,
        material: t.material as string | null,
        issuable: t.issuable === null ? true : Boolean(t.issuable),
        subjectId: t.subject_id as string | null,
        subject: t.subject as string | null,
        subSubject: t.sub_subject as string | null,
        callNo: t.call_no as string | null,
        keywords: (t.keywords as string[]) ?? [],
        classId: t.class_id as string | null,
        class: t.class as string | null,
        publisher: t.publisher as string | null,
        publicationPlace: t.publication_place as string | null,
        year: t.year as number | null,
        edition: t.edition as string | null,
        volume: t.volume as string | null,
        pages: t.pages as number | null,
        isbn: t.isbn as string | null,
        languageId: t.language_id as string | null,
        language: t.language as string | null,
        price: t.price as string | null,
        isReference: Boolean(t.is_reference),
        notes: t.notes as string | null,
        oldLocation: t.location as string | null,
        status: String(t.status),
        copies: copies.rows.map((x) => ({
          id: String(x.id),
          accessionNo: String(x.accession_no),
          accessionedOn: x.accessioned_on as string,
          libraryId: String(x.library_id),
          library: `${String(x.library)} (${String(x.library_code)})`,
          shelfId: x.shelf_id as string | null,
          shelf: x.shelf
            ? `${String(x.shelf)}${x.shelf_holds ? ` · ${String(x.shelf_holds)}` : ''}`
            : null,
          rack: x.rack as string | null,
          barcode: x.barcode as string | null,
          status: String(x.status),
          statusOn: x.status_on as string | null,
          statusReason: x.status_reason as string | null,
          acquisition: x.acquisition as string | null,
          vendorId: x.vendor_id as string | null,
          vendor: x.vendor as string | null,
          donor: x.donor as string | null,
          billNo: x.bill_no as string | null,
          billDate: x.bill_date as string | null,
          poNo: x.po_no as string | null,
          price: x.price as string | null,
          remarks: x.remarks as string | null,
          lastVerifiedOn: x.last_verified_on as string | null,
          loan: x.loan as { dueOn: string; borrower: string; ref: string; kind: string } | null,
        })),
        loans: loans.rows.map((l) => ({
          id: String(l.id),
          accessionNo: String(l.accession_no),
          kind: String(l.kind),
          borrower: String(l.borrower ?? ''),
          ref: String(l.ref ?? ''),
          issuedOn: String(l.issued_on),
          dueOn: String(l.due_on),
          returnedOn: l.returned_on as string | null,
          renewed: Number(l.renewed),
          fine: Number(l.fine_amount) - Number(l.fine_waived),
        })),
        events: events.rows.map((e) => ({
          at: (e.at as Date).toISOString(),
          accessionNo: String(e.accession_no),
          what: String(e.what),
          fromStatus: e.from_status as string | null,
          toStatus: e.to_status as string | null,
          on: e.on_date as string,
          reason: e.reason as string | null,
          amount: e.amount as string | null,
          by: e.by_name as string | null,
        })),
        can: { manage: this.can(ctx) },
      };
    });
  }

  // ---- writing ---------------------------------------------------------------------------------------

  /** The title's links checked (each in this school and on); people and the publisher by name. */
  private async saveTitle(c: PoolClient, ctx: RequestContext, dto: TitleDto, id?: string) {
    const exists = async (table: string, val: string | undefined, what: string) => {
      if (!val) return;
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed table names from this method
        `SELECT 1 FROM ${table} WHERE id = $1${table === 'classes' ? '' : ` AND status = 'active'`}`,
        [val],
      );
      if (!r.rowCount)
        throw new DomainError('validation-failed', `${what}: not found or switched off`, {
          status: 400,
        });
    };
    await exists('library_material_types', dto.materialTypeId, 'Material type');
    await exists('library_subjects', dto.subjectId, 'Subject');
    await exists('library_languages', dto.languageId, 'Language');
    await exists('classes', dto.classId, 'Class');
    if (dto.subSubject && dto.subjectId) {
      const s = await c.query<{ subs: string[] }>(
        `SELECT sub_subjects AS subs FROM library_subjects WHERE id = $1`,
        [dto.subjectId],
      );
      const subs = s.rows[0]?.subs ?? [];
      if (subs.length && !subs.some((x) => x.toLowerCase() === dto.subSubject!.toLowerCase()))
        throw new DomainError(
          'validation-failed',
          `Sub-subject: pick one of the subject’s (${subs.join(', ')})`,
          { status: 400 },
        );
    }
    let publisherId: string | null = null;
    if (dto.publisher) {
      const p = await c.query<{ id: string }>(
        `INSERT INTO library_publishers (school_id, name) VALUES (app.current_school_id(), $1)
         ON CONFLICT (school_id, name) DO UPDATE SET name = library_publishers.name RETURNING id::text`,
        [dto.publisher],
      );
      publisherId = p.rows[0]!.id;
    }
    const values = [
      dto.title,
      dto.subtitle ?? null,
      dto.materialTypeId,
      dto.subjectId ?? null,
      dto.subSubject ?? null,
      dto.callNo ?? null,
      dto.keywords,
      dto.classId ?? null,
      publisherId,
      dto.publicationPlace ?? null,
      dto.year ?? null,
      dto.edition ?? null,
      dto.volume ?? null,
      dto.pages ?? null,
      dto.isbn ?? null,
      dto.languageId ?? null,
      dto.price ?? null,
      dto.isReference,
      dto.notes ?? null,
    ];
    let titleId = id;
    if (id) {
      const u = await c.query(
        `UPDATE library_titles SET title = $2, subtitle = $3, material_type_id = $4, subject_id = $5, sub_subject = $6,
                call_no = $7, keywords = $8, class_id = $9, publisher_id = $10, publication_place = $11, year = $12,
                edition = $13, volume = $14, pages = $15, isbn = $16, language_id = $17, price = $18, is_reference = $19,
                notes = $20, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, ...values],
      );
      if (!u.rowCount) throw new DomainError('not-found', 'Book not found', { status: 404 });
    } else {
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_titles (school_id, title, subtitle, material_type_id, subject_id, sub_subject, call_no, keywords,
                                     class_id, publisher_id, publication_place, year, edition, volume, pages, isbn, language_id,
                                     price, is_reference, notes, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        values,
      );
      titleId = r.rows[0]!.id;
    }
    // the people, in the order given (a name new to Authors is added there)
    await c.query(`DELETE FROM library_title_authors WHERE title_id = $1`, [titleId]);
    for (const [i, p] of dto.people.entries()) {
      const a = await c.query<{ id: string }>(
        `INSERT INTO library_authors (school_id, name) VALUES (app.current_school_id(), $1)
         ON CONFLICT (school_id, name) DO UPDATE SET name = library_authors.name RETURNING id::text`,
        [p.name],
      );
      await c.query(
        `INSERT INTO library_title_authors (school_id, title_id, author_id, role, position)
         VALUES (app.current_school_id(), $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [titleId, a.rows[0]!.id, p.role, i + 1],
      );
    }
    // the names the other screens show and search
    await c.query(
      `UPDATE library_titles t SET
          author = (SELECT string_agg(a.name::text, ', ' ORDER BY ta.position) FROM library_title_authors ta
                      JOIN library_authors a ON a.id = ta.author_id WHERE ta.title_id = t.id AND ta.role = 'Author'),
          publisher = (SELECT name::text FROM library_publishers WHERE id = t.publisher_id),
          language = (SELECT name::text FROM library_languages WHERE id = t.language_id),
          category = (SELECT name::text FROM library_subjects WHERE id = t.subject_id)
        WHERE t.id = $1`,
      [titleId],
    );
    await this.audit.stage(ctx, c, {
      action: id ? 'library.title.update' : 'library.title.create',
      entityType: 'library_titles',
      entityId: titleId!,
      after: dto,
    });
    return titleId!;
  }

  /** A copy's place and source checked: the shelf of its library, a rack of that shelf, a vendor that is on. */
  private async checkCopy(c: PoolClient, dto: Copy) {
    const lib = await c.query(
      `SELECT 1 FROM library_libraries WHERE id = $1 AND status = 'active'`,
      [dto.libraryId],
    );
    if (!lib.rowCount)
      throw new DomainError('validation-failed', 'Library: not found or switched off', {
        status: 400,
      });
    if (dto.shelfId) {
      const s = await c.query<{ library_id: string; racks: string[] }>(
        `SELECT library_id::text, racks FROM library_shelves WHERE id = $1 AND status = 'active'`,
        [dto.shelfId],
      );
      if (!s.rows[0] || s.rows[0].library_id !== dto.libraryId)
        throw new DomainError('validation-failed', 'Shelf: not a shelf of this library', {
          status: 400,
        });
      const racks = s.rows[0].racks;
      if (dto.rack && racks.length && !racks.includes(dto.rack))
        throw new DomainError('validation-failed', `Rack: one of ${racks.join(', ')}`, {
          status: 400,
        });
    } else if (dto.rack)
      throw new DomainError('validation-failed', 'Rack: pick the shelf first', { status: 400 });
    if (dto.vendorId) {
      const v = await c.query(`SELECT 1 FROM library_vendors WHERE id = $1 AND status = 'active'`, [
        dto.vendorId,
      ]);
      if (!v.rowCount)
        throw new DomainError('validation-failed', 'Vendor: not found or switched off', {
          status: 400,
        });
    }
    if (dto.acquisition !== 'Purchase' && (dto.vendorId || dto.billNo || dto.billDate || dto.poNo))
      throw new DomainError('validation-failed', 'Vendor and bill: for a purchase only', {
        status: 400,
      });
    if (dto.acquisition !== 'Donation' && dto.donor)
      throw new DomainError('validation-failed', 'Donor: for a donation only', { status: 400 });
    if (dto.billDate && dto.accessionedOn && dto.billDate > dto.accessionedOn)
      throw new DomainError('validation-failed', 'Bill date: on or before the date of accession', {
        status: 400,
      });
  }

  private async event(
    c: PoolClient,
    ctx: RequestContext,
    copyId: string,
    what: string,
    more: {
      from?: string;
      to?: string;
      on?: string;
      reason?: string | null;
      amount?: number | null;
    } = {},
  ) {
    await c.query(
      `INSERT INTO library_copy_events (school_id, copy_id, what, from_status, to_status, on_date, reason, amount, by_user, by_name)
       VALUES (app.current_school_id(), $1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, app.current_user_id(), $8)`,
      [
        copyId,
        what,
        more.from ?? null,
        more.to ?? null,
        more.on ?? null,
        more.reason ?? null,
        more.amount ?? null,
        ctx.user.displayName,
      ],
    );
  }

  /** New copies of a title: the numbers typed, or the next ones of the series of the library and type. */
  private async addCopies(c: PoolClient, ctx: RequestContext, titleId: string, dto: CopiesDto) {
    await this.checkCopy(c, dto);
    const typed = dto.accessionNos ? [...new Set(dto.accessionNos)] : null;
    if (typed && typed.length !== dto.accessionNos!.length)
      throw new DomainError('validation-failed', 'Accession numbers: each one once', {
        status: 400,
      });
    const count = typed?.length ?? dto.count;
    if (dto.barcode && count > 1)
      throw new DomainError('validation-failed', 'Barcode: for one copy at a time', {
        status: 400,
      });
    let numbers: string[];
    if (typed) {
      const taken = await c.query<{ accession_no: string }>(
        `SELECT accession_no FROM library_copies WHERE accession_no = ANY($1::text[])`,
        [typed],
      );
      if (taken.rowCount)
        throw new DomainError(
          'library.accession_taken',
          `Accession number already used: ${taken.rows.map((x) => x.accession_no).join(', ')}`,
          { status: 409 },
        );
      numbers = typed;
    } else {
      const s = await c.query<{ id: string }>(
        `SELECT s.id::text FROM library_accession_series s JOIN library_titles t ON t.material_type_id = s.material_type_id
          WHERE t.id = $1 AND s.library_id = $2 AND s.status = 'active'`,
        [titleId, dto.libraryId],
      );
      if (!s.rows[0])
        throw new DomainError(
          'library.no_series',
          'No accession series for this library and material type: add one in Library setup → Accession numbers, or type the numbers',
          { status: 409 },
        );
      numbers = (
        await c.query<{ n: string[] }>(`SELECT app.library_take_accessions($1, $2) AS n`, [
          s.rows[0].id,
          count,
        ])
      ).rows[0]!.n;
    }
    const price =
      dto.price ??
      (
        await c.query<{ p: string | null }>(
          `SELECT price::text AS p FROM library_titles WHERE id = $1`,
          [titleId],
        )
      ).rows[0]?.p ??
      null;
    for (const no of numbers) {
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO library_copies (school_id, title_id, accession_no, accessioned_on, library_id, shelf_id, rack, barcode,
                                       acquisition, source, vendor_id, donor, bill_no, bill_date, po_no, price, remarks,
                                       created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, lower($8), $9, $10, $11,
                   $12, $13, $14, $15, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            titleId,
            no,
            dto.accessionedOn ?? null,
            dto.libraryId,
            dto.shelfId ?? null,
            dto.rack ?? null,
            dto.barcode ?? null,
            dto.acquisition ?? null,
            dto.vendorId ?? null,
            dto.donor ?? null,
            dto.billNo ?? null,
            dto.billDate ?? null,
            dto.poNo ?? null,
            price,
            dto.remarks ?? null,
          ],
        );
        await this.event(c, ctx, r.rows[0]!.id, 'accessioned', {
          to: 'available',
          on: dto.accessionedOn,
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'library.accession_taken',
            dto.barcode
              ? 'The barcode or accession number is already used'
              : `Accession number ${no} is already used`,
            { status: 409 },
          );
        throw error;
      }
    }
    await this.audit.stage(ctx, c, {
      action: 'library.copies.add',
      entityType: 'library_copies',
      entityId: titleId,
      after: { ...dto, accessionNos: numbers },
    });
    return numbers;
  }

  async create(ctx: RequestContext, dto: NewBookDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.saveTitle(c, ctx, dto);
      const accessionNos = dto.copies ? await this.addCopies(c, ctx, id, dto.copies) : [];
      return { id, accessionNos };
    });
  }

  async update(ctx: RequestContext, id: string, dto: TitleDto) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Book not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.saveTitle(c, ctx, dto, id);
      return { id };
    });
  }

  async copies(ctx: RequestContext, id: string, dto: CopiesDto) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Book not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await c.query(`SELECT 1 FROM library_titles WHERE id = $1`, [id]);
      if (!t.rowCount) throw new DomainError('not-found', 'Book not found', { status: 404 });
      return { accessionNos: await this.addCopies(c, ctx, id, dto) };
    });
  }

  /** A copy's place and source changed (the accession number stays); a move is in its history. */
  async editCopy(ctx: RequestContext, id: string, dto: CopyEditDto) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Copy not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const was = (
        await c.query<{
          library_id: string;
          shelf_id: string | null;
          rack: string | null;
          status: string;
        }>(
          `SELECT library_id::text, shelf_id::text, rack, status::text FROM library_copies WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!was) throw new DomainError('not-found', 'Copy not found', { status: 404 });
      if (was.status === 'sold')
        throw new DomainError('library.copy_sold', 'A sold copy is no longer in the register', {
          status: 409,
        });
      await this.checkCopy(c, dto);
      try {
        await c.query(
          `UPDATE library_copies SET library_id = $2, shelf_id = $3, rack = $4, barcode = $5, acquisition = $6, source = lower($6),
                  vendor_id = $7, donor = $8, bill_no = $9, bill_date = $10, po_no = $11, price = $12, remarks = $13,
                  accessioned_on = COALESCE($14::date, accessioned_on), updated_at = now(), updated_by = app.current_user_id()
            WHERE id = $1`,
          [
            id,
            dto.libraryId,
            dto.shelfId ?? null,
            dto.rack ?? null,
            dto.barcode ?? null,
            dto.acquisition ?? null,
            dto.vendorId ?? null,
            dto.donor ?? null,
            dto.billNo ?? null,
            dto.billDate ?? null,
            dto.poNo ?? null,
            dto.price ?? null,
            dto.remarks ?? null,
            dto.accessionedOn ?? null,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('library.barcode_taken', 'The barcode is already on another copy', {
            status: 409,
          });
        throw error;
      }
      const moved =
        was.library_id !== dto.libraryId ||
        (was.shelf_id ?? null) !== (dto.shelfId ?? null) ||
        (was.rack ?? null) !== (dto.rack ?? null);
      await this.event(c, ctx, id, moved ? 'moved' : 'edited');
      await this.audit.stage(ctx, c, {
        action: 'library.copy.update',
        entityType: 'library_copies',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  /**
   * A copy's status with the reason. Lost (paid or not) while on loan closes the loan; withdrawn and
   * damaged need the copy back first; found again and back in use put it on the shelf. A sold copy stays sold.
   */
  async changeStatus(ctx: RequestContext, id: string, dto: CopyStatusChangeDto) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Copy not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = (
        await c.query<{ status: string }>(
          `SELECT status::text FROM library_copies WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!cur) throw new DomainError('not-found', 'Copy not found', { status: 404 });
      const refuse = (detail: string) =>
        new DomainError('library.status_not_allowed', detail, { status: 409 });
      if (cur.status === 'sold') throw refuse('A sold copy stays sold');
      const to =
        dto.status === 'lost_paid' ? 'lost' : dto.status === 'found' ? 'available' : dto.status;
      if (dto.status === 'found' && cur.status !== 'lost')
        throw refuse('Only a lost copy is found again');
      if (dto.status === 'available' && !['damaged', 'withdrawn'].includes(cur.status))
        throw refuse('Back in use: for a damaged or withdrawn copy');
      if (['withdrawn', 'damaged'].includes(dto.status) && cur.status === 'issued')
        throw refuse('The copy is on loan: return it first');
      if (cur.status === to) throw refuse(`The copy is already ${to}`);
      if (dto.status === 'lost_paid' && !dto.amount)
        throw new DomainError('validation-failed', 'Lost and paid: the amount received', {
          status: 400,
        });
      if (dto.status !== 'lost_paid' && dto.amount)
        throw new DomainError('validation-failed', 'An amount is for lost and paid only', {
          status: 400,
        });
      if (to === 'lost' && cur.status === 'issued')
        await c.query(
          `UPDATE library_loans SET returned_on = $2::date, returned_by = app.current_user_id(),
                  note = concat_ws(' · ', note, $3::text), updated_at = now()
            WHERE copy_id = $1 AND returned_on IS NULL`,
          [id, dto.on, `${STATUS_WORD[dto.status]!}: ${dto.reason}`],
        );
      await c.query(
        `UPDATE library_copies SET status = $2::library_copy_status, status_on = $3::date, status_reason = $4,
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, to, dto.on, to === 'available' ? null : dto.reason],
      );
      await this.event(c, ctx, id, dto.status, {
        from: cur.status,
        to,
        on: dto.on,
        reason: dto.reason,
        amount: dto.amount ?? null,
      });
      await this.audit.stage(ctx, c, {
        action: 'library.copy.status',
        entityType: 'library_copies',
        entityId: id,
        after: dto,
      });
      return { id, status: to };
    });
  }
}
