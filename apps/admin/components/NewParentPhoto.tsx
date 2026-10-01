import { studentParentPhotoUpload } from '@/lib/actions';

/**
 * Photo for a mother or guardian who is not on record yet: the name and the photo go together, and
 * the name creates the record before the photo is attached.
 */
export function NewParentPhoto({
  studentId,
  party,
  role,
  back,
}: {
  studentId: string;
  party: 'father' | 'mother' | 'guardian';
  role: string;
  back?: string;
}) {
  const id = `np-${party}`;
  return (
    <form action={studentParentPhotoUpload} className="ep-newphoto">
      <input type="hidden" name="id" value={studentId} />
      <input type="hidden" name="party" value={party} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <label className="ep-field__label" htmlFor={`${id}-name`}>
        {role}&rsquo;s name
      </label>
      <input
        id={`${id}-name`}
        name="name"
        className="ep-input"
        required
        maxLength={120}
        autoComplete="off"
      />
      <label className="ep-field__label" htmlFor={`${id}-file`}>
        Photo
      </label>
      <input
        id={`${id}-file`}
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        className="ep-input"
      />
      <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
        Add {role.toLowerCase()} with photo
      </button>
    </form>
  );
}
