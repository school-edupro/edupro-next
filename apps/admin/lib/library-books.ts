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
