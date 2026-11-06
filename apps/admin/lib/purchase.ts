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
  poTerms: string | null;
  poValidityDays: number;
  purchaseDepartmentId: string | null;
  poSignatures: string[];
  largePoAlert: number | null;
  splitWindowDays: number;
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

export type PurchaseDoc = 'indent' | 'requisition' | 'order';
export const DOC_LABEL: Record<PurchaseDoc, string> = {
  indent: 'Purchase Indent (PI)',
  requisition: 'Purchase Requisition (PR)',
  order: 'Purchase Order (PO)',
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
  }>;
  uoms: Array<{ id: string; code: string; name: string; decimals: boolean }>;
  vendors: Array<{
    id: string;
    code: string;
    name: string;
    gstStatus: 'regular' | 'composition' | 'unregistered';
    msmeType: string | null;
  }>;
}
