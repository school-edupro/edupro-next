'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { savePurchaseSettingsJson } from '@/lib/purchase-actions';
import type { PurchaseSettings } from '@/lib/purchase';
import { GSTIN_SHAPE, PIN_IN, POSTAL } from '@/lib/vendor-rules';

/** The places the addresses pick from (the school's Country / State / City masters). */
export interface PlaceLists {
  countries: Array<{ code: string; name: string }>;
  states: Array<{ code: string; name: string; gstCode: string | null; country: string }>;
  cities: Array<{ name: string; state: string; pincode: string | null }>;
}
type ControlProps = {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
  onBlur: () => void;
};
type Part = 'Line' | 'Country' | 'State' | 'City' | 'Pin';
const PREFIX = /^[A-Z0-9-]{1,10}$/;
const whole = (s: string) => /^[0-9]+$/.test(s.trim());
const amount = (s: string) => /^[0-9]+(\.[0-9]{1,2})?$/.test(s.replace(/,/g, '').trim());

/**
 * Purchase settings (docs/design/83; the checks: "As built — purchase settings checks"). The billing
 * address and, unless ticked the same, the delivery address are a line, a country → state → city from
 * the school's masters and a PIN (filled from the city); a GSTIN picks the billing state. Every field
 * is checked as it is left and again on saving, each problem under its box; the API checks the same.
 */
export function PurchaseSettingsForm({
  s,
  departments,
  places,
  can,
  committeeSize,
}: {
  s: PurchaseSettings;
  departments: Array<{ id: string; name: string }>;
  places: PlaceLists;
  can: boolean;
  committeeSize: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const india = places.countries.find((c) => c.code === 'IN')?.name ?? 'India';
  const [v, setV] = useState({
    gstin: s.gstin ?? '',
    billingLine: s.billingLine ?? '',
    billingCountry: s.billingCountry ?? india,
    billingState: s.billingState ?? '',
    billingCity: s.billingCity ?? '',
    billingPin: s.billingPin ?? '',
    deliverySame: s.deliverySame,
    deliveryLine: s.deliveryLine ?? '',
    deliveryCountry: s.deliveryCountry ?? india,
    deliveryState: s.deliveryState ?? '',
    deliveryCity: s.deliveryCity ?? '',
    deliveryPin: s.deliveryPin ?? '',
    piPrefix: s.piPrefix,
    prPrefix: s.prPrefix,
    poPrefix: s.poPrefix,
    directLimit: String(s.directLimit),
    committeeLimit: String(s.committeeLimit),
    committeeQuotes: String(s.committeeQuotes),
    committeeSignatures: s.committeeSignatures === null ? '' : String(s.committeeSignatures),
    emergencyEnabled: s.emergencyEnabled,
    emergencyRatifier: s.emergencyRatifier,
    poValidityDays: String(s.poValidityDays),
    poSignatures: s.poSignatures.join(', '),
    purchaseDepartmentId: s.purchaseDepartmentId ?? '',
    poTerms: s.poTerms ?? '',
    largePoAlert: s.largePoAlert === null ? '' : String(s.largePoAlert),
    splitWindowDays: String(s.splitWindowDays),
    receiptTolerancePct: String(s.receiptTolerancePct),
    stockGstInCost: s.stockGstInCost,
  });
  const [touched, setTouched] = useState<Set<string> | 'all'>(new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const autoPin = useRef<Record<string, string>>({});

  const place = (prefix: 'billing' | 'delivery') => {
    const country = places.countries.find((c) => c.name === v[`${prefix}Country`]) ?? null;
    const states = places.states.filter((x) => x.country === (country?.code ?? 'IN'));
    const state = states.find((x) => x.name === v[`${prefix}State`]) ?? null;
    const cities = state ? places.cities.filter((x) => x.state === state.code) : [];
    return { country, india: (country?.code ?? 'IN') === 'IN', states, state, cities };
  };
  const billing = place('billing');
  const delivery = place('delivery');
  const gstinState = /^[0-9]{2}/.test(v.gstin)
    ? (places.states.find((x) => x.country === 'IN' && x.gstCode === v.gstin.slice(0, 2))?.name ??
      null)
    : null;

  // the rules, as the API has them
  const problems = (() => {
    const out: Record<string, string> = {};
    const fail = (k: string, m: string) => {
      if (!out[k]) out[k] = m;
    };
    if (v.gstin.trim() && !GSTIN_SHAPE.test(v.gstin.trim()))
      fail('gstin', '15 characters: state code, PAN, entity number, Z, check character');
    const addr = (prefix: 'billing' | 'delivery', p: ReturnType<typeof place>) => {
      if (v[`${prefix}Line`].trim().length < 5)
        fail(`${prefix}Line`, `The ${prefix} address is required (at least 5 characters)`);
      if (!v[`${prefix}Country`]) fail(`${prefix}Country`, 'Pick the country');
      if (!v[`${prefix}State`]) fail(`${prefix}State`, 'Pick the state');
      if (!v[`${prefix}City`]) fail(`${prefix}City`, 'Pick the city');
      const pin = v[`${prefix}Pin`].trim().toUpperCase();
      if (!pin) fail(`${prefix}Pin`, 'The PIN is required');
      else if (p.india ? !PIN_IN.test(pin) : !POSTAL.test(pin))
        fail(
          `${prefix}Pin`,
          p.india ? 'Six digits, not starting with 0' : '3 to 10 letters or digits',
        );
    };
    addr('billing', billing);
    if (gstinState && v.billingState && gstinState !== v.billingState)
      fail('billingState', `The school’s GSTIN is of ${gstinState}`);
    if (!v.deliverySame) addr('delivery', delivery);
    const seen: string[] = [];
    for (const k of ['piPrefix', 'prPrefix', 'poPrefix'] as const) {
      const x = v[k].trim().toUpperCase();
      if (!PREFIX.test(x)) fail(k, 'Up to 10 capital letters, digits or hyphens');
      else if (seen.includes(x)) fail(k, 'Each document needs its own prefix');
      seen.push(x);
    }
    if (!amount(v.directLimit)) fail('directLimit', 'An amount in rupees (0 or more)');
    if (!amount(v.committeeLimit)) fail('committeeLimit', 'An amount in rupees');
    else if (
      amount(v.directLimit) &&
      Number(v.committeeLimit.replace(/,/g, '')) < Number(v.directLimit.replace(/,/g, ''))
    )
      fail('committeeLimit', 'At least the direct-purchase limit');
    if (
      !whole(v.committeeQuotes) ||
      Number(v.committeeQuotes) < 1 ||
      Number(v.committeeQuotes) > 10
    )
      fail('committeeQuotes', 'A whole number from 1 to 10');
    if (v.committeeSignatures.trim()) {
      const n = Number(v.committeeSignatures);
      if (!whole(v.committeeSignatures) || n < 1 || n > 20)
        fail('committeeSignatures', 'A whole number from 1 to 20, or empty');
      else if (n > committeeSize)
        fail('committeeSignatures', `The committee has ${String(committeeSize)} members`);
    }
    if (v.emergencyRatifier.trim().length < 2)
      fail('emergencyRatifier', 'The designation is required');
    if (!whole(v.poValidityDays) || Number(v.poValidityDays) < 1 || Number(v.poValidityDays) > 365)
      fail('poValidityDays', 'Days from 1 to 365');
    const sigs = v.poSignatures
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (!sigs.length || sigs.length > 5)
      fail('poSignatures', 'One to five names, separated by commas');
    else if (sigs.some((x) => x.length < 2 || x.length > 40))
      fail('poSignatures', 'Each name 2 to 40 characters');
    if (v.poTerms.length > 4000) fail('poTerms', 'At most 4,000 characters');
    if (
      v.largePoAlert.trim() &&
      (!amount(v.largePoAlert) || Number(v.largePoAlert.replace(/,/g, '')) <= 0)
    )
      fail('largePoAlert', 'An amount above 0, or empty');
    if (
      !whole(v.splitWindowDays) ||
      Number(v.splitWindowDays) < 1 ||
      Number(v.splitWindowDays) > 365
    )
      fail('splitWindowDays', 'Days from 1 to 365');
    const tol = v.receiptTolerancePct.trim() || '0';
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(tol) || Number(tol) > 50)
      fail('receiptTolerancePct', 'A per cent from 0 to 50');
    return out;
  })();

  const shown = (k: string) =>
    serverErrors[k] ?? (touched === 'all' || touched.has(k) ? (problems[k] ?? null) : null);
  const leave = (k: string) => () => setTouched((t) => (t === 'all' ? t : new Set(t).add(k)));
  const put = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => {
    setSaved(false);
    setServerErrors((e) => {
      if (!(k in e)) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });
    setV((cur) => ({ ...cur, [k]: value }));
  };
  const setGstin = (raw: string) => {
    const gstin = raw.toUpperCase().replace(/\s/g, '');
    put('gstin', gstin);
    const st = /^[0-9]{2}/.test(gstin)
      ? places.states.find((x) => x.country === 'IN' && x.gstCode === gstin.slice(0, 2))
      : undefined;
    // the billing address is in the GSTIN's state
    if (st && st.name !== v.billingState)
      setV((cur) => ({ ...cur, billingCountry: india, billingState: st.name, billingCity: '' }));
  };
  const setCity = (prefix: 'billing' | 'delivery', name: string, p: ReturnType<typeof place>) => {
    const pin = p.cities.find((c) => c.name === name)?.pincode ?? '';
    const key = `${prefix}Pin` as const;
    const fill = Boolean(pin) && (v[key] === '' || v[key] === autoPin.current[prefix]);
    if (fill) autoPin.current[prefix] = pin;
    put(`${prefix}City`, name);
    if (fill) setV((cur) => ({ ...cur, [key]: pin }));
  };

  const field = (
    k: string,
    label: string,
    control: (a: ControlProps) => React.ReactNode,
    opts: { required?: boolean; help?: React.ReactNode; wide?: boolean } = {},
  ) => {
    const id = `ps-${k}`;
    const problem = shown(k);
    const helpId = opts.help ? `${id}-help` : undefined;
    const errId = problem ? `${id}-err` : undefined;
    return (
      <div className="ep-field" key={k} style={opts.wide ? { gridColumn: '1 / -1' } : undefined}>
        <label className="ep-field__label" htmlFor={id} data-required={opts.required || undefined}>
          {label}
        </label>
        {control({
          id,
          'aria-invalid': Boolean(problem),
          'aria-describedby': [helpId, errId].filter(Boolean).join(' ') || undefined,
          onBlur: leave(k),
        })}
        {opts.help ? (
          <span id={helpId} className="ep-field__help">
            {opts.help}
          </span>
        ) : null}
        {problem ? (
          <span id={errId} className="ep-field__error">
            {problem}
          </span>
        ) : null}
      </div>
    );
  };
  const text =
    (k: keyof typeof v, extra: Record<string, unknown> = {}, upper = false) =>
    (a: ControlProps) => (
      <input
        {...a}
        {...extra}
        className="ep-input"
        value={String(v[k])}
        onChange={(e) => put(k, (upper ? e.target.value.toUpperCase() : e.target.value) as never)}
      />
    );

  const address = (prefix: 'billing' | 'delivery', p: ReturnType<typeof place>) => {
    const part = (x: Part) => `${prefix}${x}` as keyof typeof v;
    return (
      <>
        <FormRow columns={1}>
          {field(
            part('Line'),
            'Address',
            text(part('Line'), {
              maxLength: 300,
              placeholder: 'Building, street, area',
              autoComplete: 'street-address',
            }),
            { required: true },
          )}
        </FormRow>
        <FormRow columns={4}>
          {field(
            part('Country'),
            'Country',
            (a) => (
              <select
                {...a}
                className="ep-select"
                value={String(v[part('Country')])}
                onChange={(e) => {
                  put(part('Country'), e.target.value as never);
                  setV((cur) => ({ ...cur, [part('State')]: '', [part('City')]: '' }));
                }}
              >
                <option value="">—</option>
                {places.countries.map((c) => (
                  <option key={c.code} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            ),
            { required: true },
          )}
          {field(
            part('State'),
            'State',
            (a) => (
              <select
                {...a}
                className="ep-select"
                value={String(v[part('State')])}
                onChange={(e) => {
                  put(part('State'), e.target.value as never);
                  setV((cur) => ({ ...cur, [part('City')]: '' }));
                }}
              >
                <option value="">—</option>
                {p.states.map((x) => (
                  <option key={x.code} value={x.name}>
                    {x.name}
                  </option>
                ))}
              </select>
            ),
            {
              required: true,
              help: prefix === 'billing' && gstinState ? 'The GSTIN’s state.' : undefined,
            },
          )}
          {field(
            part('City'),
            'City',
            (a) => (
              <select
                {...a}
                className="ep-select"
                value={String(v[part('City')])}
                onChange={(e) => setCity(prefix, e.target.value, p)}
                disabled={!p.state}
              >
                <option value="">{p.state ? '—' : 'Pick the state first'}</option>
                {p.cities.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            ),
            {
              required: true,
              help:
                p.state && !p.cities.length
                  ? `No cities of ${p.state.name} in the Cities master yet (Masters → Cities).`
                  : 'Not in the list? It is added in Masters → Cities first.',
            },
          )}
          {field(
            part('Pin'),
            p.india ? 'PIN' : 'Postal code',
            text(
              part('Pin'),
              {
                inputMode: p.india ? 'numeric' : 'text',
                maxLength: p.india ? 6 : 10,
                autoComplete: 'postal-code',
              },
              true,
            ),
            { required: true, help: p.india ? 'Filled from the city; six digits.' : undefined },
          )}
        </FormRow>
      </>
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setTouched('all');
    setServerErrors({});
    const count = Object.keys(problems).length;
    const focusFirst = () =>
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    if (count) {
      setError(`Check the ${String(count)} field${count === 1 ? '' : 's'} marked in red.`);
      focusFirst();
      return;
    }
    const num = (x: string) => Number(x.replace(/,/g, '').trim());
    start(async () => {
      const r = await savePurchaseSettingsJson({
        gstin: v.gstin.trim() || null,
        billingLine: v.billingLine,
        billingCountry: v.billingCountry,
        billingState: v.billingState,
        billingCity: v.billingCity,
        billingPin: v.billingPin,
        deliverySame: v.deliverySame,
        ...(v.deliverySame
          ? {}
          : {
              deliveryLine: v.deliveryLine,
              deliveryCountry: v.deliveryCountry,
              deliveryState: v.deliveryState,
              deliveryCity: v.deliveryCity,
              deliveryPin: v.deliveryPin,
            }),
        piPrefix: v.piPrefix,
        prPrefix: v.prPrefix,
        poPrefix: v.poPrefix,
        directLimit: num(v.directLimit),
        committeeLimit: num(v.committeeLimit),
        committeeQuotes: num(v.committeeQuotes),
        committeeSignatures: v.committeeSignatures.trim() ? num(v.committeeSignatures) : null,
        emergencyEnabled: v.emergencyEnabled,
        emergencyRatifier: v.emergencyRatifier,
        poTerms: v.poTerms || null,
        poValidityDays: num(v.poValidityDays),
        purchaseDepartmentId: v.purchaseDepartmentId || null,
        poSignatures: v.poSignatures
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        largePoAlert: v.largePoAlert.trim() ? num(v.largePoAlert) : null,
        splitWindowDays: num(v.splitWindowDays),
        stockGstInCost: v.stockGstInCost,
        receiptTolerancePct: num(v.receiptTolerancePct || '0'),
      });
      if (r.ok) {
        setSaved(true);
        router.refresh();
        return;
      }
      if (r.fields && Object.keys(r.fields).length) {
        setServerErrors(r.fields);
        setError('Check the fields marked in red.');
        focusFirst();
      } else setError(r.error);
    });
  };

  const check = (k: 'deliverySame' | 'emergencyEnabled' | 'stockGstInCost', label: string) => (
    <label className="ep-check" htmlFor={`ps-${k}`}>
      <input
        id={`ps-${k}`}
        className="ep-check__input"
        type="checkbox"
        checked={v[k]}
        onChange={(e) => put(k, e.target.checked)}
      />
      <span className="ep-check__box" />
      {label}
    </label>
  );

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      <fieldset disabled={!can} style={{ border: 0, padding: 0, margin: 0 }}>
        <FormSection
          title="The school"
          description={
            gstinState
              ? `GST state: ${gstinState}. A vendor in this state is charged CGST + SGST; one in another state IGST.`
              : 'The GSTIN gives the school’s state; without one, the billing address’s state decides CGST + SGST or IGST on a PO.'
          }
        >
          <FormRow columns={3}>
            {field(
              'gstin',
              'The school’s GSTIN',
              (a) => (
                <input
                  {...a}
                  className="ep-input"
                  value={v.gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  maxLength={15}
                  placeholder="Empty if the school has none"
                  autoComplete="off"
                />
              ),
              {
                help: gstinState
                  ? `A GSTIN of ${gstinState}.`
                  : 'Optional; checked (its last character too).',
              },
            )}
          </FormRow>
        </FormSection>
        <FormSection title="Billing address" description="Printed on every purchase order.">
          {address('billing', billing)}
        </FormSection>
        <FormSection
          title="Delivery address"
          description="Copied onto every new PO, where it can be changed."
        >
          {check('deliverySame', 'The same as the billing address')}
          {!v.deliverySame ? address('delivery', delivery) : null}
        </FormSection>
        <FormSection
          title="Numbering"
          description="The number of each document, restarting every financial year: PO/2026-27/0001."
        >
          <FormRow columns={3}>
            {(
              [
                ['piPrefix', 'Purchase Indent prefix'],
                ['prPrefix', 'Purchase Requisition prefix'],
                ['poPrefix', 'Purchase Order prefix'],
              ] as const
            ).map(([k, label]) =>
              field(k, label, text(k, { maxLength: 10 }, true), { required: true }),
            )}
          </FormRow>
        </FormSection>
        <FormSection
          title="Sourcing by value"
          description="Up to the direct limit one quote and a reasonable-price certificate are enough; up to the committee limit the PR needs the quotes and the committee’s signed comparative statement; above it, a tender reference."
        >
          <FormRow columns={4}>
            {field(
              'directLimit',
              'Direct purchase up to (₹)',
              text('directLimit', { inputMode: 'decimal' }),
              { required: true },
            )}
            {field(
              'committeeLimit',
              'Committee up to (₹)',
              text('committeeLimit', { inputMode: 'decimal' }),
              { required: true },
            )}
            {field(
              'committeeQuotes',
              'Quotes needed',
              text('committeeQuotes', { inputMode: 'numeric', maxLength: 2 }),
              { required: true },
            )}
            {field(
              'committeeSignatures',
              'Committee signatures needed',
              text('committeeSignatures', {
                inputMode: 'numeric',
                maxLength: 2,
                placeholder: 'Empty: every member',
              }),
              { help: `The committee has ${String(committeeSize)} members.` },
            )}
          </FormRow>
          {check(
            'emergencyEnabled',
            'Allow emergency purchases (recorded after the fact, with the vendor’s bill; ratified afterwards)',
          )}
          <FormRow columns={3}>
            {field(
              'emergencyRatifier',
              'Who ratifies them (designation)',
              text('emergencyRatifier', { maxLength: 80 }),
              {
                required: true,
                help: 'Everyone with this designation; the school admin when nobody holds it.',
              },
            )}
          </FormRow>
        </FormSection>
        <FormSection title="Purchase order">
          <FormRow columns={3}>
            {field(
              'poValidityDays',
              'Valid for (days)',
              text('poValidityDays', { inputMode: 'numeric', maxLength: 3 }),
              { required: true },
            )}
            {field(
              'poSignatures',
              'Signatures (comma separated)',
              text('poSignatures', { maxLength: 220 }),
              { required: true, help: 'One to five, e.g. Prepared by, Checked by, Approved by.' },
            )}
            {field('purchaseDepartmentId', 'Approves a PR combining departments', (a) => (
              <select
                {...a}
                className="ep-select"
                value={v.purchaseDepartmentId}
                onChange={(e) => put('purchaseDepartmentId', e.target.value)}
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ))}
          </FormRow>
          {field(
            'poTerms',
            'Terms and conditions (printed on the PO)',
            (a) => (
              <textarea
                {...a}
                className="ep-input"
                rows={4}
                value={v.poTerms}
                maxLength={4000}
                onChange={(e) => put('poTerms', e.target.value)}
              />
            ),
            { help: `${String(v.poTerms.length)} of 4,000 characters.` },
          )}
        </FormSection>
        <FormSection title="Checks">
          <FormRow columns={2}>
            {field(
              'largePoAlert',
              'List POs above (₹) on the dashboard',
              text('largePoAlert', { inputMode: 'decimal', placeholder: 'Empty: no list' }),
              { help: 'Information only: no approver is added by amount.' },
            )}
            {field(
              'splitWindowDays',
              'Split window (days)',
              text('splitWindowDays', { inputMode: 'numeric', maxLength: 3 }),
              {
                required: true,
                help: 'A department’s small PIs of one category within these days are added together before a PI skips the PR.',
              },
            )}
          </FormRow>
        </FormSection>
        <FormSection
          title="Goods received"
          description="How the store takes in what comes against a PO."
        >
          <FormRow columns={2}>
            {field(
              'receiptTolerancePct',
              'More than ordered allowed (%)',
              text('receiptTolerancePct', { inputMode: 'decimal', maxLength: 5 }),
              { help: 'Per PO line; 0 refuses anything beyond the order. Most schools keep 0.' },
            )}
          </FormRow>
          {check(
            'stockGstInCost',
            'GST paid is part of the stock cost (leave on unless the school takes input tax credit)',
          )}
        </FormSection>
        {error ? (
          <p
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            {error}
          </p>
        ) : null}
        {saved ? (
          <p
            className="ep-alert ep-alert--success"
            role="status"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            Purchase settings saved.
          </p>
        ) : null}
        {can ? (
          <FormActions>
            <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save the settings'}
            </button>
          </FormActions>
        ) : null}
      </fieldset>
    </form>
  );
}
