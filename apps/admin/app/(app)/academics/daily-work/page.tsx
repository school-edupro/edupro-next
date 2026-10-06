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
import { deleteDailyWork, postDailyWork } from '@/lib/actions';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { DailyWork, DailyWorkKind, Page, Subject, Viewer } from '@/lib/types';

const KINDS: DailyWorkKind[] = ['homework', 'classwork', 'assignment'];

/** S7-03: daily work list with a posting form; the API scopes both by section. */
export default async function DailyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
    classSectionId?: string;
    kind?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const adding = sp.new === '1';
  const [t, d, c, me] = await Promise.all([
    getTranslations('pages.academics_daily_work'),
    getTranslations('daily'),
    getTranslations('common'),
    getMe(),
  ]);
  const canPost = me.permissions.includes('academics.daily_work.post');
  const query = new URLSearchParams({ size: '100' });
  for (const k of ['classSectionId', 'kind', 'from', 'to'] as const)
    if (sp[k]) query.set(k, sp[k]!);
  const [work, viewer, sections, subjects] = await Promise.all([
    apiFetch<Page<DailyWork>>(`/academics/daily-work?${query.toString()}`),
    apiFetch<Viewer>('/academics/daily-work/viewer'),
    sectionOptions(),
    apiFetch<Page<Subject>>('/academics/subjects?size=200&status=active').then((r) => r.data),
  ]);
  const allowedSections =
    viewer.sectionIds === null
      ? sections
      : sections.filter((s) => viewer.sectionIds!.includes(s.value));
  const self = `/academics/daily-work?${query.toString()}`;

  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={adding ? d('postWork') : t('title')}
        description={t('description')}
        actions={
          adding ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/daily-work">
              Back to the list
            </a>
          ) : canPost ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/academics/daily-work?new=1">
              + Post work
            </a>
          ) : null
        }
      />
      <AcademicsNav current="/academics/daily-work" permissions={me.permissions} />
      <Notice params={sp} />
      <div hidden={adding}>
        <Card>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <SelectField
              id="classSectionId"
              name="classSectionId"
              label={d('section')}
              defaultValue={sp.classSectionId ?? ''}
              options={[{ value: '', label: c('all') }, ...allowedSections]}
            />
            <SelectField
              id="kind"
              name="kind"
              label={c('filter')}
              defaultValue={sp.kind ?? ''}
              options={[
                { value: '', label: d('allKinds') },
                ...KINDS.map((k) => ({ value: k, label: d(`kinds.${k}`) })),
              ]}
            />
            <InputField
              id="from"
              name="from"
              label={d('from')}
              type="date"
              defaultValue={sp.from ?? ''}
            />
            <InputField id="to" name="to" label={d('to')} type="date" defaultValue={sp.to ?? ''} />
            <Button type="submit" variant="secondary">
              {c('apply')}
            </Button>
          </form>
          <DataTable<DailyWork>
            caption={t('title')}
            density="dense"
            columns={[
              { key: 'date', header: d('assignedOn'), render: (w) => w.assignedOn },
              {
                key: 'kind',
                header: c('filter'),
                render: (w) => (
                  <Badge
                    tone={
                      w.kind === 'homework'
                        ? 'info'
                        : w.kind === 'assignment'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {d(`kinds.${w.kind}`)}
                  </Badge>
                ),
              },
              { key: 'section', header: d('section'), render: (w) => w.section },
              { key: 'subject', header: d('subject'), render: (w) => w.subjectName ?? '' },
              {
                key: 'title',
                header: d('title'),
                render: (w) => (
                  <span>
                    <strong>{w.title}</strong>
                    {w.body ? (
                      <>
                        <br />
                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)' }}>
                          {w.body.slice(0, 140)}
                        </span>
                      </>
                    ) : null}
                    {w.files.length > 0 ? (
                      <>
                        <br />
                        <span className="ep-kicker">
                          {w.files.map((f) => f.name ?? f.id).join(', ')}
                        </span>
                      </>
                    ) : null}
                  </span>
                ),
              },
              { key: 'due', header: d('dueOn'), render: (w) => w.dueOn ?? '' },
              { key: 'by', header: d('postedBy'), render: (w) => w.postedBy ?? '' },
              {
                key: 'actions',
                header: '',
                render: (w) =>
                  canPost ? (
                    <form action={deleteDailyWork}>
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="returnTo" value={self} />
                      <Button type="submit" variant="ghost" size="sm">
                        {d('delete')}
                      </Button>
                    </form>
                  ) : null,
              },
            ]}
            rows={work.data}
            rowKey={(w) => w.id}
            emptyTitle={d('noWork')}
          />
        </Card>
      </div>
      {canPost && allowedSections.length > 0 && adding ? (
        <Card>
          <form action={postDailyWork}>
            <input type="hidden" name="returnTo" value={self} />
            <FormRow columns={4}>
              <SelectField
                id="postSection"
                name="classSectionId"
                label={d('section')}
                required
                options={allowedSections}
                defaultValue={sp.classSectionId ?? allowedSections[0]?.value}
              />
              <SelectField
                id="postKind"
                name="kind"
                label={c('filter')}
                options={KINDS.map((k) => ({ value: k, label: d(`kinds.${k}`) }))}
              />
              <SelectField
                id="postSubject"
                name="subjectId"
                label={d('subject')}
                options={[
                  { value: '', label: c('none') },
                  ...subjects.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
                ]}
              />
              <InputField id="assignedOn" name="assignedOn" label={d('assignedOn')} type="date" />
            </FormRow>
            <FormRow columns={1}>
              <InputField id="title" name="title" label={d('title')} required maxLength={160} />
            </FormRow>
            <FormRow columns={1}>
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="body">
                  {d('details')}
                </label>
                <textarea id="body" name="body" className="ep-input" rows={4} maxLength={8000} />
              </div>
            </FormRow>
            <FormRow columns={2}>
              <InputField id="dueOn" name="dueOn" label={d('dueOn')} type="date" />
              <InputField
                id="files"
                name="files"
                label={d('attachments')}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx"
              />
            </FormRow>
            <FormActions>
              <Button type="submit">{d('post')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
