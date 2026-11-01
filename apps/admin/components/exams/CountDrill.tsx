'use client';
import { Dialog } from '@edupro/ui';
import { useState } from 'react';

/**
 * A report's count that opens its students (docs/design/68): the arrow and the number (or "1 pending")
 * as a link; the window lists them — name, admission no, the marks as obtained / maximum and the %.
 */
export function CountDrill({
  label,
  drill,
}: {
  label: string;
  drill: { title: string; cols: string[]; rows: string[][] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ep-mr-drill"
        onClick={() => setOpen(true)}
        aria-label={`${drill.title}: ${label}`}
      >
        <span aria-hidden="true">▶</span> {label}
      </button>
      <Dialog
        open={open}
        title={drill.title}
        onClose={() => setOpen(false)}
        secondaryLabel="Close"
        size="md"
      >
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense ep-mr-drill__table">
            <caption className="ep-sr-only">{drill.title}</caption>
            <thead>
              <tr>
                {drill.cols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drill.rows.map((r, n) => (
                <tr key={String(n)}>
                  {r.map((v, k) => {
                    const m = drill.cols[k] === 'Marks' ? /^(.+) \/ (.+)$/.exec(v) : null;
                    return (
                      <td key={String(k)} data-col={drill.cols[k]}>
                        {m ? (
                          <>
                            <strong>{m[1]}</strong> <span className="ep-mr-muted">/ {m[2]}</span>
                          </>
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  );
}
