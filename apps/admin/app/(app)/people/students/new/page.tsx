import {
  Breadcrumbs,
  Button,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createStudent } from '@/lib/actions';
import { sectionOptions } from '../page';

export default async function NewStudentPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, p, g, r, c, sections] = await Promise.all([
    getTranslations('people.students.create'),
    getTranslations('people'),
    getTranslations('people.gender'),
    getTranslations('people.relation'),
    getTranslations('common'),
    sectionOptions(),
  ]);
  const genders = ['unspecified', 'male', 'female', 'other'] as const;
  const relations = ['father', 'mother', 'guardian', 'grandparent', 'other'] as const;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: p('kicker'), href: '/people/students' },
          { label: p('students.title'), href: '/people/students' },
          { label: t('title') },
        ]}
      />
      <PageHeader kicker={p('kicker')} title={t('title')} />
      <Notice params={sp} />
      <form action={createStudent}>
        <FormSection title={t('identity')} description={t('identityHelp')}>
          <FormRow columns={3}>
            <InputField
              id="admissionNo"
              name="admissionNo"
              label={p('students.admissionNo')}
              required
            />
            <InputField id="firstName" name="firstName" label={t('firstName')} required />
            <InputField id="lastName" name="lastName" label={t('lastName')} />
          </FormRow>
          <FormRow columns={4}>
            <InputField id="dob" name="dob" label={t('dob')} type="date" />
            <SelectField
              id="gender"
              name="gender"
              label={t('gender')}
              options={genders.map((v) => ({ value: v, label: g(v) }))}
            />
            <InputField id="category" name="category" label={t('category')} placeholder="GEN" />
            <InputField
              id="bloodGroup"
              name="bloodGroup"
              label={t('bloodGroup')}
              placeholder="B+"
            />
          </FormRow>
          <FormRow columns={2}>
            <InputField id="house" name="house" label={t('house')} />
            <InputField id="admittedOn" name="admittedOn" label={t('admittedOn')} type="date" />
          </FormRow>
        </FormSection>
        <FormSection title={t('guardian')} description={t('guardianHelp')}>
          <FormRow columns={4}>
            <InputField id="guardianName" name="guardianName" label={t('guardianName')} />
            <InputField
              id="guardianMobile"
              name="guardianMobile"
              label={t('guardianMobile')}
              pattern="[6-9][0-9]{9}"
            />
            <InputField
              id="guardianEmail"
              name="guardianEmail"
              label={t('guardianEmail')}
              type="email"
            />
            <SelectField
              id="relation"
              name="relation"
              label={t('relation')}
              options={relations.map((v) => ({ value: v, label: r(v) }))}
            />
          </FormRow>
        </FormSection>
        <FormSection title={t('enrolment')} description={t('enrolmentHelp')}>
          <FormRow columns={2}>
            <SelectField
              id="classSectionId"
              name="classSectionId"
              label={p('students.section')}
              options={[{ value: '', label: c('none') }, ...sections]}
            />
            <InputField
              id="rollNo"
              name="rollNo"
              label={p('students.rollNo')}
              type="number"
              min={1}
              max={999}
            />
          </FormRow>
        </FormSection>
        <FormActions>
          <Button type="submit">{t('submit')}</Button>
          <a className="ep-btn ep-btn--secondary" href="/people/students">
            {c('cancel')}
          </a>
        </FormActions>
      </form>
    </>
  );
}
