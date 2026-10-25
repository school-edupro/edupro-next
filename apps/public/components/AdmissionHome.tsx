import { Badge } from '@edupro/ui';
import {
  STATUS_TEXT,
  dmy,
  rupees,
  type PortalDashboard,
  type PortalDashboardItem,
  type PortalInbox,
} from '@/lib/admission';
import { t, type Lang } from '@/lib/i18n';
import { Icon, type IconName } from './nav-icons';
import { ViewDownload } from './ViewDownload';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

/** The one thing the family should do now for a registration, and where to do it. */
function nextStep(
  r: PortalDashboardItem,
  base: string,
  parentUrl: string,
  w: (en: string) => string,
): {
  tone: 'warning' | 'info' | 'success' | 'danger';
  text: string;
  href?: string;
  cta?: string;
} | null {
  const page = `${base}/application/${r.id}`;
  if (r.status === 'cancelled')
    return {
      tone: 'danger',
      text: `${w('This registration is cancelled.')} ${r.cancelReason ?? ''}`,
    };
  if (r.status === 'withdrawn') return null;
  if (r.locked)
    return {
      tone: 'warning',
      text: `${w('Registrations for this class are closed')}${r.locked.closedOn ? ` (${r.locked.closedOn})` : ''}. ${w('If the school gave you a passcode, enter it under Apply for a class.')}`,
      href: `${base}/apply`,
      cta: w('Enter a passcode'),
    };
  if (r.status === 'draft')
    return {
      tone: 'info',
      text: `${w('Finish the form and submit it')} (${String(r.progress)}% ${w('filled')}).`,
      href: page,
      cta: w('Continue the form'),
    };
  if (r.status === 'sent_back')
    return {
      tone: 'warning',
      text: `${w('The school asked for a correction')}${r.correction?.dueOn ? ` ${w('by')} ${dmy(r.correction.dueOn)}` : ''}: ${r.correction?.remark ?? ''}`,
      href: page,
      cta: w('Correct the form'),
    };
  if (r.feeDue > 0)
    return {
      tone: 'warning',
      text: `${w('Pay the registration fee of')} ${rupees(r.feeDue)} ${w('to get the registration number.')}`,
      href: page,
      cta: w('Pay now'),
    };
  if (r.slot && new Date(r.slot.startsAt).getTime() > Date.now())
    return {
      tone: 'info',
      text: `${r.slot.stage} ${w('on')} ${when(r.slot.startsAt)}, ${r.slot.venue}. ${w('Carry the admit card.')}`,
      href: `/api/admission/admit/${r.id}`,
      cta: w('View the admit card'),
    };
  if (r.admissionFeeDue > 0)
    return {
      tone: 'warning',
      text: `${w('Admission offered. Pay the admission fee of')} ${rupees(r.admissionFeeDue)}${r.offerExpiresAt ? ` ${w('by')} ${dmy(r.offerExpiresAt)}` : ''}.`,
      href: page,
      cta: w('Pay the admission fee'),
    };
  if (r.status === 'waitlisted')
    return {
      tone: 'info',
      text: `${w('On the waiting list')}${r.waitRank ? `, ${w('place')} ${String(r.waitRank)}` : ''}. ${w('The school writes to you if a seat comes up.')}`,
    };
  if (r.status === 'fee_paid')
    return {
      tone: 'success',
      text: w('Admission fee received. The school completes the admission.'),
    };
  if (r.status === 'admitted')
    return {
      tone: 'success',
      text: `${w('Admitted')}${r.admissionNo ? ` (${w('admission no.')} ${r.admissionNo})` : ''}. ${w('The parent portal has the rest: sign in there with the same mobile.')}`,
      href: parentUrl,
      cta: w('Open the parent portal'),
    };
  if (r.status === 'rejected') return { tone: 'danger', text: w('Not selected this time.') };
  return {
    tone: 'info',
    text: w('The school is reviewing the registration; you will hear by email.'),
  };
}

function Glance({
  icon,
  label,
  value,
  note,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="fp-glance">
      <span className="fp-glance__icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className="fp-glance__body">
        <span className="fp-glance__label">{label}</span>
        <span className="fp-glance__value">{value}</span>
        {note ? <span className="fp-glance__note">{note}</span> : null}
      </span>
    </div>
  );
}

/**
 * The family's home in the admission portal (docs/design/42, part 2): a greeting, a chip per child, the
 * child's card, the one next step, the figures at a glance, the class's steps, the latest messages and
 * the dates that matter. A family with no registration is pointed to "Apply for a class".
 */
export function AdmissionHome({
  school,
  schoolName,
  data,
  inbox,
  chosen,
  lang,
}: {
  school: string;
  schoolName: string;
  data: PortalDashboard;
  inbox: PortalInbox | null;
  /** the child (registration) picked by ?child= */
  chosen?: string;
  lang: Lang;
}) {
  const w = (en: string) => t(lang, en);
  const base = `/${school}/admission`;
  const family = data.family.name?.trim() || data.family.mobile || data.family.email || w('Family');
  const live = data.registrations.filter((r) => r.status !== 'withdrawn');
  const r = live.find((x) => x.id === chosen) ?? live[0];
  const st = r ? (STATUS_TEXT[r.status] ?? { label: r.status, tone: 'neutral' as const }) : null;
  const next = r ? nextStep(r, base, data.parentPortalUrl, w) : null;
  const current = r?.steps.find((s) => s.state === 'current');
  const latest = [
    ...(inbox?.notices ?? []).map((n) => ({
      id: `notice-${n.id}`,
      title: n.title,
      at: n.publishFrom,
    })),
    ...(inbox?.messages ?? []).map((m) => ({
      id: `message-${m.id}`,
      title: m.subject ?? w('Message from the school'),
      at: m.at,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);
  const dates = r
    ? [
        r.status === 'draft' && r.closesAt
          ? { label: w('Registrations close'), at: r.closesAt }
          : null,
        r.slot
          ? {
              label: `${r.slot.stage} (${w('roll no.')} ${String(r.slot.rollNo)})`,
              at: r.slot.startsAt,
            }
          : null,
        r.offerExpiresAt
          ? { label: w('Last date for the admission fee'), at: r.offerExpiresAt }
          : null,
        r.correction?.dueOn ? { label: w('Correction due'), at: r.correction.dueOn } : null,
      ].filter((x): x is { label: string; at: string } => Boolean(x))
    : [];

  return (
    <section className="ep-adm-home" aria-labelledby="adm-home-title">
      <div>
        <p className="ep-kicker">{schoolName}</p>
        <h1 id="adm-home-title" className="ep-page-title">
          {w('Namaste')}, {family}
        </h1>
      </div>

      {!r ? (
        <div className="ep-card ep-adm-empty">
          <p>{w('No registration yet. Choose a class to start one.')}</p>
          <a className="ep-btn ep-btn--primary" href={`${base}/apply`}>
            {w('Apply for a class')}
          </a>
        </div>
      ) : (
        <>
          {live.length > 1 ? (
            <nav className="pp-kids" aria-label={w('Choose a child')}>
              {live.map((x) => (
                <a
                  key={x.id}
                  href={`${base}?child=${x.id}`}
                  aria-current={x.id === r.id ? 'page' : undefined}
                >
                  {x.candidate || w('New form')}
                  <span> · {x.className}</span>
                </a>
              ))}
            </nav>
          ) : null}

          <div className="ep-card ep-card--elevated">
            <div className="pp-hero">
              {r.photoId ? (
                <img
                  className="pp-photo"
                  src={`/api/admission/file/${r.photoId}`}
                  alt={r.candidate ?? w('Candidate')}
                />
              ) : (
                <span
                  className="pp-photo pp-photo--empty"
                  role="img"
                  aria-label={`${r.candidate ?? w('Candidate')}: ${w('no photo')}`}
                >
                  {(r.candidate ?? '?').slice(0, 1)}
                </span>
              )}
              <div className="pp-hero__body">
                <h2 className="pp-hero__name">{r.candidate || w('New form')}</h2>
                <dl className="pp-facts">
                  <div>
                    <dt>{w('Class')}</dt>
                    <dd>{r.className}</dd>
                  </div>
                  <div>
                    <dt>{w('Session')}</dt>
                    <dd>{r.session}</dd>
                  </div>
                  <div>
                    <dt>{w('Registration no.')}</dt>
                    <dd>{r.number ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>{w('Status')}</dt>
                    <dd>
                      <Badge tone={st!.tone}>{w(st!.label)}</Badge>
                    </dd>
                  </div>
                </dl>
                <div className="pp-hero__actions">
                  <a
                    className="ep-btn ep-btn--primary ep-btn--sm"
                    href={`${base}/application/${r.id}`}
                  >
                    {r.status === 'draft' || r.status === 'sent_back'
                      ? w('Continue the form')
                      : w('View form')}
                  </a>
                  {r.hasPdf ? (
                    <span className="ep-adm-home__pdf">
                      <span className="ep-field__help">{w('Form (PDF)')}</span>
                      <ViewDownload
                        href={`/api/admission/pdf/${r.id}`}
                        what={w('the registration form')}
                      />
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {next ? (
            <div className={`ep-alert ep-alert--${next.tone} ep-adm-next`} role="status">
              <span>{next.text}</span>
              {next.href && next.cta ? (
                <a className="ep-btn ep-btn--primary ep-btn--sm" href={next.href}>
                  {next.cta}
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="fp-glances fp-glances--4">
            <Glance
              icon="clipboard"
              label={w('Stage')}
              value={current?.name ?? w(st!.label)}
              note={
                r.steps.length
                  ? `${String(r.steps.filter((s) => s.state === 'done').length)} / ${String(r.steps.length)} ${w('steps done')}`
                  : undefined
              }
            />
            <Glance
              icon="bell"
              label={w('Next date')}
              value={dates[0] ? dmy(dates[0].at) : '-'}
              note={dates[0]?.label}
            />
            <Glance
              icon="wallet"
              label={w('Fee due')}
              value={rupees(r.feeDue + r.admissionFeeDue)}
              note={
                r.feeDue
                  ? w('Registration fee')
                  : r.admissionFeeDue
                    ? w('Admission fee')
                    : w('Nothing due')
              }
            />
            <Glance
              icon="check"
              label={w('Merit points')}
              value={r.points ? String(r.points.total) : '-'}
              note={
                r.points
                  ? r.points.confirmed
                    ? w('checked by the school')
                    : w('to be checked')
                  : undefined
              }
            />
          </div>

          {r.steps.length ? (
            <section aria-labelledby="adm-steps">
              <h2 id="adm-steps" className="fp-section-title">
                {w('Admission steps')}
              </h2>
              <ol className="ep-rs ep-card" aria-label={w('Admission steps')}>
                {r.steps.map((s, i) => (
                  <li key={s.name} className="ep-rs__step" data-state={s.state}>
                    <span className="ep-rs__dot" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>
                      <span className="ep-rs__name">{s.name}</span>{' '}
                      <span className="ep-kicker">
                        {s.state === 'done'
                          ? w('done')
                          : s.state === 'current'
                            ? w('in progress')
                            : s.state === 'rejected'
                              ? w('closed')
                              : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <div className="fp-two">
            <section className="ep-card" aria-labelledby="adm-latest">
              <h2 id="adm-latest" className="fp-section-title">
                {w('Latest messages')}
              </h2>
              {latest.length ? (
                <ul className="fp-list">
                  {latest.map((m) => (
                    <li key={m.id}>
                      <a href={`${base}/messages?open=${m.id}#${m.id}`}>{m.title}</a>
                      <span className="fp-list__meta">{dmy(m.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">{w('No messages from the school yet.')}</p>
              )}
            </section>
            <section className="ep-card" aria-labelledby="adm-dates">
              <h2 id="adm-dates" className="fp-section-title">
                {w('Important dates')}
              </h2>
              {dates.length ? (
                <ul className="fp-list">
                  {dates.map((d) => (
                    <li key={d.label}>
                      <span>{d.label}</span>
                      <span className="fp-list__meta">{dmy(d.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">{w('No dates yet.')}</p>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
