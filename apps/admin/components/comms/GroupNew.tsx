'use client';
import { useState } from 'react';
import { createGroupV2 } from '@/lib/comms-actions';
import { KIND_LABEL, type GroupKind, type Rule, type RuleOptions } from '@/lib/comms';
import { RuleBuilder } from './RuleBuilder';

const KINDS: Array<{ id: Exclude<GroupKind, 'mixed'>; help: string }> = [
  {
    id: 'student',
    help: 'Students (their parents receive messages, or the student, as you choose when sending)',
  },
  { id: 'employee', help: 'Teaching and non-teaching staff' },
  {
    id: 'student_teacher',
    help: 'Students and teachers together, e.g. a club, PTA or house committee',
  },
  { id: 'external', help: 'People outside the school from an Excel list (name, mobile, email)' },
];

const codeOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** New group: kind, kept by hand / Excel or following a master-wise rule. */
export function GroupNew({
  options,
  classes,
  sections,
}: {
  options: RuleOptions;
  classes: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string; classId?: string }>;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<Exclude<GroupKind, 'mixed'>>('student');
  const [mode, setMode] = useState<'static' | 'rule'>('static');
  const [rule, setRule] = useState<Rule>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ruleAllowed = kind !== 'external';
  return (
    <form
      className="ep-grpnew"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await createGroupV2({
          code: code || codeOf(name),
          name,
          description: description || undefined,
          kind,
          mode: ruleAllowed ? mode : 'static',
          ...(ruleAllowed && mode === 'rule' ? { rule } : {}),
        });
        setBusy(false);
        if (r.ok) window.location.href = `/comms/groups/${r.data.id}?ok=1`;
        else setError([r.error, ...(r.errors ?? [])].join(' · '));
      }}
    >
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ep-wd__form">
        <label className="ep-field ep-wd__wide" htmlFor="g-name">
          <span className="ep-field__label">Group name *</span>
          <input
            id="g-name"
            className="ep-input"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!touched) setCode(codeOf(e.target.value));
            }}
            placeholder="e.g. Class XII board students, Transport staff, PTA 2026"
          />
        </label>
        <label className="ep-field" htmlFor="g-code">
          <span className="ep-field__label">Code *</span>
          <input
            id="g-code"
            className="ep-input"
            required
            pattern="[a-z0-9_\-]{2,40}"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toLowerCase());
              setTouched(true);
            }}
          />
        </label>
        <label className="ep-field ep-wd__wide" htmlFor="g-desc">
          <span className="ep-field__label">Description</span>
          <input
            id="g-desc"
            className="ep-input"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
      <fieldset className="ep-compose__aud" aria-label="Kind of group">
        <legend className="ep-field__label">Kind</legend>
        {KINDS.map((k) => (
          <label
            key={k.id}
            className="ep-compose__audopt"
            data-on={kind === k.id ? 'true' : undefined}
            htmlFor={`g-kind-${k.id}`}
          >
            <input
              id={`g-kind-${k.id}`}
              type="radio"
              name="g-kind"
              checked={kind === k.id}
              onChange={() => setKind(k.id)}
            />
            <span>
              <strong>{KIND_LABEL[k.id]}</strong>
              <span className="ep-field__help">{k.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {ruleAllowed ? (
        <fieldset className="ep-compose__sendto">
          <legend className="ep-field__label">Members</legend>
          <label className="ep-roles__tick" htmlFor="g-mode-static">
            <input
              id="g-mode-static"
              type="radio"
              name="g-mode"
              checked={mode === 'static'}
              onChange={() => setMode('static')}
            />{' '}
            Chosen by hand or uploaded from Excel
          </label>
          <label className="ep-roles__tick" htmlFor="g-mode-rule">
            <input
              id="g-mode-rule"
              type="radio"
              name="g-mode"
              checked={mode === 'rule'}
              onChange={() => setMode('rule')}
            />{' '}
            Follow a rule (updates itself with admissions and leavers)
          </label>
        </fieldset>
      ) : null}
      {ruleAllowed && mode === 'rule' ? (
        <RuleBuilder
          id="g-rule"
          value={rule}
          onChange={setRule}
          options={options}
          classes={classes}
          sections={sections}
          people={kind === 'student' ? 'students' : kind === 'employee' ? 'employees' : 'both'}
        />
      ) : null}
      <div className="ep-wdset__actions">
        <button type="submit" className="ep-btn ep-btn--primary" disabled={busy || !name}>
          {busy ? 'Creating…' : 'Create group'}
        </button>
      </div>
    </form>
  );
}
