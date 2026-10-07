import { FileLinks } from '@/components/FileLinks';
import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { AckButton } from '@/components/AckButton';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';

interface Work {
  id: string;
  kind: 'homework' | 'classwork' | 'assignment';
  classSectionId: string;
  section: string;
  subjectName: string | null;
  title: string;
  body: string;
  assignedOn: string;
  dueOn: string | null;
  postedBy: string | null;
  files: Array<{ id: string; name: string | null }>;
  publishAt: string;
  ackRequired: boolean;
  ackedFor: string[];
}
interface Viewer {
  kind: 'staff' | 'family';
  students: Array<{
    id: string;
    name: string;
    classSectionId: string | null;
    section: string | null;
  }>;
}
type View = 'day' | 'assignments';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const shift = (date: string, by: number) => iso(new Date(utc(date).getTime() + by * 86_400_000));
const pretty = (s: string, long = false) =>
  utc(s).toLocaleDateString('en-IN', {
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
    timeZone: 'UTC',
  });
const publishedAt = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One entry: its text, files, who posted it and when it was published, and the acknowledgement. */
function Entry({
  lang,
  w,
  childId,
  back,
  today,
}: {
  lang: Lang;
  w: Work;
  childId: string;
  back: string;
  today: string;
}) {
  const late = w.kind === 'assignment' && w.dueOn !== null && w.dueOn < today;
  return (
    <div className="ep-hw__box" data-kind={w.kind} data-late={late ? '' : undefined}>
      <span className="ep-hw__label">{t(lang, w.kind)}</span>
      <div className="ep-hw__text">{w.body || w.title}</div>
      {w.dueOn ? (
        <div style={{ marginTop: 'var(--sp-1)' }}>
          <Badge tone={late ? 'danger' : w.dueOn === today ? 'warning' : 'neutral'}>
            {t(lang, 'due')} {pretty(w.dueOn)}
            {late ? ` · ${t(lang, 'overdue')}` : ''}
          </Badge>
        </div>
      ) : null}
      {w.files.length ? (
        <div className="pp-attachments ep-filecell">
          <span>{t(lang, 'Attachments')}</span>
          {w.files.map((f, i) => (
            <FileLinks
              key={f.id}
              url={`/api/attachment/homework/${w.id}/${f.id}`}
              saveUrl={`/api/attachment/homework/${w.id}/${f.id}?save=1`}
              label={`${t(lang, 'Attachment')} ${String(i + 1)}`}
              viewLabel={t(lang, 'View')}
              saveLabel={t(lang, 'Download')}
            />
          ))}
        </div>
      ) : null}
      <div className="ep-hw__meta">
        {[w.postedBy, `${t(lang, 'Published')} ${publishedAt(w.publishAt)}`]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {w.ackRequired ? (
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <AckButton
            type="daily_work"
            id={w.id}
            studentId={childId}
            done={w.ackedFor.includes(childId)}
            back={back}
            label={t(lang, 'Acknowledge')}
            doneLabel={t(lang, 'Acknowledged')}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Homework for the family, one child at a time. Day: each subject with its homework beside its classwork,
 * from the time the school publishes it. Assignments: the open ones first, by due date.
 */
export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; view?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const view: View = sp.view === 'assignments' ? 'assignments' : 'day';
  let viewer: Viewer;
  try {
    viewer = await bff.api.fetch<Viewer>('/academics/daily-work/viewer');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Homework')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const kids = viewer.students.filter((s) => s.classSectionId);
  const chosen = await chosenChild(sp.child);
  const child = kids.find((k) => k.id === chosen?.id) ?? kids[0];
  const today = iso(new Date(Date.now() + 5.5 * 3_600_000)); // the school's day (IST)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= today ? sp.date! : today;
  const base = `/academics/daily-work?size=200&classSectionId=${child?.classSectionId ?? ''}`;
  const [recent, assignments] = child
    ? await Promise.all([
        // the chosen day and the days before it, to offer the ones that have work
        bff.api
          .fetch<{ data: Work[] }>(`${base}&from=${shift(date, -13)}&to=${date}`)
          .then((r) => r.data.filter((w) => w.kind !== 'assignment')),
        bff.api.fetch<{ data: Work[] }>(`${base}&kind=assignment`).then((r) => r.data),
      ])
    : [[], []];
  const ofDay = recent.filter((w) => w.assignedOn === date);
  const days = [...new Set(recent.map((w) => w.assignedOn))].sort().reverse().slice(0, 7);
  const subjects = [...new Set(ofDay.map((w) => w.subjectName ?? t(lang, 'General')))];
  const open = assignments
    .filter((a) => !a.dueOn || a.dueOn >= today)
    .sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
  const past = assignments.filter((a) => a.dueOn && a.dueOn < today);
  const back = view === 'day' ? `/homework?date=${date}` : '/homework?view=assignments';
  const tab = (v: View, label: string) => (
    <a
      key={v}
      href={v === 'day' ? '/homework' : '/homework?view=assignments'}
      aria-current={view === v ? 'page' : undefined}
    >
      {t(lang, label)}
      {v === 'assignments' && open.length ? ` (${String(open.length)})` : ''}
    </a>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Homework')}
        title={child ? `${child.name} · ${child.section}` : t(lang, 'Homework')}
        description={
          !child
            ? t(lang, 'No enrolled child found')
            : view === 'day'
              ? pretty(date, true)
              : t(lang, 'Assignments with their due dates')
        }
        actions={
          view === 'day' && child ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/homework?date=${shift(date, -1)}`}
              >
                ‹ {t(lang, 'Previous')}
              </a>
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/homework">
                {t(lang, 'Today')}
              </a>
              {date < today ? (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/homework?date=${shift(date, 1)}`}
                >
                  {t(lang, 'Next')} ›
                </a>
              ) : null}
            </span>
          ) : undefined
        }
      />
      <ChildSwitch lang={lang} back={back} current={child?.id} />
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Homework')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {tab('day', 'Homework and classwork')}
        {tab('assignments', 'Assignments')}
      </nav>

      {child && view === 'day' ? (
        <>
          {days.length ? (
            <nav className="ep-hw__days ep-tabs-links" aria-label={t(lang, 'Days with work')}>
              {days.map((d) => (
                <a
                  key={d}
                  href={`/homework?date=${d}`}
                  aria-current={d === date ? 'date' : undefined}
                >
                  {d === today ? t(lang, 'Today') : pretty(d)}
                </a>
              ))}
            </nav>
          ) : null}
          {ofDay.length === 0 ? (
            <Card>
              {date === today
                ? t(lang, 'Nothing has been published for today yet.')
                : t(lang, 'Nothing was posted on this day.')}
            </Card>
          ) : (
            <Card>
              {subjects.map((name) => {
                const list = ofDay.filter((w) => (w.subjectName ?? t(lang, 'General')) === name);
                return (
                  <section key={name} className="ep-hw__subject">
                    <h3>{name}</h3>
                    <div className="ep-hw__pair">
                      {(['homework', 'classwork'] as const).flatMap((kind) =>
                        list
                          .filter((w) => w.kind === kind)
                          .map((w) => (
                            <Entry
                              key={w.id}
                              lang={lang}
                              w={w}
                              childId={child.id}
                              back={back}
                              today={today}
                            />
                          )),
                      )}
                    </div>
                  </section>
                );
              })}
            </Card>
          )}
        </>
      ) : null}

      {child && view === 'assignments' ? (
        <>
          <Card title={t(lang, 'To do')} style={{ marginBottom: 'var(--sp-3)' }}>
            {open.length === 0 ? (
              <p style={{ margin: 0 }}>{t(lang, 'No assignment is pending.')}</p>
            ) : (
              open.map((w) => (
                <section key={w.id} className="ep-hw__subject">
                  <h3>
                    {w.subjectName ?? t(lang, 'General')}{' '}
                    <span className="ep-kicker">
                      {t(lang, 'given')} {pretty(w.assignedOn)}
                    </span>
                  </h3>
                  <Entry lang={lang} w={w} childId={child.id} back={back} today={today} />
                </section>
              ))
            )}
          </Card>
          {past.length ? (
            <Card title={t(lang, 'Past the due date')}>
              {past.map((w) => (
                <section key={w.id} className="ep-hw__subject">
                  <h3>
                    {w.subjectName ?? t(lang, 'General')}{' '}
                    <span className="ep-kicker">
                      {t(lang, 'given')} {pretty(w.assignedOn)}
                    </span>
                  </h3>
                  <Entry lang={lang} w={w} childId={child.id} back={back} today={today} />
                </section>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
