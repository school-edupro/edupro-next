import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { admitVisitor, exitVisitor, refuseVisitor } from '@/lib/visitor-actions';
import type { Visitor, VisitorOptions } from '@/lib/visitors';

const STATE: Record<Visitor['state'], [string, 'warning' | 'success' | 'neutral' | 'danger']> = {
  waiting: ['Waiting at the gate', 'warning'],
  inside: ['Inside', 'success'],
  left: ['Left', 'neutral'],
  cancelled: ['Not let in', 'danger'],
};
const SOURCE: Record<Visitor['source'], string> = {
  gate: 'Registered by the guard at the gate',
  self: 'Registered by the visitor on their own phone',
  appointment: 'Checked in against an appointment',
};
const OK: Record<string, string> = {
  admitted: 'Let in. The person to be met has been told by mail.',
  refused: 'Marked as not let in.',
  left: 'Exit recorded.',
};
const svg = (x: string) => `data:image/svg+xml;utf8,${encodeURIComponent(x)}`;

/**
 * One visitor pass with everything on it: who came, from where, the ID proof, whom they meet and why,
 * what they carry, when they came in and went out, and the pass code. The gate lets a waiting visitor in
 * or records the exit from here; the card opens for printing or as a PDF.
 */
export default async function VisitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, v, options] = await Promise.all([
    getMe(),
    apiFetch<Visitor & { school: string; barcode: string; qr: string }>(`/visitors/${id}`),
    apiFetch<VisitorOptions>('/visitors/options'),
  ]);
  const here = `/engagement/visitors/${v.id}`;
  const [label, tone] = STATE[v.state];
  const facts: Array<[string, string | null]> = [
    ['Pass number', v.number],
    ['Pass code', v.passCode],
    ['Type of visitor', v.visitorType],
    ['Coming from', v.organisation],
    ['Mobile', v.mobile],
    ['Email', v.email],
    ['People', String(v.partySize)],
    [
      'ID proof',
      v.idProofKind ? `${v.idProofKind}${v.idProofLast4 ? ` …${v.idProofLast4}` : ''}` : null,
    ],
    ['To meet', v.toMeet],
    ['Purpose', v.purpose],
    ['Carrying', v.equipment],
    ['Vehicle', v.vehicleNo],
    ['Badge', v.badgeNo],
    ['Registered', `${when(v.createdAt)}${v.loggedBy ? ` by ${v.loggedBy}` : ''}`],
    ['How', SOURCE[v.source]],
    ['Came in', v.inAt ? `${when(v.inAt)}${v.gate ? ` · ${v.gate}` : ''}` : null],
    ['Went out', v.outAt ? `${when(v.outAt)}${v.exitGate ? ` · ${v.exitGate}` : ''}` : null],
    ['Exit note', v.exitNote],
  ];
  const gates = options.gates;
  return (
    <>
      <PageHeader
        kicker={`Visitor pass ${v.number}`}
        title={v.visitorName}
        description={[v.visitorType, v.organisation].filter(Boolean).join(' · ') || undefined}
        actions={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Badge tone={tone}>{label}</Badge>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/visitors/${v.id}/card`}
            >
              Visitor card
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/api/visitors/${v.id}/card`}>
              Download PDF
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/visitors">
              Back to the register
            </a>
          </span>
        }
      />
      <AppointmentNav current="/engagement/visitors" permissions={me.permissions} />
      {sp.ok && OK[sp.ok] ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{OK[sp.ok]}</Alert>
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {v.state === 'waiting' ? (
        <Card title="At the gate: let the visitor in" style={{ marginBottom: 'var(--sp-4)' }}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Check the ID proof against what the visitor gave, then let them in. The person to be met
            is told by mail.
          </p>
          <div className="ep-gate__act">
            <form action={admitVisitor} className="ep-gate__act">
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="returnTo" value={here} />
              {gates.length > 1 ? (
                <select name="gate" className="ep-select" aria-label="Gate">
                  {gates.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="gate" value={gates[0] ?? ''} />
              )}
              <Button type="submit">Let in</Button>
            </form>
            <form action={refuseVisitor}>
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="returnTo" value={here} />
              <Button type="submit" variant="secondary">
                Refuse
              </Button>
            </form>
          </div>
        </Card>
      ) : null}
      {v.state === 'inside' ? (
        <Card title="At the gate: record the exit" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={exitVisitor} className="ep-hd__row">
            <input type="hidden" name="id" value={v.id} />
            <input type="hidden" name="returnTo" value={here} />
            {gates.length > 1 ? (
              <label className="ep-field" htmlFor="vx-gate">
                <span className="ep-field__label">Exit gate</span>
                <select
                  id="vx-gate"
                  name="exitGate"
                  className="ep-select"
                  defaultValue={v.gate ?? gates[0]}
                >
                  {gates.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="exitGate" value={gates[0] ?? ''} />
            )}
            <label className="ep-field" htmlFor="vx-note">
              <span className="ep-field__label">
                {v.equipment ? 'Note (equipment taken back?)' : 'Note'}
              </span>
              <input id="vx-note" name="note" className="ep-input" maxLength={300} />
            </label>
            <div>
              <Button type="submit">Exit</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Details" style={{ marginBottom: 'var(--sp-4)' }}>
        {v.hasPhoto ? (
          <img
            className="ep-appt__photo"
            src={`/api/visitors/${v.id}/photo`}
            alt={`Photo of ${v.visitorName}`}
          />
        ) : (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            No photo was taken for this visitor.
          </p>
        )}
        <dl className="ep-hd__facts">
          {facts
            .filter(([, x]) => x)
            .map(([k, x]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{x}</dd>
              </div>
            ))}
        </dl>
        {v.appointmentId ? (
          <p style={{ marginBottom: 0 }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/appointments/${v.appointmentId}`}
            >
              Open the appointment
            </a>
          </p>
        ) : null}
      </Card>
      {v.passCode ? (
        <Card title="Pass">
          <div className="ep-appt__poster">
            <p className="ep-pass__name">{v.visitorName}</p>
            <p style={{ margin: 0 }}>
              {[v.number, v.toMeet, v.purpose].filter(Boolean).join(' · ')}
            </p>
            <img src={svg(v.qr)} alt="QR code of the pass" />
            <img className="ep-appt__barcode" src={svg(v.barcode)} alt="Barcode of the pass" />
            <p className="ep-pass__name">{v.passCode}</p>
          </div>
        </Card>
      ) : null}
    </>
  );
}
