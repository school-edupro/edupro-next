'use client';
import { Badge, Button, Card } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadGatePasses } from '@/lib/feed-actions';
import { PASS_TONE, passBackBy, passTime, passWho, type Pass } from '@/lib/gate-pass';

type Act = (fd: FormData) => void | Promise<void>;

/** The cards' words, in the person's language (made on the server). */
export interface PassWords {
  kind: Record<Pass['kind'], string>;
  adm: string;
  backBy: string;
  with: string;
  items: string;
  details: string;
  note: string;
  approve: string;
  reject: string;
  waitingOn: string;
  gateOut: string;
  gateIn: string;
  pdf: string;
  cancel: string;
}

/**
 * Gate passes a page at a time: `inbox` (waiting on me, the soonest first; approve or reject with a note) or `mine`
 * (my own, the latest first; details, the pass card, cancel). The first 10 come with the page; 10 more as I scroll.
 */
export function GatePassFeed({
  box,
  first,
  more: firstMore,
  words,
  foot,
  actions,
}: {
  box: 'inbox' | 'mine';
  first: Pass[];
  more: boolean;
  words: PassWords;
  foot: { more: string; loading: string; failed: string; end: string };
  /** the website's server actions for the cards */
  actions: { decide: Act; approve: Act; reject: Act; cancel: Act };
}) {
  const [items, setItems] = useState(first);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(firstMore);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const next = useCallback(() => {
    if (busy || !more) return;
    setBusy(true);
    setFailed(false);
    void loadGatePasses(page + 1, box).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as Pass[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, box]);
  return (
    <>
      {items.map((p) =>
        box === 'inbox' ? (
          <Card
            key={p.id}
            title={passWho(p, words.adm)}
            actions={<Badge tone="warning">{words.kind[p.kind]}</Badge>}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <p style={{ marginTop: 0 }}>
              {p.onDate}
              {p.atTime ? `, ${p.atTime}` : ''}
              {p.returnBy ? ` · ${words.backBy} ${passBackBy(p)}` : ''} · {p.reason}
            </p>
            <p className="ep-field__help">
              {[
                p.escortName
                  ? `${words.with} ${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}`
                  : null,
                p.destination,
                p.items ? `${String(p.items)} ${words.items}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p style={{ margin: '0 0 var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/gate-passes/${p.id}`}
                aria-label={`${words.details}: ${p.number}`}
              >
                {words.details}
              </a>
            </p>
            <form action={actions.decide} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <input type="hidden" name="id" value={p.id} />
              <label className="ep-field" htmlFor={`n-${p.id}`}>
                <span className="ep-field__label">{words.note}</span>
                <input id={`n-${p.id}`} name="note" className="ep-input" maxLength={300} />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Button type="submit" formAction={actions.approve} size="sm">
                  {words.approve}
                </Button>
                <Button type="submit" formAction={actions.reject} size="sm" variant="secondary">
                  {words.reject}
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card
            key={p.id}
            title={`${p.number} · ${words.kind[p.kind]}`}
            actions={
              <Badge tone={PASS_TONE[p.state] ?? 'neutral'}>{p.stageLabel ?? p.stage}</Badge>
            }
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <p style={{ marginTop: 0 }}>
              {p.onDate}
              {p.atTime ? `, ${p.atTime}` : ''}
              {p.returnBy ? ` · ${words.backBy} ${passBackBy(p)}` : ''} · {p.reason}
            </p>
            <p className="ep-field__help">
              {[
                p.destination,
                p.items ? `${String(p.items)} ${words.items}` : null,
                p.state === 'pending' && p.waitingOn ? `${words.waitingOn} ${p.waitingOn}` : null,
                p.outAt ? `${words.gateOut} ${passTime(p.outAt)}` : null,
                p.inAt ? `${words.gateIn} ${passTime(p.inAt)}` : null,
                p.decisionNote,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/gate-passes/${p.id}`}
                aria-label={`${words.details}: ${p.number}`}
              >
                {words.details}
              </a>
              {p.passNo ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/gate-pass-card/${p.id}`}
                  aria-label={`${words.pdf} ${p.number}`}
                >
                  {words.pdf}
                </a>
              ) : null}
              {['pending', 'approved'].includes(p.state) ? (
                <form action={actions.cancel}>
                  <input type="hidden" name="id" value={p.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    aria-label={`${words.cancel} ${p.number}`}
                  >
                    {words.cancel}
                  </Button>
                </form>
              ) : null}
            </div>
          </Card>
        ),
      )}
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
