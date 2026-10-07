import {
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { saveAcademicSettings } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';

interface Settings {
  publishTime: string | null;
  teacherMobile: 'full' | 'masked' | 'hidden';
  teacherEmail: 'full' | 'masked' | 'hidden';
  maxMb: Record<'daily_work' | 'assignment' | 'documents' | 'notices' | 'gallery', number>;
}

const SHOW = [
  { value: 'masked', label: 'Masked (98XXXXXX10, an***@school.in)' },
  { value: 'full', label: 'Shown in full' },
  { value: 'hidden', label: 'Not shown' },
];
const SECTIONS: Array<[keyof Settings['maxMb'], string]> = [
  ['daily_work', 'Homework and classwork'],
  ['assignment', 'Assignments'],
  ['documents', 'Class documents (session plan, curriculum, date sheet…)'],
  ['notices', 'Notices and office orders'],
  ['gallery', 'Gallery'],
];

/** What the school decides for the academics module: publish time, teacher contact, upload sizes. */
export default async function AcademicSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, s] = await Promise.all([getMe(), apiFetch<Settings>('/academics/settings')]);
  const canManage = me.permissions.includes('academics.subject.manage');
  return (
    <>
      <PageHeader
        kicker="Academics"
        title="Academics settings"
        description="When daily work reaches the families, how a teacher's contact shows in the parent and student portal, and the largest file each section accepts."
      />
      <AcademicsNav current="/academics/settings" permissions={me.permissions} />
      <Notice params={sp} />
      <form action={saveAcademicSettings}>
        <Card title="Daily work" style={{ marginBottom: 'var(--sp-4)' }}>
          <FormRow columns={3}>
            <InputField
              id="publishTime"
              name="publishTime"
              type="time"
              label="Usual publish time"
              defaultValue={s.publishTime ?? ''}
              help="The homework sheet starts with this time of the day; parents and students see the work from then. Empty = at once. The teacher can still change it on the sheet."
            />
          </FormRow>
        </Card>
        <Card
          title="Teachers in the parent and student portal"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <FormRow columns={3}>
            <SelectField
              id="teacherMobile"
              name="teacherMobile"
              label="Mobile number"
              defaultValue={s.teacherMobile}
              options={SHOW}
            />
            <SelectField
              id="teacherEmail"
              name="teacherEmail"
              label="E-mail"
              defaultValue={s.teacherEmail}
              options={SHOW}
            />
          </FormRow>
        </Card>
        <Card title="Largest file, section by section (MB)">
          <FormRow columns={3}>
            {SECTIONS.map(([key, label]) => (
              <InputField
                key={key}
                id={`mb_${key}`}
                name={`mb_${key}`}
                type="number"
                min={1}
                max={25}
                step={1}
                required
                label={label}
                defaultValue={String(s.maxMb[key])}
                help="1 to 25 MB for each file"
              />
            ))}
          </FormRow>
          {canManage ? (
            <FormActions>
              <Button type="submit">Save</Button>
            </FormActions>
          ) : null}
        </Card>
      </form>
    </>
  );
}
