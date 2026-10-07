'use client';
import { useState } from 'react';

export interface ClassSectionOption {
  classSectionId: string;
  section: string;
  classId: string;
  className: string;
}

/**
 * Pick the class first; every section of it the user may post for comes ticked, and one can be unticked.
 * `whole` adds "Whole school" (no class: the magazine, the almanac), for the office.
 */
export function ClassSectionPicker({
  name,
  options,
  whole = false,
  label = 'Class',
}: {
  name: string;
  options: ClassSectionOption[];
  whole?: boolean;
  label?: string;
}) {
  const classes = [...new Map(options.map((o) => [o.classId, o.className])).entries()];
  const [classId, setClassId] = useState(!whole && classes.length === 1 ? classes[0]![0] : '');
  const [off, setOff] = useState<string[]>([]);
  const sections = options.filter((o) => o.classId === classId);
  return (
    <div className="ep-sheet__filter" style={{ marginBottom: 0 }}>
      <label className="ep-field">
        <span className="ep-field__label">{label} *</span>
        <select
          className="ep-select"
          value={classId}
          required={!whole}
          onChange={(e) => {
            setClassId(e.target.value);
            setOff([]);
          }}
        >
          <option value="">{whole ? 'Whole school' : 'Select a class'}</option>
          {classes.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {sections.length ? (
        <fieldset className="ep-sheet__classes">
          <legend className="ep-field__label">Sections (untick one to leave it out)</legend>
          <div className="ep-sheet__chips">
            {sections.map((o) => (
              <label key={o.classSectionId} className="ep-sheet__chip">
                <input
                  type="checkbox"
                  name={name}
                  value={o.classSectionId}
                  checked={!off.includes(o.classSectionId)}
                  onChange={(e) =>
                    setOff((cur) =>
                      e.target.checked
                        ? cur.filter((x) => x !== o.classSectionId)
                        : [...cur, o.classSectionId],
                    )
                  }
                />
                <span>{o.section}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
