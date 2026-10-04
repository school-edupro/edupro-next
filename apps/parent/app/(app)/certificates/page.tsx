import { FileLinks } from '@/components/FileLinks';
import { Button, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild, familyKids } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { queueMyCertificatePdf } from '../appointments/actions';

interface Certificate {
  id: string;
  student: string;
  serialNo: string;
  title: string;
  text: string | null;
  issuedOn: string;
  template: string;
}

/** Sprint 19: certificates issued to the family's children, each downloadable as its own PDF. */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let rows: Certificate[];
  try {
    rows = (await bff.api.fetch<{ data: Certificate[] }>('/engagement/mine/certificates')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Certificates')} />
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
  // rows carry the child's name: one child at a time, as chosen in the switch under the title
  const kid = await chosenChild();
  const names = new Set((await familyKids()).map((k) => k.name));
  if (kid && rows.some((r) => names.has(r.student)))
    rows = rows.filter((r) => r.student === kid.name);
  const exportStatus = sp.export
    ? await bff.api
        .fetch<{
          export: { id: string; status: string };
          download: { url: string; saveUrl?: string } | null;
        }>(`/fees/mine/exports/${sp.export}`)
        .catch(() => null)
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Certificates')}
        description={t(lang, 'Certificates the school has issued to your children.')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <ChildSwitch lang={lang} back="/certificates" />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {exportStatus ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {exportStatus.download ? (
            <span className="ep-filecell">
              {t(lang, 'Certificate PDF')}
              <FileLinks
                url={exportStatus.download.url}
                saveUrl={exportStatus.download.saveUrl}
                label={t(lang, 'Certificate PDF')}
                viewLabel={t(lang, 'View')}
                saveLabel={t(lang, 'Download')}
              />
            </span>
          ) : (
            <>
              {t(lang, 'Your PDF is being prepared.')}{' '}
              <a href={`/certificates?export=${exportStatus.export.id}`}>{t(lang, 'Refresh')}</a>
            </>
          )}
        </div>
      ) : null}
      <Card>
        {rows.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No certificates yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((c) => (
              <li
                key={c.id}
                style={{
                  padding: 'var(--sp-2) 0',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong>{c.title}</strong> · {c.student}
                  <div className="ep-kicker">
                    {c.serialNo} · {c.issuedOn}
                    {c.text ? ` · ${c.text}` : ''}
                  </div>
                </div>
                <form action={queueMyCertificatePdf}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    PDF
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
