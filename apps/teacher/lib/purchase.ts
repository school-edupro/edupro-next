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
  /** null for someone who does not see rates (a raiser without purchase rights) */
  estimate: number | null;
  /** the signed-in user sees rates and amounts: the purchase office, the admins, the PI's approvers */
  showRates: boolean;
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
    estRate: number | null;
    amount: number | null;
    rateSource: 'contract' | 'last' | 'typed' | null;
    contractVendor: string | null;
    note: string | null;
    /** the free stock in the main store and the department's stores when raised, in the store unit */
    stockFree: number | null;
    stockUom: string | null;
    stockStores: Array<{ store: string; free: number }>;
    /** why it is bought though the stores had enough */
    stockReason: string | null;
  }>;
  departmentSpendThisYear: number | null;
  requisitions: Array<{ id: string; number: string; autoRule: string | null; status: string }>;
  steps: IndentStep[];
  history: Array<{
    kind: string;
    actor: string | null;
    note: string | null;
    detail: Record<string, unknown>;
    at: string;
  }>;
  can: { edit: boolean; submit: boolean; cancel: boolean; decide: boolean; print: boolean };
}

export interface IndentFormLists {
  departments: Array<{ id: string; name: string }>;
  myDepartmentIds: string[];
  anyDepartment: boolean;
  /** the signed-in user sees and types rates (the purchase office); a raiser does not */
  showRates: boolean;
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
    stockTracked: boolean;
    /** the unit the store counts in, and how many of it make one of the item's unit */
    stockUom: string;
    perUnit: number;
    /** free stock (in hand less reserved) in the main store and the departments' stores */
    stock: Array<{
      storeId: string;
      store: string;
      main: boolean;
      departmentId: string | null;
      free: number;
    }>;
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
}

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
  };
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

// ---- phase 2, part 7: goods receipts and completion certificates to inspect (docs/design/84) -------
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
export interface ReceiptRow {
  id: string;
  number: string;
  kind: 'goods' | 'service';
  status: ReceiptStatus;
  inspection: 'department' | 'committee';
  orderId: string;
  order: string;
  department: string | null;
  vendor: string;
  vendorCode: string;
  store: string | null;
  receivedOn: string;
  challanNo: string | null;
  invoiceNo: string | null;
  hasFile: boolean;
  note: string | null;
  acceptedOn: string | null;
  deemedOn: string;
  overdue: boolean;
  decidedBy: string | null;
  decisionNote: string | null;
  createdBy: string | null;
  waitingWith: string | null;
  lines: number;
  acceptedValue: number;
}
export interface ReceiptDetail extends ReceiptRow {
  lineItems: Array<{
    id: string;
    seq: number;
    poSeq: number;
    description: string;
    itemCode: string | null;
    uom: string;
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
    value: number | null;
  }>;
  committee: {
    required: number;
    members: Array<{ name: string; signedAt: string | null; me: boolean }>;
  } | null;
  issues: Array<{
    id: string;
    number: string;
    department: string;
    indent: string | null;
    status: string;
  }>;
  can: { inspect: boolean; cancel: boolean };
}

// ---- phase 2, part 8: issues to acknowledge; my stores (docs/design/84) -----------------------------
export interface IssueRow {
  id: string;
  number: string;
  kindLabel: string;
  status: 'issued' | 'acknowledged';
  store: string;
  department: string;
  indent: string | null;
  takenBy: string | null;
  purpose: string | null;
  issuedOn: string;
  issuedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
  lines: number;
  value: number;
}
export interface IssueDetail extends IssueRow {
  lineItems: Array<{
    id: string;
    itemCode: string;
    item: string;
    unit: string;
    qty: number;
    batch: string | null;
    returned: number;
  }>;
  can: { acknowledge: boolean };
}

// ---- phase 2, part 9: assets in my care (docs/design/84) -----------------------------------------------
export interface MyAssets {
  rows: Array<{
    id: string;
    tag: string;
    item: string;
    serialNo: string | null;
    department: string | null;
    location: string | null;
    statusLabel: string;
    condition: string;
    warrantyUntil: string | null;
    pending: boolean;
  }>;
  pending: Array<{
    movementId: string;
    assetId: string;
    tag: string;
    item: string;
    from: string | null;
    note: string | null;
    movedOn: string;
  }>;
}
