import type { ReactNode } from 'react';
import type { MyProfile } from '@/lib/my-profile';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * My photo on My profile (0188): the one on file, a new one waiting for approval, and "Change photo"
 * when the school lets the employee change it (at once, or for approval). The same component serves
 * the admin app and the staff app (apps/teacher/components/MyPhoto.tsx is a copy).
 */
export function MyPhoto({
  name,
  photo,
  canEdit,
  src,
  action,
  tr = (x) => x,
  badge,
  button,
}: {
  name: string;
  photo: MyProfile['photo'];
  canEdit: boolean;
  /** the app's own route that shows my photo; `?file=` for the one waiting */
  src: string;
  action: (fd: FormData) => Promise<void>;
  tr?: (text: string) => string;
  badge: (text: string) => ReactNode;
  button: (label: string) => ReactNode;
}) {
  const editable = photo.level === 'edit_approval' || photo.level === 'edit_direct';
  return (
    <section
      className="ep-card ep-acr-card"
      aria-labelledby="my-photo"
      style={{ marginBottom: 'var(--sp-3)' }}
    >
      <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="ep-hero__photo">
          {photo.fileId ? (
            <img src={src} alt={`${tr('Photo of')} ${name}`} />
          ) : (
            <span className="ep-hero__initials" aria-hidden="true">
              {initials(name)}
            </span>
          )}
        </div>
        <div style={{ flex: '1 1 16rem' }}>
          <h2 id="my-photo" className="ep-card__title" style={{ marginTop: 0 }}>
            {tr('My photo')}
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {tr('On the profile printout and the ID card.')}{' '}
            {photo.level === 'edit_direct'
              ? tr('A new photo shows at once.')
              : photo.level === 'edit_approval'
                ? tr('A new photo shows after the school approves it.')
                : tr('The office changes it.')}
          </p>
          {photo.pending ? (
            <p style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <img
                src={`${src}?file=${photo.pending}`}
                alt={tr('New photo')}
                width={56}
                height={56}
                style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
              />
              {badge(tr('Waiting for approval: new photo'))}
            </p>
          ) : null}
          {canEdit && editable && !photo.pending ? (
            <form
              action={action}
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <label className="ep-field" htmlFor="my-photo-file" style={{ margin: 0 }}>
                <span className="ep-field__label">
                  {tr('New photo (JPG, PNG or WebP, up to 5 MB)')}
                </span>
                <input
                  id="my-photo-file"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
              </label>
              {button(tr(photo.level === 'edit_direct' ? 'Change photo' : 'Send for approval'))}
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
