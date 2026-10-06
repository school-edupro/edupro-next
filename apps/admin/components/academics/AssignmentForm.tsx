'use client';
import { useRef, useState, useTransition } from 'react';
import { ChipPicker, SearchPick, fileBase64, type ChipOption } from '@/components/ChipPicker';
import {
  bulkTeacherAssignments,
  importTeacherAssignments,
  type AssignResult,
} from '@/lib/assignment-actions';

const KINDS: Array<[string, string]> = [
  ['class_teacher', 'Class teacher'],
  ['subject_teacher', 'Subject teacher'],
  ['coordinator', 'Coordinator'],
  ['indicator', 'Indicator'],
];

/**
 * Teacher assignment: the employee, the teacher type, the classes and the subjects, in one go. Every
 * class picked is saved with every subject picked. A class teacher is the actual class teacher of the
 * section when the box is ticked, else a co-class teacher. The same can be uploaded from Excel.
 */
export function AssignmentForm({
  employees,
  sections,
  subjects,
}: {
  employees: ChipOption[];
  sections: ChipOption[];
  subjects: ChipOption[];
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [kind, setKind] = useState('class_teacher');
  const [classes, setClasses] = useState<string[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [isActual, setIsActual] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [msg, setMsg] = useState<AssignResult | null>(null);
  const [busy, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const needsSubject = kind === 'subject_teacher';
  const takesSubject = kind === 'subject_teacher' || kind === 'class_teacher';
  const submit = () =>
    start(async () => {
      setMsg(null);
      if (!employeeId) return setMsg({ ok: false, error: 'Select the employee from the list.' });
      if (!classes.length) return setMsg({ ok: false, error: 'Select at least one class.' });
      if (needsSubject && !subjectIds.length)
        return setMsg({ ok: false, error: 'Select at least one subject for a subject teacher.' });
      const r = await bulkTeacherAssignments({
        employeeId,
        kind,
        classSectionIds: classes,
        subjectIds: takesSubject ? subjectIds : [],
        isActual: kind === 'class_teacher' ? isActual : true,
      });
      setMsg(r);
      if (r.ok) {
        setEmployeeId('');
        setClasses([]);
        setSubjectIds([]);
        setFormKey(formKey + 1);
      }
    });
  const upload = () =>
    start(async () => {
      const f = file.current?.files?.[0];
      if (!f) return setMsg({ ok: false, error: 'Choose the filled Excel file first.' });
      setMsg(await importTeacherAssignments(await fileBase64(f)));
      if (file.current) file.current.value = '';
    });
  return (
    <div className="ep-hd__form">
      <div className="ep-hd__row ep-hd__row--top" key={formKey}>
        <SearchPick
          label="Select employee"
          required
          options={employees}
          value={employeeId}
          onChange={setEmployeeId}
        />
        <label className="ep-field" htmlFor="ta-kind">
          <span className="ep-field__label">
            Teacher type <span aria-hidden="true">*</span>
          </span>
          <select
            id="ta-kind"
            className="ep-select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ep-hd__row ep-hd__row--top">
        <ChipPicker
          label="Select class"
          required
          options={sections}
          value={classes}
          onChange={setClasses}
        />
        {takesSubject ? (
          <ChipPicker
            label="Subject"
            required={needsSubject}
            options={subjects}
            value={subjectIds}
            onChange={setSubjectIds}
            help={
              kind === 'class_teacher'
                ? 'Optional: the subjects this class teacher also teaches in these classes.'
                : 'Every class picked is saved with every subject picked.'
            }
          />
        ) : (
          <div />
        )}
      </div>
      {kind === 'class_teacher' ? (
        <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={isActual}
            onChange={(e) => setIsActual(e.target.checked)}
          />
          <span>
            <strong>Actual class teacher</strong> (untick for a co-class teacher)
          </span>
        </label>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="ep-btn ep-btn--primary" onClick={submit} disabled={busy}>
          Submit
        </button>
        {msg ? (
          <span className={msg.ok ? 'ep-field__help' : 'ep-field__error'} role="status">
            {msg.ok ? msg.text : msg.error}
          </span>
        ) : null}
      </div>
      {msg?.ok && (msg.skipped.length || msg.errors.length) ? (
        <ul
          className={msg.errors.length ? 'ep-field__error' : 'ep-field__help'}
          style={{ margin: 0 }}
        >
          {msg.errors.slice(0, 40).map((e) => (
            <li key={`e${String(e.row)}`}>
              Row {e.row}: {e.message}
            </li>
          ))}
          {msg.skipped.slice(0, 40).map((x, i) => (
            <li key={`s${String(i)}`}>
              {x.what}: {x.why}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className="ep-filter-band"
        style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <div>
          <div className="ep-field__label">From Excel</div>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/api/academics/teacher-assignments-format"
          >
            Download the format
          </a>
        </div>
        <label className="ep-field" htmlFor="ta-file">
          <span className="ep-field__label">Filled file (.xlsx)</span>
          <input id="ta-file" ref={file} type="file" accept=".xlsx" className="ep-input" />
        </label>
        <button type="button" className="ep-btn ep-btn--secondary" onClick={upload} disabled={busy}>
          Upload
        </button>
        <span className="ep-field__help">
          Employee, Teacher type, Class and Subject are drop-downs in the format. An upload only
          adds.
        </span>
      </div>
    </div>
  );
}
