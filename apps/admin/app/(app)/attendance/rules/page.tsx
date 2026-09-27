import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { clearAttendanceRule, setAttendanceRule } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { AttendanceRule, Page, Student } from '@/lib/types';

export default async function AttendanceRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classSectionId?: string }>;
}) {
  const sp = await searchParams;
  const [t, a, rules, sections] = await Promise.all([
    getTranslations('pages.attendance_rules'),
    getTranslations('attendance'),
    apiFetch<{ data: AttendanceRule[] }>('/attendance/rules').then((r) => r.data),
    sectionOptions(),
  ]);
  const students = sp.classSectionId
    ? await apiFetch<Page<Student>>(
        `/people/students?classSectionId=${sp.classSectionId}&size=200`,
      ).then((r) => r.data)
    : [];
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <Card title={t('title')}>
          <DataTable<AttendanceRule>
            caption={t('title')}
            density="dense"
            columns={[
              {
                key: 'student',
                header: a('student'),
                render: (r) => <a href={`/people/students/${r.studentId}`}>{r.student}</a>,
              },
              { key: 'section', header: a('section'), render: (r) => r.section ?? '' },
              { key: 'late', header: a('lateAfterRule'), render: (r) => r.lateAfter ?? '—' },
              {
                key: 'muted',
                header: a('alertsMuted'),
                render: (r) =>
                  r.alertsMuted ? <Badge tone="warning">{a('alertsMuted')}</Badge> : '',
              },
              { key: 'reason', header: a('ruleReason'), render: (r) => r.reason ?? '' },
              {
                key: 'clear',
                header: '',
                render: (r) => (
                  <form action={clearAttendanceRule}>
                    <input type="hidden" name="studentId" value={r.studentId} />
                    <Button type="submit" variant="ghost" size="sm">
                      {a('clearRule')}
                    </Button>
                  </form>
                ),
              },
            ]}
            rows={rules}
            rowKey={(r) => r.studentId}
            emptyTitle={a('noRules')}
          />
        </Card>
        <Card title={a('setRule')}>
          <p className="ep-field__help">{a('rulesHelp')}</p>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <SelectField
              id="classSectionId"
              name="classSectionId"
              label={a('section')}
              defaultValue={sp.classSectionId ?? ''}
              options={[{ value: '', label: '—' }, ...sections]}
            />
            <Button type="submit" variant="secondary">
              {a('student')}
            </Button>
          </form>
          {students.length ? (
            <form action={setAttendanceRule}>
              <FormRow columns={2}>
                <SelectField
                  id="studentId"
                  name="studentId"
                  label={a('student')}
                  options={students.map((s) => ({
                    value: s.id,
                    label: `${s.displayName} · ${s.admissionNo}`,
                  }))}
                />
                <InputField
                  id="lateAfter"
                  name="lateAfter"
                  label={a('lateAfterRule')}
                  type="time"
                />
              </FormRow>
              <FormRow columns={2}>
                <InputField id="reason" name="reason" label={a('ruleReason')} maxLength={200} />
                <InputField id="validTo" name="validTo" label={a('validTo')} type="date" />
              </FormRow>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="alertsMuted" /> {a('alertsMuted')}
              </label>
              <FormActions>
                <Button type="submit">{a('setRule')}</Button>
              </FormActions>
            </form>
          ) : null}
        </Card>
      </div>
    </>
  );
}
