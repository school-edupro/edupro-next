'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Sprint 13: a guardian asks for a bus seat, a stop or route change, or to leave the bus. */
export async function requestBus(fd: FormData) {
  const kind = str(fd, 'kind');
  try {
    await bff.api.fetch('/transport/requests/mine', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        kind: kind === 'change' || kind === 'leave' ? kind : 'join',
        routeId: kind === 'leave' ? undefined : str(fd, 'routeId') || undefined,
        stopId: kind === 'leave' ? undefined : str(fd, 'stopId') || undefined,
        effectiveFrom: str(fd, 'effectiveFrom') || undefined,
        note: str(fd, 'note') || undefined,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/transport?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect('/transport?requested=1');
}
