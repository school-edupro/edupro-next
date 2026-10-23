import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { startWalkIn } from '@/lib/admission-desk-actions';
import { REG_STATUS, dmy, rupees, type DeskOverview } from '@/lib/admission-desk';
import { apiFetch, getMe } from '@/lib/api';

/**
 * The school desk (docs/design/39, part 3): the office registers a walk-in parent for a class taking
 * registrations, fills the same form, and takes the registration fee at the counter.
 */
export default async function AdmissionDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.enter')) notFound();
  const desk = await apiFetch<DeskOverview>('/admissions/desk');
  const lines = desk.sessions.flatMap((s) =>
    s.classes
      .filter((k) => k.open)
      .map((k) => ({
        value: `${s.id}:${k.id}`,
        label: `${k.name} · ${s.name}${k.registrationFee !== null ? ` · fee ${rupees(k.registrationFee)}` : ''}`,
      })),
  );
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission desk"
        description="Register a parent who comes to the school: fill the registration form for them and take the registration fee at the counter. The parent can sign in to the admission portal later with the mobile or email given here."
      />
      <Notice params={sp} />
      <Card elevated title="Register a walk-in" style={{ marginBottom: 'var(--sp-4)' }}>
        {lines.length === 0 ? (
          <p style={{ margin: 0 }}>
            No class is taking registrations now. Open a session and its classes at{' '}
            <a href="/admissions/cycles">Admission sessions</a>.
          </p>
        ) : (
          <form
            action={startWalkIn}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              gap: 'var(--sp-3)',
            }}
          >
            <label className="ep-field">
              <span className="ep-field__label">Class</span>
              <select className="ep-select" name="line" required defaultValue="">
                <option value="" disabled>
                  Choose the class
                </option>
                {lines.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Parent&apos;s name</span>
              <input className="ep-input" name="parentName" maxLength={120} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Mobile number</span>
              <input
                className="ep-input"
                name="mobile"
                inputMode="numeric"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
              />
              <span className="ep-field__help">
                The mobile or the email (or both): sign-in codes and mail go there.
              </span>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Email</span>
              <input className="ep-input" name="email" type="email" maxLength={200} />
            </label>
            <div>
              <button className="ep-btn ep-btn--primary" type="submit">
                Start the form
              </button>
            </div>
          </form>
        )}
      </Card>
      <Card elevated title="Forms filled at the desk">
        {desk.recent.length === 0 ? (
          <p style={{ margin: 0 }}>None yet.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Forms filled at the desk</caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Class</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">Registration no.</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {desk.recent.map((r) => {
                  const st = REG_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
                  return (
                    <tr key={r.id}>
                      <td>{r.candidate || 'Not filled yet'}</td>
                      <td>{r.className}</td>
                      <td>{r.mobile ?? '-'}</td>
                      <td>{r.number ?? '-'}</td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.feeDue ? <div className="ep-kicker">{rupees(r.feeDue)} due</div> : null}
                        {r.status === 'draft' ? (
                          <div className="ep-kicker">{r.progress}% filled</div>
                        ) : null}
                      </td>
                      <td>
                        {dmy(r.createdAt)}
                        {r.enteredBy ? <div className="ep-kicker">{r.enteredBy}</div> : null}
                      </td>
                      <td>
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`/admissions/desk/${r.id}`}
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
