import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { MoreFeed } from '@/components/MoreFeed';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { documentsPage } from '@/lib/feed-actions';
import { currentLang, t } from '@/lib/i18n';
import { DocItems, type FamilyDoc } from './DocItems';

/** The first page: the latest 10; the rest load as the family scrolls. */
const PAGE = 10;

/**
 * Class documents for the family: the session plan, the curriculum and date sheets of the child's class,
 * and the school's magazine and almanac, in one list by date (the latest 10 first, 10 more as the family
 * scrolls), each with its kind. Each shows from the time the school published it.
 */
export default async function FamilyDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild();
  // the kind asked (any the API names) and the child: their section's papers and the school's
  const asked = /^[a-z_]{3,20}$/.test(sp.kind ?? '') ? sp.kind! : '';
  const filters: Record<string, string> = {};
  if (asked) filters.kind = asked;
  if (kid) filters.studentId = kid.id;
  let mine: FamilyDoc[] = [];
  let total = 0;
  let kinds: Array<{ value: string; label: string }> = [];
  try {
    const r = await bff.api.fetch<{
      data: FamilyDoc[];
      kinds: typeof kinds;
      page: { total: number };
    }>(
      `/academics/documents?${new URLSearchParams({ ...filters, page: '1', size: String(PAGE) }).toString()}`,
    );
    mine = r.data;
    total = r.page.total;
    kinds = r.kinds;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const kind = kinds.some((k) => k.value === asked) ? asked : '';
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Academics')}
        title={t(lang, 'Session plan, curriculum and date sheets')}
        description={t(lang, 'What the teachers and the school shared for this session.')}
      />
      <ChildSwitch lang={lang} back="/documents" />
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Kind')}
        style={{ marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}
      >
        <a href="/documents" aria-current={kind === '' ? 'page' : undefined}>
          {t(lang, 'All')}
        </a>
        {kinds.map((k) => (
          <a
            key={k.value}
            href={`/documents?kind=${k.value}`}
            aria-current={kind === k.value ? 'page' : undefined}
          >
            {t(lang, k.label)}
          </a>
        ))}
      </nav>
      {mine.length === 0 ? <Card>{t(lang, 'Nothing has been shared yet.')}</Card> : null}
      {mine.length ? (
        <Card>
          <MoreFeed
            key={JSON.stringify(filters)}
            first={<DocItems items={mine} lang={lang} kid={kid} />}
            more={PAGE < total}
            load={documentsPage.bind(null, filters)}
            labels={foot}
          />
        </Card>
      ) : null}
    </main>
  );
}
