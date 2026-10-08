import { LessonDetail, PageHeader, type LessonDetailData } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { FileLinks } from '@/components/FileLinks';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { acknowledgeLesson, deleteLesson, rejectLesson } from '@/lib/lesson-actions';

const STATUS = { pending: 'Pending', acknowledged: 'Acknowledged', rejected: 'Rejected' };

/** One lesson: what was uploaded, the approval levels, and (when it waits for me) acknowledge or reject. */
export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  let lesson: LessonDetailData;
  try {
    lesson = await apiFetch<LessonDetailData>(`/academics/lessons/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  return (
    <>
      <PageHeader
        kicker={`Academics · Lesson planner · Request #${lesson.id}`}
        title={lesson.topic}
        description={`${STATUS[lesson.status]}${lesson.status === 'pending' ? ` · level ${String(lesson.currentLevel)} of ${String(lesson.levels)}: ${lesson.approver ?? 'not set'}` : ''}`}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/academics/lesson-plans?tab=report"
          >
            Lesson Report
          </a>
        }
      />
      <AcademicsNav current="/academics/lesson-plans" permissions={me.permissions} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'uploaded'
            ? 'The lesson is uploaded and sent for approval.'
            : sp.ok === 'reject'
              ? 'Rejected.'
              : 'Acknowledged.'}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || 'Could not save.'}
        </div>
      ) : null}
      <LessonDetail
        lesson={lesson}
        office={me.permissions.includes('academics.lesson_plan.setup')}
        acknowledge={acknowledgeLesson}
        reject={rejectLesson}
        remove={deleteLesson}
        fileLinks={(fileId, n) => (
          <FileLinks
            href={`/api/academics/doc-file/lesson/${lesson.id}/${fileId}`}
            label={`attachment ${String(n)}`}
          />
        )}
      />
    </>
  );
}
