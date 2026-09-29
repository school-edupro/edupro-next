import {
  Badge,
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
import { previewRequest, submitRequest } from '@/lib/actions';
import { ApiError, apiFetch } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type {
  ClassRow,
  CommsGroup,
  Membership,
  MessageAudience,
  Page,
  RequestPreview,
  Template,
  TransportRoute,
} from '@/lib/types';

type Search = {
  ok?: string;
  error?: string;
  detail?: string;
  preview?: string;
  title?: string;
  category?: string;
  templateId?: string;
  body?: string;
  audience?: string;
  targetId?: string | string[];
  scheduledAt?: string;
};

const AUDIENCES: MessageAudience[] = [
  'class_section',
  'class',
  'route',
  'group',
  'individuals',
  'students',
  'employees',
  'everyone',
];

/** S10: compose → preview recipients → send for approval (server-rendered, no client state). */
export default async function ComposePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const [t, m] = await Promise.all([
    getTranslations('pages.comms_compose'),
    getTranslations('comms'),
  ]);
  const audience = (
    AUDIENCES.includes(sp.audience as MessageAudience) ? sp.audience : 'class_section'
  ) as MessageAudience;
  const chosen = new Set(([] as string[]).concat(sp.targetId ?? []));
  const [templates, classes, sections, routes, groups, members] = await Promise.all([
    apiFetch<{ data: Template[] }>('/comms/templates?status=active').then((r) =>
      r.data.filter((x) => x.channel !== 'push'),
    ),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    sectionOptions(),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes')
      .then((r) => r.data)
      .catch(() => [] as TransportRoute[]),
    apiFetch<{ data: CommsGroup[] }>('/comms/groups')
      .then((r) => r.data)
      .catch(() => [] as CommsGroup[]),
    audience === 'individuals'
      ? apiFetch<Page<Membership>>('/access/memberships?size=200')
          .then((r) => r.data)
          .catch(() => [] as Membership[])
      : Promise.resolve([] as Membership[]),
  ]);
  const targetOptions: Array<{ value: string; label: string }> =
    audience === 'class'
      ? classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` }))
      : audience === 'class_section'
        ? sections
        : audience === 'route'
          ? routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))
          : audience === 'group'
            ? groups.map((g) => ({ value: g.id, label: `${g.name} (${g.members})` }))
            : audience === 'individuals'
              ? members.map((u) => ({
                  value: u.userId,
                  label: `${u.displayName} · ${u.mobile ?? u.email ?? ''}`,
                }))
              : [];
  const needsTargets =
    targetOptions.length > 0 ||
    ['class', 'class_section', 'route', 'group', 'individuals'].includes(audience);
  let preview: RequestPreview | null = null;
  let previewError: string | null = null;
  if (sp.preview && sp.templateId && sp.title) {
    try {
      preview = await apiFetch<RequestPreview>('/comms/requests/preview', {
        method: 'POST',
        body: JSON.stringify({
          title: sp.title,
          category: sp.category ?? 'general',
          templateId: sp.templateId,
          body: sp.body ?? '',
          audience,
          targets: [...chosen].map((id) => ({
            type: audience === 'individuals' ? 'user' : audience,
            id,
          })),
        }),
      });
    } catch (error) {
      if (error instanceof ApiError) previewError = error.problem.detail ?? error.problem.type;
      else throw error;
    }
  }
  const template = templates.find((x) => x.id === sp.templateId);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={m('body')}>
          <form action={previewRequest} id="compose">
            <FormRow columns={2}>
              <InputField
                id="title"
                name="title"
                label={m('title')}
                defaultValue={sp.title ?? ''}
                required
                maxLength={160}
              />
              <SelectField
                id="category"
                name="category"
                label={m('category')}
                defaultValue={sp.category ?? 'general'}
                options={(['general', 'service'] as const).map((c) => ({
                  value: c,
                  label: m(`categories.${c}`),
                }))}
              />
            </FormRow>
            <FormRow columns={2}>
              <SelectField
                id="templateId"
                name="templateId"
                label={m('template')}
                defaultValue={sp.templateId ?? templates[0]?.id ?? ''}
                options={templates.map((x) => ({ value: x.id, label: `${x.name} · ${x.channel}` }))}
              />
              <InputField
                id="scheduledAt"
                name="scheduledAt"
                label={m('scheduledAt')}
                type="datetime-local"
                defaultValue={sp.scheduledAt ?? ''}
              />
            </FormRow>
            <FormRow columns={1}>
              <label className="ep-field" htmlFor="body">
                <span className="ep-field__label">{m('body')}</span>
                <textarea
                  id="body"
                  name="body"
                  className="ep-input"
                  rows={5}
                  required
                  maxLength={4000}
                  defaultValue={sp.body ?? ''}
                />
                <span className="ep-field__help">{m('bodyHelp')}</span>
              </label>
            </FormRow>
            <FormRow columns={2}>
              <SelectField
                id="audience"
                name="audience"
                label={m('audience')}
                defaultValue={audience}
                options={AUDIENCES.map((a) => ({ value: a, label: m(`audiences.${a}`) }))}
              />
              {needsTargets ? (
                <label className="ep-field" htmlFor="targetId">
                  <span className="ep-field__label">{m('targets')}</span>
                  <select
                    id="targetId"
                    name="targetId"
                    className="ep-input"
                    multiple
                    size={Math.min(8, Math.max(3, targetOptions.length))}
                    defaultValue={[...chosen]}
                  >
                    {targetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="ep-field__help">{m(`audiences.${audience}`)}</span>
                </label>
              ) : null}
            </FormRow>
            <FormActions>
              <Button type="submit" variant="secondary">
                {m('preview')}
              </Button>
              {preview && preview.total > 0 ? (
                <Button type="submit" formAction={submitRequest}>
                  {m('submit')}
                </Button>
              ) : null}
            </FormActions>
          </form>
        </Card>
        <Card title={m('recipients')}>
          {previewError ? <p className="ep-alert ep-alert--danger">{previewError}</p> : null}
          {preview ? (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  marginBottom: 'var(--sp-3)',
                }}
              >
                <Badge tone="success">
                  {m('recipients')}: {preview.total}
                </Badge>
                <Badge tone={preview.skipped ? 'warning' : 'neutral'}>
                  {m('skipped')}: {preview.skipped}
                </Badge>
                {Object.entries(preview.skippedReasons).map(([k, v]) => (
                  <Badge key={k} tone="neutral">
                    {v} · {m(`skippedReasons.${k}`)}
                  </Badge>
                ))}
              </div>
              <p className="ep-field__help">{m('sample')}:</p>
              <ul>
                {preview.sample.map((s, i) => (
                  <li key={i}>
                    {s.name} · {s.address}
                    {s.student ? ` · ${s.student}` : ''}
                  </li>
                ))}
              </ul>
              {template ? (
                <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
                  {m('template')}: <code>{template.code}</code> · {template.channel}
                  <br />
                  {template.body}
                </p>
              ) : null}
              <p className="ep-field__help">{m('openInbox')}</p>
            </>
          ) : (
            <p className="ep-field__help">{m('preview')} →</p>
          )}
        </Card>
      </div>
    </>
  );
}
