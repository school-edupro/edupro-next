'use client';
import {
  OWN,
  PARTIES,
  emailOf,
  emergencyParty,
  emergencyValues,
  mobileOf,
  nameOf,
  ownTicked,
  ownValue,
  primaryParty,
  primaryValues,
  type Party,
} from '@/lib/contact-roles';
import type { ProfileValues } from '@/lib/profile';

const LABEL: Record<Party, string> = { father: 'Father', mother: 'Mother', guardian: 'Guardian' };

/** Ticks at the top of a parent's section: what their mobile and email are also used for. */
export function ParentContactRoles({
  party,
  values,
  disabled,
  set,
}: {
  party: Party;
  values: ProfileValues;
  disabled?: boolean;
  set: (patch: ProfileValues) => void;
}) {
  const mobile = mobileOf(values, party);
  const email = emailOf(values, party);
  const who = LABEL[party];
  const tick = (
    id: string,
    label: string,
    checked: boolean,
    enabled: boolean,
    onToggle: (on: boolean) => void,
  ) => (
    <label className="ep-roles__tick" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled || !enabled}
        onChange={(e) => onToggle(e.target.checked)}
      />{' '}
      {label}
    </label>
  );
  return (
    <fieldset className="ep-roles" aria-describedby={`roles-${party}-help`}>
      <legend>{who}&rsquo;s contact roles</legend>
      <div className="ep-roles__row">
        <span className="ep-roles__what">
          Mobile <strong>{mobile || 'not filled'}</strong> is also
        </span>
        {tick(`r-${party}-wa`, 'WhatsApp', ownTicked(values, party, 'whatsapp'), !!mobile, (on) =>
          set({ [OWN.whatsapp(party)]: ownValue(values, party, 'whatsapp', on) }),
        )}
        {tick(`r-${party}-sms`, 'SMS / calls', ownTicked(values, party, 'sms'), !!mobile, (on) =>
          set({ [OWN.sms(party)]: ownValue(values, party, 'sms', on) }),
        )}
        {tick(
          `r-${party}-em`,
          'Emergency contact',
          String(values[OWN.emergency(party)] ?? '') === 'Yes',
          !!mobile && !!nameOf(values, party),
          (on) => set(on ? emergencyValues(values, party) : { [OWN.emergency(party)]: 'No' }),
        )}
      </div>
      <div className="ep-roles__row">
        <span className="ep-roles__what">
          Email <strong>{email || 'not filled'}</strong> is also
        </span>
        {tick(
          `r-${party}-ce`,
          'Communication email',
          ownTicked(values, party, 'communication'),
          !!email,
          (on) => set({ [OWN.communication(party)]: ownValue(values, party, 'communication', on) }),
        )}
      </div>
      <div className="ep-roles__row">
        {tick(
          `r-${party}-pr`,
          `Primary contact of the family (SMS, WhatsApp and email go to the ${who.toLowerCase()})`,
          primaryParty(values) === party,
          !!mobile,
          (on) =>
            set(
              on
                ? primaryValues(values, party)
                : { sms_mobile: null, whatsapp_no: null, primary_email: null },
            ),
        )}
      </div>
      <p id={`roles-${party}-help`} className="ep-field__help">
        Ticks fill the matching boxes below (WhatsApp copies the mobile; SMS / calls, communication
        email and emergency become Yes) and follow the mobile or email when it changes.
      </p>
    </fieldset>
  );
}

/** Top of the Contact section: pick the primary and the emergency contact from the parents. */
export function FamilyContactPickers({
  values,
  disabled,
  set,
}: {
  values: ProfileValues;
  disabled?: boolean;
  set: (patch: ProfileValues) => void;
}) {
  const named = PARTIES.filter((p) => nameOf(values, p));
  const primary = primaryParty(values) ?? '';
  const emergency = emergencyParty(values) ?? '';
  return (
    <fieldset className="ep-roles">
      <legend>Fill from a parent</legend>
      <div className="ep-roles__pickers">
        <label className="ep-field" htmlFor="fc-primary">
          <span className="ep-field__label">Primary contact</span>
          <select
            id="fc-primary"
            className="ep-select"
            value={primary}
            disabled={disabled}
            onChange={(e) => e.target.value && set(primaryValues(values, e.target.value as Party))}
          >
            <option value="">Typed by hand</option>
            {named.map((p) => (
              <option key={p} value={p}>
                {LABEL[p]} — {nameOf(values, p)}
              </option>
            ))}
          </select>
          <span className="ep-field__help">Fills SMS Mobile, WhatsApp and Primary Email</span>
        </label>
        <label className="ep-field" htmlFor="fc-emergency">
          <span className="ep-field__label">Emergency contact</span>
          <select
            id="fc-emergency"
            className="ep-select"
            value={emergency}
            disabled={disabled}
            onChange={(e) =>
              e.target.value && set(emergencyValues(values, e.target.value as Party))
            }
          >
            <option value="">Someone else (type below)</option>
            {named.map((p) => (
              <option key={p} value={p}>
                {LABEL[p]} — {nameOf(values, p)}
              </option>
            ))}
          </select>
          <span className="ep-field__help">Fills the emergency name, relation and mobile</span>
        </label>
      </div>
    </fieldset>
  );
}
