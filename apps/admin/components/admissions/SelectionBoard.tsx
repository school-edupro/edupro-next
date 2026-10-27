'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { OfferPreviewDialog } from '@/components/admissions/OfferPreviewDialog';
import type { Selection } from '@/lib/admission-process';
import {
  selectionAction,
  selectionDrawPreview,
  selectionNextPreview,
  selectionOfferPreview,
  type SelectionPick,
} from '@/lib/admission-process-actions';

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
 * Selection of a class (docs/design/39, part 4): the merit list of candidates at Selection (merit =
 * form points + marks; equal merit: the older child, then a recorded draw, docs/design/40) to offer or
 * wait-list, a replayable draw for a category, the waiting list with
 * "offer the next", and the offers made. Every offer shows its message first (docs/design/56): the
 * email's words may be changed, the same for every family offered together.
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
  // an offer waiting on its message: who, and what is sent when the person sends it
  const [offering, setOffering] = useState<{
    kind: 'offer' | 'draw' | 'next';
    ids: string[];
    names: string[];
    body: Record<string, unknown>;
    lead?: string;
    sendLabel?: string;
    done: (d: Record<string, unknown>) => string;
  } | null>(null);
  const nameOf = (x: SelectionPick) => x.candidate ?? x.number ?? 'A candidate';
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

  const preview = (
    kind: 'draw' | 'next',
    load: () => Promise<
      | { ok: true; data: Omit<NonNullable<typeof offering>, 'kind' | 'done'> }
      | { ok: false; error: string }
    >,
    done: (d: Record<string, unknown>) => string,
  ) =>
    start(async () => {
      setMsg(null);
      const r = await load();
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setOffering({ kind, done, ...r.data });
    });
  const drawBody = () => ({
    classId: data.class.id,
    seats: Number(drawSeats),
    ...(drawCat ? { categoryId: drawCat } : {}),
    ...(seed.trim() ? { seed: seed.trim() } : {}),
  });
  const nextBody = () => ({ classId: data.class.id, ...(nextCat ? { categoryId: nextCat } : {}) });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {offering ? (
        <OfferPreviewDialog
          id={offering.ids[0]!}
          open
          pending={pending}
          batch={offering.ids.length > 1 ? { names: offering.names } : undefined}
          lead={offering.lead}
          sendLabel={offering.sendLabel}
          fetchPreview={(edits) => selectionOfferPreview(data.session.id, offering.ids[0]!, edits)}
          onClose={() => setOffering(null)}
          onSend={(message) => {
            const o = offering;
            setOffering(null);
            act(
              o.kind,
              { ...o.body, ...(Object.keys(message).length ? { offerMessage: message } : {}) },
              o.done,
            );
          }}
        />
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      <section className="ep-card ep-as__card" aria-labelledby="sel-merit">
        <div className="ep-sel__head">
          <h2 id="sel-merit" className="ep-as__h">
            Merit list ({data.merit.length})
          </h2>
          <ViewDownload
            href={`/api/admission-merit/${data.session.id}/${data.class.id}`}
            what={`the merit list of ${data.class.name}`}
          />
        </div>
        <p className="ep-field__help" style={{ margin: 0 }}>
          {data.tieBreak.rule}
          {data.tieBreak.seed ? ` Draw seed ${data.tieBreak.seed}.` : ''}
        </p>
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
                  <th scope="col">Points</th>
                  <th scope="col">Marks</th>
                  <th scope="col">Merit</th>
                  <th scope="col">Born</th>
                </tr>
              </thead>
              <tbody>
                {data.merit.map((x) => (
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
                    <td>
                      {x.rank}
                      {x.tie ? (
                        <>
                          {' '}
                          <Badge tone={x.tie === 'draw' ? 'warning' : 'info'}>
                            {x.tie === 'draw' ? 'by draw' : 'older first'}
                          </Badge>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <a href={`/admissions/registrations/${x.id}`}>{x.candidate ?? x.number}</a>
                      <div className="ep-kicker">
                        {x.number}
                        {x.level ? ` · level ${x.level}` : ''}
                      </div>
                    </td>
                    <td>{x.category ?? '-'}</td>
                    <td>{x.points ?? '-'}</td>
                    <td>{x.marks ?? '-'}</td>
                    <td>
                      <strong>{x.merit ?? '-'}</strong>
                    </td>
                    <td>{x.dob ? dmy(`${x.dob}T00:00:00+05:30`) : '-'}</td>
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
              onClick={() => {
                const rows = data.merit.filter((x) => picked.includes(x.id));
                setMsg(null);
                setOffering({
                  kind: 'offer',
                  ids: rows.map((x) => x.id),
                  names: rows.map(nameOf),
                  body: { applicationIds: rows.map((x) => x.id) },
                  done: () => `${String(rows.length)} offered; the families are told.`,
                });
              }}
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
                preview(
                  'draw',
                  async () => {
                    const r = await selectionDrawPreview(data.session.id, drawBody());
                    if (!r.ok) return r;
                    const { seed: drawn, offered, waitlisted } = r.data;
                    const waits = waitlisted.map(nameOf);
                    return {
                      ok: true as const,
                      data: {
                        ids: offered.map((x) => x.id),
                        names: offered.map(nameOf),
                        // the same seed makes the same draw; refused if Selection changed meanwhile
                        body: { ...drawBody(), seed: drawn, expect: offered.map((x) => x.id) },
                        lead: `Draw with seed ${drawn}: ${offered.map(nameOf).join(', ')} offered${
                          waits.length
                            ? `; ${waits.slice(0, 6).join(', ')}${waits.length > 6 ? ` and ${String(waits.length - 6)} more` : ''} go on the waiting list in this order`
                            : ''
                        }. Nothing changes until you send.`,
                        sendLabel: `Draw and send ${String(offered.length)} offer${offered.length === 1 ? '' : 's'}`,
                      },
                    };
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
                preview(
                  'next',
                  async () => {
                    const r = await selectionNextPreview(data.session.id, nextBody());
                    if (!r.ok) return r;
                    return {
                      ok: true as const,
                      data: {
                        ids: [r.data.id],
                        names: [nameOf(r.data)],
                        // refused if someone else is next by the time it is sent
                        body: { ...nextBody(), applicationId: r.data.id },
                        lead: `Next on the waiting list: ${nameOf(r.data)}${r.data.number ? ` (${r.data.number})` : ''}.`,
                      },
                    };
                  },
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
