/** The book master (docs/design/36-library.md, part 2): what the API gives the admin screens. */
export const ROLES = ['Author', 'Editor', 'Translator', 'Illustrator'] as const;
export type Role = (typeof ROLES)[number];

export interface BookSetup {
  libraries: Array<{ id: string; code: string; name: string }>;
  materialTypes: Array<{ id: string; code: string; name: string; issuable: boolean }>;
  subjects: Array<{ id: string; name: string; classNo: string | null; subSubjects: string[] }>;
  languages: Array<{ id: string; name: string }>;
  shelves: Array<{
    id: string;
    libraryId: string;
    code: string;
    name: string | null;
    racks: string[];
  }>;
  vendors: Array<{ id: string; code: string; name: string }>;
  classes: Array<{ id: string; code: string; name: string }>;
  /** the next accession number of each series */
  series: Array<{ libraryId: string; materialTypeId: string; next: string }>;
  can: { manage: boolean };
}

export interface BookRow {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  material: string | null;
  subject: string | null;
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  callNo: string | null;
  copies: number;
  available: number;
  issued: number;
}

export interface BookCopy {
  id: string;
  accessionNo: string;
  accessionedOn: string;
  libraryId: string;
  library: string;
  shelfId: string | null;
  shelf: string | null;
  rack: string | null;
  barcode: string | null;
  status: CopyStatus;
  statusOn: string | null;
  statusReason: string | null;
  acquisition: 'Purchase' | 'Donation' | null;
  vendorId: string | null;
  vendor: string | null;
  donor: string | null;
  billNo: string | null;
  billDate: string | null;
  poNo: string | null;
  price: string | null;
  remarks: string | null;
  lastVerifiedOn: string | null;
  loan: { dueOn: string; borrower: string; ref: string; kind: string } | null;
}

export interface BookView {
  id: string;
  code: string;
  title: string;
  subtitle: string | null;
  people: Array<{ name: string; role: Role }>;
  materialTypeId: string | null;
  material: string | null;
  issuable: boolean;
  subjectId: string | null;
  subject: string | null;
  subSubject: string | null;
  callNo: string | null;
  keywords: string[];
  classId: string | null;
  class: string | null;
  publisher: string | null;
  publicationPlace: string | null;
  year: number | null;
  edition: string | null;
  volume: string | null;
  pages: number | null;
  isbn: string | null;
  languageId: string | null;
  language: string | null;
  price: string | null;
  isReference: boolean;
  notes: string | null;
  oldLocation: string | null;
  status: string;
  copies: BookCopy[];
  loans: Array<{
    id: string;
    accessionNo: string;
    kind: string;
    borrower: string;
    ref: string;
    issuedOn: string;
    dueOn: string;
    returnedOn: string | null;
    renewed: number;
    fine: number;
  }>;
  events: Array<{
    at: string;
    accessionNo: string;
    what: string;
    fromStatus: string | null;
    toStatus: string | null;
    on: string;
    reason: string | null;
    amount: string | null;
    by: string | null;
  }>;
  can: { manage: boolean };
}

export type CopyStatus = 'available' | 'issued' | 'lost' | 'damaged' | 'withdrawn' | 'sold';
export const COPY_STATUS: Record<CopyStatus, string> = {
  available: 'On the shelf',
  issued: 'Issued',
  lost: 'Lost',
  damaged: 'Damaged',
  withdrawn: 'Withdrawn',
  sold: 'Sold',
};
export const COPY_TONE: Record<CopyStatus, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> =
  {
    available: 'success',
    issued: 'info',
    lost: 'danger',
    damaged: 'warning',
    withdrawn: 'neutral',
    sold: 'neutral',
  };
/** What a copy's history calls each event. */
export const COPY_EVENT: Record<string, string> = {
  accessioned: 'Accessioned',
  edited: 'Details changed',
  moved: 'Moved',
  withdrawn: 'Withdrawn',
  lost: 'Lost',
  lost_paid: 'Lost and paid',
  found: 'Found again',
  damaged: 'Damaged',
  available: 'Back in use',
};
export const dmy = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
/** An ISBN as people read it: 978-0-306-40615-7 stays digits, grouped only by the hyphen after 978. */
export const isbnText = (s: string | null) =>
  !s ? '' : s.length === 13 ? `${s.slice(0, 3)}-${s.slice(3)}` : s;

/** A copy in the accession register (part 3). */
export interface RegisterRow {
  id: string;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string | null;
  library: string;
  shelf: string | null;
  rack: string | null;
  barcode: string | null;
  status: CopyStatus;
  accessionedOn: string;
  acquisition: string | null;
  price: string | null;
  lastVerifiedOn: string | null;
  borrower: string | null;
  dueOn: string | null;
}

/** A book upload (part 4): what it holds and how far it has gone. */
export interface ImportSummary {
  rows: number;
  newTitles: number;
  newCopies: number;
  updates: number;
  unchanged: number;
  errors: number;
  warnings: number;
  masters: {
    authors: number;
    publishers: number;
    subjects: number;
    languages: number;
    vendors: number;
    shelves: number;
  };
  done?: number;
  failed?: number;
  series?: Array<{ prefix: string; next: string }>;
}
export interface ImportListRow {
  id: string;
  fileName: string;
  layout: 'edupro' | 'legacy';
  status: 'checked' | 'importing' | 'done' | 'discarded';
  total: number;
  summary: ImportSummary;
  by: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface ImportView extends ImportListRow {
  ignoredColumns: string[];
  progress: { pending: number; done: number; failed: number; skipped: number };
  rows: Array<{
    line: number;
    kind: 'new_title' | 'new_copy' | 'update' | 'unchanged' | 'error';
    accessionNo: string | null;
    title: string | null;
    library: string | null;
    errors: string[];
    warnings: string[];
    changes: string[];
    state: 'pending' | 'done' | 'failed' | 'skipped';
    result: string | null;
  }>;
  page: { number: number; size: number; total: number };
}
export const IMPORT_KIND: Record<string, string> = {
  new_title: 'New title',
  new_copy: 'New copy',
  update: 'Update',
  unchanged: 'No change',
  error: 'Refused',
};
export const IMPORT_STATUS: Record<string, string> = {
  checked: 'Checked, not imported',
  importing: 'Importing',
  done: 'Imported',
  discarded: 'Discarded',
};

/** Labels (part 5): the sheets, the libraries, my last settings. */
export interface LabelSetup {
  presets: Array<{
    id: string;
    name: string;
    cols: number;
    rows: number;
    width: number;
    height: number;
    top: number;
    left: number;
    gapX: number;
    gapY: number;
  }>;
  libraries: Array<{ id: string; code: string; name: string }>;
  last: {
    kind?: 'barcode' | 'spine' | 'both';
    preset?: string;
    custom?: Record<string, number> | null;
    copies?: number;
    top?: 'library' | 'school' | 'none';
    showTitle?: boolean;
  } | null;
}
export interface LabelCount {
  copies: number;
  labels: number;
  sheets: number;
  first: string | null;
  last: string | null;
  missing: string[];
}

// ---- part 6: periodical subscriptions -------------------------------------------------------------------

export const FREQUENCIES = [
  'Daily',
  'Weekly',
  'Fortnightly',
  'Monthly',
  'Bi-monthly',
  'Quarterly',
  'Half-yearly',
  'Yearly',
] as const;
export interface SubscriptionSetup {
  periodicals: Array<{
    id: string;
    name: string;
    kind: string | null;
    frequency: string | null;
    vendorId: string | null;
    vendor: string | null;
  }>;
  libraries: Array<{ id: string; code: string; name: string }>;
  vendors: Array<{ id: string; code: string; name: string }>;
  can: { manage: boolean };
}
export type SubscriptionState = 'current' | 'upcoming' | 'ending' | 'ended' | 'cancelled';
export const SUBSCRIPTION_STATE: Record<SubscriptionState, string> = {
  current: 'Current',
  upcoming: 'Not started',
  ending: 'Ending soon',
  ended: 'Ended',
  cancelled: 'Cancelled',
};
export const SUBSCRIPTION_TONE: Record<
  SubscriptionState,
  'success' | 'info' | 'warning' | 'neutral'
> = {
  current: 'success',
  upcoming: 'info',
  ending: 'warning',
  ended: 'neutral',
  cancelled: 'neutral',
};
export interface SubscriptionRow {
  id: string;
  periodical: string;
  kind: string | null;
  frequency: string;
  library: string;
  vendor: string | null;
  startsOn: string;
  endsOn: string;
  copies: number;
  cost: string | null;
  state: SubscriptionState;
  due: number;
  received: number;
  missing: number;
  late: number;
  issues: number;
  nextOn: string | null;
}
export interface SubscriptionList {
  figures: { current: number; ending: number; late: number; toReceive: number; cost: number };
  data: SubscriptionRow[];
  can: { manage: boolean };
}
export interface PeriodicalIssue {
  id: string;
  expectedOn: string;
  label: string;
  special: boolean;
  status: 'expected' | 'received' | 'missing';
  late: boolean;
  receivedOn: string | null;
  copiesReceived: number | null;
  volume: string | null;
  issueNo: string | null;
  remarks: string | null;
  by: string | null;
}
export interface SubscriptionView {
  id: string;
  periodicalId: string;
  periodical: string;
  kind: string | null;
  issn: string | null;
  frequency: string;
  libraryId: string;
  library: string;
  vendorId: string | null;
  vendor: string | null;
  startsOn: string;
  endsOn: string;
  firstIssueOn: string;
  copies: number;
  cost: string | null;
  orderNo: string | null;
  billNo: string | null;
  billDate: string | null;
  graceDays: number;
  notes: string | null;
  status: string;
  state: SubscriptionState;
  cancelledOn: string | null;
  cancelReason: string | null;
  renewedFrom: string | null;
  renewedBy: string | null;
  issues: PeriodicalIssue[];
  can: { manage: boolean };
}
export interface DueIssue {
  id: string;
  expectedOn: string;
  label: string;
  special: boolean;
  subscriptionId: string;
  periodical: string;
  library: string;
  vendor: string | null;
  copies: number;
  late: boolean;
  days: number;
}
