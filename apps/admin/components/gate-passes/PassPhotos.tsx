import type { GatePassDetail } from '@/lib/gate-passes';

const LABEL: Record<string, string> = {
  student: 'Student',
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
  collector: 'Collecting (taken at the front desk)',
};

/**
 * The photos of one pass side by side: the pupil and the parents on the school's record, and the live
 * photo of the person collecting, so the front desk and the gate can compare faces.
 */
export function PassPhotos({ pass }: { pass: GatePassDetail }) {
  const parties = (['student', 'father', 'mother', 'guardian', 'collector'] as const).filter(
    (k) => pass.photos[k],
  );
  if (pass.audience !== 'student') return null;
  return (
    <div className="ep-pass-photos">
      {parties.length === 0 ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          No photo is on the school’s record for this pupil or the parents.
        </p>
      ) : null}
      {parties.map((k) => (
        <figure key={k} className="ep-pass-photos__one" data-party={k}>
          <img
            src={`/api/gate-passes/${pass.id}/photo/${k}`}
            alt={`${LABEL[k]!} photo for ${pass.number}`}
          />
          <figcaption>{LABEL[k]}</figcaption>
        </figure>
      ))}
    </div>
  );
}
