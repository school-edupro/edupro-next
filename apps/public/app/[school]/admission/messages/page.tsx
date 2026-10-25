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

/**
 * Messages (docs/design/42, part 4): the school's notices for candidates and its messages to the family
 * (Compose and the admission emails), newest first, the unread ones marked; opening one marks it read.
 */
export default async function AdmissionMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const inbox = await admissionFetch<PortalInbox>('/me/inbox').catch(() => null);
  if (!inbox) redirect(`/${school}/admission#sign-in`);
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  // the school's emails begin with the letterhead band (school name, "Admissions"): not news in a preview
  const band = profile
    ? new RegExp(
        `^\\s*${profile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(Admissions)?\\s*`,
        'i',
      )
    : null;
  const preview = (text: string) => (band ? text.replace(band, '') : text).slice(0, 120);
  const items = [
    ...inbox.notices.map((n) => ({
      kind: 'notice' as const,
      id: n.id,
      title: n.title,
      at: n.publishFrom,
      text: n.bodyFormat === 'html' ? htmlToText(n.body) : n.body,
      unread: !n.read,
      files: n.files,
      label: w('Notice'),
    })),
    ...inbox.messages.map((m) => ({
      kind: 'message' as const,
      id: m.id,
      title: m.subject ?? w('Message from the school'),
      at: m.at,
      text: m.format === 'html' ? htmlToText(m.body) : m.body,
      unread: !m.read,
      files: [] as Array<{ id: string; name: string | null }>,
      label: m.channel === 'email' ? w('Email') : w('Message'),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{w('Messages')}</h1>
        {inbox.unread ? (
          <form action={markAllInboxRead}>
            <input type="hidden" name="school" value={school} />
            <button className="ep-btn ep-btn--ghost ep-btn--sm" type="submit">
              {w('Mark all as read')} ({inbox.unread})
            </button>
          </form>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="ep-card ep-adm-open__none">{w('No messages from the school yet.')}</p>
      ) : (
        <div className="fp-msg__list">
          {items.map((m) => (
            <AdmissionMessage
              key={`${m.kind}-${m.id}`}
              kind={m.kind}
              id={m.id}
              title={m.title}
              meta={`${dmy(m.at)} · ${m.label}`}
              preview={preview(m.text)}
              unread={m.unread}
              unreadLabel={w('Unread')}
              open={sp.open === `${m.kind}-${m.id}`}
            >
              <p className="fp-msg__text" style={{ whiteSpace: 'pre-line' }}>
                {m.text}
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
          ))}
        </div>
      )}
    </>
  );
}
