import { LessonDetail, PageHeader, type LessonDetailData } from '@edupro/ui';
import { notFound, redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { acknowledgeLesson, deleteLesson, rejectLesson } from '../actions';

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
  if (id === 'new') redirect('/lesson-plans');
  if (!/^\d{1,18}$/.test(id)) notFound();
  let lesson: LessonDetailData;
  try {
    lesson = await bff.api.fetch<LessonDetailData>(`/academics/lessons/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker={`Lesson planner · Request #${lesson.id}`}
        title={lesson.topic}
        description={`${STATUS[lesson.status]}${lesson.status === 'pending' ? ` · level ${String(lesson.currentLevel)} of ${String(lesson.levels)}: ${lesson.approver ?? 'not set'}` : ''}`}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/lesson-plans?tab=report">
            Lesson Report
          </a>
        }
      />
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
        office={false}
        acknowledge={acknowledgeLesson}
        reject={rejectLesson}
        remove={deleteLesson}
        fileLinks={(fileId, n) => (
          <FileLinks
            url={`/api/doc-file/lesson/${lesson.id}/${fileId}`}
            saveUrl={`/api/doc-file/lesson/${lesson.id}/${fileId}?save=1`}
            label={`Attachment ${String(n)}`}
          />
        )}
      />
    </main>
  );
}
