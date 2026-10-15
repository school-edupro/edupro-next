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

/** A warden allows or refuses a visit waiting at the gate. */
export async function decideVisit(fd: FormData) {
  const outcome = str(fd, 'outcome') === 'refused' ? 'refused' : 'allowed';
  try {
    await bff.api.fetch(`/hostel/visits/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    fail('/hostel', error);
  }
  redirect(
    `/hostel?ok=1&detail=${encodeURIComponent(outcome === 'allowed' ? 'Visitor allowed in. The parent has been told.' : 'Visit refused. The parent has been told.')}`,
  );
}

/** A warden approves or rejects a visitor a parent added. */
export async function decideVisitor(fd: FormData) {
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  try {
    await bff.api.fetch(`/hostel/visitors/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    fail('/hostel', error);
  }
  redirect(
    `/hostel?ok=1&detail=${encodeURIComponent(outcome === 'approved' ? 'Visitor approved.' : 'Visitor not approved.')}`,
  );
}

/** Who skipped a meal (everyone else not away had it). */
export async function saveMeal(fd: FormData) {
  const mealId = str(fd, 'mealId');
  const on = str(fd, 'on');
  const back = `/hostel/meal?mealId=${encodeURIComponent(mealId)}&on=${encodeURIComponent(on)}`;
  const skips = fd
    .getAll('skip')
    .map(String)
    .map((id) => ({ studentId: id, reason: str(fd, `r-${id}`) || undefined }));
  let out: { served: number; skipped: number; away: number } = { served: 0, skipped: 0, away: 0 };
  try {
    out = await bff.api.fetch('/hostel/meal-roll', {
      method: 'POST',
      body: JSON.stringify({ mealId, on, skips }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(
    `${back}&ok=1&detail=${encodeURIComponent(`Saved: ${String(out.served)} had the meal, ${String(out.skipped)} skipped, ${String(out.away)} away.`)}`,
  );
}

/** The hostel's diet of a pupil. */
export async function saveDiet(fd: FormData) {
  const back = `/hostel/diets?hostelId=${encodeURIComponent(str(fd, 'hostelId'))}`;
  try {
    await bff.api.fetch(`/hostel/diets/${str(fd, 'studentId')}`, {
      method: 'PUT',
      body: JSON.stringify({
        diet: str(fd, 'diet') || 'veg',
        noOnionGarlic: fd.get('noOnionGarlic') === 'on',
        notes: str(fd, 'notes') || undefined,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=1`);
}

/** The warden's sick-bay note: a clinic visit of the boarder (the clinic tells the family by its rule). */
export async function saveSickbay(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel/sickbay?studentId=${encodeURIComponent(studentId)}&name=${encodeURIComponent(str(fd, 'name'))}`;
  const temp = Number(str(fd, 'temperatureC'));
  try {
    await bff.api.fetch('/hostel/sickbay', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        complaint: str(fd, 'complaint'),
        temperatureC: str(fd, 'temperatureC') && Number.isFinite(temp) ? temp : undefined,
        treatment: str(fd, 'treatment') || undefined,
        outcome: ['rest', 'back_to_class', 'sent_home', 'referred'].includes(str(fd, 'outcome'))
          ? str(fd, 'outcome')
          : 'rest',
        referredTo: str(fd, 'referredTo') || undefined,
        remark: str(fd, 'remark') || undefined,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(
    `/hostel?ok=1&detail=${encodeURIComponent('Sick-bay note saved in the clinic record.')}`,
  );
}

export async function saveIncident(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const back = `/hostel/incident?studentId=${encodeURIComponent(studentId)}&name=${encodeURIComponent(str(fd, 'name'))}`;
  let out: { parentTold?: boolean; principalTold?: boolean } = {};
  try {
    out = await bff.api.fetch('/hostel/incidents', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        category: str(fd, 'category'),
        severity: str(fd, 'severity') === 'serious' ? 'serious' : 'minor',
        what: str(fd, 'what'),
        action: str(fd, 'action') || undefined,
        tellParent: fd.get('tellParent') === 'on',
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(
    `/hostel?ok=1&detail=${encodeURIComponent(
      `Incident recorded.${out.parentTold ? ' The parent has been told.' : ''}${out.principalTold ? ' The principal has been told.' : ''}`,
    )}`,
  );
}
