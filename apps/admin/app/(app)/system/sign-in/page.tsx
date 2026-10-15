import { Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { forgetDevices, saveSignIn } from '@/lib/sign-in-actions';

interface Setting {
  key: string;
  value: unknown;
}
interface Log {
  shown: Array<{
    shownAt: string;
    displayName: string;
    app: string;
    purpose: string;
    sentTo: string | null;
    ip: string | null;
  }>;
  noEmail: Array<{
    id: string;
    displayName: string;
    email: string | null;
    mobile: string | null;
    personType: string;
  }>;
}

const MODES = [
  ['oneauth', 'One Auth only', 'As before: the One Auth sign-in.'],
  [
    'oneauth_otp',
    'One Auth, then a code by email',
    'After One Auth, a 6-digit code is mailed to the user. Two steps: the safest.',
  ],
  [
    'otp',
    'A code by email alone',
    'The user types the email or mobile number and gets a 6-digit code; One Auth still works and also asks the code.',
  ],
] as const;
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/**
 * System -> Sign-in (0136): the school's sign-in rule, the code on screen while emails are corrected,
 * the users who have no valid email, the codes shown on screen, and forgetting remembered devices.
 */
export default async function SignInSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canEdit = me.permissions.includes('platform.settings.edit');
  const [settings, log, waTemplates, smsTemplates] = await Promise.all([
    apiFetch<{ data: Setting[] }>('/platform/settings').then((r) => r.data),
    apiFetch<Log>('/auth/otp/screen-log'),
    // only templates that can be sent: WhatsApp with the approved name, SMS with the DLT id
    apiFetch<{ data: Array<{ id: string; name: string; waTemplateName: string | null }> }>(
      '/comms/templates?channel=whatsapp&status=active',
    )
      .then((r) => r.data.filter((t) => t.waTemplateName))
      .catch(() => []),
    apiFetch<{ data: Array<{ id: string; name: string; dltTemplateId: string | null }> }>(
      '/comms/templates?channel=sms&status=active',
    )
      .then((r) => r.data.filter((t) => t.dltTemplateId?.trim()))
      .catch(() => []),
  ]);
  const val = (k: string) => settings.find((s) => s.key === k)?.value;
  const mode = String(val('auth.login_mode') ?? 'oneauth');
  const onScreen = val('auth.otp_on_screen') === true;
  const remember = val('auth.otp_remember') === true;
  const smsTemplate = String(val('auth.otp_sms_template') ?? '');
  const ticked = Array.isArray(val('auth.otp_channels'))
    ? (val('auth.otp_channels') as string[])
    : ['email', 'whatsapp', 'sms'];
  const waTemplate = String(val('auth.otp_whatsapp_template') ?? '');
  return (
    <>
      <PageHeader
        kicker="System"
        title="Sign-in"
        description="How the school's staff, teachers and parents sign in. A code is a 6-digit number mailed from the school's email; it works once, for 10 minutes. Developer sign-in is not affected."
      />
      <Notice params={sp} />
      <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
        <Card title="How users sign in">
          <form action={saveSignIn} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Sign-in</legend>
              {MODES.map(([v, label, help]) => (
                <label key={v} style={{ display: 'block', marginTop: 'var(--sp-2)' }}>
                  <input
                    type="radio"
                    name="mode"
                    value={v}
                    defaultChecked={mode === v}
                    disabled={!canEdit}
                  />{' '}
                  <strong>{label}</strong>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {help}
                  </span>
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                name="onScreen"
                defaultChecked={onScreen}
                disabled={!canEdit}
              />
              <span>
                <strong>Also show the code on screen</strong>
                <span className="ep-field__help" style={{ display: 'block' }}>
                  For the rollout, while emails are being corrected. Anyone at the sign-in screen
                  can then sign in as the user, so the email no longer protects the account: switch
                  it off once the emails below are fixed. Every code shown is listed at the bottom.
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                name="remember"
                defaultChecked={remember}
                disabled={!canEdit}
              />
              <span>
                <strong>Allow “Remember this device” for 30 days</strong>
                <span className="ep-field__help" style={{ display: 'block' }}>
                  Off (the default): the code is asked at every sign-in, whether by admission no.,
                  mobile or email, and devices remembered earlier no longer skip it.
                </span>
              </span>
            </label>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Send the code by</legend>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                {(
                  [
                    ['email', 'Email'],
                    ['whatsapp', 'WhatsApp'],
                    ['sms', 'SMS'],
                  ] as const
                ).map(([v, label]) => (
                  <label
                    key={v}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      name="channels"
                      value={v}
                      defaultChecked={ticked.includes(v)}
                      disabled={!canEdit}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="ep-field__help">
                Every ticked channel that can reach the user gets the code (at least one must be
                ticked). Email is a formatted letter from the school’s email. WhatsApp and SMS go to
                the mobile on record with the school’s approved templates; the template’s variable
                gets the code (WhatsApp: in Meta’s order; SMS: the registered DLT text, only the
                variable filled).
              </p>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--sp-3)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
                }}
              >
                <label className="ep-field" htmlFor="otpWa">
                  <span className="ep-field__label">WhatsApp template</span>
                  <select
                    className="ep-select"
                    id="otpWa"
                    name="waTemplate"
                    defaultValue={waTemplate}
                    disabled={!canEdit}
                  >
                    <option value="">Find the OTP template by itself</option>
                    {waTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.waTemplateName})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="otpSms">
                  <span className="ep-field__label">SMS template (DLT)</span>
                  <select
                    className="ep-select"
                    id="otpSms"
                    name="smsTemplate"
                    defaultValue={smsTemplate}
                    disabled={!canEdit}
                  >
                    <option value="">Find the OTP template by itself</option>
                    {smsTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (DLT {t.dltTemplateId})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
            <p className="ep-field__help">
              A user of several schools follows the strictest: a code is asked when any of the
              schools asks it, and the code alone works only when every school allows it. “Remember
              this device” skips the code on that browser for 30 days. A change applies within a
              minute.
            </p>
            {canEdit ? (
              <div>
                <Button type="submit">Save</Button>
              </div>
            ) : null}
          </form>
        </Card>

        <Card title={`Users without a valid email (${log.noEmail.length})`}>
          <p className="ep-field__help">
            They cannot receive a code by email. Correct the email in People (staff, guardians)
            before switching the code on screen off.
          </p>
          {log.noEmail.length === 0 ? (
            <p>Every user has an email.</p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Users without a valid email"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Users without a valid email</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Type</th>
                    <th scope="col">Email on record</th>
                    <th scope="col">Mobile</th>
                  </tr>
                </thead>
                <tbody>
                  {log.noEmail.map((u) => (
                    <tr key={u.id}>
                      <td>{u.displayName}</td>
                      <td>{u.personType}</td>
                      <td>{u.email || '—'}</td>
                      <td>{u.mobile || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Codes shown on screen (latest ${log.shown.length})`}>
          {log.shown.length === 0 ? (
            <p>No code has been shown on screen.</p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Codes shown on screen"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Codes shown on screen</caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">User</th>
                    <th scope="col">App</th>
                    <th scope="col">Step</th>
                    <th scope="col">Email</th>
                    <th scope="col">IP address</th>
                  </tr>
                </thead>
                <tbody>
                  {log.shown.map((r, i) => (
                    <tr key={`${r.shownAt}-${i}`}>
                      <td>{when(r.shownAt)}</td>
                      <td>{r.displayName}</td>
                      <td>{r.app}</td>
                      <td>{r.purpose === 'second_factor' ? 'After One Auth' : 'Code alone'}</td>
                      <td>{r.sentTo ?? 'none on record'}</td>
                      <td>{r.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {canEdit ? (
          <Card title="Remembered devices">
            <p className="ep-field__help">
              Browsers where a user ticked “Remember this device” skip the code for 30 days. Forget
              them all, for example after a laptop is lost or when the sign-in rule is tightened.
            </p>
            <form action={forgetDevices}>
              <Button type="submit" variant="secondary">
                Forget all remembered devices
              </Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
