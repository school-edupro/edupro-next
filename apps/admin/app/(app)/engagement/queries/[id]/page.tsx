import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { assignQuery, closeQuery, respondToQuery } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Membership, Page, ParentQuery } from '@/lib/types';

export default async function QueryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, e, me, q] = await Promise.all([
    getTranslations('pages.engagement_queries'),
    getTranslations('engagement'),
    getMe(),
    apiFetch<ParentQuery>(`/engagement/queries/${id}`),
  ]);
  const canRespond = me.permissions.includes('engagement.query.respond');
  const staff = canRespond
    ? await apiFetch<Page<Membership>>('/access/memberships?size=200')
        .then((r) => r.data.filter((u) => u.personType === 'employee'))
        .catch(() => [] as Membership[])
    : [];
  const tone =
    q.status === 'closed'
      ? 'neutral'
      : q.status === 'answered'
        ? 'success'
        : q.status === 'in_progress'
          ? 'info'
          : 'warning';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/engagement/queries' },
          { label: t('title'), href: '/engagement/queries' },
          { label: q.number },
        ]}
      />
      <PageHeader
        kicker={`${q.number} · ${e(`kinds.${q.kind}`)}`}
        title={q.subject}
        description={`${q.studentName}${q.section ? ` · ${q.section}` : ''} · ${e('raisedBy')} ${q.raisedBy ?? ''} · ${q.categoryName} · ${e('opened')} ${new Date(q.openedAt).toLocaleString('en-IN')}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
            <Badge tone={tone}>{e(`statuses.${q.status}`)}</Badge>
            {q.decision ? (
              <Badge tone={q.decision === 'approved' ? 'success' : 'danger'}>
                {e(`decisions.${q.decision}`)}
              </Badge>
            ) : null}
            {q.rating ? (
              <Badge tone="info">
                {e('rating')} {q.rating}/5
              </Badge>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        }}
      >
        <Card title={e('thread')}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{q.body}</p>
          {q.kind === 'leave' ? (
            <p className="ep-field__help">
              {e('leaveDates')}: {q.leaveFrom} → {q.leaveTo}
            </p>
          ) : null}
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              marginTop: 'var(--sp-3)',
              display: 'grid',
              gap: 'var(--sp-2)',
            }}
          >
            {(q.responses ?? []).map((r) => (
              <li
                key={r.id}
                className="ep-card"
                style={{
                  padding: 'var(--sp-3)',
                  borderLeft: r.isInternal ? '3px solid var(--warning)' : undefined,
                }}
              >
                <div className="ep-kicker">
                  {r.author ?? r.authorKind} · {new Date(r.createdAt).toLocaleString('en-IN')}
                  {r.isInternal ? ` · ${e('internal')}` : ''}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
              </li>
            ))}
          </ul>
          {q.ratingComment ? (
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
              {e('rating')}: {q.rating}/5 · {q.ratingComment}
            </p>
          ) : null}
        </Card>
        {canRespond && q.status !== 'closed' ? (
          <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
            <Card title={e('reply')}>
              <form action={respondToQuery}>
                <input type="hidden" name="id" value={q.id} />
                <p className="ep-field__help">{e('replyHelp')}</p>
                <label className="ep-field" htmlFor="body">
                  <span className="ep-field__label">{e('reply')}</span>
                  <textarea
                    id="body"
                    name="body"
                    className="ep-input"
                    rows={4}
                    required
                    maxLength={4000}
                  />
                </label>
                <label
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    marginTop: 'var(--sp-2)',
                  }}
                >
                  <input type="checkbox" name="isInternal" /> {e('internal')}
                </label>
                <FormActions>
                  <Button type="submit">{e('send')}</Button>
                </FormActions>
              </form>
            </Card>
            <Card title={e('assign')}>
              <form action={assignQuery}>
                <input type="hidden" name="id" value={q.id} />
                <FormRow columns={2}>
                  <SelectField
                    id="userId"
                    name="userId"
                    label={e('assignTo')}
                    defaultValue={q.assignedUserId ?? ''}
                    options={[
                      { value: '', label: e('unassigned') },
                      ...staff.map((u) => ({ value: u.userId, label: u.displayName })),
                    ]}
                  />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {e('assign')}
                  </Button>
                </FormActions>
              </form>
            </Card>
            <Card title={e('close')}>
              <form action={closeQuery}>
                <input type="hidden" name="id" value={q.id} />
                <p className="ep-field__help">{e('closeHelp')}</p>
                <FormRow columns={2}>
                  {q.kind === 'leave' ? (
                    <SelectField
                      id="decision"
                      name="decision"
                      label={e('decision')}
                      options={(['approved', 'rejected'] as const).map((d) => ({
                        value: d,
                        label: e(`decisions.${d}`),
                      }))}
                    />
                  ) : null}
                  <InputField id="note" name="note" label={e('note')} maxLength={1000} />
                </FormRow>
                <FormActions>
                  <Button type="submit" variant="danger">
                    {e('close')}
                  </Button>
                </FormActions>
              </form>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
