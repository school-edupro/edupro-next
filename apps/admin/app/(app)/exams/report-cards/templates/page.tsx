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
import { rcInstallDefaults, rcSaveTemplate } from '@/lib/actions';
import {
  installLearningRecord,
  installReadyMadeCards,
  removeCardArt,
  saveCardArt,
} from '@/lib/exam-entry-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ReportCardTemplate } from '@/lib/types';

const BANDS = ['pre_primary', 'primary', 'middle', 'secondary', 'senior'];
/** docs/design/73: the pictures a learning-record design prints, where */
const ART: Array<{ slot: string; label: string; where: string }> = [
  { slot: 'cover_art', label: 'Cover picture', where: 'The lower half of the cover' },
  { slot: 'cover_corner', label: 'Cover corner', where: 'Beside the title, left of the photo' },
  { slot: 'logo_2', label: 'Second emblem', where: 'Top right of the cover and on the key page' },
  { slot: 'scholastic', label: 'Scholastic pages', where: 'Bottom right, beside the note' },
  { slot: 'co_scholastic', label: 'Co-scholastic page', where: 'Down the right of the table' },
  { slot: 'record', label: 'Health record page', where: 'Beside height, weight and attendance' },
];
// docs/design/74: the classic card (one A4 page of ruled boxes) prints the second emblem only
const CLASSIC_ART: typeof ART = [
  {
    slot: 'logo_2',
    label: 'Second emblem',
    where: 'Top right of the header, beside the school name',
  },
];
/** the pictures a design prints: the learning record's, the classic card's, or none */
const artOf = (layout: unknown): typeof ART => {
  const types = ((layout as { sections?: Array<{ type?: string }> }).sections ?? []).map((x) =>
    String(x.type ?? ''),
  );
  return types.some((t) => t.startsWith('lr_'))
    ? ART
    : types.some((t) => t.startsWith('cl_'))
      ? CLASSIC_ART
      : [];
};

/** Sprint 17: the report-card designer (layout JSON, CSS, optional HTML body) with preview. */
export default async function ReportCardTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    new?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, r, me, templates] = await Promise.all([
    getTranslations('pages.exams_report_card_templates'),
    getTranslations('reportCards'),
    getMe(),
    apiFetch<{ data: ReportCardTemplate[] }>('/exams/report-cards/templates').then((x) => x.data),
  ]);
  const canManage = me.permissions.includes('exams.report_card.manage');
  const editing = sp.edit ? (templates.find((x) => x.id === sp.edit) ?? null) : null;
  const showForm = canManage && (sp.new || editing);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href="/exams/report-cards/templates?new=1"
              >
                ＋ {r('newRelease').replace(/release/i, 'template')}
              </a>
              <form action={rcInstallDefaults}>
                <Button type="submit" variant="secondary" size="sm">
                  {r('installDefaults')}
                </Button>
              </form>
              <form action={installReadyMadeCards}>
                <Button type="submit" variant="secondary" size="sm">
                  Install the ready-made cards
                </Button>
              </form>
              <form action={installLearningRecord}>
                <Button type="submit" variant="secondary" size="sm">
                  Install the learning record (Balvatika–II)
                </Button>
              </form>
            </span>
          ) : null
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: showForm ? '1fr 1fr' : '1fr',
        }}
      >
        <Card title={r('templatesList')}>
          <DataTable<ReportCardTemplate>
            caption={r('templatesList')}
            density="dense"
            columns={[
              {
                key: 'n',
                header: r('name'),
                render: (x) => (
                  <>
                    <strong>{x.name}</strong>
                    <div className="ep-kicker">
                      {x.code} · v{x.version}
                    </div>
                  </>
                ),
              },
              { key: 'b', header: r('band'), render: (x) => x.band },
              {
                key: 's',
                header: r('status'),
                render: (x) => (
                  <Badge tone={x.status === 'active' ? 'success' : 'neutral'}>{x.status}</Badge>
                ),
              },
              {
                key: 'a',
                header: '',
                render: (x) => (
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/api/report-cards/preview?templateId=${x.id}&band=${x.band}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r('previewSample')}
                    </a>
                    {canManage ? (
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/exams/report-cards/templates?edit=${x.id}`}
                      >
                        {r('designer')}
                      </a>
                    ) : null}
                  </span>
                ),
              },
            ]}
            rows={templates}
            rowKey={(x) => x.id}
            emptyTitle={r('noTemplates')}
          />
        </Card>
        {showForm ? (
          <Card title={editing ? `${r('designer')} · ${editing.name}` : r('designer')}>
            <form action={rcSaveTemplate}>
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <FormRow columns={2}>
                <InputField
                  id="code"
                  name="code"
                  label="Code"
                  required={!editing}
                  defaultValue={editing?.code ?? ''}
                  readOnly={Boolean(editing)}
                  pattern="[a-z0-9_]{2,40}"
                />
                <InputField
                  id="name"
                  name="name"
                  label={r('name')}
                  required
                  defaultValue={editing?.name ?? ''}
                  maxLength={120}
                />
                <SelectField
                  id="band"
                  name="band"
                  label={r('band')}
                  defaultValue={editing?.band ?? 'primary'}
                  options={BANDS.map((b) => ({ value: b, label: b }))}
                />
                {editing ? (
                  <SelectField
                    id="status"
                    name="status"
                    label={r('status')}
                    defaultValue={editing.status}
                    options={[
                      { value: 'active', label: 'active' },
                      { value: 'inactive', label: 'inactive' },
                    ]}
                  />
                ) : (
                  <div />
                )}
                <InputField
                  id="pageWidth"
                  name="pageWidth"
                  label={r('pageWidth')}
                  defaultValue={editing?.pageWidth ?? '210mm'}
                />
                <InputField
                  id="pageHeight"
                  name="pageHeight"
                  label={r('pageHeight')}
                  defaultValue={editing?.pageHeight ?? '297mm'}
                />
              </FormRow>
              <label className="ep-field">
                <span className="ep-field__label">{r('layout')}</span>
                <textarea
                  className="ep-input"
                  name="layout"
                  rows={12}
                  defaultValue={editing ? JSON.stringify(editing.layout, null, 2) : ''}
                  spellCheck={false}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{r('stylesCss')}</span>
                <textarea
                  className="ep-input"
                  name="stylesCss"
                  rows={6}
                  defaultValue={editing?.stylesCss ?? ''}
                  spellCheck={false}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">{r('bodyHtml')}</span>
                <textarea
                  className="ep-input"
                  name="bodyHtml"
                  rows={6}
                  defaultValue={editing?.bodyHtml ?? ''}
                  spellCheck={false}
                  placeholder="<h1>{{student.name}}</h1> …"
                />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                <a className="ep-btn ep-btn--ghost" href="/exams/report-cards/templates">
                  Cancel
                </a>
                <Button type="submit">{r('save')}</Button>
              </div>
            </form>
            {editing && artOf(editing.layout).length ? (
              <section
                aria-labelledby="art-h"
                style={{
                  marginTop: 'var(--sp-4)',
                  borderTop: '1px solid var(--border-default)',
                  paddingTop: 'var(--sp-3)',
                }}
              >
                <h3 id="art-h" className="ep-field__label" style={{ marginTop: 0 }}>
                  Pictures (the school&apos;s own; PNG or JPEG up to 1 MB)
                </h3>
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  They print in their places on every card of this design; an empty one prints
                  nothing.
                </p>
                <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                  {artOf(editing.layout).map((a) => {
                    const has = Boolean(editing.assets?.[a.slot]);
                    return (
                      <div
                        key={a.slot}
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-3)',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ width: '4rem', flex: 'none' }}>
                          {has ? (
                            <img
                              src={`/api/report-cards/templates/${editing.id}/art/${a.slot}?v=${editing.updatedAt}`}
                              alt={a.label}
                              style={{ maxWidth: '100%', maxHeight: '4rem', objectFit: 'contain' }}
                            />
                          ) : (
                            <span className="ep-field__help">None</span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: '12rem' }}>
                          <strong>{a.label}</strong>
                          <div className="ep-field__help" style={{ margin: 0 }}>
                            {a.where}
                          </div>
                        </div>
                        <form
                          action={saveCardArt}
                          style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                        >
                          <input type="hidden" name="templateId" value={editing.id} />
                          <input type="hidden" name="slot" value={a.slot} />
                          <input
                            type="file"
                            name="file"
                            accept="image/png,image/jpeg"
                            aria-label={`${a.label}: choose a picture`}
                            className="ep-input"
                            style={{ maxWidth: '14rem' }}
                          />
                          <Button type="submit" size="sm" variant="secondary">
                            {has ? 'Replace' : 'Upload'}
                          </Button>
                        </form>
                        {has ? (
                          <form action={removeCardArt}>
                            <input type="hidden" name="templateId" value={editing.id} />
                            <input type="hidden" name="slot" value={a.slot} />
                            <Button type="submit" size="sm" variant="ghost">
                              Remove
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {editing ? (
              <iframe
                title={r('preview')}
                src={`/api/report-cards/preview?templateId=${editing.id}&band=${editing.band}`}
                style={{
                  width: '100%',
                  height: 640,
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 'var(--sp-3)',
                  background: 'white',
                }}
              />
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
