'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import type { StaffPassInput, StaffPassResult } from '@/components/StaffPassForm';
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

/** Gate pass v2 (0069): approve or reject a pass that waits on me. */
export async function decideGatePass(fd: FormData) {
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  try {
    await bff.api.fetch(`/gate-passes/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    fail('/gate-passes', error);
  }
  redirect(`/gate-passes?ok=${outcome}`);
}

/**
 * I ask for my own pass (RGP / NRGP) with the items I carry out (as the admin website's form): the answer comes back
 * to the form, which then opens My gate passes.
 */
export async function applyStaffPass(input: StaffPassInput): Promise<StaffPassResult> {
  try {
    const r = await bff.api.fetch<{ id: string }>('/gate-passes/staff', {
      method: 'POST',
      body: JSON.stringify({
        category: input.category === 'nrgp' ? 'nrgp' : 'rgp',
        onDate: input.onDate || undefined,
        atTime: input.atTime,
        returnTime: input.category === 'rgp' ? input.returnTime || undefined : undefined,
        reason: input.reason,
        destination: input.destination || undefined,
        items: input.items.slice(0, 30),
      }),
    });
    return { ok: true, id: String(r.id) };
  } catch (error) {
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
      return { ok: false, error: detail || error.problem.type };
    }
    throw error;
  }
}

export async function cancelGatePass(fd: FormData) {
  try {
    await bff.api.fetch(`/gate-passes/staff/${str(fd, 'id')}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    fail('/gate-passes', error);
  }
  redirect('/gate-passes?ok=cancelled');
}

/** One action per button: a button's own name/value does not reach a server action. */
export async function approveGatePass(fd: FormData) {
  fd.set('outcome', 'approved');
  return decideGatePass(fd);
}
export async function rejectGatePass(fd: FormData) {
  fd.set('outcome', 'rejected');
  return decideGatePass(fd);
}
