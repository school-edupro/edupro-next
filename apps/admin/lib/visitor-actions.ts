'use server';
/** Visitor gate pass server actions (0065): register, let in, turn away, exit, lookup, PDF of the register. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { VisitorLookup } from './visitors';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/engagement/visitors';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs.map((e) => [e.path, e.message].filter(Boolean).join(': ')).join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}
function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
    );
  throw error;
}
function returnTo(fd: FormData): string {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : BASE;
}

/** What a mobile number gave on its last visit (the number is posted, never in the address bar). */
export async function lookupVisitor(mobile: string): Promise<VisitorLookup | { error: string }> {
  if (!/^[6-9]\d{9}$/.test(mobile)) return { error: 'Enter a 10-digit mobile number.' };
  try {
    return await apiFetch<VisitorLookup>('/visitors/lookup', {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: detailOf(error) || error.problem.type };
    throw error;
  }
}

export type RegisterResult =
  { ok: true; id: string; number: string } | { ok: false; error: string };

/** The guard registers a walk-in visitor; the screen then offers the card to print. */
export async function registerVisitor(input: Record<string, unknown>): Promise<RegisterResult> {
  try {
    const out = await apiFetch<{ id: string; number: string }>('/visitors', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(BASE);
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

async function act(fd: FormData, verb: string, body: Record<string, unknown>, ok: string) {
  const here = returnTo(fd);
  try {
    await apiFetch(`/visitors/${str(fd, 'id')}/${verb}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(`${here}${here.includes('?') ? '&' : '?'}ok=${ok}`);
}

export async function admitVisitor(fd: FormData) {
  await act(
    fd,
    'admit',
    { gate: str(fd, 'gate') || undefined, badgeNo: str(fd, 'badgeNo') || undefined },
    'admitted',
  );
}
export async function refuseVisitor(fd: FormData) {
  await act(fd, 'refuse', {}, 'refused');
}
export async function exitVisitor(fd: FormData) {
  await act(
    fd,
    'exit',
    { exitGate: str(fd, 'exitGate') || undefined, note: str(fd, 'note') || undefined },
    'left',
  );
}

/** Queues the register (with the filters on screen) as a PDF and returns to watch it. */
export async function exportVisitorsPdf(fd: FormData) {
  const filters: Record<string, string> = {};
  for (const k of ['state', 'from', 'to', 'type', 'q']) {
    const v = str(fd, k);
    if (v) filters[k] = v;
  }
  const here = `${BASE}?${new URLSearchParams(filters).toString()}`;
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/reports/exports', {
        method: 'POST',
        body: JSON.stringify({ dataset: 'visitor_register', format: 'pdf', params: filters }),
      })
    ).id;
  } catch (error) {
    back(here, error);
  }
  redirect(`${here}&export=${id}`);
}
