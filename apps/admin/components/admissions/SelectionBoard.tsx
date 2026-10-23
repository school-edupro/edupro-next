'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Selection } from '@/lib/admission-process';
import { selectionAction } from '@/lib/admission-process-actions';

const dmy = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '';

/**
 * Selection of a class (docs/design/39, part 4): the merit list of candidates at Selection (by marks,
 * then registration date) to offer or wait-list, a replayable draw for a category, the waiting list with
 * "offer the next", and the offers made.
 */
export function SelectionBoard({ data, canManage }: { data: Selection; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [drawCat, setDrawCat] = useState('');
  const [drawSeats, setDrawSeats] = useState(String(Math.max(data.class.left, 1)));
  const [seed, setSeed] = useState('');
  const [nextCat, setNextCat] = useState('');
  const act = (
    kind: 'offer' | 'waitlist' | 'draw' | 'next',
    body: Record<string, unknown>,
    done: (d: Record<string, unknown>) => string,
  ) =>
    start(async () => {
      setMsg(null);
      const r = await selectionAction(data.session.id, kind, body);
      if (r.ok) {
        setPicked([]);
        setMsg({ tone: 'success', text: done(r.data) });
        router.refresh();
      } else setMsg({ tone: 'danger', text: r.error });
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      <section className="ep-card ep-as__card" aria-labelledby="sel-merit">
        <h2 id="sel-merit" className="ep-as__h">
          Merit list ({data.merit.length})
        </h2>
        {data.merit.length === 0 ? (
          <p style={{ margin: 0 }}>Nobody waits at Selection in this class.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Merit list</caption>
              <thead>
                <tr>
                  {canManage ? (
                    <th scope="col">
                      <span className="ep-sr-only">Choose</span>
                    </th>
                  ) : null}
                  <th scope="col">Rank</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Category</th>
                  <th scope="col">Merit</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {data.merit.map((x, i) => (
                  <tr key={x.id}>
                    {canManage ? (
                      <td>
                        <label className="ep-check">
                          <input
                            type="checkbox"
                            className="ep-check__input"
                            checked={picked.includes(x.id)}
                            onChange={(e) =>
                              setPicked(
                                e.target.checked
                                  ? [...picked, x.id]
                                  : picked.filter((p) => p !== x.id),
                              )
                            }
                          />
                          <span className="ep-check__box" aria-hidden="true" />
                          <span className="ep-sr-only">Choose {x.candidate ?? x.number}</span>
                        </label>
                      </td>
                    ) : null}
                    <td>{i + 1}</td>
                    <td>
                      <a href={`/admissions/registrations/${x.id}`}>{x.candidate ?? x.number}</a>
                      <div className="ep-kicker">
                        {x.number}
                        {x.level ? ` · level ${x.level}` : ''}
                      </div>
                    </td>
                    <td>{x.category ?? '-'}</td>
                    <td>{x.merit ?? '-'}</td>
                    <td>{dmy(x.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage && data.merit.length ? (
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending || !picked.length}
              onClick={() =>
                act(
                  'offer',
                  { applicationIds: picked },
                  () => `${String(picked.length)} offered; the families are mailed.`,
                )
              }
            >
              Offer admission ({picked.length})
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending || !picked.length}
              onClick={() =>
                act(
                  'waitlist',
                  { applicationIds: picked },
                  () => `${String(picked.length)} put on the waiting list.`,
                )
              }
            >
              Waiting list ({picked.length})
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setPicked(data.merit.slice(0, data.class.left).map((x) => x.id))}
            >
              Choose the top {data.class.left}
            </button>
          </div>
        ) : null}
      </section>

      {canManage && data.merit.length ? (
        <section className="ep-card ep-as__card" aria-labelledby="sel-draw">
          <h2 id="sel-draw" className="ep-as__h">
            Draw of lots
          </h2>
          <p className="ep-field__help" style={{ margin: 0 }}>
            For a category filled by draw (EWS, for example): the candidates at Selection are
            shuffled with the seed; the first seats are offered and the rest go on the waiting list
            in draw order. The same seed gives the same order, so the draw can be shown and checked.
          </p>
          <div className="ep-rp__row">
            <label className="ep-field">
              <span className="ep-field__label">Category</span>
              <select
                className="ep-select"
                value={drawCat}
                onChange={(e) => setDrawCat(e.target.value)}
              >
                <option value="">Every category</option>
                {data.categories.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Seats</span>
              <input
                className="ep-input"
                type="number"
                min={1}
                value={drawSeats}
                onChange={(e) => setDrawSeats(e.target.value)}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Seed (blank: random)</span>
              <input
                className="ep-input"
                maxLength={80}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending || !(Number(drawSeats) > 0)}
              onClick={() =>
                act(
                  'draw',
                  {
                    classId: data.class.id,
                    seats: Number(drawSeats),
                    ...(drawCat ? { categoryId: drawCat } : {}),
                    ...(seed.trim() ? { seed: seed.trim() } : {}),
                  },
                  (d) =>
                    `Draw done with seed ${String(d.seed)}: ${String((d.offered as unknown[]).length)} offered, ${String(
                      (d.waitlisted as unknown[]).length,
                    )} on the waiting list.`,
                )
              }
            >
              Draw
            </button>
          </div>
        </section>
      ) : null}

      <section className="ep-card ep-as__card" aria-labelledby="sel-wait">
        <h2 id="sel-wait" className="ep-as__h">
          Waiting list ({data.waiting.length})
        </h2>
        {data.waiting.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Waiting list</caption>
              <thead>
                <tr>
                  <th scope="col">No.</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Category</th>
                  <th scope="col">Merit</th>
                </tr>
              </thead>
              <tbody>
                {data.waiting.map((x) => (
                  <tr key={x.id}>
                    <td>{x.waitRank}</td>
                    <td>
                      <a href={`/admissions/registrations/${x.id}`}>{x.candidate ?? x.number}</a>
                      <div className="ep-kicker">{x.number}</div>
                    </td>
                    <td>{x.category ?? '-'}</td>
                    <td>{x.merit ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0 }}>Nobody on the waiting list.</p>
        )}
        {canManage && data.waiting.length ? (
          <div className="ep-rp__row">
            <label className="ep-field">
              <span className="ep-field__label">Category</span>
              <select
                className="ep-select"
                value={nextCat}
                onChange={(e) => setNextCat(e.target.value)}
              >
                <option value="">Any category</option>
                {data.categories.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending}
              onClick={() =>
                act(
                  'next',
                  { classId: data.class.id, ...(nextCat ? { categoryId: nextCat } : {}) },
                  () => 'The next on the list is offered.',
                )
              }
            >
              Offer the next
            </button>
          </div>
        ) : null}
      </section>

      <section className="ep-card ep-as__card" aria-labelledby="sel-offered">
        <h2 id="sel-offered" className="ep-as__h">
          Offered and admitted ({data.offered.length})
        </h2>
        {data.offered.length ? (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Offers</caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Pay by</th>
                </tr>
              </thead>
              <tbody>
                {data.offered.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <a href={`/admissions/registrations/${x.id}`}>{x.candidate ?? x.number}</a>
                      <div className="ep-kicker">{x.number}</div>
                    </td>
                    <td>{x.category ?? '-'}</td>
                    <td>
                      <Badge tone={x.status === 'offered' ? 'warning' : 'success'}>
                        {x.status === 'offered'
                          ? 'Fee due'
                          : x.status === 'fee_paid'
                            ? 'Fee paid'
                            : 'Admitted'}
                      </Badge>
                    </td>
                    <td>{x.status === 'offered' ? dmy(x.offerExpiresAt) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0 }}>No offer yet.</p>
        )}
      </section>
    </div>
  );
}
