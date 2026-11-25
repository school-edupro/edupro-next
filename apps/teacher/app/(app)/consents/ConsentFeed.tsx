'use client';
import { Badge } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadConsents } from '@/lib/feed-actions';

export interface ConsentForm {
  id: string;
  title: string;
  description: string | null;
  open: boolean;
  closesAt: string | null;
  people: Array<{
    kind: 'student' | 'staff';
    id: string;
    canAnswer: boolean;
    responses: Array<{
      id: string;
      number: string;
      status: string;
      waiting: boolean;
      canEdit: boolean;
      decidedNote: string | null;
    }>;
  }>;
}

const dt = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}`;

/** The forms and declarations asked of me, the latest 10 first; 10 more load as I scroll down. */
export function ConsentFeed({
  first,
  more: firstMore,
  foot,
}: {
  first: ConsentForm[];
  more: boolean;
  foot: { more: string; loading: string; failed: string; end: string };
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
    void loadConsents(page + 1).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as ConsentForm[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items]);
  const forms = items
    .map((f) => ({ ...f, me: f.people.find((p) => p.kind === 'staff') }))
    .filter((f) => f.me);
  return (
    <>
      <div className="ep-cf-list">
        {forms.map((f) => (
          <article key={f.id} className="ep-cf-item">
            <div className="ep-cf-item__top">
              <h2 className="ep-cf-item__title">{f.title}</h2>
              {f.me!.canAnswer ? (
                <Badge tone="warning">
                  {f.closesAt ? `To answer by ${dt(f.closesAt)}` : 'To answer'}
                </Badge>
              ) : f.me!.responses.length ? (
                <Badge tone="success">Answered</Badge>
              ) : (
                <Badge tone="neutral">Closed</Badge>
              )}
            </div>
            {f.description ? (
              <p className="ep-field__help" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {f.description.length > 220 ? `${f.description.slice(0, 220)}…` : f.description}
              </p>
            ) : null}
            <div className="ep-cf-item__who">
              <span>
                {f.me!.responses.map((r) => (
                  <span
                    key={r.id}
                    style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                  >
                    {r.number}
                    <span className="ep-field__help">
                      {r.waiting
                        ? 'waiting for approval'
                        : r.status === 'approved'
                          ? 'approved'
                          : r.status === 'rejected'
                            ? `not approved${r.decidedNote ? `: ${r.decidedNote}` : ''}`
                            : ''}
                    </span>
                    {r.canEdit ? (
                      <a
                        href={`/consents/${f.id}?response=${r.id}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        Change
                      </a>
                    ) : null}
                    <FileLinks
                      url={`/consents/pdf/${r.id}`}
                      saveUrl={`/consents/pdf/${r.id}?save=1`}
                      label={`${f.title} ${r.number}`}
                    />
                  </span>
                ))}
              </span>
              {f.me!.canAnswer ? (
                <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/consents/${f.id}`}>
                  {f.me!.responses.length ? 'Answer again' : 'Answer'}
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {items.length ? (
        <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
      ) : null}
    </>
  );
}
