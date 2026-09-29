import { Button, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { masterExport } from '@/lib/actions';
import { apiFetch } from '@/lib/api';

interface Dashboard {
  code: string;
  name: string;
  href: string;
  kpis: Array<{ label: string; value: string | number | null; unit?: string }>;
  datasets: string[];
}

/** Sprint 19: the MIS centre — dashboards mapped to the caller's roles. */
export default async function MisPage() {
  const [t, m, dashboards] = await Promise.all([
    getTranslations('pages.reports_mis'),
    getTranslations('mis'),
    apiFetch<{ data: Dashboard[] }>('/insights/mis').then((x) => x.data),
  ]);
  const fmt = (k: Dashboard['kpis'][number]) =>
    k.value === null
      ? '—'
      : k.unit === '₹'
        ? `₹${Number(k.value).toLocaleString('en-IN')}`
        : k.unit === '%'
          ? `${k.value}%`
          : String(k.value);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      {dashboards.length === 0 ? <Card>{m('noRows')}</Card> : null}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}
      >
        {dashboards.map((d) => (
          <Card
            key={d.code}
            title={d.name}
            actions={
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={d.href}>
                {m('open')}
              </a>
            }
          >
            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-2)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              }}
            >
              {d.kpis.map((k) => (
                <div key={k.label}>
                  <div className="ep-kicker">{k.label}</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontSize: 'var(--fs-h3)',
                      fontWeight: 600,
                    }}
                  >
                    {fmt(k)}
                  </div>
                </div>
              ))}
            </div>
            {d.datasets.length ? (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-1)',
                  flexWrap: 'wrap',
                  marginTop: 'var(--sp-3)',
                }}
              >
                {d.datasets.map((ds) => (
                  <form key={ds} action={masterExport}>
                    <input type="hidden" name="master" value="__dataset__" />
                    <input type="hidden" name="dataset" value={ds} />
                    <input type="hidden" name="format" value="xlsx" />
                    <input type="hidden" name="back" value="/reports/mis" />
                    <Button type="submit" size="sm" variant="ghost">
                      {m('exports')} · {ds}
                    </Button>
                  </form>
                ))}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
