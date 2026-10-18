'use client';
import { Dialog } from '@edupro/ui';
import { useState, useTransition } from 'react';
import {
  portalMakeLogin,
  portalOpen,
  portalTargets,
  type PortalTarget,
  type PortalTargets,
} from '@/lib/portal-as';

/**
 * "Open portal as…" on a student's or an employee's page (docs/design/31-portal-view-as.md): the student
 * and each parent (or the employee) with their login; Make login for one who has none; a reason, how long,
 * and view only or acting; the portal opens in a new tab with a bar saying so.
 */
export function OpenPortalAs({
  kind,
  id,
  canMakeLogin,
}: {
  kind: 'student' | 'employee';
  id: string;
  /** may make logins (people.student.edit / people.employee.edit) */
  canMakeLogin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PortalTargets | null>(null);
  const [pick, setPick] = useState<PortalTarget | null>(null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [mode, setMode] = useState<'view' | 'act'>('view');
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await portalTargets(kind, id);
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else setError(r.error);
    });
  const show = () => {
    setOpen(true);
    setPick(null);
    setOpened(null);
    load();
  };
  const makeLogin = (t: PortalTarget) =>
    start(async () => {
      const r = await portalMakeLogin(t.personType, t.id);
      if (!r.ok) return setError(r.error);
      const again = await portalTargets(kind, id);
      if (again.ok) setData(again.data);
      setError(null);
    });
  const go = () =>
    start(async () => {
      if (!pick) return;
      if (reason.trim().length < 5) return setError('Say in a few words why (at least 5 letters).');
      const r = await portalOpen({
        personType: pick.personType,
        id: pick.id,
        mode,
        reason: reason.trim(),
        minutes,
      });
      if (!r.ok) return setError(r.error);
      // the link works once, within a minute: open it now in its own tab
      window.open(r.data.url, '_blank', 'noopener');
      setOpened(pick.name);
      setError(null);
    });

  const app = kind === 'employee' ? 'teacher app' : 'parent portal';
  return (
    <>
      <button type="button" className="ep-btn ep-btn--secondary" onClick={show}>
        {kind === 'employee' ? 'Open teacher app as…' : 'Open portal as…'}
      </button>
      {open ? (
        <Dialog
          open
          size="md"
          title={
            kind === 'employee'
              ? 'Open the teacher app as this employee'
              : 'Open the parent portal as…'
          }
          onClose={() => setOpen(false)}
          primary={
            pick && !opened ? { label: `Open ${app}`, loading: pending, onClick: go } : undefined
          }
        >
          {error ? (
            <div
              className="ep-alert ep-alert--danger"
              role="alert"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {error}
            </div>
          ) : null}
          {opened ? (
            <div className="ep-alert ep-alert--success" role="status">
              The {app} opened in a new tab as {opened}. A bar there shows it; End closes it. If no
              tab opened, allow pop-ups for this site and try again.
            </div>
          ) : !data ? (
            <p className="ep-field__help">{pending ? 'Loading…' : ''}</p>
          ) : !pick ? (
            <>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                See the {app} exactly as they do. Every opening is recorded with your reason.
              </p>
              <ul className="ep-portalas">
                {data.targets.map((t) => (
                  <li key={`${t.personType}-${t.id}`} className="ep-portalas__row">
                    <span>
                      <strong>{t.as}</strong> · {t.name}
                      <span className="ep-field__help ep-portalas__note">
                        {t.blocked ??
                          (t.hasLogin
                            ? 'Has a login'
                            : t.canMakeLogin
                              ? 'No portal login yet'
                              : 'No login, and no mobile or email to make one')}
                      </span>
                    </span>
                    {t.blocked ? null : t.hasLogin ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--primary ep-btn--sm"
                        onClick={() => {
                          setPick(t);
                          setMode('view');
                          setError(null);
                        }}
                      >
                        Open as {t.as.toLowerCase()}
                      </button>
                    ) : t.canMakeLogin && canMakeLogin ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        disabled={pending}
                        onClick={() => makeLogin(t)}
                      >
                        Make login
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{pick.as}</strong> · {pick.name}{' '}
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() => setPick(null)}
                >
                  Change
                </button>
              </p>
              <label className="ep-field" htmlFor="pa-reason">
                <span className="ep-field__label">Why *</span>
                <input
                  id="pa-reason"
                  className="ep-input"
                  value={reason}
                  maxLength={500}
                  placeholder="e.g. Parent called: the fee page is blank"
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className="ep-field" htmlFor="pa-minutes">
                <span className="ep-field__label">For</span>
                <select
                  id="pa-minutes"
                  className="ep-select"
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                </select>
              </label>
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">What you may do</legend>
                <label className="ep-check">
                  <input
                    type="radio"
                    name="pa-mode"
                    checked={mode === 'view'}
                    onChange={() => setMode('view')}
                  />{' '}
                  View only: look around; nothing can be sent or changed
                </label>
                {data.modes.act ? (
                  <label className="ep-check">
                    <input
                      type="radio"
                      name="pa-mode"
                      checked={mode === 'act'}
                      onChange={() => setMode('act')}
                    />{' '}
                    Act for them: fill and send forms in their name (no payments); recorded as done
                    by you
                  </label>
                ) : null}
              </fieldset>
            </>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
