'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function back(path: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail = Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : typeof error.problem.detail === 'string'
        ? error.problem.detail
        : '';
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
}

/**
 * Transport v2: a guardian asks for transport (pick, drop or both, from a stoppage, for some months), a
 * change, or to stop from a month. It goes to the transport in-charge and then the fee department.
 */
export async function applyTransport(fd: FormData) {
  const kind = str(fd, 'kind');
  const leave = kind === 'leave';
  const studentId = str(fd, 'studentId');
  try {
    await bff.api.fetch('/transport/requests/mine', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
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
    });
  } catch (error) {
    back(`/transport/apply?student=${encodeURIComponent(studentId)}`, error);
  }
  redirect('/transport?requested=1');
}

/** The family takes back a request that nobody has decided yet. */
export async function cancelTransportRequest(fd: FormData) {
  try {
    await bff.api.fetch(`/transport/requests/mine/${str(fd, 'id')}/cancel`, { method: 'POST' });
  } catch (error) {
    back('/transport', error);
  }
  redirect('/transport?cancelled=1');
}
