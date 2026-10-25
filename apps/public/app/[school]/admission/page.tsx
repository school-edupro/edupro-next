import { Badge, Card } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import {
  ADMISSION_COOKIE,
  STATUS_TEXT,
  admissionFetch,
  dmy,
  rupees,
  type PortalInbox,
  type PortalDashboard,
  type PortalMe,
  type PortalSession,
} from '@/lib/admission';
import { AdmissionHome } from '@/components/AdmissionHome';
import { AdmissionLanding } from '@/components/AdmissionLanding';
import { ViewDownload } from '@/components/ViewDownload';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { startRegistration, usePasscode, withdrawRegistration } from './actions';

/** An email or notice written in HTML, shown as plain text (no frames, nothing of it runs). */
const htmlToText = (html: string) =>
  html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * The admission portal of a school (docs/design/39, part 3): the open sessions with each class's dates,
 * age window and registration fee; sign-in by a code; the family's registrations; a new registration.
 */
export default async function AdmissionPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ session?: string; error?: string; enquiry?: string; child?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const open = await admissionFetch<{
    school: { name: string; code: string };
    sessions: PortalSession[];
  }>(`/schools/${encodeURIComponent(school)}`, {}, null).catch((error: unknown) => {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  });
  const signedIn = Boolean((await cookies()).get(ADMISSION_COOKIE)?.value);
  const me = signedIn ? await admissionFetch<PortalMe>('/me').catch(() => null) : null;
  const inbox = me ? await admissionFetch<PortalInbox>('/me/inbox').catch(() => null) : null;
  // an invitation from the enquiry desk: kept through the sign-in and given to the new registration
  const enquiry = /^[A-Za-z0-9_-]{16,64}$/.test(sp.enquiry ?? '') ? sp.enquiry! : null;
  // classes where the family has an unfinished form
  const drafted = (cycleId: string, classId: string) =>
    Boolean(
      me?.applications.some(
        (a) => a.status === 'draft' && a.cycleId === cycleId && a.classId === classId,
      ),
    );
  const sessions = sp.session
    ? open.sessions
        .filter((s) => s.code.toLowerCase() === sp.session!.toLowerCase())
        .concat(open.sessions.filter((s) => s.code.toLowerCase() !== sp.session!.toLowerCase()))
    : open.sessions;

  const lang = await currentLang();
  // signed out: the sign-in card and the open classes (docs/design/42, part 1)
  if (!me)
    return (
      <AdmissionLanding
        school={school}
        schoolName={open.school.name}
        sessions={sessions}
        lang={lang}
        error={sp.error}
        returnTo={`/${school}/admission${enquiry ? `?enquiry=${enquiry}${sp.session ? `&session=${encodeURIComponent(sp.session)}` : ''}` : ''}`}
      />
    );

  // signed in: the family's home first (docs/design/42, part 2)
  const dash = await admissionFetch<PortalDashboard>('/me/dashboard').catch(() => null);
  return (
    <>
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {sp.error}
        </div>
      ) : null}

      {dash ? (
        <AdmissionHome
          school={school}
          schoolName={open.school.name}
          data={dash}
          inbox={inbox}
          chosen={sp.child}
          lang={lang}
        />
      ) : null}

      {me ? (
        <Card
          elevated
          id="registrations"
          title={t(lang, 'My registrations')}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {me.applications.length === 0 ? (
            <p style={{ margin: 0 }}>No registration yet. Choose a class below to start one.</p>
          ) : (
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">My registrations</caption>
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Class</th>
                    <th scope="col">Registration no.</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {me.applications.map((a) => {
                    const st = STATUS_TEXT[a.status] ?? {
                      label: a.status,
                      tone: 'neutral' as const,
                    };
                    return (
                      <tr key={a.id}>
                        <td>{a.candidate || 'Not filled yet'}</td>
                        <td>
                          {a.className}
                          <div className="ep-kicker">
                            {a.session} · {a.academicYear}
                          </div>
                        </td>
                        <td>{a.number ?? '-'}</td>
                        <td>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {a.status === 'draft' ? (
                            <div className="ep-kicker">{a.progress}% filled</div>
                          ) : null}
                          {a.feeDue ? (
                            <div className="ep-kicker">{rupees(a.feeDue)} due</div>
                          ) : null}
                        </td>
                        <td>
                          <span className="ep-adm-rowacts">
                            <a
                              className="ep-btn ep-btn--secondary ep-btn--sm"
                              href={`/${school}/admission/application/${a.id}`}
                            >
                              {a.status === 'draft' || a.status === 'sent_back'
                                ? 'Continue'
                                : 'Open'}
                            </a>
                            {a.status === 'draft' ? (
                              <form action={withdrawRegistration}>
                                <input type="hidden" name="school" value={school} />
                                <input type="hidden" name="id" value={a.id} />
                                <button
                                  className="ep-btn ep-btn--ghost ep-btn--sm"
                                  type="submit"
                                  aria-label={`Delete the draft for ${a.className}${a.candidate ? ` (${a.candidate})` : ''}`}
                                >
                                  Delete
                                </button>
                              </form>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <Card
        elevated
        id="messages"
        title={t(lang, 'Messages and notices')}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {!inbox || (!inbox.notices.length && !inbox.messages.length) ? (
          <p style={{ margin: 0 }}>No messages from the school yet.</p>
        ) : null}
        {inbox?.notices.length ? (
          <section aria-label="Notices">
            <h3 className="ep-kicker" style={{ marginTop: 0 }}>
              Notices
            </h3>
            {inbox.notices.map((n) => (
              <details key={`n${n.id}`} className="ep-adm-inbox">
                <summary>
                  <strong>{n.title}</strong> <span className="ep-kicker">{dmy(n.publishFrom)}</span>
                </summary>
                <p style={{ whiteSpace: 'pre-line' }}>
                  {n.bodyFormat === 'html' ? htmlToText(n.body) : n.body}
                </p>
                {n.files.map((f, i) => (
                  <span
                    key={f.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}
                  >
                    <span className="ep-kicker">Attachment {i + 1}</span>
                    <ViewDownload
                      href={`/api/admission/notice/${n.id}/${f.id}`}
                      what={`attachment ${String(i + 1)} of ${n.title}`}
                    />
                  </span>
                ))}
              </details>
            ))}
          </section>
        ) : null}
        {inbox?.messages.length ? (
          <section aria-label="Messages">
            <h3 className="ep-kicker">Messages from the school</h3>
            {inbox.messages.map((m) => (
              <details key={`m${m.id}`} className="ep-adm-inbox">
                <summary>
                  <strong>{m.subject ?? (m.channel === 'email' ? 'Email' : 'Message')}</strong>{' '}
                  <span className="ep-kicker">{dmy(m.at)}</span>
                </summary>
                <p style={{ whiteSpace: 'pre-line' }}>
                  {m.format === 'html' ? htmlToText(m.body) : m.body}
                </p>
              </details>
            ))}
          </section>
        ) : null}
      </Card>
      <div id="apply" className="ep-adm-apply">
        {me ? (
          <Card
            elevated
            title={t(lang, 'Late-entry passcode')}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <form action={usePasscode} className="ep-adm-pass">
              <input type="hidden" name="school" value={school} />
              <label className="ep-field">
                <span className="ep-field__label">Passcode from the school</span>
                <input
                  className="ep-input ep-adm-pass__code"
                  name="code"
                  required
                  minLength={8}
                  maxLength={20}
                  autoComplete="off"
                  placeholder="ABCD-EFGH"
                />
                <span className="ep-field__help">
                  Registrations closed? If the school emailed you a passcode, enter it to open your
                  child&apos;s form.
                </span>
              </label>
              <button className="ep-btn ep-btn--secondary" type="submit">
                Use passcode
              </button>
            </form>
          </Card>
        ) : null}

        {sessions.length === 0 ? <Card>No admission session is open at the moment.</Card> : null}
        {sessions.map((s) => (
          <Card key={s.id} elevated title={s.name} style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="ep-kicker">
              {s.academicYear} · registrations close {dmy(s.closesAt)}
            </div>
            {s.instructions ? <p style={{ whiteSpace: 'pre-line' }}>{s.instructions}</p> : null}
            <div className="ep-table-wrap">
              <table className="ep-table">
                <caption className="ep-sr-only">Classes of {s.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Registration dates</th>
                    <th scope="col">Date of birth</th>
                    <th scope="col">Registration fee</th>
                    <th scope="col">
                      <span className="ep-sr-only">Register</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.classes.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td>
                        {dmy(k.opensAt)} to {dmy(k.closesAt)}
                      </td>
                      <td>
                        {k.dobFrom || k.dobTo
                          ? `${k.dobFrom ? `from ${dmy(k.dobFrom)}` : ''}${k.dobFrom && k.dobTo ? ' ' : ''}${k.dobTo ? `to ${dmy(k.dobTo)}` : ''}`
                          : '-'}
                      </td>
                      <td>
                        {k.registrationFee !== null
                          ? rupees(k.registrationFee)
                          : k.feeFrom !== null
                            ? `from ${rupees(k.feeFrom)}`
                            : 'No fee'}
                      </td>
                      <td>
                        {!k.open ? (
                          <Badge tone="neutral">
                            {new Date(k.opensAt).getTime() > Date.now() ? 'Opens soon' : 'Closed'}
                          </Badge>
                        ) : me ? (
                          <span className="ep-adm-rowacts">
                            {/* the family's draft for the class opens again (docs/design/41, part 2) */}
                            <form action={startRegistration}>
                              <input type="hidden" name="school" value={school} />
                              <input type="hidden" name="cycleId" value={s.id} />
                              <input type="hidden" name="classId" value={k.id} />
                              {enquiry ? (
                                <input type="hidden" name="enquiry" value={enquiry} />
                              ) : null}
                              <button className="ep-btn ep-btn--primary ep-btn--sm" type="submit">
                                {drafted(s.id, k.id) && !enquiry
                                  ? `Continue the ${k.name} form`
                                  : `Register for ${k.name}`}
                              </button>
                            </form>
                            {drafted(s.id, k.id) && !enquiry ? (
                              <form action={startRegistration}>
                                <input type="hidden" name="school" value={school} />
                                <input type="hidden" name="cycleId" value={s.id} />
                                <input type="hidden" name="classId" value={k.id} />
                                <input type="hidden" name="another" value="1" />
                                <button className="ep-btn ep-btn--ghost ep-btn--sm" type="submit">
                                  Register another child
                                </button>
                              </form>
                            ) : null}
                          </span>
                        ) : (
                          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="#sign-in">
                            Sign in to register
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.classes.some((k) => k.points?.length) ? (
              <details className="ep-adm-points">
                <summary>Merit points</summary>
                <p className="ep-kicker">
                  Points come from the form&apos;s answers and are checked with the documents; test
                  and interview marks, where there are any, are added. Equal totals: the older child
                  first, then a draw of lots.
                </p>
                {s.classes
                  .filter((k) => k.points?.length)
                  .map((k) => (
                    <div key={k.id} className="ep-adm-points__class">
                      <h3 className="ep-kicker">{k.name}</h3>
                      <ul>
                        {k.points!.map((p) => (
                          <li key={p.name}>
                            {p.name}: <strong>{p.points > 0 ? `${p.points}` : p.points}</strong>{' '}
                            {Math.abs(p.points) === 1 ? 'point' : 'points'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </details>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
