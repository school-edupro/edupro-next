'use client';
import { useState } from 'react';
import { addCredit, savePolicy, saveProvider, testProvider } from '@/lib/comms-actions';
import {
  CHANNEL_LABEL,
  type Balance,
  type Channel,
  type CommsPolicy,
  type CommsSettings,
} from '@/lib/comms';

interface Field {
  key: string;
  label: string;
  secret?: boolean;
  help?: string;
  type?: 'text' | 'number' | 'checkbox';
  placeholder?: string;
}

interface ProviderDef {
  id: string;
  label: string;
  fields: Field[];
  help: string;
}

const PROVIDERS: Record<Channel, ProviderDef[]> = {
  sms: [
    {
      id: 'smsbhejo',
      label: 'smsbhejo.org (DLT)',
      help: 'The gateway your current ERP uses: account user and key, the default DLT sender id (header) and principal entity id. Each SMS template carries its DLT template id.',
      fields: [
        { key: 'user', label: 'Account user' },
        { key: 'key', label: 'API key', secret: true },
        { key: 'senderId', label: 'Default sender id (header)', placeholder: 'e.g. DPSNOI' },
        { key: 'entityId', label: 'DLT principal entity id' },
        { key: 'url', label: 'Gateway address', placeholder: 'https://smsbhejo.org/submitsms.jsp' },
        { key: 'countryPrefix', label: 'Send numbers with 91 in front', type: 'checkbox' },
      ],
    },
    {
      id: 'msg91',
      label: 'MSG91',
      help: 'Your MSG91 account’s auth key and the DLT-approved sender id. Every SMS template carries its DLT template id.',
      fields: [
        { key: 'authKey', label: 'Auth key', secret: true },
        { key: 'senderId', label: 'Default sender id (header)', placeholder: 'e.g. ALPHAS' },
        { key: 'dltEntityId', label: 'DLT principal entity id' },
        { key: 'route', label: 'Route', placeholder: '4 (transactional)' },
      ],
    },
  ],
  whatsapp: [
    {
      id: 'ems_whatsapp',
      label: 'Mobilise EMS WhatsApp bridge',
      help: 'The bridge your current ERP uses: its address and bearer key. Templates must be approved on the WhatsApp Business account; PDF / image headers are sent inline (no public link needed).',
      fields: [
        {
          key: 'url',
          label: 'Bridge address',
          placeholder: 'https://ems.onmobilise.com/api/v1/messages',
        },
        { key: 'apiKey', label: 'Bearer key', secret: true },
        { key: 'countryPrefix', label: 'Send numbers with 91 in front', type: 'checkbox' },
      ],
    },
    {
      id: 'meta_whatsapp',
      label: 'Meta WhatsApp Cloud API',
      help: 'From Meta Business → WhatsApp → API setup: the phone number id, WhatsApp Business account id and a permanent access token; the app secret signs status updates.',
      fields: [
        { key: 'phoneNumberId', label: 'Phone number id' },
        { key: 'wabaId', label: 'WhatsApp Business account id' },
        { key: 'accessToken', label: 'Permanent access token', secret: true },
        { key: 'appSecret', label: 'App secret (webhook signature)', secret: true },
        { key: 'apiVersion', label: 'Graph API version', placeholder: 'v21.0' },
      ],
    },
  ],
  email: [
    {
      id: 'smtp',
      label: 'SMTP / Amazon SES',
      help: 'Any SMTP server (your current ERP: the school mail server on port 465 with TLS from the start). For Amazon SES use the SES SMTP endpoint, port 587, and SES SMTP credentials.',
      fields: [
        { key: 'host', label: 'SMTP host', placeholder: 'mail.example.com' },
        { key: 'port', label: 'Port', type: 'number', placeholder: '465 or 587' },
        { key: 'secure', label: 'Use TLS from the start (port 465)', type: 'checkbox' },
        { key: 'user', label: 'User name' },
        { key: 'password', label: 'Password', secret: true },
        { key: 'fromEmail', label: 'From email', placeholder: 'noreply@school.in' },
        { key: 'fromName', label: 'From name', placeholder: 'School name' },
        { key: 'replyTo', label: 'Reply-to (optional)' },
      ],
    },
  ],
};

function ProviderCard({
  channel,
  settings,
  templates,
}: {
  channel: Channel;
  settings: CommsSettings;
  templates: Array<{ id: string; name: string }>;
}) {
  const saved = settings.providers.find((p) => p.channel === channel);
  const [mode, setMode] = useState<string>(saved?.provider ?? 'console');
  const [config, setConfig] = useState<Record<string, string | number | boolean>>(
    saved?.config ?? {},
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [active, setActive] = useState(saved?.active ?? true);
  const [to, setTo] = useState('');
  const [testTpl, setTestTpl] = useState(templates[0]?.id ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const def = PROVIDERS[channel].find((p) => p.id === mode);
  const real = Boolean(def);
  return (
    <section className="ep-card ep-prov" aria-labelledby={`prov-${channel}`}>
      <h2 className="ep-card__title" id={`prov-${channel}`}>
        {CHANNEL_LABEL[channel]}
      </h2>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <label className="ep-field" htmlFor={`prov-${channel}-mode`}>
        <span className="ep-field__label">Send through</span>
        <select
          id={`prov-${channel}-mode`}
          className="ep-select"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="console">Not set up (messages are only logged)</option>
          {PROVIDERS[channel].map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {def ? (
        <>
          <p className="ep-field__help">{def.help}</p>
          <div className="ep-wd__form">
            {def.fields.map((f) =>
              f.type === 'checkbox' ? (
                <label key={f.key} className="ep-roles__tick" htmlFor={`prov-${channel}-${f.key}`}>
                  <input
                    id={`prov-${channel}-${f.key}`}
                    type="checkbox"
                    checked={config[f.key] === true}
                    onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })}
                  />{' '}
                  {f.label}
                </label>
              ) : (
                <label key={f.key} className="ep-field" htmlFor={`prov-${channel}-${f.key}`}>
                  <span className="ep-field__label">
                    {f.label}
                    {f.secret && saved?.secrets[f.key] ? ' (saved; leave empty to keep)' : ''}
                  </span>
                  <input
                    id={`prov-${channel}-${f.key}`}
                    className="ep-input"
                    type={f.secret ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    autoComplete="off"
                    placeholder={f.secret && saved?.secrets[f.key] ? '••••••••' : f.placeholder}
                    value={f.secret ? (secrets[f.key] ?? '') : String(config[f.key] ?? '')}
                    onChange={(e) =>
                      f.secret
                        ? setSecrets({ ...secrets, [f.key]: e.target.value })
                        : setConfig({
                            ...config,
                            [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                          })
                    }
                  />
                </label>
              ),
            )}
            <label className="ep-roles__tick" htmlFor={`prov-${channel}-active`}>
              <input
                id={`prov-${channel}-active`}
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />{' '}
              Channel switched on (off = nothing goes out on {CHANNEL_LABEL[channel]})
            </label>
          </div>
          {channel === 'whatsapp' && typeof saved?.config.verifyToken === 'string' ? (
            <p className="ep-field__help">
              Webhook for Meta: <code>{`https://<your API host>${settings.webhooks.meta}`}</code>,
              verify token <code>{saved.config.verifyToken}</code>
            </p>
          ) : null}
          {channel === 'sms' ? (
            <p className="ep-field__help">
              Delivery reports: set MSG91’s webhook (JSON) to{' '}
              <code>{`https://<your API host>${settings.webhooks.msg91}?token=<webhook token>`}</code>
            </p>
          ) : null}
        </>
      ) : null}
      <div className="ep-wdset__actions">
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await saveProvider(channel, {
              provider: mode,
              config: real ? config : {},
              secrets: real ? secrets : {},
              active,
            });
            setBusy(false);
            setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
            if (r.ok) setSecrets({});
          }}
        >
          Save
        </button>
      </div>
      <div className="ep-wd__form ep-prov__test">
        <label className="ep-field" htmlFor={`prov-${channel}-to`}>
          <span className="ep-field__label">Send a test to</span>
          <input
            id={`prov-${channel}-to`}
            className="ep-input"
            value={to}
            inputMode={channel === 'email' ? 'email' : 'tel'}
            placeholder={channel === 'email' ? 'you@school.in' : '10-digit mobile'}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {channel === 'whatsapp' ? (
          <label className="ep-field" htmlFor={`prov-${channel}-tpl`}>
            <span className="ep-field__label">Approved template (sample values)</span>
            <select
              id={`prov-${channel}-tpl`}
              className="ep-select"
              value={testTpl}
              onChange={(e) => setTestTpl(e.target.value)}
            >
              {templates.length ? null : <option value="">No WhatsApp template yet</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={!to}
          onClick={async () => {
            const r = await testProvider(channel, to, channel === 'whatsapp' ? testTpl : undefined);
            setMsg(
              r.ok
                ? { ok: true, text: 'Test queued. The delivery log shows whether it went out.' }
                : { ok: false, text: r.error },
            );
          }}
        >
          Send test
        </button>
      </div>
      {channel === 'whatsapp' && real ? (
        <p className="ep-field__help">
          A test outside a template only reaches a number that messaged the school in the last 24
          hours.
        </p>
      ) : null}
    </section>
  );
}

function Policy({ settings }: { settings: CommsSettings }) {
  const [p, setP] = useState<CommsPolicy>(settings.policy);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <section className="ep-card" aria-labelledby="policy-title">
      <h2 className="ep-card__title" id="policy-title">
        Rules
      </h2>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <div className="ep-wd__form">
        <label className="ep-field" htmlFor="pol-threshold">
          <span className="ep-field__label">Approval needed above (recipients)</span>
          <input
            id="pol-threshold"
            type="number"
            min={0}
            className="ep-input"
            value={p.approvalThreshold}
            onChange={(e) => setP({ ...p, approvalThreshold: num(e.target.value) })}
          />
          <span className="ep-field__help">0 = every bulk message needs approval</span>
        </label>
        <label className="ep-field" htmlFor="pol-max">
          <span className="ep-field__label">Largest attachment (MB)</span>
          <input
            id="pol-max"
            type="number"
            min={1}
            max={25}
            className="ep-input"
            value={p.attachmentMaxMb}
            onChange={(e) => setP({ ...p, attachmentMaxMb: num(e.target.value) })}
          />
        </label>
        <label className="ep-field" htmlFor="pol-qf">
          <span className="ep-field__label">Quiet hours from</span>
          <input
            id="pol-qf"
            type="time"
            className="ep-input"
            value={p.quietFrom ?? ''}
            onChange={(e) => setP({ ...p, quietFrom: e.target.value || null })}
          />
        </label>
        <label className="ep-field" htmlFor="pol-qt">
          <span className="ep-field__label">Quiet hours until</span>
          <input
            id="pol-qt"
            type="time"
            className="ep-input"
            value={p.quietTo ?? ''}
            onChange={(e) => setP({ ...p, quietTo: e.target.value || null })}
          />
          <span className="ep-field__help">
            General messages composed in quiet hours wait; important ones go at once.
          </span>
        </label>
      </div>
      <fieldset className="ep-cl">
        <legend className="ep-field__label">Roles that never need approval</legend>
        <ul className="ep-cl__list">
          {settings.roles.map((r) => (
            <li key={r.code}>
              <label className="ep-roles__tick" htmlFor={`pol-role-${r.code}`}>
                <input
                  id={`pol-role-${r.code}`}
                  type="checkbox"
                  checked={p.approvalExemptRoles.includes(r.code)}
                  onChange={(e) =>
                    setP({
                      ...p,
                      approvalExemptRoles: e.target.checked
                        ? [...p.approvalExemptRoles, r.code]
                        : p.approvalExemptRoles.filter((x) => x !== r.code),
                    })
                  }
                />{' '}
                {r.name}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="ep-wd__form">
        {(['sms', 'whatsapp', 'email'] as Channel[]).map((c) => (
          <label key={c} className="ep-field" htmlFor={`pol-rate-${c}`}>
            <span className="ep-field__label">
              ₹ per {c === 'sms' ? 'SMS part' : c === 'whatsapp' ? 'WhatsApp message' : 'email'}
            </span>
            <input
              id={`pol-rate-${c}`}
              type="number"
              min={0}
              step="0.01"
              className="ep-input"
              value={p.rates[c]}
              onChange={(e) => setP({ ...p, rates: { ...p.rates, [c]: num(e.target.value) } })}
            />
          </label>
        ))}
        {(['sms', 'whatsapp'] as Channel[]).map((c) => (
          <label key={c} className="ep-field" htmlFor={`pol-low-${c}`}>
            <span className="ep-field__label">Warn when {CHANNEL_LABEL[c]} credits fall below</span>
            <input
              id={`pol-low-${c}`}
              type="number"
              min={0}
              className="ep-input"
              value={p.lowBalance[c] ?? 0}
              onChange={(e) =>
                setP({ ...p, lowBalance: { ...p.lowBalance, [c]: num(e.target.value) } })
              }
            />
          </label>
        ))}
      </div>
      <div className="ep-wdset__actions">
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          onClick={async () => {
            const r = await savePolicy({
              ...p,
              quietFrom: p.quietFrom ?? '',
              quietTo: p.quietTo ?? '',
            } as CommsPolicy);
            setMsg(
              r.ok
                ? { ok: true, text: 'Saved.' }
                : { ok: false, text: [r.error, ...(r.errors ?? [])].join(' · ') },
            );
          }}
        >
          Save rules
        </button>
      </div>
    </section>
  );
}

function Credits({
  balances,
  ledger,
}: {
  balances: Balance[];
  ledger: Array<{
    id: string;
    channel: string;
    units: number;
    amount: number | null;
    note: string | null;
    onDate: string;
    by: string | null;
  }>;
}) {
  const [channel, setChannel] = useState<Channel>('sms');
  const [units, setUnits] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="ep-card" aria-labelledby="credits-title">
      <h2 className="ep-card__title" id="credits-title">
        Credits
      </h2>
      {msg ? (
        <p
          className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </p>
      ) : null}
      <div className="ep-kpis">
        {balances.map((b) => (
          <div key={b.channel} className="ep-kpi-lite" data-low={b.low ? 'true' : undefined}>
            <span className="ep-field__help">{CHANNEL_LABEL[b.channel]}</span>
            <strong>{b.tracked ? b.balance.toLocaleString('en-IN') : '—'}</strong>
            <span className="ep-field__help">
              {b.tracked
                ? `${b.used.toLocaleString('en-IN')} used of ${b.credited.toLocaleString('en-IN')}`
                : 'not tracked'}
            </span>
          </div>
        ))}
      </div>
      <div className="ep-wd__form">
        <label className="ep-field" htmlFor="cr-ch">
          <span className="ep-field__label">Channel</span>
          <select
            id="cr-ch"
            className="ep-select"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
          >
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label className="ep-field" htmlFor="cr-units">
          <span className="ep-field__label">Credits bought (negative to correct)</span>
          <input
            id="cr-units"
            type="number"
            className="ep-input"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="cr-amt">
          <span className="ep-field__label">Amount paid (₹)</span>
          <input
            id="cr-amt"
            type="number"
            min={0}
            className="ep-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="ep-field ep-wd__wide" htmlFor="cr-note">
          <span className="ep-field__label">Note</span>
          <input
            id="cr-note"
            className="ep-input"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. MSG91 invoice 1234"
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={!units || Number(units) === 0}
          onClick={async () => {
            const r = await addCredit({
              channel,
              units: Number(units),
              ...(amount ? { amount: Number(amount) } : {}),
              ...(note ? { note } : {}),
            });
            if (r.ok) window.location.reload();
            else setMsg({ ok: false, text: r.error });
          }}
        >
          Record top-up
        </button>
      </div>
      {ledger.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="ep-table">
            <caption className="ep-sr-only">Credit top-ups</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Channel</th>
                <th scope="col">Credits</th>
                <th scope="col">Amount</th>
                <th scope="col">Note</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((x) => (
                <tr key={x.id}>
                  <td>{x.onDate}</td>
                  <td>{CHANNEL_LABEL[x.channel as Channel] ?? x.channel}</td>
                  <td>{x.units.toLocaleString('en-IN')}</td>
                  <td>{x.amount === null ? '—' : `₹${x.amount.toLocaleString('en-IN')}`}</td>
                  <td>{x.note ?? '—'}</td>
                  <td>{x.by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Communication settings (v2): providers and keys, rules, credits. */
export function CommsSettingsForm({
  settings,
  credits,
  canCredit,
  whatsappTemplates,
}: {
  whatsappTemplates: Array<{ id: string; name: string }>;
  settings: CommsSettings;
  credits: { balances: Balance[]; ledger: Parameters<typeof Credits>[0]['ledger'] };
  canCredit: boolean;
}) {
  return (
    <div className="ep-grp">
      <div className="ep-prov__grid">
        {(['sms', 'whatsapp', 'email'] as Channel[]).map((c) => (
          <ProviderCard
            key={c}
            channel={c}
            settings={settings}
            templates={c === 'whatsapp' ? whatsappTemplates : []}
          />
        ))}
      </div>
      <Policy settings={settings} />
      {canCredit ? <Credits balances={credits.balances} ledger={credits.ledger} /> : null}
    </div>
  );
}
