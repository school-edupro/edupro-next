import {
  Card,
  PageHeader,
  WorkReport,
  WorkSheet,
  type WorkReportItem,
  type WorkSheetData,
} from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { FileLinks } from '@/components/FileLinks';
import { saveSheet } from './actions';

type View = 'sheet' | 'assignments' | 'report';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86_400_000).toISOString().slice(0, 10);
const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
const ids = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((x) => /^\d{1,18}$/.test(x));

/**
 * Daily work for the teacher: the day's sheet (a row per subject: the class teacher has every subject of
 * the class, a subject teacher the ones given to them), the same sheet for assignments, and what was posted.
 */
export default async function DailyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    s?: string | string[];
    c?: string;
    kind?: string;
    from?: string;
    to?: string;
    classSectionId?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const view: View = sp.view === 'assignments' || sp.view === 'report' ? sp.view : 'sheet';
  const mode = view === 'assignments' ? 'assignment' : 'daily';
  const date = isDate(sp.date) ? sp.date : today();
  const from = isDate(sp.from) ? sp.from : daysAgo(6);
  const to = isDate(sp.to) ? sp.to : today();
  const chosen = ids(sp.s);
  const classId = /^\d{1,18}$/.test(sp.c ?? '') ? sp.c! : '';
  const kind = sp.kind === 'daily' || sp.kind === 'assignment' ? sp.kind : '';
  let sheet: WorkSheetData;
  let items: WorkReportItem[] = [];
  try {
    sheet = await bff.api.fetch<WorkSheetData>(
      `/academics/daily-work/sheet?mode=${mode}&date=${date}${classId ? `&classId=${classId}` : ''}${chosen.length ? `&sections=${chosen.join(',')}` : ''}`,
    );
    if (view === 'report') {
      const q = new URLSearchParams({ size: '200', from, to });
      if (/^\d{1,18}$/.test(sp.classSectionId ?? '')) q.set('classSectionId', sp.classSectionId!);
      items = (
        await bff.api.fetch<{ data: WorkReportItem[] }>(`/academics/daily-work?${q.toString()}`)
      ).data;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Daily work" />
          <Card>You have no teaching assignment in this school yet.</Card>
        </main>
      );
    throw error;
  }
  const tab = (v: View, label: string) => (
    <a
      key={v}
      href={v === 'sheet' ? '/daily-work' : `/daily-work?view=${v}`}
      aria-current={view === v ? 'page' : undefined}
    >
      {label}
    </a>
  );
  const fileLinks = (workId: string, fileId: string, n: number) => (
    <FileLinks
      url={`/api/doc-file/work/${workId}/${fileId}`}
      saveUrl={`/api/doc-file/work/${workId}/${fileId}?save=1`}
      label={`Attachment ${String(n)}`}
    />
  );
  const exportQuery = `from=${from}&to=${to}${sp.classSectionId ? `&classSectionId=${sp.classSectionId}` : ''}${kind ? `&kind=${kind}` : ''}`;
  const [created, updated] = (sp.ok ?? '').split('-').map(Number);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1180, margin: '0 auto' }}>
      <PageHeader
        kicker="Daily work"
        title={
          view === 'sheet'
            ? 'Homework and classwork'
            : view === 'assignments'
              ? 'Assignments'
              : 'What was posted'
        }
        description="You post for the classes and subjects given to you in Teacher assignments."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/documents">
              Session plan, curriculum, date sheet
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              Home
            </a>
          </>
        }
      />
      <nav
        className="ep-tabs-links"
        aria-label="Daily work"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {tab('sheet', 'Homework and classwork')}
        {tab('assignments', 'Assignments')}
        {tab('report', 'Report')}
      </nav>
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Saved: {created || 0} new, {updated || 0} updated.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || `Could not save (${sp.error}).`}
        </div>
      ) : null}
      {view === 'report' ? (
        <Card>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <input type="hidden" name="view" value="report" />
            <label className="ep-field">
              <span className="ep-field__label">From</span>
              <input className="ep-input" type="date" name="from" defaultValue={from} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">To</span>
              <input className="ep-input" type="date" name="to" defaultValue={to} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Class</span>
              <select
                className="ep-select"
                name="classSectionId"
                defaultValue={sp.classSectionId ?? ''}
              >
                <option value="">All my classes</option>
                {sheet.options.map((o) => (
                  <option key={o.classSectionId} value={o.classSectionId}>
                    {o.section}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Show</span>
              <select className="ep-select" name="kind" defaultValue={kind}>
                <option value="">Daily work and assignments</option>
                <option value="daily">Daily work (homework, classwork)</option>
                <option value="assignment">Assignments</option>
              </select>
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Show
            </button>
            <a
              className="ep-btn ep-btn--secondary"
              href={`/api/work-report?format=xlsx&${exportQuery}`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary"
              href={`/api/work-report?format=pdf&${exportQuery}`}
            >
              PDF
            </a>
          </form>
          {kind !== 'assignment' ? (
            <>
              <h2 className="ep-card__title">Homework and classwork</h2>
              <WorkReport
                items={items}
                mode="daily"
                fileLinks={fileLinks}
                extra={(w) =>
                  w.ackRequired ? (
                    <a href={`/acknowledgements?type=daily_work&id=${w.id}`}>
                      · {w.ackCount} acknowledged
                    </a>
                  ) : null
                }
              />
            </>
          ) : null}
          {kind !== 'daily' ? (
            <>
              <h2 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
                Assignments
              </h2>
              <WorkReport items={items} mode="assignment" fileLinks={fileLinks} />
            </>
          ) : null}
        </Card>
      ) : (
        <Card>
          <WorkSheet
            sheet={sheet}
            path="/daily-work"
            view={view}
            action={saveSheet}
            fileLinks={fileLinks}
          />
        </Card>
      )}
    </main>
  );
}
