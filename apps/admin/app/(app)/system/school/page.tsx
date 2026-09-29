import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import { createCampus, updateSchool } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Campus, School } from '@/lib/types';

interface MasterRow {
  id: string;
  [k: string]: unknown;
}
interface BankAccount extends MasterRow {
  bank_id: string;
  account_name: string;
  account_no: string;
  ifsc: string;
  branch: string | null;
  address: string | null;
  purpose: string;
  is_default: boolean;
  status: string;
}
const rowsOf = <T extends MasterRow>(master: string) =>
  apiFetch<{ data: T[] }>(`/masters/${master}/rows?size=500&status=active`)
    .then((r) => r.data)
    .catch(() => [] as T[]);
const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'UTC'];
  }
})();
const LOCALES = [
  { value: 'en', label: 'English (en)' },
  { value: 'hi', label: 'हिन्दी (hi)' },
];
const str = (o: Record<string, unknown> | undefined, k: string) =>
  o && typeof o[k] === 'string' ? (o[k] as string) : '';

function Section({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} style={{ marginBottom: 'var(--sp-3)' }}>
      <summary
        style={{
          cursor: 'pointer',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--text-heading)',
          padding: 'var(--sp-2) 0',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        {title}
      </summary>
      {children}
    </details>
  );
}

/**
 * School profile (S1, extended 2026-09-29 to the legacy school-setup form): identifiers and names,
 * address and contact (country, state and city from the masters), website and URLs, bank accounts
 * (the school bank accounts master), department emails, the logo, and campuses. The extra fields live
 * in the school's address, contact and branding JSON columns.
 */
export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const t = await getTranslations('pages.system_school');
  const sp = await searchParams;
  const [school, me, countries, states, cities, accounts] = await Promise.all([
    apiFetch<School>('/platform/school'),
    getMe(),
    rowsOf<MasterRow>('countries'),
    rowsOf<MasterRow>('states'),
    rowsOf<MasterRow>('cities'),
    rowsOf<BankAccount>('bank_accounts'),
  ]);
  const canMasters = me.permissions.includes('fees.master.manage');
  const address = school.address ?? {};
  const contact = school.contact ?? {};
  const branding = school.branding ?? {};
  const urls = (branding.urls as Record<string, unknown> | undefined) ?? {};
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={`${school.code} · ${school.board}${school.affiliationNo ? ` · ${school.affiliationNo}` : ''}`}
      />
      <Notice params={sp} />
      <Card title="Profile">
        <form action={updateSchool} encType="multipart/form-data">
          <Section title="Basic information" open>
            <FormRow columns={3}>
              <InputField
                id="s-code"
                name="code"
                label="School id (code)"
                defaultValue={school.code}
                readOnly
              />
              <InputField
                id="s-name"
                name="name"
                label="School name 1"
                required
                defaultValue={school.name}
              />
              <InputField
                id="s-name2"
                name="name2"
                label="School name 2"
                defaultValue={str(branding, 'name2')}
                maxLength={160}
              />
              <InputField
                id="s-name3"
                name="name3"
                label="School name 3"
                defaultValue={str(branding, 'name3')}
                maxLength={160}
              />
              <InputField
                id="s-short"
                name="shortName"
                label="Short name"
                defaultValue={school.shortName ?? ''}
              />
              <InputField
                id="s-prefix"
                name="prefix"
                label="Prefix"
                defaultValue={str(branding, 'prefix')}
                maxLength={10}
                pattern="[A-Za-z0-9]{1,10}"
              />
              <InputField
                id="s-no"
                name="schoolNo"
                label="School no."
                defaultValue={str(branding, 'schoolNo')}
                maxLength={40}
              />
              <InputField
                id="s-aff"
                name="affiliationNo"
                label="Affiliation number"
                defaultValue={school.affiliationNo ?? ''}
                maxLength={40}
              />
              <SelectField
                id="s-board"
                name="board"
                label="Board"
                defaultValue={school.board}
                options={['CBSE', 'ICSE', 'STATE', 'IB', 'OTHER'].map((b) => ({
                  value: b,
                  label: b,
                }))}
              />
              <InputField
                id="s-app"
                name="appName"
                label="Admin application name"
                defaultValue={str(branding, 'appName')}
                maxLength={80}
              />
              <InputField
                id="s-class"
                name="classLabel"
                label="Class (optional identifier)"
                defaultValue={str(branding, 'classLabel')}
                maxLength={40}
              />
              <SelectField
                id="s-tz"
                name="timezone"
                label="Timezone"
                defaultValue={school.timezone}
                options={TIMEZONES.map((z) => ({ value: z, label: z }))}
              />
              <SelectField
                id="s-locale"
                name="locale"
                label="Locale"
                defaultValue={school.locale}
                options={LOCALES}
              />
              <label className="ep-field" htmlFor="s-logo">
                <span className="ep-field__label">School logo (PNG, JPG or SVG)</span>
                <input
                  id="s-logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="ep-input"
                />
                {str(branding, 'logoFileId') ? (
                  <span className="ep-field__help">
                    Logo on file #{str(branding, 'logoFileId')}; choose a file to replace it.
                  </span>
                ) : null}
              </label>
            </FormRow>
          </Section>
          <Section title="Address and contact information" open>
            <FormRow columns={3}>
              <InputField
                id="a-1"
                name="address1"
                label="School address 1"
                defaultValue={str(address, 'line1')}
                maxLength={160}
              />
              <InputField
                id="a-2"
                name="address2"
                label="School address 2"
                defaultValue={str(address, 'line2')}
                maxLength={160}
              />
              <InputField
                id="a-3"
                name="address3"
                label="School address 3"
                defaultValue={str(address, 'line3')}
                maxLength={160}
              />
              <SelectField
                id="a-country"
                name="country"
                label="Country"
                defaultValue={str(address, 'country') || 'India'}
                options={[
                  ...(countries.length ? [] : [{ value: 'India', label: 'India' }]),
                  ...countries.map((c) => ({
                    value: String(c.name),
                    label: `${String(c.name)} (${String(c.code)})`,
                  })),
                ]}
              />
              <SelectField
                id="a-state"
                name="state"
                label="State"
                defaultValue={str(address, 'state')}
                options={[
                  { value: '', label: '—' },
                  ...states.map((x) => ({
                    value: String(x.name),
                    label: `${String(x.name)} (${String(x.code)})`,
                  })),
                ]}
              />
              <SelectField
                id="a-city"
                name="city"
                label="City"
                defaultValue={str(address, 'city')}
                options={[
                  { value: '', label: '—' },
                  ...cities.map((x) => ({
                    value: String(x.name),
                    label: `${String(x.name)} · ${String(x.state_id)}`,
                  })),
                ]}
              />
              <InputField
                id="a-pin"
                name="pincode"
                label="PIN code"
                defaultValue={str(address, 'pincode')}
                pattern="[1-9][0-9]{5}"
                maxLength={6}
              />
              <InputField
                id="c-phone"
                name="phone"
                label="School phone no."
                defaultValue={str(contact, 'phone')}
                maxLength={20}
                pattern="[0-9+()\- ]{6,20}"
              />
              <InputField
                id="c-wa"
                name="whatsapp"
                label="WhatsApp number"
                defaultValue={str(contact, 'whatsapp')}
                maxLength={12}
                pattern="[0-9]{10,12}"
              />
              <InputField
                id="c-mail"
                name="email"
                label="School mail id"
                type="email"
                defaultValue={str(contact, 'email')}
              />
            </FormRow>
          </Section>
          <Section title="Website and URL configuration">
            <FormRow columns={3}>
              <InputField
                id="u-web"
                name="website"
                label="School website"
                type="url"
                defaultValue={str(contact, 'website')}
              />
              <InputField
                id="u-base"
                name="webBaseUrl"
                label="Website base URL"
                type="url"
                defaultValue={str(urls, 'webBase')}
              />
              <InputField
                id="u-app"
                name="appUrl"
                label="Mobilise app URL"
                type="url"
                defaultValue={str(urls, 'app')}
              />
              <InputField
                id="u-header"
                name="headerBaseUrl"
                label="Header base URL"
                type="url"
                defaultValue={str(urls, 'headerBase')}
              />
              <InputField
                id="u-sms"
                name="smsUrl"
                label="SMS URL"
                type="url"
                defaultValue={str(urls, 'sms')}
              />
              <InputField
                id="u-gcm"
                name="gcmUrl"
                label="Push (GCM) URL"
                type="url"
                defaultValue={str(urls, 'gcm')}
              />
              <InputField
                id="u-fb"
                name="facebook"
                label="Facebook"
                type="url"
                defaultValue={str(contact, 'facebook')}
              />
              <InputField
                id="u-tw"
                name="twitter"
                label="Twitter / X"
                type="url"
                defaultValue={str(contact, 'twitter')}
              />
              <InputField
                id="u-ig"
                name="instagram"
                label="Instagram"
                type="url"
                defaultValue={str(contact, 'instagram')}
              />
              <InputField
                id="u-li"
                name="linkedin"
                label="LinkedIn"
                type="url"
                defaultValue={str(contact, 'linkedin')}
              />
              <InputField
                id="u-yt"
                name="youtube"
                label="YouTube"
                type="url"
                defaultValue={str(contact, 'youtube')}
              />
              <InputField
                id="u-help"
                name="help"
                label="Help line / contact text"
                defaultValue={str(contact, 'help')}
                maxLength={200}
              />
            </FormRow>
          </Section>
          <Section title="Bank account details" open>
            <DataTable<BankAccount>
              caption="School bank accounts"
              density="dense"
              columns={[
                { key: 'b', header: 'Bank', render: (a) => <strong>{a.bank_id}</strong> },
                { key: 'n', header: 'Account name', render: (a) => a.account_name },
                { key: 'no', header: 'Account number', render: (a) => a.account_no },
                { key: 'i', header: 'IFSC', render: (a) => a.ifsc },
                {
                  key: 'br',
                  header: 'Branch',
                  render: (a) => `${a.branch ?? ''}${a.address ? ` · ${a.address}` : ''}`,
                },
                {
                  key: 'p',
                  header: 'Purpose',
                  render: (a) => (
                    <>
                      {a.purpose}
                      {a.is_default ? (
                        <>
                          {' '}
                          <Badge tone="success">default</Badge>
                        </>
                      ) : null}
                    </>
                  ),
                },
              ]}
              rows={accounts}
              rowKey={(a) => a.id}
              emptyTitle="No bank account on file yet."
            />
            {canMasters ? (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginTop: 'var(--sp-2)',
                }}
              >
                <span className="ep-field__help">
                  Accounts and banks are masters with grid, Excel export and bulk upload; IFSC and
                  account numbers are validated.
                </span>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href="/masters/fees?tab=bank_accounts"
                >
                  Manage bank accounts
                </a>
                <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/masters/fees?tab=banks">
                  Banks
                </a>
              </div>
            ) : null}
          </Section>
          <Section title="Email configuration">
            <FormRow columns={3}>
              <InputField
                id="e-admin"
                name="adminEmail"
                label="Admin mail id"
                type="email"
                defaultValue={str(contact, 'adminEmail')}
              />
              <InputField
                id="e-principal"
                name="principalEmail"
                label="Principal email id"
                type="email"
                defaultValue={str(contact, 'principalEmail')}
              />
              <InputField
                id="e-accounts"
                name="accountsEmail"
                label="Accounts mail id"
                type="email"
                defaultValue={str(contact, 'accountsEmail')}
              />
              <InputField
                id="e-comm"
                name="communicationEmail"
                label="Communication mail id"
                type="email"
                defaultValue={str(contact, 'communicationEmail')}
              />
              <InputField
                id="e-transport"
                name="transportEmail"
                label="Transport email id"
                type="email"
                defaultValue={str(contact, 'transportEmail')}
              />
            </FormRow>
          </Section>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
            <Button type="reset" variant="ghost">
              Reset
            </Button>
            <Button type="submit">Save profile</Button>
          </div>
        </form>
      </Card>
      <Card title="Campuses" style={{ marginTop: 'var(--sp-5)' }}>
        <DataTable<Campus>
          caption="Campuses"
          columns={[
            { key: 'code', header: 'Code', render: (c) => <strong>{c.code}</strong> },
            { key: 'name', header: 'Name', render: (c) => c.name },
            {
              key: 'geo',
              header: 'Location',
              render: (c) => (c.geo ? `${c.geo.lat}, ${c.geo.lng}` : ''),
            },
            {
              key: 'status',
              header: 'Status',
              render: (c) => <Badge tone={toneForStatus(c.status)}>{c.status}</Badge>,
            },
          ]}
          rows={school.campuses}
          rowKey={(c) => c.id}
        />
        <form
          action={createCampus}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
            marginTop: 'var(--sp-4)',
          }}
        >
          <InputField
            id="c-code"
            name="code"
            label="Campus code"
            required
            placeholder="ANNEX"
            pattern="[A-Za-z0-9_-]{1,20}"
          />
          <InputField id="c-name" name="name" label="Campus name" required />
          <div>
            <Button type="submit" variant="secondary">
              Add campus
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
