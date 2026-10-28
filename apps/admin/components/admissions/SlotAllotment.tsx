'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import type { SlotDetail } from '@/lib/admission-process';
import { allotSlot, notifySlot, unallotSlot } from '@/lib/admission-process-actions';
import { useSlotFilter } from '@/components/admissions/SlotFilter';

const DECIDED: Record<string, [string, 'success' | 'warning' | 'danger' | 'info']> = {
  approved: ['Passed', 'success'],
  hold: ['On hold', 'warning'],
  rejected: ['Not selected', 'danger'],
  offered: ['Offered', 'success'],
  waitlisted: ['Waiting list', 'info'],
};

/**
 * A slot's allotment (docs/design/58, part 2): the next candidates waiting for the stage allotted up to
 * the room left, or one by one by name (the schedule mailed to the families when ticked), each
 * candidate's admit card, and a candidate not yet decided taken out of the slot. Candidates given the
 * slot automatically are not mailed: Mail the schedule sends it to those not yet told (docs/design/59).
 */
export function SlotAllotment({ slot, canAllot }: { slot: SlotDetail; canAllot: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  // on the slot page: only the candidates its search and filters show (docs/design/61)
  const filter = useSlotFilter();
  const room = slot.capacity - slot.candidates.length;
  const next = Math.min(room, slot.waiting);
  const unmailed = slot.candidates.filter((c) => !c.notified).length;
  const allot = (applicationIds?: string[]) =>
    start(async () => {
      const r = await allotSlot(slot.id, { notify, ...(applicationIds ? { applicationIds } : {}) });
      setMsg(r.ok ? { tone: 'success', text: 'Allotted.' } : { tone: 'danger', text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p style={{ margin: 0 }}>
        {slot.candidates.length} of {slot.capacity} seats allotted · {slot.waiting} waiting for{' '}
        {slot.stage} without a slot.
      </p>
      {canAllot ? (
        <div className="ep-rp__row">
          <label className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">Mail the schedule to the families</span>
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending || next <= 0}
            onClick={() => allot()}
          >
            Allot the next {next}
          </button>
          {unmailed ? (
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await notifySlot(slot.id);
                  setMsg(
                    r.ok
                      ? {
                          tone: 'success',
                          text: `Schedule mailed to ${String(r.data.mailed)} ${r.data.mailed === 1 ? 'family' : 'families'} (the messages go out with the workers).`,
                        }
                      : { tone: 'danger', text: r.error },
                  );
                  if (r.ok) router.refresh();
                })
              }
            >
              Mail the schedule ({unmailed})
            </button>
          ) : null}
        </div>
      ) : null}
      {slot.waitingList.length ? (
        <div>
          <h3 className="ep-card__title" style={{ fontSize: 'var(--fs-h5)' }}>
            Waiting for {slot.stage} without a slot ({slot.waiting})
          </h3>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            New candidates take the earliest slot with room by themselves; these are still without
            one.
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 0,
              listStyle: 'none',
              display: 'grid',
              gap: 'var(--sp-1)',
            }}
          >
            {slot.waitingList.map((w) => {
              const who = w.candidate ?? w.number ?? 'the candidate';
              return (
                <li
                  key={w.applicationId}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <a href={`/admissions/registrations/${w.applicationId}`}>{who}</a>
                  <span className="ep-field__help" style={{ margin: 0 }}>
                    {w.number} · {w.className}
                  </span>
                  {canAllot ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      disabled={pending || room <= 0}
                      onClick={() => allot([w.applicationId])}
                    >
                      Allot<span className="ep-sr-only"> {who}</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canAllot && room <= 0 ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              This slot is full: raise its capacity in Slot details, or make another slot.
            </p>
          ) : null}
        </div>
      ) : null}
      {slot.candidates.length ? (
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Candidates of the slot (scrolls sideways)"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Candidates allotted</caption>
            <thead>
              <tr>
                <th scope="col">Roll no.</th>
                <th scope="col">Candidate</th>
                <th scope="col">Class</th>
                <th scope="col">Stands</th>
                <th scope="col">Admit card</th>
                {canAllot ? (
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {slot.candidates
                .filter((c) => !filter || filter.visible.has(c.applicationId))
                .map((c) => {
                  const d = c.decision ? DECIDED[c.decision] : null;
                  const who = c.candidate ?? c.number ?? 'the candidate';
                  return (
                    <tr key={c.applicationId}>
                      <td className="ep-num">{c.rollNo}</td>
                      <td>
                        <a href={`/admissions/registrations/${c.applicationId}`}>{who}</a>
                        <div className="ep-field__help" style={{ margin: 0 }}>
                          {c.number}
                        </div>
                      </td>
                      <td>{c.className}</td>
                      <td>
                        {d ? (
                          <Badge tone={d[1]}>{d[0]}</Badge>
                        ) : c.atStage ? (
                          <Badge tone="info">Waiting</Badge>
                        ) : (
                          <Badge tone="neutral">Moved on</Badge>
                        )}
                        {c.notified ? null : (
                          <div className="ep-field__help" style={{ margin: 0 }}>
                            Schedule not mailed
                          </div>
                        )}
                      </td>
                      <td>
                        <ViewDownload
                          href={`/api/admission-desk/admit/${c.applicationId}`}
                          what={`the admit card of ${who}`}
                        />
                      </td>
                      {canAllot ? (
                        <td>
                          {!c.decision ? (
                            <button
                              type="button"
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              disabled={pending}
                              onClick={() =>
                                start(async () => {
                                  const r = await unallotSlot(slot.id, c.applicationId);
                                  if (r.ok) router.refresh();
                                  else setMsg({ tone: 'danger', text: r.error });
                                })
                              }
                            >
                              Remove<span className="ep-sr-only"> {who}</span>
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ margin: 0 }}>No candidate allotted yet.</p>
      )}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ margin: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
