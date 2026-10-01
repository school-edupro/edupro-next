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

/** The parent's own boxes that can copy their mobile or email. */
export const OWN = {
  whatsapp: (p: Party) => k(p, 'whatsapp_no'),
  sms: (p: Party) => k(p, 'mobile_for_sms_calls'),
  communication: (p: Party) => k(p, 'email_for_communication'),
  emergency: (p: Party) => k(p, 'emergency_contact'),
};

export function ownTicked(v: ProfileValues, p: Party, role: 'whatsapp' | 'sms' | 'communication') {
  const src = role === 'communication' ? emailOf(v, p) : mobileOf(v, p);
  return src !== '' && text(v[OWN[role](p)]) === src;
}

/** The family's contact boxes filled from the primary parent. */
export function primaryValues(v: ProfileValues, p: Party): ProfileValues {
  return {
    sms_mobile: text(v[OWN.sms(p)]) || mobileOf(v, p) || null,
    whatsapp_no: text(v[OWN.whatsapp(p)]) || mobileOf(v, p) || null,
    primary_email: text(v[OWN.communication(p)]) || emailOf(v, p) || null,
  };
}

/** Which parent the family's SMS number belongs to, if any. */
export function primaryParty(v: ProfileValues): Party | null {
  const sms = text(v.sms_mobile);
  if (!sms) return null;
  return PARTIES.find((p) => sms === mobileOf(v, p) || sms === text(v[OWN.sms(p)])) ?? null;
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
      ? [OWN.whatsapp(p), OWN.sms(p), 'sms_mobile', 'whatsapp_no', 'emergency_contact_mobile']
      : [OWN.communication(p), 'primary_email'];
  const out: ProfileValues = {};
  for (const t of targets) if (text(v[t]) === old) out[t] = next;
  return out;
}
