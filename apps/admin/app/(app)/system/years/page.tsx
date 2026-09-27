import {
  Badge,
  Button,
  Card,
  DataTable,
  InputField,
  PageHeader,
  SelectField,
  toneForStatus,
} from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { createYear, yearAction } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Year } from '@/lib/types';

const STAGES = ['attendance', 'exams', 'fees', 'academics'] as const;

function StageForm({ y, stage }: { y: Year; stage: (typeof STAGES)[number] }) {
  const locked = y.locks?.[stage] === true || y.status === 'locked';
  return (
    <form action={yearAction} style={{ display: 'inline' }}>
      <input type="hidden" name="kind" value={y.kind} />
      <input type="hidden" name="id" value={y.id} />
      <input type="hidden" name="stage" value={stage} />
      <input type="hidden" name="action" value={locked ? 'reopen' : 'lock'} />
      <input
        type="hidden"
        name="reason"
        value={`${locked ? 'reopen' : 'lock'} ${stage} from admin`}
      />
      <button
        type="submit"
        className={`ep-badge ep-badge--${locked ? 'warning' : 'success'}`}
        disabled={y.status === 'closed'}
        title={locked ? `Reopen ${stage}` : `Lock ${stage}`}
        style={{ cursor: 'pointer', border: 'none' }}
      >
        {stage}: {locked ? 'locked' : 'open'}
      </button>
    </form>
  );
}

export default async function YearsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const years = await apiFetch<{ data: Year[] }>('/platform/years');
  return (
    <>
      <PageHeader
        kicker="System"
        title="Academic and financial years"
        description="Years are dimensions: activate the next one, lock stages as they close, and never copy master data."
      />
      <Notice params={sp} />
      <Card>
        <DataTable<Year>
          caption="Years"
          columns={[
            { key: 'kind', header: 'Kind', render: (y) => y.kind },
            { key: 'code', header: 'Code', render: (y) => <strong>{y.code}</strong> },
            { key: 'name', header: 'Name', render: (y) => y.name },
            { key: 'dates', header: 'Dates', render: (y) => `${y.startDate} → ${y.endDate}` },
            {
              key: 'status',
              header: 'Status',
              render: (y) => <Badge tone={toneForStatus(y.status)}>{y.status}</Badge>,
            },
            {
              key: 'stages',
              header: 'Stages',
              render: (y) => (
                <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  {STAGES.map((s) => (
                    <StageForm key={s} y={y} stage={s} />
                  ))}
                </div>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (y) => (
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  {y.status === 'planned' ? (
                    <form action={yearAction}>
                      <input type="hidden" name="kind" value={y.kind} />
                      <input type="hidden" name="id" value={y.id} />
                      <input type="hidden" name="action" value="activate" />
                      <Button type="submit" size="sm" variant="accent">
                        Activate
                      </Button>
                    </form>
                  ) : null}
                  {y.status === 'locked' ? (
                    <form action={yearAction}>
                      <input type="hidden" name="kind" value={y.kind} />
                      <input type="hidden" name="id" value={y.id} />
                      <input type="hidden" name="action" value="close" />
                      <input type="hidden" name="reason" value="closed from admin" />
                      <Button type="submit" size="sm" variant="secondary">
                        Close
                      </Button>
                    </form>
                  ) : null}
                </div>
              ),
            },
          ]}
          rows={years.data}
          rowKey={(y) => `${y.kind}-${y.id}`}
        />
      </Card>
      <Card title="Create a year" style={{ marginTop: 'var(--sp-5)' }}>
        <form
          action={createYear}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          <SelectField
            id="y-kind"
            name="kind"
            label="Kind"
            options={[
              { value: 'academic', label: 'Academic session' },
              { value: 'financial', label: 'Financial year' },
            ]}
          />
          <InputField
            id="y-code"
            name="code"
            label="Code"
            required
            placeholder="2027-28"
            pattern="(FY)?[0-9]{4}-[0-9]{2}"
          />
          <InputField id="y-name" name="name" label="Name" required placeholder="Session 2027-28" />
          <InputField id="y-start" name="startDate" label="Start" type="date" required />
          <InputField id="y-end" name="endDate" label="End" type="date" required />
          <div>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
