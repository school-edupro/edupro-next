'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { verifyStockNumbers } from '@/lib/library-stock-actions';
import type { StockHit, StockVerifyResult } from '@/lib/library-stock';

type Line = { tone: 'success' | 'neutral' | 'warning' | 'danger'; text: string };

/** What a scan did, a line per number. */
function linesOf(r: StockVerifyResult): Line[] {
  const book = (x: StockHit) => `${x.accessionNo ?? x.no}${x.title ? ` · ${x.title}` : ''}`;
  return [
    ...r.verified.map((x) => ({
      tone: 'success' as const,
      text: `${book(x)}: verified${x.no.toUpperCase() !== (x.accessionNo ?? '').toUpperCase() ? ` (scanned as ${x.no})` : ''}`,
    })),
    ...r.issued.map((x) => ({
      tone: 'warning' as const,
      text: `${x.accessionNo ?? ''}: on the shelf but issued in the system: return it at the desk`,
    })),
    ...r.already.map((x) => ({ tone: 'neutral' as const, text: `${book(x)}: verified already` })),
    ...r.outside.map((x) => ({
      tone: 'warning' as const,
      text: `${book(x)}: not in this cycle (${[x.library, x.shelf ? `shelf ${x.shelf}` : null].filter(Boolean).join(', ')})`,
    })),
    ...r.unknown.map((x) => ({ tone: 'danger' as const, text: `${x.no}: no such book` })),
    ...r.repeated.map((x) => ({ tone: 'neutral' as const, text: `${x.no}: scanned twice` })),
  ];
}

/**
 * The scan box of an open stock cycle: a book number scanned (or typed) and Enter verifies it at once and
 * says what it was; several pasted together go in one go. The page's figures and lists follow shortly.
 */
export function StockScan({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const [no, setNo] = useState('');
  const [many, setMany] = useState('');
  const [paste, setPaste] = useState(false);
  const [feed, setFeed] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (later.current) clearTimeout(later.current);
    },
    [],
  );
  const send = (numbers: string[]) =>
    start(async () => {
      const r = await verifyStockNumbers(cycleId, numbers);
      if (!r.ok) return setError(r.error);
      setError(null);
      setFeed((f) => [...linesOf(r.data), ...f].slice(0, 40));
      // the figures and lists catch up once the scanning pauses
      if (later.current) clearTimeout(later.current);
      later.current = setTimeout(() => router.refresh(), 1500);
      setTimeout(() => box.current?.focus(), 0);
    });

  return (
    <section className="ep-card" aria-labelledby="st-scan-h">
      <h2 id="st-scan-h" className="ep-card__title">
        Scan the books
      </h2>
      {paste ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const list = many.split(/[\s,;]+/).filter(Boolean);
            send(list);
            setMany('');
          }}
        >
          <label className="ep-field" htmlFor="st-many">
            <span className="ep-field__label">Book numbers (one a line, or with commas)</span>
            <textarea
              id="st-many"
              className="ep-input"
              rows={5}
              value={many}
              onChange={(e) => setMany(e.target.value)}
            />
          </label>
          <div className="ep-desk__actions">
            <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
              {pending ? 'Verifying…' : 'Verify them'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              onClick={() => setPaste(false)}
            >
              One at a time
            </button>
          </div>
        </form>
      ) : (
        <form
          className="ep-desk__scan"
          onSubmit={(e) => {
            e.preventDefault();
            if (no.trim()) send([no]);
            setNo('');
          }}
        >
          <label className="ep-field" htmlFor="st-no">
            <span className="ep-field__label">Book no. or barcode (scan, or type and Enter)</span>
            <input
              id="st-no"
              ref={box}
              className="ep-input"
              value={no}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setNo(e.target.value)}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
            Verify
          </button>
          <button type="button" className="ep-btn ep-btn--secondary" onClick={() => setPaste(true)}>
            Paste several
          </button>
        </form>
      )}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ marginTop: 'var(--sp-2)' }}>
          {error}
        </p>
      ) : null}
      {feed.length ? (
        <ol className="ep-stock-feed" aria-live="polite" aria-label="What the scans did">
          {feed.map((l, i) => (
            <li key={`${String(i)}-${l.text}`} className={`ep-stock-feed__${l.tone}`}>
              {l.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          Each book is verified as it is scanned; a number from another shelf or library, or one the
          library does not have, is noted for you to follow up.
        </p>
      )}
    </section>
  );
}
