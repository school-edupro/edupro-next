import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { apiFetch } from '@/lib/api';

interface Row {
  id: string;
  cycle: string;
  employee: { name: string; code: string; designation: string | null };
  status: 'self' | 'review' | 'disclosed' | 'represented' | 'closed';
  level: { seq: number; label: string | null } | null;
  grade: string | null;
  objectBy: string | null;
}
const STATUS: Record<Row['status'], string> = {
  self: 'Self-appraisal to fill',
  review: 'With the levels',
  disclosed: 'Ready for you to see',
  represented: 'Your objection is with the school',
  closed: 'Final',
};

/**
 * My ACR in the admin app (docs/design/32-employee-acr.md): the staff app's Office → My ACR for staff
 * who work here. My own annual confidential reports, and the reports waiting on me as a level.
 */
export default async function MyAcrPage() {
  const [mine, assess] = await Promise.all([
    apiFetch<{ data: Row[] }>('/people/acr/mine').catch(() => ({ data: [] })),
    apiFetch<{ waiting: Row[]; done: Row[] }>('/people/acr/to-assess').catch(() => ({
      waiting: [],
      done: [],
    })),
  ]);
  return (
    <>
      <Breadcrumbs items={[{ label: 'My profile', href: '/me/profile' }, { label: 'My ACR' }]} />
      <PageHeader
        kicker="My profile"
        title="My ACR"
        description="Your annual confidential report, and the reports waiting on you."
      />
      <Card title="My ACR" style={{ marginBottom: 'var(--sp-4)' }}>
        {mine.data.length ? (
          <div className="ep-staff-tiles">
            {[...mine.data].reverse().map((r) => (
              <a
                key={r.id}
                href={`/me/acr/${r.id}`}
                className="ep-card ep-card--elevated ep-staff-tile"
              >
                <span className="ep-staff-tile__title">{r.cycle}</span>
                <span>{STATUS[r.status]}</span>
                {r.grade && r.status !== 'self' && r.status !== 'review' ? (
                  <span className="ep-field__help">Grade: {r.grade}</span>
                ) : null}
              </a>
            ))}
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No ACR is open for you now. The school starts them for a year under Employee ACR.
          </p>
        )}
      </Card>
      <Card title={`ACRs to assess (${String(assess.waiting.length)})`}>
        {assess.waiting.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">ACRs waiting on me</caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Your level</th>
                </tr>
              </thead>
              <tbody>
                {assess.waiting.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/me/acr/${r.id}`}>
                        <strong>{r.employee.name}</strong>
                      </a>
                      <div className="ep-field__help">
                        {[r.employee.code, r.employee.designation].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{r.level?.label ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing is waiting on you.
          </p>
        )}
        {assess.done.length ? (
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary>Filled by you this year ({assess.done.length})</summary>
            <ul>
              {assess.done.map((r) => (
                <li key={r.id}>
                  <a href={`/me/acr/${r.id}`}>{r.employee.name}</a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </>
  );
}
