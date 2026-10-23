import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const txt = (n: number) => z.string().trim().max(n);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
export const ROLES = ['Author', 'Editor', 'Translator', 'Illustrator'] as const;

/** An ISBN of 10 or 13 digits (hyphens and spaces allowed), its check digit right; kept without them. */
export const IsbnSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .refine((s) => {
    if (/^\d{9}[\dX]$/.test(s)) {
      const sum = [...s].reduce((n, ch, i) => n + (ch === 'X' ? 10 : Number(ch)) * (10 - i), 0);
      return sum % 11 === 0;
    }
    if (/^\d{13}$/.test(s)) {
      const sum = [...s].reduce((n, ch, i) => n + Number(ch) * (i % 2 ? 3 : 1), 0);
      return sum % 10 === 0;
    }
    return false;
  }, 'Not a valid ISBN: 10 or 13 digits with the right check digit');

/** An accession number as written on the copy: capital letters and digits, slash or hyphen. */
export const AccessionNo = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9/-]{1,30}$/, 'An accession number is letters and digits (/ or - allowed)'),
  );

/** A title: entered once, linked to the set-up masters; people and the publisher by name. */
export const TitleSchema = z.object({
  title: txt(250).min(1),
  subtitle: txt(250).optional(),
  /** in the order printed; a name not yet in Authors is added there */
  people: z
    .array(z.object({ name: txt(120).min(2), role: z.enum(ROLES).default('Author') }))
    .max(20)
    .default([]),
  materialTypeId: Id,
  subjectId: Id.optional(),
  subSubject: txt(80).optional(),
  callNo: txt(40).optional(),
  keywords: z.array(txt(40).min(1)).max(20).default([]),
  classId: Id.optional(),
  /** a name not yet in Publishers is added there */
  publisher: txt(120).optional(),
  publicationPlace: txt(80).optional(),
  year: z
    .number()
    .int()
    .min(1500)
    .max(new Date().getFullYear() + 1)
    .optional(),
  edition: txt(40).optional(),
  volume: txt(40).optional(),
  pages: z.number().int().min(1).max(20000).optional(),
  isbn: IsbnSchema.optional(),
  languageId: Id.optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  isReference: z.boolean().default(false),
  notes: txt(1000).optional(),
});
export class TitleDto extends createZodDto(TitleSchema) {}

/** Where a copy is and how it came. */
const CopyFields = z.object({
  libraryId: Id,
  accessionedOn: DateSchema.optional(),
  shelfId: Id.optional(),
  rack: txt(20).optional(),
  barcode: txt(40)
    .regex(/^[A-Za-z0-9/-]*$/, 'A barcode is letters and digits')
    .optional(),
  acquisition: z.enum(['Purchase', 'Donation']).optional(),
  vendorId: Id.optional(),
  donor: txt(120).optional(),
  billNo: txt(40).optional(),
  billDate: DateSchema.optional(),
  poNo: txt(40).optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  remarks: txt(300).optional(),
});

/** New copies: a number of them numbered from the series, or the accession numbers typed. */
export const CopiesSchema = CopyFields.extend({
  count: z.number().int().min(1).max(200).default(1),
  accessionNos: z.array(AccessionNo).min(1).max(200).optional(),
});
export class CopiesDto extends createZodDto(CopiesSchema) {}

export const NewBookSchema = TitleSchema.extend({ copies: CopiesSchema.optional() });
export class NewBookDto extends createZodDto(NewBookSchema) {}

export const CopyEditSchema = CopyFields;
export class CopyEditDto extends createZodDto(CopyEditSchema) {}

/**
 * A copy's status with the reason: withdrawn (discarded), lost, lost and paid (with the amount), found
 * again, damaged, back in use.
 */
export const CopyStatusChangeSchema = z.object({
  status: z.enum(['withdrawn', 'lost', 'lost_paid', 'found', 'damaged', 'available']),
  on: DateSchema,
  reason: txt(300).min(3),
  amount: z.number().min(0).max(1_000_000).optional(),
});
export class CopyStatusChangeDto extends createZodDto(CopyStatusChangeSchema) {}

export const SORTS = [
  'title',
  'author',
  'accession',
  'callNo',
  'year',
  'publisher',
  'price',
  'accessioned',
  'status',
  'library',
] as const;

/** The book list's filters (part 3): the title's links and the copies' place, source, status and dates. */
export const BookFilterSchema = z.object({
  q: txt(80).optional(),
  libraryId: Id.optional(),
  materialTypeId: Id.optional(),
  subjectId: Id.optional(),
  languageId: Id.optional(),
  classId: Id.optional(),
  shelfId: Id.optional(),
  rack: txt(20).optional(),
  /** a name, or part of one */
  author: txt(80).optional(),
  publisher: txt(80).optional(),
  status: z.enum(['available', 'issued', 'lost', 'damaged', 'withdrawn', 'sold']).optional(),
  acquisition: z.enum(['Purchase', 'Donation']).optional(),
  vendorId: Id.optional(),
  accessionFrom: AccessionNo.optional(),
  accessionTo: AccessionNo.optional(),
  accessionedFrom: DateSchema.optional(),
  accessionedTo: DateSchema.optional(),
  yearFrom: z.coerce.number().int().min(1500).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1500).max(2100).optional(),
  /** stock checking: never checked, or checked (since a day) */
  stock: z.enum(['never', 'checked']).optional(),
  checkedSince: DateSchema.optional(),
  sort: z.enum(SORTS).default('title'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type BookFilter = z.infer<typeof BookFilterSchema>;

export const BookListSchema = BookFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(25),
});
export class BookListDto extends createZodDto(BookListSchema) {}

export const BookMatchSchema = z.object({
  isbn: txt(20).optional(),
  title: txt(250).optional(),
  except: Id.optional(),
});
export class BookMatchDto extends createZodDto(BookMatchSchema) {}

export const SuggestSchema = z.object({
  kind: z.enum(['author', 'publisher']),
  q: txt(60).default(''),
});
export class SuggestDto extends createZodDto(SuggestSchema) {}

/** The book list as Excel (part 3): one row per copy or per title; every field, or the fields picked. */
/** The Books page's lists as the Employees list: the view (columns, filters, sort, search, status) and a page. */
const RegisterKey = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{2,60}$/, 'unknown field');
export const RegisterViewSchema = z.object({
  columns: z
    .array(z.object({ key: RegisterKey, label: z.string().trim().max(80).nullable().optional() }))
    .max(60)
    .default([]),
  filters: z
    .array(
      z.object({
        key: RegisterKey,
        op: z.enum([
          'eq',
          'neq',
          'in',
          'not_in',
          'contains',
          'starts',
          'empty',
          'not_empty',
          'between',
          'gte',
          'lte',
        ]),
        values: z.array(z.string().trim().max(120)).max(200).optional(),
      }),
    )
    .max(30)
    .default([]),
  sort: z
    .array(z.object({ key: RegisterKey, dir: z.enum(['asc', 'desc']).default('asc') }))
    .max(3)
    .default([]),
  search: z.string().trim().max(80).optional(),
  status: z
    .string()
    .regex(/^[a-z_]{2,20}$/)
    .default('all'),
});
export const RegisterGridSchema = RegisterViewSchema.extend({
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100, 200].includes(n), 'one of 25, 50, 100, 200')
    .default(50),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export class RegisterGridDto extends createZodDto(RegisterGridSchema) {}
export const RegisterExportSchema = RegisterViewSchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class RegisterExportDto extends createZodDto(RegisterExportSchema) {}
export const RegisterLevelSchema = z.enum(['copy', 'title']);

export const BookExportSchema = BookFilterSchema.extend({
  level: z.enum(['copy', 'title']).default('copy'),
  columns: z
    .array(z.string().regex(/^[a-z0-9_.]{1,60}$/))
    .max(400)
    .optional(),
  layout: txt(60).optional(),
  /** the Books page's list: its filters, search and status choose the rows (instead of the above) */
  view: RegisterViewSchema.omit({ columns: true, sort: true }).optional(),
});
export class BookExportDto extends createZodDto(BookExportSchema) {}

/** A named set of the book list's export fields (0209). */
export const BookLayoutSchema = z.object({
  name: txt(60).min(2),
  columns: z
    .array(z.string().regex(/^[a-z0-9_.]{1,60}$/))
    .min(1)
    .max(400),
  level: z.enum(['copy', 'title']).default('copy'),
});
export class BookLayoutDto extends createZodDto(BookLayoutSchema) {}

/** Barcode and spine labels (part 5): which copies, what label, on what sheet. */
export const LabelsSchema = z.object({
  source: z.enum(['range', 'list', 'added', 'title']),
  from: AccessionNo.optional(),
  to: AccessionNo.optional(),
  list: z.array(AccessionNo).min(1).max(3000).optional(),
  addedFrom: DateSchema.optional(),
  addedTo: DateSchema.optional(),
  titleId: Id.optional(),
  libraryId: Id.optional(),
  kind: z.enum(['barcode', 'spine', 'both']).default('barcode'),
  preset: z.enum(['a4-3x8', 'a4-4x10', 'l7651', 'a4-2x7', 'custom']).default('a4-3x8'),
  custom: z
    .object({
      cols: z.number().int().min(1).max(10),
      rows: z.number().int().min(1).max(30),
      width: z.number().min(10).max(200),
      height: z.number().min(8).max(150),
      top: z.number().min(0).max(60),
      left: z.number().min(0).max(60),
      gapX: z.number().min(0).max(20),
      gapY: z.number().min(0).max(20),
    })
    .optional(),
  /** each label this many times */
  copies: z.number().int().min(1).max(3).default(1),
  /** labels of the first sheet already used */
  skip: z.number().int().min(0).max(299).default(0),
  /** the line above the title: the library's name, the school's, or none */
  top: z.enum(['library', 'school', 'none']).default('library'),
  showTitle: z.boolean().default(true),
  includeWithdrawn: z.boolean().default(false),
  /** count the labels only */
  dry: z.boolean().default(false),
});
export class LabelsDto extends createZodDto(LabelsSchema) {}

// ---- part 6: periodical subscriptions ----------------------------------------------------------------

export const FREQUENCIES = [
  'Daily',
  'Weekly',
  'Fortnightly',
  'Monthly',
  'Bi-monthly',
  'Quarterly',
  'Half-yearly',
  'Yearly',
] as const;

/** A periodical taken in a library for a period. */
export const SubscriptionSchema = z.object({
  periodicalId: Id,
  libraryId: Id,
  vendorId: Id.optional(),
  /** none: the periodical's own */
  frequency: z.enum(FREQUENCIES).optional(),
  startsOn: DateSchema,
  endsOn: DateSchema,
  /** none: the first day */
  firstIssueOn: DateSchema.optional(),
  copies: z.number().int().min(1).max(50).default(1),
  cost: z.number().min(0).max(10_000_000).optional(),
  orderNo: txt(40).optional(),
  billNo: txt(40).optional(),
  billDate: DateSchema.optional(),
  graceDays: z.number().int().min(0).max(90).default(7),
  notes: txt(500).optional(),
});
export class SubscriptionDto extends createZodDto(SubscriptionSchema) {}

export const SubscriptionListSchema = z.object({
  status: z.enum(['current', 'upcoming', 'ending', 'ended', 'cancelled', 'all']).default('current'),
  libraryId: Id.optional(),
  q: txt(80).optional(),
});
export class SubscriptionListDto extends createZodDto(SubscriptionListSchema) {}

export const CancelSubscriptionSchema = z.object({ on: DateSchema, reason: txt(300).min(3) });
export class CancelSubscriptionDto extends createZodDto(CancelSubscriptionSchema) {}

export const SpecialIssueSchema = z.object({ expectedOn: DateSchema, label: txt(80).min(2) });
export class SpecialIssueDto extends createZodDto(SpecialIssueSchema) {}

export const ReceiveIssueSchema = z.object({
  on: DateSchema,
  copies: z.number().int().min(0).max(50).optional(),
  volume: txt(20).optional(),
  issueNo: txt(20).optional(),
  remarks: txt(300).optional(),
});
export class ReceiveIssueDto extends createZodDto(ReceiveIssueSchema) {}

export const MissingIssueSchema = z.object({ remarks: txt(300).min(3) });
export class MissingIssueDto extends createZodDto(MissingIssueSchema) {}

export const ReceiveManySchema = z.object({ ids: z.array(Id).min(1).max(500), on: DateSchema });
export class ReceiveManyDto extends createZodDto(ReceiveManySchema) {}

export const DueIssuesSchema = z.object({
  libraryId: Id.optional(),
  /** issues expected up to this many days ahead too */
  ahead: z.coerce.number().int().min(0).max(30).default(0),
});
export class DueIssuesDto extends createZodDto(DueIssuesSchema) {}

/**
 * A wrong accession number corrected (docs/design/36-library.md, part 2): one copy (`from` becomes
 * `start`) or a range (`from` to `to` become `start` on, in the same order).
 */
export const AccessionChangeSchema = z.object({
  from: AccessionNo,
  to: AccessionNo.optional(),
  start: AccessionNo,
  reason: txt(300).min(3).optional(),
});
export class AccessionChangeDto extends createZodDto(AccessionChangeSchema) {}
export const AccessionApplySchema = AccessionChangeSchema.extend({ reason: txt(300).min(3) });
export class AccessionApplyDto extends createZodDto(AccessionApplySchema) {}

/** My library history in the portals (library round 4, part 3): issued between dates, a status, a search. */
export const PortalHistorySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  status: z.enum(['all', 'out', 'returned', 'late', 'renewed', 'fined']).default('all'),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class PortalHistoryDto extends createZodDto(PortalHistorySchema) {}
