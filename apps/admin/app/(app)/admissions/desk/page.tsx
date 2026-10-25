import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { sendDeskLink, startWalkIn } from '@/lib/admission-desk-actions';
import { REG_STATUS, dmy, rupees, type DeskFind, type DeskOverview } from '@/lib/admission-desk';
import { apiFetch, getMe } from '@/lib/api';

/**
 * The school desk (docs/design/39, part 3): the office registers a walk-in parent for a class taking
 * registrations, fills the same form, and takes the registration fee at the counter.
 */
export default async function AdmissionDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.enter')) notFound();
  const desk = await apiFetch<DeskOverview>('/admissions/desk');
  // find (docs/design/45, part 4): any family's registrations and enquiries
  const q = (sp.q ?? '').trim().slice(0, 80);
  const found =
    q.length >= 2
      ? await apiFetch<DeskFind>(`/admissions/desk/find?q=${encodeURIComponent(q)}`)
      : null;
  const canLink = me.permissions.includes('admissions.enquiry.manage');
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
        description="For a parent at the counter: start the registration (the form link to their phone, or fill it with them now), or find any family's registration to help, correct or take the fee."
      />
      <Notice params={sp} />
      <Card elevated title="Find a registration" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-desk-find" role="search">
          <label className="ep-field">
            <span className="ep-field__label">
              Mobile, email, registration number or child&apos;s name
            </span>
            <input className="ep-input" name="q" defaultValue={q} minLength={2} maxLength={80} />
          </label>
          <button className="ep-btn ep-btn--primary" type="submit">
            Find
          </button>
        </form>
        {found ? (
          found.registrations.length || found.enquiries.length ? (
            <>
              {found.registrations.length ? (
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Registrations found"
                >
                  <table className="ep-table">
                    <caption className="ep-sr-only">Registrations found</caption>
                    <thead>
                      <tr>
                        <th scope="col">Candidate</th>
                        <th scope="col">Class</th>
                        <th scope="col">Registration no.</th>
                        <th scope="col">Status</th>
                        <th scope="col">Mobile / email</th>
                        <th scope="col">Form</th>
                        <th scope="col">
                          <span className="ep-sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {found.registrations.map((r) => {
                        const st = REG_STATUS[r.status] ?? {
                          label: r.status,
                          tone: 'neutral' as const,
                        };
                        return (
                          <tr key={r.id}>
                            <td>{r.candidate || 'Not filled yet'}</td>
                            <td>
                              {r.className}
                              <div className="ep-desk-sub">{r.session}</div>
                            </td>
                            <td>
                              {r.number ?? '-'}
                              {r.admissionNo ? (
                                <div className="ep-desk-sub">Adm. {r.admissionNo}</div>
                              ) : null}
                            </td>
                            <td>
                              <Badge tone={st.tone}>{st.label}</Badge>
                              {r.feeDue ? (
                                <div className="ep-desk-sub">{rupees(r.feeDue)} due</div>
                              ) : null}
                              {r.status === 'draft' ? (
                                <div className="ep-desk-sub">{r.progress}% filled</div>
                              ) : null}
                            </td>
                            <td>
                              {r.mobile ?? '-'}
                              {r.email ? <div className="ep-desk-sub">{r.email}</div> : null}
                            </td>
                            <td>
                              {r.status === 'draft' ? (
                                '-'
                              ) : (
                                <ViewDownload
                                  href={`/api/admission-desk/form/${r.id}`}
                                  what={`the form of ${r.candidate || r.className}`}
                                />
                              )}
                            </td>
                            <td className="ep-desk-acts">
                              <a
                                className="ep-btn ep-btn--secondary ep-btn--sm"
                                href={`/admissions/desk/${r.id}`}
                                aria-label={`${r.feeDue ? 'Take the fee' : 'Help with the form'}: ${r.candidate || r.className}`}
                              >
                                {r.feeDue
                                  ? 'Take the fee'
                                  : r.status === 'draft'
                                    ? 'Help fill'
                                    : 'Desk form'}
                              </a>
                              {r.status !== 'draft' ? (
                                <a
                                  className="ep-btn ep-btn--ghost ep-btn--sm"
                                  href={`/admissions/registrations/${r.id}`}
                                  aria-label={`Open the registration of ${r.candidate || r.className}`}
                                >
                                  Registration
                                </a>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ep-field__help">No registration matches.</p>
              )}
              {found.enquiries.length ? (
                <>
                  <h3 className="ep-desk-h3">Enquiries of the family</h3>
                  <ul className="ep-rp__events">
                    {found.enquiries.map((e) => (
                      <li key={e.id}>
                        <a href={`/admissions/enquiries/${e.id}`}>{e.parentName}</a>
                        {e.childName ? ` · ${e.childName}` : ''}
                        <div className="ep-desk-sub">
                          {[e.mobile, e.stage, e.counsellor].filter(Boolean).join(' · ')}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="ep-field__help">Nothing matches &ldquo;{q}&rdquo;.</p>
          )
        ) : null}
      </Card>
      <Card elevated title="Start for the parent" style={{ marginBottom: 'var(--sp-4)' }}>
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
              <span className="ep-field__label">Child&apos;s name</span>
              <input className="ep-input" name="childName" maxLength={120} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Child&apos;s date of birth</span>
              <input className="ep-input" name="childDob" type="date" />
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
            <div className="ep-desk-start">
              {canLink ? (
                <button className="ep-btn ep-btn--primary" type="submit" formAction={sendDeskLink}>
                  Send the form link
                </button>
              ) : null}
              <button
                className={`ep-btn ${canLink ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
                type="submit"
              >
                Fill it now
              </button>
              <span className="ep-field__help">
                {canLink
                  ? 'The link goes to the mobile / email: the parent fills the form on their phone (it starts with the child’s name and date of birth); the visit is kept as an enquiry. Or fill it here with them now.'
                  : 'Fill the form here with the parent now.'}
              </span>
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
