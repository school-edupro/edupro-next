import { Badge, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FieldRows } from '@/components/certificates/FieldRows';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveCertificateType } from '@/lib/certificate-setup-actions';
import type { CertificateTypeDetail } from '@/lib/certificates';

const OK: Record<string, string> = {
  saved: 'Saved.',
  created: 'Type added: set its checks and fields.',
};

/**
 * One certificate type (docs/design/87, phase B): name, prefix, its template and other layouts to choose at issue, the
 * checks before issue, how many a person may hold, who may issue it, and the fields it asks for.
 */
export default async function CertificateTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.setup.manage') || !/^[A-Z][A-Z0-9_]{1,19}$/.test(code))
    notFound();
  let t: CertificateTypeDetail;
  try {
    t = await apiFetch<CertificateTypeDetail>(`/certificates/setup/types/${code}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const staff = t.audience === 'STAFF';
  const check = (name: string, label: string, on: boolean | undefined, help?: string) => (
    <label className="ep-check" htmlFor={`r_${name}`}>
      <input
        id={`r_${name}`}
        type="checkbox"
        name={name}
        className="ep-check__input"
        defaultChecked={!!on}
      />
      <span className="ep-check__box" />
      {label}
      {help ? (
        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
          {help}
        </span>
      ) : null}
    </label>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate set-up', href: '/certificates/setup' },
          { label: 'Certificate types', href: '/certificates/setup/types' },
          { label: t.name },
        ]}
      />
      <PageHeader
        kicker={staff ? 'Staff certificate' : 'Student certificate'}
        title={t.name}
        description={`${t.builtIn ? 'Made by EduPro' : "The school's own type"} · code ${t.code} · ${String(t.issued)} issued`}
      />
      {sp.ok && OK[sp.ok] ? (
        <div className="ep-alert ep-alert--success" role="status">
          {OK[sp.ok]}
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <form action={saveCertificateType} style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <input type="hidden" name="code" value={t.code} />
        <Card title="Name and number">
          <div className="ep-cert-fields">
            <label className="ep-field" htmlFor="tName">
              <span className="ep-field__label">Name *</span>
              <input
                id="tName"
                name="name"
                className="ep-input"
                defaultValue={t.name}
                required
                maxLength={100}
              />
            </label>
            <label className="ep-field" htmlFor="tPrefix">
              <span className="ep-field__label">Number prefix *</span>
              <input
                id="tPrefix"
                name="prefix"
                className="ep-input"
                defaultValue={t.prefix}
                required
                pattern="[A-Za-z][A-Za-z0-9]{0,7}"
                maxLength={8}
              />
              <span className="ep-field__help">
                Numbers read {t.prefix}/2026-27/00001; a new prefix applies to the next number.
              </span>
            </label>
            <label className="ep-field" htmlFor="tDesc" style={{ gridColumn: '1 / -1' }}>
              <span className="ep-field__label">Note for the office (optional)</span>
              <input
                id="tDesc"
                name="description"
                className="ep-input"
                defaultValue={t.description ?? ''}
                maxLength={300}
              />
            </label>
            <label className="ep-field" htmlFor="tOrder">
              <span className="ep-field__label">Order in lists</span>
              <input
                id="tOrder"
                name="sortOrder"
                type="number"
                min={0}
                max={9999}
                className="ep-input"
                defaultValue={t.sortOrder}
              />
            </label>
            <div style={{ alignSelf: 'end' }}>
              {check('active', 'Switched on (can be issued)', t.active)}
            </div>
          </div>
        </Card>
        <Card title="Layouts">
          <div className="ep-cert-fields">
            <SelectField
              id="tTemplate"
              name="templateId"
              label="Template"
              defaultValue={t.templateId ?? ''}
              options={[
                { value: '', label: 'None (the type cannot be issued)' },
                ...t.templates.map((x) => ({ value: x.id, label: x.name })),
              ]}
            />
            <p className="ep-field__help" style={{ alignSelf: 'end' }}>
              {t.templateId ? (
                <a href={`/certificates/setup/templates/${t.templateId}?type=${t.code}`}>
                  Edit this template
                </a>
              ) : null}
            </p>
          </div>
          <fieldset className="ep-setup-checks" style={{ marginTop: 'var(--sp-3)' }}>
            <legend className="ep-field__label">Other layouts to choose at issue</legend>
            {t.templates
              .filter((x) => x.id !== t.templateId)
              .map((x) => {
                const on = t.variants.find((v) => v.templateId === x.id);
                return (
                  <div key={x.id}>
                    <label className="ep-check" htmlFor={`v_${x.id}`}>
                      <input
                        id={`v_${x.id}`}
                        type="checkbox"
                        name="variant"
                        value={x.id}
                        className="ep-check__input"
                        defaultChecked={!!on}
                      />
                      <span className="ep-check__box" />
                      {x.name}
                    </label>
                    <input
                      type="hidden"
                      name={`variantLabel_${x.id}`}
                      value={on?.label ?? x.name}
                    />
                  </div>
                );
              })}
          </fieldset>
        </Card>
        <Card title="Checks before issue">
          <div className="ep-cert-fields">
            <SelectField
              id="tState"
              name="state"
              label={staff ? 'The employee' : 'The student'}
              defaultValue={t.rules.state ?? 'any'}
              options={
                staff
                  ? [
                      { value: 'active', label: 'In service' },
                      { value: 'leaving', label: 'Has left the school' },
                      { value: 'any', label: 'Any, in service or past' },
                    ]
                  : [
                      { value: 'active', label: 'On the rolls' },
                      { value: 'leaving', label: 'Withdrawal complete, or has left' },
                      { value: 'any', label: 'Any, on the rolls or past' },
                    ]
              }
            />
            <SelectField
              id="tMultiple"
              name="multiple"
              label="How many a person may hold"
              defaultValue={t.multiple}
              options={[
                { value: 'ANY', label: 'As many as needed' },
                { value: 'YEAR', label: 'One a year' },
                { value: 'ONE', label: 'One (cancel it, or print a duplicate)' },
              ]}
            />
          </div>
          <fieldset className="ep-setup-checks" style={{ marginTop: 'var(--sp-3)' }}>
            <legend className="ep-field__label">Cleared before issue</legend>
            {staff ? null : check('fees', 'No fees due', t.rules.fees)}
            {check('library', 'Library books and dues', t.rules.library)}
            {staff ? null : check('hostel', 'No hostel bed held', t.rules.hostel)}
            {staff ? null : check('transport', 'School transport ended', t.rules.transport)}
          </fieldset>
          {staff ? null : (
            <label className="ep-field" htmlFor="tClasses" style={{ marginTop: 'var(--sp-3)' }}>
              <span className="ep-field__label">Only for these classes (optional)</span>
              <input
                id="tClasses"
                name="classes"
                className="ep-input"
                defaultValue={(t.rules.classes ?? []).join(', ')}
                placeholder="e.g. IX, X, XI, XII"
              />
              <span className="ep-field__help">Class codes; XI covers XI-COM, XI-SCI …</span>
            </label>
          )}
          <p className="ep-field__help">
            The principal may still issue past a failed check with a reason; "already holds" is
            never overridden.
          </p>
        </Card>
        <Card title="Who may issue it">
          <fieldset className="ep-setup-checks">
            <legend className="ep-field__label">
              Roles (none ticked: everyone who issues certificates). The certificate set-up right
              may always issue.
            </legend>
            {t.roles.map((r) => (
              <label key={r.id} className="ep-check" htmlFor={`i_${r.id}`}>
                <input
                  id={`i_${r.id}`}
                  type="checkbox"
                  name="issuer"
                  value={r.id}
                  className="ep-check__input"
                  defaultChecked={t.issuers.includes(r.id)}
                />
                <span className="ep-check__box" />
                {r.name}
              </label>
            ))}
          </fieldset>
        </Card>
        <Card title="Fields asked at issue">
          {t.ownFields.length ? (
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              EduPro's own: {t.ownFields.map((f) => f.label).join('; ')}.
            </p>
          ) : null}
          <p className="ep-field__help">
            The school's own fields print where the template places <code>{'{{fields.key}}'}</code>{' '}
            (a date: <code>{'{{text.key}}'}</code>).
          </p>
          <FieldRows initial={t.fields} />
        </Card>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <Button type="submit">Save the type</Button>
          {t.usesBook ? <Badge tone="info">Keeps the TC book and Sl. No.</Badge> : null}
        </div>
      </form>
    </>
  );
}
