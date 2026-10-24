'use server';
import { redirect } from 'next/navigation';
import { PublicApiError, publicFetch, type FormField } from '@/lib/api';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Turns the form post into the API's typed answers using the cycle's schema, then submits (S8-05). */
export async function submitApplication(fd: FormData) {
  const school = str(fd, 'school');
  const cycleId = str(fd, 'cycleId');
  const lang = str(fd, 'lang') || 'en';
  const back = `/${school}/apply/${cycleId}?class=${str(fd, 'classId')}&lang=${lang}`;
  const schema = JSON.parse(str(fd, 'schema') || '[]') as FormField[];
  const data: Record<string, unknown> = {};
  for (const f of schema) {
    const raw = fd.get(f.key);
    if (f.type === 'boolean') {
      data[f.key] = raw !== null;
      continue;
    }
    const v = String(raw ?? '').trim();
    if (v === '') continue;
    data[f.key] = f.type === 'number' ? Number(v) : v;
  }
  try {
    const created = await publicFetch<{ applicationNo: string }>('/applications', {
      method: 'POST',
      body: JSON.stringify({
        cycleId,
        classId: str(fd, 'classId'),
        childFirstName: str(fd, 'childFirstName'),
        childLastName: str(fd, 'childLastName') || undefined,
        childDob: str(fd, 'childDob'),
        childGender: str(fd, 'childGender') || 'unspecified',
        passcode: str(fd, 'passcode') || undefined,
        data,
        submit: true,
      }),
    });
    redirect(
      `/${school}/status?lang=${lang}&submitted=${encodeURIComponent(created.applicationNo)}`,
    );
  } catch (error) {
    if (error instanceof PublicApiError) {
      const problems = Array.isArray(error.problem.problems)
        ? (error.problem.problems as Array<{ field: string; message: string }>)
            .map((p) => `${p.field}: ${p.message}`)
            .join('; ')
        : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((error.problem.detail ?? problems).slice(0, 200))}`,
      );
    }
    throw error;
  }
}
