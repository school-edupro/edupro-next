/**
 * The vendor form's rules, shown as the user types (docs/design/83, "As built — vendor checks"). The
 * API's apps/api/src/modules/purchase/vendor-rules.ts is the one that counts (and checks the masters
 * again); keep the two alike. Problems are keyed by the same paths the API uses (city, bank.ifsc,
 * contacts.0.phone …), so the server's answer lands under the same boxes.
 */

export const PIN_IN = /^[1-9][0-9]{5}$/;
export const POSTAL = /^[A-Z0-9][A-Z0-9 -]{2,9}$/;
export const MOBILE_IN = /^[6-9][0-9]{9}$/;
export const ACCOUNT_NO = /^[0-9]{9,18}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const HOLDER = /^[A-Za-z][A-Za-z0-9 .&'()/,-]{1,119}$/;
export const UDYAM = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const CODE = /^[A-Z0-9_-]{1,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** An Indian mobile as ten digits (a +91, 91 or 0 in front and spaces or hyphens dropped), else null. */
export function indianMobile(raw: string): string | null {
  const digits = raw
    .replace(/[\s-]/g, '')
    .replace(/^(\+91|91(?=[6-9][0-9]{9}$)|0(?=[6-9][0-9]{9}$))/, '');
  return MOBILE_IN.test(digits) ? digits : null;
}
const foreignPhone = (raw: string) => /^\+?[0-9][0-9 -]{6,18}$/.test(raw.trim());

export interface VendorFormValues {
  code: string;
  legalName: string;
  gstStatus: string;
  gstin: string;
  pan: string;
  msmeType: string;
  udyamNo: string;
  address: string;
  country: string;
  state: string;
  city: string;
  pin: string;
  phone: string;
  email: string;
  contacts: Array<{ name: string; phone: string; email: string; isMain: boolean }>;
  /** the bank part is checked only once something of it is typed */
  bank: {
    bankName: string;
    ifsc: string;
    accountNo: string;
    accountNoConfirm: string;
    holder: string;
  };
}

/** What the rules need from the lists: is the country India, the state's GST code, the bank's IFSCs. */
export interface VendorRuleContext {
  india: boolean;
  /** the GST code of the state picked (India) */
  stateGst: string | null;
  /** the state's name the GSTIN's first two digits stand for */
  gstinState: string | null;
  /** the first four letters of the IFSCs of the bank picked (empty: not known) */
  bankPrefixes: string[];
  creating: boolean;
}

export function vendorProblems(v: VendorFormValues, x: VendorRuleContext): Record<string, string> {
  const out: Record<string, string> = {};
  const fail = (path: string, message: string) => {
    if (!out[path]) out[path] = message;
  };
  const blank = (s: string) => s.trim() === '';
  if (x.creating && !blank(v.code) && !CODE.test(v.code.trim().toUpperCase()))
    fail('code', 'Capital letters, digits, hyphen or underscore, up to 20');
  if (v.legalName.trim().length < 2) fail('legalName', 'The legal name is required');
  if (v.gstStatus !== 'unregistered') {
    if (!x.india)
      fail('gstStatus', 'A vendor outside India has no GST registration here: choose unregistered');
    if (blank(v.gstin)) fail('gstin', 'A registered vendor needs its GSTIN');
    else if (!GSTIN_SHAPE.test(v.gstin.trim()))
      fail('gstin', '15 characters: state code, PAN, entity number, Z, check character');
    else if (x.gstinState === null) fail('gstin', 'The first two digits are not a state code');
  } else if (x.india && blank(v.pan)) fail('pan', 'The PAN of an unregistered vendor is required');
  if (!blank(v.pan) && !PAN.test(v.pan.trim()))
    fail('pan', 'Five letters, four digits and a letter');
  if (v.msmeType && blank(v.udyamNo)) fail('udyamNo', 'An MSME vendor needs its Udyam number');
  if (!blank(v.udyamNo) && !UDYAM.test(v.udyamNo.trim()))
    fail('udyamNo', 'Looks like UDYAM-MH-12-1234567');
  if (!blank(v.udyamNo) && !v.msmeType) fail('msmeType', 'Choose micro, small or medium');

  if (v.address.trim().length < 5)
    fail('address', 'The address is required (at least 5 characters)');
  if (blank(v.country)) fail('country', 'Pick the country');
  if (blank(v.state)) fail('state', 'Pick the state');
  else if (x.india && v.gstStatus !== 'unregistered' && x.gstinState && x.gstinState !== v.state)
    fail('state', `The GSTIN is of ${x.gstinState}`);
  if (blank(v.city)) fail('city', 'Pick the city');
  if (blank(v.pin)) fail('pin', 'The PIN is required');
  else if (x.india ? !PIN_IN.test(v.pin.trim()) : !POSTAL.test(v.pin.trim().toUpperCase()))
    fail('pin', x.india ? 'Six digits, not starting with 0' : '3 to 10 letters or digits');
  if (blank(v.phone)) fail('phone', 'The mobile is required');
  else if (x.india ? !indianMobile(v.phone) : !foreignPhone(v.phone))
    fail(
      'phone',
      x.india
        ? 'Not a mobile number: 10 digits starting with 6, 7, 8 or 9'
        : 'A number with its country code',
    );
  if (blank(v.email)) fail('email', 'The e-mail is required (the purchase order is sent here)');
  else if (!EMAIL.test(v.email.trim())) fail('email', 'An e-mail address like sales@firm.in');

  const mainAt = Math.max(
    0,
    v.contacts.findIndex((c) => c.isMain),
  );
  v.contacts.forEach((c, i) => {
    const used = !blank(c.name) || !blank(c.phone) || !blank(c.email) || i === mainAt;
    if (!used) return;
    if (c.name.trim().length < 2)
      fail(`contacts.${String(i)}.name`, 'The contact’s name is required');
    if (blank(c.phone)) {
      if (i === mainAt)
        fail(`contacts.${String(i)}.phone`, 'The main contact’s mobile is required');
    } else if (x.india ? !indianMobile(c.phone) : !foreignPhone(c.phone))
      fail(
        `contacts.${String(i)}.phone`,
        x.india
          ? 'Not a mobile number: 10 digits starting with 6, 7, 8 or 9'
          : 'A number with its country code',
      );
    if (!blank(c.email) && !EMAIL.test(c.email.trim()))
      fail(`contacts.${String(i)}.email`, 'An e-mail address');
  });

  const b = v.bank;
  if (Object.values(b).some((s) => !blank(s))) {
    if (blank(b.bankName)) fail('bank.bankName', 'Pick the bank');
    const ifsc = b.ifsc.trim().toUpperCase();
    if (!IFSC.test(ifsc))
      fail('bank.ifsc', 'Four letters, a zero, six letters or digits (SBIN0001234)');
    else if (x.bankPrefixes.length && !x.bankPrefixes.includes(ifsc.slice(0, 4)))
      fail('bank.ifsc', `Not this bank’s IFSC (its IFSCs start ${x.bankPrefixes.join(' / ')})`);
    const no = b.accountNo.replace(/\s/g, '');
    if (!ACCOUNT_NO.test(no)) fail('bank.accountNo', 'Not an account number: 9 to 18 digits');
    if (b.accountNoConfirm.replace(/\s/g, '') !== no)
      fail('bank.accountNoConfirm', 'The two account numbers differ');
    if (!HOLDER.test(b.holder.trim()))
      fail('bank.holder', 'The account holder’s name, as the bank has it');
  }
  return out;
}
