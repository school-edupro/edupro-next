'use server';
import { ApiError, apiFetch } from './api';
import type { DeskBorrower, DeskClassRow, DeskLookup, DeskMatch } from './library-desk';
import type { Result } from './report-builder';
import type { LibraryLoan } from './types';

/** The circulation desk's calls: each says what went wrong instead of throwing. */
async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    return { ok: true, data: await apiFetch<T>(path, init) };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: String(error.problem.detail ?? error.problem.type) };
    throw error;
  }
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export async function deskFindBorrower(q: string) {
  return call<{ borrower: DeskBorrower | null; matches: DeskMatch[] }>(
    `/library/desk/borrowers?q=${encodeURIComponent(q.trim().slice(0, 80))}`,
  );
}

export async function deskBorrower(kind: 'student' | 'employee', id: string) {
  if (!/^\d{1,18}$/.test(id)) return { ok: false as const, error: 'Borrower not found' };
  return call<DeskBorrower>(`/library/desk/borrowers/${kind}/${id}`);
}

export async function deskBook(accessionNo: string, purpose: 'issue' | 'return') {
  return call<DeskLookup>(
    `/library/desk/book?accessionNo=${encodeURIComponent(accessionNo.trim().slice(0, 30))}&for=${purpose}`,
  );
}

export async function deskIssue(input: {
  borrowerKind: 'student' | 'employee';
  borrowerId: string;
  accessionNos: string[];
  dueOn?: string;
}) {
  return call<{ loans: LibraryLoan[] }>('/library/desk/issue', post(input));
}

/** One book back, in the condition given, its fine waived (with the reason) if asked. */
export async function deskReturnOne(input: {
  accessionNo: string;
  condition: 'available' | 'damaged';
  waiveFine?: boolean;
  waiveReason?: string;
  note?: string;
}) {
  return call<LibraryLoan>('/library/loans/return', post({ waiveFine: false, ...input }));
}

/** Several books back in good condition (a borrower's, a class's). */
export async function deskReturnMany(accessionNos: string[]) {
  return call<{ loans: LibraryLoan[]; fines: number }>(
    '/library/desk/return',
    post({ accessionNos }),
  );
}

export async function deskRenew(accessionNo: string) {
  return call<LibraryLoan>('/library/loans/renew', post({ accessionNo }));
}

export async function deskClassLoans(classId: string, sectionId?: string) {
  if (!/^\d{1,18}$/.test(classId) || (sectionId && !/^\d{1,18}$/.test(sectionId)))
    return { ok: false as const, error: 'Pick the class' };
  return call<{ rows: DeskClassRow[] }>(
    `/library/desk/class-loans?classId=${classId}${sectionId ? `&sectionId=${sectionId}` : ''}`,
  );
}
