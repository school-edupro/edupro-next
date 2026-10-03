import { apiFetch } from '@/lib/api';
import { timeOf, when, type Appointment } from '@/lib/appointments';

type CardData = Appointment & { school: string; barcode: string | null; qr: string | null };
const svg = (v: string) => `data:image/svg+xml;utf8,${encodeURIComponent(v)}`;

/**
 * The visitor card the gate prints at check-in: ID-card size (86 x 54 mm) with the photo, everything the
 * visitor gave when booking, whom they meet and when, the pass barcode and the QR. Print from the browser.
 */
export default async function VisitorCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await apiFetch<CardData>(`/appointments/${id}/card`);
  const rows: Array<[string, string | null]> = [
    ['From', a.visitorOrg],
    ['Mobile', a.visitorMobile],
    ['People', String(a.partySize)],
    [
      'ID proof',
      a.idProofKind ? `${a.idProofKind}${a.idProofLast4 ? ` …${a.idProofLast4}` : ''}` : null,
    ],
    ['Student', a.student ? `${a.student}${a.section ? ` (${a.section})` : ''}` : null],
    ['To meet', [a.hostName, a.withName].filter(Boolean).join(' · ') || null],
    ['Purpose', a.purpose],
    ['Visit', a.startsAt ? when(a.startsAt) : null],
    ['Where', a.place],
    ['In', a.checkedInAt ? timeOf(a.checkedInAt) : null],
  ];
  return (
    <div className="ep-vcard__page">
      <p className="ep-field__help ep-appt__noprint">
        Visitor card for {a.number}. Use the browser’s Print (card size 86 × 54 mm, or any paper).{' '}
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/engagement/appointments/gate">
          Back to the gate
        </a>
      </p>
      <article className="ep-vcard" aria-label={`Visitor card ${a.number}`}>
        <header className="ep-vcard__head">
          <strong>{a.school}</strong>
          <span>VISITOR</span>
        </header>
        <div className="ep-vcard__body">
          {a.hasPhoto ? (
            <img
              className="ep-vcard__photo"
              src={`/api/appointments/${a.id}/photo?gate=1`}
              alt={`Photo of ${a.visitorName ?? 'the visitor'}`}
            />
          ) : (
            <div className="ep-vcard__photo ep-vcard__photo--none">No photo</div>
          )}
          <div className="ep-vcard__who">
            <div className="ep-vcard__name">{a.visitorName ?? a.student ?? 'Visitor'}</div>
            <dl className="ep-vcard__facts">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
          {a.qr ? <img className="ep-vcard__qr" src={svg(a.qr)} alt="QR code of the pass" /> : null}
        </div>
        <footer className="ep-vcard__foot">
          {a.barcode ? (
            <img
              className="ep-vcard__barcode"
              src={svg(a.barcode)}
              alt={`Barcode of pass ${a.passCode ?? ''}`}
            />
          ) : null}
          <span>
            {a.number} · {a.passCode}
          </span>
        </footer>
      </article>
    </div>
  );
}
