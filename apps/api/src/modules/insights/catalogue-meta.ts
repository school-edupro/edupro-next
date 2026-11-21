/**
 * The chatbot's words for each approved query (docs/design/91): the question its chip asks (English and Hindi),
 * more ways people ask it, the screen it opens (the app's own screen and each website's page), the related questions
 * to suggest next, and — where a table is not the clearest — its own card and sentence. The SQL stays in
 * catalogue.ts; nothing here reads data.
 */

export type Lang = 'en' | 'hi' | 'hinglish';
export type Row = Record<string, unknown>;

export interface CardColumn {
  key: string;
  label: string;
  labelHi: string;
  type: 'text' | 'money' | 'date' | 'number';
}
export type Card =
  | { kind: 'figures'; figures: Array<{ label: string; labelHi: string; value: string }> }
  | { kind: 'table'; columns: CardColumn[]; rows: Row[]; more: number };

export interface Screen {
  label: string;
  labelHi: string;
  /** the app's own screen (a family or staff menu path) */
  app?: string;
  admin?: string;
  teacher?: string;
  parent?: string;
}

export interface EntryMeta {
  ask: string;
  askHi: string;
  phrases?: string[];
  screen?: Screen;
  followUps?: string[];
  card?: (rows: Row[]) => Card;
  /** `self`: a student asking about themselves (say "you"). */
  answer?: (rows: Row[], params: Record<string, unknown>, lang: Lang, self: boolean) => string;
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const rupees = (v: unknown) => `₹${num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const t = (lang: Lang, en: string, hi: string, hinglish = en) =>
  lang === 'hi' ? hi : lang === 'hinglish' ? hinglish : en;

const ATTENDANCE: Screen = {
  label: 'Attendance',
  labelHi: 'उपस्थिति',
  app: '/attendance',
  admin: '/attendance',
  teacher: '/attendance',
  parent: '/attendance',
};
const FEES: Screen = {
  label: 'Fees',
  labelHi: 'शुल्क',
  app: '/fees',
  admin: '/fees/dashboard',
  parent: '/fees',
};
const HOMEWORK: Screen = {
  label: 'Homework',
  labelHi: 'गृहकार्य',
  app: '/homework',
  admin: '/academics/daily-work',
  teacher: '/daily-work',
  parent: '/homework',
};
const NOTICES: Screen = {
  label: 'Notices',
  labelHi: 'सूचनाएँ',
  app: '/notices',
  admin: '/academics/notices',
  parent: '/notices',
};

/** Column names and their Hindi, for table cards (others are made readable from the key). */
const COLUMNS: Record<string, [string, string, CardColumn['type']]> = {
  child: ['Child', 'बच्चा', 'text'],
  student: ['Student', 'विद्यार्थी', 'text'],
  admission_no: ['Adm. no.', 'प्रवेश सं.', 'text'],
  section: ['Section', 'सेक्शन', 'text'],
  class: ['Class', 'कक्षा', 'text'],
  date: ['Date', 'तिथि', 'date'],
  on_date: ['Date', 'तिथि', 'date'],
  due_on: ['Due on', 'देय तिथि', 'date'],
  assigned_on: ['Given on', 'दिया गया', 'date'],
  published: ['Published', 'प्रकाशित', 'date'],
  balance: ['Balance', 'शेष', 'money'],
  balance_due: ['Balance due', 'बकाया', 'money'],
  net: ['Amount', 'राशि', 'money'],
  paid: ['Paid', 'भुगतान', 'money'],
  amount: ['Amount', 'राशि', 'money'],
  collected: ['Collected', 'प्राप्त', 'money'],
  due: ['Due', 'देय', 'money'],
  absent_days: ['Absent days', 'अनुपस्थित दिन', 'number'],
  marked_days: ['School days', 'विद्यालय दिवस', 'number'],
  absent_on: ['Absent on', 'अनुपस्थित तिथियाँ', 'text'],
  absences: ['Absences', 'अनुपस्थितियाँ', 'number'],
  present: ['Present', 'उपस्थित', 'number'],
  absent: ['Absent', 'अनुपस्थित', 'number'],
  subject: ['Subject', 'विषय', 'text'],
  title: ['Title', 'शीर्षक', 'text'],
  kind: ['Kind', 'प्रकार', 'text'],
  state: ['State', 'स्थिति', 'text'],
  status: ['Status', 'स्थिति', 'text'],
  mark: ['Mark', 'चिह्न', 'text'],
  ledger: ['Fee', 'शुल्क', 'text'],
  percent: ['%', '%', 'number'],
  students: ['Students', 'विद्यार्थी', 'number'],
};
const readable = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A table card: the rows' columns named (Hindi too), at most 10 rows, how many more there are. */
export function tableCard(rows: Row[], keys?: string[]): Card {
  const cols = keys ?? Object.keys(rows[0] ?? {}).filter((k) => !/(^id$|_id$)/.test(k));
  return {
    kind: 'table',
    columns: cols.map((key) => {
      const known = COLUMNS[key];
      return known
        ? { key, label: known[0], labelHi: known[1], type: known[2] }
        : { key, label: readable(key), labelHi: readable(key), type: 'text' as const };
    }),
    rows: rows.slice(0, 10).map((r) => Object.fromEntries(cols.map((k) => [k, r[k] ?? null]))),
    more: Math.max(0, rows.length - 10),
  };
}

const periodOf = (p: Record<string, unknown>, lang: Lang) => {
  if (typeof p.date === 'string') return t(lang, ` on ${p.date}`, ` (${p.date})`, ` ${p.date} ko`);
  if (typeof p.days === 'number')
    return t(
      lang,
      ` in the last ${p.days} days`,
      ` (पिछले ${p.days} दिन)`,
      ` pichhle ${p.days} din`,
    );
  return '';
};

/** The sentence when an entry has none of its own: what it is, for when, how many. */
export function genericAnswer(
  title: string,
  titleHi: string,
  rows: Row[],
  params: Record<string, unknown>,
  lang: Lang,
): string {
  const n = rows.length;
  const when = periodOf(params, lang);
  if (n === 0)
    return t(
      lang,
      `Nothing found for ${title.toLowerCase()}${when}.`,
      `${titleHi}${when} — कुछ नहीं मिला।`,
      `${title}${when}: kuch nahi mila.`,
    );
  return t(
    lang,
    `${title}${when}: ${n} ${n === 1 ? 'record' : 'records'}.`,
    `${titleHi}${when}: ${n} रिकॉर्ड।`,
    `${title}${when}: ${n} record mile.`,
  );
}

/** Each query's chip question, its other phrasings, its screen and its follow-ups. */
export const META: Record<string, EntryMeta> = {
  // ---- school ---------------------------------------------------------------------------------------
  list_classes: {
    ask: 'How many students are in each class?',
    askHi: 'हर कक्षा में कितने विद्यार्थी हैं?',
    phrases: ['class strength', 'students in each section'],
    screen: { label: 'Classes', labelHi: 'कक्षाएँ', admin: '/academics/classes' },
    followUps: ['attendance_today', 'seat_fill', 'fee_by_class'],
  },
  find_student: {
    ask: 'Find a student by name or admission number',
    askHi: 'नाम या प्रवेश संख्या से विद्यार्थी खोजें',
    screen: { label: 'Student search', labelHi: 'विद्यार्थी खोज', admin: '/people/search' },
    followUps: ['student_attendance', 'student_fee_ledger'],
  },
  // ---- attendance -----------------------------------------------------------------------------------
  attendance_today: {
    ask: "Today's attendance by class",
    askHi: 'आज की कक्षावार उपस्थिति',
    phrases: ['how many students are present today', 'attendance today'],
    screen: ATTENDANCE,
    followUps: ['absentees_of_day', 'classes_below_attendance', 'attendance_trend'],
  },
  attendance_trend: {
    ask: 'Attendance % for the last 30 days',
    askHi: 'पिछले 30 दिन की उपस्थिति %',
    screen: ATTENDANCE,
    followUps: ['classes_below_attendance', 'chronic_absentees', 'attendance_today'],
  },
  classes_below_attendance: {
    ask: 'Which classes are below 85% attendance?',
    askHi: 'किन कक्षाओं की उपस्थिति 85% से कम है?',
    screen: ATTENDANCE,
    followUps: ['chronic_absentees', 'attendance_trend', 'absentees_of_day'],
  },
  absentees_of_day: {
    ask: 'Who is absent today?',
    askHi: 'आज कौन अनुपस्थित है?',
    screen: ATTENDANCE,
    followUps: ['chronic_absentees', 'attendance_today', 'classes_below_attendance'],
  },
  chronic_absentees: {
    ask: 'Students absent most often this month',
    askHi: 'इस महीने सबसे अधिक अनुपस्थित विद्यार्थी',
    screen: ATTENDANCE,
    followUps: ['absentees_of_day', 'classes_below_attendance', 'student_attendance'],
  },
  student_attendance: {
    ask: 'Attendance of one student',
    askHi: 'एक विद्यार्थी की उपस्थिति',
    screen: ATTENDANCE,
    followUps: ['student_fee_ledger', 'chronic_absentees'],
  },
  reader_health: {
    ask: 'Are the RFID readers working?',
    askHi: 'क्या RFID रीडर चल रहे हैं?',
    screen: { label: 'RFID readers', labelHi: 'RFID रीडर', admin: '/attendance/rfid' },
    followUps: ['attendance_today'],
  },
  // ---- fees -----------------------------------------------------------------------------------------
  fee_summary: {
    ask: 'Fees due, collected and balance till today',
    askHi: 'आज तक का देय, प्राप्त और शेष शुल्क',
    screen: FEES,
    followUps: ['fee_defaulters', 'fee_collection_by_day', 'fee_by_class'],
  },
  fee_defaulters: {
    ask: 'Fee defaulters',
    askHi: 'शुल्क बकायादार',
    screen: { ...FEES, admin: '/fees/reminders' },
    followUps: ['fee_ageing', 'fee_by_class', 'fee_summary'],
  },
  fee_collection_by_day: {
    ask: 'Fee collection per day this month',
    askHi: 'इस महीने प्रतिदिन शुल्क संग्रह',
    screen: { ...FEES, admin: '/fees/reports' },
    followUps: ['fee_collection_by_mode', 'receipts_of_day', 'fee_summary'],
  },
  fee_collection_by_mode: {
    ask: 'Fee collection by mode (cash, online, cheque)',
    askHi: 'माध्यम अनुसार शुल्क संग्रह',
    screen: { ...FEES, admin: '/fees/reports' },
    followUps: ['online_payments_status', 'fee_collection_by_day'],
  },
  fee_ageing: {
    ask: 'How old are the dues?',
    askHi: 'बकाया कितना पुराना है?',
    screen: FEES,
    followUps: ['fee_defaulters', 'fee_by_class'],
  },
  fee_by_class: {
    ask: 'Fees due and collected by class',
    askHi: 'कक्षावार देय और प्राप्त शुल्क',
    screen: FEES,
    followUps: ['fee_defaulters', 'fee_summary'],
  },
  student_fee_ledger: {
    ask: 'Fee instalments of one student',
    askHi: 'एक विद्यार्थी की शुल्क किस्तें',
    screen: { ...FEES, admin: '/fees/ledger' },
    followUps: ['student_attendance', 'fee_defaulters'],
  },
  receipts_of_day: {
    ask: "Today's receipts",
    askHi: 'आज की रसीदें',
    screen: { ...FEES, admin: '/fees/receipt' },
    followUps: ['fee_collection_by_mode', 'fee_collection_by_day'],
  },
  refunds_pending: {
    ask: 'Refunds waiting for approval',
    askHi: 'स्वीकृति के लिए लंबित वापसी',
    screen: { ...FEES, admin: '/fees/refunds' },
    followUps: ['fee_summary'],
  },
  online_payments_status: {
    ask: 'Online payments and their settlement',
    askHi: 'ऑनलाइन भुगतान और निपटान',
    screen: { ...FEES, admin: '/fees/settlements' },
    followUps: ['fee_collection_by_mode', 'receipts_of_day'],
  },
  misc_receipts: {
    ask: 'Misc receipts',
    askHi: 'विविध रसीदें',
    screen: { ...FEES, admin: '/fees/misc' },
    followUps: ['receipts_of_day'],
  },
  // ---- academics ------------------------------------------------------------------------------------
  homework_coverage: {
    ask: 'Homework posted per section this week',
    askHi: 'इस सप्ताह सेक्शन अनुसार गृहकार्य',
    screen: HOMEWORK,
    followUps: ['lesson_plans_status', 'substitutions'],
  },
  lesson_plans_status: {
    ask: 'Lesson plans by status',
    askHi: 'स्थिति अनुसार पाठ योजनाएँ',
    screen: { label: 'Lesson plans', labelHi: 'पाठ योजनाएँ', admin: '/academics/lesson-plans' },
    followUps: ['homework_coverage'],
  },
  substitutions: {
    ask: 'Timetable substitutions',
    askHi: 'समय सारणी प्रतिस्थापन',
    screen: { label: 'Substitutions', labelHi: 'प्रतिस्थापन', admin: '/academics/substitutions' },
    followUps: ['timetable_of_section', 'staff_punches_today'],
  },
  timetable_of_section: {
    ask: 'Timetable of a section',
    askHi: 'एक सेक्शन की समय सारणी',
    screen: { label: 'Timetable', labelHi: 'समय सारणी', admin: '/academics/timetable' },
    followUps: ['substitutions'],
  },
  // ---- admissions, transport, communication, HR, exams ----------------------------------------------
  admissions_funnel: {
    ask: 'Admissions funnel',
    askHi: 'प्रवेश फ़नल',
    screen: { label: 'Admissions', labelHi: 'प्रवेश', admin: '/admissions' },
    followUps: ['seat_fill'],
  },
  seat_fill: {
    ask: 'Seats filled by class',
    askHi: 'कक्षावार भरी सीटें',
    screen: { label: 'Admissions', labelHi: 'प्रवेश', admin: '/admissions' },
    followUps: ['admissions_funnel', 'list_classes'],
  },
  route_load: {
    ask: 'Bus routes, riders and boarding today',
    askHi: 'बस रूट, सवार और आज की बोर्डिंग',
    screen: { label: 'Transport', labelHi: 'परिवहन', admin: '/transport' },
    followUps: ['transport_requests_pending', 'vehicle_documents_expiring'],
  },
  transport_requests_pending: {
    ask: 'Pending bus requests',
    askHi: 'लंबित बस अनुरोध',
    screen: { label: 'Bus requests', labelHi: 'बस अनुरोध', admin: '/transport/requests' },
    followUps: ['route_load'],
  },
  vehicle_documents_expiring: {
    ask: 'Vehicle and driver papers expiring',
    askHi: 'समाप्त होने वाले वाहन और चालक दस्तावेज़',
    screen: { label: 'Vehicle papers', labelHi: 'वाहन दस्तावेज़', admin: '/transport/papers' },
    followUps: ['route_load'],
  },
  message_delivery: {
    ask: 'Message delivery by channel',
    askHi: 'माध्यम अनुसार संदेश वितरण',
    screen: { label: 'Messages', labelHi: 'संदेश', admin: '/comms/reports' },
    followUps: ['consent_coverage', 'open_queries'],
  },
  open_queries: {
    ask: 'Open parent queries',
    askHi: 'खुले अभिभावक प्रश्न',
    screen: { label: 'Parent queries', labelHi: 'अभिभावक प्रश्न', admin: '/engagement/queries' },
    followUps: ['message_delivery'],
  },
  consent_coverage: {
    ask: 'Consent coverage by purpose',
    askHi: 'उद्देश्य अनुसार सहमति',
    screen: { label: 'Consents', labelHi: 'सहमतियाँ', admin: '/comms/consents' },
    followUps: ['message_delivery'],
  },
  staff_headcount: {
    ask: 'Staff by department',
    askHi: 'विभाग अनुसार कर्मचारी',
    screen: { label: 'Staff', labelHi: 'कर्मचारी', admin: '/people/employees' },
    followUps: ['staff_punches_today'],
  },
  staff_punches_today: {
    ask: 'Staff punched in today',
    askHi: 'आज पंच करने वाले कर्मचारी',
    screen: {
      label: 'Staff attendance',
      labelHi: 'कर्मचारी उपस्थिति',
      admin: '/attendance/punches',
    },
    followUps: ['staff_headcount', 'substitutions'],
  },
  exams_of_year: {
    ask: 'Exams of the session',
    askHi: 'सत्र की परीक्षाएँ',
    screen: { label: 'Exams', labelHi: 'परीक्षाएँ', admin: '/exams' },
    followUps: [],
  },
  // ---- a teacher's own sections ---------------------------------------------------------------------
  my_sections: {
    ask: 'My sections',
    askHi: 'मेरे सेक्शन',
    screen: {
      label: 'Attendance',
      labelHi: 'उपस्थिति',
      app: '/attendance',
      teacher: '/attendance',
    },
    followUps: ['my_attendance_today', 'my_absentees', 'my_homework'],
  },
  my_attendance_today: {
    ask: "Today's attendance in my sections",
    askHi: 'मेरे सेक्शन की आज की उपस्थिति',
    screen: {
      label: 'Mark attendance',
      labelHi: 'उपस्थिति लगाएँ',
      app: '/attendance',
      teacher: '/attendance',
    },
    followUps: ['my_absentees', 'my_frequent_absentees'],
  },
  my_absentees: {
    ask: 'Who was absent in my sections?',
    askHi: 'मेरे सेक्शन में कौन अनुपस्थित था?',
    screen: {
      label: 'Attendance',
      labelHi: 'उपस्थिति',
      app: '/attendance',
      teacher: '/attendance',
    },
    followUps: ['my_frequent_absentees', 'my_attendance_today'],
  },
  my_frequent_absentees: {
    ask: 'Frequent absentees in my sections',
    askHi: 'मेरे सेक्शन के बार-बार अनुपस्थित विद्यार्थी',
    screen: {
      label: 'Attendance',
      labelHi: 'उपस्थिति',
      app: '/attendance',
      teacher: '/attendance',
    },
    followUps: ['my_absentees', 'my_open_queries'],
  },
  my_homework: {
    ask: 'Work posted in my sections this week',
    askHi: 'इस सप्ताह मेरे सेक्शन में दिया गया कार्य',
    screen: {
      label: 'Post work',
      labelHi: 'कार्य दें',
      app: '/daily-work',
      teacher: '/daily-work',
    },
    followUps: ['my_marks_status', 'my_sections'],
  },
  my_open_queries: {
    ask: 'Open queries from my sections',
    askHi: 'मेरे सेक्शन के खुले प्रश्न',
    screen: { label: 'Queries', labelHi: 'प्रश्न', teacher: '/queries' },
    followUps: ['my_absentees'],
  },
  my_marks_status: {
    ask: 'Mark entry status of my sections',
    askHi: 'मेरे सेक्शन की अंक प्रविष्टि स्थिति',
    screen: { label: 'Marks', labelHi: 'अंक', app: '/marks', teacher: '/marks' },
    followUps: ['my_homework', 'my_sections'],
  },
  // ---- a parent's own children ----------------------------------------------------------------------
  my_children: {
    ask: 'My children and what is due',
    askHi: 'मेरे बच्चे और बकाया',
    screen: { label: 'Profile', labelHi: 'प्रोफ़ाइल', app: '/profile', parent: '/profile' },
    followUps: ['child_attendance', 'child_dues', 'child_homework'],
    answer: (rows, _p, lang, self) =>
      self && rows[0]
        ? t(
            lang,
            `You are ${rows[0].child} of ${rows[0].section ?? 'your class'} (adm. no. ${rows[0].admission_no}).`,
            `आप ${rows[0].child}, ${rows[0].section ?? 'आपकी कक्षा'} (प्रवेश सं. ${rows[0].admission_no})।`,
            `Aap ${rows[0].child}, ${rows[0].section ?? 'aapki class'} (adm. no. ${rows[0].admission_no}).`,
          )
        : t(
            lang,
            `You have ${rows.length} ${rows.length === 1 ? 'child' : 'children'} in the school: ${rows.map((r) => r.child).join(', ')}.`,
            `विद्यालय में आपके ${rows.length} बच्चे हैं: ${rows.map((r) => r.child).join(', ')}।`,
            `School mein aapke ${rows.length} bachche hain: ${rows.map((r) => r.child).join(', ')}.`,
          ),
  },
  child_dues: {
    ask: 'How much fees is due?',
    askHi: 'कितना शुल्क बकाया है?',
    phrases: ['fees due', 'kitni fees baki hai', 'what do I have to pay'],
    screen: FEES,
    followUps: ['child_attendance', 'child_notices', 'my_children'],
    answer: (rows, _p, lang, self) => {
      const total = rows.reduce((n, r) => n + num(r.balance), 0);
      const overdue = rows
        .filter((r) => r.state === 'overdue')
        .reduce((n, r) => n + num(r.balance), 0);
      if (rows.length === 0)
        return t(
          lang,
          'Nothing is due now or in the next 30 days.',
          'अभी या अगले 30 दिनों में कुछ बकाया नहीं है।',
          'Abhi ya agle 30 din mein kuch baki nahi hai.',
        );
      const names = [...new Set(rows.map((r) => String(r.child)))].join(', ');
      if (self)
        return t(
          lang,
          `${rupees(total)} of your fees is due${overdue > 0 ? ` (${rupees(overdue)} overdue)` : ''}. Your parent pays it.`,
          `आपका ${rupees(total)} शुल्क बकाया है${overdue > 0 ? ` (${rupees(overdue)} समय से अधिक)` : ''}। भुगतान अभिभावक करते हैं।`,
          `Aapki ${rupees(total)} fees baki hai${overdue > 0 ? ` (${rupees(overdue)} overdue)` : ''}. Payment parent karte hain.`,
        );
      return t(
        lang,
        `${rupees(total)} is due for ${names}${overdue > 0 ? ` (${rupees(overdue)} overdue)` : ''}.`,
        `${names} के लिए ${rupees(total)} बकाया है${overdue > 0 ? ` (${rupees(overdue)} समय से अधिक)` : ''}।`,
        `${names} ke liye ${rupees(total)} baki hai${overdue > 0 ? ` (${rupees(overdue)} overdue)` : ''}.`,
      );
    },
    card: (rows) => tableCard(rows, ['child', 'due_on', 'ledger', 'balance', 'state']),
  },
  child_attendance: {
    ask: 'Show the attendance record',
    askHi: 'उपस्थिति रिकॉर्ड दिखाओ',
    phrases: ['my attendance record', 'kitne din absent', 'was my child absent this week'],
    screen: ATTENDANCE,
    followUps: ['child_homework', 'child_dues', 'child_notices'],
    answer: (rows, p, lang, self) => {
      if (rows.length === 0)
        return t(
          lang,
          `No attendance marked${periodOf(p, lang)}.`,
          `कोई उपस्थिति दर्ज नहीं${periodOf(p, lang)}।`,
          `Koi attendance mark nahi hui${periodOf(p, lang)}.`,
        );
      return rows
        .map((r) => {
          const days = num(r.marked_days);
          const absent = num(r.absent_days);
          const pct = days ? Math.round(((days - absent) * 1000) / days) / 10 : 0;
          if (self)
            return t(
              lang,
              `You were present ${days - absent} of ${days} days (${pct}%), absent ${absent}.`,
              `आप ${days} में से ${days - absent} दिन उपस्थित रहे (${pct}%), ${absent} अनुपस्थित।`,
              `Aap ${days} mein se ${days - absent} din present rahe (${pct}%), ${absent} absent.`,
            );
          return t(
            lang,
            `${r.child}: present ${days - absent} of ${days} days (${pct}%), absent ${absent}.`,
            `${r.child}: ${days} में से ${days - absent} दिन उपस्थित (${pct}%), ${absent} अनुपस्थित।`,
            `${r.child}: ${days} mein se ${days - absent} din present (${pct}%), ${absent} absent.`,
          );
        })
        .join(' ');
    },
    card: (rows) =>
      rows.length === 1
        ? {
            kind: 'figures',
            figures: [
              {
                label: 'School days',
                labelHi: 'विद्यालय दिवस',
                value: String(num(rows[0]!.marked_days)),
              },
              {
                label: 'Present',
                labelHi: 'उपस्थित',
                value: String(num(rows[0]!.marked_days) - num(rows[0]!.absent_days)),
              },
              { label: 'Absent', labelHi: 'अनुपस्थित', value: String(num(rows[0]!.absent_days)) },
              {
                label: 'Absent on',
                labelHi: 'अनुपस्थित तिथियाँ',
                value: String(rows[0]!.absent_on ?? '—'),
              },
            ],
          }
        : tableCard(rows, ['child', 'marked_days', 'absent_days', 'absent_on']),
  },
  child_homework: {
    ask: 'Homework this week',
    askHi: 'इस सप्ताह का गृहकार्य',
    phrases: ['what homework is there', 'homework kya hai'],
    screen: HOMEWORK,
    followUps: ['child_attendance', 'child_notices'],
    answer: (rows, p, lang) =>
      rows.length === 0
        ? t(
            lang,
            `No homework posted${periodOf(p, lang)}.`,
            `कोई गृहकार्य नहीं दिया गया${periodOf(p, lang)}।`,
            `Koi homework nahi diya gaya${periodOf(p, lang)}.`,
          )
        : t(
            lang,
            `${rows.length} ${rows.length === 1 ? 'piece of work' : 'pieces of work'} posted${periodOf(p, lang)}.`,
            `${rows.length} कार्य दिए गए${periodOf(p, lang)}।`,
            `${rows.length} kaam diye gaye${periodOf(p, lang)}.`,
          ),
    card: (rows) => tableCard(rows, ['child', 'assigned_on', 'subject', 'title', 'due_on']),
  },
  child_notices: {
    ask: 'Latest notices',
    askHi: 'नवीनतम सूचनाएँ',
    phrases: ['any new circular', 'koi notice'],
    screen: NOTICES,
    followUps: ['child_homework', 'child_dues'],
    card: (rows) => tableCard(rows, ['published', 'kind', 'title']),
  },
  // ---- docs/design/91: a student's (or a parent's child's) own records -------------------------------
  child_timetable_today: {
    ask: "Today's classes",
    askHi: 'आज की कक्षाएँ',
    phrases: ['what classes do i have today', 'aaj kaunse period hain'],
    screen: { label: 'Timetable', labelHi: 'समय सारणी', app: '/timetable', parent: '/timetable' },
    followUps: ['child_homework', 'child_date_sheet', 'child_attendance'],
    answer: (rows, _p, lang, self) => {
      if (rows.length === 0)
        return t(lang, 'No classes today.', 'आज कोई कक्षा नहीं है।', 'Aaj koi class nahi hai.');
      const first = rows[0]!;
      const who = self
        ? t(lang, 'You have', 'आपकी', 'Aapke')
        : `${first.child} ${t(lang, 'has', 'की', 'ke')}`;
      return t(
        lang,
        `${who} ${rows.length} periods today; the first is ${first.subject ?? 'a period'} at ${first.starts_at}.`,
        `${who} आज ${rows.length} कक्षाएँ हैं; पहली ${first.subject ?? 'कक्षा'} ${first.starts_at} बजे।`,
        `${who} aaj ${rows.length} period hain; pehla ${first.subject ?? 'period'} ${first.starts_at} baje.`,
      );
    },
    card: (rows) => tableCard(rows, ['starts_at', 'subject', 'teacher', 'room']),
  },
  child_date_sheet: {
    ask: 'When is the next exam?',
    askHi: 'अगली परीक्षा कब है?',
    phrases: ['exam date sheet', 'next paper', 'exam kab hai'],
    screen: {
      label: 'Exam date sheet',
      labelHi: 'परीक्षा डेट शीट',
      app: '/date-sheet',
      parent: '/date-sheet',
    },
    followUps: ['child_results', 'child_timetable_today', 'child_homework'],
    answer: (rows, _p, lang) => {
      if (rows.length === 0)
        return t(
          lang,
          'No exam paper is coming up.',
          'कोई परीक्षा पेपर आगे नहीं है।',
          'Koi exam paper aage nahi hai.',
        );
      const r = rows[0]!;
      return t(
        lang,
        `Next paper: ${r.subject} (${r.exam}) on ${r.date}${r.starts_at ? ` at ${r.starts_at}` : ''}. ${rows.length} papers to come.`,
        `अगला पेपर: ${r.subject} (${r.exam}) ${r.date}${r.starts_at ? `, ${r.starts_at} बजे` : ''}। कुल ${rows.length} पेपर बाकी।`,
        `Agla paper: ${r.subject} (${r.exam}) ${r.date}${r.starts_at ? ` ${r.starts_at} baje` : ''}. ${rows.length} paper baki.`,
      );
    },
    card: (rows) => tableCard(rows, ['date', 'starts_at', 'subject', 'exam']),
  },
  child_results: {
    ask: 'Show the report cards',
    askHi: 'रिपोर्ट कार्ड दिखाओ',
    phrases: ['my result', 'results of the term', 'result kab aayega'],
    screen: { label: 'Results', labelHi: 'परिणाम', app: '/results', parent: '/results' },
    followUps: ['child_date_sheet', 'child_dues', 'child_attendance'],
    answer: (rows, _p, lang) => {
      if (rows.length === 0)
        return t(
          lang,
          'No report card has been released yet.',
          'अभी कोई रिपोर्ट कार्ड जारी नहीं हुआ।',
          'Abhi koi report card jaari nahi hua.',
        );
      const r = rows[0]!;
      const held = r.held === true;
      return t(
        lang,
        `${rows.length} released; the latest is ${r.name} (${r.released})${held ? ' — it is held, for example while fees are due' : ''}.`,
        `${rows.length} जारी; नवीनतम ${r.name} (${r.released})${held ? ' — यह रोका गया है, जैसे शुल्क बकाया होने पर' : ''}।`,
        `${rows.length} jaari; latest ${r.name} (${r.released})${held ? ' — roka gaya hai, jaise fees baki hone par' : ''}.`,
      );
    },
    card: (rows) =>
      tableCard(
        rows.map((r) => ({ ...r, state: r.held ? 'Held' : 'Open' })),
        ['name', 'released', 'state'],
      ),
  },
  child_library: {
    ask: 'Which library books are out?',
    askHi: 'कौन सी पुस्तकें ली हुई हैं?',
    phrases: ['when is my book due', 'kitab kab lautani hai'],
    screen: { label: 'Library', labelHi: 'पुस्तकालय', app: '/library', parent: '/library' },
    followUps: ['child_timetable_today', 'child_notices'],
    answer: (rows, _p, lang) => {
      if (rows.length === 0)
        return t(
          lang,
          'No library books are out now.',
          'अभी कोई पुस्तक ली हुई नहीं है।',
          'Abhi koi kitab li hui nahi hai.',
        );
      const late = rows.filter((r) => num(r.days_late) > 0).length;
      return t(
        lang,
        `${rows.length} ${rows.length === 1 ? 'book' : 'books'} out; the next is due on ${rows[0]!.due_on}${late ? `; ${late} overdue` : ''}.`,
        `${rows.length} पुस्तकें ली हुई हैं; अगली ${rows[0]!.due_on} को लौटानी है${late ? `; ${late} देर से` : ''}।`,
        `${rows.length} kitab li hui; agli ${rows[0]!.due_on} ko lautani hai${late ? `; ${late} late` : ''}.`,
      );
    },
    card: (rows) => tableCard(rows, ['title', 'due_on', 'days_late']),
  },
  child_bus: {
    ask: 'Which bus and when?',
    askHi: 'कौन सी बस और कब?',
    phrases: ['bus timing', 'bus kab aayegi', 'my bus stop'],
    screen: { label: 'School bus', labelHi: 'स्कूल बस', app: '/transport', parent: '/transport' },
    followUps: ['child_timetable_today', 'child_dues'],
    answer: (rows, _p, lang) => {
      if (rows.length === 0)
        return t(
          lang,
          'No school bus this month.',
          'इस महीने स्कूल बस नहीं है।',
          'Is mahine school bus nahi hai.',
        );
      const r = rows[0]!;
      return t(
        lang,
        `Pick-up: ${r.pick_route ?? '—'} at ${r.pick_stop ?? '—'}${r.pick_time ? `, ${r.pick_time}` : ''}; drop: ${r.drop_route ?? '—'} at ${r.drop_stop ?? '—'}${r.drop_time ? `, ${r.drop_time}` : ''}.`,
        `पिक-अप: ${r.pick_route ?? '—'}, ${r.pick_stop ?? '—'}${r.pick_time ? ` ${r.pick_time}` : ''}; ड्रॉप: ${r.drop_route ?? '—'}, ${r.drop_stop ?? '—'}${r.drop_time ? ` ${r.drop_time}` : ''}।`,
        `Pick-up: ${r.pick_route ?? '—'}, ${r.pick_stop ?? '—'}${r.pick_time ? ` ${r.pick_time}` : ''}; drop: ${r.drop_route ?? '—'}, ${r.drop_stop ?? '—'}${r.drop_time ? ` ${r.drop_time}` : ''}.`,
      );
    },
    card: (rows) =>
      rows.length === 1
        ? {
            kind: 'figures',
            figures: [
              {
                label: 'Pick-up stop',
                labelHi: 'पिक-अप स्टॉप',
                value: String(rows[0]!.pick_stop ?? '—'),
              },
              {
                label: 'Pick-up time',
                labelHi: 'पिक-अप समय',
                value: String(rows[0]!.pick_time ?? '—'),
              },
              {
                label: 'Drop stop',
                labelHi: 'ड्रॉप स्टॉप',
                value: String(rows[0]!.drop_stop ?? '—'),
              },
              { label: 'Bus', labelHi: 'बस', value: String(rows[0]!.vehicle ?? '—') },
            ],
          }
        : tableCard(rows, ['child', 'pick_stop', 'pick_time', 'drop_stop', 'vehicle']),
  },
  child_certificates: {
    ask: 'My certificates',
    askHi: 'मेरे प्रमाण पत्र',
    phrases: ['bonafide certificate status', 'certificate request'],
    screen: {
      label: 'Certificates',
      labelHi: 'प्रमाण पत्र',
      app: '/certificates',
      parent: '/certificates',
    },
    followUps: ['child_results', 'child_receipts'],
    answer: (rows, _p, lang) => {
      const issued = rows.filter((r) => r.state === 'issued').length;
      const open = rows.length - issued;
      if (rows.length === 0)
        return t(
          lang,
          'No certificates yet.',
          'अभी कोई प्रमाण पत्र नहीं।',
          'Abhi koi certificate nahi.',
        );
      return t(
        lang,
        `${issued} issued${open ? `, ${open} ${open === 1 ? 'request' : 'requests'} in progress` : ''}.`,
        `${issued} जारी${open ? `, ${open} आवेदन प्रक्रिया में` : ''}।`,
        `${issued} jaari${open ? `, ${open} request process mein` : ''}.`,
      );
    },
    card: (rows) => tableCard(rows, ['certificate', 'state', 'date', 'number']),
  },
  child_receipts: {
    ask: 'Fees paid this session',
    askHi: 'इस सत्र में भरा शुल्क',
    phrases: ['fee receipts', 'how much fees paid', 'kitni fees jama hui'],
    screen: { label: 'Fees', labelHi: 'शुल्क', app: '/fees', parent: '/fees' },
    followUps: ['child_dues', 'child_certificates'],
    answer: (rows, _p, lang) => {
      if (rows.length === 0)
        return t(
          lang,
          'No fees paid yet this session.',
          'इस सत्र में अभी कोई शुल्क नहीं भरा।',
          'Is session mein abhi koi fees jama nahi hui.',
        );
      const total = rows.reduce((n, r) => n + num(r.amount), 0);
      return t(
        lang,
        `${rows.length} ${rows.length === 1 ? 'receipt' : 'receipts'} this session, ${rupees(total)} in all; the latest ${rupees(rows[0]!.amount)} on ${rows[0]!.date}.`,
        `इस सत्र में ${rows.length} रसीदें, कुल ${rupees(total)}; नवीनतम ${rupees(rows[0]!.amount)} ${rows[0]!.date} को।`,
        `Is session ${rows.length} receipt, kul ${rupees(total)}; latest ${rupees(rows[0]!.amount)} ${rows[0]!.date} ko.`,
      );
    },
    card: (rows) => tableCard(rows, ['receipt_no', 'date', 'amount', 'mode']),
  },
  // ---- docs/design/91: a staff member's own records --------------------------------------------------
  my_own_attendance: {
    ask: 'My own attendance this month',
    askHi: 'इस महीने मेरी उपस्थिति',
    phrases: ['how many days was i late', 'meri hazri is mahine'],
    screen: {
      label: 'My attendance',
      labelHi: 'मेरी उपस्थिति',
      app: '/my-attendance',
      teacher: '/my-attendance',
    },
    followUps: ['my_leave_balance', 'my_leave_requests', 'my_timetable_today'],
    answer: (rows, _p, lang) => {
      if (rows.length === 0)
        return t(
          lang,
          'No attendance this month yet.',
          'इस महीने अभी कोई उपस्थिति नहीं।',
          'Is mahine abhi koi attendance nahi.',
        );
      const count = (codes: string[]) => rows.filter((r) => codes.includes(String(r.code))).length;
      const late = rows.filter((r) => num(r.late_minutes) > 0).length;
      return t(
        lang,
        `This month: present ${count(['P', 'HD'])}, absent ${count(['A', 'LOP'])}, on leave ${rows.length - count(['P', 'HD', 'A', 'LOP', 'WO', 'H'])}, late on ${late} ${late === 1 ? 'day' : 'days'}.`,
        `इस महीने: उपस्थित ${count(['P', 'HD'])}, अनुपस्थित ${count(['A', 'LOP'])}, अवकाश ${rows.length - count(['P', 'HD', 'A', 'LOP', 'WO', 'H'])}, देर ${late} दिन।`,
        `Is mahine: present ${count(['P', 'HD'])}, absent ${count(['A', 'LOP'])}, leave ${rows.length - count(['P', 'HD', 'A', 'LOP', 'WO', 'H'])}, late ${late} din.`,
      );
    },
    card: (rows) => tableCard(rows, ['date', 'code', 'first_in', 'last_out', 'late_minutes']),
  },
  my_leave_balance: {
    ask: 'How many leaves do I have left?',
    askHi: 'मेरी कितनी छुट्टियाँ बाकी हैं?',
    phrases: ['leave balance', 'kitni chhutti bachi hai'],
    screen: {
      label: 'My leave',
      labelHi: 'मेरा अवकाश',
      app: '/my-leave',
      teacher: '/my-leave',
      admin: '/leave',
    },
    followUps: ['my_leave_requests', 'my_own_attendance'],
    answer: (rows, _p, lang) =>
      rows.length === 0
        ? t(
            lang,
            'No leave balance is kept for you.',
            'आपका कोई अवकाश शेष नहीं रखा जाता।',
            'Aapka koi leave balance nahi rakha jata.',
          )
        : t(
            lang,
            `Leave left: ${rows.map((r) => `${r.code} ${num(r.available)}`).join(', ')}.`,
            `शेष अवकाश: ${rows.map((r) => `${r.code} ${num(r.available)}`).join(', ')}।`,
            `Bachi leave: ${rows.map((r) => `${r.code} ${num(r.available)}`).join(', ')}.`,
          ),
    card: (rows) => tableCard(rows, ['leave_type', 'available', 'taken']),
  },
  my_leave_requests: {
    ask: 'Where are my leave requests?',
    askHi: 'मेरे अवकाश आवेदन कहाँ हैं?',
    screen: {
      label: 'My leave',
      labelHi: 'मेरा अवकाश',
      app: '/my-leave',
      teacher: '/my-leave',
      admin: '/leave',
    },
    followUps: ['my_leave_balance', 'my_own_attendance'],
    answer: (rows, _p, lang) =>
      rows.length === 0
        ? t(
            lang,
            'You have no leave requests.',
            'आपका कोई अवकाश आवेदन नहीं है।',
            'Aapki koi leave request nahi hai.',
          )
        : t(
            lang,
            `Your latest: ${rows[0]!.leave_type}, ${rows[0]!.from_date} to ${rows[0]!.to_date} — ${rows[0]!.status}.`,
            `नवीनतम: ${rows[0]!.leave_type}, ${rows[0]!.from_date} से ${rows[0]!.to_date} — ${rows[0]!.status}।`,
            `Latest: ${rows[0]!.leave_type}, ${rows[0]!.from_date} se ${rows[0]!.to_date} — ${rows[0]!.status}.`,
          ),
    card: (rows) => tableCard(rows, ['leave_type', 'from_date', 'to_date', 'days', 'status']),
  },
  my_payslip: {
    ask: 'My latest payslip',
    askHi: 'मेरी नवीनतम वेतन पर्ची',
    phrases: ['what is my salary this month', 'salary kitni aayi'],
    screen: {
      label: 'My payslips',
      labelHi: 'मेरी वेतन पर्चियाँ',
      app: '/my-payslips',
      teacher: '/my-payslips',
      admin: '/payroll/me',
    },
    followUps: ['my_leave_balance', 'my_own_attendance'],
    answer: (rows, _p, lang) =>
      rows.length === 0
        ? t(
            lang,
            'No payslip is out yet.',
            'अभी कोई वेतन पर्ची जारी नहीं हुई।',
            'Abhi koi payslip nahi aayi.',
          )
        : t(
            lang,
            `Your payslip for ${rows[0]!.month}: net pay ${rupees(rows[0]!.net_pay)}.`,
            `${rows[0]!.month} की वेतन पर्ची: शुद्ध वेतन ${rupees(rows[0]!.net_pay)}।`,
            `${rows[0]!.month} ki payslip: net pay ${rupees(rows[0]!.net_pay)}.`,
          ),
    card: (rows) => ({
      kind: 'figures',
      figures: [
        { label: 'Month', labelHi: 'महीना', value: String(rows[0]!.month) },
        { label: 'Gross', labelHi: 'सकल', value: rupees(rows[0]!.gross) },
        { label: 'Deductions', labelHi: 'कटौती', value: rupees(rows[0]!.deductions) },
        { label: 'Net pay', labelHi: 'शुद्ध वेतन', value: rupees(rows[0]!.net_pay) },
      ],
    }),
  },
  my_timetable_today: {
    ask: 'My classes today',
    askHi: 'आज मेरी कक्षाएँ',
    phrases: ['which period do i have next', 'aaj mere kitne period hain'],
    screen: {
      label: 'My timetable',
      labelHi: 'मेरी समय सारणी',
      app: '/timetable',
      teacher: '/timetable',
    },
    followUps: ['my_substitutions', 'my_attendance_today', 'my_homework'],
    answer: (rows, _p, lang) =>
      rows.length === 0
        ? t(
            lang,
            'You have no periods today.',
            'आज आपकी कोई कक्षा नहीं है।',
            'Aaj aapka koi period nahi hai.',
          )
        : t(
            lang,
            `You teach ${rows.length} periods today; the first is ${rows[0]!.section} ${rows[0]!.subject ?? ''} at ${rows[0]!.starts_at}.`,
            `आज आपकी ${rows.length} कक्षाएँ हैं; पहली ${rows[0]!.section} ${rows[0]!.subject ?? ''} ${rows[0]!.starts_at} बजे।`,
            `Aaj aapke ${rows.length} period hain; pehla ${rows[0]!.section} ${rows[0]!.subject ?? ''} ${rows[0]!.starts_at} baje.`,
          ),
    card: (rows) => tableCard(rows, ['starts_at', 'section', 'subject', 'room']),
  },
  my_substitutions: {
    ask: 'My substitutions this week',
    askHi: 'इस सप्ताह मेरे प्रतिस्थापन',
    screen: {
      label: 'My timetable',
      labelHi: 'मेरी समय सारणी',
      app: '/timetable',
      teacher: '/timetable',
    },
    followUps: ['my_timetable_today', 'my_leave_requests'],
    answer: (rows, _p, lang) => {
      const take = rows.filter((r) => r.role === 'you take it').length;
      return rows.length === 0
        ? t(
            lang,
            'No substitutions for you this week.',
            'इस सप्ताह आपका कोई प्रतिस्थापन नहीं।',
            'Is hafte aapka koi substitution nahi.',
          )
        : t(
            lang,
            `${rows.length} substitutions from yesterday to next week; ${take} for you to take.`,
            `कल से अगले सप्ताह तक ${rows.length} प्रतिस्थापन; ${take} आपको लेने हैं।`,
            `Kal se agle hafte tak ${rows.length} substitution; ${take} aapko lene hain.`,
          );
    },
    card: (rows) => tableCard(rows, ['date', 'period', 'section', 'subject', 'role']),
  },
  // ---- docs/design/91: the school today ---------------------------------------------------------------
  today_summary: {
    ask: 'How is the school today?',
    askHi: 'आज विद्यालय में क्या स्थिति है?',
    phrases: ['summary for today', 'aaj ka haal'],
    screen: {
      label: 'Principal dashboard',
      labelHi: 'प्रधानाचार्य डैशबोर्ड',
      admin: '/insights/principal',
    },
    followUps: ['absentees_of_day', 'receipts_of_day', 'staff_punches_today'],
    answer: (rows, _p, lang) => {
      const r = rows[0] ?? {};
      const marked = num(r.marked);
      const absent = num(r.absent);
      const pct = marked ? Math.round(((marked - absent) * 1000) / marked) / 10 : 0;
      return t(
        lang,
        `Today: ${marked ? `${pct}% of students present (${absent} absent)` : 'attendance not marked yet'}, ${rupees(r.collected)} fees collected, ${num(r.staff_present)} staff present.`,
        `आज: ${marked ? `${pct}% विद्यार्थी उपस्थित (${absent} अनुपस्थित)` : 'उपस्थिति अभी नहीं लगी'}, ${rupees(r.collected)} शुल्क प्राप्त, ${num(r.staff_present)} कर्मचारी उपस्थित।`,
        `Aaj: ${marked ? `${pct}% students present (${absent} absent)` : 'attendance abhi nahi lagi'}, ${rupees(r.collected)} fees aayi, ${num(r.staff_present)} staff present.`,
      );
    },
    card: (rows) => {
      const r = rows[0] ?? {};
      return {
        kind: 'figures',
        figures: [
          { label: 'Students marked', labelHi: 'उपस्थिति दर्ज', value: String(num(r.marked)) },
          { label: 'Absent', labelHi: 'अनुपस्थित', value: String(num(r.absent)) },
          { label: 'Fees collected', labelHi: 'शुल्क प्राप्त', value: rupees(r.collected) },
          {
            label: 'Staff present',
            labelHi: 'कर्मचारी उपस्थित',
            value: String(num(r.staff_present)),
          },
        ],
      };
    },
  },
};
