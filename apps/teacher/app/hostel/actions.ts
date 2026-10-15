'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
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
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
}

/** The warden saves the roll of a session: one status per pupil (pupils away on leave stay on leave). */
export async function saveRollcall(fd: FormData) {
  const sessionId = str(fd, 'sessionId');
  const on = str(fd, 'on');
  const back = `/hostel/rollcall?sessionId=${encodeURIComponent(sessionId)}&on=${encodeURIComponent(on)}`;
  const marks = fd
    .getAll('studentId')
    .map(String)
    .map((id) => ({
      studentId: id,
      status: ['present', 'absent', 'sick', 'on_leave'].includes(str(fd, `s-${id}`))
        ? str(fd, `s-${id}`)
        : 'present',
      note: str(fd, `n-${id}`) || undefined,
    }));
  let out: { counts: Record<string, number>; alerted: number } = { counts: {}, alerted: 0 };
  try {
    out = await bff.api.fetch('/hostel/rollcall', {
      method: 'POST',
      body: JSON.stringify({ sessionId, on, marks }),
    });
  } catch (error) {
    fail(back, error);
  }
  const c = out.counts;
  redirect(
    `${back}&ok=1&detail=${encodeURIComponent(
      `Saved: ${String(c.present ?? 0)} present, ${String(c.absent ?? 0)} absent, ${String(c.on_leave ?? 0)} on leave, ${String(c.sick ?? 0)} sick.${out.alerted ? ` ${String(out.alerted)} absence(s) reported to the head warden and the parents.` : ''}`,
    )}`,
  );
}

/** Home leave: send the one-time code to the parent (someone not on the record collects). */
export async function sendHandoverCode(fd: FormData) {
  const id = str(fd, 'id');
  let out: { mobileEnd?: string } = {};
  try {
    out = await bff.api.fetch(`/gate-passes/${id}/otp`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    fail(`/hostel/handover/${id}`, error);
  }
  redirect(`/hostel/handover/${id}?sent=${encodeURIComponent(out.mobileEnd ?? '')}`);
}

/** Home leave: the warden hands the pupil over (live photo, the code when needed, a remark). */
export async function handOver(fd: FormData) {
  const id = str(fd, 'id');
  const back = `/hostel/handover/${id}`;
  if (!str(fd, 'photo'))
    redirect(
      `${back}?error=validation-failed&detail=${encodeURIComponent('Take the photo of the person collecting')}`,
    );
  let out: { ok: boolean; error?: string } = { ok: false };
  try {
    out = await bff.api.fetch(`/gate-passes/${id}/handover`, {
      method: 'POST',
      body: JSON.stringify({
        photo: str(fd, 'photo'),
        otp: str(fd, 'otp') || undefined,
        remark: str(fd, 'remark') || undefined,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  if (!out.ok)
    redirect(
      `${back}?error=otp&detail=${encodeURIComponent(out.error ?? 'The code did not match')}`,
    );
  redirect(
    `/hostel?ok=1&detail=${encodeURIComponent('Handed over. The gate lets the pupil out against the pass.')}`,
  );
}
