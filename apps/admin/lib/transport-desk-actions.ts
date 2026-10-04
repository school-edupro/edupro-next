'use server';
/** Transport v2 server actions (0077): ask for a pupil, decide at my level, save the set-up. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { TransportSetup } from './transport-desk';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/transport';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}
function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((detailOf(error) || error.problem.type).slice(0, 300))}`,
    );
  throw error;
}
function returnTo(fd: FormData, fallback: string): string {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : fallback;
}
const withOk = (path: string, ok: string) => `${path}${path.includes('?') ? '&' : '?'}ok=${ok}`;

/** The transport office asks for a pupil (new, change or withdrawal); it goes to the fee department. */
export async function applyTransport(fd: FormData) {
  const here = returnTo(fd, `${BASE}/requests/new`);
  const kind = str(fd, 'kind');
  const leave = kind === 'leave';
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/transport/requests', {
        method: 'POST',
        body: JSON.stringify({
          studentId: str(fd, 'studentId'),
          kind: leave || kind === 'change' ? kind : 'join',
          service: leave ? undefined : str(fd, 'service'),
          pickRouteId: leave ? undefined : str(fd, 'pickRouteId'),
          pickStopId: leave ? undefined : str(fd, 'pickStopId'),
          dropRouteId: leave ? undefined : str(fd, 'dropRouteId'),
          dropStopId: leave ? undefined : str(fd, 'dropStopId'),
          fromMonth: str(fd, 'fromMonth'),
          toMonth: leave ? undefined : str(fd, 'toMonth'),
          note: str(fd, 'note'),
        }),
      })
    ).id;
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/requests/${id}?ok=requested`);
}

/** An approver decides at their level. */
export async function decideTransport(fd: FormData) {
  const here = returnTo(fd, `${BASE}/requests/approvals`);
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  try {
    await apiFetch(`/transport/requests/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, outcome));
}

export type SetupResult = { ok: true } | { ok: false; error: string };
export async function saveTransportSetup(input: {
  settings: TransportSetup['settings'];
  levels: TransportSetup['levels'];
}): Promise<SetupResult> {
  try {
    await apiFetch('/transport/desk/setup', {
      method: 'PUT',
      body: JSON.stringify({ ...input.settings, levels: input.levels }),
    });
    revalidatePath(`${BASE}/setup`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}
