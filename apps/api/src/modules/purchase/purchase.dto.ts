import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/** Rights of the purchase module (docs/design/83). */
export const PURCHASE = {
  masterView: 'purchase.master.view',
  masterManage: 'purchase.master.manage',
  vendorApprove: 'purchase.vendor.approve',
  settingsManage: 'purchase.settings.manage',
  indentRaise: 'purchase.indent.raise',
  indentView: 'purchase.indent.view',
  indentAnyDepartment: 'purchase.indent.any_department',
  requisitionManage: 'purchase.requisition.manage',
} as const;

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : undefined));
const upper = (re: RegExp, help: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(re, help));
const Phone = z
  .string()
  .trim()
  .regex(/^[0-9+ -]{7,20}$/, 'a phone number of 7 to 20 digits');
const Email = z.string().trim().email('an e-mail address').max(150);

// ---- vendors ---------------------------------------------------------------------------------------
export const VendorContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: opt(60),
  phone: Phone.optional().or(z.literal('').transform(() => undefined)),
  email: Email.optional().or(z.literal('').transform(() => undefined)),
  isMain: z.boolean().default(false),
});

export const BankSchema = z.object({
  accountNo: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, 'an account number of 6 to 20 digits'),
  ifsc: upper(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'an IFSC like SBIN0001234'),
  bankName: z.string().trim().min(2).max(80),
  holder: z.string().trim().min(2).max(120),
});

const VendorBase = z.object({
  legalName: z.string().trim().min(2).max(150),
  tradeName: opt(150),
  kind: z.enum(['manufacturer', 'dealer', 'service_provider']).default('dealer'),
  gstStatus: z.enum(['regular', 'composition', 'unregistered']).default('regular'),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .optional()
    .transform((v) => (v ? v : undefined)),
  pan: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** for an unregistered vendor (a registered one's comes from its GSTIN) */
  stateCode: z
    .string()
    .regex(/^[0-9]{2}$/)
    .optional(),
  msmeType: z.enum(['micro', 'small', 'medium']).optional(),
  udyamNo: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .optional()
    .transform((v) => (v ? v : undefined)),
  address: opt(500),
  city: opt(80),
  pin: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'a 6-digit PIN code')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  phone: Phone.optional().or(z.literal('').transform(() => undefined)),
  email: Email.optional().or(z.literal('').transform(() => undefined)),
  categoryIds: z.array(IdSchema).max(50).default([]),
  paymentTermId: IdSchema.optional(),
  contacts: z.array(VendorContactSchema).max(10).default([]),
  bank: BankSchema.optional(),
  /** why a vendor sharing a GSTIN, PAN or bank account with another is saved anyway */
  duplicateReason: z.string().trim().min(3).max(300).optional(),
});

export const CreateVendorSchema = VendorBase.extend({
  code: upper(/^[A-Z0-9_-]{1,20}$/, 'capital letters and digits, up to 20'),
});
export class CreateVendorDto extends createZodDto(CreateVendorSchema) {}

export const UpdateVendorSchema = VendorBase.partial().extend({
  /** why the bank / GSTIN / PAN changes (asked when the vendor is already approved) */
  changeReason: z.string().trim().min(3).max(500).optional(),
});
export class UpdateVendorDto extends createZodDto(UpdateVendorSchema) {}

export const VendorListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['pending', 'active', 'inactive', 'blacklisted', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class VendorListQueryDto extends createZodDto(VendorListQuerySchema) {}

export const DecisionSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export class DecisionDto extends createZodDto(DecisionSchema) {}

export const VendorStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'blacklisted']),
  reason: z.string().trim().max(500).optional(),
});
export class VendorStatusDto extends createZodDto(VendorStatusSchema) {}

export const VendorDocumentSchema = z.object({
  kind: z.enum([
    'gst_certificate',
    'pan_card',
    'cancelled_cheque',
    'udyam_certificate',
    'agreement',
    'other',
  ]),
  fileId: IdSchema,
});
export class VendorDocumentDto extends createZodDto(VendorDocumentSchema) {}

export const VendorImportSchema = z.object({
  file: z.string().min(10).max(2_000_000),
  /** check every row and say what would happen, saving nothing */
  dryRun: z.boolean().default(true),
});
export class VendorImportDto extends createZodDto(VendorImportSchema) {}

// ---- payment terms ---------------------------------------------------------------------------------
export const PaymentTermLineSchema = z.object({
  pct: z.coerce.number().gt(0).max(100),
  dueOn: z.enum(['advance', 'delivery', 'invoice']),
  days: z.coerce.number().int().min(0).max(365).default(0),
});
export const PaymentTermSchema = z.object({
  code: upper(/^[A-Z0-9_-]{1,20}$/, 'capital letters and digits, up to 20'),
  name: z.string().trim().min(2).max(120),
  printText: opt(500),
  isDefault: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
  lines: z.array(PaymentTermLineSchema).min(1).max(12),
});
export class PaymentTermDto extends createZodDto(PaymentTermSchema) {}

// ---- settings, committee, approvals -----------------------------------------------------------------
export const SettingsSchema = z
  .object({
    gstin: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .optional()
      .transform((v) => (v ? v : null)),
    billingAddress: opt(500),
    deliveryAddress: opt(500),
    piPrefix: upper(/^[A-Z0-9-]{1,10}$/, 'up to 10 capital letters, digits or hyphens'),
    prPrefix: upper(/^[A-Z0-9-]{1,10}$/, 'up to 10 capital letters, digits or hyphens'),
    poPrefix: upper(/^[A-Z0-9-]{1,10}$/, 'up to 10 capital letters, digits or hyphens'),
    directLimit: z.coerce.number().min(0).max(1e12),
    committeeLimit: z.coerce.number().min(0).max(1e12),
    committeeQuotes: z.coerce.number().int().min(1).max(10),
    committeeSignatures: z.coerce.number().int().min(1).max(20).nullable().default(null),
    emergencyEnabled: z.boolean(),
    poTerms: opt(4000),
    poValidityDays: z.coerce.number().int().min(1).max(365),
    purchaseDepartmentId: IdSchema.nullable().default(null),
    poSignatures: z.array(z.string().trim().min(2).max(40)).min(1).max(5),
    largePoAlert: z.coerce.number().gt(0).max(1e12).nullable().default(null),
    splitWindowDays: z.coerce.number().int().min(1).max(365),
  })
  .refine((v) => v.committeeLimit >= v.directLimit, {
    message: 'The committee limit must be at least the direct-purchase limit',
    path: ['committeeLimit'],
  });
export class SettingsDto extends createZodDto(SettingsSchema) {}

export const CommitteeMemberSchema = z.object({
  employeeId: IdSchema,
  role: opt(60),
});
export class CommitteeMemberDto extends createZodDto(CommitteeMemberSchema) {}

export const LevelSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    by: z.enum(['employees', 'designation', 'hod']),
    employeeIds: z.array(IdSchema).max(30).default([]),
    designation: z.string().trim().max(80).optional(),
    slaHours: z.coerce.number().int().min(1).max(720).nullable().default(null),
  })
  .refine((l) => l.by !== 'employees' || l.employeeIds.length > 0, {
    message: 'Pick at least one employee for this level',
    path: ['employeeIds'],
  })
  .refine((l) => l.by !== 'designation' || (l.designation ?? '').length >= 2, {
    message: 'Pick the designation for this level',
    path: ['designation'],
  });
export const DepartmentLevelsSchema = z.object({ levels: z.array(LevelSchema).max(3) });
export class DepartmentLevelsDto extends createZodDto(DepartmentLevelsSchema) {}

export const DepartmentRulesSchema = z.object({
  bypassLimit: z.coerce.number().min(0).max(1e12),
  rateContractBypass: z.boolean(),
});
export class DepartmentRulesDto extends createZodDto(DepartmentRulesSchema) {}

export const COPY_PARTS = [
  'uoms',
  'hsn',
  'categories',
  'items',
  'paymentTerms',
  'vendors',
] as const;
export const CopyFromSchema = z.object({
  schoolId: IdSchema,
  parts: z.array(z.enum(COPY_PARTS)).min(1),
});
export class CopyFromDto extends createZodDto(CopyFromSchema) {}

// ---- Purchase Indent (part 2) ---------------------------------------------------------------------
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date (YYYY-MM-DD)');

export const IndentLineSchema = z
  .object({
    itemId: IdSchema.optional(),
    /** an item not in the catalogue, in words (the purchase office maps it on the PR) */
    freeText: z.string().trim().min(2).max(300).optional(),
    quantity: z.coerce.number().gt(0).max(999999),
    /** the item's own unit unless given; required for a line in words */
    uomId: IdSchema.optional(),
    /** the estimate per unit: the rate contract's, else the last purchase rate, unless typed */
    estRate: z.coerce.number().min(0).max(1e10).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((l) => !!l.itemId !== !!l.freeText, {
    message: 'Pick an item, or describe one not in the list',
    path: ['itemId'],
  })
  .refine((l) => !l.freeText || !!l.uomId, {
    message: 'Pick the unit of an item described in words',
    path: ['uomId'],
  });

export const IndentSchema = z.object({
  /** the raiser's own department unless they may raise for any */
  departmentId: IdSchema.optional(),
  onBehalfEmployeeId: IdSchema.optional(),
  purpose: z.string().trim().min(3).max(500),
  requiredBy: Day.optional(),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  lines: z.array(IndentLineSchema).min(1, 'Add at least one line').max(200),
});
export class IndentDto extends createZodDto(IndentSchema) {}

export const IndentListQuerySchema = z.object({
  /** mine: raised by me or for me; waiting: waiting for my approval; all: every one I may see */
  view: z.enum(['mine', 'waiting', 'all']).default('all'),
  status: z
    .enum(['draft', 'submitted', 'approved', 'rejected', 'sent_back', 'cancelled'])
    .optional(),
  route: z.enum(['to_requisition', 'to_order', 'in_requisition', 'ordered', 'closed']).optional(),
  departmentId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class IndentListQueryDto extends createZodDto(IndentListQuerySchema) {}

export const IndentDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'send_back']),
  note: z.string().trim().max(500).optional(),
});
export class IndentDecisionDto extends createZodDto(IndentDecisionSchema) {}

export const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const PurchaseDelegationSchema = z
  .object({
    /** someone else's approvals (the school admin only); empty: my own */
    fromUserId: IdSchema.optional(),
    toEmployeeId: IdSchema,
    startsOn: Day,
    endsOn: Day,
    reason: z.string().trim().min(3).max(300),
  })
  .refine((d) => d.endsOn >= d.startsOn, { message: 'Ends after it starts', path: ['endsOn'] });
export class PurchaseDelegationDto extends createZodDto(PurchaseDelegationSchema) {}

// ---- part 3: the Purchase Requisition -------------------------------------------------------------
const Money = z.coerce.number().min(0).max(1e10);
const Gst = z.coerce.number().min(0).max(40);

export const RequisitionLineSchema = z
  .object({
    /** a line already on the PR (its indent lines stay with it); none: a new line */
    id: IdSchema.optional(),
    itemId: IdSchema.optional(),
    freeText: z.string().trim().min(2).max(300).optional(),
    quantity: z.coerce.number().gt(0).max(999999),
    uomId: IdSchema.optional(),
    estRate: Money.optional(),
    /** buy it, or issue it from the store (phase 1: marked with a note) */
    fulfil: z.enum(['buy', 'store']).default('buy'),
    storeNote: opt(300),
    note: opt(300),
  })
  .refine((l) => !!l.itemId || !!l.freeText || !!l.id, {
    message: 'Pick an item, or describe one not in the list',
    path: ['itemId'],
  })
  .refine((l) => l.fulfil !== 'store' || !!l.storeNote, {
    message: 'Say what the store issues (e.g. 20 from the stock room)',
    path: ['storeNote'],
  });

/** A PR from approved indents (their lines combined by item), or the purchase office's own. */
export const CreateRequisitionSchema = z
  .object({
    indentIds: z.array(IdSchema).max(50).default([]),
    /** a direct PR: the department it is for */
    departmentId: IdSchema.optional(),
    purpose: z.string().trim().min(3).max(500).optional(),
    requiredBy: Day.optional(),
    lines: z.array(RequisitionLineSchema).max(200).default([]),
  })
  .refine((d) => d.indentIds.length > 0 || (d.lines.length > 0 && !!d.departmentId), {
    message: 'Pick approved indents, or the department and the lines of a direct requisition',
    path: ['indentIds'],
  });
export class CreateRequisitionDto extends createZodDto(CreateRequisitionSchema) {}

export const UpdateRequisitionSchema = z.object({
  purpose: z.string().trim().min(3).max(500),
  requiredBy: Day.nullish(),
  lines: z.array(RequisitionLineSchema).min(1, 'Keep at least one line').max(200),
});
export class UpdateRequisitionDto extends createZodDto(UpdateRequisitionSchema) {}

export const RequisitionListQuerySchema = z.object({
  /** waiting: at my approval level; sign: comparative statements waiting for my signature */
  view: z.enum(['all', 'waiting', 'sign']).default('all'),
  status: z
    .enum([
      'draft',
      'sourcing',
      'submitted',
      'approved',
      'rejected',
      'sent_back',
      'cancelled',
      'part_ordered',
      'ordered',
    ])
    .optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class RequisitionListQueryDto extends createZodDto(RequisitionListQuerySchema) {}

export const QuoteSchema = z
  .object({
    vendorId: IdSchema,
    quoteRef: opt(60),
    quoteDate: Day.optional(),
    validUntil: Day.optional(),
    deliveryDays: z.coerce.number().int().min(0).max(365).optional(),
    fileId: IdSchema.optional(),
    note: opt(500),
    /** the vendor's rate for the lines it quoted (a line left out: not quoted) */
    lines: z
      .array(z.object({ lineId: IdSchema, rate: Money, gstRate: Gst.optional(), note: opt(300) }))
      .min(1, 'Enter the rate of at least one line')
      .max(200),
  })
  .refine((q) => !q.validUntil || !q.quoteDate || q.validUntil >= q.quoteDate, {
    message: 'Valid until is before the quote date',
    path: ['validUntil'],
  });
export class QuoteDto extends createZodDto(QuoteSchema) {}

/** The vendor and rate per line: from a quote, or (direct / tender) as agreed. */
export const ChoicesSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: IdSchema,
        vendorId: IdSchema.nullish(),
        rate: Money.optional(),
        gstRate: Gst.optional(),
        /** why a vendor dearer than the lowest quote */
        reason: opt(300),
      }),
    )
    .min(1)
    .max(200),
});
export class ChoicesDto extends createZodDto(ChoicesSchema) {}

export const CertificateSchema = z.object({ text: z.string().trim().min(20).max(1000) });
export class CertificateDto extends createZodDto(CertificateSchema) {}

export const TenderSchema = z.object({
  tenderRef: z.string().trim().min(2).max(120),
  note: opt(1000),
});
export class TenderDto extends createZodDto(TenderSchema) {}

export const RequisitionFileSchema = z.object({
  fileId: IdSchema,
  kind: z.enum(['tender', 'other']).default('tender'),
});
export class RequisitionFileDto extends createZodDto(RequisitionFileSchema) {}

export const SignSchema = z.object({ note: opt(300) });
export class SignDto extends createZodDto(SignSchema) {}
