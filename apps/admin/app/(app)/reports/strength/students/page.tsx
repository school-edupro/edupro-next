import { Breadcrumbs, Card, DataTable, PageHeader } from '@edupro/ui';
import { apiFetch } from '@/lib/api';

interface Row {
  id: string;
  name: string;
  admissionNo: string;
  classSection: string;
  rollNo: number | null;
  gender: string;
  status: string;
}

/** The students behind one number of a strength report. */
export default async function StrengthStudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v !== undefined && k !== 'label') q.set(k, v);
  const data = await apiFetch<{ data: Row[] }>(`/reports/strength/students?${q.toString()}`).then(
    (r) => r.data,
  );
  const back = new URLSearchParams(q);
  for (const k of ['column', 'classId', 'classSectionId', 'stream']) back.delete(k);
  back.set('run', '1');
  const column = sp.column ?? '';
  const what = column.includes('|')
    ? column.replace('|', ' · ')
    : column.replace(/^d:/, 'discount ');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports/exports' },
          { label: 'Student strength', href: `/reports/strength?${back.toString()}` },
          { label: 'Students' },
        ]}
      />
      <PageHeader
        kicker="Student strength"
        title={`${sp.label ?? ''} · ${String(data.length)} students`}
        description={`Column: ${what}`}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/reports/strength?${back.toString()}`}
          >
            Back to the report
          </a>
        }
      />
      <Card>
        <DataTable<Row>
          caption="Students"
          density="dense"
          columns={[
            {
              key: 'name',
              header: 'Student',
              render: (r) => <a href={`/people/students/${r.id}`}>{r.name}</a>,
            },
            { key: 'adm', header: 'Admission no', render: (r) => r.admissionNo },
            { key: 'cls', header: 'Class', render: (r) => r.classSection },
            {
              key: 'roll',
              header: 'Roll',
              render: (r) => (r.rollNo === null ? '' : String(r.rollNo)),
            },
            { key: 'gender', header: 'Gender', render: (r) => r.gender },
            { key: 'status', header: 'Status', render: (r) => r.status },
          ]}
          rows={data}
          rowKey={(r) => r.id}
          emptyTitle="No students"
        />
      </Card>
    </>
  );
}
