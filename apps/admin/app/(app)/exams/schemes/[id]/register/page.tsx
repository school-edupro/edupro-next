import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { RegisterDownloads } from '@/components/exams/RegisterDownloads';
import { RegisterSheet } from '@/components/exams/RegisterSheet';
import { ApiError, apiFetch } from '@/lib/api';
import type { RunResponse } from '@/lib/mark-schemes';

const REPORT_KINDS = [
  'summary',
  'analysis',
  'entry',
  'toppers',
  'teacher',
  'risk',
  'failing',
  'compare',
];

const RESULT: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pass: { label: 'Pass', tone: 'success' },
  compartment: { label: 'Compartment', tone: 'warning' },
  fail: { label: 'Fail', tone: 'danger' },
  absent: { label: 'Absent', tone: 'neutral' },
  incomplete: { label: 'Incomplete', tone: 'neutral' },
};

/**
 * Run a mark register (docs/design/68): pick the class — a section, or a whole class ranked together
 * (the merit list, by rank or division-wise) — the exam of an exam-wise register and a subject (its own
 * sheet). The marks come from the exam entry; the sheet shows the register's columns, totals, grades and
 * the final, with what to check above it. The Reports menu has the legacy's eight reports (Result
 * summary, Analysis, Entry status, Toppers, Teacher-wise, At-risk, Failing students, Compare sections:
 * phase 2). Download what is shown as PDF (the paper asked) or Excel, one section or all.
 */
export default async function RunRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    place?: string;
    exam?: string;
    subject?: string;
    view?: string;
    report?: string;
    top?: string;
    margin?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const place = /^[sc]:\d{1,18}$/.test(sp.place ?? '') ? sp.place! : '';
  const view =
    place.startsWith('c:') && sp.view === 'division'
      ? 'division'
      : place.startsWith('c:')
        ? 'merit'
        : 'marks';
  const q = new URLSearchParams({ view });
  if (place) q.set(place.startsWith('s:') ? 'classSectionId' : 'classId', place.slice(2));
  if (sp.exam && /^[A-Z][A-Z0-9_]{0,11}$/.test(sp.exam)) q.set('exam', sp.exam);
  if (sp.subject && /^[A-Za-z0-9_~-]{1,32}$/.test(sp.subject)) q.set('subject', sp.subject);
  const report = REPORT_KINDS.includes(sp.report ?? '') ? sp.report! : 'register';
  const top = ['3', '5', '10'].includes(sp.top ?? '') ? sp.top! : '3';
  const margin = ['5', '10'].includes(sp.margin ?? '') ? sp.margin! : '5';
  q.set('report', report);
  if (report === 'toppers') q.set('top', top);
  if (report === 'risk') q.set('margin', margin);
  const reg = await apiFetch<RunResponse>(`/exams/schemes/${id}/register?${q.toString()}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    },
  );
  const s = reg.scheme;
  const shownPlace = place || reg.places[0]?.value || '';
  const label = reg.places.find((p) => p.value === shownPlace)?.label ?? '';
  const merit = shownPlace.startsWith('c:');
  // a link to the same place with another report
  const linkTo = (kind: string) => {
    const l = new URLSearchParams();
    if (shownPlace) l.set('place', shownPlace);
    if (reg.exam && s.type === 'examwise') l.set('exam', reg.exam);
    if (sp.subject) l.set('subject', sp.subject);
    if (kind !== 'register') l.set('report', kind);
    return `/exams/schemes/${s.id}/register?${l.toString()}`;
  };
  const reportLabel = reg.reports.find((x) => x.kind === report)?.label ?? 'Register';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark registers', href: '/exams/schemes' },
          { label: s.name, href: `/exams/schemes/${s.id}` },
          { label: 'Run' },
        ]}
      />
      <PageHeader
        kicker={`Run · version ${String(s.version)}${s.status === 'draft' ? ' (draft)' : ''}`}
        title={`▶ ${s.name}`}
        description={`${reportLabel} · ${label}${reg.examName ? ` · ${reg.examName}` : ''}`}
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="ep-mr-toolbar">
          <form method="get" className="ep-mr-toolbar" style={{ flex: 1 }}>
            <label className="ep-field" style={{ margin: 0, minWidth: '14rem' }}>
              <span className="ep-field__label">Class</span>
              <select className="ep-select" name="place" defaultValue={shownPlace}>
                {reg.places.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {s.type === 'examwise' ? (
              <label className="ep-field" style={{ margin: 0, minWidth: '8rem' }}>
                <span className="ep-field__label">Exam</span>
                <select className="ep-select" name="exam" defaultValue={reg.exam ?? ''}>
                  {reg.exams.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="ep-field" style={{ margin: 0, minWidth: '12rem' }}>
              <span className="ep-field__label">Subject</span>
              <select className="ep-select" name="subject" defaultValue={sp.subject ?? ''}>
                <option value="">All subjects</option>
                {reg.subjects.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
            {report !== 'register' ? <input type="hidden" name="report" value={report} /> : null}
            {report === 'toppers' ? (
              <label className="ep-field" style={{ margin: 0, minWidth: '7rem' }}>
                <span className="ep-field__label">Top</span>
                <select className="ep-select" name="top" defaultValue={top}>
                  {['3', '5', '10'].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {report === 'risk' ? (
              <label className="ep-field" style={{ margin: 0, minWidth: '9rem' }}>
                <span className="ep-field__label">Borderline margin</span>
                <select className="ep-select" name="margin" defaultValue={margin}>
                  <option value="5">Pass % + 5</option>
                  <option value="10">Pass % + 10</option>
                </select>
              </label>
            ) : null}
            {merit && report === 'register' ? (
              <label className="ep-field" style={{ margin: 0, minWidth: '10rem' }}>
                <span className="ep-field__label">Merit order</span>
                <select className="ep-select" name="view" defaultValue={view}>
                  <option value="merit">Rank (1, 2, 3 …)</option>
                  <option value="division">Division-wise</option>
                </select>
              </label>
            ) : null}
            <AutoSubmit />
            <noscript>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Show
              </button>
            </noscript>
          </form>
          <details className="ep-mr-menu">
            <summary className="ep-btn ep-btn--ghost ep-btn--sm">{`Reports: ${reportLabel} ▾`}</summary>
            <div className="ep-mr-menu__list">
              <a
                href={linkTo('register')}
                aria-current={report === 'register' ? 'true' : undefined}
              >
                Register
              </a>
              {reg.reports
                .filter((x) => !x.merit || merit)
                .map((x) => (
                  <a
                    key={x.kind}
                    href={linkTo(x.kind)}
                    aria-current={report === x.kind ? 'true' : undefined}
                  >
                    {x.label}
                  </a>
                ))}
            </div>
          </details>
          <RegisterDownloads
            id={s.id}
            place={shownPlace}
            view={view}
            exam={reg.exam}
            subject={sp.subject ?? null}
            report={report}
            extra={report === 'toppers' ? { top } : report === 'risk' ? { margin } : {}}
          />
        </div>
      </Card>
      {reg.notes.length ? (
        <div className="ep-alert ep-alert--warning" style={{ marginBottom: 'var(--sp-3)' }}>
          <ul style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {reg.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="ep-mr-pills" style={{ marginTop: 0 }}>
        {Object.entries(reg.counts).map(([k, n]) => (
          <Badge key={k} tone={RESULT[k]?.tone ?? 'neutral'}>
            {`${RESULT[k]?.label ?? k} ${String(n)}`}
          </Badge>
        ))}
        <span className="ep-mr-legend">
          <span>
            <i data-tone="calc" />
            worked out
          </span>
          <span>
            <i data-tone="final" />
            final
          </span>
        </span>
      </p>
      {report !== 'register' ? (
        reg.blocks.map((b) => (
          <Fragment key={b.title}>
            {b.sheet.note ? (
              <p className="ep-alert ep-alert--info" style={{ marginBottom: 'var(--sp-4)' }}>
                {b.sheet.note}
              </p>
            ) : null}
            <section className="ep-mr-report" aria-label={b.title}>
              {b.band !== false ? <h2 className="ep-mr-report__title">{b.title}</h2> : null}
              {b.sheet.body.length ? (
                <RegisterSheet sheet={b.sheet} label={`${b.title} · ${label}`} />
              ) : (
                <p className="ep-field__help" style={{ padding: 'var(--sp-3)' }}>
                  Nothing to show.
                </p>
              )}
            </section>
          </Fragment>
        ))
      ) : reg.sheet && reg.sheet.body.length ? (
        <RegisterSheet sheet={reg.sheet} label={`${s.name} · ${label}`} />
      ) : (
        <Card>
          <p style={{ margin: 0 }}>No students here, or nobody takes these subjects.</p>
        </Card>
      )}
    </>
  );
}
