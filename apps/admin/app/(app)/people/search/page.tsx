import { Badge, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { SearchHit } from '@/lib/types';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const [t, p] = await Promise.all([getTranslations('people.search'), getTranslations('people')]);
  const q = (sp.q ?? '').trim();
  const hits =
    q.length >= 2
      ? (
          await apiFetch<{ data: SearchHit[] }>(
            `/people/search?q=${encodeURIComponent(q)}&limit=50`,
          )
        ).data
      : [];
  const href = (h: SearchHit) =>
    h.kind === 'student'
      ? `/people/students/${h.id}`
      : h.kind === 'employee'
        ? `/people/employees/${h.id}`
        : `/people/students?q=${encodeURIComponent(h.displayName)}`;
  return (
    <>
      <PageHeader kicker={p('kicker')} title={t('title')} description={t('description')} />
      <div className="ep-filter-band">
        <form method="get" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <InputField
            id="q"
            name="q"
            label={t('query')}
            defaultValue={q}
            minLength={2}
            required
            autoFocus
          />
          <Button type="submit">{t('title')}</Button>
        </form>
      </div>
      {q.length >= 2 ? (
        <Card title={t('results', { count: hits.length })}>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 'var(--sp-2)',
            }}
          >
            {hits.map((h) => (
              <li
                key={`${h.kind}-${h.id}`}
                style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}
              >
                <Badge
                  tone={
                    h.kind === 'student' ? 'info' : h.kind === 'employee' ? 'success' : 'neutral'
                  }
                >
                  {t(`kinds.${h.kind}`)}
                </Badge>
                <a href={href(h)} style={{ fontWeight: 'var(--fw-semibold)' }}>
                  {h.displayName}
                </a>
                <span className="ep-field__help">{h.subtitle}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
