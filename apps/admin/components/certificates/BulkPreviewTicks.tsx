'use client';
import { useState } from 'react';
import type { BulkPreview } from '@/lib/certificates';

type Row = BulkPreview['rows'][number];

/**
 * The bulk preview with a tick each (16 Nov 2026): everyone clear is ticked; untick anyone who should not get one. One
 * who already holds it cannot be ticked; one whose checks are not clear stays unticked unless the principal (the
 * override right) ticks them and gives the reason. Only the ticked are issued.
 */
export function BulkPreviewTicks({
  rows,
  canOverride,
  staff,
  max,
  action,
  hidden,
}: {
  rows: Row[];
  canOverride: boolean;
  staff: boolean;
  max: number;
  action: (fd: FormData) => void | Promise<void>;
  hidden: Array<[string, string]>;
}) {
  const [ticked, setTicked] = useState(() => new Set(rows.filter((r) => r.ok).map((r) => r.id)));
  const failing = rows.filter((r) => !r.ok && !r.held);
  const tickedFailing = failing.filter((r) => ticked.has(r.id)).length;
  const set = (ids: string[], on: boolean) =>
    setTicked((cur) => {
      const n = new Set(cur);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const why = (r: Row) =>
    [...r.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`), ...r.problems].join(
      '; ',
    );
  return (
    <form action={action} className="ep-bulk__issue">
      {hidden.map(([k, v], i) => (
        <input key={`${k}-${String(i)}`} type="hidden" name={k} value={v} />
      ))}
      <div className="ep-ctype__actions">
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() =>
            set(
              rows.filter((r) => r.ok).map((r) => r.id),
              true,
            )
          }
        >
          Tick all clear
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => setTicked(new Set())}
        >
          Untick all
        </button>
      </div>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={staff ? 'Employees to issue to' : 'Students to issue to'}
      >
        <table className="ep-table" data-density="dense">
          <caption className="ep-sr-only">
            {staff ? 'Employees' : 'Students'} who would get it; untick to leave one out
          </caption>
          <thead>
            <tr>
              <th scope="col">Tick</th>
              <th scope="col">{staff ? 'Department' : 'Class – section'}</th>
              <th scope="col">{staff ? 'Emp. ID' : 'Roll'}</th>
              <th scope="col">{staff ? 'Employee' : 'Student'}</th>
              <th scope="col">Checks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const blocked = r.held || (!r.ok && !canOverride);
              return (
                <tr key={r.id}>
                  <td>
                    <label className="ep-check" htmlFor={`bkOnly_${r.id}`}>
                      <input
                        id={`bkOnly_${r.id}`}
                        type="checkbox"
                        name="only"
                        value={r.id}
                        className="ep-check__input"
                        checked={ticked.has(r.id)}
                        disabled={blocked}
                        onChange={(e) => set([r.id], e.target.checked)}
                      />
                      <span className="ep-check__box" />
                      <span className="ep-sr-only">
                        {ticked.has(r.id) ? 'Issue to ' : 'Leave out '}
                        {r.name}
                      </span>
                    </label>
                  </td>
                  <td>{r.classLabel ?? ''}</td>
                  <td>{staff ? r.admissionNo : (r.rollNo ?? '')}</td>
                  <td>
                    {r.name}
                    {staff ? '' : ` · ${r.admissionNo}`}
                  </td>
                  <td>
                    {r.ok ? (
                      <span className="ep-badge ep-badge--success">Clear</span>
                    ) : (
                      <>
                        <span className={`ep-badge ep-badge--${r.held ? 'neutral' : 'danger'}`}>
                          {r.held ? 'Holds it' : 'Not clear'}
                        </span>{' '}
                        <span className="ep-field__help" style={{ margin: 0 }}>
                          {why(r)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {failing.length && !canOverride ? (
        <p className="ep-field__help">
          {String(failing.length)} whose checks are not clear can be ticked only by the principal
          (with a reason).
        </p>
      ) : null}
      {tickedFailing ? (
        <label className="ep-field" htmlFor="bkOverride">
          <span className="ep-field__label">
            The principal&apos;s reason to issue to the {String(tickedFailing)} ticked whose checks
            are not clear *
          </span>
          <textarea
            id="bkOverride"
            name="overrideReason"
            className="ep-input"
            rows={2}
            minLength={10}
            maxLength={300}
            required
          />
        </label>
      ) : null}
      <div className="ep-ctype__actions">
        <button
          type="submit"
          className="ep-btn ep-btn--primary"
          disabled={!ticked.size || ticked.size > max}
        >
          Issue to {String(ticked.size)} ticked
        </button>
        <span className="ep-field__help" style={{ margin: 0 }}>
          {ticked.size > max
            ? `At most ${String(max)} at a time`
            : `A batch and one PDF for each ${staff ? 'department' : 'section'}; each certificate gets its own number.`}
        </span>
      </div>
    </form>
  );
}
