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

/** A guardian asks for a gate pass (0069): the child, when, why, and who takes the child. */
export async function applyGatePass(fd: FormData) {
  const studentId = str(fd, 'studentId');
  let id = '';
  try {
    id = (
      await bff.api.fetch<{ id: string }>('/gate-passes/mine', {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          kind: str(fd, 'kind') === 'late_arrival' ? 'late_arrival' : 'early_leave',
          onDate: str(fd, 'onDate') || undefined,
          atTime: str(fd, 'atTime') || undefined,
          reason: str(fd, 'reason'),
          escortKind: str(fd, 'escortKind') || undefined,
          escortName: str(fd, 'escortName') || undefined,
          escortRelation: str(fd, 'escortRelation') || undefined,
          escortMobile: str(fd, 'escortMobile') || undefined,
        }),
      })
    ).id;
  } catch (error) {
    fail(`/gate-passes/new?student=${encodeURIComponent(studentId)}`, error);
  }
  redirect(`/gate-passes/${id}?ok=1`);
}

/** A guardian cancels a pass that has not been used yet. */
export async function cancelGatePass(fd: FormData) {
  try {
    await bff.api.fetch(`/gate-passes/mine/${str(fd, 'id')}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    fail('/gate-passes', error);
  }
  redirect('/gate-passes?ok=cancelled');
}
