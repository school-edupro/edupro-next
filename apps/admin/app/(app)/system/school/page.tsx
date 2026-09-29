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
import { apiFetch } from '@/lib/api';
import type { Campus, School } from '@/lib/types';

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
 * address and contact, website and URLs, bank accounts, department emails, the logo, and campuses.
 * The extra fields live in the school's address, contact and branding JSON columns.
 */
export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const t = await getTranslations('pages.system_school');
  const sp = await searchParams;
  const school = await apiFetch<School>('/platform/school');
  const address = school.address ?? {};
  const contact = school.contact ?? {};
  const branding = school.branding ?? {};
  const urls = (branding.urls as Record<string, unknown> | undefined) ?? {};
  const bank = Array.isArray(branding.bankAccounts) ? (branding.bankAccounts as string[]) : [];
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
              <InputField
                id="s-tz"
                name="timezone"
                label="Timezone"
                defaultValue={school.timezone}
              />
              <InputField id="s-locale" name="locale" label="Locale" defaultValue={school.locale} />
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
              <InputField
                id="a-city"
                name="city"
                label="City"
                defaultValue={str(address, 'city')}
                maxLength={80}
              />
              <InputField
                id="a-state"
                name="state"
                label="State"
                defaultValue={str(address, 'state')}
                maxLength={80}
              />
              <InputField
                id="a-pin"
                name="pincode"
                label="PIN code"
                defaultValue={str(address, 'pincode')}
                pattern="\\d{6}"
              />
              <InputField
                id="c-phone"
                name="phone"
                label="School phone no."
                defaultValue={str(contact, 'phone')}
                maxLength={40}
              />
              <InputField
                id="c-wa"
                name="whatsapp"
                label="WhatsApp number"
                defaultValue={str(contact, 'whatsapp')}
                maxLength={15}
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
          <Section title="Bank account details">
            <FormRow columns={3}>
              {[0, 1, 2].map((i) => (
                <InputField
                  key={i}
                  id={`b-${i}`}
                  name={`bank${i + 1}`}
                  label={`School bank A/C ${i + 1}`}
                  defaultValue={bank[i] ?? ''}
                  maxLength={120}
                />
              ))}
            </FormRow>
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
