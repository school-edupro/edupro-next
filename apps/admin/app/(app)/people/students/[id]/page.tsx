import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import {
  enrolStudent,
  linkGuardian,
  requestStudentIdCard,
  unlinkGuardian,
  updateStudent,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Enrolment, GuardianLink, PersonDocument, Student360 } from '@/lib/types';
import { sectionOptions } from '@/lib/sections';

export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
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
  const genders = ['unspecified', 'male', 'female', 'other'] as const;
  const relations = ['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'] as const;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: p('kicker'), href: '/people/students' },
          { label: t('title'), href: '/people/students' },
          { label: student.displayName },
        ]}
      />
      <PageHeader
        kicker={p('kicker')}
        title={student.displayName}
        description={
          <>
            {t('admissionNo')} <strong>{student.admissionNo}</strong>
            {student.enrolment
              ? ` · ${student.enrolment.classCode}-${student.enrolment.section}${student.enrolment.rollNo ? ` · ${t('rollNo')} ${student.enrolment.rollNo}` : ''}`
              : ''}
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={student.status === 'active' ? 'success' : 'danger'}>
              {student.status}
            </Badge>
            <form action={requestStudentIdCard}>
              <input type="hidden" name="id" value={student.id} />
              <Button type="submit" variant="secondary" size="sm" title={t('idCardHelp')}>
                {t('requestIdCard')}
              </Button>
            </form>
          </div>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
        <Card title={t('profile')}>
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
              <InputField
                id="category"
                name="category"
                label={t('create.category')}
                defaultValue={student.category ?? ''}
                disabled={!can('people.student.edit')}
              />
              <InputField
                id="bloodGroup"
                name="bloodGroup"
                label={t('create.bloodGroup')}
                defaultValue={student.bloodGroup ?? ''}
                disabled={!can('people.student.edit')}
              />
              <InputField
                id="house"
                name="house"
                label={t('create.house')}
                defaultValue={student.house ?? ''}
                disabled={!can('people.student.edit')}
              />
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
                  <a href={`/people/students/${s.id}`}>{s.displayName}</a> ({s.admissionNo})
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

        <Card title={t('documents')}>
          <DataTable<PersonDocument>
            caption={t('documents')}
            density="dense"
            columns={[
              { key: 'kind', header: 'Kind', render: (d) => d.kind },
              { key: 'file', header: 'File', render: (d) => d.fileName ?? d.fileId },
              { key: 'number', header: 'Number', render: (d) => d.number ?? '' },
              { key: 'expires', header: 'Expires', render: (d) => d.expiresOn ?? '' },
            ]}
            rows={student.documents}
            rowKey={(d) => d.id}
            emptyTitle={t('noDocuments')}
          />
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Alert tone="info">
              Files are uploaded through the API file service (signed upload URL) and attached with
              the document endpoint; a browser uploader arrives with the admissions module.
            </Alert>
          </div>
        </Card>
      </div>
    </>
  );
}
