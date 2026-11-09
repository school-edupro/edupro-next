import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { patchOf } from '../../common/validation/patch-of';
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
  /** a direct requisition (not from indents); within the limit it needs no approval */
  requisitionDirect: 'purchase.requisition.direct',
  orderManage: 'purchase.order.manage',
  orderCancel: 'purchase.order.cancel',
  emergencyRecord: 'purchase.emergency.record',
  reportView: 'purchase.report.view',
  storeView: 'purchase.store.view',
  storeOperate: 'purchase.store.operate',
  storeManage: 'purchase.store.manage',
  countApprove: 'purchase.count.approve',
  assetManage: 'purchase.asset.manage',
  condemnationApprove: 'purchase.condemnation.approve',
  approvalOverride: 'purchase.approval.override',
} as const;

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : undefined))
    .optional(); // keeps the key optional in the DTO type
const upper = (re: RegExp, help: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(re, help));
const Email = z.string().trim().email('an e-mail address').max(150);

// ---- vendors ---------------------------------------------------------------------------------------
export const VendorContactSchema = z.object({
  name: z.string().trim().max(120),
  role: opt(60),
  // the mobile's rules (Indian 10 digits, or with a country code) are in vendor-rules.ts
  phone: opt(25),
  email: Email.optional().or(z.literal('').transform(() => undefined)),
  isMain: z.boolean().default(false),
});

// the bank's rules (a bank of the Banks master, its IFSC, 9 to 18 digits typed twice) are in vendor-rules.ts
export const BankSchema = z.object({
  accountNo: z.string().trim().max(30),
  /** the number typed again on the form (an Excel row has it once) */
  accountNoConfirm: z.string().trim().max(30).optional(),
  ifsc: z.string().trim().max(15),
  bankName: z.string().trim().max(80),
  holder: z.string().trim().max(120),
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
  // country, state and city as named in the school's masters; PIN and mobile checked in vendor-rules.ts
  country: opt(80),
  state: opt(80),
  city: opt(80),
  pin: opt(12),
  phone: opt(25),
  email: Email.optional().or(z.literal('').transform(() => undefined)),
  categoryIds: z.array(IdSchema).max(50).default([]),
  paymentTermId: IdSchema.optional(),
  contacts: z.array(VendorContactSchema).max(10).default([]),
  bank: BankSchema.optional(),
  /** why a vendor sharing a GSTIN, PAN or bank account with another is saved anyway */
  duplicateReason: z.string().trim().min(3).max(300).optional(),
});

export const CreateVendorSchema = VendorBase.extend({
  /** left empty: the next V-0001 code is given when the vendor is saved */
  code: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : undefined))
    .pipe(
      z
        .string()
        .regex(/^[A-Z0-9_-]{1,20}$/, 'capital letters, digits, hyphen or underscore, up to 20')
        .optional(),
    ),
});
export class CreateVendorDto extends createZodDto(CreateVendorSchema) {}

export const UpdateVendorSchema = patchOf(VendorBase).extend({
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

/** The payment terms list: search, status, how paid, longer than 45 days; as Excel or PDF too. */
export const TermListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  kind: z.enum(['advance', 'delivery', 'invoice']).optional(),
  over45: z.enum(['1']).optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class TermListQueryDto extends createZodDto(TermListQuerySchema) {}

// ---- settings, committee, approvals -----------------------------------------------------------------
export const SettingsSchema = z
  .object({
    gstin: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .optional()
      .transform((v) => (v ? v : null)),
    // the addresses in parts: country, state and city as named in the school's masters
    billingLine: opt(300),
    billingCountry: opt(80),
    billingState: opt(80),
    billingCity: opt(80),
    billingPin: opt(12),
    /** the goods come to the billing address (the delivery parts are ignored) */
    deliverySame: z.boolean().default(true),
    deliveryLine: opt(300),
    deliveryCountry: opt(80),
    deliveryState: opt(80),
    deliveryCity: opt(80),
    deliveryPin: opt(12),
    piPrefix: upper(/^[A-Z0-9-]{1,10}$/, 'up to 10 capital letters, digits or hyphens'),
    prPrefix: upper(/^[A-Z0-9-]{1,10}$/, 'up to 10 capital letters, digits or hyphens'),
    poPrefix: upper(/^[A-Z0-9-]{1,10}$/, 'up to 10 capital letters, digits or hyphens'),
    directLimit: z.coerce.number().min(0).max(1e12),
    committeeLimit: z.coerce.number().min(0).max(1e12),
    committeeQuotes: z.coerce.number().int().min(1).max(10),
    committeeSignatures: z.coerce.number().int().min(1).max(20).nullable().default(null),
    emergencyEnabled: z.boolean(),
    /** who ratifies an emergency purchase: everyone with this designation */
    emergencyRatifier: z.string().trim().min(2).max(80).default('Principal'),
    /** the GST paid is part of the stock cost */
    stockGstInCost: z.boolean().default(true),
    /** how much more than ordered a delivery may bring, per PO line */
    receiptTolerancePct: z.coerce.number().min(0).max(50).default(0),
    poTerms: opt(4000),
    poValidityDays: z.coerce.number().int().min(1).max(365),
    purchaseDepartmentId: IdSchema.nullable().default(null),
    poSignatures: z.array(z.string().trim().min(2).max(40)).min(1).max(5),
    largePoAlert: z.coerce.number().gt(0).max(1e12).nullable().default(null),
    splitWindowDays: z.coerce.number().int().min(1).max(365),
    /** a direct PR up to this (before GST) is approved by the system when sent; 0: never */
    directPrLimit: z.coerce.number().min(0).max(1e12).default(50000),
    /** the PO's Bill to: the legal entity (a society, a trust) and its contact; empty: the school */
    billToName: opt(160),
    billContactName: opt(80),
    billContactPhone: opt(30),
    /** the PO's Ship to: the place goods go and its contact; empty: the school */
    shipToName: opt(160),
    shipContactName: opt(80),
    shipContactPhone: opt(30),
    /** where vendors write back: the PO e-mail's reply-to */
    officeEmail: z
      .union([Email, z.literal('')])
      .nullish()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.committeeLimit >= v.directLimit, {
    message: 'The committee limit must be at least the direct-purchase limit',
    path: ['committeeLimit'],
  });
export class SettingsDto extends createZodDto(SettingsSchema) {}

/** A vendor approver named in Purchase → Settings (an employee who signs in). */
export const VendorApproverSchema = z.object({ employeeId: IdSchema });
export class VendorApproverDto extends createZodDto(VendorApproverSchema) {}

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
    /** several people at the level: the first decides (any), or every one of them approves (all) */
    need: z.enum(['any', 'all']).default('any'),
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
    /**
     * the estimate per unit: the rate contract's, else the last purchase rate, unless typed — typed only
     * by someone who sees rates (the purchase office); a raiser's is ignored (docs/design/83)
     */
    estRate: z.coerce.number().min(0).max(1e10).optional(),
    note: z.string().trim().max(300).optional(),
    /** a document for the line (a spec sheet, a photo, a quotation), uploaded first: optional */
    fileId: IdSchema.optional(),
    /** why it is bought when the store has enough free stock for the quantity (asked on sending) */
    stockReason: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || v.length >= 3, 'Say in a few words why'),
  })
  .refine((l) => !!l.itemId !== !!l.freeText, {
    message: 'Pick an item, or describe one not in the list',
    path: ['itemId'],
  })
  .refine((l) => !l.freeText || !!l.uomId, {
    message: 'Pick the unit of an item described in words',
    path: ['uomId'],
  });

/** The indent's item sheet, filled and uploaded: read into the form's lines (nothing is saved). */
export const IndentSheetSchema = z.object({ file: z.string().min(10).max(1_000_000) });
export class IndentSheetDto extends createZodDto(IndentSheetSchema) {}
/** The requisition's item sheet (with the estimated rate), filled and uploaded: read, nothing saved. */
export class RequisitionSheetDto extends createZodDto(IndentSheetSchema) {}

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
  route: z
    .enum(['to_requisition', 'to_order', 'in_requisition', 'ordered', 'closed', 'from_store'])
    .optional(),
  departmentId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** sent (else started) on or after / on or before, in India */
  from: Day.optional(),
  to: Day.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class IndentListQueryDto extends createZodDto(IndentListQuerySchema) {}
/** The list as on screen (its filters), as a file. */
export const IndentExportQuerySchema = IndentListQuerySchema.omit({
  page: true,
  size: true,
}).extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class IndentExportQueryDto extends createZodDto(IndentExportQuerySchema) {}

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
    /** buy it, or issue it from the store (the store named for a kept-in-stock item; else a note) */
    fulfil: z.enum(['buy', 'store']).default('buy'),
    storeId: IdSchema.nullish(),
    storeNote: opt(300),
    note: opt(300),
  })
  .refine((l) => !!l.itemId || !!l.freeText || !!l.id, {
    message: 'Pick an item, or describe one not in the list',
    path: ['itemId'],
  })
  .refine((l) => l.fulfil !== 'store' || !!l.storeId || !!l.storeNote, {
    message: 'Pick the store it is issued from (or say what the store issues)',
    path: ['storeId'],
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
  /** its own department, or (combined) a department one of its indents came from */
  departmentId: IdSchema.optional(),
  /** made on or after / on or before, in India */
  from: Day.optional(),
  to: Day.optional(),
  /** a Purchase Indent's number (or part of it) that went into it */
  indent: z.string().trim().max(40).optional(),
  /** a vendor chosen on one of its lines */
  vendorId: IdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class RequisitionListQueryDto extends createZodDto(RequisitionListQuerySchema) {}
export const RequisitionExportQuerySchema = RequisitionListQuerySchema.omit({
  page: true,
  size: true,
}).extend({ format: z.enum(['xlsx', 'pdf']).default('xlsx') });
export class RequisitionExportQueryDto extends createZodDto(RequisitionExportQuerySchema) {}

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
        /** buy it on the item's rate contract: its vendor and rate (vendorId and rate are then ignored) */
        useContract: z.boolean().optional(),
        rate: Money.optional(),
        gstRate: Gst.optional(),
        /** why a vendor dearer than the lowest quote, or than the item's rate contract */
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

// ---- part 4: the Purchase Order -------------------------------------------------------------------
/** A draft PO for chosen lines of an approved requisition (lines without a vendor take this one). */
export const CreateOrderSchema = z.object({
  requisitionId: IdSchema,
  lineIds: z.array(IdSchema).min(1, 'Tick the lines').max(200),
  vendorId: IdSchema,
});
export class CreateOrderDto extends createZodDto(CreateOrderSchema) {}

/** Why a PO line is for less than the requisition needs, or why a line is closed on To order. */
const ShortReason = z.enum(['vendor_stock', 'pack_size', 'budget', 'not_needed', 'other']);

/** Lines waiting on To order that are not to be ordered (docs/design/83, "As built — a PO line for less"). */
export const CloseToOrderSchema = z
  .object({
    lineIds: z.array(IdSchema).min(1, 'Tick the lines').max(200),
    reason: ShortReason,
    note: opt(300),
  })
  .refine((x) => x.reason !== 'other' || !!x.note, {
    message: 'Write why',
    path: ['note'],
  });
export class CloseToOrderDto extends createZodDto(CloseToOrderSchema) {}

const OrderCharge = z.object({
  kind: z.enum(['freight', 'installation', 'packing', 'other']),
  label: opt(80),
  amount: Money,
  gstRate: Gst.default(0),
});

export const UpdateOrderSchema = z.object({
  quoteRef: opt(60),
  poDate: Day.optional(),
  deliveryDate: Day.nullish(),
  deliveryAddress: opt(500),
  paymentTermId: IdSchema.nullish(),
  validityDays: z.coerce.number().int().min(1).max(365),
  terms: opt(4000),
  freightTerms: opt(300),
  /** printed on the PO for the vendor */
  vendorNote: opt(1000),
  /** the lines kept (a line left out goes back to To order) */
  lines: z
    .array(
      z.object({
        id: IdSchema,
        description: z.string().trim().min(1).max(300),
        hsnCode: z
          .string()
          .trim()
          .regex(/^[0-9]{4,8}$/, 'an HSN / SAC code of 4 to 8 digits')
          .nullish()
          .or(z.literal('').transform(() => null)),
        quantity: z.coerce.number().gt(0).max(999999),
        rate: Money,
        discountPct: z.coerce.number().min(0).max(100).default(0),
        gstRate: Gst,
        /** a rate-contract line whose rate changes: why */
        rateChangeReason: opt(300),
        make: opt(80),
        model: opt(80),
        /** less than the requisition needs: why, and whether the rest waits on To order or is closed */
        shortReason: ShortReason.nullish().or(z.literal('').transform(() => null)),
        shortNote: opt(300),
        shortAction: z
          .enum(['later', 'close'])
          .nullish()
          .or(z.literal('').transform(() => null)),
      }),
    )
    .min(1, 'Keep at least one line')
    .max(200),
  charges: z.array(OrderCharge).max(10).default([]),
});
export class UpdateOrderDto extends createZodDto(UpdateOrderSchema) {}

export const OrderListQuerySchema = z.object({
  view: z.enum(['all', 'waiting']).default('all'),
  status: z
    .enum([
      'draft',
      'submitted',
      'approved',
      'sent',
      'closed',
      'rejected',
      'sent_back',
      'cancelled',
      'superseded',
    ])
    .optional(),
  emergency: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '1')),
  q: z.string().trim().max(80).optional(),
  /** its department, or a department one of its indents came from */
  departmentId: IdSchema.optional(),
  /** the PO date on or after / on or before */
  from: Day.optional(),
  to: Day.optional(),
  /** a Purchase Indent's number (or part of it) one of its lines came from */
  indent: z.string().trim().max(40).optional(),
  vendorId: IdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});
export class OrderListQueryDto extends createZodDto(OrderListQuerySchema) {}
export const OrderExportQuerySchema = OrderListQuerySchema.omit({ page: true, size: true }).extend({
  format: z.enum(['xlsx', 'pdf']).default('xlsx'),
});
export class OrderExportQueryDto extends createZodDto(OrderExportQuerySchema) {}

export const SendOrderSchema = z.object({
  to: z.string().trim().email('an e-mail address').max(150),
});
export class SendOrderDto extends createZodDto(SendOrderSchema) {}

/** An emergency purchase recorded after the fact: the vendor's bill and the reason; ratified later. */
export const EmergencySchema = z.object({
  vendorId: IdSchema,
  departmentId: IdSchema.optional(),
  reason: z.string().trim().min(10, 'Say why it could not wait (at least 10 letters)').max(1000),
  billFileId: IdSchema,
  billRef: opt(60),
  poDate: Day.optional(),
  lines: z
    .array(
      z
        .object({
          itemId: IdSchema.optional(),
          description: z.string().trim().min(2).max(300).optional(),
          quantity: z.coerce.number().gt(0).max(999999),
          uomId: IdSchema.optional(),
          rate: Money,
          gstRate: Gst.optional(),
        })
        .refine((l) => !!l.itemId || (!!l.description && !!l.uomId), {
          message: 'Pick an item, or describe it with its unit',
          path: ['itemId'],
        }),
    )
    .min(1, 'Add what was bought: at least one line with the item, quantity and rate')
    .max(50, 'At most 50 lines'),
});
export class EmergencyDto extends createZodDto(EmergencySchema) {}

// ---- part 5: reports ------------------------------------------------------------------------------
export const PURCHASE_REPORTS = [
  'pi_register',
  'pr_register',
  'po_register',
  'tracker',
  'pending',
  'overrides',
  'department_spend',
  'vendor_purchases',
  'item_history',
  'comparative',
  'gst_summary',
  'msme_vendors',
  'grn_register',
  'pending_deliveries',
  'consumption',
  'slow_moving',
  'expiring',
  'below_reorder',
  'transfers',
  'count_differences',
  'asset_register',
  'fixed_assets',
  'condemnations',
  'issue_register',
  'return_register',
  'unacknowledged',
] as const;
export type PurchaseReport = (typeof PURCHASE_REPORTS)[number];

export const ReportQuerySchema = z
  .object({
    from: Day.optional(),
    to: Day.optional(),
    departmentId: IdSchema.optional(),
    vendorId: IdSchema.optional(),
    itemId: IdSchema.optional(),
    storeId: IdSchema.optional(),
    status: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,20}$/)
      .optional(),
    format: z.enum(['xlsx', 'pdf']).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'From is after to', path: ['to'] });
export class ReportQueryDto extends createZodDto(ReportQuerySchema) {}

// ---- phase 2, part 6: stores and stock (docs/design/84) -------------------------------------------
const Qty = z.coerce.number().gt(0).max(9999999);
export const StoreSchema = z.object({
  code: upper(
    /^[A-Z0-9][A-Z0-9_-]{0,19}$/,
    'up to 20 capital letters, digits, hyphen or underscore',
  ),
  name: z.string().trim().min(2).max(80),
  departmentId: IdSchema.nullish(),
  location: opt(200),
  keeperIds: z.array(IdSchema).max(20).default([]),
  status: z.enum(['active', 'inactive']).default('active'),
});
export class StoreDto extends createZodDto(StoreSchema) {}

export const StoreLevelsSchema = z.object({
  lines: z
    .array(
      z
        .object({
          itemId: IdSchema,
          reorderLevel: z.coerce.number().min(0).max(9999999),
          reorderQty: Qty.nullish(),
          maxQty: Qty.nullish(),
        })
        .refine((l) => !l.maxQty || l.maxQty >= l.reorderLevel, {
          message: 'The maximum is below the reorder level',
          path: ['maxQty'],
        }),
    )
    .max(1000),
});
export class StoreLevelsDto extends createZodDto(StoreLevelsSchema) {}

export const OpeningLineSchema = z.object({
  itemId: IdSchema,
  qty: Qty,
  /** per store unit */
  rate: z.coerce.number().min(0).max(1e10),
  batch: opt(40),
  expiry: Day.optional(),
});
export const OpeningSchema = z.object({
  lines: z.array(OpeningLineSchema).min(1).max(500),
  day: Day.optional(),
  /** check only: each line's value and warnings (a ₹0 rate, a rate far from the last purchase) */
  dryRun: z.boolean().default(false),
});
export class OpeningDto extends createZodDto(OpeningSchema) {}

export const OpeningImportSchema = z.object({
  file: z.string().min(10).max(2_000_000),
  fileName: opt(200),
  dryRun: z.boolean().default(true),
});
export class OpeningImportDto extends createZodDto(OpeningImportSchema) {}

/**
 * One item's opening in a store, corrected while it has not moved since (docs/design/84, 9 Nov 2026):
 * the lines it should have been (none: the opening was wrong — removed), and why.
 */
export const OpeningFixSchema = z.object({
  itemId: IdSchema,
  lines: z
    .array(OpeningLineSchema.omit({ itemId: true }))
    .max(100)
    .default([]),
  reason: z.string().trim().min(3, 'Say why (at least 3 letters)').max(300),
});
export class OpeningFixDto extends createZodDto(OpeningFixSchema) {}

/** A rate correction: what is left of the item in the store, at the rate it should be. */
export const RevaluationSchema = z.object({
  itemId: IdSchema,
  newRate: z.coerce.number().min(0).max(1e10),
  reason: z.string().trim().min(3, 'Say why (at least 3 letters)').max(300),
});
export class RevaluationDto extends createZodDto(RevaluationSchema) {}
export const RevaluationDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
  note: opt(1000),
});
export class RevaluationDecisionDto extends createZodDto(RevaluationDecisionSchema) {}
export const OpeningUndoSchema = z.object({
  reason: z.string().trim().min(3, 'Say why (at least 3 letters)').max(300),
});
export class OpeningUndoDto extends createZodDto(OpeningUndoSchema) {}
/** The opening stock posted, a page of its lines: of one posting, found by item or code, by status. */
export const OpeningViewSchema = z.object({
  posting: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(['standing', 'changeable', 'settled', 'reversed']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(50),
});
export class OpeningViewDto extends createZodDto(OpeningViewSchema) {}
export const StatementQuerySchema = z.object({ format: z.enum(['xlsx', 'pdf']).default('pdf') });
export class StatementQueryDto extends createZodDto(StatementQuerySchema) {}

export const StockQuerySchema = z.object({
  storeId: IdSchema.optional(),
  /** one item (the store page's rate correction) */
  itemId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** below the reorder level only */
  below: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => v === '1'),
  /** items with nothing in stock too (those with a reorder level) */
  empty: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => v === '1'),
  format: z.enum(['xlsx', 'pdf']).optional(),
  /** a page of the rows (the store page) */
  page: z.coerce.number().int().min(1).max(100000).optional(),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(50),
});
export class StockQueryDto extends createZodDto(StockQuerySchema) {}

export const LedgerQuerySchema = z.object({
  storeId: IdSchema.optional(),
  from: Day.optional(),
  to: Day.optional(),
  format: z.enum(['xlsx', 'pdf']).optional(),
});
export class LedgerQueryDto extends createZodDto(LedgerQuerySchema) {}

// ---- phase 2, part 7: goods receipts and completion certificates (docs/design/84) -----------------
const Qty0 = z.coerce.number().min(0).max(9999999);
export const ReceiptLineSchema = z
  .object({
    orderLineId: IdSchema,
    /** in the PO line's unit: taken in */
    receivedQty: Qty0,
    /** refused at the door (damaged, wrong, more than ordered) */
    refusedQty: Qty0.default(0),
    refusedReason: opt(300),
    batch: opt(40),
    expiry: Day.optional(),
    serials: z.array(z.string().trim().min(1).max(60)).max(500).default([]),
    /** a service: what was done */
    workDone: opt(1000),
  })
  .refine((l) => l.receivedQty > 0 || l.refusedQty > 0, {
    message: 'Give the quantity received or refused',
    path: ['receivedQty'],
  })
  .refine((l) => l.refusedQty === 0 || !!l.refusedReason, {
    message: 'Say why it was refused',
    path: ['refusedReason'],
  });
export const ReceiptSchema = z.object({
  orderId: IdSchema,
  kind: z.enum(['goods', 'service']).default('goods'),
  storeId: IdSchema.nullish(),
  receivedOn: Day,
  challanNo: opt(60),
  challanDate: Day.optional(),
  invoiceNo: opt(60),
  invoiceDate: Day.optional(),
  fileId: IdSchema.nullish(),
  note: opt(1000),
  lines: z.array(ReceiptLineSchema).min(1).max(500),
});
export class ReceiptDto extends createZodDto(ReceiptSchema) {}

export const InspectionLineSchema = z.object({
  lineId: IdSchema,
  acceptedQty: Qty0,
  rejectedQty: Qty0.default(0),
  reason: opt(300),
  rejectedSerials: z.array(z.string().trim().min(1).max(60)).max(500).default([]),
});
export const InspectionSchema = z.object({
  /** accept (in full or in part, line by line) or reject all of it */
  action: z.enum(['accept', 'reject']),
  lines: z.array(InspectionLineSchema).max(500).default([]),
  note: opt(1000),
});
export class InspectionDto extends createZodDto(InspectionSchema) {}

export const ReceiptListQuerySchema = z.object({
  status: z.enum(['inspecting', 'accepted', 'rejected', 'cancelled']).optional(),
  kind: z.enum(['goods', 'service']).optional(),
  orderId: IdSchema.optional(),
  storeId: IdSchema.optional(),
  /** waiting for me to inspect or sign */
  mine: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => v === '1'),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export class ReceiptListQueryDto extends createZodDto(ReceiptListQuerySchema) {}

// ---- phase 2, part 8: issues, returns, transfers, counts (docs/design/84) ----------------------------
const StoreQty = z.coerce.number().gt(0).max(9999999);
export const IssueSchema = z
  .object({
    /** against an approved requisition's reserved lines, or at the counter */
    kind: z.enum(['indent', 'counter']),
    storeId: IdSchema,
    requisitionId: IdSchema.optional(),
    /** an approved indent's lines held in this store at approval (docs/design/83, "served from stock") */
    indentId: IdSchema.optional(),
    departmentId: IdSchema.optional(),
    takenByEmployeeId: IdSchema.nullish(),
    purpose: opt(300),
    lines: z
      .array(
        z.object({
          reservationId: IdSchema.optional(),
          itemId: IdSchema.optional(),
          /** in the store unit */
          qty: StoreQty,
          batch: opt(40),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine((d) => d.kind !== 'indent' || !!d.requisitionId !== !!d.indentId, {
    message: 'Pick the requisition or the indent',
    path: ['requisitionId'],
  })
  .refine(
    (d) => d.kind !== 'counter' || (!!d.departmentId && !!d.takenByEmployeeId && !!d.purpose),
    {
      message: 'Give the department, who took it and the purpose',
      path: ['takenByEmployeeId'],
    },
  );
export class IssueDto extends createZodDto(IssueSchema) {}

/** What is held for an indent line cannot be given (not in the store after all): it goes to purchase. */
export const ReleaseHoldSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export class ReleaseHoldDto extends createZodDto(ReleaseHoldSchema) {}

export const AcknowledgeSchema = z.object({
  note: opt(300),
  /** the store records a slip signed on paper (the department has no sign-in) */
  onPaper: z.boolean().default(false),
});
export class AcknowledgeDto extends createZodDto(AcknowledgeSchema) {}

export const ReturnToStoreSchema = z.object({
  returnedOn: Day.optional(),
  note: opt(1000),
  lines: z
    .array(
      z.object({
        issueLineId: IdSchema,
        qty: StoreQty,
        condition: z.enum(['unused', 'damaged']),
        reason: opt(300),
      }),
    )
    .min(1)
    .max(200),
});
export class ReturnToStoreDto extends createZodDto(ReturnToStoreSchema) {}

export const VendorReturnSchema = z.object({
  orderId: IdSchema,
  returnedOn: Day.optional(),
  dispatch: opt(300),
  note: opt(1000),
  lines: z
    .array(
      z.object({
        receiptLineId: IdSchema,
        /** goods rejected at inspection, or taken out of stock (found defective) */
        source: z.enum(['rejected', 'stock']),
        /** in the PO line's unit */
        qty: StoreQty,
        reason: z.string().trim().min(3).max(300),
        replacement: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(200),
});
export class VendorReturnDto extends createZodDto(VendorReturnSchema) {}

export const TransferSchema = z
  .object({
    fromStoreId: IdSchema,
    toStoreId: IdSchema,
    note: opt(500),
    lines: z
      .array(z.object({ itemId: IdSchema, qty: StoreQty, batch: opt(40) }))
      .min(1)
      .max(200),
  })
  .refine((d) => d.fromStoreId !== d.toStoreId, {
    message: 'Pick another store to send to',
    path: ['toStoreId'],
  });
export class TransferDto extends createZodDto(TransferSchema) {}

export const NoteSchema = z.object({ note: opt(500) });
export class NoteDto extends createZodDto(NoteSchema) {}

export const CountSchema = z.object({
  storeId: IdSchema,
  categoryId: IdSchema.nullish(),
  countedOn: Day.optional(),
  note: opt(1000),
});
export class CountDto extends createZodDto(CountSchema) {}

export const CountLinesSchema = z.object({
  countedBy: opt(200),
  lines: z
    .array(
      z
        .object({
          lineId: IdSchema.optional(),
          /** found in the count but not on the list */
          itemId: IdSchema.optional(),
          batch: opt(40),
          expiry: Day.optional(),
          countedQty: z.coerce.number().min(0).max(9999999).nullable(),
          reason: opt(300),
          /** why it differs (docs/design/84, 9 Nov 2026); the note above goes with it */
          reasonCode: z
            .enum([
              'not_found',
              'damaged',
              'expired',
              'issued_no_slip',
              'received_no_grn',
              'entry_mistake',
              'found',
              'other',
            ])
            .optional(),
        })
        .refine((l) => !!l.lineId || !!l.itemId, { message: 'Pick the item', path: ['itemId'] }),
    )
    .max(5000),
});
export class CountLinesDto extends createZodDto(CountLinesSchema) {}

/**
 * A count's lines a page at a time (docs/design/84, "As built — the store page in tabs", 9 Nov 2026):
 * found by item, code or batch, a category, not yet counted / with a difference / every line, a reason.
 * Without `page` every line comes (the files and older callers).
 */
export const CountViewSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional(),
  size: z.coerce
    .number()
    .int()
    .refine((n) => [25, 50, 100].includes(n))
    .default(50),
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  show: z.enum(['all', 'todo', 'diff']).optional(),
  reason: z
    .enum([
      'not_found',
      'damaged',
      'expired',
      'issued_no_slip',
      'received_no_grn',
      'entry_mistake',
      'found',
      'other',
      'none',
    ])
    .optional(),
});
export class CountViewDto extends createZodDto(CountViewSchema) {}

export const CountDecisionSchema = z.object({
  action: z.enum(['approve', 'send_back']),
  note: opt(1000),
});
export class CountDecisionDto extends createZodDto(CountDecisionSchema) {}

export const CountImportSchema = z.object({
  file: z.string().min(10).max(2_000_000),
});
export class CountImportDto extends createZodDto(CountImportSchema) {}

export const StockDocQuerySchema = z.object({
  status: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,20}$/)
    .optional(),
  kind: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,20}$/)
    .optional(),
  storeId: IdSchema.optional(),
  /** issues: waiting for my acknowledgement; transfers: waiting for me to receive */
  mine: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => v === '1'),
  /** issues: issued to me or my department, whatever their status (the staff app's Received earlier) */
  received: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => v === '1'),
  q: z.string().trim().max(80).optional(),
  /** issues and returns: the period (issued / returned on), a department, an item on a line */
  from: Day.optional(),
  to: Day.optional(),
  departmentId: IdSchema.optional(),
  itemId: IdSchema.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export class StockDocQueryDto extends createZodDto(StockDocQuerySchema) {}

/** What a new return can start from: POs with goods to send back, or issues with goods to take back. */
export const ReturnSourceQuerySchema = z.object({
  kind: z.enum(['to_vendor', 'to_store']),
  q: z.string().trim().max(80).optional(),
});
export class ReturnSourceQueryDto extends createZodDto(ReturnSourceQuerySchema) {}

// ---- phase 2, part 9: reorder, assets, depreciation, condemnation (docs/design/84) ------------------
export const ReorderIndentSchema = z.object({
  storeId: IdSchema,
  /** the items to put on the indent, with the quantity in the purchase unit */
  lines: z
    .array(z.object({ itemId: IdSchema, quantity: z.coerce.number().gt(0).max(999999) }))
    .min(1)
    .max(200),
});
export class ReorderIndentDto extends createZodDto(ReorderIndentSchema) {}

const AssetCondition = z.enum(['good', 'fair', 'poor', 'unserviceable']);
export const AssetSchema = z.object({
  description: opt(300),
  make: opt(80),
  model: opt(80),
  serialNo: opt(60),
  location: opt(120),
  condition: AssetCondition.default('good'),
  putToUseOn: Day.nullish(),
  warrantyUntil: Day.nullish(),
  insurer: opt(120),
  policyNo: opt(60),
  insuredValue: z.coerce.number().min(0).max(1e10).nullish(),
  insuranceRenewal: Day.nullish(),
  note: opt(1000),
});
export class AssetDto extends createZodDto(AssetSchema) {}

export const AssetMoveSchema = z
  .object({
    kind: z.enum(['custody', 'repair_out', 'repair_back', 'lost', 'found']),
    movedOn: Day.optional(),
    /** custody: the department, the place, the person who keeps it (none: back to nobody) */
    departmentId: IdSchema.nullish(),
    location: opt(120),
    custodianId: IdSchema.nullish(),
    /** repair: the vendor, when it should be back, what it cost (on return) */
    vendorId: IdSchema.nullish(),
    expectedBack: Day.optional(),
    cost: z.coerce.number().min(0).max(1e10).nullish(),
    note: opt(500),
  })
  .refine((m) => !['lost', 'repair_out'].includes(m.kind) || !!m.note, {
    message: 'Say what happened',
    path: ['note'],
  });
export class AssetMoveDto extends createZodDto(AssetMoveSchema) {}

export const AssetListQuerySchema = z.object({
  status: z
    .string()
    .trim()
    .regex(/^[a-z_]{2,20}$/)
    .optional(),
  itemId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  departmentId: IdSchema.optional(),
  storeId: IdSchema.optional(),
  custodianId: IdSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** warranty or insurance ending within 60 days */
  expiring: z
    .enum(['1', '0'])
    .optional()
    .transform((v) => v === '1'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export class AssetListQueryDto extends createZodDto(AssetListQuerySchema) {}

export const AssetLabelsSchema = z.object({ ids: z.array(IdSchema).min(1).max(600) });
export class AssetLabelsDto extends createZodDto(AssetLabelsSchema) {}

export const AssetImportSchema = z.object({
  file: z.string().min(10).max(4_000_000),
  dryRun: z.boolean().default(true),
});
export class AssetImportDto extends createZodDto(AssetImportSchema) {}

export const DepreciationRunSchema = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, 'a financial year like 2025-26'),
  dryRun: z.boolean().default(true),
});
export class DepreciationRunDto extends createZodDto(DepreciationRunSchema) {}

const ReasonKind = z.enum(['unserviceable', 'obsolete', 'surplus', 'expired', 'damaged', 'lost']);
export const CondemnationSchema = z.object({
  title: z.string().trim().min(3).max(200),
  note: opt(2000),
  lines: z
    .array(
      z
        .object({
          kind: z.enum(['asset', 'stock']),
          assetId: IdSchema.optional(),
          storeId: IdSchema.optional(),
          itemId: IdSchema.optional(),
          batch: opt(40),
          /** stock: in the store unit */
          qty: z.coerce.number().gt(0).max(9999999).optional(),
          reasonKind: ReasonKind,
          reason: opt(300),
        })
        .refine((l) => (l.kind === 'asset' ? !!l.assetId : !!l.storeId && !!l.itemId && !!l.qty), {
          message: 'An asset, or a store, item and quantity',
          path: ['assetId'],
        }),
    )
    .min(1)
    .max(500),
});
export class CondemnationDto extends createZodDto(CondemnationSchema) {}

export const CondemnationDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'send_back']),
  note: opt(1000),
});
export class CondemnationDecisionDto extends createZodDto(CondemnationDecisionSchema) {}

export const DisposalSchema = z.object({
  method: z.enum(['auction', 'tender_sale', 'sale', 'buyback', 'scrap', 'donation', 'destruction']),
  disposedOn: Day,
  party: opt(200),
  amount: z.coerce.number().min(0).max(1e10).default(0),
  reference: opt(120),
  note: opt(1000),
  fileId: IdSchema.nullish(),
});
export class DisposalDto extends createZodDto(DisposalSchema) {}
