'use client';
import type { Rule, RuleOptions } from '@/lib/comms';
import { CheckList } from './CheckList';

const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }));

/**
 * Master-wise selection: students by class, section, house, category, gender, stream, religion and
 * transport route; employees by department, designation and type. Empty filters mean "all".
 */
export function RuleBuilder({
  id,
  value,
  onChange,
  options,
  classes,
  sections,
  people,
}: {
  id: string;
  value: Rule;
  onChange: (r: Rule) => void;
  options: RuleOptions;
  classes: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string; classId?: string }>;
  /** fixed for groups of one kind; chosen in compose */
  people?: 'students' | 'employees' | 'both';
}) {
  const who = people ?? value.people ?? 'students';
  const set = (k: keyof Rule, v: string[]) => onChange({ ...value, [k]: v.length ? v : undefined });
  const shownSections = value.classIds?.length
    ? sections.filter((s) => !s.classId || value.classIds!.includes(s.classId))
    : sections;
  return (
    <div className="ep-rule">
      {!people ? (
        <fieldset className="ep-rule__who">
          <legend className="ep-field__label">Who</legend>
          {(
            [
              ['students', 'Students'],
              ['employees', 'Employees'],
              ['both', 'Both'],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="ep-roles__tick" htmlFor={`${id}-who-${v}`}>
              <input
                id={`${id}-who-${v}`}
                type="radio"
                name={`${id}-who`}
                checked={who === v}
                onChange={() => onChange({ ...value, people: v })}
              />{' '}
              {l}
            </label>
          ))}
        </fieldset>
      ) : null}
      {who !== 'employees' ? (
        <div className="ep-rule__grid">
          <CheckList
            id={`${id}-cls`}
            legend="Classes"
            options={classes}
            value={value.classIds ?? []}
            onChange={(v) => set('classIds', v)}
          />
          <CheckList
            id={`${id}-sec`}
            legend="Sections"
            options={shownSections}
            value={value.sectionIds ?? []}
            onChange={(v) => set('sectionIds', v)}
          />
          <CheckList
            id={`${id}-house`}
            legend="House"
            options={opts(options.houses)}
            value={value.houses ?? []}
            onChange={(v) => set('houses', v)}
            empty="No houses on file."
          />
          <CheckList
            id={`${id}-cat`}
            legend="Category"
            options={opts(options.categories)}
            value={value.categories ?? []}
            onChange={(v) => set('categories', v)}
            empty="No categories on file."
          />
          <CheckList
            id={`${id}-gender`}
            legend="Gender"
            options={options.genders.map((g) => ({
              value: g,
              label: g[0]!.toUpperCase() + g.slice(1),
            }))}
            value={value.genders ?? []}
            onChange={(v) => set('genders', v)}
          />
          <CheckList
            id={`${id}-stream`}
            legend="Stream (XI–XII)"
            options={opts(options.streams)}
            value={value.streams ?? []}
            onChange={(v) => set('streams', v)}
            empty="No streams on file."
          />
          <CheckList
            id={`${id}-rel`}
            legend="Religion"
            options={opts(options.religions)}
            value={value.religions ?? []}
            onChange={(v) => set('religions', v)}
            empty="No religions on file."
          />
          <CheckList
            id={`${id}-route`}
            legend="Transport route"
            options={options.routes.map((r) => ({ value: r.id, label: r.label }))}
            value={value.routeIds ?? []}
            onChange={(v) => set('routeIds', v)}
            empty="No routes."
          />
        </div>
      ) : null}
      {who !== 'students' ? (
        <div className="ep-rule__grid">
          <CheckList
            id={`${id}-dept`}
            legend="Department"
            options={opts(options.departments)}
            value={value.departments ?? []}
            onChange={(v) => set('departments', v)}
            empty="No departments on file."
          />
          <CheckList
            id={`${id}-desig`}
            legend="Designation"
            options={opts(options.designations)}
            value={value.designations ?? []}
            onChange={(v) => set('designations', v)}
            empty="No designations on file."
          />
          <CheckList
            id={`${id}-etype`}
            legend="Employee type"
            options={opts(options.employeeTypes)}
            value={value.employeeTypes ?? []}
            onChange={(v) => set('employeeTypes', v)}
          />
        </div>
      ) : null}
      <p className="ep-field__help">Nothing ticked in a list means everyone for that list.</p>
    </div>
  );
}
