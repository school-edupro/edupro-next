'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function topicsFrom(fd: FormData) {
  const topics: Array<{
    day: number;
    topic: string;
    activities?: string;
    resources?: string;
    homework?: string;
  }> = [];
  for (let day = 1; day <= 6; day++) {
    const topic = str(fd, `topic-${day}`);
    if (!topic) continue;
    topics.push({
      day,
      topic,
      activities: str(fd, `activities-${day}`) || undefined,
      resources: str(fd, `resources-${day}`) || undefined,
      homework: str(fd, `homework-${day}`) || undefined,
    });
  }
  return topics;
}

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
    );
  }
  throw error;
}

/** S11: create a weekly plan (save as draft or submit for approval). */
export async function createPlan(fd: FormData) {
  let id = '';
  try {
    const r = await bff.api.fetch<{ id: string }>('/academics/lesson-plans', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        subjectId: str(fd, 'subjectId'),
        weekStart: str(fd, 'weekStart'),
        title: str(fd, 'title'),
        objectives: str(fd, 'objectives') || undefined,
        assessment: str(fd, 'assessment') || undefined,
        topics: topicsFrom(fd),
        submit: str(fd, 'intent') === 'submit',
      }),
    });
    id = r.id;
  } catch (error) {
    fail('/lesson-plans/new', error);
  }
  redirect(`/lesson-plans/${id}?ok=1`);
}

export async function updatePlan(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await bff.api.fetch(`/academics/lesson-plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: str(fd, 'title'),
        objectives: str(fd, 'objectives') || undefined,
        assessment: str(fd, 'assessment') || undefined,
        topics: topicsFrom(fd),
        submit: str(fd, 'intent') === 'submit',
      }),
    });
  } catch (error) {
    fail(`/lesson-plans/${id}`, error);
  }
  redirect(`/lesson-plans/${id}?ok=1`);
}
