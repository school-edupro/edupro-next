'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const ids = (fd: FormData, prefix: string): string[] =>
  [...fd.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));

async function put(fd: FormData, path: string, body: Record<string, unknown>, what: string) {
  const back = `/exam-register?exam=${str(fd, 'examId')}&section=${str(fd, 'classSectionId')}`;
  let out: Record<string, number> | undefined;
  try {
    out = await bff.api.fetch(`/exams/${str(fd, 'examId')}/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), ...body }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
      );
    }
    throw error;
  }
  const n = out!.changed ?? out!.recorded ?? 0;
  redirect(`${back}&ok=1&detail=${encodeURIComponent(`${n} ${what}`)}`);
}

export async function saveRemarks(fd: FormData) {
  const rows = ids(fd, 'remark-')
    .map((studentId) => ({ studentId, remark: str(fd, `remark-${studentId}`) }))
    .filter((r) => r.remark);
  if (!rows.length)
    redirect(
      `/exam-register?exam=${str(fd, 'examId')}&section=${str(fd, 'classSectionId')}&error=validation-failed&detail=no%20remark%20entered`,
    );
  await put(fd, 'remarks', { rows }, 'remarks changed');
}

export async function saveAttendance(fd: FormData) {
  const rows = ids(fd, 'present-')
    .filter((id) => str(fd, `present-${id}`) !== '' && str(fd, `total-${id}`) !== '')
    .map((studentId) => ({
      studentId,
      daysPresent: Number(str(fd, `present-${studentId}`)),
      daysTotal: Number(str(fd, `total-${studentId}`)),
    }));
  if (!rows.length)
    redirect(
      `/exam-register?exam=${str(fd, 'examId')}&section=${str(fd, 'classSectionId')}&error=validation-failed&detail=no%20attendance%20entered`,
    );
  await put(fd, 'attendance', { rows }, 'attendance rows changed');
}

export async function saveHealth(fd: FormData) {
  const rows = ids(fd, 'height-')
    .map((studentId) => ({
      studentId,
      heightCm: str(fd, `height-${studentId}`) ? Number(str(fd, `height-${studentId}`)) : null,
      weightKg: str(fd, `weight-${studentId}`) ? Number(str(fd, `weight-${studentId}`)) : null,
      bloodGroup: str(fd, `blood-${studentId}`) || null,
    }))
    .filter((r) => r.heightCm !== null || r.weightKg !== null || r.bloodGroup !== null);
  if (!rows.length)
    redirect(
      `/exam-register?exam=${str(fd, 'examId')}&section=${str(fd, 'classSectionId')}&error=validation-failed&detail=no%20measurement%20entered`,
    );
  await put(fd, 'health', { rows }, 'health records saved');
}
