import { Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { MoreFeed } from '@/components/MoreFeed';
import { noticesPage } from '@/lib/feed-actions';
import { currentLang, t } from '@/lib/i18n';
import { NoticeItems } from './NoticeItems';
import type { Notice } from './shared';

/** The first page: the latest 10; the rest load as the family scrolls. */
const PAGE = 10;

/**
 * Notices and circulars for the family, laid out like the Health screen: filters on top, then a card
 * for each with its date, kind and first lines; Details opens the whole notice with its attachments.
 */
export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; from?: string; to?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild();
  const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
  const kind = sp.kind === 'notice' || sp.kind === 'circular' ? sp.kind : '';
  const from = isDate(sp.from) ? sp.from : '';
  const to = isDate(sp.to) ? sp.to : '';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const filtered = Boolean(kind || from || to || q);
  // the filters and the child, as the next pages ask for them too: one child at a time (what is for that
  // child's class, section or the child), the type, the words and the dates
  const filters: Record<string, string> = {};
  if (kind) filters.kind = kind;
  if (q) filters.q = q;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (kid) filters.studentId = kid.id;
  let list: Notice[];
  let total = 0;
  let toAck = 0;
  try {
    const r = await bff.api.fetch<{
      data: Notice[];
      page: { total: number };
      toAck: number | null;
    }>(
      `/academics/notices?${new URLSearchParams({ ...filters, page: '1', size: String(PAGE) }).toString()}`,
    );
    list = r.data;
    total = r.page.total;
    toAck = r.toAck ?? 0;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Notices')} />
          <Card>{t(lang, 'Notices are not available for this account.')}</Card>
        </main>
      );
    throw error;
  }
  const foot = {
    more: t(lang, 'Show more'),
    loading: t(lang, 'Loading…'),
    failed: t(lang, 'Could not load more.'),
    end: t(lang, 'That is everything.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Notices')}
        title={t(lang, 'Notices and circulars')}
        description={`${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}${toAck ? ` · ${String(toAck)} ${t(lang, 'to acknowledge')}` : ''}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <ChildSwitch lang={lang} back="/notices" current={kid?.id} />
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
        >
          <SelectField
            id="n-kind"
            name="kind"
            label={t(lang, 'Type')}
            defaultValue={kind}
            options={[
              { value: '', label: t(lang, 'All') },
              { value: 'notice', label: t(lang, 'Notices') },
              { value: 'circular', label: t(lang, 'Circulars') },
            ]}
          />
          <label className="ep-field" htmlFor="n-from">
            <span className="ep-field__label">{t(lang, 'From')}</span>
            <input id="n-from" name="from" type="date" className="ep-input" defaultValue={from} />
          </label>
          <label className="ep-field" htmlFor="n-to">
            <span className="ep-field__label">{t(lang, 'To')}</span>
            <input id="n-to" name="to" type="date" className="ep-input" defaultValue={to} />
          </label>
          <InputField
            id="n-q"
            name="q"
            type="search"
            label={t(lang, 'Words in the notice')}
            defaultValue={q}
            maxLength={80}
          />
          <Button type="submit" variant="secondary">
            {t(lang, 'Show')}
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost" href="/notices">
              {t(lang, 'Clear')}
            </a>
          ) : null}
        </form>
      </Card>
      {list.length === 0 ? (
        <Card>
          {filtered ? t(lang, 'Nothing matches these filters.') : t(lang, 'No notices right now.')}
        </Card>
      ) : null}
      {list.length ? (
        <MoreFeed
          key={JSON.stringify(filters)}
          first={<NoticeItems items={list} lang={lang} kid={kid} />}
          more={PAGE < total}
          load={noticesPage.bind(null, filters)}
          labels={foot}
        />
      ) : null}
    </main>
  );
}
