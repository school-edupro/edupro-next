import { apiFetch } from '@/lib/api';
import { when } from '@/lib/appointments';
import type { Visitor } from '@/lib/visitors';

/**
 * The visitor card the gate prints for a walk-in visitor: ID-card size (86 x 54 mm) with the photo, what
 * the visitor gave, what they carry, whom they meet and the pass barcode. Print from the browser, or
 * download the same card as a PDF.
 */
export default async function WalkInCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await apiFetch<Visitor & { school: string; barcode: string; qr: string }>(
    `/visitors/${id}`,
  );
  const svg = (x: string) => `data:image/svg+xml;utf8,${encodeURIComponent(x)}`;
  const rows: Array<[string, string | null]> = [
    ['From', v.organisation],
    ['Mobile', v.mobile],
    ['People', v.partySize > 1 ? String(v.partySize) : null],
    [
      'ID proof',
      v.idProofKind ? `${v.idProofKind}${v.idProofLast4 ? ` …${v.idProofLast4}` : ''}` : null,
    ],
    ['To meet', v.toMeet],
    ['Purpose', v.purpose],
    ['Carrying', v.equipment],
    ['Vehicle', v.vehicleNo],
    ['In', v.inAt ? when(v.inAt) : null],
  ];
  return (
    <div className="ep-vcard__page">
      <p className="ep-field__help ep-appt__noprint">
        Visitor card for {v.number}. Use the browser’s Print (card size 86 × 54 mm, or any paper).{' '}
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/engagement/visitors/${v.id}`}>
          Back to the pass
        </a>{' '}
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/api/visitors/${v.id}/card`}>
          Download PDF
        </a>
      </p>
      <article className="ep-vcard" aria-label={`Visitor card ${v.number}`}>
        <header className="ep-vcard__head">
          <strong>{v.school}</strong>
          <span>{(v.visitorType ?? 'Visitor').toUpperCase()}</span>
        </header>
        <div className="ep-vcard__body">
          {v.hasPhoto ? (
            <img
              className="ep-vcard__photo"
              src={`/api/visitors/${v.id}/photo`}
              alt={`Photo of ${v.visitorName}`}
            />
          ) : (
            <div className="ep-vcard__photo ep-vcard__photo--none">No photo</div>
          )}
          <div className="ep-vcard__who">
            <div className="ep-vcard__name">{v.visitorName}</div>
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
          <img className="ep-vcard__qr" src={svg(v.qr)} alt="QR code of the pass" />
        </div>
        <footer className="ep-vcard__foot">
          <img
            className="ep-vcard__barcode"
            src={svg(v.barcode)}
            alt={`Barcode of pass ${v.passCode ?? ''}`}
          />
          <span>
            {v.number} · {v.passCode}
          </span>
        </footer>
      </article>
    </div>
  );
}
