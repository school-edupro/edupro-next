/**
 * GSTIN checks (docs/design/83, part 1): the 15-character format — the state code (2 digits), the PAN
 * (10), the entity number, "Z", and a check character worked out from the first 14 by Luhn mod 36 (as
 * python-stdnum's `in_.gstin`). A well-formed GSTIN is not proof of registration: only the GST portal
 * can say that.
 */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** The GST state codes (the first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

/** Luhn mod 36 over the characters, right to left (every second one doubled, its digits in base 36 added). */
function checksum(text: string): number {
  const n = ALPHABET.length;
  const values = [...text].reverse().map((ch) => ALPHABET.indexOf(ch));
  let sum = 0;
  values.forEach((v, i) => {
    if (i % 2 === 0) sum += v;
    else {
      const d = v * 2;
      sum += Math.floor(d / n) + (d % n);
    }
  });
  return sum % n;
}

/** The check character of the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14: string): string {
  const ck = checksum(`${first14}${ALPHABET[0]!}`);
  return ALPHABET[(ALPHABET.length - ck) % ALPHABET.length]!;
}

export type GstinProblem = 'format' | 'state' | 'check';

/** Why a GSTIN is not well formed (null when it is). */
export function gstinProblem(gstin: string): GstinProblem | null {
  if (!FORMAT.test(gstin)) return 'format';
  if (!GST_STATES[gstin.slice(0, 2)]) return 'state';
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return 'check';
  return null;
}

export const GSTIN_HELP: Record<GstinProblem, string> = {
  format:
    'A GSTIN has 15 characters: the state code, the PAN, the entity number, Z and a check character',
  state: 'The first two digits are not a GST state code',
  check: 'The last character does not match: a character is mistyped',
};

/** The PAN inside a GSTIN (characters 3–12). */
export const panOfGstin = (gstin: string): string => gstin.slice(2, 12);
