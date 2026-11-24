import { Card, PageHeader } from '@edupro/ui';
import { StaffPassForm } from '@/components/StaffPassForm';
import { currentLang, t } from '@/lib/i18n';
import { applyStaffPass } from '../actions';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * My own gate pass (0069), as the admin website's Apply for a gate pass: RGP (I come back today) or NRGP (I do not),
 * the date and times, the purpose, and what I carry out, item by item.
 */
export default async function NewGatePassPage() {
  const lang = await currentLang();
  const w = (en: string) => t(lang, en);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker={w('Gate passes')}
        title={w('Apply for a gate pass')}
        description={w(
          'RGP: you go out on work and come back the same day. NRGP: you do not come back today. List anything you carry out of the school.',
        )}
      />
      <nav
        aria-label={w('Gate passes')}
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <a className="ep-btn ep-btn--sm ep-btn--ghost" href="/gate-passes">
          {w('To approve')}
        </a>
        <a
          className="ep-btn ep-btn--sm ep-btn--primary"
          href="/gate-passes#mine"
          aria-current="page"
        >
          {w('My gate passes')}
        </a>
      </nav>
      <Card>
        <StaffPassForm
          today={today()}
          apply={applyStaffPass}
          words={{
            type: w('Type of pass'),
            rgp: w('RGP · I come back today'),
            nrgp: w('NRGP · I do not come back today'),
            date: w('Date'),
            out: w('Going out at'),
            back: w('Back by'),
            purpose: w('Purpose'),
            goingTo: w('Going to (optional)'),
            items: w('Equipment or material taken out of the school'),
            none: w('Nothing carried out. Add a row for each item (laptop, projector, files…).'),
            item: w('Item'),
            qty: w('Quantity'),
            serial: w('Serial / asset no.'),
            bringBack: w('To be brought back'),
            remove: w('Remove'),
            add: w('Add an item'),
            send: w('Send for approval'),
            needBack: w('Say by when you will be back.'),
            needName: w('Give each item a name, or remove the empty row.'),
          }}
        />
      </Card>
    </main>
  );
}
