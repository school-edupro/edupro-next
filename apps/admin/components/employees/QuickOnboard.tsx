'use client';
import { useState, useTransition } from 'react';
import { ProfileField } from '@/components/ProfileField';
import type { EmployeeCatalogue, OnboardResult } from '@/lib/employee';
import type { ProfileValues } from '@/lib/profile';

/**
 * Quick onboarding (docs/design/30-employee-master.md): the minimum fields (the code filled with the
 * next one), a staff login by a tick, and after saving a link to the full profile or "add another".
 */
export function QuickOnboard({
  catalogue,
  onboard,
}: {
  catalogue: EmployeeCatalogue;
  onboard: (values: ProfileValues, createLogin: boolean) => Promise<OnboardResult>;
}) {
  const fields = catalogue.quickAdd
    .map((k) => catalogue.fields.find((f) => f.key === k))
    .filter((f): f is EmployeeCatalogue['fields'][number] => Boolean(f));
  const blank = (): ProfileValues => ({ employee_code: catalogue.nextCode });
  const [values, setValues] = useState<ProfileValues>(blank);
  const [login, setLogin] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<OnboardResult, { ok: true }> | null>(null);
  const [name, setName] = useState('');
  const [pending, start] = useTransition();

  if (done)
    return (
      <div
        className="ep-card"
        style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}
      >
        <p className="ep-alert ep-alert--success" role="status" style={{ margin: 0 }}>
          {name} is onboarded with the code <strong>{done.code}</strong>.
          {done.login.made
            ? ' A staff login is made: they sign in with a code sent to their mobile or email.'
            : login
              ? ` No login was made (${done.login.reason ?? 'not possible'}); make one from the profile.`
              : ''}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <a className="ep-btn ep-btn--primary" href={`/people/employees/${done.id}`}>
            Complete the profile
          </a>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() => {
              // the next code: the one just used plus one
              const m = /^(.*?)(\d+)$/.exec(done.code);
              const next = m
                ? `${m[1]!}${String(Number(m[2]!) + 1).padStart(m[2]!.length, '0')}`
                : '';
              setValues({ employee_code: next });
              setErrors({});
              setDone(null);
            }}
          >
            Onboard another
          </button>
        </div>
      </div>
    );

  return (
    <form
      className="ep-card"
      style={{ padding: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-4)' }}
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        start(async () => {
          const r = await onboard(values, login);
          if (r.ok) {
            setName([values.first_name, values.last_name].filter(Boolean).join(' ').toUpperCase());
            setDone(r);
          } else {
            setErrors(r.errors);
            setProblem(r.detail);
            const first = Object.keys(r.errors)[0];
            if (first) setTimeout(() => document.getElementById(`pf-${first}`)?.focus(), 30);
          }
        });
      }}
    >
      {problem ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
          {problem}
        </p>
      ) : null}
      <div className="ep-profile__grid">
        {fields.map((f) => (
          <ProfileField
            key={f.key}
            field={{
              ...f,
              help:
                f.key === 'employee_code'
                  ? 'Filled with the next number; you may type another.'
                  : f.help,
              // the minimum to start: these are needed now
              required:
                f.required ||
                [
                  'gender',
                  'mobile',
                  'staff_type',
                  'department',
                  'designation',
                  'joined_on',
                ].includes(f.key),
            }}
            values={values}
            geography={catalogue.geography}
            error={errors[f.key]}
            onChange={(key, v) => {
              setValues((p) => ({ ...p, [key]: v }));
              setErrors((p) => {
                if (!p[key]) return p;
                const n = { ...p };
                delete n[key];
                return n;
              });
            }}
          />
        ))}
      </div>
      <label className="ep-check">
        <input
          type="checkbox"
          className="ep-check__input"
          checked={login}
          onChange={(e) => setLogin(e.target.checked)}
        />
        <span className="ep-check__box" aria-hidden="true" />
        <span className="ep-check__text">
          Create a staff login (sign-in by a code to the mobile or email; teaching staff get the
          Subject Teacher role)
        </span>
      </label>
      <div>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : 'Onboard'}
        </button>
      </div>
    </form>
  );
}
