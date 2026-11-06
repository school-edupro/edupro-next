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
