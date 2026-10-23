'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SlotDetail } from '@/lib/admission-process';
import { allotSlot, saveSlotResults, unallotSlot } from '@/lib/admission-process-actions';

type Row = {
  attendance: 'present' | 'absent';
  marks: string;
  decision: '' | 'approve' | 'reject' | 'hold';
  remarks: string;
};
const DECIDED: Record<string, string> = {
  approved: 'Passed',
  rejected: 'Not selected',
  hold: 'On hold',
  offered: 'Offered',
  waitlisted: 'Waiting list',
};

/** The candidates of a slot: allot the next waiting, then attendance, marks and the decision for each. */
export function SlotCandidates({
  slot,
  canAllot,
  canDecide,
}: {
  slot: SlotDetail;
  canAllot: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [notify, setNotify] = useState(true);
  // what was typed for each candidate; a candidate allotted after the page opened starts from the record
  const fresh = (c: SlotDetail['candidates'][number]): Row => ({
    attendance: (c.attendance as 'present' | 'absent' | null) ?? 'present',
    marks: c.marks !== null ? String(c.marks) : '',
    decision: '',
    remarks: c.remarks ?? '',
  });
  const [typed, setRows] = useState<Record<string, Row>>({});
  const rows: Record<string, Row> = Object.fromEntries(
    slot.candidates.map((c) => [c.applicationId, typed[c.applicationId] ?? fresh(c)]),
  );
  const marksStage = slot.kind === 'test' || slot.kind === 'interview';
  const room = slot.capacity - slot.candidates.length;
  const open = slot.candidates.filter((c) => c.atStage && !c.decision);
  const set = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? rows[id]!), ...patch } }));

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {canAllot ? (
        <div className="ep-rp__row">
          <span>
            {slot.candidates.length} of {slot.capacity} allotted · {slot.waiting} waiting for this
            stage
          </span>
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
            disabled={pending || room <= 0 || slot.waiting === 0}
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
            Allot the next {Math.min(room, slot.waiting)}
          </button>
        </div>
      ) : null}
      {slot.candidates.length ? (
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">Candidates of the slot</caption>
            <thead>
              <tr>
                <th scope="col">Roll no.</th>
                <th scope="col">Candidate</th>
                <th scope="col">Attendance</th>
                {marksStage ? (
                  <th scope="col">Marks{slot.maxMarks ? ` (/${String(slot.maxMarks)})` : ''}</th>
                ) : null}
                <th scope="col">Decision</th>
                <th scope="col">Remarks</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {slot.candidates.map((c) => {
                const r = rows[c.applicationId]!;
                const done = Boolean(c.decision) || !c.atStage;
                return (
                  <tr key={c.applicationId}>
                    <td>{c.rollNo}</td>
                    <td>
                      <a href={`/admissions/registrations/${c.applicationId}`}>
                        {c.candidate ?? c.number}
                      </a>
                      <div className="ep-kicker">
                        {c.number} · {c.className}
                      </div>
                    </td>
                    <td>
                      <select
                        className="ep-select"
                        aria-label={`Attendance of ${c.candidate ?? c.number ?? ''}`}
                        value={r.attendance}
                        disabled={done || !canDecide}
                        onChange={(e) =>
                          set(c.applicationId, { attendance: e.target.value as Row['attendance'] })
                        }
                      >
                        <option value="present">Present</option>
                        <option value="absent">Absent</option>
                      </select>
                    </td>
                    {marksStage ? (
                      <td>
                        <input
                          className="ep-input"
                          type="number"
                          min={0}
                          max={slot.maxMarks ?? undefined}
                          step="0.5"
                          aria-label={`Marks of ${c.candidate ?? c.number ?? ''}`}
                          value={r.marks}
                          disabled={done || !canDecide || r.attendance === 'absent'}
                          onChange={(e) => set(c.applicationId, { marks: e.target.value })}
                        />
                      </td>
                    ) : null}
                    <td>
                      {c.decision ? (
                        (DECIDED[c.decision] ?? c.decision)
                      ) : (
                        <select
                          className="ep-select"
                          aria-label={`Decision for ${c.candidate ?? c.number ?? ''}`}
                          value={r.decision}
                          disabled={done || !canDecide}
                          onChange={(e) =>
                            set(c.applicationId, { decision: e.target.value as Row['decision'] })
                          }
                        >
                          <option value="">Not yet</option>
                          <option value="approve">Pass</option>
                          <option value="hold">Hold</option>
                          <option value="reject">Not selected</option>
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        className="ep-input"
                        aria-label={`Remarks for ${c.candidate ?? c.number ?? ''}`}
                        maxLength={1000}
                        value={r.remarks}
                        disabled={done || !canDecide}
                        onChange={(e) => set(c.applicationId, { remarks: e.target.value })}
                      />
                    </td>
                    <td>
                      {canAllot && !c.decision ? (
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const x = await unallotSlot(slot.id, c.applicationId);
                              if (x.ok) router.refresh();
                              else setMsg({ tone: 'danger', text: x.error });
                            })
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ margin: 0 }}>No candidate allotted yet.</p>
      )}
      {canDecide && open.length ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const list = open
                  .filter((c) => rows[c.applicationId]!.decision)
                  .map((c) => {
                    const r = rows[c.applicationId]!;
                    return {
                      applicationId: c.applicationId,
                      attendance: r.attendance,
                      marks: r.attendance === 'absent' || r.marks === '' ? null : Number(r.marks),
                      decision: r.decision as 'approve' | 'reject' | 'hold',
                      ...(r.remarks.trim() ? { remarks: r.remarks.trim() } : {}),
                    };
                  });
                if (!list.length)
                  return setMsg({
                    tone: 'danger',
                    text: 'Choose a decision for at least one candidate.',
                  });
                const x = await saveSlotResults(slot.id, list);
                if (x.ok) {
                  setMsg({
                    tone: x.data.errors.length ? 'danger' : 'success',
                    text: `${String(x.data.saved)} saved${x.data.errors.length ? `; ${String(x.data.errors.length)} skipped` : ''}.`,
                  });
                  router.refresh();
                } else setMsg({ tone: 'danger', text: x.error });
              })
            }
          >
            Save the results
          </button>
        </div>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
