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

export const BookListSchema = z.object({
  q: txt(80).optional(),
  libraryId: Id.optional(),
  materialTypeId: Id.optional(),
  subjectId: Id.optional(),
  status: z.enum(['available', 'issued', 'lost', 'damaged', 'withdrawn']).optional(),
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
