'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { ChipPicker } from '@/components/ChipPicker';
import { saveVendor } from '@/lib/purchase-actions';
import { GST_STATES, GST_STATUS, VENDOR_KIND, type VendorDetail } from '@/lib/purchase';

interface Contact {
  name: string;
  role: string;
  phone: string;
  email: string;
  isMain: boolean;
}
const blankContact = (): Contact => ({ name: '', role: '', phone: '', email: '', isMain: false });

/**
 * Add or change a vendor (docs/design/83, part 1). A new vendor waits for a second person's approval.
 * On an approved vendor, a new bank account, GSTIN, PAN or GST status becomes a change waiting for
 * approval (a reason asked); everything else changes at once. A GSTIN, PAN or bank account another
 * vendor has is saved only with a reason. What was typed stays on the form when the API refuses.
 */
export function VendorForm({
  vendor,
  terms,
  categories,
}: {
  vendor: VendorDetail | null;
  terms: Array<{ id: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const approved = vendor !== null && vendor.status !== 'pending' && vendor.status !== 'rejected';
  const [v, setV] = useState({
    code: vendor?.code ?? '',
    legalName: vendor?.legalName ?? '',
    tradeName: vendor?.tradeName ?? '',
    kind: vendor?.kind ?? 'dealer',
    gstStatus: vendor?.gstStatus ?? 'regular',
    gstin: vendor?.gstin ?? '',
    pan: vendor?.pan ?? '',
    stateCode: vendor?.stateCode ?? '',
    msmeType: vendor?.msmeType ?? '',
    udyamNo: vendor?.udyamNo ?? '',
    address: vendor?.address ?? '',
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
  const [bank, setBank] = useState({ accountNo: '', ifsc: '', bankName: '', holder: '' });
  const [changeReason, setChangeReason] = useState('');
  const [dupReason, setDupReason] = useState('');
  const [dups, setDups] = useState<Array<{ code: string; name: string; field: string }> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  const sensitiveChanged =
    approved &&
    (v.gstStatus !== vendor?.gstStatus ||
      (v.gstin || null) !== vendor?.gstin ||
      (v.gstStatus === 'unregistered' && (v.pan || null) !== vendor?.pan) ||
      (bankOn && bank.accountNo !== ''));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const bankFilled = bankOn && Object.values(bank).some((x) => x.trim() !== '');
    const body: Record<string, unknown> = {
      ...(vendor ? {} : { code: v.code }),
      legalName: v.legalName,
      tradeName: v.tradeName,
      kind: v.kind,
      gstStatus: v.gstStatus,
      gstin: v.gstStatus === 'unregistered' ? undefined : v.gstin,
      pan: v.pan,
      ...(v.gstStatus === 'unregistered' && v.stateCode ? { stateCode: v.stateCode } : {}),
      ...(v.msmeType ? { msmeType: v.msmeType } : {}),
      udyamNo: v.udyamNo,
      address: v.address,
      city: v.city,
      pin: v.pin,
      phone: v.phone,
      email: v.email,
      ...(v.paymentTermId ? { paymentTermId: v.paymentTermId } : {}),
      categoryIds: cats,
      contacts: contacts
        .filter((c) => c.name.trim())
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
      setError(r.error);
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <FormSection title="The vendor">
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="vf-code">
            <span className="ep-field__label" data-required="true">
              Code
            </span>
            <input
              id="vf-code"
              className="ep-input"
              value={v.code}
              onChange={set('code')}
              required
              maxLength={20}
              readOnly={vendor !== null}
              placeholder="V001"
            />
          </label>
          <label className="ep-field" htmlFor="vf-legal">
            <span className="ep-field__label" data-required="true">
              Legal name
            </span>
            <input
              id="vf-legal"
              className="ep-input"
              value={v.legalName}
              onChange={set('legalName')}
              required
              maxLength={150}
            />
          </label>
          <label className="ep-field" htmlFor="vf-trade">
            <span className="ep-field__label">Trade name</span>
            <input
              id="vf-trade"
              className="ep-input"
              value={v.tradeName}
              onChange={set('tradeName')}
              maxLength={150}
            />
          </label>
        </FormRow>
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="vf-kind">
            <span className="ep-field__label">Kind</span>
            <select id="vf-kind" className="ep-select" value={v.kind} onChange={set('kind')}>
              {Object.entries(VENDOR_KIND).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="vf-term">
            <span className="ep-field__label">Payment term</span>
            <select
              id="vf-term"
              className="ep-select"
              value={v.paymentTermId}
              onChange={set('paymentTermId')}
            >
              <option value="">The school’s default</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <ChipPicker
            label="Supplies"
            options={categories}
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
          <label className="ep-field" htmlFor="vf-gst">
            <span className="ep-field__label">GST status</span>
            <select
              id="vf-gst"
              className="ep-select"
              value={v.gstStatus}
              onChange={set('gstStatus')}
            >
              {Object.entries(GST_STATUS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {v.gstStatus !== 'unregistered' ? (
            <label className="ep-field" htmlFor="vf-gstin">
              <span className="ep-field__label" data-required="true">
                GSTIN
              </span>
              <input
                id="vf-gstin"
                className="ep-input"
                value={v.gstin}
                onChange={(e) => setV((c) => ({ ...c, gstin: e.target.value.toUpperCase() }))}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
              />
            </label>
          ) : (
            <label className="ep-field" htmlFor="vf-state">
              <span className="ep-field__label">State</span>
              <select
                id="vf-state"
                className="ep-select"
                value={v.stateCode}
                onChange={set('stateCode')}
              >
                <option value="">—</option>
                {GST_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ep-field" htmlFor="vf-pan">
            <span className="ep-field__label">PAN</span>
            <input
              id="vf-pan"
              className="ep-input"
              value={v.pan}
              onChange={(e) => setV((c) => ({ ...c, pan: e.target.value.toUpperCase() }))}
              maxLength={10}
              placeholder={v.gstStatus === 'unregistered' ? 'ABCDE1234F' : 'From the GSTIN'}
            />
          </label>
        </FormRow>
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="vf-msme">
            <span className="ep-field__label">MSME</span>
            <select
              id="vf-msme"
              className="ep-select"
              value={v.msmeType}
              onChange={set('msmeType')}
            >
              <option value="">Not MSME / not known</option>
              <option value="micro">Micro</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
            </select>
            <span className="ep-field__help">
              Micro and small suppliers must be paid within 45 days (the PO warns).
            </span>
          </label>
          <label className="ep-field" htmlFor="vf-udyam">
            <span className="ep-field__label">Udyam number</span>
            <input
              id="vf-udyam"
              className="ep-input"
              value={v.udyamNo}
              onChange={(e) => setV((c) => ({ ...c, udyamNo: e.target.value.toUpperCase() }))}
              placeholder="UDYAM-MH-12-1234567"
            />
          </label>
        </FormRow>
      </FormSection>

      <FormSection title="Address and contacts">
        <FormRow columns={4}>
          <label className="ep-field" htmlFor="vf-addr">
            <span className="ep-field__label">Address</span>
            <input id="vf-addr" className="ep-input" value={v.address} onChange={set('address')} />
          </label>
          <label className="ep-field" htmlFor="vf-city">
            <span className="ep-field__label">City</span>
            <input id="vf-city" className="ep-input" value={v.city} onChange={set('city')} />
          </label>
          <label className="ep-field" htmlFor="vf-pin">
            <span className="ep-field__label">PIN</span>
            <input
              id="vf-pin"
              className="ep-input"
              value={v.pin}
              onChange={set('pin')}
              inputMode="numeric"
              maxLength={6}
            />
          </label>
          <label className="ep-field" htmlFor="vf-phone">
            <span className="ep-field__label">Phone</span>
            <input
              id="vf-phone"
              type="tel"
              className="ep-input"
              value={v.phone}
              onChange={set('phone')}
            />
          </label>
        </FormRow>
        <FormRow columns={2}>
          <label className="ep-field" htmlFor="vf-email">
            <span className="ep-field__label">E-mail (the PO is sent here)</span>
            <input
              id="vf-email"
              type="email"
              className="ep-input"
              value={v.email}
              onChange={set('email')}
            />
          </label>
        </FormRow>
        <div className="ep-purch-lines">
          {contacts.map((c, i) => (
            <fieldset key={i} className="ep-purch-line" style={{ border: 0, padding: 0 }}>
              <legend className="ep-sr-only">Contact {i + 1}</legend>
              {(
                [
                  ['name', 'Contact name'],
                  ['role', 'Role'],
                  ['phone', 'Phone'],
                  ['email', 'E-mail'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="ep-field" htmlFor={`vf-c${String(i)}-${k}`}>
                  <span className="ep-field__label">{label}</span>
                  <input
                    id={`vf-c${String(i)}-${k}`}
                    className="ep-input"
                    value={c[k]}
                    onChange={(e) =>
                      setContacts((cur) =>
                        cur.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                      )
                    }
                  />
                </label>
              ))}
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
            : 'Used for payments later; stored encrypted, shown only to the approver in full.'
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
          <FormRow columns={4}>
            {(
              [
                ['accountNo', 'Account number', 'numeric'],
                ['ifsc', 'IFSC', 'text'],
                ['bankName', 'Bank', 'text'],
                ['holder', 'Account holder', 'text'],
              ] as const
            ).map(([k, label, mode]) => (
              <label key={k} className="ep-field" htmlFor={`vf-b-${k}`}>
                <span className="ep-field__label">{label}</span>
                <input
                  id={`vf-b-${k}`}
                  className="ep-input"
                  inputMode={mode}
                  autoComplete="off"
                  value={bank[k]}
                  onChange={(e) =>
                    setBank((b) => ({
                      ...b,
                      [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </FormRow>
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
