'use client';
import { useState } from 'react';

export type GatewayProvider = 'payu' | 'ccavenue' | 'razorpay' | 'sbiepay' | 'atom';
export type GatewayFields = Record<
  GatewayProvider,
  {
    name: string;
    config: Array<[string, string]>;
    secret: Array<[string, string]>;
    /** keys that may stay empty (Razorpay's webhook secret) */
    optional?: string[];
  }
>;
export interface GatewayRow {
  id: string;
  provider: GatewayProvider;
  label: string;
  mode: 'test' | 'live';
  config: Record<string, string>;
  secretsSaved: string[];
  /** Razorpay: the webhook URL to give its dashboard */
  webhookUrl?: string | null;
  chargePercent: string;
  chargeFlat: string;
  active: boolean;
  ledgers: string[];
}

/**
 * One gateway account's form: the fields follow the provider chosen. Keys are typed once; afterwards the
 * box shows "saved" and an empty box keeps the saved key.
 */
export function GatewayEditor({
  fields,
  row,
  canEdit,
}: {
  fields: GatewayFields;
  row?: GatewayRow;
  canEdit: boolean;
}) {
  const [provider, setProvider] = useState<GatewayProvider>(row?.provider ?? 'payu');
  const spec = fields[provider];
  const p = row?.id ?? 'new';
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))',
        }}
      >
        <label className="ep-field" htmlFor={`${p}-provider`}>
          <span className="ep-field__label">Gateway *</span>
          <select
            className="ep-select"
            id={`${p}-provider`}
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as GatewayProvider)}
            disabled={!canEdit || Boolean(row)}
          >
            {(Object.keys(fields) as GatewayProvider[]).map((k) => (
              <option key={k} value={k}>
                {fields[k].name}
              </option>
            ))}
          </select>
          {row ? <input type="hidden" name="provider" value={provider} /> : null}
        </label>
        <label className="ep-field" htmlFor={`${p}-label`}>
          <span className="ep-field__label">Name shown to parents *</span>
          <input
            className="ep-input"
            id={`${p}-label`}
            name="label"
            required
            minLength={2}
            maxLength={60}
            defaultValue={row?.label ?? spec.name}
            disabled={!canEdit}
          />
        </label>
        <label className="ep-field" htmlFor={`${p}-mode`}>
          <span className="ep-field__label">Mode *</span>
          <select
            className="ep-select"
            id={`${p}-mode`}
            name="mode"
            defaultValue={row?.mode ?? 'test'}
            disabled={!canEdit}
          >
            <option value="test">Test (sandbox)</option>
            <option value="live">Live (real money)</option>
          </select>
          <span className="ep-field__help">
            Live works only from the web address registered with the gateway (e.g. the school&apos;s
            https site), not from a computer&apos;s localhost. Use Test with the gateway&apos;s test
            keys to try it first.
          </span>
        </label>
        {spec.config.map(([k, label]) => (
          <label key={`${provider}-${k}`} className="ep-field" htmlFor={`${p}-c-${k}`}>
            <span className="ep-field__label">{label} *</span>
            <input
              className="ep-input"
              id={`${p}-c-${k}`}
              name={`config.${k}`}
              defaultValue={row?.provider === provider ? (row.config[k] ?? '') : ''}
              maxLength={400}
              autoComplete="off"
              disabled={!canEdit}
            />
          </label>
        ))}
        {spec.secret.map(([k, label]) => {
          const saved = row?.provider === provider && row.secretsSaved.includes(k);
          const optional = spec.optional?.includes(k) ?? false;
          return (
            <label key={`${provider}-${k}`} className="ep-field" htmlFor={`${p}-s-${k}`}>
              <span className="ep-field__label">
                {label}
                {saved || optional ? '' : ' *'}
                {optional && !saved ? ' (optional)' : ''}
              </span>
              <input
                className="ep-input"
                id={`${p}-s-${k}`}
                name={`secret.${k}`}
                type="password"
                placeholder={saved ? 'Saved (leave empty to keep)' : ''}
                maxLength={400}
                autoComplete="new-password"
                disabled={!canEdit}
              />
              {provider === 'razorpay' && k === 'webhookSecret' ? (
                <span className="ep-field__help">
                  Not needed to take payments: a payment is confirmed when the payer comes back,
                  checked with the key secret. Add a webhook to also catch a payer who closes the
                  browser before coming back, and refunds: in the Razorpay dashboard, Settings →
                  Webhooks → Add, give the URL{' '}
                  {row?.provider === 'razorpay' && row.webhookUrl ? (
                    <code>{row.webhookUrl}</code>
                  ) : (
                    'shown here once this account is saved'
                  )}
                  , choose the events payment.captured, payment.failed and refund.processed, make up
                  a secret (any long random text), and type the same secret here. Razorpay cannot
                  reach a localhost address, so the webhook works only once the school is on its web
                  address.
                </span>
              ) : null}
            </label>
          );
        })}
        <label className="ep-field" htmlFor={`${p}-pct`}>
          <span className="ep-field__label">Convenience charge (%)</span>
          <input
            className="ep-input"
            id={`${p}-pct`}
            name="chargePercent"
            type="number"
            min={0}
            max={20}
            step="0.001"
            defaultValue={row ? Number(row.chargePercent) : 0}
            disabled={!canEdit}
          />
        </label>
        <label className="ep-field" htmlFor={`${p}-flat`}>
          <span className="ep-field__label">Convenience charge (₹ flat)</span>
          <input
            className="ep-input"
            id={`${p}-flat`}
            name="chargeFlat"
            type="number"
            min={0}
            step="0.01"
            defaultValue={row ? Number(row.chargeFlat) : 0}
            disabled={!canEdit}
          />
        </label>
      </div>
      <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <input
          type="checkbox"
          name="active"
          defaultChecked={row ? row.active : true}
          disabled={!canEdit}
        />
        In use (parents can pay through it)
      </label>
      <p className="ep-field__help">
        The convenience charge is added on top of the fee and shown to the parent before paying; it
        is kept apart from the fee on the receipt. Both 0 = the school bears the gateway’s charge.
      </p>
    </div>
  );
}
