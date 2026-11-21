import {
  AssistantChat,
  assistantWords,
  Card,
  PageHeader,
  type AssistantMessageView,
  type AssistantStartView,
} from '@edupro/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { askAssistant } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { AssistantConversation, CatalogueEntryView } from '@/lib/types';

/**
 * The staff assistant (docs/design/91 phase E), as the app has it: the start (the school's starter questions, ask
 * again, today's count), each answer's records, the screen to open and what to ask next, with the conversations
 * and what may be asked by department.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const [me, t, s, i, locale, conversations, catalogue, start] = await Promise.all([
    getMe(),
    getTranslations('pages.insights_assistant'),
    getTranslations('assistant'),
    getTranslations('insights'),
    getLocale(),
    apiFetch<{ data: AssistantConversation[] }>('/insights/assistant/conversations').then(
      (r) => r.data,
    ),
    apiFetch<{ data: CatalogueEntryView[] }>('/insights/assistant/catalogue').then((r) => r.data),
    apiFetch<AssistantStartView>('/insights/assistant/start').catch(() => null),
  ]);
  const lang = locale === 'hi' ? 'hi' : 'en';
  const current = sp.c
    ? await apiFetch<AssistantConversation>(`/insights/assistant/conversations/${sp.c}`).catch(
        () => null,
      )
    : null;
  const words = assistantWords(start?.audience === 'teacher' ? 'teacher' : 'admin', lang);
  const allowed = catalogue.filter((e) => e.allowed);
  const byDept = new Map<string, CatalogueEntryView[]>();
  for (const e of allowed) byDept.set(e.department, [...(byDept.get(e.department) ?? []), e]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={words.title}
        description={words.intro}
        actions={
          <>
            {me.permissions.includes('insights.assistant.audit') ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/insights/assistant/setup">
                Assistant set-up
              </a>
            ) : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/insights/assistant">
              {s('newConversation')}
            </a>
          </>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(16rem, 1fr)',
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <AssistantChat
            lang={lang}
            start={start}
            conversationId={current?.id ?? null}
            messages={(current?.messages ?? []) as AssistantMessageView[]}
            action={askAssistant}
            newHref="/insights/assistant"
            error={sp.error ? { type: sp.error, detail: sp.detail } : null}
          />
          <details className="ep-card" style={{ marginTop: 'var(--sp-4)' }}>
            <summary>
              <strong>{s('catalogue')}</strong>{' '}
              <span className="ep-field__help">
                · {allowed.length} · {byDept.size}{' '}
                {lang === 'hi' ? 'विभाग' : byDept.size === 1 ? 'department' : 'departments'}
              </span>
            </summary>
            {[...byDept.entries()].map(([dept, entries]) => (
              <div key={dept} style={{ marginTop: 'var(--sp-3)' }}>
                <div className="ep-kicker">
                  {dept === 'exams' || dept === 'school' ? dept : i(`departmentNames.${dept}`)}
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                  {entries.map((e) => (
                    <li key={e.id}>
                      <strong>{lang === 'hi' ? e.titleHi : e.title}</strong>{' '}
                      {lang === 'hi' ? null : <small>({e.titleHi})</small>} —{' '}
                      <small>{e.description}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {catalogue.length > allowed.length ? (
              <p className="ep-field__help">
                {catalogue.length - allowed.length} × {s('notAllowed')}
              </p>
            ) : null}
          </details>
        </div>
        <Card title={s('conversations')}>
          {conversations.length === 0 ? (
            <p className="ep-field__help">{s('noConversations')}</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {conversations.map((c) => (
                <li key={c.id} style={{ marginBottom: 'var(--sp-2)' }}>
                  <a href={`/insights/assistant?c=${c.id}`}>{c.title ?? c.id}</a>
                  <br />
                  <small>
                    {new Date(c.updatedAt).toLocaleString('en-IN')} · {c.turns} · {c.language}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
