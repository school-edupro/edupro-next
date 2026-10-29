import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { SIGNATURE_ROLES, SignatureForm } from '@/components/exams/SignatureForm';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, Page } from '@/lib/types';

interface Signature {
  id: string;
  role: string;
  label: string;
  personName: string | null;
  hasImage: boolean;
  classIds: string[];
  status: string;
}

/**
 * Signatures on the report cards (docs/design/65, part 4): the principal, vice principal, headmistress,
 * coordinators, class teacher and exam in-charge with their image, and the school seal; for every class
 * or some (a class's own one is printed before a general one). The class teacher's name comes from the
 * section when none is set.
 */
export default async function SignaturesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.report_card.view')) notFound();
  const canManage = me.permissions.includes('exams.report_card.manage');
  const [list, classes] = await Promise.all([
    apiFetch<{ data: Signature[] }>('/exams/report-cards/signatures').then((r) => r.data),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) =>
      r.data.map((k) => ({ id: k.id, code: k.code })),
    ),
  ]);
  const code = (ids: string[]) =>
    ids.length
      ? ids.map((x) => classes.find((k) => k.id === x)?.code ?? x).join(', ')
      : 'Every class';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Report cards', href: '/exams/report-cards' },
          { label: 'Signatures' },
        ]}
      />
      <PageHeader
        kicker="Report cards"
        title="Signatures and seal"
        description="The signatures the cards print by role, each with its image and name, and the school seal. A card template lists the roles it signs with."
      />
      <Notice params={sp} />
      <div className="ep-rp">
        <Card elevated title="Set up">
          {list.length ? (
            list.map((x) => (
              <section key={x.id} className="ep-rp__act" style={{ marginBottom: 'var(--sp-4)' }}>
                <p style={{ margin: 0 }}>
                  <strong>{SIGNATURE_ROLES[x.role] ?? x.role}</strong> · {x.label}
                  {x.personName ? ` · ${x.personName}` : ''} · {code(x.classIds)}{' '}
                  {x.status !== 'active' ? <Badge tone="neutral">not in use</Badge> : null}{' '}
                  {x.hasImage ? (
                    <ViewDownload
                      href={`/api/report-card-signatures/${x.id}/image`}
                      what={`the image of ${x.label}`}
                    />
                  ) : (
                    <span className="ep-field__help">no image</span>
                  )}
                </p>
                {canManage ? (
                  <details>
                    <summary>Change</summary>
                    <SignatureForm
                      id={x.id}
                      initial={{
                        role: x.role,
                        label: x.label,
                        personName: x.personName,
                        classIds: x.classIds,
                        status: x.status,
                      }}
                      classes={classes}
                    />
                  </details>
                ) : null}
              </section>
            ))
          ) : (
            <p style={{ margin: 0 }}>
              None yet: the cards print the roles&rsquo; names with a line to sign on.
            </p>
          )}
        </Card>
        {canManage ? (
          <Card elevated title="Add a signature or the seal">
            <SignatureForm classes={classes} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
