import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { askParentAssistant } from './actions';

interface Entry {
  id: string;
  title: string;
  titleHi: string;
  description: string;
  allowed: boolean;
}
interface Conversation {
  id: string;
  title: string | null;
  turns: number;
  updatedAt: string;
  messages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    refused: boolean;
    citations: Array<{ query: string; title: string; rows: number }>;
  }>;
}

/** Sprint 15 (AI track): the family assistant — own children only, opt-in through the ai.assistant consent. */
export default async function ParentAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let entries: Entry[] = [];
  let conversations: Conversation[] = [];
  let blocked: 'role' | null = null;
  try {
    [entries, conversations] = await Promise.all([
      bff.api.fetch<{ data: Entry[] }>('/insights/assistant/catalogue').then((r) => r.data),
      bff.api
        .fetch<{ data: Conversation[] }>('/insights/assistant/conversations')
        .then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) blocked = 'role';
    else throw error;
  }
  const current = sp.c
    ? await bff.api
        .fetch<Conversation>(`/insights/assistant/conversations/${sp.c}`)
        .catch(() => null)
    : null;
  const consentNeeded = sp.error === 'consent-required';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Assistant')}
        title={t(lang, 'Ask about your children')}
        description={t(
          lang,
          'Fees due, attendance, homework and notices of your own children, in English, Hindi or Hinglish. Answers come only from school records and name their source.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {blocked ? (
        <Card>{t(lang, 'The assistant is not enabled for families in this school yet.')}</Card>
      ) : null}
      {consentNeeded ? (
        <div
          className="ep-alert ep-alert--warning"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(
            lang,
            'The assistant needs your consent (AI assistant) first. Turn it on under Profile → Your consents; you can withdraw it at any time.',
          )}{' '}
          <a href="/profile">{t(lang, 'Open profile')}</a>
        </div>
      ) : sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.error}
          {sp.detail ? ` — ${sp.detail}` : ''}
        </div>
      ) : null}
      {!blocked ? (
        <>
          <Card style={{ marginBottom: 'var(--sp-3)' }}>
            {current?.messages?.length ? (
              <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
                {current.messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      borderLeft: `3px solid ${m.role === 'user' ? 'var(--color-border)' : 'var(--color-accent, #0aa)'}`,
                      paddingLeft: 'var(--sp-3)',
                    }}
                  >
                    <div className="ep-kicker">
                      {m.role === 'user' ? t(lang, 'You') : t(lang, 'Assistant')}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    {m.citations?.length ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-2)',
                          flexWrap: 'wrap',
                          marginTop: 4,
                        }}
                      >
                        {m.citations.map((c) => (
                          <Badge key={c.query} tone="neutral">
                            {c.title}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <form action={askParentAssistant}>
              <input type="hidden" name="conversationId" value={current?.id ?? ''} />
              <label className="ep-field">
                <span className="ep-field__label">{t(lang, 'Your question')}</span>
                <textarea
                  className="ep-input"
                  name="question"
                  rows={3}
                  minLength={2}
                  maxLength={1000}
                  required
                  placeholder="Kitni fees baki hai? · Was my child absent this week? · इस हफ्ते का गृहकार्य"
                />
              </label>
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                  marginTop: 'var(--sp-2)',
                }}
              >
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Language')}</span>
                  <select className="ep-input" name="language" defaultValue="">
                    <option value="">{t(lang, 'Auto')}</option>
                    <option value="en">English</option>
                    <option value="hi">हिन्दी</option>
                    <option value="hinglish">Hinglish</option>
                  </select>
                </label>
                <Button type="submit">{t(lang, 'Ask')}</Button>
                {current ? (
                  <a className="ep-btn ep-btn--ghost" href="/assistant">
                    {t(lang, 'New conversation')}
                  </a>
                ) : null}
              </div>
            </form>
          </Card>
          <Card title={t(lang, 'What you can ask')} style={{ marginBottom: 'var(--sp-3)' }}>
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {entries
                .filter((e) => e.allowed)
                .map((e) => (
                  <li key={e.id}>
                    <strong>{lang === 'hi' ? e.titleHi : e.title}</strong>
                    {lang === 'hi' ? null : (
                      <span className="ep-field__help"> — {e.description}</span>
                    )}
                  </li>
                ))}
            </ul>
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
              {t(
                lang,
                'Your questions are stored with personal details masked and can be withdrawn with the consent.',
              )}
            </p>
          </Card>
          {conversations.length ? (
            <Card title={t(lang, 'Recent conversations')}>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                {conversations.slice(0, 10).map((c) => (
                  <li key={c.id}>
                    <a href={`/assistant?c=${c.id}`}>{c.title ?? c.id.slice(0, 8)}</a>
                    <span className="ep-field__help"> · {c.updatedAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
