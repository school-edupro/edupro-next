import {
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
import { createAlbum, deleteAlbum } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Album, Audience } from '@/lib/types';

const AUDIENCES: Audience[] = ['everyone', 'students', 'employees'];

/** S7-06: gallery albums; images are uploaded through the file service by the server action. */
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, d, c, me] = await Promise.all([
    getTranslations('pages.academics_gallery'),
    getTranslations('daily'),
    getTranslations('common'),
    getMe(),
  ]);
  const canManage = me.permissions.includes('academics.gallery.manage');
  const albums = await apiFetch<{ data: Album[] }>('/academics/gallery/albums').then((r) => r.data);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        }}
      >
        {albums.length === 0 ? <Card>{d('noAlbums')}</Card> : null}
        {albums.map((a) => (
          <Card key={a.id} elevated title={<a href={`/academics/gallery/${a.id}`}>{a.title}</a>}>
            <div className="ep-kicker">
              {a.eventOn ?? ''} · {d('photoCount', { count: a.itemCount })} ·{' '}
              {d(`audiences.${a.audience}`)}
            </div>
            {a.description ? <p style={{ marginTop: 'var(--sp-2)' }}>{a.description}</p> : null}
            {canManage ? (
              <form action={deleteAlbum} style={{ marginTop: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={a.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {d('delete')}
                </Button>
              </form>
            ) : null}
          </Card>
        ))}
      </div>
      {canManage ? (
        <Card title={d('newAlbum')} style={{ marginTop: 'var(--sp-5)' }}>
          <form action={createAlbum}>
            <FormRow columns={3}>
              <InputField id="title" name="title" label={d('title')} required maxLength={160} />
              <InputField id="eventOn" name="eventOn" label={d('eventOn')} type="date" />
              <SelectField
                id="audience"
                name="audience"
                label={d('audience')}
                options={AUDIENCES.map((a) => ({ value: a, label: d(`audiences.${a}`) }))}
              />
            </FormRow>
            <FormRow columns={2}>
              <InputField
                id="description"
                name="description"
                label={d('description')}
                maxLength={2000}
              />
              <InputField
                id="files"
                name="files"
                label={d('images')}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
              />
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
