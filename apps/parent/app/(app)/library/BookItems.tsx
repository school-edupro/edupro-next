import { Badge } from '@edupro/ui';
import { t, type Lang } from '@/lib/i18n';
import { reserveBook } from './actions';

export interface Title {
  titleId: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  subject: string | null;
  material: string | null;
  copies: number;
  onShelf: number;
  libraries: string | null;
  nextBack: string | null;
  queue: number;
  reference: boolean;
  canReserve: boolean;
}

const day = (lang: Lang, d: string | null) =>
  d
    ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(
        lang === 'hi' ? 'hi-IN' : 'en-IN',
        {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        },
      )
    : '—';

/** A page of Find a book: each title, on the shelf or out, and Reserve when every copy is out. */
export function BookItems({
  rows,
  lang,
  kid,
  holding,
  reserved,
  back,
}: {
  rows: Title[];
  lang: Lang;
  kid: { id: string; name: string };
  /** the titles the child has now, and those reserved */
  holding: string[];
  reserved: string[];
  /** where Reserve comes back to */
  back: string;
}) {
  return (
    <>
      {rows.map((b) => (
        <li key={b.titleId}>
          <span className="fp-books__what">
            <strong>{b.title}</strong>
            <span className="fp-books__note">
              {[b.author, b.subject, b.publisher, b.year ? String(b.year) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="fp-books__state">
            {b.onShelf > 0 ? (
              <Badge tone="success">
                {t(lang, 'On the shelf')}
                {b.libraries ? ` · ${b.libraries}` : ''}
              </Badge>
            ) : b.reference ? (
              <Badge tone="neutral">{t(lang, 'Read in the library only')}</Badge>
            ) : (
              <Badge tone="warning">
                {t(lang, 'All copies out')}
                {b.nextBack ? ` · ${t(lang, 'due back')} ${day(lang, b.nextBack)}` : ''}
              </Badge>
            )}
            {b.queue > 0 ? ` ${b.queue} ${t(lang, 'waiting')}` : ''}
          </span>
          {holding.includes(b.titleId) ? (
            <span className="fp-books__state">{t(lang, 'Your child has it')}</span>
          ) : reserved.includes(b.titleId) ? (
            <span className="fp-books__state">{t(lang, 'Reserved')}</span>
          ) : b.canReserve ? (
            <form action={reserveBook} style={{ display: 'inline' }}>
              <input type="hidden" name="borrowerId" value={kid.id} />
              <input type="hidden" name="titleId" value={b.titleId} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                {t(lang, 'Reserve')}
                <span className="ep-sr-only">
                  {' '}
                  {b.title} {t(lang, 'for')} {kid.name}
                </span>
              </button>
            </form>
          ) : null}
        </li>
      ))}
    </>
  );
}
