import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const PAYMENTS = {
  intentView: 'payments.intent.view',
  intentCreate: 'payments.intent.create',
  offlineRecord: 'payments.offline.record',
  /** Sprint 13 */
  receiptPost: 'fees.receipt.post',
  refundRequest: 'fees.refund.request',
  refundApprove: 'fees.refund.approve',
  familyPay: 'payments.family.pay',
  settlementView: 'payments.settlement.view',
  settlementManage: 'payments.settlement.manage',
} as const;

export const PROVIDERS = ['mock', 'payu', 'razorpay', 'ccavenue'] as const;
export type Provider = (typeof PROVIDERS)[number];

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const Amount = z.number().min(1).max(10_000_000);

export const CreateFeeIntentSchema = z.object({
  studentId: IdSchema,
  amount: Amount,
  payerName: z.string().trim().min(1).max(120),
  payerEmail: z.string().trim().email().max(200),
  payerMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/),
});
export class CreateFeeIntentDto extends createZodDto(CreateFeeIntentSchema) {}

/** Sprint 13: a guardian pays for one of their children; payer details come from the signed-in user. */
export const CreateFamilyIntentSchema = z.object({
  studentId: IdSchema,
  amount: Amount,
});
export class CreateFamilyIntentDto extends createZodDto(CreateFamilyIntentSchema) {}

export const ModeSchema = z.enum(['cash', 'cheque', 'dd', 'upi', 'bank', 'card']);

export const RecordOfflinePaymentSchema = z.object({
  studentId: IdSchema,
  amount: Amount,
  mode: ModeSchema,
  reference: z.string().trim().max(80).optional(),
  receivedOn: DateSchema.optional(),
  remarks: z.string().trim().max(300).optional(),
});
export class RecordOfflinePaymentDto extends createZodDto(RecordOfflinePaymentSchema) {}

/** Sprint 13: the cashier posts a receipt through app.post_receipt. */
export const PostReceiptSchema = RecordOfflinePaymentSchema.extend({
  instrumentNo: z.string().trim().max(40).optional(),
  instrumentDate: DateSchema.optional(),
  bankName: z.string().trim().max(80).optional(),
  ledger: z.enum(['school', 'hostel', 'misc']).default('school'),
  /** false leaves the late fee outstanding (needs fees.late_fee.manage). */
  collectLateFee: z.boolean().default(true),
  /** A mode the school added (fee_payment_modes.code); `mode` is then the kind it works like. */
  modeCode: z
    .string()
    .regex(/^[a-z0-9_]{2,30}$/)
    .optional(),
});
export class PostReceiptDto extends createZodDto(PostReceiptSchema) {}

export const ListIntentsQuerySchema = z.object({
  status: z.enum(['created', 'pending', 'succeeded', 'failed', 'cancelled']).optional(),
  purpose: z.enum(['admission_fee', 'fee_instalment', 'misc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListIntentsQueryDto extends createZodDto(ListIntentsQuerySchema) {}

/** The gateway posts form fields; every field is a string. */
export const PayuWebhookSchema = z
  .object({
    status: z.string().max(40),
    txnid: z.string().min(1).max(80),
    amount: z.string().max(20),
    productinfo: z.string().max(200),
    firstname: z.string().max(120),
    email: z.string().max(200),
    mihpayid: z.string().max(80).optional(),
    hash: z.string().min(10).max(200),
    udf1: z.string().max(80).optional(),
    udf2: z.string().max(80).optional(),
    udf3: z.string().max(80).optional(),
    udf4: z.string().max(80).optional(),
    udf5: z.string().max(80).optional(),
  })
  .passthrough();
export class PayuWebhookDto extends createZodDto(PayuWebhookSchema) {}

/** Razorpay checkout handler / return: the three signed fields. */
export const RazorpayReturnSchema = z
  .object({
    razorpay_order_id: z.string().min(1).max(80),
    razorpay_payment_id: z.string().min(1).max(80),
    razorpay_signature: z.string().min(10).max(200),
  })
  .passthrough();
export class RazorpayReturnDto extends createZodDto(RazorpayReturnSchema) {}

/** Razorpay webhook envelope; the signature is over the raw body (header X-Razorpay-Signature). */
export const RazorpayWebhookSchema = z
  .object({
    event: z.string().min(1).max(80),
    payload: z.record(z.unknown()).optional(),
  })
  .passthrough();
export class RazorpayWebhookDto extends createZodDto(RazorpayWebhookSchema) {}

/** CCAvenue posts the encrypted response to the redirect and cancel URLs. */
export const CcavenueReturnSchema = z
  .object({ encResp: z.string().min(16).max(20_000), orderNo: z.string().max(80).optional() })
  .passthrough();
export class CcavenueReturnDto extends createZodDto(CcavenueReturnSchema) {}

export const MockPaySchema = z.object({
  txnid: z.string().min(1).max(80),
  outcome: z.enum(['success', 'failure']).default('success'),
});
export class MockPayDto extends createZodDto(MockPaySchema) {}

// ---- Sprint 13: refunds ----------------------------------------------------------------------------
export const RequestRefundSchema = z.object({
  amount: Amount,
  reason: z.string().trim().min(3).max(300),
  mode: z.enum(['cash', 'bank', 'cheque', 'gateway']),
  reference: z.string().trim().max(80).optional(),
});
export class RequestRefundDto extends createZodDto(RequestRefundSchema) {}

export const DecideRefundSchema = z.object({
  outcome: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(300).optional(),
  /** Offline refunds: the payout reference (cheque number, UTR) recorded at approval. */
  reference: z.string().trim().max(80).optional(),
});
export class DecideRefundDto extends createZodDto(DecideRefundSchema) {}

export const ListRefundsQuerySchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'paid', 'failed']).optional(),
  studentId: IdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class ListRefundsQueryDto extends createZodDto(ListRefundsQuerySchema) {}

// ---- Sprint 13: settlements ----------------------------------------------------------------------
export const UploadSettlementSchema = z.object({
  provider: z.enum(['payu', 'razorpay', 'ccavenue', 'mock']),
  settlementRef: z.string().trim().min(1).max(80),
  settledOn: DateSchema,
  utr: z.string().trim().max(60).optional(),
  fileName: z.string().trim().max(160).optional(),
  /** The provider's CSV (header row + one line per transaction), at most 2 MB. */
  csv: z.string().min(1).max(2_000_000),
});
export class UploadSettlementDto extends createZodDto(UploadSettlementSchema) {}

/** Sprint 15: a bank account statement (CSV) to match against cheque, DD, NEFT and UPI receipts. */
export const UploadBankStatementSchema = z.object({
  bankName: z.string().trim().min(2).max(80),
  accountRef: z.string().trim().max(40).optional(),
  fileName: z.string().trim().max(160).optional(),
  csv: z.string().min(1).max(2_000_000),
});
export class UploadBankStatementDto extends createZodDto(UploadBankStatementSchema) {}
