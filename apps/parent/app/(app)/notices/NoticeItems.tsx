import { Badge, Card } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';
import { dayParts, excerpt, type Notice } from './shared';

/** A page of the child's notices: a card for each with its date, tags, first lines, for whom and Details. */
export function NoticeItems({
  items,
  lang,
  kid,
}: {
  items: Notice[];
  lang: Lang;
  /** the child (what is still to acknowledge for them is marked) */
  kid: { id: string } | null;
}) {
  const list = items;
  return (
    <>
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
    </>
  );
}
