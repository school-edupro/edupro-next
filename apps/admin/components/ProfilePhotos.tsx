import { Card } from '@edupro/ui';
import { studentDocumentUpload, studentParentPhotoUpload } from '@/lib/actions';
import type { ProfileSnapshot } from '@/lib/profile';
import { NewParentPhoto } from './NewParentPhoto';
import { PhotoUploader } from './PhotoUploader';

type Party = 'student' | 'father' | 'mother' | 'guardian';

/** Photos on the full profile: the student's and each parent's, each with Add / Change photo. */
export function ProfilePhotos({
  snapshot,
  canEdit,
}: {
  snapshot: ProfileSnapshot;
  canEdit: boolean;
}) {
  const id = snapshot.studentId;
  const back = `/people/students/${id}/profile`;
  const value = (k: string) => {
    const v = snapshot.values[k];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const people: Array<{ party: Party; role: string; name: string | null }> = [
    { party: 'student', role: 'Student', name: snapshot.displayName },
    { party: 'father', role: 'Father', name: value('father_name') },
    { party: 'mother', role: 'Mother', name: value('mother_name') },
  ];
  people.push({ party: 'guardian', role: 'Guardian', name: value('guardian_name') });
  return (
    <Card title="Photos" style={{ marginBottom: 'var(--sp-4)' }}>
      <div className="ep-parents">
        {people.map((p) => {
          const fileId = snapshot.photos?.[p.party];
          return (
            <div key={p.party} className="ep-parent">
              <div className="ep-parent__photo">
                {fileId ? (
                  <img src={`/api/files/${fileId}/view`} alt={`Photo of ${p.name ?? p.role}`} />
                ) : (
                  <span aria-hidden="true">{p.role.slice(0, 1)}</span>
                )}
              </div>
              <div className="ep-parent__info">
                <span className="ep-kicker">{p.role}</span>
                <strong>{p.name ?? 'not filled'}</strong>
                {canEdit && p.name ? (
                  p.party === 'student' ? (
                    <PhotoUploader
                      action={studentDocumentUpload}
                      studentId={id}
                      label={fileId ? 'Change photo' : 'Add photo'}
                      fields={{ kind: 'photo', back }}
                    />
                  ) : (
                    <PhotoUploader
                      action={studentParentPhotoUpload}
                      studentId={id}
                      label={fileId ? 'Change photo' : 'Add photo'}
                      fields={{ party: p.party, back }}
                    />
                  )
                ) : canEdit && p.party !== 'student' ? (
                  <NewParentPhoto studentId={id} party={p.party} role={p.role} back={back} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
        JPG, PNG or WebP. The photos appear on the profile printout, ID card and the parent app.
      </p>
    </Card>
  );
}
