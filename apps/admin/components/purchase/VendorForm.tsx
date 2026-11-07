'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { ChipPicker } from '@/components/ChipPicker';
import { saveVendor } from '@/lib/purchase-actions';
import { GST_STATUS, VENDOR_KIND, type VendorDetail } from '@/lib/purchase';
import { vendorProblems, type VendorFormValues } from '@/lib/vendor-rules';

/** What the vendor form picks from (the school's masters) and the code a new vendor gets now. */
export interface VendorLists {
  terms: Array<{ id: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
  countries: Array<{ code: string; name: string }>;
  states: Array<{ code: string; name: string; gstCode: string | null; country: string }>;
  cities: Array<{ name: string; state: string; pincode: string | null }>;
  banks: Array<{ name: string; prefixes: string[] }>;
  nextCode: string;
  /** may the user open the Cities / Banks master to add a missing one */
  links: { cities: boolean; banks: boolean };
}

interface Contact {
  name: string;
  role: string;
  phone: string;
  email: string;
  isMain: boolean;
}
const blankContact = (): Contact => ({ name: '', role: '', phone: '', email: '', isMain: false });
const blankBank = { bankName: '', ifsc: '', accountNo: '', accountNoConfirm: '', holder: '' };
type ControlProps = {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
  onBlur: () => void;
};

/**
 * Add or change a vendor (docs/design/83, part 1; the checks: "As built — vendor checks"). Country,
 * state, city and bank are picked from the school's masters; a registered vendor's state follows its
 * GSTIN; a city fills its PIN. Every field is checked as it is left and again on saving, each problem
 * shown under its box (the API checks the same and answers per field). A new vendor's code is filled in
 * (left as it is, the next free one is given on saving) and it waits for a second person's approval.
 * On an approved vendor a new bank account, GSTIN, PAN or GST status becomes a change waiting for
 * approval (a reason asked). A GSTIN, PAN or bank account another vendor has is saved only with a reason.
 */
export function VendorForm({ vendor, lists }: { vendor: VendorDetail | null; lists: VendorLists }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const approved = vendor !== null && vendor.status !== 'pending' && vendor.status !== 'rejected';
  const indiaName = lists.countries.find((c) => c.code === 'IN')?.name ?? 'India';
  const [v, setV] = useState({
    code: vendor?.code ?? lists.nextCode,
    legalName: vendor?.legalName ?? '',
    tradeName: vendor?.tradeName ?? '',
    kind: vendor?.kind ?? 'dealer',
    gstStatus: vendor?.gstStatus ?? 'regular',
    gstin: vendor?.gstin ?? '',
    pan: vendor?.pan ?? '',
    msmeType: vendor?.msmeType ?? '',
    udyamNo: vendor?.udyamNo ?? '',
    address: vendor?.address ?? '',
    country: vendor?.country ?? indiaName,
    state: vendor?.state ?? '',
    city: vendor?.city ?? '',
    pin: vendor?.pin ?? '',
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    paymentTermId: vendor?.paymentTermId ?? '',
  });
  const [cats, setCats] = useState<string[]>(vendor?.categoryIds ?? []);
  const [contacts, setContacts] = useState<Contact[]>(
    vendor?.contacts.length
      ? vendor.contacts.map((c) => ({
          name: c.name,
          role: c.role ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          isMain: c.isMain,
        }))
      : [{ ...blankContact(), isMain: true }],
  );
  const [bankOn, setBankOn] = useState(!vendor);
  const [bank, setBank] = useState(blankBank);
  const [changeReason, setChangeReason] = useState('');
  const [dupReason, setDupReason] = useState('');
  const [dups, setDups] = useState<Array<{ code: string; name: string; field: string }> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** the boxes left once (their problems show), or all of them after a save was tried */
  const [touched, setTouched] = useState<Set<string> | 'all'>(new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const autoPin = useRef('');

  // the places of the country and state picked
  const country = lists.countries.find((c) => c.name === v.country) ?? null;
  const india = (country?.code ?? 'IN') === 'IN';
  const states = useMemo(
    () => lists.states.filter((s) => s.country === (country?.code ?? 'IN')),
    [lists.states, country],
  );
  const state = states.find((s) => s.name === v.state) ?? null;
  const cities = useMemo(
    () => (state ? lists.cities.filter((c) => c.state === state.code) : []),
    [lists.cities, state],
  );
  const gstinState =
    v.gstStatus !== 'unregistered' && /^[0-9]{2}/.test(v.gstin)
      ? (lists.states.find((s) => s.country === 'IN' && s.gstCode === v.gstin.slice(0, 2))?.name ??
        null)
      : null;
  const bankPrefixes = lists.banks.find((b) => b.name === bank.bankName)?.prefixes ?? [];

  const values: VendorFormValues = { ...v, contacts, bank: bankOn ? bank : blankBank };
  const problems = vendorProblems(values, {
    india,
    stateGst: state?.gstCode ?? null,
    gstinState,
    bankPrefixes,
    creating: vendor === null,
  });
  const shown = (path: string) =>
    serverErrors[path] ??
    (touched === 'all' || touched.has(path) ? (problems[path] ?? null) : null);
  const leave = (path: string) => () => setTouched((t) => (t === 'all' ? t : new Set(t).add(path)));
  const changed = (path: string) =>
    setServerErrors((e) => {
      if (!(path in e)) return e;
      const next = { ...e };
      delete next[path];
      return next;
    });

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    changed(k);
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  };
  const setGstin = (raw: string) => {
    const gstin = raw.toUpperCase().replace(/\s/g, '');
    changed('gstin');
    setV((cur) => {
      // a registered vendor's state is its GSTIN's: picked when the first two digits name one
      const st = /^[0-9]{2}/.test(gstin)
        ? lists.states.find((s) => s.country === 'IN' && s.gstCode === gstin.slice(0, 2))
        : undefined;
      return st && st.name !== cur.state
        ? { ...cur, gstin, country: indiaName, state: st.name, city: '' }
        : { ...cur, gstin };
    });
  };
  const setCity = (name: string) => {
    changed('city');
    const pin = cities.find((c) => c.name === name)?.pincode ?? '';
    setV((cur) => {
      // the city's PIN, unless one was typed by hand
      const fill = Boolean(pin) && (cur.pin === '' || cur.pin === autoPin.current);
      if (fill) autoPin.current = pin;
      return { ...cur, city: name, ...(fill ? { pin } : {}) };
    });
  };

  const sensitiveChanged =
    approved &&
    (v.gstStatus !== vendor?.gstStatus ||
      (v.gstin || null) !== vendor?.gstin ||
      (v.gstStatus === 'unregistered' && (v.pan || null) !== vendor?.pan) ||
      (v.gstStatus === 'unregistered' && v.state !== vendor?.state) ||
      (bankOn && bank.accountNo !== ''));

  const focusFirstProblem = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTouched('all');
    setServerErrors({});
    const count = Object.keys(problems).length;
    if (count) {
      setError(`Check the ${String(count)} field${count === 1 ? '' : 's'} marked in red.`);
      focusFirstProblem();
      return;
    }
    const bankFilled = bankOn && Object.values(bank).some((x) => x.trim() !== '');
    const body: Record<string, unknown> = {
      // a code left as filled in is made again on saving (someone may have taken it meanwhile)
      ...(vendor ? {} : { code: v.code.trim() === lists.nextCode ? '' : v.code.trim() }),
      legalName: v.legalName,
      tradeName: v.tradeName,
      kind: v.kind,
      gstStatus: v.gstStatus,
      gstin: v.gstStatus === 'unregistered' ? undefined : v.gstin,
      pan: v.gstStatus === 'unregistered' ? v.pan : undefined,
      ...(v.msmeType ? { msmeType: v.msmeType } : {}),
      udyamNo: v.udyamNo,
      address: v.address,
      country: v.country,
      state: v.state,
      city: v.city,
      pin: v.pin,
      phone: v.phone,
      email: v.email,
      ...(v.paymentTermId ? { paymentTermId: v.paymentTermId } : {}),
      categoryIds: cats,
      contacts: contacts
        .filter((c, i) => c.name.trim() || c.phone.trim() || c.email.trim() || i === 0)
        .map((c) => ({ ...c, role: c.role || undefined })),
      ...(bankFilled ? { bank } : {}),
      ...(sensitiveChanged && changeReason ? { changeReason } : {}),
      ...(dups && dupReason ? { duplicateReason: dupReason } : {}),
    };
    start(async () => {
      const r = await saveVendor(vendor?.id ?? null, body);
      if (r.ok) {
        const said = !vendor
          ? 'Vendor added: it waits for a second person’s approval'
          : r.changeWaiting
            ? 'Saved. The bank / GSTIN / PAN change waits for a second person’s approval'
            : 'Vendor saved';
        router.push(`/purchase/vendors/${r.id}?ok=1&detail=${encodeURIComponent(said)}`);
        return;
      }
      if (r.duplicates?.length) setDups(r.duplicates);
      if (r.fields && Object.keys(r.fields).length) {
        setServerErrors(r.fields);
        setError('Check the fields marked in red.');
        focusFirstProblem();
      } else setError(r.error);
    });
  };

  /** A box with its label, required mark, help and the problem under it. */
  const field = (
    path: string,
    label: string,
    control: (a: ControlProps) => React.ReactNode,
    opts: { required?: boolean; help?: React.ReactNode } = {},
  ) => {
    const id = `vf-${path.replace(/\./g, '-')}`;
    const problem = shown(path);
    const helpId = opts.help ? `${id}-help` : undefined;
    const errId = problem ? `${id}-err` : undefined;
    return (
      <div className="ep-field" key={path}>
        <label className="ep-field__label" htmlFor={id} data-required={opts.required || undefined}>
          {label}
        </label>
        {control({
          id,
          'aria-invalid': Boolean(problem),
          'aria-describedby': [helpId, errId].filter(Boolean).join(' ') || undefined,
          onBlur: leave(path),
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
  const addLink = (href: string, what: string) => (
    <>
      {' '}
      <a href={href} target="_blank" rel="noopener noreferrer">
        Add a {what} (opens a new tab)
      </a>
    </>
  );
  const bankStarted = Object.values(bank).some((x) => x.trim() !== '');
  const setB =
    (k: keyof typeof bank, upper = false) =>
    (e: { target: { value: string } }) => {
      changed(`bank.${k}`);
      setBank((b) => ({ ...b, [k]: upper ? e.target.value.toUpperCase() : e.target.value }));
    };
  const panShown =
    v.gstStatus === 'unregistered'
      ? v.pan
      : v.pan || (v.gstin.length >= 12 ? v.gstin.slice(2, 12) : '');

  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      <FormSection title="The vendor">
        <FormRow columns={3}>
          {field(
            'code',
            'Code',
            (a) => (
              <input
                {...a}
                className="ep-input"
                value={v.code}
                onChange={(e) => {
                  changed('code');
                  setV((c) => ({ ...c, code: e.target.value.toUpperCase() }));
                }}
                maxLength={20}
                readOnly={vendor !== null}
              />
            ),
            {
              help: vendor
                ? 'The code does not change.'
                : `The next free code (${lists.nextCode}); type the school’s own if it has one.`,
            },
          )}
          {field(
            'legalName',
            'Legal name',
            (a) => (
              <input
                {...a}
                className="ep-input"
                value={v.legalName}
                onChange={set('legalName')}
                maxLength={150}
                autoComplete="organization"
              />
            ),
            { required: true, help: 'As on the GST certificate or PAN.' },
          )}
          {field('tradeName', 'Trade name', (a) => (
            <input
              {...a}
              className="ep-input"
              value={v.tradeName}
              onChange={set('tradeName')}
              maxLength={150}
            />
          ))}
        </FormRow>
        <FormRow columns={3}>
          {field(
            'kind',
            'Kind',
            (a) => (
              <select {...a} className="ep-select" value={v.kind} onChange={set('kind')}>
                {Object.entries(VENDOR_KIND).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            ),
            { required: true },
          )}
          {field('paymentTermId', 'Payment term', (a) => (
            <select
              {...a}
              className="ep-select"
              value={v.paymentTermId}
              onChange={set('paymentTermId')}
            >
              <option value="">The school’s default</option>
              {lists.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          ))}
          <ChipPicker
            label="Supplies"
            options={lists.categories}
            value={cats}
            onChange={setCats}
            placeholder="Item categories"
            help="Offered for these categories on a PR"
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="GST and MSME"
        description={
          approved
            ? 'A change of the GST status, GSTIN or PAN waits for a second person’s approval.'
            : 'The GSTIN is checked (its last character too); the PAN and the state are read from it.'
        }
      >
        <FormRow columns={3}>
          {field(
            'gstStatus',
            'GST status',
            (a) => (
              <select {...a} className="ep-select" value={v.gstStatus} onChange={set('gstStatus')}>
                {Object.entries(GST_STATUS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            ),
            { required: true },
          )}
          {v.gstStatus !== 'unregistered'
            ? field(
                'gstin',
                'GSTIN',
                (a) => (
                  <input
                    {...a}
                    className="ep-input"
                    value={v.gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    maxLength={15}
                    placeholder="27ABCDE1234F1Z5"
                    autoComplete="off"
                  />
                ),
                {
                  required: true,
                  help: gstinState ? `A GSTIN of ${gstinState}.` : '15 characters.',
                },
              )
            : null}
          {field(
            'pan',
            'PAN',
            (a) => (
              <input
                {...a}
                className="ep-input"
                value={panShown}
                onChange={(e) => {
                  changed('pan');
                  setV((c) => ({ ...c, pan: e.target.value.toUpperCase() }));
                }}
                readOnly={v.gstStatus !== 'unregistered'}
                maxLength={10}
                placeholder="ABCDE1234F"
                autoComplete="off"
              />
            ),
            {
              required: v.gstStatus === 'unregistered' && india,
              help: v.gstStatus === 'unregistered' ? 'Needed for TDS.' : 'Read from the GSTIN.',
            },
          )}
        </FormRow>
        <FormRow columns={3}>
          {field(
            'msmeType',
            'MSME',
            (a) => (
              <select {...a} className="ep-select" value={v.msmeType} onChange={set('msmeType')}>
                <option value="">Not MSME / not known</option>
                <option value="micro">Micro</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
              </select>
            ),
            { help: 'Micro and small suppliers must be paid within 45 days (the PO warns).' },
          )}
          {field(
            'udyamNo',
            'Udyam number',
            (a) => (
              <input
                {...a}
                className="ep-input"
                value={v.udyamNo}
                onChange={(e) => {
                  changed('udyamNo');
                  setV((c) => ({ ...c, udyamNo: e.target.value.toUpperCase() }));
                }}
                placeholder="UDYAM-MH-12-1234567"
                autoComplete="off"
              />
            ),
            { required: Boolean(v.msmeType) },
          )}
        </FormRow>
      </FormSection>

      <FormSection
        title="Address"
        description="Country, state and city come from the school’s masters."
      >
        <FormRow columns={1}>
          {field(
            'address',
            'Address',
            (a) => (
              <input
                {...a}
                className="ep-input"
                value={v.address}
                onChange={set('address')}
                maxLength={500}
                placeholder="Building, street, area"
                autoComplete="street-address"
              />
            ),
            { required: true },
          )}
        </FormRow>
        <FormRow columns={4}>
          {field(
            'country',
            'Country',
            (a) => (
              <select
                {...a}
                className="ep-select"
                value={v.country}
                onChange={(e) => {
                  changed('country');
                  setV((c) => ({ ...c, country: e.target.value, state: '', city: '' }));
                }}
              >
                <option value="">—</option>
                {lists.countries.map((c) => (
                  <option key={c.code} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            ),
            { required: true },
          )}
          {field(
            'state',
            'State',
            (a) => (
              <select
                {...a}
                className="ep-select"
                value={v.state}
                onChange={(e) => {
                  changed('state');
                  setV((c) => ({ ...c, state: e.target.value, city: '' }));
                }}
              >
                <option value="">—</option>
                {states.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            ),
            {
              required: true,
              help: v.gstStatus !== 'unregistered' && india ? 'The GSTIN’s state.' : undefined,
            },
          )}
          {field(
            'city',
            'City',
            (a) => (
              <select
                {...a}
                className="ep-select"
                value={v.city}
                onChange={(e) => setCity(e.target.value)}
                disabled={!state}
              >
                <option value="">{state ? '—' : 'Pick the state first'}</option>
                {cities.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {/* a city saved before that the master no longer lists stays visible */}
                {v.city && !cities.some((c) => c.name === v.city) ? (
                  <option value={v.city}>{v.city}</option>
                ) : null}
              </select>
            ),
            {
              required: true,
              help: (
                <>
                  {state && !cities.length
                    ? `No cities of ${state.name} in the Cities master yet.`
                    : 'Not in the list? Add it in Masters → Cities first.'}
                  {lists.links.cities ? addLink('/masters/system?tab=cities', 'city') : null}
                </>
              ),
            },
          )}
          {field(
            'pin',
            india ? 'PIN' : 'Postal code',
            (a) => (
              <input
                {...a}
                className="ep-input"
                value={v.pin}
                onChange={set('pin')}
                inputMode={india ? 'numeric' : 'text'}
                maxLength={india ? 6 : 10}
                autoComplete="postal-code"
              />
            ),
            { required: true, help: india ? 'Filled from the city; six digits.' : undefined },
          )}
        </FormRow>
        <FormRow columns={2}>
          {field(
            'phone',
            'Mobile',
            (a) => (
              <input
                {...a}
                type="tel"
                className="ep-input"
                value={v.phone}
                onChange={set('phone')}
                maxLength={20}
                placeholder={india ? '98XXXXXXXX' : '+971 …'}
                autoComplete="tel"
              />
            ),
            {
              required: true,
              help: india ? '10 digits starting with 6, 7, 8 or 9.' : 'With the country code.',
            },
          )}
          {field(
            'email',
            'E-mail (the PO is sent here)',
            (a) => (
              <input
                {...a}
                type="email"
                className="ep-input"
                value={v.email}
                onChange={set('email')}
                maxLength={150}
                autoComplete="email"
              />
            ),
            { required: true },
          )}
        </FormRow>
      </FormSection>

      <FormSection title="Contacts" description="The main contact needs a name and a mobile.">
        <div className="ep-purch-lines">
          {contacts.map((c, i) => (
            <fieldset
              key={i}
              className="ep-purch-line"
              style={{ border: 0, padding: 0, alignItems: 'start' }}
            >
              <legend className="ep-sr-only">Contact {i + 1}</legend>
              {(
                [
                  ['name', 'Contact name', 'text', 'name'],
                  ['role', 'Role', 'text', 'organization-title'],
                  ['phone', 'Mobile', 'tel', 'tel'],
                  ['email', 'E-mail', 'email', 'email'],
                ] as const
              ).map(([k, label, type, auto]) =>
                field(
                  `contacts.${String(i)}.${k}`,
                  label,
                  (a) => (
                    <input
                      {...a}
                      type={type}
                      className="ep-input"
                      value={c[k]}
                      autoComplete={auto}
                      onChange={(e) => {
                        changed(`contacts.${String(i)}.${k}`);
                        setContacts((cur) =>
                          cur.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                        );
                      }}
                    />
                  ),
                  { required: c.isMain && (k === 'name' || k === 'phone') },
                ),
              )}
              <label className="ep-check" htmlFor={`vf-c${String(i)}-main`}>
                <input
                  id={`vf-c${String(i)}-main`}
                  className="ep-check__input"
                  type="radio"
                  name="vf-main"
                  checked={c.isMain}
                  onChange={() =>
                    setContacts((cur) => cur.map((x, j) => ({ ...x, isMain: j === i })))
                  }
                />
                <span className="ep-check__box" />
                Main contact
              </label>
            </fieldset>
          ))}
          {contacts.length < 5 ? (
            <div>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => setContacts((cur) => [...cur, blankContact()])}
              >
                Add a contact
              </button>
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormSection
        title="Bank account"
        description={
          vendor?.bankHint
            ? `Now: ${vendor.bankHint}.${approved ? ' A new account waits for a second person’s approval.' : ''}`
            : 'Optional now; once started, every part is needed. Stored encrypted, shown in full only to the approver.'
        }
      >
        {!bankOn ? (
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => setBankOn(true)}
            >
              {vendor?.bankHint ? 'Change the bank account' : 'Add the bank account'}
            </button>
          </div>
        ) : (
          <>
            <FormRow columns={3}>
              {field(
                'bank.bankName',
                'Bank',
                (a) => (
                  <select
                    {...a}
                    className="ep-select"
                    value={bank.bankName}
                    onChange={setB('bankName')}
                  >
                    <option value="">—</option>
                    {lists.banks.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ),
                {
                  required: bankStarted,
                  help: (
                    <>
                      From the Banks master.
                      {lists.links.banks ? addLink('/masters/fees?tab=banks', 'bank') : null}
                    </>
                  ),
                },
              )}
              {field(
                'bank.ifsc',
                'IFSC',
                (a) => (
                  <input
                    {...a}
                    className="ep-input"
                    value={bank.ifsc}
                    onChange={setB('ifsc', true)}
                    maxLength={11}
                    placeholder={bankPrefixes[0] ? `${bankPrefixes[0]}0XXXXXX` : 'SBIN0001234'}
                    autoComplete="off"
                  />
                ),
                { required: bankStarted, help: 'On the cheque leaf or passbook.' },
              )}
              {field(
                'bank.holder',
                'Account holder',
                (a) => (
                  <input
                    {...a}
                    className="ep-input"
                    value={bank.holder}
                    onChange={setB('holder')}
                    maxLength={120}
                    autoComplete="off"
                  />
                ),
                { required: bankStarted, help: 'The name as the bank has it.' },
              )}
            </FormRow>
            <FormRow columns={2}>
              {field(
                'bank.accountNo',
                'Account number',
                (a) => (
                  <input
                    {...a}
                    className="ep-input"
                    value={bank.accountNo}
                    onChange={setB('accountNo')}
                    inputMode="numeric"
                    maxLength={20}
                    autoComplete="off"
                  />
                ),
                { required: bankStarted, help: '9 to 18 digits.' },
              )}
              {field(
                'bank.accountNoConfirm',
                'Account number again',
                (a) => (
                  <input
                    {...a}
                    className="ep-input"
                    value={bank.accountNoConfirm}
                    onChange={setB('accountNoConfirm')}
                    inputMode="numeric"
                    maxLength={20}
                    autoComplete="off"
                    onPaste={(e) => e.preventDefault()}
                  />
                ),
                { required: bankStarted, help: 'Typed again, not pasted, to catch a slip.' },
              )}
            </FormRow>
          </>
        )}
      </FormSection>

      {sensitiveChanged ? (
        <label className="ep-field" htmlFor="vf-why">
          <span className="ep-field__label" data-required="true">
            Why the bank / GSTIN / PAN changes
          </span>
          <input
            id="vf-why"
            className="ep-input"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            maxLength={500}
          />
          <span className="ep-field__help">
            The approver reads it with the old and new details.
          </span>
        </label>
      ) : null}
      {dups ? (
        <label className="ep-field" htmlFor="vf-dup" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="ep-field__label" data-required="true">
            Why save it although{' '}
            {dups.map((d) => `its ${d.field} is ${d.code} ${d.name}’s`).join(', ')}
          </span>
          <input
            id="vf-dup"
            className="ep-input"
            value={dupReason}
            onChange={(e) => setDupReason(e.target.value)}
            maxLength={300}
            placeholder="e.g. second branch of the same firm"
          />
        </label>
      ) : null}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ marginTop: 'var(--sp-3)' }}>
          {error}
        </p>
      ) : null}
      <FormActions sticky>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : vendor ? 'Save' : 'Add vendor'}
        </button>
        <a
          className="ep-btn ep-btn--ghost"
          href={vendor ? `/purchase/vendors/${vendor.id}` : '/purchase/vendors'}
        >
          Cancel
        </a>
      </FormActions>
    </form>
  );
}
