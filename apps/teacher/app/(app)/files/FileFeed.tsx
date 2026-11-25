'use client';
import { Badge } from '@edupro/ui';
import { useCallback, useState } from 'react';
import { MoreOnScroll } from '@/components/MoreOnScroll';
import { loadFiles } from '@/lib/feed-actions';
import { FILE_TONE, fileWhen, type FileNote } from '@/lib/file-movement';

/** The table's words, in the person's language (made on the server). */
export interface FileWords {
  region: string;
  caption: string;
  head: string[];
  round: string;
  /** a status's label as the API names it → in the person's language */
  status: Record<string, string>;
}

/** The files of a box, the latest 10 first; 10 more rows load as I scroll down. */
export function FileFeed({
  first,
  more: firstMore,
  filters,
  words,
  foot,
}: {
  first: FileNote[];
  more: boolean;
  filters: Record<string, string>;
  words: FileWords;
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
    void loadFiles(page + 1, filters).then((r) => {
      setBusy(false);
      if (!r.ok) return setFailed(true);
      const seen = new Set(items.map((x) => x.id));
      setItems([...items, ...(r.data as FileNote[]).filter((x) => !seen.has(x.id))]);
      setPage(page + 1);
      setMore(r.more);
    });
  }, [busy, more, page, items, filters]);
  return (
    <>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={words.region}>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">{words.caption}</caption>
          <thead>
            <tr>
              {words.head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((n, i) => (
              <tr key={n.id}>
                <td>{i + 1}</td>
                <th scope="row">
                  <a href={`/files/${n.id}`} style={{ textDecoration: 'underline' }}>
                    {n.number}
                  </a>
                </th>
                <td>
                  {n.subject}
                  {n.round > 1 ? (
                    <div className="ep-field__help">
                      {words.round} {n.round}
                    </div>
                  ) : null}
                </td>
                <td>
                  {n.createdBy}
                  <div className="ep-field__help">{n.designation}</div>
                </td>
                <td>{fileWhen(n.createdAt)}</td>
                <td>
                  {n.approvedLevels} / {n.levels}
                </td>
                <td>{n.waitingOn ?? (n.status === 'returned' ? n.createdBy : '–')}</td>
                <td>
                  <Badge tone={FILE_TONE[n.status] ?? 'neutral'}>
                    {words.status[n.statusLabel] ?? n.statusLabel}
                  </Badge>
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
