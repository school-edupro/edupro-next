import {
  AssistantChat,
  assistantWords,
  Card,
  PageHeader,
  type AssistantMessageView,
  type AssistantStartView,
} from '@edupro/ui';
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
  messages?: AssistantMessageView[];
}

/**
 * The assistant for parents and students (docs/design/91 phase E), as the app has it: the start (starter
 * questions, ask again, today's count), each answer's records, the screen to open and what to ask next; a parent's
 * consent, a student's "ask a parent", switched off and today's limit. Own children (or self) only.
 */
export default async function ParentAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let start: AssistantStartView | null = null;
  let entries: Entry[] = [];
  let conversations: Conversation[] = [];
  let blocked = false;
  try {
    [start, entries, conversations] = await Promise.all([
      bff.api.fetch<AssistantStartView>('/insights/assistant/start'),
      bff.api.fetch<{ data: Entry[] }>('/insights/assistant/catalogue').then((r) => r.data),
      bff.api
        .fetch<{ data: Conversation[] }>('/insights/assistant/conversations')
        .then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) blocked = true;
    else throw error;
  }
  const current = sp.c
    ? await bff.api
        .fetch<Conversation>(`/insights/assistant/conversations/${sp.c}`)
        .catch(() => null)
    : null;
  const words = assistantWords(start?.audience === 'student' ? 'student' : 'parent', lang);
  const allowed = entries.filter((e) => e.allowed);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Assistant')}
        title={words.title}
        description={words.intro}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {blocked ? (
        <Card>{t(lang, 'The assistant is not open to you at this school.')}</Card>
      ) : (
        <>
          <AssistantChat
            lang={lang}
            start={start}
            conversationId={current?.id ?? null}
            messages={current?.messages ?? []}
            action={askParentAssistant}
            newHref="/assistant"
            profileHref="/profile"
            error={sp.error ? { type: sp.error, detail: sp.detail } : null}
          />
          <details className="ep-card" style={{ marginTop: 'var(--sp-3)' }}>
            <summary>
              <strong>{t(lang, 'What you can ask')}</strong>{' '}
              <span className="ep-field__help">
                · {allowed.length}{' '}
                {t(lang, allowed.length === 1 ? 'kind of question' : 'kinds of question')}
              </span>
            </summary>
            <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
              {allowed.map((e) => (
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
                'Your questions are stored with personal details masked. Nothing is sent outside the school’s system.',
              )}
            </p>
          </details>
          {conversations.length ? (
            <details className="ep-card" style={{ marginTop: 'var(--sp-3)' }}>
              <summary>
                <strong>{t(lang, 'Recent conversations')}</strong>{' '}
                <span className="ep-field__help">
                  · {Math.min(conversations.length, 10)} · {t(lang, 'latest first')}
                </span>
              </summary>
              <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2em' }}>
                {conversations.slice(0, 10).map((c) => (
                  <li key={c.id}>
                    <a href={`/assistant?c=${c.id}`}>{c.title ?? c.id.slice(0, 8)}</a>
                    <span className="ep-field__help"> · {c.updatedAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </main>
  );
}
