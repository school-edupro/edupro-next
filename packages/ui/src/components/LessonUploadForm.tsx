'use client';
import { useState } from 'react';
import { FilesPick } from './FilesPick';
import { RichEditor } from './RichEditor';

export interface LessonOptions {
  classes: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string }>;
  maxFiles: number;
}

/**
 * Upload Lesson: the date, whether it is for whole classes ("Master class") or for sections, the
 * classes, the topic name, the description as formatted text and the attachments. Submitting sends it
 * to the approvers.
 */
export function LessonUploadForm({
  options,
  action,
  today,
}: {
  options: LessonOptions;
  action: (fd: FormData) => void | Promise<void>;
  today: string;
}) {
  const [type, setType] = useState<'class' | 'section'>('class');
  const [picked, setPicked] = useState<string[]>([]);
  const list = type === 'class' ? options.classes : options.sections;
  return (
    <form action={action} className="ep-lesson__form">
      <div className="ep-lesson__top">
        <label className="ep-field">
          <span className="ep-field__label">Date *</span>
          <input className="ep-input" type="date" name="date" defaultValue={today} required />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Select type *</span>
          <select
            className="ep-select"
            name="targetType"
            value={type}
            onChange={(e) => {
              setType(e.target.value === 'section' ? 'section' : 'class');
              setPicked([]);
            }}
          >
            <option value="class">Master class (every section)</option>
            <option value="section">Class section</option>
          </select>
        </label>
        <fieldset className="ep-sheet__classes">
          <legend className="ep-field__label">
            {type === 'class' ? 'Master class *' : 'Class section *'}
          </legend>
          {list.length ? (
            <div className="ep-sheet__chips">
              {list.map((o) => (
                <label key={o.value} className="ep-sheet__chip">
                  <input
                    type="checkbox"
                    name={type === 'class' ? 'classIds' : 'sectionIds'}
                    value={o.value}
                    checked={picked.includes(o.value)}
                    onChange={(e) =>
                      setPicked((cur) =>
                        e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value),
                      )
                    }
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="ep-field__help">No class is assigned to you.</p>
          )}
        </fieldset>
        <label className="ep-field ep-lesson__topic">
          <span className="ep-field__label">Topic name *</span>
          <input className="ep-input" name="topic" required minLength={2} maxLength={200} />
        </label>
      </div>
      <RichEditor name="description" label="Description" />
      <FilesPick
        name="files"
        label={`Attachments (up to ${String(options.maxFiles)})`}
        max={options.maxFiles}
        accept=".pdf,.png,.jpg,.jpeg,.webp"
      />
      <div>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={picked.length === 0}>
          Submit
        </button>
        {picked.length === 0 ? (
          <span className="ep-field__help"> Tick at least one class to submit.</span>
        ) : null}
      </div>
    </form>
  );
}
