import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { chosenChild } from '@/lib/child';
import { currentLang, t } from '@/lib/i18n';
import { dayParts, excerpt, type Notice } from './shared';

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
  let notices: Notice[];
  try {
    const query = new URLSearchParams({ size: '200' });
    if (kind) query.set('kind', kind);
    if (q) query.set('q', q);
    notices = await bff.api
      .fetch<{ data: Notice[] }>(`/academics/notices?${query.toString()}`)
      .then((r) => r.data);
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
  const list = notices.filter(
    (n) => (!from || n.publishFrom >= from) && (!to || n.publishFrom <= to),
  );
  const toAck = kid
    ? list.filter((n) => n.ackRequired && !(n.ackedFor ?? []).includes(kid.id)).length
    : 0;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Notices')}
        title={t(lang, 'Notices and circulars')}
        description={`${String(list.length)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}${toAck ? ` · ${String(toAck)} ${t(lang, 'to acknowledge')}` : ''}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
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
      {list.map((n) => {
        const d = dayParts(n.publishFrom);
        const pending = Boolean(n.ackRequired && kid && !(n.ackedFor ?? []).includes(kid.id));
        return (
          <Card key={n.id} elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-apt">
              <div className="ep-apt__date">
                <span className="ep-apt__day">{d.day}</span>
                <span className="ep-apt__month">{d.month}</span>
                <span className="ep-apt__time">{d.year}</span>
              </div>
              <div className="ep-apt__body">
                <div className="ep-apt__top">
                  <a className="ep-apt__title" href={`/notices/${n.id}`}>
                    {n.title}
                  </a>
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                    {n.isPinned ? <Badge tone="warning">{t(lang, 'Pinned')}</Badge> : null}
                    <Badge tone={n.kind === 'circular' ? 'info' : 'neutral'}>
                      {t(lang, n.kind)}
                    </Badge>
                    {pending ? <Badge tone="danger">{t(lang, 'Acknowledge')}</Badge> : null}
                  </span>
                </div>
                <div>{excerpt(n)}</div>
                <div className="ep-kicker">
                  {[
                    n.targets.length
                      ? n.targets
                          .slice(0, 3)
                          .map((x) => x.label)
                          .join(', ')
                      : null,
                    n.files.length ? `${String(n.files.length)} ${t(lang, 'Attachments')}` : null,
                    n.publishedBy ?? null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="ep-apt__actions">
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/notices/${n.id}`}
                    aria-label={`${t(lang, 'Details')}: ${n.title}`}
                  >
                    {t(lang, 'Details')}
                  </a>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </main>
  );
}
