import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

export const PAYMENTS = {
  intentView: 'payments.intent.view',
  intentCreate: 'payments.intent.create',
  offlineRecord: 'payments.offline.record',
} as const;

export const CreateFeeIntentSchema = z.object({
  studentId: IdSchema,
  amount: z.number().min(1).max(10_000_000),
  payerName: z.string().trim().min(1).max(120),
  payerEmail: z.string().trim().email().max(200),
  payerMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/),
});
export class CreateFeeIntentDto extends createZodDto(CreateFeeIntentSchema) {}

export const RecordOfflinePaymentSchema = z.object({
  studentId: IdSchema,
  amount: z.number().min(1).max(10_000_000),
  mode: z.enum(['cash', 'cheque', 'upi', 'bank']),
  reference: z.string().trim().max(80).optional(),
  receivedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  remarks: z.string().trim().max(300).optional(),
});
export class RecordOfflinePaymentDto extends createZodDto(RecordOfflinePaymentSchema) {}

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

export const MockPaySchema = z.object({
  txnid: z.string().min(1).max(80),
  outcome: z.enum(['success', 'failure']).default('success'),
});
export class MockPayDto extends createZodDto(MockPaySchema) {}
