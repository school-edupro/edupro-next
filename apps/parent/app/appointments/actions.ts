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

/** Sprint 19: a guardian asks to meet the class teacher, the coordinator or the principal. */
export async function requestAppointment(fd: FormData) {
  const slots = ['slot1', 'slot2', 'slot3'].map((k) => str(fd, k)).filter(Boolean);
  try {
    await bff.api.fetch('/engagement/mine/appointments', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        withKind: str(fd, 'withKind') || 'class_teacher',
        purpose: str(fd, 'purpose'),
        preferredSlots: slots,
      }),
    });
  } catch (error) {
    fail('/appointments', error);
  }
  redirect('/appointments?ok=1');
}

/** Sprint 19: a guardian asks for an early-leave or late-arrival pass. */
export async function requestGatePass(fd: FormData) {
  try {
    await bff.api.fetch('/engagement/mine/gate-passes', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        kind: str(fd, 'kind') === 'late_arrival' ? 'late_arrival' : 'early_leave',
        onDate: str(fd, 'onDate') || undefined,
        atTime: str(fd, 'atTime') || undefined,
        reason: str(fd, 'reason'),
        escortName: str(fd, 'escortName') || undefined,
        escortRelation: str(fd, 'escortRelation') || undefined,
        escortMobile: str(fd, 'escortMobile') || undefined,
      }),
    });
  } catch (error) {
    fail('/appointments', error);
  }
  redirect('/appointments?ok=pass');
}

/** Sprint 19: a guardian signs a consent form for one child (a fee opens the pay flow). */
export async function respondConsent(fd: FormData) {
  const formId = str(fd, 'formId');
  const answers: Record<string, string | boolean> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('a.')) continue;
    const key = k.slice(2);
    answers[key] = v === 'on' ? true : String(v);
  }
  for (const k of str(fd, 'yesnoKeys').split(',').filter(Boolean))
    if (!(k in answers)) answers[k] = false;
  let out: { paymentIntentId: string | null } | undefined;
  try {
    out = await bff.api.fetch<{ paymentIntentId: string | null }>(
      `/engagement/mine/consent-forms/${formId}/responses`,
      {
        method: 'POST',
        body: JSON.stringify({
          studentId: str(fd, 'studentId'),
          answers,
          signedName: str(fd, 'signedName'),
        }),
      },
    );
  } catch (error) {
    fail('/consents', error);
  }
  redirect(out?.paymentIntentId ? `/consents?ok=1&pay=${out.paymentIntentId}` : '/consents?ok=1');
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
