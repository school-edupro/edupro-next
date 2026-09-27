'use client';
import { Badge, DataGrid } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import type { Student } from '@/lib/types';

export function StudentsGrid({ rows }: { rows: Student[] }) {
  const t = useTranslations('people.students');
  const c = useTranslations('common');
  return (
    <DataGrid<Student>
      id="students"
      caption={t('title')}
      rows={rows}
      rowKey={(r) => r.id}
      pageSize={50}
      searchable={false}
      columns={[
        {
          key: 'admissionNo',
          header: t('admissionNo'),
          render: (r) => <a href={`/people/students/${r.id}`}>{r.admissionNo}</a>,
        },
        {
          key: 'displayName',
          header: c('name'),
          render: (r) => <a href={`/people/students/${r.id}`}>{r.displayName}</a>,
        },
        {
          key: 'section',
          header: t('section'),
          accessor: (r) => (r.enrolment ? `${r.enrolment.classCode}-${r.enrolment.section}` : ''),
          render: (r) => (r.enrolment ? `${r.enrolment.classCode}-${r.enrolment.section}` : ''),
        },
        {
          key: 'rollNo',
          header: t('rollNo'),
          numeric: true,
          accessor: (r) => r.enrolment?.rollNo ?? 0,
          render: (r) => r.enrolment?.rollNo ?? '',
        },
        { key: 'gender', header: 'Gender', hidden: true },
        { key: 'dob', header: 'DOB', hidden: true, render: (r) => r.dob ?? '' },
        {
          key: 'status',
          header: c('status'),
          render: (r) => (
            <Badge tone={r.status === 'active' ? 'success' : 'danger'}>{r.status}</Badge>
          ),
        },
      ]}
      emptyTitle={t('empty')}
    />
  );
}
