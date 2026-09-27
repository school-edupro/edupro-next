import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { applyPromotions, savePromotions } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Page, PromotionRow, Year } from '@/lib/types';

const DECISIONS = ['promote', 'retain', 'transfer_out', 'graduate'] as const;

/** S7-02: promotion decisions per class, applied into the target year. */
export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    classId?: string;
    toYearId?: string;
  }>;
}) {
  const sp = await searchParams;
  const [t, l, c, me] = await Promise.all([
    getTranslations('pages.people_promotions'),
    getTranslations('lifecycle'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('people.promotion.manage');
  const [classes, years] = await Promise.all([
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data),
    apiFetch<{ data: Year[] }>('/platform/years')
      .then((r) => r.data.filter((y) => y.kind === 'academic'))
      .catch(() => [] as Year[]),
  ]);
  const targets = years.filter(
    (y) => y.id !== me.academicYear?.id && (y.status === 'planned' || y.status === 'active'),
  );
  const toYearId = sp.toYearId ?? targets[0]?.id;
  const classId = sp.classId;
  const [rows, sections] = await Promise.all([
    classId && toYearId
      ? apiFetch<{ data: PromotionRow[] }>(
          `/people/promotions?classId=${classId}&toYearId=${toYearId}`,
        ).then((r) => r.data)
      : Promise.resolve<PromotionRow[]>([]),
    toYearId
      ? apiFetch<{ data: Array<{ id: string; label: string; classId: string; order: number }> }>(
          `/people/promotions/sections?yearId=${toYearId}`,
        ).then((r) => r.data)
      : Promise.resolve([]),
  ]);
  const currentClass = classes.find((k) => k.id === classId);
  const pending = rows.filter((r) => r.decision && !r.appliedAt).length;

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="classId"
            name="classId"
            label={l('class')}
            defaultValue={classId ?? ''}
            options={[
              { value: '', label: c('none') },
              ...classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
            ]}
          />
          <SelectField
            id="toYearId"
            name="toYearId"
            label={l('toYear')}
            defaultValue={toYearId ?? ''}
            options={targets.map((y) => ({ value: y.id, label: `${y.code} (${y.status})` }))}
          />
          <Button type="submit" variant="secondary">
            {l('show')}
          </Button>
        </form>
        {!currentClass || !toYearId ? (
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
            {l('chooseClass')}
          </p>
        ) : (
          <form action={savePromotions} style={{ marginTop: 'var(--sp-4)' }}>
            <input type="hidden" name="classId" value={currentClass.id} />
            <input type="hidden" name="toYearId" value={toYearId} />
            <DataTable<PromotionRow>
              caption={`${currentClass.name}: ${t('title')}`}
              density="dense"
              columns={[
                { key: 'roll', header: l('rollNo'), numeric: true, render: (r) => r.rollNo ?? '' },
                {
                  key: 'name',
                  header: l('student'),
                  render: (r) => (
                    <a href={`/people/students/${r.studentId}`}>
                      {r.studentName} · {r.admissionNo}
                    </a>
                  ),
                },
                { key: 'from', header: c('name'), render: (r) => r.fromSection },
                {
                  key: 'decision',
                  header: l('decision'),
                  render: (r) =>
                    r.appliedAt || !canManage ? (
                      r.decision ? (
                        l(`decisions.${r.decision}`)
                      ) : (
                        l('noDecision')
                      )
                    ) : (
                      <>
                        <input type="hidden" name="studentIds" value={r.studentId} />
                        <select
                          name={`decision:${r.studentId}`}
                          className="ep-select"
                          defaultValue={r.decision ?? ''}
                          aria-label={l('decision')}
                        >
                          <option value="">{l('noDecision')}</option>
                          {DECISIONS.map((d) => (
                            <option key={d} value={d}>
                              {l(`decisions.${d}`)}
                            </option>
                          ))}
                        </select>
                      </>
                    ),
                },
                {
                  key: 'to',
                  header: l('toSection'),
                  render: (r) =>
                    r.appliedAt || !canManage ? (
                      (r.toSection ?? '')
                    ) : (
                      <select
                        name={`section:${r.studentId}`}
                        className="ep-select"
                        defaultValue={r.toClassSectionId ?? ''}
                        aria-label={l('toSection')}
                      >
                        <option value="">{l('noDecision')}</option>
                        {sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    ),
                },
                {
                  key: 'applied',
                  header: l('applied'),
                  render: (r) =>
                    r.appliedAt ? (
                      <Badge tone="success">
                        {new Date(r.appliedAt).toLocaleDateString('en-IN')}
                      </Badge>
                    ) : r.decision ? (
                      <Badge tone="warning">{l('pendingDecision')}</Badge>
                    ) : null,
                },
              ]}
              rows={rows}
              rowKey={(r) => r.studentId}
              emptyTitle={l('noStudents')}
            />
            {canManage && rows.length > 0 ? (
              <FormActions>
                <Button type="submit">{l('save')}</Button>
              </FormActions>
            ) : null}
          </form>
        )}
      </Card>
      {canManage && currentClass && toYearId && pending > 0 ? (
        <Card title={l('apply')} style={{ marginTop: 'var(--sp-5)' }}>
          <div style={{ marginBottom: 'var(--sp-3)' }}>
            <Alert tone="info">{l('applyHelp')}</Alert>
          </div>
          <form action={applyPromotions}>
            <input type="hidden" name="classId" value={currentClass.id} />
            <input type="hidden" name="toYearId" value={toYearId} />
            <Button type="submit" variant="secondary">
              {l('apply')} ({pending})
            </Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
