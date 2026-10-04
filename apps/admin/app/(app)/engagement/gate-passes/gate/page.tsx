import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { PassPhotos } from '@/components/gate-passes/PassPhotos';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { findPass, gateInPass, gateOutPass } from '@/lib/gate-pass-actions';
import {
  KIND_LABEL,
  STATE_TONE,
  escortLine,
  whoOfPass,
  type GatePass,
  type GatePassDetail,
} from '@/lib/gate-passes';

interface Board {
  ready: GatePass[];
  out: GatePass[];
  gates: string[];
}
const BASE = '/engagement/gate-passes/gate';

/**
 * The gate keeper's screen: scan or type a pass, see everything on it with the photos (the pupil, the
 * parents on record and the one the front desk took), and let the holder out or back in. Below: who may
 * go out today and the staff who are out and due back.
 */
export default async function GatePassGatePage({
  searchParams,
}: {
  searchParams: Promise<{ found?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, board] = await Promise.all([getMe(), apiFetch<Board>('/gate-passes/gate/board')]);
  const found = /^\d{1,18}$/.test(sp.found ?? '')
    ? await apiFetch<GatePassDetail>(`/gate-passes/${sp.found!}`).catch(() => null)
    : null;
  const gateSelect = (id: string) =>
    board.gates.length > 1 ? (
      <select name="gate" className="ep-select" aria-label={`Gate for ${id}`}>
        {board.gates.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    ) : (
      <input type="hidden" name="gate" value={board.gates[0] ?? ''} />
    );
  const student = found?.audience === 'student';
  const canOut =
    found &&
    ((student && found.state === 'handed_over') || (!student && found.state === 'approved'));
  const canIn =
    found &&
    ((found.kind === 'rgp' && found.state === 'out') ||
      (found.kind === 'late_arrival' && found.state === 'approved'));
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="Gate"
        description={`${String(board.ready.length)} may go out or come in today · ${String(board.out.length)} out and due back.`}
      />
      <GatePassNav current={BASE} permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card title="Scan or type the pass">
        <form action={findPass} className="ep-hd__row">
          <label className="ep-field" htmlFor="gg-code">
            <span className="ep-field__label">Pass code (QR / barcode) or pass number</span>
            <input
              id="gg-code"
              name="code"
              className="ep-input"
              required
              minLength={2}
              maxLength={120}
              autoComplete="off"
            />
          </label>
          <div>
            <Button type="submit">Find</Button>
          </div>
        </form>
      </Card>
      {found ? (
        <Card
          title={`${found.number} · ${found.who}`}
          actions={<Badge tone={STATE_TONE[found.state]}>{found.stage}</Badge>}
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <PassPhotos pass={found} />
          <dl className="ep-hd__facts">
            {(
              [
                ['Pass', found.kindLabel],
                ['Date and time', `${found.onDate}${found.atTime ? `, ${found.atTime}` : ''}`],
                ['Back by', found.returnBy ? when(found.returnBy) : null],
                ['Collected by', escortLine(found)],
                ['Going to', found.destination],
                ['Reason', found.reason],
                [
                  'Handed over',
                  found.handoverAt
                    ? `${when(found.handoverAt)}${found.handoverBy ? ` by ${found.handoverBy}` : ''}`
                    : null,
                ],
                [
                  'Items',
                  found.itemList.length
                    ? found.itemList
                        .map(
                          (i) =>
                            `${i.name} × ${String(i.qty)}${i.serialNo ? ` (${i.serialNo})` : ''}`,
                        )
                        .join(', ')
                    : null,
                ],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {student && found.kind === 'early_leave' && found.state === 'approved' ? (
            <Alert tone="warning">
              Do not let the child out yet: the front desk has not handed the child over.
            </Alert>
          ) : null}
          {found.state === 'pending' ? (
            <Alert tone="warning">This pass is not approved yet.</Alert>
          ) : null}
          {canOut ? (
            <form action={gateOutPass} className="ep-gate__act">
              <input type="hidden" name="id" value={found.id} />
              <input type="hidden" name="returnTo" value={BASE} />
              {gateSelect(found.number)}
              <input
                name="note"
                className="ep-input"
                maxLength={300}
                placeholder={found.items ? 'Items checked?' : 'Note'}
                aria-label="Gate note"
              />
              <Button type="submit">Let out</Button>
            </form>
          ) : null}
          {canIn ? (
            <form action={gateInPass} className="ep-hd__form">
              <input type="hidden" name="id" value={found.id} />
              <input type="hidden" name="returnTo" value={BASE} />
              {found.itemList
                .filter((i) => i.returnable)
                .map((i) => (
                  <label key={i.id} className="ep-field" htmlFor={`gb-${i.id}`}>
                    <span className="ep-field__label">
                      {i.name}
                      {i.serialNo ? ` · ${i.serialNo}` : ''}: how many of {i.qty} came back
                    </span>
                    <input type="hidden" name="itemId" value={i.id} />
                    <input
                      id={`gb-${i.id}`}
                      name={`returned_${i.id}`}
                      type="number"
                      className="ep-input"
                      min={0}
                      max={i.qty}
                      defaultValue={i.qty}
                    />
                  </label>
                ))}
              <label className="ep-field" htmlFor="gb-note">
                <span className="ep-field__label">Note</span>
                <input id="gb-note" name="note" className="ep-input" maxLength={300} />
              </label>
              <div>
                <Button type="submit">
                  {found.kind === 'late_arrival' ? 'Let in' : 'Mark back in'}
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}
      {(
        [
          ['Approved for today', board.ready, 'No approved pass is waiting at the gate.'],
          ['Out and due back (staff, RGP)', board.out, 'Nobody is out on a returnable pass.'],
        ] as Array<[string, GatePass[], string]>
      ).map(([title, rows, empty]) => (
        <Card key={title} title={title} style={{ marginTop: 'var(--sp-4)' }}>
          {rows.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              {empty}
            </p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={title}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Pass</th>
                    <th scope="col">For</th>
                    <th scope="col">Time</th>
                    <th scope="col">With / going to</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.number}
                        <div className="ep-field__help">{KIND_LABEL[p.kind]}</div>
                      </td>
                      <td>{whoOfPass(p)}</td>
                      <td>
                        {p.atTime ?? '—'}
                        {p.returnBy ? (
                          <div className="ep-field__help">back by {when(p.returnBy)}</div>
                        ) : null}
                      </td>
                      <td>
                        {escortLine(p) ?? p.destination ?? '—'}
                        {p.items ? (
                          <div className="ep-field__help">{String(p.items)} item(s)</div>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={STATE_TONE[p.state]}>{p.stage}</Badge>
                      </td>
                      <td>
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`${BASE}?found=${p.id}`}
                          aria-label={`Open ${p.number}`}
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
