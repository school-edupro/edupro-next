'use client';
import { Dialog } from '@edupro/ui';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  portalMakeLogin,
  portalOpen,
  portalTargets,
  type PortalTarget,
  type PortalTargets,
} from '@/lib/portal-as';

const APP_LABEL: Record<PortalTarget['app'], string> = {
  parent: 'parent portal',
  teacher: 'teacher app',
  admin: 'admin app',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Open portal as…" on a student's page and "Open as…" on an employee's page
 * (docs/design/31-portal-view-as.md): the student and each parent (or the employee, for the teacher app
 * and for the admin app, 0188) with their login; Make login for one who has none; a reason, how long, and
 * view only or acting. A portal opens in a new tab with a bar saying so; the admin app opens in this
 * very tab (the session becomes theirs) and End in its bar brings the admin back here.
 */
export function OpenPortalAs({
  kind,
  id,
  canMakeLogin,
  autoOpen = false,
  returnTo,
}: {
  kind: 'student' | 'employee';
  id: string;
  /** may make logins (people.student.edit / people.employee.edit) */
  canMakeLogin: boolean;
  /** open the dialog at once (the list's row menu links here with ?openAs=1) */
  autoOpen?: boolean;
  /** where End returns to after the admin app was opened as them (this page) */
  returnTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PortalTargets | null>(null);
  const [pick, setPick] = useState<PortalTarget | null>(null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [mode, setMode] = useState<'view' | 'act'>('view');
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ name: string; app: PortalTarget['app'] } | null>(null);
  const [pending, start] = useTransition();
  const auto = useRef(false);

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
  useEffect(() => {
    if (autoOpen && !auto.current) {
      auto.current = true;
      show();
    }
    // once, on arrival with ?openAs=1
  }, [autoOpen]);
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
        app: pick.app,
        mode,
        reason: reason.trim(),
        minutes,
        returnTo,
      });
      if (!r.ok) return setError(r.error);
      setError(null);
      setOpened({ name: pick.name, app: pick.app });
      if (r.data.inPlace) {
        // this session is now theirs: reload as them
        window.location.assign(r.data.url);
        return;
      }
      // the link works once, within a minute: open it now in its own tab
      window.open(r.data.url, '_blank', 'noopener');
    });

  const employee = kind === 'employee';
  const appOf = (t: PortalTarget) => APP_LABEL[t.app];
  const headOf = (t: PortalTarget) => (employee ? cap(appOf(t)) : t.as);
  return (
    <>
      <button type="button" className="ep-btn ep-btn--secondary" onClick={show}>
        {employee ? 'Open as…' : 'Open portal as…'}
      </button>
      {open ? (
        <Dialog
          open
          size="md"
          title={employee ? 'Open an app as this employee' : 'Open the parent portal as…'}
          onClose={() => setOpen(false)}
          primary={
            pick && !opened
              ? { label: `Open ${appOf(pick)}`, loading: pending, onClick: go }
              : undefined
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
              {opened.app === 'admin'
                ? `Opening the admin app as ${opened.name} in this tab… The bar at the top says so; End brings you back to this page.`
                : `The ${APP_LABEL[opened.app]} opened in a new tab as ${opened.name}. A bar there shows it; End closes it. If no tab opened, allow pop-ups for this site and try again.`}
            </div>
          ) : !data ? (
            <p className="ep-field__help">{pending ? 'Loading…' : ''}</p>
          ) : !pick ? (
            <>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {employee
                  ? 'See the teacher app or this admin app exactly as they do. Every opening is recorded with your reason.'
                  : 'See the parent portal exactly as they do. Every opening is recorded with your reason.'}
              </p>
              <ul className="ep-portalas">
                {data.targets.map((t) => (
                  <li key={`${t.personType}-${t.id}-${t.app}`} className="ep-portalas__row">
                    <span>
                      <strong>{headOf(t)}</strong> · {t.name}
                      <span className="ep-field__help ep-portalas__note">
                        {t.blocked ??
                          (t.hasLogin
                            ? t.app === 'admin'
                              ? 'Has a login · opens in this tab; End brings you back'
                              : 'Has a login'
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
                        {employee ? `Open ${appOf(t)}` : `Open as ${t.as.toLowerCase()}`}
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
                <strong>{headOf(pick)}</strong> · {pick.name}{' '}
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() => setPick(null)}
                >
                  Change
                </button>
              </p>
              {pick.app === 'admin' ? (
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  This tab becomes the admin app as them, with what their roles allow. End in the
                  bar at the top brings you back to this page as yourself.
                </p>
              ) : null}
              <label className="ep-field" htmlFor="pa-reason">
                <span className="ep-field__label">Why *</span>
                <input
                  id="pa-reason"
                  className="ep-input"
                  value={reason}
                  maxLength={500}
                  placeholder={
                    employee
                      ? 'e.g. They say the fee counter shows no classes'
                      : 'e.g. Parent called: the fee page is blank'
                  }
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
                    {pick.app === 'admin'
                      ? 'Act for them: do their work in their name (no payments, no sign-in settings, no sessions as others); recorded as done by you'
                      : 'Act for them: fill and send forms in their name (no payments); recorded as done by you'}
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
