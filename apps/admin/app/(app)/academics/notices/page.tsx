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
import { ChipPickerField } from '@/components/ChipPickerField';
import { RichEditor } from '@/components/files/RichEditor';
import { Notice } from '@/components/Notice';
import { createNotice, deleteNotice, publishNotice } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Audience, ClassRow, Employee, Notice as NoticeRow, Page } from '@/lib/types';

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
  const employees = canManage
    ? await apiFetch<Page<Employee>>('/people/employees?size=200')
        .then((r) => r.data)
        .catch(() => [] as Employee[])
    : [];

  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Notices and office orders"
        description="Notices and circulars show in the parent and student portal; office orders show to employees. Write your own text, attach files, ask for an acknowledgement and send it by e-mail too."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/notices/report">
            Report
          </a>
        }
      />
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
                  {n.kind === 'office_order' ? 'Office order' : d(`noticeKinds.${n.kind}`)}
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
                    {n.body
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/&nbsp;/g, ' ')
                      .slice(0, 160)}
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
              key: 'ack',
              header: 'Acknowledged',
              render: (n) =>
                n.ackRequired ? (
                  <a
                    href={`/academics/acknowledgements?type=notice&id=${n.id}`}
                    style={{ textDecoration: 'underline' }}
                    aria-label={`Who acknowledged ${n.title}`}
                  >
                    {n.ackCount ?? 0} · view
                  </a>
                ) : (
                  '–'
                ),
            },
            {
              key: 'mail',
              header: 'E-mailed',
              render: (n) =>
                n.emailedCount === null || n.emailedCount === undefined ? '–' : n.emailedCount,
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
                options={[
                  { value: 'notice', label: 'Notice (students / parents)' },
                  { value: 'circular', label: 'Circular' },
                  { value: 'office_order', label: 'Office order (employees)' },
                ]}
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
              <div>
                <input type="hidden" name="bodyFormat" value="html" />
                <RichEditor
                  name="body"
                  label={`${d('body')} *`}
                  placeholder="Write the notice or the office order here…"
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
            <FormRow columns={1}>
              <ChipPickerField
                name="employeeIds"
                label="Only these employees (office order or staff notice; leave empty for all staff)"
                options={employees.map((e) => ({
                  value: e.id,
                  label: `${e.employeeCode} · ${e.displayName}`,
                }))}
              />
            </FormRow>
            <FormRow columns={3}>
              <InputField
                id="publishAt"
                name="publishAt"
                label="Show in the portal from (date and time)"
                type="datetime-local"
                defaultValue={new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16)}
              />
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="ackRequired" value="1" /> Ask for an acknowledgement
              </label>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="alsoEmail" value="1" /> Also send by e-mail when
                published
              </label>
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
