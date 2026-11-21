import { FAMILY_MENU } from '@edupro/menus';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '../academics/classes/classes.dto';

/**
 * The families' Help page kept by the school (0406, docs/design/89 "Help kept by the school"): the screens a
 * question may be about, the standard questions a school starts with, and the bodies of the calls.
 */

/** The family screens a question may be about (and open): the portal's menu, without Home and Help itself. */
export const FAMILY_HELP_PAGES: ReadonlyArray<{ href: string; label: string }> =
  FAMILY_MENU.flatMap((g) => g.items)
    .filter((i) => i.href !== '/' && i.href !== '/help')
    .map((i) => ({ href: i.href, label: i.label }));
const PAGES = new Set(FAMILY_HELP_PAGES.map((p) => p.href));

export interface StandardHeading {
  key: string;
  title: string;
  titleHi: string;
}
export interface StandardQuestion {
  key: string;
  heading: string;
  audience: 'both' | 'parent' | 'student';
  page: string | null;
  question: string;
  questionHi: string;
  answer: string;
  answerHi: string;
}

/** The headings a school starts with, in order. */
export const STANDARD_HEADINGS: readonly StandardHeading[] = [
  { key: 'app', title: 'Using the app and the website', titleHi: 'ऐप और वेबसाइट का उपयोग' },
  { key: 'attendance', title: 'Attendance and leave', titleHi: 'उपस्थिति और अवकाश' },
  { key: 'fees', title: 'Fees', titleHi: 'शुल्क' },
  { key: 'results', title: 'Results', titleHi: 'परिणाम' },
  { key: 'school', title: 'Meeting the school', titleHi: 'विद्यालय से मिलना' },
  { key: 'profile', title: 'Profile and your data', titleHi: 'प्रोफ़ाइल और आपका डेटा' },
];

/**
 * The questions a school starts with (the website's Help before 0406), in order under their headings; the answers
 * fit the website and the app both.
 */
export const STANDARD_QUESTIONS: readonly StandardQuestion[] = [
  {
    key: 'switch_child',
    heading: 'app',
    audience: 'parent',
    page: null,
    question: 'How do I switch between my children?',
    questionHi: 'मैं अपने बच्चों के बीच कैसे बदलूँ?',
    answer:
      'Every screen with a child switch shows one child at a time; tap the name at the top to change. Fees, results and attendance are per child.',
    answerHi:
      'बच्चा बदलने वाली हर स्क्रीन एक समय में एक बच्चा दिखाती है; बदलने के लिए ऊपर नाम पर टैप करें। शुल्क, परिणाम और उपस्थिति प्रति बच्चा हैं।',
  },
  {
    key: 'language',
    heading: 'app',
    audience: 'both',
    page: null,
    question: 'How do I change the language?',
    questionHi: 'भाषा कैसे बदलूँ?',
    answer:
      'On the website, the हिन्दी / English button at the top of the page; in the app, Settings → Language. Every screen changes.',
    answerHi:
      'वेबसाइट पर पृष्ठ के ऊपर हिन्दी / English बटन; ऐप में सेटिंग्स → भाषा। हर स्क्रीन बदल जाती है।',
  },
  {
    key: 'offline',
    heading: 'app',
    audience: 'both',
    page: null,
    question: 'The app works offline but shows old data.',
    questionHi: 'ऐप ऑफ़लाइन चलता है पर पुराना डेटा दिखाता है।',
    answer:
      'The app keeps the last copy of pages for reading when offline; it refreshes when the connection returns. Sign out clears the copies.',
    answerHi:
      'ऐप ऑफ़लाइन पढ़ने के लिए पृष्ठों की अंतिम प्रति रखता है; कनेक्शन लौटने पर ताज़ा होता है। साइन आउट प्रतियाँ हटा देता है।',
  },
  {
    key: 'leave',
    heading: 'attendance',
    audience: 'both',
    page: '/attendance',
    question: 'How do I apply for leave?',
    questionHi: 'अवकाश के लिए आवेदन कैसे करूँ?',
    answer:
      'Attendance → Apply for leave, with the dates and the reason. The class teacher approves it and the attendance shows leave for those days.',
    answerHi:
      'उपस्थिति → अवकाश के लिए आवेदन करें, तिथियाँ और कारण सहित। कक्षा शिक्षक स्वीकृत करते हैं और उपस्थिति में वे दिन अवकाश दिखते हैं।',
  },
  {
    key: 'absence_alert',
    heading: 'attendance',
    audience: 'parent',
    page: '/profile',
    question: 'Why did I not get an absence alert?',
    questionHi: 'मुझे अनुपस्थिति अलर्ट क्यों नहीं मिला?',
    answer:
      'Alerts go once a day per child after the attendance time. Check Profile → Your consents; safety and attendance alerts are always sent, but the mobile number on record must be current.',
    answerHi:
      'अलर्ट उपस्थिति समय के बाद प्रति बच्चा दिन में एक बार जाते हैं। प्रोफ़ाइल → आपकी सहमतियाँ देखें; सुरक्षा और उपस्थिति अलर्ट हमेशा जाते हैं, पर दर्ज मोबाइल नंबर सही होना चाहिए।',
  },
  {
    key: 'receipt',
    heading: 'fees',
    audience: 'parent',
    page: '/fees',
    question: 'I paid online but the receipt is not showing.',
    questionHi: 'मैंने ऑनलाइन भुगतान किया पर रसीद नहीं दिख रही।',
    answer:
      'Open Fees; Online payments lists each payment as waiting, paid or failed. A receipt appears only after the gateway confirms; the school office can see the transaction too.',
    answerHi:
      'शुल्क खोलें; ऑनलाइन भुगतान में हर भुगतान प्रतीक्षा में, भुगतान हुआ या असफल दिखता है। रसीद गेटवे की पुष्टि के बाद ही बनती है; कार्यालय भी लेन-देन देख सकता है।',
  },
  {
    key: 'report_card',
    heading: 'results',
    audience: 'both',
    page: '/results',
    question: 'Where is the report card?',
    questionHi: 'रिपोर्ट कार्ड कहाँ है?',
    answer:
      'Results shows each released term; the PDF button prepares the card for download. A card can be withheld while fees are due.',
    answerHi:
      'परिणाम हर जारी सत्र दिखाता है; PDF बटन कार्ड डाउनलोड के लिए तैयार करता है। शुल्क बकाया होने पर कार्ड रोका जा सकता है।',
  },
  {
    key: 'meet_teacher',
    heading: 'school',
    audience: 'parent',
    page: '/appointments',
    question: 'How do I ask to meet a teacher?',
    questionHi: 'शिक्षक से मिलने का अनुरोध कैसे करूँ?',
    answer:
      'Appointments → Book an appointment: pick the child, whom to meet, an open day and a free time. The school confirms it and the gate pass shows on the appointment.',
    answerHi:
      'भेंट → भेंट बुक करें: बच्चा, किससे मिलना है, खुला दिन और खाली समय चुनें। विद्यालय पुष्टि करता है और गेट पास भेंट पर दिखता है।',
  },
  {
    key: 'change_contact',
    heading: 'profile',
    audience: 'both',
    page: '/profile',
    question: 'How do I change my mobile number or address?',
    questionHi: 'मोबाइल नंबर या पता कैसे बदलूँ?',
    answer:
      'Profile → Update on the section (address, contact, parents). Some changes save at once; others wait for the school’s approval and may need a document such as an electricity bill. Follow them under My requests (in the app: Changes asked for).',
    answerHi:
      'प्रोफ़ाइल → अनुभाग पर बदलें (पता, संपर्क, माता-पिता)। कुछ बदलाव तुरंत सहेजे जाते हैं; अन्य विद्यालय की स्वीकृति की प्रतीक्षा करते हैं और बिजली बिल जैसे दस्तावेज़ की आवश्यकता हो सकती है। उन्हें मेरे अनुरोध (ऐप में: माँगे गए बदलाव) में देखें।',
  },
  {
    key: 'data',
    heading: 'profile',
    audience: 'both',
    page: '/profile',
    question: 'What data does the school hold about my child?',
    questionHi: 'विद्यालय मेरे बच्चे का कौन सा डेटा रखता है?',
    answer:
      'Profile → Your data lets you ask for a copy, a correction or raise a grievance under the DPDP Act. The school answers within the legal time.',
    answerHi:
      'प्रोफ़ाइल → आपका डेटा से DPDP अधिनियम के तहत प्रति, सुधार या शिकायत माँग सकते हैं। विद्यालय कानूनी समय में उत्तर देता है।',
  },
];

const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** An optional Hindi text: empty means none (the English shows). */
const Hindi = (min: number, max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || v.length >= min, `at least ${min} letters`)
    .nullable()
    .optional();

export const AudienceSchema = z.enum(['both', 'parent', 'student']);

export const FamilyHelpHeadingSchema = z.object({
  title: Text(1, 80),
  titleHi: Hindi(1, 80),
});
export class FamilyHelpHeadingDto extends createZodDto(FamilyHelpHeadingSchema) {}

export const FamilyHelpQuestionSchema = z.object({
  headingId: IdSchema.nullable().optional(),
  question: Text(3, 200),
  questionHi: Hindi(3, 200),
  answer: Text(3, 2000),
  answerHi: Hindi(3, 2000),
  audience: AudienceSchema.default('both'),
  page: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || PAGES.has(v), 'a family screen of the menu')
    .nullable()
    .optional(),
  hidden: z.boolean().default(false),
});
export class FamilyHelpQuestionDto extends createZodDto(FamilyHelpQuestionSchema) {}

export const FamilyHelpMoveSchema = z.object({ direction: z.enum(['up', 'down']) });
export class FamilyHelpMoveDto extends createZodDto(FamilyHelpMoveSchema) {}

export const FamilyHelpListSchema = z.object({ for: z.enum(['parent', 'student']).optional() });
export class FamilyHelpListDto extends createZodDto(FamilyHelpListSchema) {}

export const FamilyHelpVoteSchema = z.object({ helpful: z.boolean() });
export class FamilyHelpVoteDto extends createZodDto(FamilyHelpVoteSchema) {}
