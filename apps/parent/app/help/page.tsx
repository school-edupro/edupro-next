import { Card, PageHeader } from '@edupro/ui';
import { currentLang, t } from '@/lib/i18n';

/** Sprint 22: the help centre of the parent app: the routine questions per screen, bilingual. */
const FAQ: Array<[string, string]> = [
  [
    'How do I switch between my children?',
    'Every screen with a child switch shows one child at a time; tap the name at the top to change. Fees, results and attendance are per child.',
  ],
  [
    'I paid online but the receipt is not showing.',
    'Open Fees; a pending or failed payment is listed with a Retry button. A receipt appears only after the gateway confirms; the school office can see the transaction too.',
  ],
  [
    'How do I apply for leave?',
    'Queries → New request → Leave, with the dates and the reason. The class teacher approves it and the attendance shows leave for those days.',
  ],
  [
    'How do I ask to meet a teacher?',
    'Appointments → Request an appointment with up to three slots. The class teacher confirms one and you receive a WhatsApp.',
  ],
  [
    'Why did I not get an absence alert?',
    'Alerts go once a day per child after the attendance time. Check Profile → Your consents; safety and attendance alerts are always sent, but the mobile number on record must be current.',
  ],
  [
    'How do I change my mobile number or address?',
    'Profile → Update on the section (address, contact, parents). Some changes save at once; others wait for the school’s approval and may need a document such as an electricity bill. Follow them under My requests.',
  ],
  [
    'Where is the report card?',
    'Results shows each released term; the PDF button prepares the card for download. A card can be withheld while fees are due.',
  ],
  [
    'What data does the school hold about my child?',
    'Profile → Your data lets you ask for a copy, a correction or raise a grievance under the DPDP Act. The school answers within the legal time.',
  ],
  [
    'The app works offline but shows old data.',
    'The app keeps the last copy of pages for reading when offline; it refreshes when the connection returns. Sign out clears the copies.',
  ],
  [
    'How do I change the language?',
    'The हिन्दी / English link on the home page switches every screen.',
  ],
];

export default async function HelpPage() {
  const lang = await currentLang();
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Help')}
        description={t(
          lang,
          'Answers to the common questions. For anything else, the school office is the first contact.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {FAQ.map(([q, a]) => (
        <Card key={q} title={t(lang, q)} style={{ marginBottom: 'var(--sp-3)' }}>
          <p style={{ margin: 0 }}>{t(lang, a)}</p>
        </Card>
      ))}
    </main>
  );
}
