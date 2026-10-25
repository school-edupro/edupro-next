import { Badge } from '@edupro/ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ViewDownload } from '@/components/ViewDownload';
import {
  ADMISSION_COOKIE,
  STATUS_TEXT,
  admissionFetch,
  rupees,
  type PortalDashboard,
} from '@/lib/admission';
import { schoolProfile } from '@/lib/school';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { withdrawRegistration } from '../actions';

/**
 * My registrations as a list (docs/design/44, part 4): one row a registration — the child, class and
 * session, the number, where it stands (how much of a draft is filled), the fee due — with Continue /
 * Open, the registration form once submitted and the admission form once admitted (View + Download),
 * and Delete for a draft. On a phone each row is a card.
 */
export default async function AdmissionRegistrationsPage({
  params,
}: {
  params: Promise<{ school: string }>;
}) {
  const { school } = await params;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const data = await admissionFetch<PortalDashboard>('/me/dashboard').catch(() => null);
  if (!data) redirect(`/${school}/admission#sign-in`);
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  const base = `/${school}/admission`;
  const list = data.registrations.filter((a) => a.status !== 'withdrawn');
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{w('My registrations')}</h1>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${base}/apply`}>
          {w('Register another child')}
        </a>
      </div>
      {list.length === 0 ? (
        <div className="ep-card ep-adm-empty">
          <p>{w('No registration yet. Choose a class to start one.')}</p>
          <a className="ep-btn ep-btn--primary" href={`${base}/apply`}>
            {w('Apply for a class')}
          </a>
        </div>
      ) : (
        <div
          className="ep-table-wrap ep-adm-reglist"
          tabIndex={0}
          role="region"
          aria-label={w('My registrations')}
        >
          <table className="ep-table">
            <caption className="ep-sr-only">{w('My registrations')}</caption>
            <thead>
              <tr>
                <th scope="col">{w('Child')}</th>
                <th scope="col">{w('Class')}</th>
                <th scope="col">{w('Registration no.')}</th>
                <th scope="col">{w('Status')}</th>
                <th scope="col">{w('Fee due')}</th>
                <th scope="col">{w('Forms')}</th>
                <th scope="col">
                  <span className="ep-sr-only">{w('Open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const st = STATUS_TEXT[a.status] ?? { label: a.status, tone: 'neutral' as const };
                const open = a.status === 'draft' || a.status === 'sent_back';
                const name = a.candidate || w('New form');
                const due = a.feeDue + a.admissionFeeDue;
                return (
                  <tr key={a.id}>
                    <th scope="row" data-label={w('Child')}>
                      {name}
                    </th>
                    <td data-label={w('Class')}>
                      {a.className}
                      <span className="ep-adm-reglist__sub">
                        {a.session} · {a.academicYear}
                      </span>
                    </td>
                    <td data-label={w('Registration no.')}>
                      {a.number ?? '—'}
                      {a.admissionNo ? (
                        <span className="ep-adm-reglist__sub">
                          {w('Admission no.')} {a.admissionNo}
                        </span>
                      ) : null}
                    </td>
                    <td data-label={w('Status')}>
                      <Badge tone={st.tone}>{w(st.label)}</Badge>
                      {a.status === 'draft' ? (
                        <span className="ep-adm-reglist__sub">
                          <span className="ep-adm-reg__bar" aria-hidden="true">
                            <span style={{ width: `${String(a.progress)}%` }} />
                          </span>
                          {w('Filled')} {a.progress}%
                        </span>
                      ) : null}
                    </td>
                    <td data-label={w('Fee due')}>{due ? rupees(due) : '—'}</td>
                    <td data-label={w('Forms')}>
                      {a.status === 'draft' ? (
                        '—'
                      ) : (
                        <span className="ep-adm-reglist__forms">
                          <span className="ep-adm-home__pdf">
                            <span className="ep-kicker">{w('Registration form')}</span>
                            <ViewDownload
                              href={`/api/admission/pdf/${a.id}`}
                              what={`${w('the registration form')}: ${name}`}
                            />
                          </span>
                          {a.admissionNo ? (
                            <span className="ep-adm-home__pdf">
                              <span className="ep-kicker">{w('Admission form')}</span>
                              <ViewDownload
                                href={`/api/admission/admform/${a.id}`}
                                what={`${w('the admission form')}: ${name}`}
                              />
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="ep-adm-reglist__acts">
                      <a
                        className="ep-btn ep-btn--primary ep-btn--sm"
                        href={`${base}/application/${a.id}`}
                        aria-label={`${open ? w('Continue') : w('Open')}: ${name}, ${a.className}`}
                      >
                        {open ? w('Continue') : w('Open')}
                      </a>
                      {a.status === 'draft' ? (
                        <form action={withdrawRegistration}>
                          <input type="hidden" name="school" value={school} />
                          <input type="hidden" name="id" value={a.id} />
                          <button
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            type="submit"
                            aria-label={`${w('Delete the draft for')} ${a.className}${a.candidate ? ` (${a.candidate})` : ''}`}
                          >
                            {w('Delete')}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
