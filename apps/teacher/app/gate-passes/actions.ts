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

/** I ask for my own pass (RGP / NRGP) with up to five items carried out. */
export async function applyGatePass(fd: FormData) {
  const category = str(fd, 'category') === 'nrgp' ? 'nrgp' : 'rgp';
  const items = [1, 2, 3, 4, 5]
    .map((n) => ({
      name: str(fd, `item${String(n)}`),
      qty: Number(str(fd, `qty${String(n)}`) || 1),
      serialNo: str(fd, `serial${String(n)}`) || undefined,
      returnable: fd.get(`back${String(n)}`) !== null,
    }))
    .filter((i) => i.name.length >= 2);
  try {
    await bff.api.fetch('/gate-passes/staff', {
      method: 'POST',
      body: JSON.stringify({
        category,
        onDate: str(fd, 'onDate') || undefined,
        atTime: str(fd, 'atTime'),
        returnTime: category === 'rgp' ? str(fd, 'returnTime') || undefined : undefined,
        reason: str(fd, 'reason'),
        destination: str(fd, 'destination') || undefined,
        items,
      }),
    });
  } catch (error) {
    fail('/gate-passes/new', error);
  }
  redirect('/gate-passes?ok=requested');
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
