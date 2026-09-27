import {
  Breadcrumbs,
  Button,
  Card,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { addAlbumPhotos } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Album } from '@/lib/types';

export default async function AlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, d, me, album] = await Promise.all([
    getTranslations('pages.academics_gallery'),
    getTranslations('daily'),
    getMe(),
    apiFetch<Album>(`/academics/gallery/albums/${id}`),
  ]);
  const canManage = me.permissions.includes('academics.gallery.manage');
  const urls = await Promise.all(
    (album.items ?? []).map((i) =>
      apiFetch<{ url: string }>(`/platform/files/${i.fileId}/download-url`)
        .then((r) => r.url)
        .catch(() => null),
    ),
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/academics/classes' },
          { label: t('title'), href: '/academics/gallery' },
          { label: album.title },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={album.title}
        description={`${album.eventOn ?? ''} · ${d('photoCount', { count: album.itemCount })}`}
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        }}
      >
        {(album.items ?? []).map((i, idx) => (
          <Card key={i.id} elevated>
            {urls[idx] ? (
              <img
                src={urls[idx]!}
                alt={i.caption ?? i.name ?? ''}
                style={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-muted)',
                }}
              />
            ) : (
              <div
                style={{
                  aspectRatio: '4 / 3',
                  background: 'var(--surface-muted)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
            )}
            <div className="ep-kicker" style={{ marginTop: 'var(--sp-2)' }}>
              {i.caption ?? i.name ?? ''}
            </div>
          </Card>
        ))}
      </div>
      {canManage ? (
        <Card title={d('addPhotos')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={addAlbumPhotos}>
            <input type="hidden" name="id" value={album.id} />
            <FormRow columns={2}>
              <InputField
                id="files"
                name="files"
                label={d('images')}
                type="file"
                multiple
                required
                accept="image/png,image/jpeg,image/webp"
              />
            </FormRow>
            <FormActions>
              <Button type="submit">{d('addPhotos')}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}
    </>
  );
}
