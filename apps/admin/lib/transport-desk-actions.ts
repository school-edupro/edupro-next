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
  incharges: Array<{ routeId: string | null; employeeId: string }>;
}): Promise<SetupResult> {
  try {
    await apiFetch('/transport/desk/setup', {
      method: 'PUT',
      body: JSON.stringify({
        ...input.settings,
        levels: input.levels,
        incharges: input.incharges,
      }),
    });
    revalidatePath(`${BASE}/setup`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

/** Several requests at my level in one go (the fee department after an Excel upload). */
export async function decideManyTransport(fd: FormData) {
  const here = `${BASE}/requests/approvals`;
  const ids = fd.getAll('ids').map(String).filter(Boolean);
  if (!ids.length)
    redirect(
      `${here}?error=validation-failed&detail=${encodeURIComponent('Tick at least one request')}`,
    );
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  let out: { done: number; failed: Array<{ id: string; message: string }> } = {
    done: 0,
    failed: [],
  };
  try {
    out = await apiFetch('/transport/requests/decide-many', {
      method: 'POST',
      body: JSON.stringify({ ids, outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  if (out.failed.length)
    redirect(
      `${here}?error=partly-done&detail=${encodeURIComponent(`${String(out.done)} done; ${String(out.failed.length)} not: ${out.failed[0]!.message}`.slice(0, 280))}`,
    );
  redirect(withOk(here, 'many'));
}

/** Requests for many pupils from one Excel sheet; the result says how many went in and which rows did not. */
export async function importTransportRequests(fd: FormData) {
  const here = `${BASE}/requests/new`;
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size)
    redirect(
      `${here}?error=validation-failed&detail=${encodeURIComponent('Choose the Excel file')}`,
    );
  const f = file as File;
  if (f.size > 700_000)
    redirect(
      `${here}?error=validation-failed&detail=${encodeURIComponent('The file is larger than 700 KB')}`,
    );
  let out: { created: number; errors: Array<{ row: number; message: string }> } = {
    created: 0,
    errors: [],
  };
  try {
    out = await apiFetch('/transport/requests/import', {
      method: 'POST',
      body: JSON.stringify({
        fileName: f.name,
        fileBase64: Buffer.from(await f.arrayBuffer()).toString('base64'),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  const problems = out.errors
    .slice(0, 12)
    .map((e) => `row ${String(e.row)}: ${e.message}`)
    .join(' | ');
  redirect(
    `${here}?imported=${String(out.created)}&skipped=${String(out.errors.length)}${problems ? `&problems=${encodeURIComponent(problems.slice(0, 900))}` : ''}`,
  );
}

/** A vehicle is off the road: the replacement vehicle and crew for some days. */
export async function createReplacement(fd: FormData) {
  const here = `${BASE}/replacements?add=1`;
  try {
    await apiFetch('/transport/replacements', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId: str(fd, 'vehicleId'),
        replacementVehicleId: str(fd, 'replacementVehicleId'),
        driverId: str(fd, 'driverId'),
        conductorId: str(fd, 'conductorId'),
        attendantId: str(fd, 'attendantId'),
        fromDate: str(fd, 'fromDate'),
        toDate: str(fd, 'toDate'),
        reason: str(fd, 'reason'),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/replacements?ok=replaced`);
}
export async function endReplacement(fd: FormData) {
  const here = `${BASE}/replacements`;
  try {
    await apiFetch(`/transport/replacements/${str(fd, 'id')}/end`, {
      method: 'POST',
      body: JSON.stringify({ note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'ended'));
}
