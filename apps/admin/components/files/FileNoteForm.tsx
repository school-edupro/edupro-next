'use client';
import { useState } from 'react';
import { SearchPick, type ChipOption } from '@/components/ChipPicker';
import { RichEditor } from '@/components/files/RichEditor';
import { submitFile } from '@/lib/file-movement-actions';

const MAX_FILES = 4;
const MAX_LEVELS = 5;

/**
 * The file form: the subject, the note, up to four attachments, and the approvers chosen by the person
 * raising it: level 1 is needed, levels 2 to 5 are added one by one. With `id` it corrects a file that
 * was sent back; submitting starts the approvals again from level 1.
 */
export function FileNoteForm({
  people,
  id,
  subject = '',
  bodyHtml = '',
  files = [],
  approvers = [],
}: {
  people: ChipOption[];
  id?: string;
  subject?: string;
  bodyHtml?: string;
  files?: Array<{ id: string; name: string }>;
  approvers?: string[];
}) {
  const [kept, setKept] = useState(files.map((f) => f.id));
  const [slots, setSlots] = useState(1);
  const [levels, setLevels] = useState<string[]>(approvers.length ? approvers : ['']);
  const [pending, setPending] = useState(false);
  const room = MAX_FILES - kept.length;
  const chosen = levels.filter(Boolean);
  const problem = !levels[0]
    ? 'Select the L1 approver.'
    : levels.some((l) => !l)
      ? 'Select an approver for every level added, or remove the level.'
      : new Set(chosen).size !== chosen.length
        ? 'The same person cannot approve at two levels.'
        : null;
  return (
    <form
      action={submitFile}
      className="ep-hd__form"
      onSubmit={(e) => {
        if (problem) e.preventDefault();
        else setPending(true);
      }}
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="ep-field" htmlFor="fm-subject">
        <span className="ep-field__label">
          Approval subject <span aria-hidden="true">*</span>
        </span>
        <input
          id="fm-subject"
          name="subject"
          className="ep-input"
          required
          minLength={3}
          maxLength={200}
          defaultValue={subject}
        />
      </label>
      <RichEditor
        name="bodyHtml"
        label="Approval message *"
        initial={bodyHtml}
        placeholder="Enter your approval message here…"
      />
      <fieldset className="ep-hd__form" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">
          Attachments (maximum {MAX_FILES} files) ·{' '}
          {kept.length + Math.min(slots, Math.max(0, room))}/{MAX_FILES}
        </legend>
        {files.map((f, i) =>
          kept.includes(f.id) ? (
            <div key={f.id} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <input type="hidden" name="keep" value={f.id} />
              <span>Attachment {i + 1} (already on the file)</span>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => setKept(kept.filter((x) => x !== f.id))}
                aria-label={`Remove attachment ${String(i + 1)}`}
              >
                Remove
              </button>
            </div>
          ) : null,
        )}
        {Array.from({ length: Math.min(slots, Math.max(0, room)) }, (_, i) => (
          <input
            key={String(i)}
            type="file"
            name="files"
            className="ep-input"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            aria-label={`Attachment ${String(kept.length + i + 1)}`}
          />
        ))}
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={slots >= room}
            onClick={() => setSlots(slots + 1)}
          >
            + Add attachment
          </button>{' '}
          <span className="ep-field__help">PDF or photo, up to 5 MB each.</span>
        </div>
      </fieldset>
      <fieldset className="ep-hd__form" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Approvers, in the order they approve</legend>
        {levels.map((value, n) => (
          <div key={`${String(n)}-${String(levels.length)}`} className="ep-hd__row">
            <SearchPick
              label={`L${String(n + 1)} approver`}
              required={n === 0}
              options={people.filter((p) => p.value === value || !levels.includes(p.value))}
              value={value}
              onChange={(v) => setLevels(levels.map((x, i) => (i === n ? v : x)))}
            />
            {value ? <input type="hidden" name="approverIds" value={value} /> : null}
            {n > 0 ? (
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => setLevels(levels.filter((_, i) => i !== n))}
                aria-label={`Remove level ${String(n + 1)}`}
              >
                Remove
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={levels.length >= MAX_LEVELS}
            onClick={() => setLevels([...levels, ''])}
          >
            + Add L{Math.min(MAX_LEVELS, levels.length + 1)} approver
          </button>{' '}
          <span className="ep-field__help">
            The file goes to L1 first; each level sees it after the one before approves.
          </span>
        </div>
      </fieldset>
      {problem ? (
        <p className="ep-field__error" role="status" style={{ margin: 0 }}>
          {problem}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
        <a
          className="ep-btn ep-btn--secondary"
          href={id ? `/workflow/files/${id}` : '/workflow/files'}
        >
          Close
        </a>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {id ? 'Submit again (from L1)' : 'Submit approval'}
        </button>
      </div>
    </form>
  );
}
