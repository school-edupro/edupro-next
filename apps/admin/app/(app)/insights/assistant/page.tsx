import { Badge, Button, Card, FormActions, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { askAssistant } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { AssistantConversation, CatalogueEntryView } from '@/lib/types';

/** Sprint 14 (AI track): the staff assistant over the query catalogue, with history and citations. */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const [t, s, i, conversations, catalogue] = await Promise.all([
    getTranslations('pages.insights_assistant'),
    getTranslations('assistant'),
    getTranslations('insights'),
    apiFetch<{ data: AssistantConversation[] }>('/insights/assistant/conversations').then(
      (r) => r.data,
    ),
    apiFetch<{ data: CatalogueEntryView[] }>('/insights/assistant/catalogue').then((r) => r.data),
  ]);
  const current = sp.c
    ? await apiFetch<AssistantConversation>(`/insights/assistant/conversations/${sp.c}`).catch(
        () => null,
      )
    : null;
  const allowed = catalogue.filter((e) => e.allowed);
  const byDept = new Map<string, CatalogueEntryView[]>();
  for (const e of allowed) byDept.set(e.department, [...(byDept.get(e.department) ?? []), e]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/insights/assistant">
            {s('newConversation')}
          </a>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)',
        }}
      >
        <div>
          <Card title={current?.title ?? s('assistantName')}>
            <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
              {(current?.messages ?? []).map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: 'var(--sp-3)',
                    borderRadius: 'var(--radius-2)',
                    background: m.role === 'user' ? 'var(--surface-2)' : 'var(--surface-1)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="ep-kicker">
                    {m.role === 'user' ? s('you') : s('assistantName')}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  {m.role === 'assistant' && m.citations.length ? (
                    <div
                      style={{
                        marginTop: 'var(--sp-2)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--sp-1)',
                      }}
                    >
                      <small>{s('sources')}:</small>
                      {m.citations.map((c, k) => (
                        <Badge key={`${c.query}-${k}`} tone="info">
                          {c.title} · {c.rows} {s('rows')}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {m.refused ? <p className="ep-field__help">{s('refused')}</p> : null}
                </div>
              ))}
            </div>
            <form action={askAssistant}>
              {current ? <input type="hidden" name="conversationId" value={current.id} /> : null}
              <label className="ep-field">
                <span className="ep-field__label">{s('question')}</span>
                <textarea
                  className="ep-input"
                  name="question"
                  rows={3}
                  required
                  minLength={2}
                  maxLength={1000}
                  placeholder={s('placeholder')}
                />
              </label>
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <SelectField
                  id="language"
                  name="language"
                  label={s('language')}
                  options={[
                    { value: 'auto', label: s('auto') },
                    { value: 'en', label: s('english') },
                    { value: 'hi', label: s('hindi') },
                  ]}
                />
                <FormActions>
                  <Button type="submit">{s('ask')}</Button>
                </FormActions>
              </div>
            </form>
            {current ? (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
                {s('usage')}: {current.tokens} · {s('cost')}: {(current.costPaise / 100).toFixed(2)}
              </p>
            ) : null}
          </Card>
          <Card title={s('catalogue')} style={{ marginTop: 'var(--sp-4)' }}>
            {[...byDept.entries()].map(([dept, entries]) => (
              <div key={dept} style={{ marginBottom: 'var(--sp-3)' }}>
                <div className="ep-kicker">
                  {dept === 'exams' || dept === 'school' ? dept : i(`departmentNames.${dept}`)}
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                  {entries.map((e) => (
                    <li key={e.id}>
                      <strong>{e.title}</strong> <small>({e.titleHi})</small> —{' '}
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
          </Card>
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
