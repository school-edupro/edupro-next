'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveSignature } from '@/lib/exam-entry-actions';

export const SIGNATURE_ROLES: Record<string, string> = {
  principal: 'Principal',
  vice_principal: 'Vice principal',
  headmistress: 'Headmistress',
  coordinator: 'Coordinator',
  class_teacher: 'Class teacher',
  exam_incharge: 'Exam in-charge',
  seal: 'School seal',
};

/**
 * A signature (or the seal) for the report cards (docs/design/65, part 4): the role, the words under
 * it, the person's name, the classes, and a PNG / JPEG image (300 KB at most). Editing keeps the image
 * unless a new one is chosen.
 */
export function SignatureForm({
  id = null,
  initial,
  classes,
}: {
  id?: string | null;
  initial?: {
    role: string;
    label: string;
    personName: string | null;
    classIds: string[];
    status: string;
  };
  classes: Array<{ id: string; code: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState(initial?.role ?? 'principal');
  const [label, setLabel] = useState(initial?.label ?? SIGNATURE_ROLES.principal!);
  const [personName, setPersonName] = useState(initial?.personName ?? '');
  const [classIds, setClassIds] = useState<string[]>(initial?.classIds ?? []);
  const [active, setActive] = useState((initial?.status ?? 'active') === 'active');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const key = id ?? 'new';

  const read = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new Error('The image could not be read'));
      r.readAsDataURL(f);
    });

  return (
    <form
      className="ep-rp__act"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          if (file && file.size > 300_000) {
            setMsg({ tone: 'danger', text: 'The image is larger than 300 KB' });
            return;
          }
          if (file && !['image/png', 'image/jpeg'].includes(file.type)) {
            setMsg({ tone: 'danger', text: 'Choose a PNG or JPEG image' });
            return;
          }
          const r = await saveSignature(id, {
            role,
            label: label.trim(),
            personName: personName.trim() || null,
            classIds,
            status: active ? 'active' : 'inactive',
            ...(file
              ? {
                  image: {
                    contentType: file.type as 'image/png' | 'image/jpeg',
                    base64: await read(file),
                  },
                }
              : {}),
          });
          if (r.ok) {
            setMsg({ tone: 'success', text: 'Saved.' });
            if (!id) {
              setPersonName('');
              setFile(null);
            }
            router.refresh();
          } else setMsg({ tone: 'danger', text: r.error });
        });
      }}
    >
      <div className="ep-rp__row">
        <label className="ep-field">
          <span className="ep-field__label">Role</span>
          <select
            className="ep-select"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              if (!id) setLabel(SIGNATURE_ROLES[e.target.value] ?? '');
            }}
          >
            {Object.entries(SIGNATURE_ROLES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Printed under it</span>
          <input
            className="ep-input"
            value={label}
            required
            minLength={2}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Name (optional)</span>
          <input
            className="ep-input"
            value={personName}
            maxLength={80}
            onChange={(e) => setPersonName(e.target.value)}
          />
        </label>
      </div>
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Classes (none ticked: every class)</legend>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {classes.map((k) => (
            <label key={k.id} className="ep-check" htmlFor={`sg-${key}-${k.id}`}>
              <input
                id={`sg-${key}-${k.id}`}
                className="ep-check__input"
                type="checkbox"
                checked={classIds.includes(k.id)}
                onChange={(e) =>
                  setClassIds((c) =>
                    e.target.checked ? [...c, k.id] : c.filter((x) => x !== k.id),
                  )
                }
              />
              <span className="ep-check__box" aria-hidden="true" /> {k.code}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="ep-rp__row">
        <label className="ep-field">
          <span className="ep-field__label">
            {id ? 'A new image (optional)' : 'Image (PNG or JPEG, up to 300 KB)'}
          </span>
          <input
            className="ep-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {id ? (
          <label className="ep-check" htmlFor={`sg-active-${key}`} style={{ alignSelf: 'end' }}>
            <input
              id={`sg-active-${key}`}
              className="ep-check__input"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span className="ep-check__box" aria-hidden="true" /> In use
          </label>
        ) : null}
      </div>
      <div className="ep-form-actions">
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm" disabled={pending}>
          {id ? 'Save' : 'Add the signature'}
        </button>
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </form>
  );
}
