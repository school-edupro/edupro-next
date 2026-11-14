import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { CertificateSetupOverview } from '@/lib/certificates';

type Link = {
  title: string;
  text: string;
  href: string;
  badge?: { tone: 'success' | 'warning' | 'neutral' | 'info'; text: string };
};

/**
 * Certificate set-up (docs/design/87, phase B): the figures, what to look at, then the set-up in numbered sections —
 * who signs, the types and their checks, the templates.
 */
export default async function CertificateSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.setup.manage')) notFound();
  let o: CertificateSetupOverview;
  try {
    o = await apiFetch<CertificateSetupOverview>('/certificates/setup');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const f = o.figures;
  const s = o.settings;
  const sections: Array<{ id: string; title: string; text: string; links: Link[] }> = [
    {
      id: 'cs-sign',
      title: '1. Who signs and what prints',
      text: 'The principal (or whoever signs certificates) with the signature image on the employee record, who issued it, and a line at the foot.',
      links: [
        {
          title: 'Signatory and print',
          text: s.signatory
            ? `${s.signatory.name} (${s.signatoryTitle})${s.printSignature ? ', signature image printed' : ', signed by hand'}`
            : 'Not set: the principal box prints empty',
          href: '/certificates/setup/settings',
          badge: s.signatory
            ? { tone: 'success', text: 'Done' }
            : { tone: 'warning', text: 'To do' },
        },
      ],
    },
    {
      id: 'cs-types',
      title: '2. Certificate types',
      text: "Each type's name, number prefix, layouts, checks before issue, how many a person may hold, who may issue it and the fields it asks for; the school's own types.",
      links: [
        {
          title: 'Types and their checks',
          text: `${String(f.active)} of ${String(f.types)} on${f.own ? `, ${String(f.own)} of the school's own` : ''}${f.restricted ? `, ${String(f.restricted)} kept to some roles` : ''}`,
          href: '/certificates/setup/types',
          badge: { tone: 'info', text: `${String(f.types)} types` },
        },
      ],
    },
    {
      id: 'cs-templates',
      title: '3. Templates',
      text: 'The layout of each certificate: edit the text with the field list and a live preview; every save is a new version and the certificates already issued keep theirs.',
      links: [
        {
          title: 'Templates',
          text: 'Ready layouts for every type, copies, versions, back to the ready layout',
          href: '/certificates/setup/templates',
          badge: { tone: 'info', text: `${String(f.templates)} templates` },
        },
      ],
    },
    {
      id: 'cs-legacy',
      title: '4. From the old system',
      text: "The old system's certificates as read-only history under their own numbers; each type's series and the TC book carry on after its last number.",
      links: [
        {
          title: 'From the old system',
          text: 'Read the old register, map each old name to a type, check, bring, the count check',
          href: '/certificates/setup/legacy',
        },
      ],
    },
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Certificate set-up' },
        ]}
      />
      <PageHeader
        kicker="Certificates"
        title="Certificate set-up"
        description="Who signs, the types with their checks and fields, and the templates. Fill it in order."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Types" value={String(f.types)} />
        <KpiTile label="Switched on" value={String(f.active)} />
        <KpiTile label="The school's own" value={String(f.own)} />
        <KpiTile label="Kept to some roles" value={String(f.restricted)} />
        <KpiTile label="Templates" value={String(f.templates)} />
        <KpiTile label="Signatory" value={f.signatory ? 'Set' : 'Not set'} />
      </div>
      {o.checks.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>To look at</strong>
            <ul style={{ margin: 'var(--sp-2) 0 0' }}>
              {o.checks.map((c) => (
                <li key={c.text}>
                  <a href={c.href}>{c.text}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <div className="ep-setup-sections">
        {sections.map((x) => (
          <section key={x.id} className="ep-card" aria-labelledby={x.id}>
            <h2 id={x.id} className="ep-card__title">
              {x.title}
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {x.text}
            </p>
            <ul className="ep-setup-links">
              {x.links.map((l) => (
                <li key={l.title}>
                  <a href={l.href}>
                    <strong>{l.title}</strong>
                  </a>{' '}
                  {l.badge ? <Badge tone={l.badge.tone}>{l.badge.text}</Badge> : null}
                  <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                    {l.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
