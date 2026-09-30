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
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { createYear, updateYear, yearAction } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Year } from '@/lib/types';

const STAGES = ['attendance', 'exams', 'fees', 'academics'] as const;

function StageForm({ y, stage }: { y: Year; stage: (typeof STAGES)[number] }) {
  // a locked year is read only except the stages explicitly reopened (false); see migration 0035
  const locked = y.status === 'locked' ? y.locks?.[stage] !== false : y.locks?.[stage] === true;
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
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; edit?: string }>;
}) {
  const t = await getTranslations('pages.system_years');
  const sp = await searchParams;
  const years = await apiFetch<{ data: Year[] }>('/platform/years');
  const editing =
    years.data.find((y) => `${y.kind}-${y.id}` === sp.edit && y.status === 'planned') ?? null;
  const kindLabel = (y: Year) => (y.kind === 'academic' ? 'academic session' : 'financial year');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
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
              header: 'Actions',
              render: (y) => {
                const f = { kind: y.kind, id: y.id };
                if (y.status === 'planned')
                  return (
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/system/years?edit=${y.kind}-${y.id}`}
                      >
                        Edit
                      </a>
                      <ConfirmAction
                        action={yearAction}
                        fields={{ ...f, action: 'activate' }}
                        label="Activate"
                        variant="accent"
                        title={`Activate ${y.code}?`}
                        confirmLabel="Activate"
                        confirmVariant="accent"
                      >
                        <p>
                          {y.code} becomes the working {kindLabel(y)}. The {kindLabel(y)} that is
                          active now becomes <strong>locked</strong>: its data stays, and you can
                          reopen a single stage of it for late corrections.
                        </p>
                      </ConfirmAction>
                      <ConfirmAction
                        action={yearAction}
                        fields={{ ...f, action: 'delete' }}
                        label="Delete"
                        variant="danger"
                        title={`Delete ${y.code}?`}
                        confirmLabel="Delete"
                        confirmVariant="danger"
                      >
                        <p>
                          The planned {kindLabel(y)} {y.code} is removed. This is only possible
                          while nothing has been recorded against it.
                        </p>
                      </ConfirmAction>
                    </div>
                  );
                if (y.status === 'locked') {
                  const current = years.data.find(
                    (o) => o.kind === y.kind && o.status === 'active',
                  );
                  return (
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <ConfirmAction
                        action={yearAction}
                        fields={{ ...f, action: 'make-working' }}
                        label="Make working year"
                        variant="accent"
                        title={`Make ${y.code} the working ${kindLabel(y)}?`}
                        confirmLabel="Make working year"
                        confirmVariant="accent"
                        reason={{
                          label: 'Reason',
                          placeholder: 'Next session was activated by mistake',
                        }}
                      >
                        <p>
                          {y.code} becomes active with every stage open, and every user's default
                          year.
                          {current ? (
                            <>
                              {' '}
                              {current.code} becomes <strong>locked</strong>; its data stays and you
                              can make it the working year again later.
                            </>
                          ) : null}{' '}
                          The reason is kept in the audit log.
                        </p>
                      </ConfirmAction>
                      <ConfirmAction
                        action={yearAction}
                        fields={{ ...f, action: 'close' }}
                        label="Close"
                        title={`Close ${y.code}?`}
                        confirmLabel="Close year"
                        confirmVariant="danger"
                        reason={{ label: 'Reason', placeholder: 'Year-end complete, audited' }}
                      >
                        <p>
                          A closed year is read only: no stage can be reopened until someone with
                          the reopen permission reopens the whole year. The reason is kept in the
                          audit log.
                        </p>
                      </ConfirmAction>
                    </div>
                  );
                }
                if (y.status === 'closed')
                  return (
                    <ConfirmAction
                      action={yearAction}
                      fields={{ ...f, action: 'reopen-year' }}
                      label="Reopen"
                      title={`Reopen ${y.code}?`}
                      confirmLabel="Reopen year"
                      confirmVariant="primary"
                      reason={{
                        label: 'Reason',
                        placeholder: 'Late fee correction approved by the principal',
                      }}
                    >
                      <p>
                        {y.code} goes back to <strong>locked</strong>. Its stages stay locked;
                        reopen only the stage that needs the correction, then close the year again.
                        The reason is kept in the audit log.
                      </p>
                    </ConfirmAction>
                  );
                return (
                  <span className="ep-field__help">
                    Working year. Lock stages as they finish; activate the next year to move on.
                  </span>
                );
              },
            },
          ]}
          rows={years.data}
          rowKey={(y) => `${y.kind}-${y.id}`}
        />
      </Card>
      <Card
        title={editing ? `Edit ${editing.code}` : 'Create a year'}
        style={{ marginTop: 'var(--sp-5)' }}
      >
        {editing ? (
          <p className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
            A planned {kindLabel(editing)} can be edited until it is activated. The kind cannot
            change; delete it and create a new one instead.
          </p>
        ) : null}
        <form
          key={editing ? `${editing.kind}-${editing.id}` : 'new'}
          action={editing ? updateYear : createYear}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          {editing ? (
            <>
              <input type="hidden" name="kind" value={editing.kind} />
              <input type="hidden" name="id" value={editing.id} />
              <InputField
                id="y-kind"
                label="Kind"
                defaultValue={editing.kind === 'academic' ? 'Academic session' : 'Financial year'}
                readOnly
              />
            </>
          ) : (
            <SelectField
              id="y-kind"
              name="kind"
              label="Kind"
              options={[
                { value: 'academic', label: 'Academic session' },
                { value: 'financial', label: 'Financial year' },
              ]}
            />
          )}
          <InputField
            id="y-code"
            name="code"
            label="Code"
            required
            placeholder="2027-28"
            pattern="(FY)?[0-9]{4}-[0-9]{2}"
            defaultValue={editing?.code}
          />
          <InputField
            id="y-name"
            name="name"
            label="Name"
            required
            placeholder="Session 2027-28"
            defaultValue={editing?.name}
          />
          <InputField
            id="y-start"
            name="startDate"
            label="Start"
            type="date"
            required
            defaultValue={editing?.startDate}
          />
          <InputField
            id="y-end"
            name="endDate"
            label="End"
            type="date"
            required
            defaultValue={editing?.endDate}
          />
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button type="submit">{editing ? 'Save' : 'Create'}</Button>
            {editing ? (
              <a className="ep-btn ep-btn--ghost" href="/system/years">
                Cancel
              </a>
            ) : null}
          </div>
        </form>
      </Card>
    </>
  );
}
