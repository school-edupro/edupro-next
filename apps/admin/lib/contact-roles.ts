import type { ProfileValues } from './profile';

/**
 * Contact roles on the student profile: which of a parent's numbers and emails also serve as their
 * WhatsApp, SMS and communication contact, who the family's primary and emergency contact is. Nothing
 * extra is stored: a role is "ticked" when its box holds the same value as the parent's own.
 */
export type Party = 'father' | 'mother' | 'guardian';
export const PARTIES: Party[] = ['father', 'mother', 'guardian'];

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const k = (p: Party, f: string) => `${p}_${f}`;

export const mobileOf = (v: ProfileValues, p: Party) => text(v[k(p, 'mobile')]);
export const emailOf = (v: ProfileValues, p: Party) => text(v[k(p, 'email')]);
export const nameOf = (v: ProfileValues, p: Party) => text(v[k(p, 'name')]);

/**
 * The parent's own role boxes: WhatsApp holds a number (a copy of the mobile); SMS / calls,
 * communication email and emergency contact are Yes / No switches.
 */
export const OWN = {
  whatsapp: (p: Party) => k(p, 'whatsapp_no'),
  sms: (p: Party) => k(p, 'mobile_for_sms_calls'),
  communication: (p: Party) => k(p, 'email_for_communication'),
  emergency: (p: Party) => k(p, 'emergency_contact'),
};

export function ownTicked(v: ProfileValues, p: Party, role: 'whatsapp' | 'sms' | 'communication') {
  if (role !== 'whatsapp') return text(v[OWN[role](p)]) === 'Yes';
  const mobile = mobileOf(v, p);
  return mobile !== '' && text(v[OWN.whatsapp(p)]) === mobile;
}

/** The value a role box takes when ticked or un-ticked. */
export function ownValue(
  v: ProfileValues,
  p: Party,
  role: 'whatsapp' | 'sms' | 'communication',
  on: boolean,
): string | null {
  if (role === 'whatsapp') return on ? mobileOf(v, p) || null : null;
  return on ? 'Yes' : 'No';
}

/** The family's contact boxes filled from the primary parent. */
export function primaryValues(v: ProfileValues, p: Party): ProfileValues {
  const out: ProfileValues = {
    sms_mobile: mobileOf(v, p) || null,
    whatsapp_no: text(v[OWN.whatsapp(p)]) || mobileOf(v, p) || null,
    primary_email: emailOf(v, p) || null,
  };
  // the primary parent receives school SMS / calls and emails
  if (mobileOf(v, p)) out[OWN.sms(p)] = 'Yes';
  if (emailOf(v, p)) out[OWN.communication(p)] = 'Yes';
  return out;
}

/** Which parent the family's SMS number belongs to, if any. */
export function primaryParty(v: ProfileValues): Party | null {
  const sms = text(v.sms_mobile);
  if (!sms) return null;
  return PARTIES.find((p) => sms === mobileOf(v, p)) ?? null;
}

const relationOf = (v: ProfileValues, p: Party) =>
  p === 'father' ? 'Father' : p === 'mother' ? 'Mother' : text(v.guardian_relation) || 'Other';

/** The family's emergency contact filled from one parent (name, relation, mobile). */
export function emergencyValues(v: ProfileValues, p: Party): ProfileValues {
  const out: ProfileValues = {
    emergency_contact_name: nameOf(v, p) || null,
    emergency_contact_relation: relationOf(v, p),
    emergency_contact_mobile: mobileOf(v, p) || null,
  };
  for (const q of PARTIES) if (nameOf(v, q)) out[OWN.emergency(q)] = q === p ? 'Yes' : 'No';
  return out;
}

export function emergencyParty(v: ProfileValues): Party | null {
  const m = text(v.emergency_contact_mobile);
  return m ? (PARTIES.find((p) => m === mobileOf(v, p)) ?? null) : null;
}

/**
 * When a parent's mobile or email changes, every box that was copying the old value follows it, so
 * the WhatsApp, SMS, communication, primary and emergency contacts stay right without retyping.
 */
export function followChange(v: ProfileValues, key: string, next: string | null): ProfileValues {
  const m = /^(father|mother|guardian)_(mobile|email)$/.exec(key);
  if (!m) return {};
  const p = m[1] as Party;
  const old = text(v[key]);
  if (!old) return {};
  const targets =
    m[2] === 'mobile'
      ? [OWN.whatsapp(p), 'sms_mobile', 'whatsapp_no', 'emergency_contact_mobile']
      : ['primary_email'];
  const out: ProfileValues = {};
  for (const t of targets) if (text(v[t]) === old) out[t] = next;
  return out;
}
