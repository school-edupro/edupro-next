import { apiFetch } from '@/lib/api';
import { when } from '@/lib/appointments';
import { escortLine, type GatePassDetail } from '@/lib/gate-passes';

/**
 * The gate pass as an ID-card (86 x 54 mm): who, when, who collects or where to, the approver, the QR and
 * the barcode of the pass, and the collector's photo once the front desk has taken it. Print from the
 * browser, or download the same card as a PDF.
 */
export default async function GatePassCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await apiFetch<GatePassDetail>(`/gate-passes/${id}`);
  const svg = (x: string) => `data:image/svg+xml;utf8,${encodeURIComponent(x)}`;
  const student = p.audience === 'student';
  const approver = [...p.approvals].reverse().find((a) => a.status === 'approved')?.actedBy ?? null;
  const rows: Array<[string, string | null]> = student
    ? [
        ['Class', p.section],
        ['Adm. no.', p.admissionNo],
        [
          p.kind === 'late_arrival' ? 'Arriving' : 'Leaving',
          `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`,
        ],
        ['With', escortLine(p)],
        ['Reason', p.reason],
        ['Approved by', approver],
      ]
    : [
        ['Emp. code', p.employeeCode],
        ['Designation', p.designation],
        ['Out', `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`],
        ['Back by', p.returnBy ? when(p.returnBy) : p.kind === 'nrgp' ? 'Not returning' : null],
        ['Going to', p.destination],
        ['Purpose', p.reason],
        ['Carrying', p.items ? `${String(p.items)} item(s)` : null],
        ['Approved by', approver],
      ];
  const photo = p.photos.collector ? 'collector' : p.photos.student ? 'student' : null;
  return (
    <div className="ep-vcard__page">
      <p className="ep-field__help ep-appt__noprint">
        Gate pass {p.number}. Use the browser’s Print (card size 86 × 54 mm, or any paper).{' '}
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/engagement/gate-passes/${p.id}`}>
          Back to the pass
        </a>{' '}
        {p.passNo ? (
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/api/gate-passes/${p.id}/card`}>
            Download PDF
          </a>
        ) : null}
      </p>
      <article className="ep-vcard" aria-label={`Gate pass ${p.number}`}>
        <header className="ep-vcard__head">
          <strong>{p.school}</strong>
          <span>{student ? 'GATE PASS' : p.kind.toUpperCase()}</span>
        </header>
        <div className="ep-vcard__body">
          {photo ? (
            <img
              className="ep-vcard__photo"
              src={`/api/gate-passes/${p.id}/photo/${photo}`}
              alt={
                photo === 'collector' ? 'Photo of the person collecting' : 'Photo of the student'
              }
            />
          ) : (
            <div className="ep-vcard__photo ep-vcard__photo--none">No photo</div>
          )}
          <div className="ep-vcard__who">
            <div className="ep-vcard__name">{p.student ?? p.employee}</div>
            <dl className="ep-vcard__facts">
              {rows
                .filter(([, x]) => x)
                .map(([k, x]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{x}</dd>
                  </div>
                ))}
            </dl>
          </div>
          {p.qr ? <img className="ep-vcard__qr" src={svg(p.qr)} alt="QR code of the pass" /> : null}
        </div>
        <footer className="ep-vcard__foot">
          {p.barcode ? (
            <img
              className="ep-vcard__barcode"
              src={svg(p.barcode)}
              alt={`Barcode of pass ${p.passCode ?? ''}`}
            />
          ) : null}
          <span>
            {p.number}
            {p.passCode ? ` · ${p.passCode}` : ''}
          </span>
        </footer>
      </article>
    </div>
  );
}
