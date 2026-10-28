import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ReportViewSelect } from '@/components/admissions/ReportViewSelect';
import { SessionClassPicker } from '@/components/admissions/SessionClassPicker';
import type { ScoreReport, ScoreReportOptions } from '@/lib/admission-scores';
import type { AdmissionSetup } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';

const ID = /^\d{1,18}$/;
const STATUSES: Array<[string, string]> = [
  ['registered', 'Registered'],
  ['under_review', 'Under review'],
  ['sent_back', 'Correction asked'],
  ['waitlisted', 'Waiting list'],
  ['offered', 'Offered'],
  ['fee_paid', 'Admission fee paid'],
  ['admitted', 'Admitted'],
  ['rejected', 'Not selected'],
];

/**
 * The score report (docs/design/48, part 4): a session's class, a row per registration with each merit
 * criterion's points, the form points, the test / interview marks, the total and the rank; filters;
 * Excel and PDF on the letterhead.
 */
export default async function ScoreReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    cycleId?: string;
    classId?: string;
    categoryId?: string;
    status?: string;
    check?: string;
    q?: string;
    view?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const [opts, setup] = await Promise.all([
    apiFetch<ScoreReportOptions>('/admissions/score-report/options'),
    apiFetch<AdmissionSetup>('/admissions/setup'),
  ]);
  // the session and class with registrations first (docs/design/61)
  const cycle =
    opts.cycles.find((y) => y.id === sp.cycleId) ??
    opts.cycles.find((y) => y.registrations > 0) ??
    opts.cycles.find((y) => y.classes.length) ??
    opts.cycles[0];
  const cls =
    cycle?.classes.find((k) => k.id === sp.classId) ??
    cycle?.classes.find((k) => k.registrations > 0) ??
    cycle?.classes[0];
  const search = (sp.q ?? '').trim().slice(0, 80);
  // the filters a session or class change keeps
  const keep: Record<string, string> = {};
  if (sp.categoryId && ID.test(sp.categoryId)) keep.categoryId = sp.categoryId;
  if (sp.status && /^[a-z_]{3,20}$/.test(sp.status)) keep.status = sp.status;
  if (sp.check === '1') keep.check = '1';
  if (search) keep.q = search;
  const viewId = sp.view && (sp.view === 'merit' || ID.test(sp.view)) ? sp.view : 'merit';
  if (viewId !== 'merit') keep.view = viewId;
  const q = new URLSearchParams();
  if (cycle && cls) {
    q.set('cycleId', cycle.id);
    q.set('classId', cls.id);
    if (sp.categoryId && ID.test(sp.categoryId)) q.set('categoryId', sp.categoryId);
    if (sp.status && /^[a-z_]{3,20}$/.test(sp.status)) q.set('status', sp.status);
    if (sp.check === '1') q.set('check', '1');
    if (search) q.set('q', search);
    if (viewId !== 'merit') q.set('view', viewId);
  }
  // a stage no longer in the class's process: back to the merit list
  const rep =
    cycle && cls
      ? await apiFetch<ScoreReport>(`/admissions/score-report?${q}`).catch(async (e: unknown) => {
          if (viewId === 'merit') throw e;
          q.delete('view');
          return apiFetch<ScoreReport>(`/admissions/score-report?${q}`);
        })
      : null;
  const merit = !rep || rep.view.id === 'merit';
  // the Report filter: the merit list, then each written test and interview of the class (one the
  // class has none of is shown, not offered), then any other stage with marks
  const reportOptions = rep
    ? [
        { value: 'merit', label: 'Merit list' },
        ...(['test', 'interview'] as const).flatMap((kind) => {
          const mine = rep.views.filter((v) => v.kind === kind);
          const word = kind === 'test' ? 'Written test' : 'Interview';
          return mine.length
            ? mine.map((v) => ({ value: v.id, label: `${v.name} result` }))
            : [
                {
                  value: `none-${kind}`,
                  label: `${word} result (not in ${rep.className}'s process)`,
                  disabled: true,
                },
              ];
        }),
        ...rep.views
          .filter((v) => !['merit', 'test', 'interview'].includes(v.kind))
          .map((v) => ({ value: v.id, label: `${v.name} result` })),
      ]
    : [];
  const n = (v: number | null) => (v === null ? '-' : String(v));
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Score report"
        description="Each registration of a class with the points of every merit criterion, the test and interview marks, the total and the rank in the merit order."
        actions={
          rep ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/admissions/score-file?report=xlsx&${q}`}
              >
                Export Excel
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/admissions/score-file?report=pdf&${q}`}
              >
                Export PDF
              </a>
            </span>
          ) : undefined
        }
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            gap: 'var(--sp-3)',
            alignItems: 'end',
          }}
        >
          {cycle && cls ? (
            <>
              <SessionClassPicker
                cycles={opts.cycles.map((y) => ({
                  id: y.id,
                  name: y.name,
                  count: y.registrations,
                  classes: y.classes.map((k) => ({
                    id: k.id,
                    name: k.name,
                    count: k.registrations,
                  })),
                }))}
                cycleId={cycle.id}
                classId={cls.id}
                path="/admissions/score-report"
                keep={keep}
              />
              <input type="hidden" name="cycleId" value={cycle.id} />
              <input type="hidden" name="classId" value={cls.id} />
              {viewId !== 'merit' ? <input type="hidden" name="view" value={viewId} /> : null}
            </>
          ) : null}
          {rep ? (
            <ReportViewSelect value={rep.view.id} options={reportOptions} query={q.toString()} />
          ) : null}
          <label className="ep-field">
            <span className="ep-field__label">Name or registration no.</span>
            <input name="q" className="ep-input" maxLength={80} defaultValue={search} />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Category</span>
            <select className="ep-select" name="categoryId" defaultValue={sp.categoryId ?? ''}>
              <option value="">All categories</option>
              {setup.categories.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Status</span>
            <select className="ep-select" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-check">
            <input type="checkbox" name="check" value="1" defaultChecked={sp.check === '1'} />
            <span>Only those with a line to check</span>
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button className="ep-btn ep-btn--primary" type="submit">
              Show
            </button>
            {cycle && cls && Object.keys(keep).length ? (
              <a
                className="ep-btn ep-btn--ghost"
                href={`/admissions/score-report?${new URLSearchParams({ cycleId: cycle.id, classId: cls.id }).toString()}`}
              >
                Clear
              </a>
            ) : null}
          </div>
        </form>
      </Card>
      {!rep ? (
        <p className="ep-card">No admission session with classes yet.</p>
      ) : (
        <Card>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {rep.className} · {rep.session} · {rep.rows.length}{' '}
            {search || sp.status || sp.categoryId || sp.check === '1' ? 'matching ' : ''}
            registrations
            {merit
              ? `${rep.max ? ` · points out of ${String(rep.max)}` : ''}. Change the criteria on the session’s Merit points tab.`
              : ` who reached ${rep.view.name}, ranked by its total (equal totals share a rank).`}
          </p>
          {rep.rows.length === 0 ? (
            <p>No registration matches.</p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Score report (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Score report</caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Registration</th>
                    {rep.criteria.map((k) => (
                      <th key={k.name} scope="col">
                        {k.name}
                      </th>
                    ))}
                    {merit ? <th scope="col">Form points</th> : null}
                    {rep.marks.map((m, i) => (
                      <th key={i} scope="col" className="ep-num">
                        {m.kind === 'part' ? (
                          <>
                            <span
                              className="ep-field__help"
                              style={{ margin: 0, display: 'block' }}
                            >
                              {m.stage}
                            </span>
                            {m.label}
                          </>
                        ) : (
                          m.label
                        )}
                        {m.max !== null ? (
                          <span className="ep-field__help" style={{ margin: 0, display: 'block' }}>
                            of {m.max}
                          </span>
                        ) : null}
                      </th>
                    ))}
                    <th scope="col">{merit ? 'Total' : '%'}</th>
                    {rep.levels.map((l) => (
                      <th key={l} scope="col">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rep.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="ep-num">{r.rank ?? '-'}</td>
                      <td>
                        <a href={`/admissions/registrations/${r.id}`}>
                          {r.candidate ?? r.number ?? 'Registration'}
                        </a>
                        <div className="ep-field__help" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                          {[r.number, r.category, r.status].filter(Boolean).join(' · ')}
                        </div>
                        {r.check ? <Badge tone="warning">Check</Badge> : null}
                        {r.confirmed ? <Badge tone="success">Confirmed</Badge> : null}
                      </td>
                      {merit
                        ? r.lines.map((l, i) => (
                            <td key={i} className="ep-num" title={l?.check ?? undefined}>
                              {l ? `${String(l.points)}` : '-'}
                              {l?.check ? <span className="ep-sr-only"> ({l.check})</span> : null}
                            </td>
                          ))
                        : null}
                      {merit ? <td className="ep-num">{n(r.points)}</td> : null}
                      {r.cells.map((v, i) =>
                        rep.marks[i]?.kind === 'part' ? (
                          <td key={i} className="ep-num">
                            {v === null ? '-' : String(v)}
                          </td>
                        ) : (
                          <td key={i} className="ep-num">
                            <strong>{v === null ? '-' : String(v)}</strong>
                          </td>
                        ),
                      )}
                      <td className="ep-num">
                        <strong>{merit ? n(r.merit) : n(r.percent)}</strong>
                      </td>
                      {rep.levels.map((l, i) => (
                        <td key={l} style={{ minWidth: '12rem' }}>
                          {r.remarks[i] ?? <span className="ep-field__help">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
