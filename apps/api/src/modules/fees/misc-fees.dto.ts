import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const Id = z.string().regex(/^\d{1,18}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Money = z.number().min(0).max(10_000_000);

/** Who a misc fee is offered to: classes, sections, pupils by name, or rows of a sheet with their own figures. */
export const MiscAudienceSchema = z.object({
  classIds: z.array(Id).max(60).default([]),
  sectionIds: z.array(Id).max(200).default([]),
  studentIds: z.array(Id).max(5000).default([]),
  /** From Excel: a pupil by admission number, with their own amount and last date where given. */
  rows: z
    .array(
      z.object({
        admissionNo: z.string().trim().min(1).max(40),
        amount: Money.optional(),
        lastDate: Day.optional(),
      }),
    )
    .max(5000)
    .default([]),
});

export const AnnounceMiscFeeSchema = MiscAudienceSchema.extend({
  headId: Id,
  title: z.string().trim().min(3).max(120),
  amount: Money,
  lastDate: Day,
  remark: z.string().trim().max(500).optional(),
  /** false: the parent may choose not to pay; the offer closes on the last date. */
  mandatory: z.boolean().default(true),
  /** A limited number of places, given in the order of payment. */
  seats: z.number().int().min(1).max(100_000).optional(),
}).refine(
  (v) => v.classIds.length + v.sectionIds.length + v.studentIds.length + v.rows.length > 0,
  {
    message: 'choose who the fee is for',
    path: ['studentIds'],
  },
);
export class AnnounceMiscFeeDto extends createZodDto(AnnounceMiscFeeSchema) {}

/** A change to an announced fee; each goes for approval. */
export const MiscFeeChangeSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('extend'),
      lastDate: Day,
      reason: z.string().trim().min(3).max(300),
    }),
    z.object({
      kind: z.literal('pupil_change'),
      lineId: Id,
      amount: Money.optional(),
      lastDate: Day.optional(),
      reason: z.string().trim().min(3).max(300),
    }),
    z.object({
      kind: z.literal('add_pupils'),
      audience: MiscAudienceSchema,
      reason: z.string().trim().min(3).max(300),
    }),
    z.object({ kind: z.literal('close'), reason: z.string().trim().min(3).max(300) }),
  ])
  .refine((v) => v.kind !== 'pupil_change' || v.amount !== undefined || v.lastDate !== undefined, {
    message: 'give the new amount or the new last date',
  });
export type MiscFeeChangeDto = z.infer<typeof MiscFeeChangeSchema>;

export const CollectMiscFeeSchema = z.object({
  studentId: Id,
  /** The pupil's fee lines being paid now, each with what is received on it. */
  lines: z
    .array(z.object({ lineId: Id, amount: z.number().min(0.01).max(10_000_000) }))
    .min(1)
    .max(40),
  mode: z.enum(['cash', 'cheque', 'dd', 'upi', 'bank', 'card']),
  receivedOn: Day.optional(),
  reference: z.string().trim().max(80).optional(),
  instrumentNo: z.string().trim().max(40).optional(),
  instrumentDate: Day.optional(),
  bankName: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(300).optional(),
});
export class CollectMiscFeeDto extends createZodDto(CollectMiscFeeSchema) {}

/** A misc receipt taken back: cancelled, a bounced cheque, or a refund of all or part of it. */
export const MiscReceiptRequestSchema = z
  .object({
    kind: z.enum(['receipt_cancel', 'receipt_bounce', 'receipt_refund']),
    reason: z.string().trim().min(3).max(300),
    /** refund: how much goes back (up to what the receipt still holds) */
    amount: z.number().min(0.01).max(10_000_000).optional(),
    /** refund: how it is paid back */
    mode: z.enum(['cash', 'bank', 'cheque']).optional(),
    reference: z.string().trim().max(80).optional(),
  })
  .refine((v) => v.kind !== 'receipt_refund' || (v.amount !== undefined && v.mode !== undefined), {
    message: 'a refund needs the amount and how it is paid back',
  });
export class MiscReceiptRequestDto extends createZodDto(MiscReceiptRequestSchema) {}

export const DecideMiscRequestSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).optional(),
});
export class DecideMiscRequestDto extends createZodDto(DecideMiscRequestSchema) {}

export const ListMiscFeesQuerySchema = z.object({
  status: z.enum(['pending', 'announced', 'rejected', 'closed']).optional(),
  headId: Id.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListMiscFeesQueryDto extends createZodDto(ListMiscFeesQuerySchema) {}

export const MiscSheetSchema = z.object({ contentBase64: z.string().min(10).max(6_000_000) });
export class MiscSheetDto extends createZodDto(MiscSheetSchema) {}
