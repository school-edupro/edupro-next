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
export const SaleSchema = z.object({
  accessionNo: z.string().trim().min(1).max(30),
  buyerKind: z.enum(['student', 'employee', 'other']),
  buyerId: IdSchema.optional(),
  buyerName: z.string().trim().max(120).optional(),
  price: z.number().min(0),
  receiptRef: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});
export class SaleDto extends createZodDto(SaleSchema) {}

export const StockCheckStartSchema = z.object({
  name: z.string().trim().min(2).max(120),
  note: z.string().trim().max(300).optional(),
});
export class StockCheckStartDto extends createZodDto(StockCheckStartSchema) {}

export const StockCheckScanSchema = z.object({
  /** scanned or pasted accession numbers */
  accessionNos: z.array(z.string().trim().min(1).max(30)).min(1).max(5000),
});
export class StockCheckScanDto extends createZodDto(StockCheckScanSchema) {}

export const StockCheckCloseSchema = z.object({
  markMissingLost: z.boolean().default(false),
  note: z.string().trim().max(300).optional(),
});
export class StockCheckCloseDto extends createZodDto(StockCheckCloseSchema) {}

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
