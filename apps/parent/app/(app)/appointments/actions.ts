'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
    );
  }
  throw error;
}

/** A guardian books a free slot with a person or desk the school has opened to parents (0059). */
export async function requestAppointment(fd: FormData) {
  const back = `/appointments/new?${new URLSearchParams({
    student: str(fd, 'studentId'),
    host: str(fd, 'hostId'),
    date: str(fd, 'startsAt').slice(0, 10),
    time: str(fd, 'startsAt').slice(11, 16),
  }).toString()}`;
  let id = '';
  try {
    id = (
      await bff.api.fetch<{ id: string }>('/appointments/mine', {
        method: 'POST',
        body: JSON.stringify({
          studentId: str(fd, 'studentId'),
          hostId: str(fd, 'hostId'),
          startsAt: str(fd, 'startsAt'),
          purpose: str(fd, 'purpose'),
        }),
      })
    ).id;
  } catch (error) {
    fail(back, error);
  }
  redirect(`/appointments/${id}?ok=1`);
}

/** A guardian cancels an appointment that has not happened yet. */
export async function cancelAppointment(fd: FormData) {
  try {
    await bff.api.fetch(`/appointments/mine/${str(fd, 'id')}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    fail('/appointments', error);
  }
  redirect('/appointments?ok=cancelled#list');
}

/** Sprint 19: a guardian queues the PDF of a child's certificate; the page shows the download. */
export async function queueMyCertificatePdf(fd: FormData) {
  let exportId = '';
  try {
    const r = await bff.api.fetch<{ exportId: string }>(
      `/engagement/mine/certificates/${str(fd, 'id')}/pdf`,
      { method: 'POST' },
    );
    exportId = r.exportId;
  } catch (error) {
    fail('/certificates', error);
  }
  redirect(`/certificates?export=${exportId}`);
}
