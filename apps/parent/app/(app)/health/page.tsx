import { Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { MoreFeed } from '@/components/MoreFeed';
import { healthPage } from '@/lib/feed-actions';
import { currentLang, t } from '@/lib/i18n';
import { HealthItems, type HealthItem } from './HealthItems';

interface List {
  data: HealthItem[];
  page: { number: number; size: number; total: number };
  students: Array<{ id: string; name: string }>;
}
const PAGE_SIZE = 10;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Health (0075): the children's clinic visits and health check-up cards in one list, latest first, with
 * filters (child, type, dates, search) and pages, like the Queries page. Each entry opens in full.
 */
export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{
    child?: string;
    kind?: string;
    q?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  // the child comes from the switch under the title, the same on every page
  const kid = await chosenChild(sp.child);
  const filters = Object.fromEntries(
    Object.entries({
      kind: ['visit', 'card'].includes(sp.kind ?? '') ? sp.kind : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const filtered = Object.keys(filters).length > 0;
  // the list's filters and the child, as the next pages ask for them too
  const query: Record<string, string> = { ...filters, ...(kid ? { studentId: kid.id } : {}) };
  let list: List;
  try {
    list = await bff.api.fetch<List>(
      `/clinic/mine/list?${new URLSearchParams({ ...query, size: String(PAGE_SIZE), page: '1' }).toString()}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Health')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const total = list.page.total;
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Health')}
        title={t(lang, 'Clinic visits and health cards')}
        description={`${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <ChildSwitch lang={lang} back="/health" current={kid?.id} />
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
        >
          <SelectField
            id="h-kind"
            name="kind"
            label={t(lang, 'Type')}
            defaultValue={filters.kind ?? ''}
            options={[
              { value: '', label: t(lang, 'All') },
              { value: 'visit', label: t(lang, 'Clinic visits') },
              { value: 'card', label: t(lang, 'Health check-up cards') },
            ]}
          />
          <label className="ep-field" htmlFor="h-from">
            <span className="ep-field__label">{t(lang, 'From')}</span>
            <input
              id="h-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="h-to">
            <span className="ep-field__label">{t(lang, 'To')}</span>
            <input
              id="h-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <InputField
            id="h-q"
            name="q"
            type="search"
            label={t(lang, 'Complaint, treatment or remark')}
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit" variant="secondary">
            {t(lang, 'Show')}
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost" href="/health">
              {t(lang, 'Clear')}
            </a>
          ) : null}
        </form>
      </Card>
      {list.data.length === 0 ? (
        <Card>
          {filtered
            ? t(lang, 'Nothing matches these filters.')
            : t(
                lang,
                'Nothing yet. Clinic visits show here, and the health card once the school doctor publishes it.',
              )}
        </Card>
      ) : null}
      {list.data.length ? (
        <MoreFeed
          key={JSON.stringify(query)}
          first={<HealthItems items={list.data} lang={lang} />}
          more={PAGE_SIZE < total}
          load={healthPage.bind(null, query)}
          labels={foot}
        />
      ) : null}
    </main>
  );
}
