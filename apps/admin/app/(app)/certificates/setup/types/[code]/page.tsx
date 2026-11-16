import { Badge, Breadcrumbs, Button, KpiTile, PageHeader, SelectField } from '@edupro/ui';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { FieldRows } from '@/components/certificates/FieldRows';
import { LevelRows, type Level } from '@/components/certificates/LevelRows';
import { FoldCard } from '@/components/FoldCard';
import { Icon } from '@/components/nav-icons';
import { Notice } from '@/components/Notice';
import { OpenOnInvalid } from '@/components/OpenOnInvalid';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { saveCertificateType } from '@/lib/certificate-setup-actions';
import {
  checksInWords,
  onlineInWords,
  type CertificateTemplateRow,
  type CertificateTypeDetail,
} from '@/lib/certificates';

const OK: Record<string, string> = {
  saved: 'Saved.',
  created:
    'Type added. Open each part below to set its checks, who may issue it and what it asks for, then Save changes.',
};

/** A template's name in a list: a school's copy is told apart from EduPro's ready layout of the same name. */
const layoutName = (x: CertificateTemplateRow) => (x.ready ? x.name : `${x.name} (school's copy)`);

/**
 * One certificate type (docs/design/87; rebuilt 16 Nov 2026): its figures first, the basics open, every other part
 * folded with a line saying what is set — the layout, the checks, who may issue it, asking online, the details asked at
 * issue, the rest — and one Save for all of it.
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
  const main = t.templates.find((x) => x.id === t.templateId) ?? null;
  const others = t.variants
    .map((v) => ({ ...v, t: t.templates.find((x) => x.id === v.templateId) }))
    .filter((v) => v.t);
  const addable = t.templates.filter(
    (x) => x.id !== t.templateId && !t.variants.some((v) => v.templateId === x.id),
  );
  const issuingRoles = t.roles.filter((r) => r.issues || t.issuers.includes(r.id));
  const issuerNames = t.roles.filter((r) => t.issuers.includes(r.id)).map((r) => r.name);
  const classCodes = [
    ...t.classes,
    ...(t.rules.classes ?? [])
      .filter((c) => !t.classes.some((k) => k.code === c.toUpperCase()))
      .map((c) => ({ code: c.toUpperCase(), name: c.toUpperCase() })),
  ];
  const asked = [...t.ownFields, ...t.fields].map((f) => f.label);

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
      <span className="ep-check__text">
        {label}
        {help ? (
          <span className="ep-field__help" style={{ margin: 0 }}>
            {help}
          </span>
        ) : null}
      </span>
    </label>
  );
  const radio = (
    name: string,
    value: string,
    label: string,
    on: boolean,
    help?: ReactNode,
    some = false,
  ) => (
    <label className="ep-radio" htmlFor={`${name}_${value}`}>
      <input
        id={`${name}_${value}`}
        type="radio"
        name={name}
        value={value}
        className="ep-radio__input"
        defaultChecked={on}
        {...(some ? { 'data-some': '' } : {})}
      />
      <span className="ep-radio__dot" />
      <span className="ep-check__text">
        {label}
        {help ? (
          <span className="ep-field__help" style={{ margin: 0 }}>
            {help}
          </span>
        ) : null}
      </span>
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
        description="Open a part to change it; Save changes keeps everything at once."
      />
      {sp.ok && OK[sp.ok] ? (
        <div className="ep-alert ep-alert--success" role="status">
          {OK[sp.ok]}
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <div className="ep-dash-kpis ep-ctype__kpis">
        <KpiTile label="Issued, all years" value={String(t.issued)} />
        <KpiTile
          label={t.yearCode ? `Issued in ${t.yearCode}` : 'Issued this year'}
          value={String(t.issuedYear)}
        />
        <KpiTile label="Requests waiting" value={String(t.waiting)} />
        <KpiTile label="Next number" value={t.nextNumber ?? '—'} />
        <KpiTile label="Layouts to choose" value={String(main ? 1 + others.length : 0)} />
        <KpiTile label="Status" value={t.active ? 'On' : 'Off'} />
      </div>
      <form id="ctype" action={saveCertificateType} className="ep-ctype__group">
        <OpenOnInvalid formId="ctype" />
        <input type="hidden" name="code" value={t.code} />

        <FoldCard
          id="ct-basics"
          title="Basics"
          hint={`${t.name} · ${t.prefix} · ${t.active ? 'switched on' : 'switched off'}`}
          open
        >
          <div className="ep-ctype__part">
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
                <span className="ep-field__help">Printed as the certificate&apos;s heading.</span>
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
                  The next one reads {t.nextNumber ?? `${t.prefix}/<year>/00001`}. A new prefix
                  applies from the next number.
                </span>
              </label>
            </div>
            <div className="ep-ctype__actions">
              {check(
                'active',
                'Switched on',
                t.active,
                'Off: kept with its certificates, but no new one is issued or asked for.',
              )}
              {t.usesBook ? <Badge tone="info">Keeps the TC book and Sl. No.</Badge> : null}
            </div>
          </div>
        </FoldCard>

        <FoldCard
          id="ct-layout"
          title="Layout"
          hint={
            main
              ? `${layoutName(main)}${others.length ? ` · ${String(others.length)} more to choose at issue` : ' · no other layouts'}`
              : 'No layout: it cannot be issued'
          }
        >
          <div className="ep-ctype__part">
            <div className="ep-cert-fields">
              <SelectField
                id="tTemplate"
                name="templateId"
                label="Printed with"
                defaultValue={t.templateId ?? ''}
                options={[
                  { value: '', label: 'No layout (it cannot be issued)' },
                  ...t.templates.map((x) => ({ value: x.id, label: layoutName(x) })),
                ]}
              />
              {main ? (
                <p className="ep-ctype__actions" style={{ alignSelf: 'end', margin: 0 }}>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/certificates/setup/templates/${main.id}?type=${t.code}`}
                  >
                    <Icon name="eye" size={16} /> See and edit the layout
                  </a>
                </p>
              ) : null}
            </div>
            <div>
              <p className="ep-ctype__sub">Other layouts the office may choose at issue</p>
              {others.length ? (
                <ul className="ep-ctype__layouts">
                  {others.map((v) => (
                    <li key={v.templateId}>
                      <span>
                        <label className="ep-check" htmlFor={`v_${v.templateId}`}>
                          <input
                            id={`v_${v.templateId}`}
                            type="checkbox"
                            name="variant"
                            value={v.templateId}
                            className="ep-check__input"
                            defaultChecked
                          />
                          <span className="ep-check__box" />
                          {layoutName(v.t!)}
                        </label>
                        <input
                          type="hidden"
                          name={`variantLabel_${v.templateId}`}
                          value={v.label}
                        />
                      </span>
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/certificates/setup/templates/${v.templateId}?type=${t.code}`}
                      >
                        <Icon name="eye" size={16} /> See
                        <span className="ep-sr-only"> {layoutName(v.t!)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-ctype__note">
                  None: every certificate of this type prints with the layout above.
                </p>
              )}
              {others.length ? (
                <p className="ep-ctype__note" style={{ marginTop: 'var(--sp-2)' }}>
                  Untick one to stop offering it.
                </p>
              ) : null}
            </div>
            {addable.length ? (
              <div className="ep-cert-fields">
                {addable.map((x) => (
                  <input key={x.id} type="hidden" name={`variantLabel_${x.id}`} value={x.name} />
                ))}
                <SelectField
                  id="tAddVariant"
                  name="addVariant"
                  label="Add another layout (optional)"
                  defaultValue=""
                  options={[
                    { value: '', label: 'None' },
                    ...addable.map((x) => ({ value: x.id, label: layoutName(x) })),
                  ]}
                />
              </div>
            ) : null}
          </div>
        </FoldCard>

        <FoldCard
          id="ct-checks"
          title="Checks before issue"
          hint={checksInWords(t.rules, t.multiple, staff)}
        >
          <div className="ep-ctype__part">
            <div className="ep-cert-fields">
              <fieldset className="ep-radio-group">
                <legend className="ep-field__label">
                  {staff ? 'Which employees can get it' : 'Which students can get it'}
                </legend>
                {staff ? (
                  <>
                    {radio('state', 'active', 'Only those in service', t.rules.state === 'active')}
                    {radio(
                      'state',
                      'leaving',
                      'Only those who have left',
                      t.rules.state === 'leaving',
                    )}
                    {radio(
                      'state',
                      'any',
                      'Any employee, in service or past',
                      !t.rules.state || t.rules.state === 'any',
                    )}
                  </>
                ) : (
                  <>
                    {radio(
                      'state',
                      'active',
                      'Only students on the rolls',
                      t.rules.state === 'active',
                    )}
                    {radio(
                      'state',
                      'leaving',
                      'Only students whose withdrawal is complete, or who have left',
                      t.rules.state === 'leaving',
                    )}
                    {radio(
                      'state',
                      'any',
                      'Any student, on the rolls or past',
                      !t.rules.state || t.rules.state === 'any',
                    )}
                  </>
                )}
              </fieldset>
              <fieldset className="ep-radio-group">
                <legend className="ep-field__label">How many one person may hold</legend>
                {radio('multiple', 'ANY', 'As many as needed', t.multiple === 'ANY')}
                {radio('multiple', 'YEAR', 'One a school year', t.multiple === 'YEAR')}
                {radio(
                  'multiple',
                  'ONE',
                  'Only one',
                  t.multiple === 'ONE',
                  'Another copy is a duplicate of it.',
                )}
              </fieldset>
            </div>
            <fieldset className="ep-setup-checks">
              <legend className="ep-field__label">Must be cleared first</legend>
              {staff ? null : check('fees', 'No fees due', t.rules.fees)}
              {check('library', 'Library books returned, no dues', t.rules.library)}
              {staff ? null : check('hostel', 'No hostel bed held', t.rules.hostel)}
              {staff ? null : check('transport', 'School transport ended', t.rules.transport)}
            </fieldset>
            {staff ? null : (
              <fieldset className="ep-radio-group ep-ctype__pick">
                <legend className="ep-field__label">Classes</legend>
                {radio('classMode', 'all', 'All classes', !t.rules.classes?.length)}
                {radio(
                  'classMode',
                  'some',
                  'Only some classes',
                  !!t.rules.classes?.length,
                  undefined,
                  true,
                )}
                <div className="ep-ctype__more ep-setup-checks">
                  {classCodes.map((k) => (
                    <label key={k.code} className="ep-check" htmlFor={`cl_${k.code}`}>
                      <input
                        id={`cl_${k.code}`}
                        type="checkbox"
                        name="class"
                        value={k.code}
                        className="ep-check__input"
                        defaultChecked={(t.rules.classes ?? []).some(
                          (c) => c.toUpperCase() === k.code,
                        )}
                      />
                      <span className="ep-check__box" />
                      {k.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="ep-ctype__note">
              The principal may still issue one past a failed check, with a reason. &ldquo;Already
              holds one&rdquo; is never passed over.
            </p>
          </div>
        </FoldCard>

        <FoldCard
          id="ct-issuers"
          title="Who may issue it"
          hint={
            issuerNames.length
              ? `Only ${issuerNames.join(', ')}`
              : 'Everyone who issues certificates'
          }
        >
          <fieldset className="ep-radio-group ep-ctype__pick">
            <legend className="ep-sr-only">Who may issue it</legend>
            {radio(
              'issuerMode',
              'all',
              'Everyone who issues certificates',
              !t.issuers.length,
              'The roles given the right to issue certificates (Access → Roles).',
            )}
            {radio('issuerMode', 'some', 'Only these roles', !!t.issuers.length, undefined, true)}
            <div className="ep-ctype__more ep-setup-checks">
              {issuingRoles.map((r) => (
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
            </div>
            <p className="ep-ctype__note">
              Whoever manages the certificate set-up may always issue it.
            </p>
          </fieldset>
        </FoldCard>

        <FoldCard id="ct-online" title="Asked for online" hint={onlineInWords(t.request, staff)}>
          <div className="ep-ctype__part">
            <p className="ep-ctype__note">
              {staff
                ? 'Staff ask for it in the staff app; it is decided level by level, then the office issues it and they download it.'
                : 'Parents (for a child) and students ask for it in their app; it is decided level by level, the fee (if any) is paid, then the office issues it and they download it.'}
            </p>
            <fieldset className="ep-setup-checks">
              <legend className="ep-field__label">
                Who may ask for it (none ticked: office only)
              </legend>
              {staff ? (
                check('openStaff', 'Staff, for themselves', t.request.open.staff)
              ) : (
                <>
                  {check('openParent', 'Parents, for a child', t.request.open.parent)}
                  {check('openStudent', 'Students, for themselves', t.request.open.student)}
                </>
              )}
            </fieldset>
            <div className="ep-cert-fields">
              <label className="ep-field" htmlFor="rqCopies">
                <span className="ep-field__label">Copies one request may ask for</span>
                <input
                  id="rqCopies"
                  name="maxCopies"
                  type="number"
                  min={1}
                  max={10}
                  className="ep-input"
                  defaultValue={t.request.maxCopies}
                />
              </label>
              {staff ? null : (
                <label className="ep-field" htmlFor="rqFee">
                  <span className="ep-field__label">Fee a copy (₹)</span>
                  <input
                    id="rqFee"
                    name="fee"
                    type="number"
                    min={0}
                    step="0.01"
                    className="ep-input"
                    defaultValue={t.request.fee ?? ''}
                    placeholder="Free"
                  />
                  <span className="ep-field__help">
                    Empty or 0: free. Charged to the student when the request is approved.
                  </span>
                </label>
              )}
              <label className="ep-field" htmlFor="rqPurposes" style={{ gridColumn: '1 / -1' }}>
                <span className="ep-field__label">Purposes to choose from (optional)</span>
                <textarea
                  id="rqPurposes"
                  name="purposes"
                  rows={3}
                  className="ep-input"
                  defaultValue={t.request.purposes.join('\n')}
                  placeholder={'One a line, e.g.\nPassport\nBank account'}
                />
                <span className="ep-field__help">Empty: the asker types the purpose.</span>
              </label>
            </div>
            <div>
              <p className="ep-ctype__sub">Who decides a request, in order</p>
              <LevelRows
                initial={t.request.levels.filter((l): l is Level => l.kind !== 'user')}
                roles={t.roles}
                staff={staff}
              />
            </div>
          </div>
        </FoldCard>

        <FoldCard
          id="ct-details"
          title="Details asked at issue"
          hint={asked.length ? asked.join(', ') : 'Nothing extra asked at issue'}
        >
          <div className="ep-ctype__part">
            {t.ownFields.length ? (
              <p className="ep-ctype__note">
                EduPro always asks: {t.ownFields.map((f) => f.label).join('; ')}.
              </p>
            ) : null}
            <p className="ep-ctype__note">
              Add the school&apos;s own details for the office to fill at issue; each prints where
              the layout places it (Layout → See and edit the layout → the field list).
            </p>
            <FieldRows initial={t.fields} />
          </div>
        </FoldCard>

        <FoldCard
          id="ct-more"
          title="More"
          hint={`Code ${t.code} · order ${String(t.sortOrder)}${t.description ? ' · a note for the office' : ''} · ${t.builtIn ? 'made by EduPro' : "the school's own type"}`}
        >
          <div className="ep-cert-fields">
            <label className="ep-field" htmlFor="tDesc" style={{ gridColumn: '1 / -1' }}>
              <span className="ep-field__label">Note for the office (optional)</span>
              <input
                id="tDesc"
                name="description"
                className="ep-input"
                defaultValue={t.description ?? ''}
                maxLength={300}
              />
              <span className="ep-field__help">
                Shown when the office picks this type at issue.
              </span>
            </label>
            <label className="ep-field" htmlFor="tOrder">
              <span className="ep-field__label">Place in lists</span>
              <input
                id="tOrder"
                name="sortOrder"
                type="number"
                min={0}
                max={9999}
                className="ep-input"
                defaultValue={t.sortOrder}
              />
              <span className="ep-field__help">Smaller numbers come first.</span>
            </label>
            <div className="ep-field">
              <span className="ep-field__label">Code</span>
              <p style={{ margin: 0 }}>
                <code>{t.code}</code>
              </p>
              <span className="ep-field__help">Fixed; used in reports and downloads.</span>
            </div>
          </div>
        </FoldCard>

        <div className="ep-form-actions" data-sticky="true">
          <Button type="submit">Save changes</Button>
          <a className="ep-btn ep-btn--ghost" href="/certificates/setup/types">
            Back to the types
          </a>
        </div>
      </form>
    </>
  );
}
