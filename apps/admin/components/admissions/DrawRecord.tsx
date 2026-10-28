'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { OfferPreviewDialog } from '@/components/admissions/OfferPreviewDialog';
import type { DrawPlan } from '@/lib/admission-draw';
import { checkDraw, recordDraw } from '@/lib/admission-draw-actions';
import { selectionOfferPreview } from '@/lib/admission-process-actions';

/**
 * The draw made by hand (docs/design/60, part 3): the seats to fill and the registration numbers in the
 * order the slips came out (typed, or scanned from the slip's barcode, one a line); Check shows who is
 * offered and who waits; Record sends the offers (previewed) and wait-lists the rest in drawn order.
 */
export function DrawRecord({
  cycleId,
  classId,
  categoryId,
  totals,
}: {
  cycleId: string;
  classId: string;
  categoryId: string;
  totals: Array<{ points: string; slips: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [points, setPoints] = useState(totals[0]?.points ?? '');
  const [seats, setSeats] = useState('');
  const [numbers, setNumbers] = useState('');
  const [plan, setPlan] = useState<DrawPlan | null>(null);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const body = () => ({
    cycleId,
    classId,
    ...(categoryId ? { categoryId } : {}),
    points,
    seats: Number(seats),
    numbers: numbers
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
  });
  const offered = plan?.order.filter((x) => x.outcome === 'offered') ?? [];
  const waiting = plan?.order.filter((x) => x.outcome === 'waitlisted') ?? [];
  const changed = () => setPlan(null);

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {asking && plan && offered.length ? (
        <OfferPreviewDialog
          id={offered[0]!.ids[0]!}
          open
          pending={pending}
          batch={{ names: offered.flatMap((x) => x.names) }}
          lead={`${String(offered.reduce((n, x) => n + x.ids.length, 0))} offered, ${String(waiting.reduce((n, x) => n + x.ids.length, 0))} wait-listed in drawn order.`}
          sendLabel="Record the draw and send the offers"
          fetchPreview={(edits) => selectionOfferPreview(cycleId, offered[0]!.ids[0]!, edits)}
          onClose={() => setAsking(false)}
          onSend={(message) => {
            setAsking(false);
            start(async () => {
              const r = await recordDraw({
                ...body(),
                ...(Object.keys(message).length ? { offerMessage: message } : {}),
              });
              if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
              setMsg({
                tone: 'success',
                text: `The draw is recorded: ${String(offered.length)} slip${offered.length === 1 ? '' : 's'} offered, ${String(waiting.length)} on the waiting list (the offers go out with the workers).`,
              });
              setPlan(null);
              setNumbers('');
              setSeats('');
              router.refresh();
            });
          }}
        />
      ) : null}
      <div className="ep-lead-filter" style={{ margin: 0 }}>
        <label className="ep-field">
          <span className="ep-field__label">Points total drawn</span>
          <select
            className="ep-select"
            value={points}
            onChange={(e) => {
              setPoints(e.target.value);
              changed();
            }}
          >
            {totals.map((t) => (
              <option key={t.points} value={t.points}>
                {t.points} points · {t.slips} candidate{t.slips === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Seats to fill</span>
          <input
            className="ep-input"
            type="number"
            min={1}
            max={5000}
            style={{ width: '8rem' }}
            value={seats}
            onChange={(e) => {
              setSeats(e.target.value);
              changed();
            }}
          />
        </label>
      </div>
      <label className="ep-field">
        <span className="ep-field__label">Registration numbers in the order drawn</span>
        <textarea
          className="ep-input"
          rows={8}
          value={numbers}
          placeholder="One a line: type it, or scan the slip's barcode"
          onChange={(e) => {
            setNumbers(e.target.value);
            changed();
          }}
        />
        <span className="ep-field__help">
          A twin slip counts by either twin&apos;s number. The first slips take the seats; the rest
          go on the waiting list in this order; slips not entered stay at Selection.
        </span>
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={pending || !points || !(Number(seats) >= 1) || !numbers.trim()}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await checkDraw(body());
              if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
              setPlan(r.data);
            })
          }
        >
          Check
        </button>
        {plan && !plan.errors.length && offered.length ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={() => setAsking(true)}
          >
            Record the draw and send the offers
          </button>
        ) : null}
      </div>
      {plan?.errors.length ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          <div>
            <strong>Fix these, then check again:</strong>
            <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: '1.2rem' }}>
              {plan.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {plan && plan.order.length ? (
        <>
          <p style={{ margin: 0 }}>
            {plan.seats} seat{plan.seats === 1 ? '' : 's'} to fill of {plan.seatsLeft} left
            {plan.extraSeats
              ? ` · a twin slip at the last seat takes ${String(plan.extraSeats)} more`
              : ''}
            {plan.notDrawn.length ? ` · ${String(plan.notDrawn.length)} slips not drawn` : ''}.
          </p>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="The drawn order (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">The drawn order and its result</caption>
              <thead>
                <tr>
                  <th scope="col" className="ep-num">
                    Drawn
                  </th>
                  <th scope="col">Registration no.</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {plan.order.map((x) => (
                  <tr key={x.rank}>
                    <td className="ep-num">{x.rank}</td>
                    <td>{x.numbers.join(' & ')}</td>
                    <td>{x.names.join(' & ')}</td>
                    <td>
                      {x.outcome === 'offered' ? (
                        <Badge tone="success">Offered a seat</Badge>
                      ) : (
                        <Badge tone="info">Waiting list {waiting.indexOf(x) + 1}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.notDrawn.length ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Not drawn: {plan.notDrawn.map((x) => x.names.join(' & ')).join(', ')}.
            </p>
          ) : null}
        </>
      ) : null}
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
