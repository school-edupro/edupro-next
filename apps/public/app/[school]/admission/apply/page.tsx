import { Badge, Card } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import {
  ADMISSION_COOKIE,
  admissionFetch,
  dmy,
  rupees,
  type PortalMe,
  type PortalSession,
} from '@/lib/admission';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { startRegistration, usePasscode } from '../actions';

/**
 * Apply for a class (docs/design/42, part 3): the open sessions with each class's dates, date of birth
 * window, fee and merit points, to continue the family's form or register (another) child; and the
 * late-entry passcode for a closed class.
 */
export default async function AdmissionApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ session?: string; error?: string; enquiry?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const [open, me] = await Promise.all([
    admissionFetch<{ school: { name: string; code: string }; sessions: PortalSession[] }>(
      `/schools/${encodeURIComponent(school)}`,
      {},
      null,
    ).catch((error: unknown) => {
      if (error instanceof PublicApiError && error.status === 404) notFound();
      throw error;
    }),
    admissionFetch<PortalMe>('/me').catch(() => null),
  ]);
  if (!me) redirect(`/${school}/admission#sign-in`);
  const lang = await currentLang();
  // an invitation from the enquiry desk: given to the new registration
  const enquiry = /^[A-Za-z0-9_-]{16,64}$/.test(sp.enquiry ?? '') ? sp.enquiry! : null;
  // classes where the family has an unfinished form
  const drafted = (cycleId: string, classId: string) =>
    me.applications.some(
      (a) => a.status === 'draft' && a.cycleId === cycleId && a.classId === classId,
    );
  const sessions = sp.session
    ? open.sessions
        .filter((s) => s.code.toLowerCase() === sp.session!.toLowerCase())
        .concat(open.sessions.filter((s) => s.code.toLowerCase() !== sp.session!.toLowerCase()))
    : open.sessions;

  return (
    <>
      <div className="ep-adm-pagehead">
        <p className="ep-kicker">{open.school.name}</p>
        <h1 className="ep-page-title">{t(lang, 'Apply for a class')}</h1>
      </div>
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {sp.error}
        </div>
      ) : null}
      <div className="ep-adm-apply">
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

        {sessions.length === 0 ? <Card>No admission session is open at the moment.</Card> : null}
        {sessions.map((s) => (
          <Card key={s.id} elevated title={s.name} style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="ep-kicker">
              {s.academicYear} · registrations close {dmy(s.closesAt)}
            </div>
            {s.instructions ? (
              <details className="ep-adm-more">
                <summary>{t(lang, 'Instructions')}</summary>
                <p style={{ whiteSpace: 'pre-line' }}>{s.instructions}</p>
              </details>
            ) : null}
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
                        ) : (
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
