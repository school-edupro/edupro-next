/** Purchase Indents in the staff app (docs/design/83, part 2): the shapes read from the API, and labels. */

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
