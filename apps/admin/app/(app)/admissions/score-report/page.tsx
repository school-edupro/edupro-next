import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import type { NumberSeriesSetup, ScoreReport } from '@/lib/admission-scores';
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
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const [numbers, setup] = await Promise.all([
    apiFetch<NumberSeriesSetup>('/admissions/number-series'),
    apiFetch<AdmissionSetup>('/admissions/setup'),
  ]);
  const cycle =
    numbers.cycles.find((y) => y.id === sp.cycleId) ??
    numbers.cycles.find((y) => y.classes.length) ??
    numbers.cycles[0];
  const cls = cycle?.classes.find((k) => k.id === sp.classId) ?? cycle?.classes[0];
  const q = new URLSearchParams();
  if (cycle && cls) {
    q.set('cycleId', cycle.id);
    q.set('classId', cls.id);
    if (sp.categoryId && ID.test(sp.categoryId)) q.set('categoryId', sp.categoryId);
    if (sp.status && /^[a-z_]{3,20}$/.test(sp.status)) q.set('status', sp.status);
    if (sp.check === '1') q.set('check', '1');
  }
  const rep = cycle && cls ? await apiFetch<ScoreReport>(`/admissions/score-report?${q}`) : null;
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
          <label className="ep-field">
            <span className="ep-field__label">Session</span>
            <select className="ep-select" name="cycleId" defaultValue={cycle?.id ?? ''}>
              {numbers.cycles.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={cls?.id ?? ''}>
              {(cycle?.classes ?? []).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
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
          <div>
            <button className="ep-btn ep-btn--primary" type="submit">
              Show
            </button>
          </div>
        </form>
      </Card>
      {!rep ? (
        <p className="ep-card">No admission session with classes yet.</p>
      ) : (
        <Card>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {rep.className} · {rep.session} · {rep.rows.length} registrations
            {rep.max ? ` · points out of ${String(rep.max)}` : ''}. Change the criteria on the
            session&rsquo;s Merit points tab.
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
                    <th scope="col">Form points</th>
                    <th scope="col">Marks</th>
                    <th scope="col">Total</th>
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
                        <div className="ep-kicker">
                          {[r.number, r.category, r.status].filter(Boolean).join(' · ')}
                        </div>
                        {r.check ? <Badge tone="warning">Check</Badge> : null}
                        {r.confirmed ? <Badge tone="success">Confirmed</Badge> : null}
                      </td>
                      {r.lines.map((l, i) => (
                        <td key={i} className="ep-num" title={l?.check ?? undefined}>
                          {l ? `${String(l.points)}` : '-'}
                          {l?.check ? <span className="ep-sr-only"> ({l.check})</span> : null}
                        </td>
                      ))}
                      <td className="ep-num">{n(r.points)}</td>
                      <td className="ep-num">{n(r.marks)}</td>
                      <td className="ep-num">
                        <strong>{n(r.merit)}</strong>
                      </td>
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
