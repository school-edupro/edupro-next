import {
  Card,
  LessonReport,
  LessonUploadForm,
  PageHeader,
  type LessonFilters,
  type LessonListData,
  type LessonOptions,
} from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { uploadLesson } from './actions';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const KEYS = ['by', 'q', 'from', 'to', 'status', 'level', 'record', 'mine', 'page'] as const;

/**
 * Lesson planner for the teacher: Upload Lesson (date, classes, topic, description, attachments) and
 * Lesson Report (my lessons and the ones waiting for my approval, with their level and approver).
 */
export default async function LessonPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'report' ? 'report' : 'upload';
  const filters: LessonFilters = {};
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = (sp[k] ?? '').slice(0, 80);
    if (!v) continue;
    q.set(k, v);
    if (k !== 'page') filters[k] = v;
  }
  let options: LessonOptions = { classes: [], sections: [], maxFiles: 2 };
  let list: LessonListData | null = null;
  try {
    if (tab === 'upload')
      options = await bff.api.fetch<LessonOptions>('/academics/lessons/options');
    else list = await bff.api.fetch<LessonListData>(`/academics/lessons?${q.toString()}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && (error.status === 403 || error.status === 400))) throw error;
  }
  const link = (v: string, label: string) => (
    <a
      key={v}
      href={v === 'upload' ? '/lesson-plans' : '/lesson-plans?tab=report'}
      aria-current={tab === v ? 'page' : undefined}
    >
      {label}
    </a>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1180, margin: '0 auto' }}>
      <PageHeader
        kicker="Lesson planner"
        title="Lesson setup"
        description="Upload the lesson for your classes; it goes to your approvers level by level. The report shows where each one stands."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/syllabus">
              My syllabus
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              Home
            </a>
          </>
        }
      />
      <nav
        className="ep-tabs-links"
        aria-label="Lesson setup"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {link('upload', 'Upload Lesson')}
        {link('report', 'Lesson Report')}
      </nav>
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'deleted' ? 'The lesson was deleted.' : 'Saved.'}
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
      {tab === 'upload' ? (
        <Card>
          <LessonUploadForm options={options} action={uploadLesson} today={today()} />
        </Card>
      ) : list ? (
        <LessonReport
          list={list}
          filters={filters}
          path="/lesson-plans"
          keep={{ tab: 'report' }}
          exportPath="/api/lesson-report"
          detailHref={(id) => `/lesson-plans/${id}`}
        />
      ) : (
        <Card>The lesson report is not part of your role.</Card>
      )}
    </main>
  );
}
