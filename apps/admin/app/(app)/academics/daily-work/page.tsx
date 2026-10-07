import {
  Button,
  Card,
  InputField,
  PageHeader,
  SelectField,
  WorkReport,
  WorkSheet,
  type WorkReportItem,
  type WorkSheetData,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { deleteDailyWork, saveWorkSheet } from '@/lib/actions';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import type { Page } from '@/lib/types';

type View = 'sheet' | 'assignments' | 'report';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() + 5.5 * 3600 * 1000 - n * 86_400_000).toISOString().slice(0, 10);
const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
const ids = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((x) => /^\d{1,18}$/.test(x));

/**
 * Daily work: the day's sheet (date, classes, then a row per subject with homework and classwork), the
 * same sheet for assignments with a due date, and the report of what was posted and when it publishes.
 */
export default async function DailyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    s?: string | string[];
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
  const [t, me] = await Promise.all([getTranslations('pages.academics_daily_work'), getMe()]);
  const canPost = me.permissions.includes('academics.daily_work.post');
  const reportQuery = new URLSearchParams({ size: '200', from, to });
  if (/^\d{1,18}$/.test(sp.classSectionId ?? ''))
    reportQuery.set('classSectionId', sp.classSectionId!);
  const [sheet, report] = await Promise.all([
    canPost
      ? apiFetch<WorkSheetData>(
          `/academics/daily-work/sheet?mode=${mode}&date=${date}${chosen.length ? `&sections=${chosen.join(',')}` : ''}`,
        )
      : Promise.resolve<WorkSheetData | null>(null),
    view === 'report' || !canPost
      ? apiFetch<Page<WorkReportItem>>(`/academics/daily-work?${reportQuery.toString()}`).then(
          (r) => r.data,
        )
      : Promise.resolve<WorkReportItem[]>([]),
  ]);
  const showReport = view === 'report' || !sheet;
  const self = `/academics/daily-work?view=report&from=${from}&to=${to}${sp.classSectionId ? `&classSectionId=${sp.classSectionId}` : ''}`;
  const tab = (v: View, label: string) => (
    <a
      key={v}
      href={v === 'sheet' ? '/academics/daily-work' : `/academics/daily-work?view=${v}`}
      aria-current={(showReport ? 'report' : view) === v ? 'page' : undefined}
    >
      {label}
    </a>
  );
  const remove = (w: WorkReportItem) =>
    canPost ? (
      <form action={deleteDailyWork} style={{ display: 'inline' }}>
        <input type="hidden" name="id" value={w.id} />
        <input type="hidden" name="returnTo" value={self} />
        <Button type="submit" variant="ghost" size="sm" aria-label={`Remove: ${w.title}`}>
          Remove
        </Button>
      </form>
    ) : null;

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <AcademicsNav current="/academics/daily-work" permissions={me.permissions} />
      <Notice params={sp} />
      <nav
        className="ep-tabs-links"
        aria-label="Daily work"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {sheet ? tab('sheet', 'Homework and classwork') : null}
        {sheet ? tab('assignments', 'Assignments') : null}
        {tab('report', 'Report')}
      </nav>
      {showReport ? (
        <Card>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <input type="hidden" name="view" value="report" />
            <InputField id="from" name="from" label="From" type="date" defaultValue={from} />
            <InputField id="to" name="to" label="To" type="date" defaultValue={to} />
            {sheet ? (
              <SelectField
                id="classSectionId"
                name="classSectionId"
                label="Class"
                defaultValue={sp.classSectionId ?? ''}
                options={[
                  { value: '', label: 'All classes' },
                  ...sheet.options.map((o) => ({ value: o.classSectionId, label: o.section })),
                ]}
              />
            ) : null}
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          <h3 className="ep-card__title">Homework and classwork</h3>
          <WorkReport items={report} mode="daily" extra={remove} />
          <h3 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
            Assignments
          </h3>
          <WorkReport items={report} mode="assignment" extra={remove} />
        </Card>
      ) : (
        <Card>
          <WorkSheet
            sheet={sheet}
            path="/academics/daily-work"
            view={view}
            action={saveWorkSheet}
          />
        </Card>
      )}
    </>
  );
}
