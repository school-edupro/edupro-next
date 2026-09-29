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
