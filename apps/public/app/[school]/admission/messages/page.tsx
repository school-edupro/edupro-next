import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdmissionMessage } from '@/components/AdmissionMessage';
import { ViewDownload } from '@/components/ViewDownload';
import {
  ADMISSION_COOKIE,
  admissionFetch,
  dmy,
  htmlToText,
  type PortalInbox,
} from '@/lib/admission';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { schoolProfile } from '@/lib/school';
import { markAllInboxRead } from '../actions';

type Tab = 'all' | 'school' | 'automatic' | 'notice';
const TABS: Array<[Tab, string]> = [
  ['all', 'All'],
  ['school', 'From the school'],
  ['automatic', 'Automatic updates'],
  ['notice', 'Notices'],
];
const CHANNEL: Record<string, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };
const ACTION: Record<string, string> = {
  pay: 'Pay the fee',
  correct: 'Correct the form',
  question: 'Open the question',
  open: 'Open the registration',
  apply: 'Apply for a class',
};

/**
 * Messages (docs/design/44, part 2): by who sent them — the school's own words (Compose, answers to the
 * family's questions, replies to its enquiry), the automatic updates of the admission, the notices —
 * each tab with its unread count; how each came (Email · SMS), which child it is about and where to act;
 * a child filter, a search, and "mark all as read" for the tab shown.
 */
export default async function AdmissionMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ open?: string; tab?: string; child?: string; q?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'all';
  const child = /^\d{1,18}$/.test(sp.child ?? '') ? sp.child! : '';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const query = new URLSearchParams({
    ...(tab !== 'all' ? { group: tab } : {}),
    ...(child ? { applicationId: child } : {}),
    ...(q ? { q } : {}),
  }).toString();
  const inbox = await admissionFetch<PortalInbox>(`/me/inbox${query ? `?${query}` : ''}`).catch(
    () => null,
  );
  if (!inbox) redirect(`/${school}/admission#sign-in`);
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  const base = `/${school}/admission`;
  const keep = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      ...(tab !== 'all' ? { tab } : {}),
      ...(child ? { child } : {}),
      ...(q ? { q } : {}),
      ...over,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  // the school's emails begin with the letterhead band (school name, "Admissions"): not news in a preview
  const band = profile
    ? new RegExp(
        `^\\s*${profile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(Admissions)?\\s*`,
        'i',
      )
    : null;
  const preview = (text: string) => (band ? text.replace(band, '') : text).slice(0, 120);
  const counts = inbox.counts ?? { all: 0, school: 0, automatic: 0, notice: 0 };
  const items = inbox.items ?? [];
  const regs = inbox.registrations ?? [];
  const unreadHere = counts[tab];
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{w('Messages')}</h1>
        {unreadHere ? (
          <form action={markAllInboxRead}>
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="group" value={tab === 'all' ? '' : tab} />
            <input type="hidden" name="back" value={keep({})} />
            <button className="ep-btn ep-btn--ghost ep-btn--sm" type="submit">
              {w('Mark all as read')} ({unreadHere})
            </button>
          </form>
        ) : null}
      </div>

      <nav className="ep-adm-msgtabs" aria-label={w('Messages')}>
        {TABS.map(([k, label]) => (
          <a
            key={k}
            href={`${base}/messages${keep({ tab: k === 'all' ? '' : k })}`}
            aria-current={tab === k ? 'page' : undefined}
            className="ep-adm-msgtabs__tab"
          >
            {w(label)}
            {counts[k] ? (
              <span
                className="ep-adm-msgtabs__n"
                aria-label={`${String(counts[k])} ${w('unread')}`}
              >
                {counts[k]}
              </span>
            ) : null}
          </a>
        ))}
      </nav>

      <form method="get" className="ep-adm-msgfilter" role="search">
        {tab !== 'all' ? <input type="hidden" name="tab" value={tab} /> : null}
        {regs.length > 1 ? (
          <label className="ep-field">
            <span className="ep-field__label">{w('Child')}</span>
            <select className="ep-select" name="child" defaultValue={child}>
              <option value="">{w('All children')}</option>
              {regs.map((r) => (
                <option key={r.id} value={r.id}>
                  {[r.candidate || w('New form'), r.className].join(' · ')}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field">
          <span className="ep-field__label">{w('Search')}</span>
          <input className="ep-input" type="search" name="q" defaultValue={q} maxLength={80} />
        </label>
        <button className="ep-btn ep-btn--secondary ep-btn--sm" type="submit">
          {w('Show')}
        </button>
      </form>

      {items.length === 0 ? (
        <p className="ep-card ep-adm-open__none">
          {q || child ? w('Nothing matches.') : w('No messages from the school yet.')}
        </p>
      ) : (
        <div className="fp-msg__list">
          {items.map((m) => {
            if (m.kind === 'notice') {
              const text = m.bodyFormat === 'html' ? htmlToText(m.body) : m.body;
              return (
                <AdmissionMessage
                  key={`notice-${m.id}`}
                  kind="notice"
                  id={m.id}
                  title={m.title}
                  meta={dmy(m.publishFrom)}
                  tags={<span className="ep-adm-msgtag">{w('Notice')}</span>}
                  preview={preview(text)}
                  unread={!m.read}
                  unreadLabel={w('Unread')}
                  open={sp.open === `notice-${m.id}`}
                >
                  <p className="fp-msg__text" style={{ whiteSpace: 'pre-line' }}>
                    {text}
                  </p>
                  {m.files.length ? (
                    <div className="fp-msg__files">
                      {m.files.map((f, i) => (
                        <span key={f.id} className="ep-adm-home__pdf">
                          <span className="ep-kicker">
                            {w('Attachment')} {i + 1}
                          </span>
                          <ViewDownload
                            href={`/api/admission/notice/${m.id}/${f.id}`}
                            what={`${w('attachment')} ${String(i + 1)}: ${m.title}`}
                          />
                        </span>
                      ))}
                    </div>
                  ) : null}
                </AdmissionMessage>
              );
            }
            const text = m.format === 'html' ? htmlToText(m.body) : m.body;
            const mark =
              m.origin === 'answer'
                ? w('Answer to your question')
                : m.origin === 'enquiry_reply'
                  ? w('Reply to your enquiry')
                  : m.group === 'automatic'
                    ? w('Automatic update')
                    : w('From the school');
            const about = m.registration
              ? [m.registration.candidate || w('New form'), m.registration.className].join(' · ')
              : '';
            const href = m.link
              ? m.link.to.startsWith('/')
                ? m.link.to
                : `${base}/${m.link.to}`
              : null;
            return (
              <AdmissionMessage
                key={`message-${m.id}`}
                kind="message"
                id={m.id}
                title={m.subject ?? w('Message from the school')}
                meta={`${dmy(m.at)}${about ? ` · ${about}` : ''}`}
                tags={
                  <>
                    <span className="ep-adm-msgtag" data-group={m.group}>
                      {mark}
                    </span>
                    {m.channels.map((ch) => (
                      <span key={ch} className="ep-adm-msgtag" data-channel={ch}>
                        {w(CHANNEL[ch] ?? ch)}
                      </span>
                    ))}
                  </>
                }
                preview={preview(text)}
                unread={!m.read}
                unreadLabel={w('Unread')}
                open={sp.open === `message-${m.id}`}
              >
                <p className="fp-msg__text" style={{ whiteSpace: 'pre-line' }}>
                  {text}
                </p>
                {href && m.link ? (
                  <p className="ep-adm-msgact">
                    {m.link.action === 'admit_card' ? (
                      <span className="ep-adm-home__pdf">
                        <span className="ep-kicker">{w('Admit card')}</span>
                        <ViewDownload href={href} what={`${w('admit card')}: ${about}`} />
                      </span>
                    ) : (
                      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={href}>
                        {w(ACTION[m.link.action] ?? 'Open')}
                      </a>
                    )}
                  </p>
                ) : null}
              </AdmissionMessage>
            );
          })}
        </div>
      )}
    </>
  );
}
