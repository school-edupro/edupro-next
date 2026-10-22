import type { LibraryLoan } from './types';

/** The circulation desk (docs/design/36-library.md, "The circulation desk"). */
export interface DeskBorrower {
  kind: 'student' | 'employee';
  id: string;
  name: string;
  ref: string;
  place: string | null;
  rollNo: number | null;
  photoFileId: string | null;
  active: boolean;
  rule: { label: string; maxBooks: number; loanDays: number };
  holding: number;
  finesDue: number;
  chargesDue: number;
  blocked: string | null;
  loans: LibraryLoan[];
}
export interface DeskMatch {
  kind: 'student' | 'employee';
  id: string;
  name: string;
  ref: string;
  place: string | null;
}
export interface DeskBook {
  copyId: string;
  accessionNo: string;
  title: string;
  author: string | null;
  subject: string | null;
  material: string | null;
  library: string;
  status: string;
  formerly: string | null;
}
export interface DeskLookup {
  book: DeskBook;
  problem: string | null;
  loan:
    (LibraryLoan & { place: string | null; rollNo: number | null; renewalsLeft: number }) | null;
  fine: number;
}
export interface DeskClassRow {
  loanId: string;
  accessionNo: string;
  barcode: string | null;
  title: string;
  author: string | null;
  studentId: string;
  student: string;
  admissionNo: string;
  place: string;
  rollNo: number | null;
  issuedOn: string;
  dueOn: string;
  daysOverdue: number;
}
export interface DeskClass {
  id: string;
  name: string;
  sections: Array<{ id: string; name: string }>;
}
export const dmy = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
export const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A returned copy kept for someone's reservation, in words for the desk. */
export const holdNote = (l: Pick<LibraryLoan, 'accessionNo' | 'hold'>) =>
  l.hold
    ? `Keep ${l.accessionNo} aside: ${l.hold.borrower} (${l.hold.ref}) reserved it, until ${dmy(l.hold.until)}`
    : null;

/** A loan's fine still to settle. */
export const fineOf = (l: Pick<LibraryLoan, 'fineAmount' | 'fineWaived' | 'finePaidOn'>) =>
  l.finePaidOn ? 0 : Math.max(0, Number(l.fineAmount) - Number(l.fineWaived));
