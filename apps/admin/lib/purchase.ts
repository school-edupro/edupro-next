/** Purchase (docs/design/83): the shapes the admin reads from the API, and fixed lists. */

export type VendorStatus = 'pending' | 'active' | 'inactive' | 'blacklisted' | 'rejected';

export interface Bank {
  accountNo: string;
  ifsc: string;
  bankName: string;
  holder: string;
}

export interface Vendor {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  kind: 'manufacturer' | 'dealer' | 'service_provider';
  gstStatus: 'regular' | 'composition' | 'unregistered';
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  state: string | null;
  msmeType: 'micro' | 'small' | 'medium' | null;
  udyamNo: string | null;
  address: string | null;
  city: string | null;
  pin: string | null;
  phone: string | null;
  email: string | null;
  bankHint: string | null;
  bank?: Bank | null;
  categoryIds: string[];
  paymentTermId: string | null;
  paymentTerm: string | null;
  status: VendorStatus;
  statusReason: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  pendingChangeId: string | null;
}

export interface VendorChange {
  id: string;
  vendorId: string;
  changes: {
    gstStatus?: string;
    gstin?: string | null;
    pan?: string | null;
    stateCode?: string | null;
    bankHint?: string | null;
    bank?: Bank | null;
  };
  before: {
    gstStatus?: string;
    gstin?: string | null;
    pan?: string | null;
    stateCode?: string | null;
    bankHint?: string | null;
  };
  reason: string | null;
  status: string;
  requestedBy: string | null;
  requestedAt: string;
}

export interface VendorDetail extends Vendor {
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
    isMain: boolean;
  }>;
  documents: Array<{
    id: string;
    kind: string;
    fileId: string;
    name: string | null;
    contentType: string | null;
    uploadedAt: string;
  }>;
  pendingChange: VendorChange | null;
  enteredByMe: boolean;
}

export interface PaymentTerm {
  id: string;
  code: string;
  name: string;
  printText: string | null;
  isDefault: boolean;
  status: 'active' | 'inactive';
  lines: Array<{ pct: number; dueOn: 'advance' | 'delivery' | 'invoice'; days: number }>;
  words: string;
  longestDays: number;
  vendors: number;
}

export interface PurchaseOverview {
  uoms: number;
  hsn: number;
  categories: number;
  items: number;
  paymentTerms: number;
  vendors: number;
  vendorsPending: number;
  changesPending: number;
  blacklisted: number;
  rateContracts: number;
  departments: number;
  departmentsSet: number;
  committee: number;
  gstinSet: boolean;
}

export interface PurchaseSettings {
  gstin: string | null;
  stateCode: string | null;
  state: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  piPrefix: string;
  prPrefix: string;
  poPrefix: string;
  directLimit: number;
  committeeLimit: number;
  committeeQuotes: number;
  committeeSignatures: number | null;
  emergencyEnabled: boolean;
  emergencyRatifier: string;
  poTerms: string | null;
  poValidityDays: number;
  purchaseDepartmentId: string | null;
  poSignatures: string[];
  largePoAlert: number | null;
  splitWindowDays: number;
  stockGstInCost: boolean;
  receiptTolerancePct: number;
  updatedAt: string;
  committee: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    designation: string | null;
    role: string | null;
  }>;
}

export type PurchaseDoc = 'indent' | 'requisition' | 'order' | 'inspection';
export const DOC_LABEL: Record<PurchaseDoc, string> = {
  indent: 'Purchase Indent (PI)',
  requisition: 'Purchase Requisition (PR)',
  order: 'Purchase Order (PO)',
  inspection: 'Inspection of goods and services received',
};

export interface DepartmentApprovals {
  departments: Array<{
    id: string;
    code: string;
    name: string;
    hod: { id: string; code: string; name: string; signsIn: boolean } | null;
    rules: { bypassLimit: number; rateContractBypass: boolean };
    levels: Record<
      PurchaseDoc,
      Array<{
        name: string;
        by: 'employees' | 'designation' | 'hod';
        employeeIds: string[];
        designation: string | null;
        slaHours: number | null;
      }>
    >;
  }>;
  staff: Array<{
    id: string;
    code: string;
    name: string;
    designation: string | null;
    department: string | null;
    signsIn: boolean;
  }>;
  designations: Array<{ name: string; holders: number }>;
}

export const VENDOR_STATUS: Record<
  VendorStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'neutral' },
  blacklisted: { label: 'Blacklisted', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const VENDOR_KIND = {
  manufacturer: 'Manufacturer',
  dealer: 'Dealer / supplier',
  service_provider: 'Service provider',
} as const;

export const GST_STATUS = {
  regular: 'Registered (regular)',
  composition: 'Registered (composition: charges no GST)',
  unregistered: 'Not registered for GST',
} as const;

export const DOC_KIND = {
  gst_certificate: 'GST certificate',
  pan_card: 'PAN card',
  cancelled_cheque: 'Cancelled cheque',
  udyam_certificate: 'Udyam (MSME) certificate',
  agreement: 'Agreement',
  other: 'Other',
} as const;

/** The GST state codes (as the API's gstin.ts). */
export const GST_STATES: Array<[string, string]> = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
  ['97', 'Other Territory'],
];

export const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ---- part 2: the Purchase Indent ------------------------------------------------------------------
export type IndentStatus =
  'draft' | 'submitted' | 'approved' | 'rejected' | 'sent_back' | 'cancelled';
export type IndentRoute = 'to_requisition' | 'to_order' | 'in_requisition' | 'ordered' | 'closed';

export const INDENT_STATUS: Record<
  IndentStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'info' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  sent_back: { label: 'Sent back for changes', tone: 'warning' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};

export const INDENT_ROUTE: Record<IndentRoute, string> = {
  to_requisition: 'Waiting for the PR',
  to_order: 'PR skipped: waiting for the PO',
  in_requisition: 'On a PR',
  ordered: 'Ordered',
  closed: 'Closed',
};

export const RATE_SOURCE: Record<string, string> = {
  contract: 'Rate contract',
  last: 'Last purchase',
  typed: 'Typed',
};

export interface IndentRow {
  id: string;
  number: string | null;
  departmentId: string;
  department: string;
  raisedBy: string;
  raisedById: string;
  onBehalfEmployeeId: string | null;
  onBehalf: string | null;
  purpose: string;
  requiredBy: string | null;
  priority: 'normal' | 'urgent';
  status: IndentStatus;
  route: IndentRoute | null;
  bypassRule: 'rate_contract' | 'under_limit' | null;
  bypassNote: string | null;
  estimate: number;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  waitingWith: string | null;
  lines: number;
}

export interface IndentStep {
  id: string;
  level: number;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  assignees: Array<{ id: string; name: string }>;
  /** the approver's name */
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  dueAt: string | null;
  overdue: boolean;
}

export interface IndentDetail extends IndentRow {
  lineItems: Array<{
    id: string;
    seq: number;
    itemId: string | null;
    itemCode: string | null;
    item: string;
    inCatalogue: boolean;
    quantity: number;
    uom: string;
    uomId: string;
    estRate: number;
    amount: number;
    rateSource: 'contract' | 'last' | 'typed';
    contractVendor: string | null;
    note: string | null;
  }>;
  departmentSpendThisYear: number;
  requisitions: Array<{ id: string; number: string; autoRule: string | null; status: string }>;
  steps: IndentStep[];
  history: Array<{
    kind: string;
    actor: string | null;
    note: string | null;
    detail: Record<string, unknown>;
    at: string;
  }>;
  can: { edit: boolean; submit: boolean; cancel: boolean; decide: boolean };
}

export interface IndentFormLists {
  departments: Array<{ id: string; name: string }>;
  myDepartmentIds: string[];
  anyDepartment: boolean;
  items: Array<{
    id: string;
    code: string;
    name: string;
    category: string;
    uomId: string;
    uom: string;
    decimals: boolean;
    lastRate: number | null;
    contractRate: number | null;
    contractVendor: string | null;
  }>;
  uoms: Array<{ id: string; code: string; name: string; decimals: boolean }>;
  staff: Array<{ id: string; code: string; name: string }>;
}

export interface PurchaseDelegation {
  id: string;
  from: string;
  to: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  revoked: boolean;
  active: boolean;
  mine: boolean;
}

// ---- part 3: the Purchase Requisition -------------------------------------------------------------
export type RequisitionStatus =
  | 'draft'
  | 'sourcing'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'sent_back'
  | 'cancelled'
  | 'part_ordered'
  | 'ordered';
export type Tier = 'none' | 'direct' | 'committee' | 'tender';

export const REQUISITION_STATUS: Record<
  RequisitionStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'info' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sourcing: { label: 'Sourcing', tone: 'info' },
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  sent_back: { label: 'Sent back for changes', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  part_ordered: { label: 'Partly ordered', tone: 'info' },
  ordered: { label: 'Ordered', tone: 'success' },
};

export const TIER: Record<Tier, { label: string; help: string }> = {
  none: {
    label: 'From the store',
    help: 'Nothing is bought: every line is issued from the store.',
  },
  direct: {
    label: 'Direct purchase',
    help: 'One vendor and rate per line, and the purchase officer’s reasonable-price certificate.',
  },
  committee: {
    label: 'Purchase committee',
    help: 'Quotes from several vendors, the comparative statement (the lowest marked L1), a reason for a dearer choice, and the committee’s signatures.',
  },
  tender: {
    label: 'Tender',
    help: 'Run the tender outside EduPro; record its reference, attach its documents and enter the chosen vendor and rates.',
  },
};

export interface RequisitionRow {
  id: string;
  number: string;
  departmentId: string | null;
  department: string | null;
  combined: boolean;
  purpose: string | null;
  requiredBy: string | null;
  status: RequisitionStatus;
  tier: Tier | null;
  autoRule: string | null;
  autoNote: string | null;
  estimate: number;
  submittedAt: string | null;
  decidedAt: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  revision: number;
  createdBy: string | null;
  createdAt: string;
  waitingWith: string | null;
  lines: number;
  quotes: number;
}

export interface RequisitionLine {
  id: string;
  seq: number;
  itemId: string | null;
  itemCode: string | null;
  item: string;
  inCatalogue: boolean;
  quantity: number;
  uomId: string;
  uom: string;
  decimals: boolean;
  estRate: number;
  fulfil: 'buy' | 'store';
  storeNote: string | null;
  storeId: string | null;
  store: string | null;
  stockTracked: boolean;
  /** in the store unit: in hand, reserved by everyone, held for this line, issued against it */
  stock: {
    perUnit: number;
    inStore: number;
    reserved: number;
    held: number;
    issued: number;
  } | null;
  note: string | null;
  vendorId: string | null;
  vendor: string | null;
  rate: number | null;
  gstRate: number | null;
  amount: number;
  choiceReason: string | null;
  fromContract: boolean;
  itemGst: number | null;
  l1: { landed: number; vendorIds: string[] } | null;
  dearer: boolean;
  sources: Array<{
    indentId: string;
    number: string;
    department: string;
    raisedBy: string;
    quantity: number;
  }>;
}

export interface Quote {
  id: string;
  vendorId: string;
  vendor: string;
  vendorCode: string;
  vendorStatus: string;
  gstStatus: 'regular' | 'composition' | 'unregistered';
  msmeType: string | null;
  quoteRef: string | null;
  quoteDate: string | null;
  validUntil: string | null;
  deliveryDays: number | null;
  fileId: string | null;
  note: string | null;
  lines: Array<{
    lineId: string;
    rate: number;
    gstRate: number;
    landed: number;
    note: string | null;
  }>;
  total: number;
  quotedAll: boolean;
}

export interface RequisitionDetail extends Omit<RequisitionRow, 'quotes'> {
  limits: { direct: number; committee: number; quotes: number };
  value: number;
  certificate: { text: string; by: string | null; at: string | null } | null;
  certificateText: string;
  tender: { ref: string | null; note: string | null };
  files: Array<{ id: string; fileId: string; kind: string; uploadedAt: string }>;
  lineItems: RequisitionLine[];
  quotes: Quote[];
  committee: {
    required: number;
    members: Array<{
      employeeId: string;
      name: string;
      designation: string | null;
      role: string | null;
      signsIn: boolean;
      signedAt: string | null;
      note: string | null;
      me: boolean;
    }>;
  };
  requirements: Array<{ key: string; label: string; met: boolean }>;
  orders: Array<{ id: string; label: string; status: OrderStatus; total: number; vendor: string }>;
  steps: IndentStep[];
  history: Array<{ kind: string; actor: string | null; note: string | null; at: string }>;
  can: {
    edit: boolean;
    submit: boolean;
    cancel: boolean;
    reopen: boolean;
    decide: boolean;
    sign: boolean;
    unsign: boolean;
  };
}

export interface RequisitionCandidate {
  id: string;
  number: string;
  departmentId: string;
  department: string;
  purpose: string;
  requiredBy: string | null;
  priority: 'normal' | 'urgent';
  estimate: number;
  approvedAt: string | null;
  note: string | null;
  raisedBy: string;
  lines: Array<{ item: string; quantity: number; uom: string; inCatalogue: boolean }>;
}

export interface RequisitionFormLists {
  departments: Array<{ id: string; name: string }>;
  items: Array<{
    id: string;
    code: string;
    name: string;
    category: string;
    uomId: string;
    uom: string;
    decimals: boolean;
    rate: number | null;
    gstRate: number | null;
    stockTracked: boolean;
    perUnit: number;
    storeUom: string;
  }>;
  stores: Array<{ id: string; code: string; name: string }>;
  /** in the store unit */
  stock: Array<{ storeId: string; itemId: string; qty: number; reserved: number }>;
  uoms: Array<{ id: string; code: string; name: string; decimals: boolean }>;
  vendors: Array<{
    id: string;
    code: string;
    name: string;
    gstStatus: 'regular' | 'composition' | 'unregistered';
    msmeType: string | null;
  }>;
}

// ---- part 4: the Purchase Order -------------------------------------------------------------------
export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent'
  | 'closed'
  | 'rejected'
  | 'sent_back'
  | 'cancelled'
  | 'superseded';

export const ORDER_STATUS: Record<
  OrderStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'info' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved: to send', tone: 'info' },
  sent: { label: 'Sent to the vendor', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  rejected: { label: 'Rejected', tone: 'danger' },
  sent_back: { label: 'Sent back for changes', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  superseded: { label: 'Replaced by an amendment', tone: 'neutral' },
};
/** An emergency purchase's statuses read as ratification. */
export const EMERGENCY_STATUS: Partial<Record<OrderStatus, string>> = {
  draft: 'Recorded: send for ratification',
  submitted: 'Waiting for ratification',
  approved: 'Ratified',
  rejected: 'Not ratified',
};

export const CHARGE_KIND = {
  freight: 'Freight',
  installation: 'Installation',
  packing: 'Packing',
  other: 'Other',
} as const;

export interface OrderRow {
  id: string;
  number: string;
  revision: number;
  label: string;
  supersedesId: string | null;
  newerId: string | null;
  amendReason: string | null;
  status: OrderStatus;
  emergency: boolean;
  requisitionId: string | null;
  requisition: string | null;
  departmentId: string | null;
  department: string | null;
  vendorId: string;
  vendor: string;
  vendorCode: string;
  total: number;
  poDate: string;
  deliveryDate: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  decidedAt: string | null;
  sentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  waitingWith: string | null;
  msmeWarning: string | null;
  lines: number;
  receiptStatus: 'none' | 'part' | 'received';
  receipts: number;
}

export const RECEIPT_STATUS_OF_ORDER: Record<OrderRow['receiptStatus'], string> = {
  none: 'Nothing received yet',
  part: 'Part received',
  received: 'Received',
};

export interface OrderLine {
  id: string;
  seq: number;
  requisitionLineId: string | null;
  itemId: string | null;
  itemCode: string | null;
  description: string;
  hsnCode: string | null;
  quantity: number;
  maxQuantity: number | null;
  uomId: string;
  uom: string;
  rate: number;
  discountPct: number;
  gstRate: number;
  reverseCharge: boolean;
  exempt: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  rcm: number;
  total: number;
  contractRate: number | null;
  rateChangeReason: string | null;
  received: number;
  accepted: number;
  rejected: number;
  returned: number;
}

export interface OrderDetail extends OrderRow {
  emergencyReason: string | null;
  billFileId: string | null;
  billRef: string | null;
  vendorStatus: string;
  vendorEmail: string | null;
  vendorGstStatus: 'regular' | 'composition' | 'unregistered';
  vendorDetail: {
    gstin: string | null;
    pan: string | null;
    address: string | null;
    state: string | null;
    msme: string | null;
    phone: string | null;
  };
  supply: 'intra' | 'inter';
  quoteRef: string | null;
  deliveryAddress: string | null;
  paymentTermId: string | null;
  paymentText: string | null;
  validityDays: number;
  validUntil: string;
  terms: string | null;
  totals: {
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    rcm: number;
    roundOff: number;
    total: number;
  };
  words: string;
  decisionNote: string | null;
  closedAt: string | null;
  closedNote: string | null;
  lineItems: OrderLine[];
  charges: Array<{
    id: string;
    kind: keyof typeof CHARGE_KIND;
    label: string;
    ownLabel: string | null;
    amount: number;
    gstRate: number;
    gst: number;
    total: number;
  }>;
  summary: Array<{
    hsn: string | null;
    gstRate: number;
    reverseCharge: boolean;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    rcm: number;
  }>;
  revisions: Array<{
    id: string;
    revision: number;
    label: string;
    status: OrderStatus;
    approvedAt: string | null;
  }>;
  sends: Array<{
    id: string;
    to: string;
    at: string;
    by: string | null;
    messageStatus: string | null;
    fileId: string | null;
  }>;
  paymentTerms: Array<{ id: string; name: string }>;
  steps: IndentStep[];
  history: Array<{ kind: string; actor: string | null; note: string | null; at: string }>;
  can: {
    edit: boolean;
    submit: boolean;
    decide: boolean;
    send: boolean;
    close: boolean;
    amend: boolean;
    cancel: boolean;
    receive: boolean;
  };
  receiptList: Array<{
    id: string;
    number: string;
    kind: 'goods' | 'service';
    status: ReceiptStatus;
    receivedOn: string;
    acceptedOn: string | null;
    store: string | null;
    by: string | null;
  }>;
}

export interface ToOrderGroup {
  requisitionId: string;
  number: string;
  department: string | null;
  autoRule: string | null;
  requiredBy: string | null;
  vendorId: string | null;
  vendor: string | null;
  vendorActive: boolean;
  lines: Array<{
    id: string;
    seq: number;
    item: string;
    quantity: number;
    uom: string;
    rate: number;
  }>;
}

export interface OrderFormLists {
  vendors: Array<{
    id: string;
    code: string;
    name: string;
    gstStatus: string;
    email: string | null;
  }>;
  items: Array<{
    id: string;
    code: string;
    name: string;
    uomId: string;
    uom: string;
    gstRate: number | null;
  }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  emergencyEnabled: boolean;
  emergencyRatifier: string;
  purchaseDepartmentId: string | null;
}

// ---- part 5: reports and the dashboard ------------------------------------------------------------
export type PurchaseReport =
  | 'pi_register'
  | 'pr_register'
  | 'po_register'
  | 'tracker'
  | 'pending'
  | 'overrides'
  | 'department_spend'
  | 'vendor_purchases'
  | 'item_history'
  | 'comparative'
  | 'gst_summary'
  | 'msme_vendors'
  | 'grn_register'
  | 'pending_deliveries'
  | 'consumption'
  | 'slow_moving'
  | 'expiring'
  | 'below_reorder'
  | 'transfers'
  | 'count_differences';

type Filter = 'period' | 'department' | 'vendor' | 'item' | 'status';
/** Each report: what it shows and the filters it takes (status: the choices). */
export const REPORTS: Record<
  PurchaseReport,
  { help: string; filters: Filter[]; status?: Record<string, string> }
> = {
  pi_register: {
    help: 'Every indent sent in the period: department, raiser, estimate, status and where it went.',
    filters: ['period', 'department', 'vendor', 'item', 'status'],
    status: {
      submitted: 'Waiting for approval',
      approved: 'Approved',
      rejected: 'Rejected',
      sent_back: 'Sent back',
      cancelled: 'Withdrawn',
    },
  },
  pr_register: {
    help: 'Every requisition: its sourcing tier, quotes, vendors chosen, value and status.',
    filters: ['period', 'department', 'vendor', 'item', 'status'],
    status: {
      draft: 'Draft',
      sourcing: 'Sourcing',
      submitted: 'Waiting for approval',
      approved: 'Approved',
      part_ordered: 'Partly ordered',
      ordered: 'Ordered',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
    },
  },
  po_register: {
    help: 'Every purchase order by PO date: vendor, taxable value, GST, reverse charge, total, status and revision.',
    filters: ['period', 'department', 'vendor', 'item', 'status'],
    status: {
      placed: 'Placed (approved, sent or closed)',
      draft: 'Draft',
      submitted: 'Waiting for approval',
      approved: 'Approved',
      sent: 'Sent to the vendor',
      closed: 'Closed',
      cancelled: 'Cancelled',
      superseded: 'Replaced by an amendment',
      rejected: 'Rejected',
    },
  },
  tracker: {
    help: 'Each indent line to its requisition and order, with the vendor and when it was ordered.',
    filters: ['period', 'department', 'vendor', 'item', 'status'],
    status: { submitted: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' },
  },
  pending: {
    help: 'Indents, requisitions and orders waiting for approval now: with whom, their delegate, since when, and whether past the SLA.',
    filters: ['department'],
  },
  overrides: {
    help: 'What an auditor asks about: requisitions skipped by a rule, the split guard, vendors other than the lowest, emergency purchases, cancelled and amended orders, contract rates changed.',
    filters: ['period', 'department', 'status'],
    status: {
      rate_contract: 'PR skipped: rate contract',
      under_limit: 'PR skipped: under the limit',
      split_guard: 'Split guard: PR not skipped',
      not_l1: 'Vendor not the lowest (L1)',
      emergency: 'Emergency purchase',
      cancelled: 'Order cancelled after approval',
      amended: 'Order amended',
      contract_rate: 'Contract rate changed',
    },
  },
  department_spend: {
    help: 'Placed orders (approved, sent, closed) by department and month.',
    filters: ['period', 'department', 'vendor'],
  },
  vendor_purchases: {
    help: 'Placed orders per vendor: how many, taxable value, GST, total, the MSME type.',
    filters: ['period', 'department', 'vendor'],
  },
  item_history: {
    help: 'An item’s purchases on placed orders: dates, vendors, quantities and rates.',
    filters: ['period', 'department', 'vendor', 'item'],
  },
  comparative: {
    help: 'Every quote on every requisition line: the rate with GST, L1, the vendor chosen and why, the committee’s signatures.',
    filters: ['period', 'department', 'vendor', 'item'],
  },
  gst_summary: {
    help: 'The GST on placed orders by HSN / SAC and rate; reverse charge (paid by the school) apart.',
    filters: ['period', 'department', 'vendor'],
  },
  msme_vendors: {
    help: 'Micro, small and medium vendors, their payment terms (over 45 days marked) and the orders placed.',
    filters: ['period', 'vendor'],
  },
  grn_register: {
    help: 'Every goods receipt and completion certificate by the day received: the order, vendor, store, challan or invoice, the value accepted, status, and the MSME deemed-acceptance date of those not inspected.',
    filters: ['period', 'department', 'vendor', 'item', 'status'],
    status: {
      inspecting: 'Waiting for inspection',
      accepted: 'Accepted',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      goods: 'Goods received only',
      service: 'Completion certificates only',
    },
  },
  pending_deliveries: {
    help: 'Lines of approved and sent orders still to come (by PO date): ordered, received, accepted, rejected, still to come, the delivery date and days late.',
    filters: ['period', 'department', 'vendor', 'item', 'status'],
    status: { late: 'Late only' },
  },
  consumption: {
    help: 'What each department was issued in the period, by item: issues, quantity and value, less what came back to the store.',
    filters: ['period', 'department', 'item'],
  },
  slow_moving: {
    help: 'Items in stock with no issue for a while (dead stock when never issued): in hand, value, the last issue and receipt.',
    filters: ['item', 'status'],
    status: {
      n90: 'No issue in 90 days',
      n180: 'No issue in 180 days',
      n365: 'No issue in a year',
    },
  },
  expiring: {
    help: 'Batches in stock expiring soon (or already expired): store, batch, expiry, days left, quantity and value.',
    filters: ['item', 'status'],
    status: {
      d30: 'Within 30 days',
      d60: 'Within 60 days',
      d90: 'Within 90 days',
      expired: 'Expired already',
    },
  },
  below_reorder: {
    help: 'Items whose free stock (in hand less reserved) is at or below the store’s reorder level, with what is on order.',
    filters: ['item'],
  },
  transfers: {
    help: 'Transfers between stores sent in the period: from, to, value, status; in transit until received.',
    filters: ['period', 'status'],
    status: { in_transit: 'In transit', received: 'Received', cancelled: 'Cancelled' },
  },
  count_differences: {
    help: 'Differences found by approved physical counts: book, counted, difference, value and the reason.',
    filters: ['period', 'item'],
  },
};

export interface ReportColumn {
  label: string;
  type?: 'text' | 'number' | 'money' | 'date';
  width?: number;
}
export interface ReportResult {
  report: PurchaseReport;
  name: string;
  words: string;
  columns: ReportColumn[];
  rows: Array<Array<string | number | null>>;
  totals?: Array<string | number | null>;
  more: number;
  links?: Array<string | null>;
  from: string;
  to: string;
}
export interface ReportFilters {
  departments: Array<{ id: string; name: string }>;
  vendors: Array<{ id: string; code: string; name: string }>;
  items: Array<{ id: string; code: string; name: string }>;
  reports: Record<PurchaseReport, string>;
}

export interface PurchaseDashboard {
  fyFrom: string;
  monthFrom: string;
  today: string;
  figures: {
    openIndents: number;
    pending: number;
    toRequisition: number;
    toOrder: number;
    ordersThisMonth: number;
    ordersThisMonthValue: number;
    ordersThisYearValue: number;
    emergencyWaiting: number;
    inspecting: number;
    deemedAccepted: number;
    lateOrders: number;
    toReceive: number;
    acceptedThisMonthValue: number;
    stockValue: number;
    belowReorder: number;
  };
  largePoAlert: number | null;
  oldestPending: Array<{
    kind: string;
    label: string;
    department: string | null;
    amount: number;
    level: string;
    waitingWith: string;
    since: string;
    days: number;
    overdue: boolean;
    href: string | null;
  }>;
  largest: Array<{
    id: string;
    label: string;
    vendor: string;
    department: string | null;
    date: string;
    total: number;
  }>;
  overAlert: Array<{ id: string; label: string; vendor: string; date: string; total: number }>;
  byDepartment: Array<{ department: string; total: number }>;
  byMonth: Array<{ month: string; label: string; total: number }>;
}

// ---- phase 2, part 6: stores and stock (docs/design/84) -------------------------------------------
export interface Store {
  id: string;
  code: string;
  name: string;
  kind: 'main' | 'sub';
  parent: string | null;
  departmentId: string | null;
  department: string | null;
  location: string | null;
  status: 'active' | 'inactive';
  items: number;
  value: number;
  belowReorder: number;
  mine: boolean;
  keepers: Array<{ id: string; code: string; name: string }>;
}

export interface StockRow {
  storeId: string;
  store: string;
  itemId: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  tracksBatch: boolean;
  qty: number;
  reserved: number;
  free: number;
  value: number;
  avgRate: number;
  reorderLevel: number | null;
  reorderQty: number | null;
  maxQty: number | null;
  below: boolean;
  lastMoveOn: string | null;
  earliestExpiry: string | null;
}

export interface StoreDetail extends Store {
  stock: StockRow[];
  counts: Array<{ id: string; number: string; status: CountStatus; countedOn: string }>;
  countedThisYear: boolean;
  can: { manage: boolean; operate: boolean };
}

export interface StoreFormLists {
  employees: Array<{ id: string; code: string; name: string; designation: string | null }>;
  departments: Array<{ id: string; name: string }>;
  items: Array<{ id: string; code: string; name: string; unit: string; tracksBatch: boolean }>;
}

export interface StockLedger {
  item: {
    id: string;
    code: string;
    name: string;
    unit: string;
    purchaseUnit: string;
    perUnit: number;
    tracksBatch: boolean;
    tracked: boolean;
  };
  balances: StockRow[];
  batches: Array<{ store: string; batch: string; expiry: string | null; qty: number }>;
  moves: Array<{
    id: string;
    day: string;
    store: string;
    kind: string;
    what: string;
    qty: number;
    rate: number;
    value: number;
    balanceQty: number;
    balanceValue: number;
    batch: string | null;
    expiry: string | null;
    note: string | null;
    by: string | null;
  }>;
}

// ---- phase 2, part 7: goods receipts and completion certificates (docs/design/84) ------------------
export type ReceiptStatus = 'inspecting' | 'accepted' | 'rejected' | 'cancelled';
export const RECEIPT_STATUS: Record<
  ReceiptStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  inspecting: { label: 'Waiting for inspection', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const RECEIPT_KIND = {
  goods: 'Goods receipt (GRN)',
  service: 'Completion certificate',
} as const;

export interface ReceiptRow {
  id: string;
  number: string;
  kind: 'goods' | 'service';
  status: ReceiptStatus;
  inspection: 'department' | 'committee';
  orderId: string;
  order: string;
  departmentId: string | null;
  department: string | null;
  vendor: string;
  vendorCode: string;
  msme: string | null;
  storeId: string | null;
  store: string | null;
  receivedOn: string;
  challanNo: string | null;
  challanDate: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  hasFile: boolean;
  note: string | null;
  acceptedOn: string | null;
  deemedOn: string;
  overdue: boolean;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: string;
  waitingWith: string | null;
  lines: number;
  acceptedValue: number;
}

export interface ReceiptLine {
  id: string;
  seq: number;
  orderLineId: string;
  poSeq: number;
  description: string;
  itemCode: string | null;
  uom: string;
  storeUom: string | null;
  perUnit: number;
  ordered: number;
  received: number;
  refused: number;
  refusedReason: string | null;
  batch: string | null;
  expiry: string | null;
  serials: string[];
  workDone: string | null;
  accepted: number | null;
  rejected: number | null;
  rejectReason: string | null;
  rejectedSerials: string[];
  unitCost: number | null;
  value: number | null;
  stockTracked: boolean;
}

export interface ReceiptDetail extends ReceiptRow {
  lineItems: ReceiptLine[];
  steps: IndentStep[];
  history: Array<{ kind: string; actor: string | null; note: string | null; at: string }>;
  committee: {
    required: number;
    members: Array<{
      name: string;
      designation: string | null;
      role: string | null;
      signedAt: string | null;
      me: boolean;
    }>;
  } | null;
  issues: Array<{
    id: string;
    number: string;
    department: string;
    indent: string | null;
    indentId: string | null;
    status: 'issued' | 'acknowledged';
    lines: number;
    value: number;
  }>;
  can: { inspect: boolean; cancel: boolean };
  madeByMe: boolean;
}

export interface ReceiptForm {
  order: {
    id: string;
    label: string;
    status: string;
    vendor: string;
    department: string | null;
    poDate: string;
    deliveryDate: string | null;
    total: number;
  };
  madeByMe: boolean;
  inspection: 'department' | 'committee';
  tolerancePct: number;
  mainStoreId: string;
  stores: Array<{ id: string; code: string; name: string; kind: string }>;
  lines: Array<{
    id: string;
    seq: number;
    description: string;
    itemCode: string | null;
    uom: string;
    storeUom: string | null;
    perUnit: number;
    ordered: number;
    received: number;
    accepted: number;
    rejected: number;
    waiting: number;
    outstanding: number;
    max: number;
    service: boolean;
    stockTracked: boolean;
    tracksBatch: boolean;
    tracksSerial: boolean;
  }>;
}

export interface ToReceiveRow {
  id: string;
  label: string;
  vendor: string;
  department: string | null;
  poDate: string;
  deliveryDate: string | null;
  late: boolean;
  receiptStatus: 'none' | 'part' | 'received';
  lines: number;
  openLines: number;
  goods: boolean;
  services: boolean;
  madeByMe: boolean;
}

// ---- phase 2, part 8: issues, returns, transfers, counts (docs/design/84) ---------------------------
export interface IssueRow {
  id: string;
  number: string;
  kind: 'receipt' | 'indent' | 'counter';
  kindLabel: string;
  status: 'issued' | 'acknowledged';
  storeId: string;
  store: string;
  departmentId: string;
  department: string;
  indentId: string | null;
  indent: string | null;
  requisitionId: string | null;
  requisition: string | null;
  receiptId: string | null;
  receipt: string | null;
  takenById: string | null;
  takenBy: string | null;
  purpose: string | null;
  issuedOn: string;
  issuedBy: string | null;
  ackOnPaper: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
  lines: number;
  value: number;
  receiver: boolean;
}
export interface IssueDetail extends IssueRow {
  lineItems: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    item: string;
    unit: string;
    qty: number;
    rate: number;
    value: number;
    batch: string | null;
    returned: number;
    returnable: number;
    indent: string | null;
  }>;
  returns: Array<{
    id: string;
    number: string;
    returnedOn: string;
    lines: number;
    by: string | null;
  }>;
  can: { acknowledge: boolean; acknowledgeOnPaper: boolean; returnToStore: boolean };
}
export interface ToIssueGroup {
  requisitionId: string;
  requisition: string;
  storeId: string;
  store: string;
  department: string | null;
  purpose: string | null;
  indents: string | null;
  approvedAt: string | null;
  lines: Array<{
    reservationId: string;
    itemId: string;
    itemCode: string;
    item: string;
    unit: string;
    tracksBatch: boolean;
    reserved: number;
    issued: number;
    toIssue: number;
    inHand: number;
  }>;
}
export interface IssueFormLists {
  stores: Array<{ id: string; code: string; name: string }>;
  stock: Array<{
    storeId: string;
    itemId: string;
    code: string;
    name: string;
    unit: string;
    tracksBatch: boolean;
    qty: number;
    reserved: number;
    free: number;
  }>;
  batches: Array<{
    storeId: string;
    itemId: string;
    batch: string;
    expiry: string | null;
    qty: number;
  }>;
  departments: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; code: string; name: string; department: string | null }>;
}
export interface ReturnRow {
  id: string;
  number: string;
  kind: 'to_store' | 'to_vendor';
  store: string;
  returnedOn: string;
  department: string | null;
  vendor: string | null;
  doc: string | null;
  docId: string | null;
  lines: number;
  value: number;
  by: string | null;
}
export interface ReturnDetail {
  id: string;
  number: string;
  kind: 'to_store' | 'to_vendor';
  store: string;
  returnedOn: string;
  department: string | null;
  vendor: string | null;
  issue: string | null;
  issueId: string | null;
  order: string | null;
  orderId: string | null;
  dispatch: string | null;
  note: string | null;
  by: string | null;
  lineItems: Array<{
    id: string;
    item: string;
    unit: string;
    source: 'issue' | 'rejected' | 'stock';
    condition: 'unused' | 'damaged' | null;
    qty: number;
    rate: number;
    value: number;
    batch: string | null;
    reason: string | null;
    replacement: boolean;
    receipt: string | null;
  }>;
}
export interface Returnable {
  order: { id: string; label: string; vendor: string; status: string };
  lines: Array<{
    receiptLineId: string;
    receipt: string;
    receiptId: string;
    store: string;
    storeId: string;
    item: string;
    unit: string;
    batch: string | null;
    rejected: number;
    rejectReason: string | null;
    rejectedLeft: number;
    accepted: number;
    stockLeft: number;
    inStore: number;
  }>;
}
export type TransferStatus = 'in_transit' | 'received' | 'cancelled';
export const TRANSFER_STATUS: Record<
  TransferStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  in_transit: { label: 'In transit', tone: 'warning' },
  received: { label: 'Received', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export interface TransferRow {
  id: string;
  number: string;
  status: TransferStatus;
  fromStoreId: string;
  fromStore: string;
  toStoreId: string;
  toStore: string;
  sentOn: string;
  receivedOn: string | null;
  note: string | null;
  receiveNote: string | null;
  sentBy: string | null;
  receivedBy: string | null;
  lines: number;
  value: number;
  receiver: boolean;
}
export interface TransferDetail extends TransferRow {
  lineItems: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    item: string;
    unit: string;
    qty: number;
    rate: number;
    value: number;
    batch: string | null;
    expiry: string | null;
  }>;
  can: { receive: boolean; cancel: boolean };
}
export type CountStatus = 'counting' | 'submitted' | 'approved' | 'cancelled';
export const COUNT_STATUS: Record<
  CountStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' | 'info' }
> = {
  counting: { label: 'Counting', tone: 'info' },
  submitted: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved: adjusted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export interface CountRow {
  id: string;
  number: string;
  status: CountStatus;
  storeId: string;
  store: string;
  categoryId: string | null;
  category: string | null;
  countedOn: string;
  countedBy: string | null;
  note: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  startedBy: string | null;
  lines: number;
  counted: number;
  differences: number;
  value: number;
}
export interface CountDetail extends CountRow {
  lineItems: Array<{
    id: string;
    itemId: string;
    itemCode: string;
    item: string;
    category: string;
    unit: string;
    tracksBatch: boolean;
    batch: string | null;
    expiry: string | null;
    book: number | null;
    counted: number | null;
    difference: number | null;
    reason: string | null;
    added: boolean;
    rate: number | null;
    value: number | null;
  }>;
  can: { count: boolean; submit: boolean; decide: boolean; cancel: boolean };
}
