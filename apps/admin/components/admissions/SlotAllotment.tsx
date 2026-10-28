'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import type { SlotDetail } from '@/lib/admission-process';
import { allotSlot, unallotSlot } from '@/lib/admission-process-actions';

const DECIDED: Record<string, [string, 'success' | 'warning' | 'danger' | 'info']> = {
  approved: ['Passed', 'success'],
  hold: ['On hold', 'warning'],
  rejected: ['Not selected', 'danger'],
  offered: ['Offered', 'success'],
  waitlisted: ['Waiting list', 'info'],
};

/**
 * A slot's allotment (docs/design/58, part 2): the next candidates waiting for the stage allotted up to
 * the room left (the schedule mailed to the families when ticked), each candidate's admit card, and a
 * candidate not yet decided taken out of the slot.
 */
export function SlotAllotment({ slot, canAllot }: { slot: SlotDetail; canAllot: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const room = slot.capacity - slot.candidates.length;
  const next = Math.min(room, slot.waiting);

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
            onClick={() =>
              start(async () => {
                const r = await allotSlot(slot.id, { notify });
                setMsg(
                  r.ok ? { tone: 'success', text: 'Allotted.' } : { tone: 'danger', text: r.error },
                );
                if (r.ok) router.refresh();
              })
            }
          >
            Allot the next {next}
          </button>
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
              {slot.candidates.map((c) => {
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
