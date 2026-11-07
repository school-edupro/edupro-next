import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

/**
 * The vendor's field rules (docs/design/83, "As built — vendor checks", 7 Nov 2026), used by the form's
 * save and by every row of an Excel upload. The address takes its country, state and city from the
 * school's masters (a city only from the Cities master, under its state), the bank from the Banks
 * master (the IFSC must be that bank's). Required: legal name, address, country, state, city, PIN,
 * mobile, e-mail and a main contact with a name and a mobile; the PAN of an unregistered vendor in
 * India; a bank account is optional, but once started every part of it is. The admin form mirrors these
 * rules (apps/admin/lib/vendor-rules.ts) so the user sees them as they type; this is the one that counts.
 */

export const PIN_IN = /^[1-9][0-9]{5}$/;
export const POSTAL = /^[A-Z0-9][A-Z0-9 -]{2,9}$/;
export const MOBILE_IN = /^[6-9][0-9]{9}$/;
export const ACCOUNT_NO = /^[0-9]{9,18}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const HOLDER = /^[A-Za-z][A-Za-z0-9 .&'()/,-]{1,119}$/;
export const UDYAM = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** An Indian mobile as ten digits (a +91, 91 or 0 in front and spaces or hyphens dropped), else null. */
export function indianMobile(raw: string): string | null {
  const digits = raw
    .replace(/[\s-]/g, '')
    .replace(/^(\+91|91(?=[6-9][0-9]{9}$)|0(?=[6-9][0-9]{9}$))/, '');
  return MOBILE_IN.test(digits) ? digits : null;
}
/** A number outside India: + and 7 to 15 digits (spaces and hyphens allowed). */
const foreignPhone = (raw: string) => /^\+?[0-9][0-9 -]{6,18}$/.test(raw.trim());

export interface VendorFieldsIn {
  gstStatus?: string;
  pan?: string | null;
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  pin?: string;
  phone?: string;
  email?: string;
  msmeType?: string;
  udyamNo?: string;
  contacts?: Array<{
    name: string;
    role?: string;
    phone?: string;
    email?: string;
    isMain: boolean;
  }>;
  bank?: {
    accountNo: string;
    accountNoConfirm?: string;
    ifsc: string;
    bankName: string;
    holder: string;
  };
}

export interface VendorFieldsOut {
  country: string | null;
  state: string | null;
  /** the GST code of the state (India) */
  stateGst: string | null;
  city: string | null;
  pin: string | null;
  phone: string | null;
  contacts?: NonNullable<VendorFieldsIn['contacts']>;
  bank?: { accountNo: string; ifsc: string; bankName: string; holder: string };
}

/**
 * Checks a vendor's fields; every problem is named by its field (`errors: [{ path, message }]`, the
 * shape the form shows under each box). `creating`: the required fields must be there; on a change only
 * what is sent is checked (with the stored address for what is not). `gstState`: the state the GSTIN
 * says (a registered vendor), which the address state must be.
 */
export async function checkVendorFields(
  c: PoolClient,
  v: VendorFieldsIn,
  opts: {
    creating: boolean;
    gstState: string | null;
    stored?: { country: string | null; state: string | null; city: string | null };
  },
): Promise<VendorFieldsOut> {
  const errors: Array<{ path: string; message: string }> = [];
  const fail = (path: string, message: string) => {
    if (!errors.some((e) => e.path === path)) errors.push({ path, message });
  };
  const need = (path: string, value: unknown, label: string) => {
    if (opts.creating && (value === undefined || value === null || value === ''))
      fail(path, `${label} is required`);
  };
  need('address', v.address, 'The address');
  need('country', v.country, 'The country');
  need('state', v.state, 'The state');
  need('city', v.city, 'The city');
  need('pin', v.pin, 'The PIN');
  need('phone', v.phone, 'The mobile');
  need('email', v.email, 'The e-mail');
  if (v.address !== undefined && v.address.trim().length < 5)
    fail('address', 'The address needs at least 5 characters');

  // the place, from the school's masters
  const touchesPlace = [v.country, v.state, v.city].some((x) => x !== undefined);
  const countryName = v.country ?? opts.stored?.country ?? null;
  const stateName = v.state ?? opts.stored?.state ?? null;
  const cityName = v.city ?? opts.stored?.city ?? null;
  let country: { id: string; code: string; name: string } | null = null;
  let state: { id: string; name: string; gst: string | null } | null = null;
  let city: { name: string; pincode: string | null } | null = null;
  if (countryName) {
    country =
      (
        await c.query<{ id: string; code: string; name: string }>(
          `SELECT id::text, code, name FROM countries
            WHERE status = 'active' AND (lower(name) = lower($1) OR upper(code) = upper($1)) ORDER BY id LIMIT 1`,
          [countryName.trim()],
        )
      ).rows[0] ?? null;
    if (!country)
      fail('country', `${countryName} is not in the Countries master: pick from the list`);
  }
  if (country && stateName) {
    state =
      (
        await c.query<{ id: string; name: string; gst: string | null }>(
          `SELECT id::text, name, gst_code AS gst FROM states
            WHERE status = 'active' AND country_id = $1
              AND (lower(name) = lower($2) OR upper(code) = upper($2) OR gst_code = $2) ORDER BY id LIMIT 1`,
          [country.id, stateName.trim()],
        )
      ).rows[0] ?? null;
    if (!state)
      fail('state', `${stateName} is not a state of ${country.name} in the States master`);
  }
  if (state && cityName) {
    city =
      (
        await c.query<{ name: string; pincode: string | null }>(
          `SELECT name, pincode FROM cities
            WHERE status = 'active' AND state_id = $1 AND lower(name) = lower($2) ORDER BY id LIMIT 1`,
          // a cell from the Excel list reads "Noida · Uttar Pradesh": the city is the first part
          [state.id, cityName.split(' · ')[0]!.trim()],
        )
      ).rows[0] ?? null;
    if (!city)
      fail(
        'city',
        `${cityName.split(' · ')[0]!.trim()} is not in the Cities master under ${state.name}: add it there first (Masters → Cities)`,
      );
  }
  const india = (country?.code ?? 'IN').toUpperCase() === 'IN';
  if (
    state &&
    india &&
    opts.gstState &&
    state.gst !== opts.gstState &&
    (touchesPlace || opts.creating)
  )
    fail(
      'state',
      `The GSTIN is of the state with GST code ${opts.gstState}, not ${state.name}: pick the GSTIN's state`,
    );
  if (!india && v.gstStatus && v.gstStatus !== 'unregistered')
    fail('gstStatus', 'A vendor outside India has no GST registration here: choose unregistered');

  // PIN, mobile, e-mail
  let pin: string | null = null;
  if (v.pin) {
    pin = v.pin.trim().toUpperCase();
    if (india ? !PIN_IN.test(pin) : !POSTAL.test(pin))
      fail(
        'pin',
        india
          ? 'A PIN is six digits, not starting with 0'
          : 'A postal code of 3 to 10 letters or digits',
      );
  }
  let phone: string | null = null;
  if (v.phone) {
    phone = india ? indianMobile(v.phone) : foreignPhone(v.phone) ? v.phone.trim() : null;
    if (!phone)
      fail(
        'phone',
        india
          ? 'A 10-digit mobile number starting with 6, 7, 8 or 9'
          : 'A phone number with its country code',
      );
  }

  // the PAN of an unregistered vendor in India (TDS needs it); MSME needs its Udyam number and back
  if (opts.creating && india && v.gstStatus === 'unregistered' && !v.pan)
    fail('pan', 'The PAN of an unregistered vendor is required');
  if (v.pan && !PAN.test(v.pan)) fail('pan', 'A PAN is five letters, four digits and a letter');
  if (v.msmeType && !v.udyamNo) fail('udyamNo', 'An MSME vendor needs its Udyam number');
  if (v.udyamNo && !UDYAM.test(v.udyamNo))
    fail('udyamNo', 'The Udyam number looks like UDYAM-MH-12-1234567');
  if (v.udyamNo && !v.msmeType)
    fail('msmeType', 'Choose micro, small or medium for a Udyam number');

  // contacts: the main one (the first when none is ticked) with a name and a mobile
  let contacts: VendorFieldsOut['contacts'];
  if (v.contacts) {
    const list = v.contacts.filter((x) => x.name.trim() || x.phone?.trim() || x.email?.trim());
    if (!list.length && opts.creating)
      fail('contacts.0.name', 'The main contact’s name is required');
    const mainAt = Math.max(
      0,
      list.findIndex((x) => x.isMain),
    );
    contacts = list.map((x, i) => {
      const main = i === mainAt;
      if (!x.name.trim()) fail(`contacts.${String(i)}.name`, 'The contact’s name is required');
      let p: string | null = null;
      if (x.phone?.trim()) {
        p = india ? indianMobile(x.phone) : foreignPhone(x.phone) ? x.phone.trim() : null;
        if (!p)
          fail(
            `contacts.${String(i)}.phone`,
            india
              ? 'A 10-digit mobile number starting with 6, 7, 8 or 9'
              : 'A phone number with its country code',
          );
      } else if (main) fail(`contacts.${String(i)}.phone`, 'The main contact’s mobile is required');
      return { ...x, isMain: main, phone: p ?? undefined };
    });
  }

  // the bank account: a bank of the Banks master, its IFSC, the number twice, the holder
  let bank: VendorFieldsOut['bank'];
  if (v.bank) {
    const b = v.bank;
    const banks = await c.query<{ name: string; ifsc: string | null }>(
      `SELECT name, ifsc FROM banks WHERE status = 'active' AND lower(name) = lower($1)`,
      [b.bankName.trim()],
    );
    if (!banks.rowCount)
      fail('bank.bankName', `${b.bankName} is not in the Banks master: pick from the list`);
    const ifsc = b.ifsc.trim().toUpperCase();
    if (!IFSC.test(ifsc))
      fail('bank.ifsc', 'An IFSC is four letters, a zero and six letters or digits (SBIN0001234)');
    else {
      const prefixes = [
        ...new Set(banks.rows.filter((x) => x.ifsc).map((x) => x.ifsc!.slice(0, 4).toUpperCase())),
      ];
      if (prefixes.length && !prefixes.includes(ifsc.slice(0, 4)))
        fail(
          'bank.ifsc',
          `This IFSC is not of ${banks.rows[0]!.name} (its IFSCs start ${prefixes.join(' / ')})`,
        );
    }
    const accountNo = b.accountNo.replace(/\s/g, '');
    if (!ACCOUNT_NO.test(accountNo)) fail('bank.accountNo', 'An account number is 9 to 18 digits');
    if (b.accountNoConfirm !== undefined && b.accountNoConfirm.replace(/\s/g, '') !== accountNo)
      fail('bank.accountNoConfirm', 'The two account numbers differ');
    if (!HOLDER.test(b.holder.trim()))
      fail('bank.holder', 'The account holder’s name, as the bank has it');
    bank = {
      accountNo,
      ifsc,
      bankName: banks.rows[0]?.name ?? b.bankName.trim(),
      holder: b.holder.trim(),
    };
  }

  if (errors.length)
    throw new DomainError('validation-failed', errors.map((e) => e.message).join('; '), {
      status: 400,
      extra: { errors },
    });
  return {
    country: country?.name ?? null,
    state: state?.name ?? null,
    stateGst: india ? (state?.gst ?? null) : null,
    city: city?.name ?? null,
    pin,
    phone,
    ...(contacts ? { contacts } : {}),
    ...(bank ? { bank } : {}),
  };
}
