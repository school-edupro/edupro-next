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
import { createNotice, deleteNotice, publishNotice } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Audience, ClassRow, Notice as NoticeRow, Page } from '@/lib/types';

const AUDIENCES: Audience[] = ['everyone', 'students', 'employees'];

/** S7-04: notices and circulars with audience and targets; publish and unpublish. */
export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, d, c, me] = await Promise.all([
    getTranslations('pages.academics_notices'),
    getTranslations('daily'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.notice.manage');
  const query = new URLSearchParams({ size: '100', status: sp.status ?? 'all' });
  if (sp.q) query.set('q', sp.q);
  const [notices, classes, sections] = await Promise.all([
    apiFetch<Page<NoticeRow>>(`/academics/notices?${query.toString()}`),
    canManage
      ? apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data)
      : Promise.resolve<ClassRow[]>([]),
    canManage ? sectionOptions() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <InputField id="q" name="q" label={c('filter')} defaultValue={sp.q ?? ''} />
          {canManage ? (
            <SelectField
              id="status"
              name="status"
              label={d('status')}
              defaultValue={sp.status ?? 'all'}
              options={[
                { value: 'all', label: c('all') },
                { value: 'published', label: d('published') },
                { value: 'draft', label: d('draft') },
              ]}
            />
          ) : null}
          <Button type="submit" variant="secondary">
            {c('apply')}
          </Button>
        </form>
        <DataTable<NoticeRow>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'from', header: d('publishFrom'), render: (n) => n.publishFrom },
            {
              key: 'kind',
              header: d('kind'),
              render: (n) => (
                <Badge tone={n.kind === 'circular' ? 'warning' : 'info'}>
                  {d(`noticeKinds.${n.kind}`)}
                </Badge>
              ),
            },
            {
              key: 'title',
              header: d('title'),
              render: (n) => (
                <span>
                  {n.isPinned ? '📌 ' : ''}
                  <strong>{n.title}</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)' }}>
                    {n.body.slice(0, 160)}
                  </span>
                </span>
              ),
            },
            { key: 'audience', header: d('audience'), render: (n) => d(`audiences.${n.audience}`) },
            {
              key: 'targets',
              header: d('targets'),
              render: (n) =>
                n.targets.length ? n.targets.map((x) => x.label).join(', ') : d('noTargets'),
            },
            {
              key: 'status',
              header: d('status'),
              render: (n) => (
                <Badge tone={n.publishedAt ? 'success' : 'neutral'}>
                  {n.publishedAt ? d('published') : d('draft')}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (n) =>
                canManage ? (
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                    <form action={publishNotice}>
                      <input type="hidden" name="id" value={n.id} />
                      <input
                        type="hidden"
                        name="action"
                        value={n.publishedAt ? 'unpublish' : 'publish'}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {n.publishedAt ? d('unpublish') : d('publish')}
                      </Button>
                    </form>
                    <form action={deleteNotice}>
                      <input type="hidden" name="id" value={n.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {d('delete')}
                      </Button>
                    </form>
                  </span>
                ) : null,
            },
          ]}
          rows={notices.data}
          rowKey={(n) => n.id}
          emptyTitle={d('noNotices')}
        />
      </Card>

      {canManage ? (
        <Card title={d('newNotice')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={createNotice}>
            <FormRow columns={4}>
              <SelectField
                id="kind"
                name="kind"
                label={d('kind')}
                options={(['notice', 'circular'] as const).map((k) => ({
                  value: k,
                  label: d(`noticeKinds.${k}`),
                }))}
              />
              <SelectField
                id="audience"
                name="audience"
                label={d('audience')}
                options={AUDIENCES.map((a) => ({ value: a, label: d(`audiences.${a}`) }))}
              />
              <InputField
                id="publishFrom"
                name="publishFrom"
                label={d('publishFrom')}
                type="date"
              />
              <InputField
                id="publishUntil"
                name="publishUntil"
                label={d('publishUntil')}
                type="date"
              />
            </FormRow>
            <FormRow columns={1}>
              <InputField id="title" name="title" label={d('title')} required maxLength={200} />
            </FormRow>
            <FormRow columns={1}>
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="body">
                  {d('body')}
                </label>
                <textarea
                  id="body"
                  name="body"
                  className="ep-input"
                  rows={5}
                  required
                  maxLength={20000}
                />
              </div>
            </FormRow>
            <FormRow columns={2}>
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="classIds">
                  {d('targetClasses')}
                </label>
                <select id="classIds" name="classIds" className="ep-select" multiple size={5}>
                  {classes.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.code} · {k.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="classSectionIds">
                  {d('targetSections')}
                </label>
                <select
                  id="classSectionIds"
                  name="classSectionIds"
                  className="ep-select"
                  multiple
                  size={5}
                >
                  {sections.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </FormRow>
            <FormRow columns={3}>
              <InputField
                id="files"
                name="files"
                label={d('attachments')}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="isPinned" value="1" /> {d('pinned')}
              </label>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="publish" value="1" defaultChecked /> {d('publishNow')}
              </label>
            </FormRow>
            <FormActions>
              <Button type="submit">{c('create')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
