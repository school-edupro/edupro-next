'use client';
import { useMemo, useState } from 'react';
import {
  FIELD_PREFIX,
  NO_DEPT,
  type BulkClasses,
  type BulkDepartments,
  type CertificateFieldSpec,
} from '@/lib/certificates';

export interface PickerType {
  code: string;
  name: string;
  audience: 'STUDENT' | 'STAFF';
  fields: CertificateFieldSpec[];
}

/**
 * Bulk issue's "who" (16 Nov 2026): the certificate, then — a student type — classes and sections in one tick list (a
 * class ticks all its sections; "All classes"; a search; the students in each) or the leavers, or — a staff type —
 * departments in one tick list (employees in service or who have left). Posts as a GET form: type, scope, section,
 * dept, state, purpose and the type's fields.
 */
export function BulkScopePicker({
  types,
  classes,
  departments,
  max,
  initial,
}: {
  types: PickerType[];
  classes: BulkClasses['classes'];
  departments: BulkDepartments['departments'];
  max: number;
  initial: {
    type: string;
    scope: string;
    sections: string[];
    depts: string[];
    state: 'active' | 'left';
    purpose: string;
    fields: Record<string, string>;
  };
}) {
  const [type, setType] = useState(initial.type);
  const t = types.find((x) => x.code === type) ?? null;
  const staff = t?.audience === 'STAFF';
  const [leavers, setLeavers] = useState(initial.scope === 'leavers');
  const [sections, setSections] = useState(new Set(initial.sections));
  const [depts, setDepts] = useState(new Set(initial.depts));
  const [state, setState] = useState<'active' | 'left'>(initial.state);
  const [q, setQ] = useState('');

  const k = q.trim().toLowerCase();
  const shownClasses = useMemo(
    () =>
      classes.filter(
        (c) =>
          !k ||
          c.name.toLowerCase().includes(k) ||
          c.sections.some((s) => `${c.name} ${s.name}`.toLowerCase().includes(k)),
      ),
    [classes, k],
  );
  const shownDepts = useMemo(
    () => departments.filter((d) => !k || (d.name || 'no department').toLowerCase().includes(k)),
    [departments, k],
  );
  const allSections = classes.flatMap((c) => c.sections.map((s) => s.id));
  const pickedStudents = classes
    .flatMap((c) => c.sections)
    .filter((s) => sections.has(s.id))
    .reduce((n, s) => n + s.students, 0);
  const deptKey = (name: string) => name || NO_DEPT;
  const deptCount = (d: BulkDepartments['departments'][number]) =>
    state === 'left' ? d.left : d.active;
  const pickedEmployees = departments
    .filter((d) => depts.has(deptKey(d.name)))
    .reduce((n, d) => n + deptCount(d), 0);

  const toggleSections = (ids: string[], on: boolean) =>
    setSections((cur) => {
      const n = new Set(cur);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const toggleDepts = (keys: string[], on: boolean) =>
    setDepts((cur) => {
      const n = new Set(cur);
      for (const x of keys) {
        if (on) n.add(x);
        else n.delete(x);
      }
      return n;
    });

  const nothing = !t || (staff ? !depts.size : !leavers && !sections.size);
  const tooMany = staff ? pickedEmployees > max : !leavers && pickedStudents > max;

  return (
    <form method="get" className="ep-bulk">
      <div className="ep-cert-fields">
        <label className="ep-field" htmlFor="bkType">
          <span className="ep-field__label">Certificate</span>
          <select
            id="bkType"
            name="type"
            className="ep-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Choose…</option>
            {types.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
                {x.audience === 'STAFF' ? ' (staff)' : ''}
              </option>
            ))}
          </select>
        </label>
        {t ? (
          <fieldset className="ep-radio-group" data-inline="true">
            <legend className="ep-field__label">To</legend>
            {staff ? (
              <>
                <input type="hidden" name="scope" value="departments" />
                {(['active', 'left'] as const).map((v) => (
                  <label key={v} className="ep-radio" htmlFor={`bkState_${v}`}>
                    <input
                      id={`bkState_${v}`}
                      type="radio"
                      name="state"
                      value={v}
                      className="ep-radio__input"
                      checked={state === v}
                      onChange={() => setState(v)}
                    />
                    <span className="ep-radio__dot" />
                    {v === 'active' ? 'Employees in service' : 'Those who have left'}
                  </label>
                ))}
              </>
            ) : (
              (['sections', 'leavers'] as const).map((v) => (
                <label key={v} className="ep-radio" htmlFor={`bkScope_${v}`}>
                  <input
                    id={`bkScope_${v}`}
                    type="radio"
                    name="scope"
                    value={v}
                    className="ep-radio__input"
                    checked={v === 'leavers' ? leavers : !leavers}
                    onChange={() => setLeavers(v === 'leavers')}
                  />
                  <span className="ep-radio__dot" />
                  {v === 'sections'
                    ? 'Classes and sections (students on the rolls)'
                    : 'The leavers (withdrawal cleared, no TC yet)'}
                </label>
              ))
            )}
          </fieldset>
        ) : null}
      </div>

      {t && (staff || !leavers) ? (
        <section className="ep-bulk__pick" aria-labelledby="bkPickTitle">
          <div className="ep-bulk__pickhead">
            <h3 id="bkPickTitle" className="ep-tpl__h">
              {staff ? 'Departments' : 'Classes and sections'}
            </h3>
            <label className="ep-field" htmlFor="bkFind" style={{ margin: 0 }}>
              <span className="ep-sr-only">
                {staff ? 'Find a department' : 'Find a class or section'}
              </span>
              <input
                id="bkFind"
                type="search"
                className="ep-input"
                placeholder={staff ? 'Find a department…' : 'Find a class or section…'}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
          {staff ? (
            <ul className="ep-bulk__list">
              <li className="ep-bulk__all">
                <label className="ep-check" htmlFor="bkAllDepts">
                  <input
                    id="bkAllDepts"
                    type="checkbox"
                    className="ep-check__input"
                    checked={departments.length > 0 && depts.size === departments.length}
                    onChange={(e) =>
                      toggleDepts(
                        departments.map((d) => deptKey(d.name)),
                        e.target.checked,
                      )
                    }
                  />
                  <span className="ep-check__box" />
                  All departments
                </label>
                <span className="ep-bulk__n">
                  {String(departments.reduce((n, d) => n + deptCount(d), 0))}
                </span>
              </li>
              {shownDepts.map((d) => (
                <li key={deptKey(d.name)}>
                  <label className="ep-check" htmlFor={`bkDept_${deptKey(d.name)}`}>
                    <input
                      id={`bkDept_${deptKey(d.name)}`}
                      type="checkbox"
                      name="dept"
                      value={deptKey(d.name)}
                      className="ep-check__input"
                      checked={depts.has(deptKey(d.name))}
                      onChange={(e) => toggleDepts([deptKey(d.name)], e.target.checked)}
                    />
                    <span className="ep-check__box" />
                    {d.name || 'No department'}
                  </label>
                  <span className="ep-bulk__n">{String(deptCount(d))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="ep-bulk__list">
              <li className="ep-bulk__all">
                <label className="ep-check" htmlFor="bkAllClasses">
                  <input
                    id="bkAllClasses"
                    type="checkbox"
                    className="ep-check__input"
                    checked={allSections.length > 0 && sections.size === allSections.length}
                    onChange={(e) => toggleSections(allSections, e.target.checked)}
                  />
                  <span className="ep-check__box" />
                  All classes
                </label>
                <span className="ep-bulk__n">
                  {String(classes.reduce((n, c) => n + c.students, 0))}
                </span>
              </li>
              {shownClasses.map((c) => {
                const ids = c.sections.map((s) => s.id);
                const on = ids.filter((id) => sections.has(id)).length;
                return (
                  <li key={c.id} className="ep-bulk__class">
                    <div className="ep-bulk__row">
                      <label className="ep-check" htmlFor={`bkClass_${c.id}`}>
                        <input
                          id={`bkClass_${c.id}`}
                          type="checkbox"
                          className="ep-check__input"
                          checked={on > 0 && on === ids.length}
                          ref={(el) => {
                            if (el) el.indeterminate = on > 0 && on < ids.length;
                          }}
                          onChange={(e) => toggleSections(ids, e.target.checked)}
                        />
                        <span className="ep-check__box" />
                        <strong>{c.name}</strong>
                      </label>
                      <span className="ep-bulk__n">{String(c.students)}</span>
                    </div>
                    <div className="ep-bulk__sections">
                      {c.sections.map((s) => (
                        <label key={s.id} className="ep-check" htmlFor={`bkSec_${s.id}`}>
                          <input
                            id={`bkSec_${s.id}`}
                            type="checkbox"
                            name="section"
                            value={s.id}
                            className="ep-check__input"
                            checked={sections.has(s.id)}
                            onChange={(e) => toggleSections([s.id], e.target.checked)}
                          />
                          <span className="ep-check__box" />
                          {s.name} <span className="ep-bulk__n">({String(s.students)})</span>
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="ep-bulk__sum" role="status" aria-live="polite">
            {staff
              ? `Chosen: ${String(depts.size)} department${depts.size === 1 ? '' : 's'} · ${String(pickedEmployees)} employee${pickedEmployees === 1 ? '' : 's'}`
              : `Chosen: ${String(sections.size)} section${sections.size === 1 ? '' : 's'} · ${String(pickedStudents)} student${pickedStudents === 1 ? '' : 's'}`}
            {tooMany ? ` — at most ${String(max)} at a time: choose fewer` : ''}
          </p>
        </section>
      ) : null}

      {t ? (
        <div className="ep-cert-fields">
          <label className="ep-field" htmlFor="bkPurpose">
            <span className="ep-field__label">Purpose (printed, optional)</span>
            <input
              id="bkPurpose"
              name="purpose"
              className="ep-input"
              defaultValue={initial.purpose}
              maxLength={200}
            />
          </label>
          {t.fields.map((f) => (
            <label key={f.key} className="ep-field" htmlFor={`${FIELD_PREFIX}${f.key}`}>
              <span className="ep-field__label">
                {f.label}
                {f.required ? ' *' : ''} (the same for all)
              </span>
              {f.kind === 'list' ? (
                <select
                  id={`${FIELD_PREFIX}${f.key}`}
                  name={`${FIELD_PREFIX}${f.key}`}
                  className="ep-select"
                  defaultValue={initial.fields[f.key] ?? ''}
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${FIELD_PREFIX}${f.key}`}
                  name={`${FIELD_PREFIX}${f.key}`}
                  className="ep-input"
                  type={f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'}
                  defaultValue={initial.fields[f.key] ?? ''}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div>
        <button type="submit" className="ep-btn ep-btn--secondary" disabled={nothing || tooMany}>
          Preview
        </button>
      </div>
    </form>
  );
}
