import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { decideStaffChange } from '@/lib/staff-profile-actions';

type Value = string | number | boolean | null;
interface Req {
  id: string;
  employee: {
    id: string;
    name: string;
    code: string;
    department: string | null;
    designation: string | null;
  };
  status: string;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
  route: Array<{ label: string; done: boolean }>;
  step: number;
  proofs: Array<{ typeId: string; fileId: string; fileName: string | null }>;
  /** 0188: a photo change, shown as the two pictures */
  photo: { from: string | null; to: string } | null;
  canAct: boolean;
  fields: Array<{
    key: string;
    label: string;
    from: Value;
    to: Value;
    status: string;
    note: string | null;
  }>;
}
const shown = (v: Value) => {
  if (v === null || v === '') return '—';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : s;
};
const OUTCOME: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Refused',
  partially_approved: 'Partly approved',
  cancelled: 'Withdrawn',
};

/** Staff profile changes to approve (docs/design/33-people-dashboards.md): field by field, with the proofs. */
export default async function StaffProfileApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string; q?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const box = sp.box === 'all' || sp.box === 'decided' ? sp.box : 'mine';
  const qs = new URLSearchParams({ box, ...(sp.q ? { q: sp.q } : {}) });
  const r = await apiFetch<{ data: Req[]; total: number; awaitingMe: number; canSeeAll: boolean }>(
    `/people/staff-profile-approvals?${qs.toString()}`,
  );
  const back = `/people/staff-profile-approvals?${qs.toString()}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Staff profile approvals' },
        ]}
      />
      <PageHeader
        kicker="Employee management"
        title="Staff profile approvals"
        description="Changes staff asked for on their own profile. Accept or refuse each field; the record changes when the last approver accepts."
      />
      <Notice params={sp} />
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="sa-box" style={{ margin: 0 }}>
          <span className="ep-field__label">Show</span>
          <select id="sa-box" name="box" className="ep-select" defaultValue={box}>
            <option value="mine">Waiting on me ({r.awaitingMe})</option>
            {r.canSeeAll ? <option value="all">All waiting</option> : null}
            {r.canSeeAll ? <option value="decided">Decided</option> : null}
          </select>
        </label>
        <label className="ep-field" htmlFor="sa-q" style={{ margin: 0 }}>
          <span className="ep-field__label">Name or code</span>
          <input id="sa-q" name="q" type="search" className="ep-input" defaultValue={sp.q ?? ''} />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      {!r.data.length ? (
        <p className="ep-field__help">
          {box === 'mine' ? 'Nothing is waiting on you.' : 'No requests.'}
        </p>
      ) : null}
      {r.data.map((q) => (
        <section
          key={q.id}
          className="ep-card ep-acr-card"
          aria-labelledby={`rq-${q.id}`}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 'var(--sp-2)',
            }}
          >
            <h2 id={`rq-${q.id}`} className="ep-card__title" style={{ margin: 0 }}>
              <a href={`/people/employees/${q.employee.id}`}>{q.employee.name}</a>{' '}
              <span className="ep-field__help">
                {[q.employee.code, q.employee.designation, q.employee.department]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </h2>
            <span className="ep-field__help">
              {new Date(q.createdAt).toLocaleString('en-IN')} ·{' '}
              {q.status === 'pending' ? (
                q.route
                  .map(
                    (s, i) =>
                      `${String(i + 1)}. ${s.label}${i === q.step - 1 ? ' (now)' : s.done ? ' ✓' : ''}`,
                  )
                  .join(' → ')
              ) : (
                <Badge
                  tone={
                    q.status === 'approved'
                      ? 'success'
                      : q.status === 'rejected'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {OUTCOME[q.status] ?? q.status}
                </Badge>
              )}
            </span>
          </div>
          {q.reason ? <p className="ep-field__help">Why: {q.reason}</p> : null}
          <form action={decideStaffChange}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="back" value={back} />
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">On file now</th>
                    <th scope="col">Asked for</th>
                    <th scope="col">{q.canAct ? 'Accept' : 'Outcome'}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.fields.map((f) => (
                    <tr key={f.key}>
                      <td>
                        <strong>{f.label}</strong>
                      </td>
                      <td>{shown(f.from)}</td>
                      <td>
                        <strong>{shown(f.to)}</strong>
                      </td>
                      <td>
                        {q.canAct && f.status === 'pending' ? (
                          <>
                            <input type="hidden" name="key" value={f.key} />
                            <input
                              type="checkbox"
                              name="accept"
                              value={f.key}
                              defaultChecked
                              aria-label={`Accept ${f.label}`}
                            />
                          </>
                        ) : (
                          <span>
                            {f.status === 'pending' ? 'Waiting' : (OUTCOME[f.status] ?? f.status)}
                            {f.note ? <span className="ep-field__help"> · {f.note}</span> : null}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {q.photo ? (
              <p
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span className="ep-kicker">Photo</span>
                {q.photo.from ? (
                  <img
                    src={`/api/staff-proofs/${q.id}/${q.photo.from}`}
                    alt="Photo on file"
                    width={72}
                    height={72}
                    style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                ) : (
                  <span className="ep-field__help">none on file</span>
                )}
                <span aria-hidden="true">→</span>
                <img
                  src={`/api/staff-proofs/${q.id}/${q.photo.to}`}
                  alt="New photo"
                  width={72}
                  height={72}
                  style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                />
              </p>
            ) : null}
            {q.proofs.length ? (
              <p>
                Documents:{' '}
                {q.proofs.map((p) => (
                  <a
                    key={p.fileId}
                    href={`/api/staff-proofs/${q.id}/${p.fileId}`}
                    target="_blank"
                    rel="noopener"
                    style={{ marginRight: 'var(--sp-3)' }}
                  >
                    View {p.fileName ?? 'document'}
                  </a>
                ))}
              </p>
            ) : null}
            {q.canAct ? (
              <div className="ep-acr-actions">
                <label
                  className="ep-field"
                  htmlFor={`note-${q.id}`}
                  style={{ flex: '1 1 16rem', margin: 0 }}
                >
                  <span className="ep-field__label">Note (needed when refusing)</span>
                  <input id={`note-${q.id}`} name="note" className="ep-input" maxLength={500} />
                </label>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  Save decision (ticked accepted)
                </button>
                <button
                  type="submit"
                  name="all"
                  value="refuse"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                >
                  Refuse all
                </button>
              </div>
            ) : q.note ? (
              <p className="ep-field__help">Note: {q.note}</p>
            ) : null}
          </form>
        </section>
      ))}
    </>
  );
}
