'use client';
import { useState } from 'react';

export interface StrengthOptions {
  reports: Array<{ id: string; title: string }>;
  academicYearId: string | null;
  years: Array<{ id: string; code: string; status: string }>;
  classes: Array<{ id: string; code: string; sections: Array<{ id: string; name: string }> }>;
  discounts: Array<{ id: string; name: string }>;
}

/**
 * Filters of a strength report: session, classes ("master") and the sections of the chosen classes,
 * grouping, left students, empty sections, the as-on date (age) and the discount (discount report).
 * Plain GET form: the URL carries the filters, so a report can be bookmarked or shared.
 */
export function StrengthFilters({
  options,
  report,
  values,
}: {
  options: StrengthOptions;
  report: string;
  values: {
    academicYearId?: string;
    classIds: string[];
    sectionIds: string[];
    groupBy: string;
    includeLeft: boolean;
    showEmpty: boolean;
    asOn?: string;
    discountId?: string;
  };
}) {
  const [classIds, setClassIds] = useState<string[]>(values.classIds);
  const [sectionIds, setSectionIds] = useState<string[]>(values.sectionIds);
  const [groupBy, setGroupBy] = useState(values.groupBy);
  const shown = options.classes.filter((c) => !classIds.length || classIds.includes(c.id));
  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
  return (
    <form method="get" className="ep-strength__filters">
      <input type="hidden" name="report" value={report} />
      <input type="hidden" name="run" value="1" />
      <input type="hidden" name="classIds" value={classIds.join(',')} />
      <input
        type="hidden"
        name="sectionIds"
        value={sectionIds
          .filter((s) => shown.some((c) => c.sections.some((x) => x.id === s)))
          .join(',')}
      />
      <div className="ep-wd__form">
        <label className="ep-field" htmlFor="sf-year">
          <span className="ep-field__label">Session</span>
          <select
            id="sf-year"
            name="academicYearId"
            className="ep-select"
            defaultValue={values.academicYearId ?? options.academicYearId ?? ''}
          >
            {options.years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
                {y.status === 'active' ? ' · current' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="sf-group">
          <span className="ep-field__label">Group by</span>
          <select
            id="sf-group"
            name="groupBy"
            className="ep-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            <option value="section">Section (with class totals)</option>
            <option value="class_stream">Class (XI–XII by stream)</option>
            <option value="class">Class</option>
          </select>
        </label>
        {report === 'age' ? (
          <label className="ep-field" htmlFor="sf-ason">
            <span className="ep-field__label">Age as on *</span>
            <input
              id="sf-ason"
              name="asOn"
              type="date"
              className="ep-input"
              required
              defaultValue={values.asOn ?? ''}
            />
          </label>
        ) : null}
        {report === 'discount' ? (
          <label className="ep-field" htmlFor="sf-discount">
            <span className="ep-field__label">Discount *</span>
            <select
              id="sf-discount"
              name="discountId"
              className="ep-select"
              required
              defaultValue={values.discountId ?? ''}
            >
              <option value="">Choose…</option>
              {options.discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-roles__tick" htmlFor="sf-left">
          <input
            id="sf-left"
            type="checkbox"
            name="includeLeft"
            value="true"
            defaultChecked={values.includeLeft}
          />{' '}
          Include students who left
        </label>
        {groupBy === 'section' ? (
          <label className="ep-roles__tick" htmlFor="sf-empty">
            <input
              id="sf-empty"
              type="checkbox"
              name="showEmpty"
              value="true"
              defaultChecked={values.showEmpty}
            />{' '}
            Show empty sections
          </label>
        ) : null}
      </div>
      <fieldset className="ep-wd__pick">
        <legend>Classes (none ticked = all)</legend>
        <ul className="ep-strength__checks">
          {options.classes.map((c) => (
            <li key={c.id}>
              <label className="ep-roles__tick" htmlFor={`sf-c-${c.id}`}>
                <input
                  id={`sf-c-${c.id}`}
                  type="checkbox"
                  checked={classIds.includes(c.id)}
                  onChange={(e) => setClassIds(toggle(classIds, c.id, e.target.checked))}
                />{' '}
                {c.code}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset className="ep-wd__pick">
        <legend>Sections (none ticked = all of the classes above)</legend>
        <ul className="ep-strength__checks">
          {shown.flatMap((c) =>
            c.sections.map((s) => (
              <li key={s.id}>
                <label className="ep-roles__tick" htmlFor={`sf-s-${s.id}`}>
                  <input
                    id={`sf-s-${s.id}`}
                    type="checkbox"
                    checked={sectionIds.includes(s.id)}
                    onChange={(e) => setSectionIds(toggle(sectionIds, s.id, e.target.checked))}
                  />{' '}
                  {c.code}-{s.name}
                </label>
              </li>
            )),
          )}
        </ul>
      </fieldset>
      <div className="ep-wdset__actions">
        <button type="submit" className="ep-btn ep-btn--primary">
          Show report
        </button>
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/reports/strength?report=${report}`}>
          Clear filters
        </a>
      </div>
    </form>
  );
}
