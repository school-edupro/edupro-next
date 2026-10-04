import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { OUTCOME, dateParts, medName, timeOf, type HealthCard, type Visit } from './shared';

type Item = { kind: 'visit'; visit: Visit } | { kind: 'card'; card: HealthCard };
interface List {
  data: Item[];
  page: { number: number; size: number; total: number };
  students: Array<{ id: string; name: string }>;
}
const PAGE_SIZE = 10;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Health (0075): the children's clinic visits and health check-up cards in one list, latest first, with
 * filters (child, type, dates, search) and pages, like the Queries page. Each entry opens in full.
 */
export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{
    child?: string;
    kind?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const filters = Object.fromEntries(
    Object.entries({
      studentId: /^\d{1,18}$/.test(sp.child ?? '') ? sp.child : undefined,
      kind: ['visit', 'card'].includes(sp.kind ?? '') ? sp.kind : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const filtered = Object.keys(filters).length > 0;
  const page = Math.max(1, Number(sp.page) || 1);
  const href = (n: number) =>
    `/health?${new URLSearchParams({
      ...(filters.studentId ? { child: filters.studentId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      page: String(n),
    }).toString()}`;
  let list: List;
  try {
    list = await bff.api.fetch<List>(
      `/clinic/mine/list?${new URLSearchParams({ ...filters, size: String(PAGE_SIZE), page: String(page) }).toString()}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Health')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const total = list.page.total;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Health')}
        title={t(lang, 'Clinic visits and health cards')}
        description={`${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
        >
          <SelectField
            id="h-kind"
            name="kind"
            label={t(lang, 'Type')}
            defaultValue={filters.kind ?? ''}
            options={[
              { value: '', label: t(lang, 'All') },
              { value: 'visit', label: t(lang, 'Clinic visits') },
              { value: 'card', label: t(lang, 'Health check-up cards') },
            ]}
          />
          {list.students.length > 1 ? (
            <SelectField
              id="h-child"
              name="child"
              label={t(lang, 'Child')}
              defaultValue={filters.studentId ?? ''}
              options={[
                { value: '', label: t(lang, 'All') },
                ...list.students.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          ) : null}
          <label className="ep-field" htmlFor="h-from">
            <span className="ep-field__label">{t(lang, 'From')}</span>
            <input
              id="h-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="h-to">
            <span className="ep-field__label">{t(lang, 'To')}</span>
            <input
              id="h-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <InputField
            id="h-q"
            name="q"
            type="search"
            label={t(lang, 'Complaint, treatment or remark')}
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit" variant="secondary">
            {t(lang, 'Show')}
          </Button>
          {filtered ? (
            <a className="ep-btn ep-btn--ghost" href="/health">
              {t(lang, 'Clear')}
            </a>
          ) : null}
        </form>
      </Card>
      {list.data.length === 0 ? (
        <Card>
          {filtered
            ? t(lang, 'Nothing matches these filters.')
            : t(
                lang,
                'Nothing yet. Clinic visits show here, and the health card once the school doctor publishes it.',
              )}
        </Card>
      ) : null}
      {list.data.map((it) => {
        if (it.kind === 'visit') {
          const v = it.visit;
          const d = dateParts(v.inAt);
          return (
            <Card key={`v${v.id}`} elevated style={{ marginBottom: 'var(--sp-3)' }}>
              <div className="ep-apt">
                <div className="ep-apt__date">
                  <span className="ep-apt__day">{d.day}</span>
                  <span className="ep-apt__month">{d.month}</span>
                  <span className="ep-apt__time">{timeOf(v.inAt)}</span>
                </div>
                <div className="ep-apt__body">
                  <div className="ep-apt__top">
                    <a className="ep-apt__title" href={`/health/visits/${v.id}`}>
                      {v.complaint}
                    </a>
                    <Badge tone={OUTCOME[v.outcome][1]}>{t(lang, OUTCOME[v.outcome][0])}</Badge>
                  </div>
                  <div>
                    {[
                      v.treatment,
                      v.medicines.length
                        ? `${t(lang, 'Medicine given')}: ${v.medicines.map((m) => medName(m)).join(', ')}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t(lang, 'Clinic visit')}
                  </div>
                  <div className="ep-kicker">
                    {[t(lang, 'Clinic visit'), v.number, v.student, v.doctor]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className="ep-apt__actions">
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/health/visits/${v.id}`}
                      aria-label={`${t(lang, 'Details')} ${v.number}`}
                    >
                      {t(lang, 'Details')}
                    </a>
                  </div>
                </div>
              </div>
            </Card>
          );
        }
        const c = it.card;
        const d = dateParts(c.examDate);
        return (
          <Card key={`c${c.id}`} elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-apt">
              <div className="ep-apt__date">
                <span className="ep-apt__day">{d.day}</span>
                <span className="ep-apt__month">{d.month}</span>
              </div>
              <div className="ep-apt__body">
                <div className="ep-apt__top">
                  <a className="ep-apt__title" href={`/health/cards/${c.id}`}>
                    {c.camp}
                  </a>
                  <Badge tone={c.needsAttention ? 'warning' : 'success'}>
                    {t(lang, c.needsAttention ? 'Please see a doctor' : 'Health card')}
                  </Badge>
                </div>
                <div>
                  {[
                    c.heightCm ? `${t(lang, 'Height')} ${String(c.heightCm)} cm` : null,
                    c.weightKg ? `${t(lang, 'Weight')} ${String(c.weightKg)} kg` : null,
                    c.bmi ? `BMI ${String(c.bmi)}` : null,
                    c.bloodGroup ? `${t(lang, 'Blood group')} ${c.bloodGroup}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="ep-kicker">
                  {[t(lang, 'Health check-up'), c.student, c.doctor].filter(Boolean).join(' · ')}
                </div>
                <div className="ep-apt__actions">
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/health/cards/${c.id}`}
                    aria-label={`${t(lang, 'Details')}: ${c.camp}, ${c.student}`}
                  >
                    {t(lang, 'Details')}
                  </a>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/api/health-card/${c.id}`}
                    aria-label={`${t(lang, 'Download the health card (PDF)')}: ${c.camp}, ${c.student}`}
                  >
                    {t(lang, 'Download the health card (PDF)')}
                  </a>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
      {total > PAGE_SIZE ? (
        <nav
          aria-label={t(lang, 'Pages')}
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={href(page - 1)}>
              ← {t(lang, 'Previous')}
            </a>
          ) : null}
          <span className="ep-field__help">
            {t(lang, 'Page')} {page} / {Math.ceil(total / PAGE_SIZE)}
          </span>
          {page * PAGE_SIZE < total ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={href(page + 1)}>
              {t(lang, 'Next')} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
