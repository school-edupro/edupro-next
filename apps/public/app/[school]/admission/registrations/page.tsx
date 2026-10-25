import { Badge } from '@edupro/ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMISSION_COOKIE,
  STATUS_TEXT,
  admissionFetch,
  rupees,
  type PortalMe,
} from '@/lib/admission';
import { schoolProfile } from '@/lib/school';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { withdrawRegistration } from '../actions';

/**
 * My registrations (docs/design/42, part 3): a card per registration, the unfinished forms first, each
 * with Continue or Open (and Delete for a draft); another child is registered from Apply for a class.
 */
export default async function AdmissionRegistrationsPage({
  params,
}: {
  params: Promise<{ school: string }>;
}) {
  const { school } = await params;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const me = await admissionFetch<PortalMe>('/me').catch(() => null);
  if (!me) redirect(`/${school}/admission#sign-in`);
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  const base = `/${school}/admission`;
  const list = me.applications.filter((a) => a.status !== 'withdrawn');
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
        <ul className="ep-adm-regs">
          {list.map((a) => {
            const st = STATUS_TEXT[a.status] ?? { label: a.status, tone: 'neutral' as const };
            const open = a.status === 'draft' || a.status === 'sent_back';
            return (
              <li key={a.id} className="ep-card ep-adm-reg">
                <div className="ep-adm-reg__head">
                  <h2>{a.candidate || w('New form')}</h2>
                  <Badge tone={st.tone}>{w(st.label)}</Badge>
                </div>
                <dl className="pp-facts">
                  <div>
                    <dt>{w('Class')}</dt>
                    <dd>{a.className}</dd>
                  </div>
                  <div>
                    <dt>{w('Session')}</dt>
                    <dd>
                      {a.session} · {a.academicYear}
                    </dd>
                  </div>
                  <div>
                    <dt>{w('Registration no.')}</dt>
                    <dd>{a.number ?? '-'}</dd>
                  </div>
                  {a.status === 'draft' ? (
                    <div>
                      <dt>{w('Filled')}</dt>
                      <dd>
                        <span className="ep-adm-reg__bar" aria-hidden="true">
                          <span style={{ width: `${String(a.progress)}%` }} />
                        </span>
                        {a.progress}%
                      </dd>
                    </div>
                  ) : null}
                  {a.feeDue ? (
                    <div>
                      <dt>{w('Fee due')}</dt>
                      <dd>{rupees(a.feeDue)}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="ep-adm-rowacts">
                  <a
                    className="ep-btn ep-btn--primary ep-btn--sm"
                    href={`${base}/application/${a.id}`}
                    aria-label={`${open ? w('Continue') : w('Open')}: ${a.candidate || a.className}`}
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
