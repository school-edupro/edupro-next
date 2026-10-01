import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  DataTable,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { StudentDocuments, expectedDocuments } from '@/components/StudentDocuments';
import { STUDENT_TABS, StudentHero, type StudentTab } from '@/components/StudentHero';
import { StudentOverview } from '@/components/StudentOverview';
import type { ProfileCatalogue, ProfileSnapshot } from '@/lib/profile';
import {
  enrolStudent,
  linkGuardian,
  generateStudentDemand,
  issueTc,
  renderTemplateFor,
  requestProfileChange,
  setFeeProfile,
  requestWithdrawal,
  setStudentStatus,
  unlinkGuardian,
  updateStudent,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type {
  DocumentTemplate,
  Enrolment,
  FeeDemandSummary,
  FeeDiscount,
  FeeProfile,
  TransportSlab,
  GuardianLink,
  StatusHistoryRow,
  Student360,
  TransferCertificate,
  Withdrawal,
} from '@/lib/types';
import { sectionOptions } from '@/lib/sections';

export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    tab?: string;
    export?: string;
    format?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, p, g, r, c, me, student, sections] = await Promise.all([
    getTranslations('people.students'),
    getTranslations('people'),
    getTranslations('people.gender'),
    getTranslations('people.relation'),
    getTranslations('common'),
    getMe(),
    apiFetch<Student360>(`/people/students/${id}`),
    sectionOptions(),
  ]);
  const can = (perm: string) => me.permissions.includes(perm);
  const tab: StudentTab = (STUDENT_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as StudentTab)
    : 'overview';
  const [profile, catalogue] = await Promise.all([
    apiFetch<ProfileSnapshot>(`/people/students/${id}/profile`).catch(() => null),
    apiFetch<ProfileCatalogue>('/people/profile/catalogue').catch(() => null),
  ]);
  const listOf = (key: string) => catalogue?.fields.find((x) => x.key === key)?.options ?? [];
  const expected = expectedDocuments(profile);
  const onFile = new Set(student.documents.map((d) => d.kind));
  const genders = ['unspecified', 'male', 'female', 'other'] as const;
  const relations = ['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'] as const;
  const history = await apiFetch<{ data: StatusHistoryRow[] }>(
    `/people/students/${id}/status-history`,
  ).then((r) => r.data);
  const [tcs, withdrawals, templates, l] = await Promise.all([
    can('people.tc.view')
      ? apiFetch<{ data: TransferCertificate[] }>(`/people/students/${id}/tc`).then((r) => r.data)
      : Promise.resolve<TransferCertificate[]>([]),
    can('people.withdrawal.view')
      ? apiFetch<{ data: Withdrawal[] }>(`/people/students/${id}/withdrawals`).then((r) => r.data)
      : Promise.resolve<Withdrawal[]>([]),
    can('platform.template.view')
      ? apiFetch<{ data: DocumentTemplate[] }>('/platform/templates').then((r) =>
          r.data.filter((x) => x.kind !== 'transfer_certificate' && x.status === 'active'),
        )
      : Promise.resolve<DocumentTemplate[]>([]),
    getTranslations('lifecycle'),
  ]);
  const openWithdrawal = withdrawals.find(
    (w) => w.status === 'requested' || w.status === 'cleared',
  );
  const [feeProfile, feeDemands, slabs, feeDiscounts, f, a] = await Promise.all([
    can('fees.demand.view')
      ? apiFetch<FeeProfile>(`/fees/students/${id}/profile`).catch(() => null)
      : Promise.resolve<FeeProfile | null>(null),
    can('fees.demand.view')
      ? apiFetch<FeeDemandSummary>(`/fees/students/${id}/demands`).catch(() => null)
      : Promise.resolve<FeeDemandSummary | null>(null),
    can('fees.profile.manage')
      ? apiFetch<{ data: TransportSlab[] }>('/fees/slabs')
          .then((r) => r.data)
          .catch(() => [] as TransportSlab[])
      : Promise.resolve<TransportSlab[]>([]),
    can('fees.profile.manage')
      ? apiFetch<{ data: FeeDiscount[] }>('/fees/discounts')
          .then((r) => r.data)
          .catch(() => [] as FeeDiscount[])
      : Promise.resolve<FeeDiscount[]>([]),
    getTranslations('fees'),
    getTranslations('adjustments'),
  ]);
  const issuedTc = tcs.find((x) => x.status === 'issued');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: p('kicker'), href: '/people/students' },
          { label: t('title'), href: '/people/students' },
          { label: student.displayName },
        ]}
      />
      <StudentHero
        student={student}
        profile={profile}
        tab={tab}
        counts={{
          documents: student.documents.length,
          missingDocuments: expected.filter((k) => !onFile.has(k)).length,
        }}
        can={can}
      />
      {sp.export && /^\d{1,18}$/.test(sp.export) ? (
        <ExportWatcher
          id={sp.export}
          format={sp.format === 'pdf' ? 'pdf' : 'xlsx'}
          labels={{
            queued: 'PDF requested',
            ready: 'Download',
            pending: 'Preparing the PDF… it downloads automatically',
            failed: 'The PDF could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares PDFs; check that it is running',
          }}
        />
      ) : null}
      <Notice params={sp} />
      {tab === 'overview' && profile && catalogue ? (
        <StudentOverview
          student={student}
          profile={profile}
          catalogue={catalogue}
          canEdit={can('people.student.edit')}
        />
      ) : null}
      {tab === 'documents' ? (
        <StudentDocuments
          student={student}
          profile={profile}
          canEdit={can('people.student.edit')}
        />
      ) : null}
      <div className="ep-grid-cards">
        {tab === 'profile' ? (
          <Card
            title={t('profile')}
            actions={
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/people/students/${student.id}/profile`}
              >
                All fields
              </a>
            }
          >
            <form action={updateStudent} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={student.id} />
              <FormRow columns={2}>
                <InputField
                  id="firstName"
                  name="firstName"
                  label={t('create.firstName')}
                  defaultValue={student.firstName}
                  required
                  disabled={!can('people.student.edit')}
                />
                <InputField
                  id="lastName"
                  name="lastName"
                  label={t('create.lastName')}
                  defaultValue={student.lastName ?? ''}
                  disabled={!can('people.student.edit')}
                />
              </FormRow>
              <FormRow columns={2}>
                <InputField
                  id="dob"
                  name="dob"
                  label={t('create.dob')}
                  type="date"
                  defaultValue={student.dob ?? ''}
                  disabled={!can('people.student.edit')}
                />
                <SelectField
                  id="gender"
                  name="gender"
                  label={t('create.gender')}
                  defaultValue={student.gender}
                  options={genders.map((v) => ({ value: v, label: g(v) }))}
                  disabled={!can('people.student.edit')}
                />
              </FormRow>
              <FormRow columns={3}>
                {(
                  [
                    ['category', t('create.category'), student.category, 'category'],
                    ['bloodGroup', t('create.bloodGroup'), student.bloodGroup, 'blood_group'],
                    ['house', t('create.house'), student.house, 'house'],
                  ] as const
                ).map(([name, label, value, key]) => (
                  <label key={name} className="ep-field" htmlFor={name}>
                    <span className="ep-field__label">{label}</span>
                    <input
                      id={name}
                      name={name}
                      className="ep-input"
                      list={`list-${name}`}
                      autoComplete="off"
                      defaultValue={value ?? ''}
                      disabled={!can('people.student.edit')}
                    />
                    <datalist id={`list-${name}`}>
                      {listOf(key).map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                    <span className="ep-field__help">
                      From System setup → Student profile lists
                    </span>
                  </label>
                ))}
              </FormRow>
              <FormRow columns={2}>
                <SelectField
                  id="status"
                  name="status"
                  label={c('status')}
                  defaultValue={student.status}
                  options={[
                    { value: 'active', label: c('active') },
                    { value: 'inactive', label: c('inactive') },
                  ]}
                  disabled={!can('people.student.edit')}
                />
              </FormRow>
              {can('people.student.edit') ? (
                <FormActions>
                  <Button type="submit">{c('save')}</Button>
                </FormActions>
              ) : null}
            </form>
          </Card>
        ) : null}

        {tab === 'profile' ? (
          <Card title={t('guardians')}>
            {student.guardians.length === 0 ? (
              <p className="ep-field__help">{t('noGuardians')}</p>
            ) : null}
            <DataTable<GuardianLink>
              caption={t('guardians')}
              density="dense"
              columns={[
                {
                  key: 'name',
                  header: c('name'),
                  render: (x) => (x.isPrimary ? <strong>{x.displayName}</strong> : x.displayName),
                },
                {
                  key: 'relation',
                  header: t('create.relation'),
                  render: (x) => r(x.relation as (typeof relations)[number]),
                },
                {
                  key: 'mobile',
                  header: t('create.guardianMobile'),
                  render: (x) => x.mobile ?? x.email ?? '',
                },
                {
                  key: 'actions',
                  header: '',
                  render: (x) =>
                    can('people.guardian.edit') ? (
                      <form action={unlinkGuardian}>
                        <input type="hidden" name="id" value={student.id} />
                        <input type="hidden" name="guardianId" value={x.guardianId} />
                        <Button type="submit" variant="ghost" size="sm">
                          {t('unlink')}
                        </Button>
                      </form>
                    ) : null,
                },
              ]}
              rows={student.guardians}
              rowKey={(x) => x.linkId}
              emptyTitle={t('noGuardians')}
            />
            {student.siblings.length > 0 ? (
              <p style={{ marginTop: 'var(--sp-3)' }}>
                <span className="ep-kicker">{t('siblings')}</span>{' '}
                {student.siblings.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 ? ', ' : ''}
                    <a href={`/people/students/${s.id}`} style={{ textDecoration: 'underline' }}>
                      {s.displayName}
                    </a>{' '}
                    ({s.admissionNo})
                  </span>
                ))}
              </p>
            ) : null}
            {can('people.guardian.edit') ? (
              <form action={linkGuardian} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="id" value={student.id} />
                <FormSection title={t('linkGuardian')} description={t('create.guardianHelp')}>
                  <FormRow columns={2}>
                    <InputField
                      id="g-name"
                      name="guardianName"
                      label={t('create.guardianName')}
                      required
                    />
                    <InputField
                      id="g-mobile"
                      name="guardianMobile"
                      label={t('create.guardianMobile')}
                      pattern="[6-9][0-9]{9}"
                    />
                  </FormRow>
                  <FormRow columns={2}>
                    <SelectField
                      id="g-relation"
                      name="relation"
                      label={t('create.relation')}
                      options={relations.map((v) => ({ value: v, label: r(v) }))}
                    />
                    <label className="ep-check" htmlFor="g-primary" style={{ alignSelf: 'end' }}>
                      <input
                        id="g-primary"
                        type="checkbox"
                        name="isPrimary"
                        className="ep-check__input"
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-check__text">Primary</span>
                    </label>
                  </FormRow>
                  <FormActions>
                    <Button type="submit" variant="secondary">
                      {t('linkGuardian')}
                    </Button>
                  </FormActions>
                </FormSection>
              </form>
            ) : null}
          </Card>
        ) : null}

        {tab === 'academics' ? (
          <Card title={t('enrolments')}>
            <DataTable<Enrolment>
              caption={t('enrolments')}
              density="dense"
              columns={[
                { key: 'year', header: 'Year', render: (e) => e.academicYear },
                {
                  key: 'section',
                  header: t('section'),
                  render: (e) => `${e.classCode}-${e.section}`,
                },
                { key: 'roll', header: t('rollNo'), numeric: true, render: (e) => e.rollNo ?? '' },
                { key: 'status', header: c('status'), render: (e) => e.status },
                { key: 'joined', header: 'Joined', render: (e) => e.joinedOn },
              ]}
              rows={student.enrolments}
              rowKey={(e) => e.id}
            />
            {can('people.enrolment.manage') ? (
              <form
                action={enrolStudent}
                style={{ marginTop: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
              >
                <input type="hidden" name="id" value={student.id} />
                <FormRow columns={3}>
                  <SelectField
                    id="e-section"
                    name="classSectionId"
                    label={t('moveSection')}
                    required
                    options={sections}
                    defaultValue={student.enrolment?.classSectionId}
                  />
                  <InputField
                    id="e-roll"
                    name="rollNo"
                    label={t('rollNo')}
                    type="number"
                    min={1}
                    max={999}
                    defaultValue={student.enrolment?.rollNo ?? ''}
                  />
                  <InputField id="e-joined" name="joinedOn" label="Joined on" type="date" />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {t('moveSection')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}

        {tab === 'status' ? (
          <Card title={t('statusHistory')}>
            <DataTable<StatusHistoryRow>
              caption={t('statusHistory')}
              density="dense"
              columns={[
                {
                  key: 'when',
                  header: t('statusWhen'),
                  render: (h) => new Date(h.changedAt).toLocaleString('en-IN'),
                },
                { key: 'from', header: t('statusFrom'), render: (h) => h.fromStatus ?? '' },
                {
                  key: 'to',
                  header: t('statusTo'),
                  render: (h) => (
                    <Badge tone={h.toStatus === 'active' ? 'success' : 'danger'}>
                      {h.toStatus}
                    </Badge>
                  ),
                },
                { key: 'reason', header: t('statusReason'), render: (h) => h.reason ?? '' },
                { key: 'by', header: t('statusChangedBy'), render: (h) => h.changedBy ?? '' },
              ]}
              rows={history}
              rowKey={(h) => h.id}
              emptyTitle={t('noHistory')}
            />
            {can('people.student.edit') ? (
              <form action={setStudentStatus} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="id" value={student.id} />
                <input
                  type="hidden"
                  name="status"
                  value={student.status === 'active' ? 'inactive' : 'active'}
                />
                <p className="ep-field__help">{t('changeStatusHelp')}</p>
                <FormRow columns={2}>
                  <InputField
                    id="statusReason"
                    name="statusReason"
                    label={t('statusReason')}
                    maxLength={200}
                    required
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {t('changeStatus')}: {student.status === 'active' ? c('inactive') : c('active')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}

        {tab === 'status' && (can('people.tc.view') || can('people.withdrawal.view')) ? (
          <Card title={l('issueTc')}>
            {tcs.length > 0 ? (
              <DataTable<TransferCertificate>
                caption={l('issueTc')}
                density="dense"
                columns={[
                  {
                    key: 'no',
                    header: l('tcNo'),
                    render: (x) => <a href="/people/tc">{x.tcNo}</a>,
                  },
                  { key: 'on', header: l('issuedOn'), render: (x) => x.issuedOn },
                  { key: 'reason', header: l('reason'), render: (x) => x.reason },
                  {
                    key: 'status',
                    header: l('status'),
                    render: (x) => (
                      <Badge tone={x.status === 'issued' ? 'success' : 'danger'}>
                        {l(x.status)}
                      </Badge>
                    ),
                  },
                  {
                    key: 'pdf',
                    header: l('pdf'),
                    render: (x) => (x.exportId ? <a href="/reports/exports">#{x.exportId}</a> : ''),
                  },
                ]}
                rows={tcs}
                rowKey={(x) => x.id}
                emptyTitle={l('noTc')}
              />
            ) : null}
            {can('people.tc.issue') && !issuedTc ? (
              <form action={issueTc} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="studentId" value={student.id} />
                <p className="ep-field__help">{l('issueTcHelp')}</p>
                <FormRow columns={2}>
                  <InputField
                    id="tcReason"
                    name="reason"
                    label={l('reason')}
                    required
                    maxLength={300}
                  />
                  <InputField id="tcIssuedOn" name="issuedOn" label={l('issuedOn')} type="date" />
                </FormRow>
                <FormRow columns={3}>
                  <InputField
                    id="tcConduct"
                    name="conduct"
                    label={l('conduct')}
                    defaultValue="Good"
                  />
                  <InputField
                    id="tcPromotion"
                    name="promotionStatus"
                    label={l('promotionStatus')}
                    maxLength={120}
                  />
                  <InputField id="tcRemarks" name="remarks" label={l('remarks')} maxLength={500} />
                </FormRow>
                <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <input type="checkbox" name="duesCleared" value="1" defaultChecked />{' '}
                  {l('duesCleared')}
                </label>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {l('issue')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
            {withdrawals.length > 0 ? (
              <p style={{ marginTop: 'var(--sp-4)' }}>
                {withdrawals.map((w) => (
                  <a
                    key={w.id}
                    href={`/people/withdrawals/${w.id}`}
                    style={{ marginRight: 'var(--sp-3)' }}
                  >
                    {l('requestWithdrawal')} · {w.requestedOn} ·{' '}
                    <Badge
                      tone={
                        w.status === 'completed'
                          ? 'success'
                          : w.status === 'cancelled'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {l(`withdrawalStatuses.${w.status}`)}
                    </Badge>
                  </a>
                ))}
              </p>
            ) : null}
            {can('people.withdrawal.manage') && !openWithdrawal && student.status === 'active' ? (
              <form action={requestWithdrawal} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="studentId" value={student.id} />
                <p className="ep-field__help">{l('requestHelp')}</p>
                <FormRow columns={2}>
                  <InputField
                    id="wLeavingOn"
                    name="leavingOn"
                    label={l('leavingOn')}
                    type="date"
                    required
                  />
                  <InputField
                    id="wReason"
                    name="reason"
                    label={l('reason')}
                    required
                    maxLength={300}
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {l('requestWithdrawal')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
            {templates.length > 0 ? (
              <form
                action={renderTemplateFor}
                style={{
                  marginTop: 'var(--sp-4)',
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                }}
              >
                <input type="hidden" name="entity" value="student" />
                <input type="hidden" name="entityId" value={student.id} />
                <input type="hidden" name="returnTo" value={`/people/students/${student.id}`} />
                <SelectField
                  id="docTemplate"
                  name="templateId"
                  label={l('pdf')}
                  options={templates.map((x) => ({ value: x.id, label: x.name }))}
                />
                <FormActions>
                  <Button type="submit" variant="ghost">
                    {l('generatePdf')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}

        {tab === 'fees' && !(feeProfile && feeDemands) ? (
          <Card title="Fees">
            <p className="ep-field__help">
              {can('fees.demand.view')
                ? 'No fee profile for this student in the working year yet.'
                : 'You do not have access to fee details.'}
            </p>
          </Card>
        ) : null}
        {tab === 'fees' && feeProfile && feeDemands ? (
          <Card
            title={f('demand')}
            actions={
              can('fees.ledger.view') ? (
                <a href={`/fees/ledger/${student.id}`} className="ep-btn ep-btn--ghost ep-btn--sm">
                  {f('viewLedger')}
                </a>
              ) : undefined
            }
          >
            <p className="ep-field__help">
              {f('profile')}:{' '}
              {feeProfile.isDefault
                ? f('defaultProfile')
                : `${feeProfile.feeGroup} · ${feeProfile.studentType}`}
              {feeProfile.transportSlab
                ? ` · ${f('transportSlab')} ${feeProfile.transportSlab}`
                : ''}
              {feeProfile.discount ? ` · ${f('discount')} ${feeProfile.discount}` : ''}
              {Number(feeProfile.openingBalance) !== 0
                ? ` · ${f('openingBalance')} ${feeProfile.openingBalance}`
                : ''}
            </p>
            {can('fees.profile.manage') ? (
              <form action={setFeeProfile} style={{ marginTop: 'var(--sp-3)' }}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="feeGroup" value={feeProfile.feeGroup} />
                <FormRow columns={4}>
                  <SelectField
                    id="feeStudentType"
                    name="studentType"
                    label={f('studentType')}
                    defaultValue={feeProfile.studentType}
                    options={[
                      { value: 'new', label: f('studentTypes.new') },
                      { value: 'old', label: f('studentTypes.old') },
                    ]}
                  />
                  <SelectField
                    id="feeSlab"
                    name="transportSlabId"
                    label={f('transportSlab')}
                    defaultValue={feeProfile.transportSlabId ?? ''}
                    options={[
                      { value: '', label: f('none') },
                      ...slabs.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
                    ]}
                  />
                  <SelectField
                    id="feeDiscount"
                    name="discountId"
                    label={f('discount')}
                    defaultValue={feeProfile.discountId ?? ''}
                    options={[
                      { value: '', label: f('none') },
                      ...feeDiscounts.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })),
                    ]}
                  />
                  <SelectField
                    id="feeInstalments"
                    name="instalmentsOverride"
                    label={f('instalments')}
                    defaultValue={
                      feeProfile.instalmentsOverride ? String(feeProfile.instalmentsOverride) : ''
                    }
                    options={[
                      { value: '', label: f('instalmentsDefault') },
                      ...[1, 2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: String(n) })),
                    ]}
                  />
                  <InputField
                    id="feeOpening"
                    name="openingBalance"
                    label={f('openingBalance')}
                    type="number"
                    step="0.01"
                    defaultValue={Number(feeProfile.openingBalance)}
                  />
                </FormRow>
                <FormRow columns={1}>
                  <Checkbox
                    id="feeHosteller"
                    name="hosteller"
                    label={f('hosteller')}
                    defaultChecked={feeProfile.hosteller}
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {f('saveProfile')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
            {feeProfile && can('fees.profile_change.request') ? (
              <form action={requestProfileChange} style={{ marginTop: 'var(--sp-3)' }}>
                <input type="hidden" name="studentId" value={student.id} />
                <p className="ep-field__help">{f('requestChange')}</p>
                <FormRow columns={4}>
                  <SelectField
                    id="chgType"
                    name="studentType"
                    label={f('studentType')}
                    options={[
                      { value: '', label: a('keep') },
                      { value: 'new', label: f('studentTypes.new') },
                      { value: 'old', label: f('studentTypes.old') },
                    ]}
                  />
                  <SelectField
                    id="chgDiscount"
                    name="discountId"
                    label={f('discount')}
                    options={[
                      { value: '', label: a('keep') },
                      { value: 'none', label: f('none') },
                      ...feeDiscounts.map((d) => ({ value: d.id, label: d.name })),
                    ]}
                  />
                  <SelectField
                    id="chgHostel"
                    name="hosteller"
                    label={f('hosteller')}
                    options={[
                      { value: '', label: a('keep') },
                      { value: 'yes', label: a('yes') },
                      { value: 'no', label: a('no') },
                    ]}
                  />
                  <InputField
                    id="chgReason"
                    name="reason"
                    label={a('reason')}
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {a('requestChange')}
                  </Button>
                </FormActions>
              </form>
            ) : null}
            {can('fees.demand.generate') ? (
              <form action={generateStudentDemand} style={{ marginTop: 'var(--sp-2)' }}>
                <input type="hidden" name="studentId" value={student.id} />
                <p className="ep-field__help">{f('generateHelp')}</p>
                <Button type="submit">
                  {feeDemands.rows.length ? f('regenerate') : f('generate')}
                </Button>
              </form>
            ) : null}
            {feeDemands.rows.length ? (
              <div style={{ marginTop: 'var(--sp-4)' }}>
                <DataTable<FeeDemandSummary['byInstalment'][number]>
                  caption={f('byInstalment')}
                  density="dense"
                  columns={[
                    {
                      key: 'inst',
                      header: f('instalment'),
                      numeric: true,
                      render: (x) => x.instalment,
                    },
                    { key: 'due', header: f('dueOn'), render: (x) => x.dueOn },
                    { key: 'net', header: f('net'), numeric: true, render: (x) => x.net },
                    { key: 'paid', header: f('paid'), numeric: true, render: (x) => x.paid },
                    {
                      key: 'bal',
                      header: f('balance'),
                      numeric: true,
                      render: (x) => <strong>{x.balance}</strong>,
                    },
                  ]}
                  rows={feeDemands.byInstalment}
                  rowKey={(x) => String(x.instalment)}
                  emptyTitle={f('noDemand')}
                />
                <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
                  {f('total')}: {f('net')} {feeDemands.total.net} · {f('paid')}{' '}
                  {feeDemands.total.paid} ·{' '}
                  <strong>
                    {f('balance')} {feeDemands.total.balance}
                  </strong>
                  {feeDemands.lastRun
                    ? ` · ${f('lastRun')} ${new Date(feeDemands.lastRun.ranAt).toLocaleString('en-IN')} (${feeDemands.lastRun.ranBy ?? ''})`
                    : ''}
                </p>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
