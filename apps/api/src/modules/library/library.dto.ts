import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const LIBRARY = {
  view: 'library.catalogue.view',
  manage: 'library.catalogue.manage',
  circulate: 'library.loan.circulate',
  familyView: 'library.family.view',
} as const;

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const CatalogueQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(),
  available: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class CatalogueQueryDto extends createZodDto(CatalogueQuerySchema) {}

export const AccessionSchema = z.object({
  titleId: IdSchema,
  /** explicit accession numbers, or a count to number from the next free one */
  accessionNos: z.array(z.string().trim().min(1).max(30)).max(200).optional(),
  count: z.number().int().min(1).max(200).optional(),
  accessionedOn: DateSchema.optional(),
  source: z.string().trim().max(60).optional(),
  price: z.number().min(0).optional(),
});
export class AccessionDto extends createZodDto(AccessionSchema) {}

export const CopyStatusSchema = z.object({
  status: z.enum(['available', 'lost', 'damaged', 'withdrawn']),
  remarks: z.string().trim().max(300).optional(),
});
export class CopyStatusDto extends createZodDto(CopyStatusSchema) {}

export const IssueSchema = z.object({
  accessionNo: z.string().trim().min(1).max(30),
  borrowerKind: z.enum(['student', 'employee']),
  borrowerId: IdSchema,
  dueOn: DateSchema.optional(),
  note: z.string().trim().max(300).optional(),
});
export class IssueDto extends createZodDto(IssueSchema) {}

export const ReturnSchema = z.object({
  accessionNo: z.string().trim().min(1).max(30),
  returnedOn: DateSchema.optional(),
  /** mark the copy on return */
  condition: z.enum(['available', 'damaged', 'lost']).default('available'),
  waiveFine: z.boolean().default(false),
  /** why the fine is waived (needed when there is one) */
  waiveReason: z.string().trim().max(300).optional(),
  note: z.string().trim().max(300).optional(),
});
export class ReturnDto extends createZodDto(ReturnSchema) {}

export const RenewSchema = z.object({ accessionNo: z.string().trim().min(1).max(30) });
export class RenewDto extends createZodDto(RenewSchema) {}

export const FineSchema = z.object({
  action: z.enum(['collect', 'waive']),
  amount: z.number().min(0).optional(),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});
export class FineDto extends createZodDto(FineSchema) {}

export const LoansQuerySchema = z.object({
  status: z.enum(['open', 'overdue', 'returned', 'fines']).default('open'),
  borrowerKind: z.enum(['student', 'employee']).optional(),
  borrowerId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class LoansQueryDto extends createZodDto(LoansQuerySchema) {}

// ---- Sprint 18 ----
/** Books sold to one buyer (part 4 of the library reports): a pupil or staff member owes a misc fee; someone
 * outside the school pays on a misc receipt. */
export const BookSaleSchema = z
  .object({
    buyerKind: z.enum(['student', 'employee', 'other']),
    buyerId: IdSchema.optional(),
    buyerName: z.string().trim().min(2).max(120).optional(),
    buyerMobile: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number')
      .optional(),
    books: z
      .array(
        z.object({
          accessionNo: z.string().trim().min(1).max(40),
          price: z.number().min(0).max(1_000_000),
        }),
      )
      .min(1)
      .max(200),
    soldOn: DateSchema.optional(),
    /** how someone outside the school paid */
    mode: z.enum(['cash', 'upi', 'card', 'bank']).optional(),
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => (v.buyerKind === 'other' ? !!v.buyerName : !!v.buyerId), {
    message: 'name the buyer, or pick the pupil or staff member',
  });
export class BookSaleDto extends createZodDto(BookSaleSchema) {}

export const SalesQuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  buyer: z.enum(['student', 'employee', 'other']).optional(),
  /** due: a misc fee not paid yet; paid: paid at the counter or on a receipt; free: no price */
  state: z.enum(['all', 'due', 'paid', 'cancelled', 'free']).default('all'),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class SalesQueryDto extends createZodDto(SalesQuerySchema) {}
export const SalesExportSchema = SalesQuerySchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class SalesExportDto extends createZodDto(SalesExportSchema) {}

/** A stock cycle (part 3 of the library reports): the libraries, shelves and material types it covers. */
export const StockCycleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** none: every library (or shelf, or material type) */
  libraryIds: z.array(IdSchema).max(50).default([]),
  shelfIds: z.array(IdSchema).max(1000).default([]),
  materialTypeIds: z.array(IdSchema).max(50).default([]),
  note: z.string().trim().max(300).optional(),
});
export class StockCycleDto extends createZodDto(StockCycleSchema) {}

/** Book numbers scanned or typed (accession, old number or barcode). */
export const StockVerifySchema = z.object({
  accessionNos: z.array(z.string().trim().min(1).max(40)).min(1).max(5000),
  remark: z.string().trim().max(200).optional(),
});
export class StockVerifyDto extends createZodDto(StockVerifySchema) {}

export const StockItemsQuerySchema = z.object({
  state: z
    .enum(['all', 'verified', 'pending', 'on_loan', 'missing', 'gone', 'extras'])
    .default('pending'),
  libraryId: IdSchema.optional(),
  shelfId: IdSchema.optional(),
  materialTypeId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class StockItemsQueryDto extends createZodDto(StockItemsQuerySchema) {}
export const StockItemsExportSchema = StockItemsQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class StockItemsExportDto extends createZodDto(StockItemsExportSchema) {}

export const StockCloseSchema = z.object({
  /** the copies not found are marked lost (else they stay as they are, listed as missing) */
  markMissingLost: z.boolean().default(false),
  note: z.string().trim().max(300).optional(),
});
export class StockCloseDto extends createZodDto(StockCloseSchema) {}

export const StockCancelSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export class StockCancelDto extends createZodDto(StockCancelSchema) {}

/** A book on loan reported lost, or returned damaged, and charged (part 3 of the register work). */
export const ChargePreviewSchema = z.object({
  accessionNo: z.string().trim().min(1).max(30),
  kind: z.enum(['lost', 'damaged']),
  /** the day it is reported lost or comes back (default today) */
  on: DateSchema.optional(),
});
export class ChargePreviewDto extends createZodDto(ChargePreviewSchema) {}
export const ChargeSchema = ChargePreviewSchema.extend({
  /** what is charged; none: what is worked out */
  amount: z.number().min(0).max(1_000_000).optional(),
  /** a damaged book: what is damaged; a lost one: why the charge differs */
  reason: z.string().trim().max(300).optional(),
  /** a damaged book returned late: its late fine waived */
  waiveFine: z.boolean().optional(),
});
export class ChargeDto extends createZodDto(ChargeSchema) {}
export const ChargeListSchema = z.object({
  status: z.enum(['due', 'paid', 'cancelled', 'all']).optional(),
  /** the days charged between (paid: the days paid) */
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  borrower: z.enum(['student', 'employee']).optional(),
  q: z.string().trim().max(80).optional(),
});
export class ChargeListDto extends createZodDto(ChargeListSchema) {}
export const ChargeExportSchema = ChargeListSchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class ChargeExportDto extends createZodDto(ChargeExportSchema) {}

// ---- library reports (docs/design/36-library.md, "Library reports") ----
export const FinesQuerySchema = z.object({
  tab: z.enum(['outstanding', 'collected', 'waived']).default('outstanding'),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  borrower: z.enum(['student', 'employee']).optional(),
  classId: IdSchema.optional(),
  sectionId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class FinesQueryDto extends createZodDto(FinesQuerySchema) {}
export const FinesExportSchema = FinesQuerySchema.extend({ format: z.enum(['xlsx', 'pdf']) });
export class FinesExportDto extends createZodDto(FinesExportSchema) {}
/** The waivers the library asked of the fees office (Late fines → Waiver requests). */
export const WaiverRequestsQuerySchema = FinesQuerySchema.omit({ tab: true }).extend({
  status: z.enum(['all', 'pending', 'approved', 'rejected']).default('all'),
});
export class WaiverRequestsQueryDto extends createZodDto(WaiverRequestsQuerySchema) {}
export const WaiverRequestsExportSchema = WaiverRequestsQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class WaiverRequestsExportDto extends createZodDto(WaiverRequestsExportSchema) {}
export const FinesSendSchema = z.object({
  /** the loans whose old fines go to the fees counter; none: every one */
  loanIds: z.array(IdSchema).max(500).optional(),
});
export class FinesSendDto extends createZodDto(FinesSendSchema) {}
export const WaiveRequestSchema = z.object({
  /** how much to waive; none: all that is due */
  amount: z.number().positive().max(1_000_000).optional(),
  reason: z.string().trim().min(3).max(300),
});
export class WaiveRequestDto extends createZodDto(WaiveRequestSchema) {}

// ---- the circulation desk (docs/design/36-library.md, "The circulation desk") ----
const DeskNo = z.string().trim().min(1).max(30);
export const DeskBorrowerSchema = z.object({ q: z.string().trim().min(1).max(80) });
export class DeskBorrowerDto extends createZodDto(DeskBorrowerSchema) {}
export const DeskBookSchema = z.object({
  accessionNo: DeskNo,
  for: z.enum(['issue', 'return']),
});
export class DeskBookDto extends createZodDto(DeskBookSchema) {}
export const DeskIssueSchema = z.object({
  borrowerKind: z.enum(['student', 'employee']),
  borrowerId: IdSchema,
  accessionNos: z.array(DeskNo).min(1).max(20),
  /** one due date for the batch; none: each by the borrower's rule */
  dueOn: DateSchema.optional(),
});
export class DeskIssueDto extends createZodDto(DeskIssueSchema) {}
export const DeskReturnSchema = z.object({
  accessionNos: z.array(DeskNo).min(1).max(300),
  returnedOn: DateSchema.optional(),
});
export class DeskReturnDto extends createZodDto(DeskReturnSchema) {}
export const DeskClassSchema = z.object({
  classId: IdSchema,
  sectionId: IdSchema.optional(),
});
export class DeskClassDto extends createZodDto(DeskClassSchema) {}

/** Circulation between two days (part 2): issues, returns, renewals; or the books out (overdue) now. */
export const CirculationQuerySchema = z.object({
  what: z.enum(['all', 'issued', 'returned', 'renewed', 'out', 'overdue']).default('all'),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  borrower: z.enum(['student', 'employee']).optional(),
  classId: IdSchema.optional(),
  sectionId: IdSchema.optional(),
  libraryId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class CirculationQueryDto extends createZodDto(CirculationQuerySchema) {}
export const CirculationExportSchema = CirculationQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class CirculationExportDto extends createZodDto(CirculationExportSchema) {}

/** Pupils or staff, each with what they borrowed and returned between two days and hold now. */
export const BorrowersQuerySchema = z.object({
  kind: z.enum(['student', 'employee']),
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  /** active: borrowed or returned between the days, or holding now; all: any loan ever */
  show: z.enum(['active', 'holding', 'overdue', 'all']).default('active'),
  classId: IdSchema.optional(),
  sectionId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['name', 'holding', 'borrowed']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class BorrowersQueryDto extends createZodDto(BorrowersQuerySchema) {}
export const BorrowersExportSchema = BorrowersQuerySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BorrowersExportDto extends createZodDto(BorrowersExportSchema) {}

/** One borrower's books held between two days (none: every loan). */
export const BorrowerHistorySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
});
export class BorrowerHistoryDto extends createZodDto(BorrowerHistorySchema) {}
export const BorrowerHistoryExportSchema = BorrowerHistorySchema.extend({
  format: z.enum(['xlsx', 'pdf']),
});
export class BorrowerHistoryExportDto extends createZodDto(BorrowerHistoryExportSchema) {}

/** A staff member named on a library (library round 3, part 3). */
export const LibraryStaffSchema = z.object({ libraryId: IdSchema, employeeId: IdSchema });
export class LibraryStaffDto extends createZodDto(LibraryStaffSchema) {}
