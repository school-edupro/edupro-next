import { Badge, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { VehiclePosition } from '@/lib/types';

/** Sprint 17: last GPS fix of every bus. */
export default async function GpsPage() {
  const [t, g, fleet] = await Promise.all([
    getTranslations('pages.transport_gps'),
    getTranslations('gps'),
    apiFetch<{ data: VehiclePosition[] }>('/transport/gps/fleet').then((x) => x.data),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Card>
        <DataTable<VehiclePosition>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'v', header: g('vehicle'), render: (p) => <strong>{p.regNo}</strong> },
            {
              key: 'f',
              header: g('lastFix'),
              render: (p) =>
                new Date(p.recordedAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
            },
            {
              key: 'a',
              header: g('age'),
              render: (p) => (
                <Badge
                  tone={
                    p.ageSeconds < 600 ? 'success' : p.ageSeconds < 3600 ? 'warning' : 'neutral'
                  }
                >
                  {g('ago', { minutes: Math.round(p.ageSeconds / 60) })}
                </Badge>
              ),
            },
            {
              key: 's',
              header: g('speed'),
              numeric: true,
              render: (p) => (p.speedKmh ? `${p.speedKmh} km/h` : ''),
            },
            {
              key: 'm',
              header: g('map'),
              render: (p) => (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.lat}, {p.lng}
                </a>
              ),
            },
          ]}
          rows={fleet}
          rowKey={(p) => p.vehicleId}
          emptyTitle={g('noFix')}
          emptyHint={<p className="ep-field__help">{g('hint')}</p>}
        />
      </Card>
    </>
  );
}
