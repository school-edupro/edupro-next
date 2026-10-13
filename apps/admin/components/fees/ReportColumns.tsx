'use client';

import { useState } from 'react';

export interface ChoiceColumn {
  key: string;
  label: string;
  group?: string;
  fixed: boolean;
  hidden: boolean;
}

/**
 * The columns of a report, to tick: what is unticked leaves the screen, the Excel and the PDF together.
 * The choice is kept for the user; the fee admin can make it the school's default for everyone who has
 * not chosen their own. Totals are never changed by it.
 */
export function ReportColumns({
  report,
  back,
  columns,
  source,
  canSetSchool,
  saveMine,
  saveSchool,
  reset,
}: {
  report: string;
  /** Where to return to: the report with its filters. */
  back: string;
  columns: ChoiceColumn[];
  source: 'user' | 'school' | 'all';
  canSetSchool: boolean;
  /** One action per button: a button's own name and value do not reach a server action reliably. */
  saveMine: (fd: FormData) => Promise<void>;
  saveSchool: (fd: FormData) => Promise<void>;
  reset: (fd: FormData) => Promise<void>;
}) {
  const free = columns.filter((c) => !c.fixed);
  const [shown, setShown] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(free.map((c) => [c.key, !c.hidden])),
  );
  const groups = [...new Set(free.map((c) => c.group ?? ''))];
  const hidden = free.filter((c) => !shown[c.key]).map((c) => c.key);
  const set = (keys: string[], on: boolean) =>
    setShown((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, on])) }));
  return (
    <details className="ep-noprint">
      <summary className="ep-btn ep-btn--secondary ep-btn--sm">
        Columns ({free.length - hidden.length} of {free.length})
      </summary>
      <form
        action={saveMine}
        style={{
          marginTop: 'var(--sp-3)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--sp-4)',
          display: 'grid',
          gap: 'var(--sp-3)',
          background: 'var(--surface-subtle)',
        }}
      >
        <input type="hidden" name="report" value={report} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="hidden" value={JSON.stringify(hidden)} />
        <p className="ep-field__help" style={{ margin: 0 }}>
          Untick a column to leave it out of the screen, the Excel and the PDF. Totals are not
          changed: they still include what is left out.{' '}
          {source === 'user'
            ? 'You are seeing your own choice.'
            : source === 'school'
              ? 'You are seeing the school default.'
              : 'Every column is shown.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() =>
              set(
                free.map((c) => c.key),
                true,
              )
            }
          >
            Tick all
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() =>
              set(
                free.map((c) => c.key),
                false,
              )
            }
          >
            Untick all
          </button>
        </div>
        {groups.map((g) => {
          const list = free.filter((c) => (c.group ?? '') === g);
          const all = list.every((c) => shown[c.key]);
          return (
            <fieldset
              key={g || 'plain'}
              style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--sp-2)' }}
            >
              <legend className="ep-kicker" style={{ padding: 0 }}>
                {g || 'Columns'}
                {g ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    style={{ marginLeft: 'var(--sp-2)' }}
                    onClick={() =>
                      set(
                        list.map((c) => c.key),
                        !all,
                      )
                    }
                  >
                    {all ? 'Untick the group' : 'Tick the group'}
                  </button>
                ) : null}
              </legend>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-1) var(--sp-4)',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 13rem), 1fr))',
                }}
              >
                {list.map((c) => (
                  <label
                    key={c.key}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(shown[c.key])}
                      onChange={(e) => set([c.key], e.target.checked)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        <p className="ep-field__help" style={{ margin: 0 }}>
          Always shown:{' '}
          {columns
            .filter((c) => c.fixed)
            .map((c) => c.label)
            .join(', ')}
          .
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
            Save for me
          </button>
          {canSetSchool ? (
            <button
              type="submit"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              formAction={saveSchool}
            >
              Save as the school default
            </button>
          ) : null}
          {source === 'user' ? (
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm" formAction={reset}>
              Back to the school default
            </button>
          ) : null}
        </div>
      </form>
    </details>
  );
}
