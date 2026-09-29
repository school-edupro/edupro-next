import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { answerEmployeeQuery, raiseEmployeeQuery } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Page } from '@/lib/types';

interface Query {
  id: string;
  employee: string;
  employeeCode: string;
  category: string;
  subject: string;
  detail: string;
  status: string;
  answer: string | null;
  workflowInstanceId: string | null;
  createdAt: string;
}

/** Sprint 19: employee queries on the workflow. */
export default async function EmployeeQueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, e, me] = await Promise.all([
    getTranslations('pages.engagement_employee_queries'),
    getTranslations('eng19'),
    getMe(),
  ]);
  const canAnswer = me.permissions.includes('engagement.employee_query.answer');
  const list = await apiFetch<Page<Query>>(
    canAnswer
      ? '/engagement/employee-queries?size=100'
      : '/engagement/employee-queries/mine?size=100',
  );
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      {me.permissions.includes('engagement.employee_query.create') ? (
        <Card title={e('request')} style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={raiseEmployeeQuery}>
            <FormRow columns={3}>
              <SelectField
                id="category"
                name="category"
                label={e('category')}
                options={['leave', 'payroll', 'facilities', 'grievance', 'other'].map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
              <InputField
                id="subject"
                name="subject"
                label={e('subject')}
                required
                minLength={3}
                maxLength={160}
              />
              <InputField
                id="detail"
                name="detail"
                label={e('detail')}
                required
                minLength={3}
                maxLength={2000}
              />
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">{e('request')}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card>
        <DataTable<Query>
          caption={`${t('title')} · ${list.page.total}`}
          density="dense"
          columns={[
            {
              key: 'e',
              header: e('employee'),
              render: (q) => (
                <>
                  <strong>{q.employee}</strong>
                  <div className="ep-kicker">
                    {q.employeeCode} · {q.createdAt.slice(0, 10)}
                  </div>
                </>
              ),
            },
            { key: 'c', header: e('category'), render: (q) => q.category },
            {
              key: 's',
              header: e('subject'),
              render: (q) => (
                <>
                  {q.subject}
                  <div className="ep-kicker">{q.detail}</div>
                </>
              ),
            },
            {
              key: 'st',
              header: e('status'),
              render: (q) => (
                <>
                  <Badge
                    tone={
                      q.status === 'approved'
                        ? 'success'
                        : q.status === 'pending'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {q.status}
                  </Badge>
                  {q.answer ? <div className="ep-kicker">{q.answer}</div> : null}
                </>
              ),
            },
            {
              key: 'a',
              header: '',
              render: (q) =>
                q.status !== 'pending' ? null : q.workflowInstanceId ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/workflow/instances/${q.workflowInstanceId}`}
                  >
                    {e('inWorkflow')}
                  </a>
                ) : canAnswer ? (
                  <form
                    action={answerEmployeeQuery}
                    style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'flex-end' }}
                  >
                    <input type="hidden" name="id" value={q.id} />
                    <InputField id={`n-${q.id}`} name="note" label={e('answer')} maxLength={500} />
                    <Button type="submit" name="outcome" value="approved" size="sm">
                      {e('answer')}
                    </Button>
                    <Button type="submit" name="outcome" value="rejected" size="sm" variant="ghost">
                      {e('reject')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={list.data}
          rowKey={(q) => q.id}
          emptyTitle={e('noRows')}
        />
      </Card>
    </>
  );
}
