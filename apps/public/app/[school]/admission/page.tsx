import { Card } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import {
  ADMISSION_COOKIE,
  admissionFetch,
  dmy,
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

  // an enquiry's invitation goes on to Apply for a class with its token (docs/design/42, part 3)
  if (enquiry)
    redirect(
      `/${school}/admission/apply?enquiry=${enquiry}${sp.session ? `&session=${encodeURIComponent(sp.session)}` : ''}`,
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
    </>
  );
}
