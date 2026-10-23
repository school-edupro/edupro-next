/** Library overview (library round 4, part 2): check one book and the library dashboard. */
export type CheckResult =
  | { kind: 'none'; titles: [] }
  | { kind: 'copy'; copyId: string }
  | {
      kind: 'titles';
      titles: Array<{
        id: string;
        title: string;
        subtitle: string | null;
        author: string | null;
        isbn: string | null;
        callNo: string | null;
        material: string | null;
        reference: boolean;
        copies: number;
        available: number;
        onLoan: number;
        reserved: number;
        nextDue: string | null;
        firstAccession: string | null;
      }>;
    };

export interface CopyCheck {
  copy: {
    id: string;
    accessionNo: string;
    barcode: string | null;
    formerNos: string | null;
    status: string;
    statusOn: string | null;
    statusReason: string | null;
    library: string;
    shelf: string | null;
    rack: string | null;
    price: number | null;
    acquisition: string | null;
    vendor: string | null;
    donor: string | null;
    billNo: string | null;
    billDate: string | null;
    accessionedOn: string | null;
    lastVerifiedOn: string | null;
    remarks: string | null;
  };
  title: {
    id: string;
    title: string;
    subtitle: string | null;
    author: string | null;
    isbn: string | null;
    callNo: string | null;
    edition: string | null;
    year: number | null;
    reference: boolean;
    material: string | null;
    subject: string | null;
    publisher: string | null;
    language: string | null;
  };
  loan: {
    id: string;
    borrowerKind: string;
    borrowerId: string;
    name: string | null;
    ref: string | null;
    place: string | null;
    issuedOn: string;
    dueOn: string;
    renewed: number;
    daysLate: number;
    fineSoFar: number;
  } | null;
  hold: {
    until: string | null;
    name: string | null;
    ref: string | null;
    place: string | null;
  } | null;
  queue: Array<{ since: string; name: string | null; ref: string | null; place: string | null }>;
  others: Array<{
    id: string;
    accessionNo: string;
    status: string;
    library: string;
    dueOn: string | null;
  }>;
  charges: Array<{
    kind: string;
    on: string;
    amount: number;
    reason: string | null;
    name: string | null;
    ref: string | null;
  }>;
  history: Array<{
    on: string;
    what: string;
    name: string | null;
    ref: string | null;
    place: string | null;
    detail: string | null;
    amount: number | null;
  }>;
}

export interface LibraryDashboard {
  libraries: Array<{ id: string; code: string; name: string }>;
  libraryId: string | null;
  figures: Record<
    | 'titles'
    | 'copies'
    | 'available'
    | 'onLoan'
    | 'overdue'
    | 'dueSoon'
    | 'lost'
    | 'damaged'
    | 'reservedWaiting'
    | 'reservedReady'
    | 'issuedToday'
    | 'returnedToday'
    | 'finesUnpaid'
    | 'addedThisMonth'
    | 'periodicalsDueToday'
    | 'periodicalsLate'
    | 'periodicalsMissing'
    | 'subscriptions',
    number
  >;
  months: Array<{ month: string; issued: number; returned: number; late: number; added: number }>;
  popular: Array<{ id: string; title: string; author: string | null; loans: number }>;
  readers: Array<{
    kind: string;
    id: string;
    name: string | null;
    ref: string | null;
    place: string | null;
    loans: number;
  }>;
  overdue: Array<{
    copyId: string;
    accessionNo: string;
    title: string;
    dueOn: string;
    days: number;
    kind: string;
    borrowerId: string;
    name: string | null;
    ref: string | null;
    place: string | null;
  }>;
  byLibrary: Array<{
    id: string;
    name: string;
    copies: number;
    available: number;
    onLoan: number;
    overdue: number;
  }>;
  matrix: {
    libraries: Array<{
      id: string;
      name: string;
      titles: number;
      copies: number;
      available: number;
      onLoan: number;
      overdue: number;
      lost: number;
      damaged: number;
      withdrawn: number;
      reservedReady: number;
      value: number;
    }>;
    titles: number;
    reservedWaiting: number;
  };
  byStatus: Array<{ status: string; copies: number }>;
  byMaterial: Array<{ name: string; copies: number; onLoan: number }>;
  bySubject: Array<{ name: string; copies: number; onLoan: number }>;
  year: Array<{ month: string; thisYear: number; lastYear: number; soFar: boolean }>;
  byClass: Array<{ id: string; name: string; pupils: number; borrowed: number }>;
}

export const HISTORY_LABEL: Record<string, string> = {
  issued: 'Issued',
  returned: 'Returned',
  'stock check': 'Stock check',
  accessioned: 'Accessioned',
  edited: 'Details changed',
  moved: 'Moved',
  withdrawn: 'Withdrawn',
  lost: 'Lost',
  lost_paid: 'Lost and paid',
  found: 'Found again',
  damaged: 'Damaged',
  available: 'Back in use',
  renumbered: 'Accession number corrected',
  sold: 'Sold',
};
