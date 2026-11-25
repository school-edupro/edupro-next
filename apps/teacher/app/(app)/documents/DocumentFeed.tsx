'use client';
import { Badge } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadDocuments } from '@/lib/feed-actions';

export interface ClassDoc {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  remark: string | null;
  section: string | null;
  subject: string | null;
  fileIds: string[];
  publishAt: string;
  scheduled: boolean;
  ackRequired: boolean;
  ackCount: number;
  postedBy: string | null;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The class documents for the filters, the latest 10 first; 10 more rows load as I scroll down. */
export function DocumentFeed({
  first,
  more: firstMore,
  filters,
  remove,
  foot,
}: {
  first: ClassDoc[];
  more: boolean;
  filters: Record<string, string>;
  /** the website's server action that removes one */
  remove: (fd: FormData) => void | Promise<void>;
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
    void loadDocuments(page + 1, filters).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as ClassDoc[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, filters]);
  return (
    <>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Class documents">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Class documents</caption>
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Title</th>
              <th scope="col">Class</th>
              <th scope="col">Files</th>
              <th scope="col">Published</th>
              <th scope="col">Acknowledged</th>
              <th scope="col">
                <span className="ep-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.kindLabel}</td>
                <th scope="row">
                  {d.title}
                  {d.remark ? (
                    <div
                      className="ep-richtext ep-field__help"
                      dangerouslySetInnerHTML={{ __html: d.remark }}
                    />
                  ) : null}
                </th>
                <td>{d.section ?? 'Whole school'}</td>
                <td>
                  {d.fileIds.map((f, i) => (
                    <FileLinks
                      key={f}
                      url={`/api/doc-file/document/${d.id}/${f}`}
                      saveUrl={`/api/doc-file/document/${d.id}/${f}?save=1`}
                      label={`attachment ${String(i + 1)} of ${d.title}`}
                    />
                  ))}
                </td>
                <td>
                  {when(d.publishAt)} {d.scheduled ? <Badge tone="warning">Scheduled</Badge> : null}
                </td>
                <td>
                  {d.ackRequired && d.section ? (
                    <a
                      href={`/acknowledgements?type=document&id=${d.id}`}
                      style={{ textDecoration: 'underline' }}
                      aria-label={`Who acknowledged ${d.title}`}
                    >
                      {d.ackCount} · view
                    </a>
                  ) : (
                    '–'
                  )}
                </td>
                <td>
                  {d.section ? (
                    <form action={remove}>
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Remove ${d.title}`}
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MoreOnScroll more={more} busy={busy} failed={failed} onMore={next} labels={foot} />
    </>
  );
}
