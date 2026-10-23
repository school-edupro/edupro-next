import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { REG_STATUS, dmy } from '@/lib/admission-desk';
import type { ProcessSetup, RegistrationRow } from '@/lib/admission-process';
import type { AdmissionSetup } from '@/lib/admission-setup';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

const SIZE = 50;
const STATUS_ORDER = [
  'submitted',
  'registered',
  'under_review',
  'sent_back',
  'waitlisted',
  'offered',
  'fee_paid',
  'admitted',
  'rejected',
  'withdrawn',
  'cancelled',
];

/**
 * Registrations of online admission (docs/design/39, part 4): every registration of a session with the
 * stage it waits at (and the level), its category, merit and offer, filtered by session, class, stage,
 * category and status.
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    cycleId?: string;
    classId?: string;
    stageId?: string;
    categoryId?: string;
    status?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = new URLSearchParams({ size: String(SIZE), page: String(page) });
  for (const k of ['cycleId', 'classId', 'stageId', 'categoryId', 'status', 'q'] as const)
    if (sp[k]) q.set(k, sp[k]!);
  const [cycles, setup, process, list] = await Promise.all([
    apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then((r) => r.data),
    apiFetch<AdmissionSetup>('/admissions/setup'),
    apiFetch<ProcessSetup>('/admissions/process-setup'),
    apiFetch<{ total: number; data: RegistrationRow[] }>(
      `/admissions/registrations?${q.toString()}`,
    ),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / SIZE));
  const link = (p: number) => {
    const n = new URLSearchParams(q);
    n.delete('size');
    n.set('page', String(p));
    return `/admissions/registrations?${n.toString()}`;
  };
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Registrations"
        description={`Registrations with the stage each waits at; open one to decide. ${String(list.total)} found.`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/schedule">
              Tests and interviews
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/selection">
              Selection
            </a>
          </span>
        }
      />
      <Notice params={sp} />
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
            <select className="ep-select" name="cycleId" defaultValue={sp.cycleId ?? ''}>
              <option value="">All sessions</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={sp.classId ?? ''}>
              <option value="">All classes</option>
              {process.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Waiting at</span>
            <select className="ep-select" name="stageId" defaultValue={sp.stageId ?? ''}>
              <option value="">Any stage</option>
              {process.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Category</span>
            <select className="ep-select" name="categoryId" defaultValue={sp.categoryId ?? ''}>
              <option value="">All categories</option>
              {setup.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Status</span>
            <select className="ep-select" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {REG_STATUS[s]?.label ?? s}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Search</span>
            <input
              className="ep-input"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Name, number, mobile"
            />
          </label>
          <div>
            <button className="ep-btn ep-btn--primary" type="submit">
              Show
            </button>
          </div>
        </form>
      </Card>
      <Card>
        {list.data.length === 0 ? (
          <p style={{ margin: 0 }}>No registration matches.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Registrations</caption>
              <thead>
                <tr>
                  <th scope="col">Registration no.</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Class</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Waiting at</th>
                  <th scope="col">Merit</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => {
                  const st = REG_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
                  return (
                    <tr key={r.id}>
                      <td>
                        <a href={`/admissions/registrations/${r.id}`}>
                          {r.number ?? `Form ${r.id}`}
                        </a>
                        {r.byOffice ? <div className="ep-kicker">Desk</div> : null}
                      </td>
                      <td>
                        {r.candidate ?? '-'}
                        {r.mobile ? <div className="ep-kicker">{r.mobile}</div> : null}
                      </td>
                      <td>
                        {r.className}
                        <div className="ep-kicker">{r.session}</div>
                      </td>
                      <td>{r.category ?? '-'}</td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.waitRank ? <div className="ep-kicker">List no. {r.waitRank}</div> : null}
                        {r.offerExpiresAt && r.status === 'offered' ? (
                          <div className="ep-kicker">Pay by {dmy(r.offerExpiresAt)}</div>
                        ) : null}
                      </td>
                      <td>
                        {r.stage ?? '-'}
                        {r.level ? <div className="ep-kicker">Level {r.level}</div> : null}
                      </td>
                      <td>{r.merit ?? '-'}</td>
                      <td>{dmy(r.registeredAt ?? r.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <nav
            aria-label="Pages"
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              marginTop: 'var(--sp-3)',
              alignItems: 'center',
            }}
          >
            {page > 1 ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(page - 1)}>
                Previous
              </a>
            ) : null}
            <span className="ep-kicker">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link(page + 1)}>
                Next
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
