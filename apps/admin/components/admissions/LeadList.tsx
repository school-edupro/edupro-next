'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { bulkLeads } from '@/lib/admission-enquiry-actions';
import {
  LOST_REASONS,
  SCORE_LABEL,
  SCORE_TONE,
  type EnquiryRow,
  type EnquiryStage,
} from '@/lib/admission-enquiry';

const dmy = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso),
  );

/**
 * The leads as a list (docs/design/45, part 2): pick rows, then give them to a counsellor, move them,
 * or score them, all at once.
 */
export function LeadList({
  rows,
  stages,
  counsellors,
  today,
}: {
  rows: EnquiryRow[];
  stages: EnquiryStage[];
  counsellors: Array<{ id: string; name: string }>;
  today: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [action, setAction] = useState<'assign' | 'move' | 'score' | ''>('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const all = rows.length > 0 && picked.length === rows.length;
  const movable = stages.filter(
    (s) => s.status === 'active' && (s.kind === 'open' || s.kind === 'lost'),
  );
  const lost = action === 'move' && movable.find((s) => s.id === value)?.kind === 'lost';
  const run = () =>
    start(async () => {
      const r = await bulkLeads({
        ids: picked,
        ...(action === 'assign' ? { counsellorUserId: value || null } : {}),
        ...(action === 'move' ? { stageId: value, ...(lost ? { lostReason: reason } : {}) } : {}),
        ...(action === 'score' ? { score: value } : {}),
      });
      if (r.ok) {
        setMsg({
          tone: 'success',
          text: `${String(r.done)} done${r.skipped ? `; ${String(r.skipped)} left as they were (registered already)` : ''}.`,
        });
        setPicked([]);
        setAction('');
        setValue('');
        setReason('');
        router.refresh();
      } else setMsg({ tone: 'danger', text: r.error });
    });
  return (
    <>
      <div className="ep-lead-bulk" role="group" aria-label="With the leads picked">
        <span className="ep-kicker">{picked.length} picked</span>
        <select
          className="ep-select"
          aria-label="What to do"
          data-native
          value={action}
          disabled={!picked.length}
          onChange={(e) => {
            setAction(e.target.value as typeof action);
            setValue('');
          }}
        >
          <option value="">Do…</option>
          <option value="assign">Give to a counsellor</option>
          <option value="move">Move to a stage</option>
          <option value="score">Score</option>
        </select>
        {action === 'assign' ? (
          <select
            className="ep-select"
            aria-label="Counsellor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Nobody</option>
            {counsellors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        {action === 'move' ? (
          <select
            className="ep-select"
            aria-label="Stage"
            data-native
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Choose…</option>
            {movable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        {lost ? (
          <select
            className="ep-select"
            aria-label="Why they are lost"
            data-native
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Why?</option>
            {LOST_REASONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        ) : null}
        {action === 'score' ? (
          <select
            className="ep-select"
            aria-label="Score"
            data-native
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Choose…</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
            <option value="none">No score</option>
          </select>
        ) : null}
        {action ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending || (action !== 'assign' && !value) || (lost && !reason)}
            onClick={run}
          >
            Apply to {picked.length}
          </button>
        ) : null}
        {msg ? (
          <span
            className={`ep-alert ep-alert--${msg.tone}`}
            role={msg.tone === 'danger' ? 'alert' : 'status'}
          >
            {msg.text}
          </span>
        ) : null}
      </div>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Enquiries">
        <table className="ep-table">
          <caption className="ep-sr-only">Enquiries</caption>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="Pick every lead shown"
                  checked={all}
                  onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])}
                />
              </th>
              <th scope="col">Family</th>
              <th scope="col">Class</th>
              <th scope="col">Came from</th>
              <th scope="col">Stage</th>
              <th scope="col">Next follow-up</th>
              <th scope="col">Counsellor</th>
              <th scope="col">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const open = e.stage?.kind === 'open' || e.stage?.kind === 'started';
              const late = open && e.nextFollowUpOn && e.nextFollowUpOn < today;
              return (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Pick ${e.parentName}`}
                      checked={picked.includes(e.id)}
                      onChange={(ev) =>
                        setPicked((cur) =>
                          ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <a href={`/admissions/enquiries/${e.id}`}>{e.parentName}</a>
                    {e.score ? (
                      <>
                        {' '}
                        <Badge tone={SCORE_TONE[e.score]}>{SCORE_LABEL[e.score]}</Badge>
                      </>
                    ) : null}
                    <div className="ep-kicker">
                      {[e.childName, e.mobile ?? e.email].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>{e.className ?? '-'}</td>
                  <td>
                    {e.source ?? '-'}
                    {e.campaign ? <div className="ep-kicker">{e.campaign}</div> : null}
                  </td>
                  <td>
                    {e.stage?.name ?? '-'}
                    {e.registrationNo ? <div className="ep-kicker">{e.registrationNo}</div> : null}
                  </td>
                  <td>
                    {e.nextFollowUpOn && open ? (
                      late ? (
                        <Badge tone="danger">{dmy(e.nextFollowUpOn)}</Badge>
                      ) : (
                        dmy(e.nextFollowUpOn)
                      )
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{e.counsellor ?? '-'}</td>
                  <td>{dmy(e.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
