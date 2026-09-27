import { cookies } from 'next/headers';

/** Parent app languages (S11 Hindi pass): English by default, Hindi through the `edupro_lang` cookie. */
export type Lang = 'en' | 'hi';
export const LANG_COOKIE = 'edupro_lang';

export async function currentLang(): Promise<Lang> {
  try {
    return (await cookies()).get(LANG_COOKIE)?.value === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

const DICT: Record<string, string> = {
  Home: 'होम',
  'Sign out': 'साइन आउट',
  Homework: 'गृहकार्य',
  'Homework, classwork and assignments': 'गृहकार्य, कक्षाकार्य और असाइनमेंट',
  Notices: 'सूचनाएँ',
  'School notices and circulars': 'विद्यालय की सूचनाएँ और परिपत्र',
  Calendar: 'कैलेंडर',
  'Holidays and the almanac': 'छुट्टियाँ और पंचांग',
  Attendance: 'उपस्थिति',
  'Daily attendance of your children': 'आपके बच्चों की दैनिक उपस्थिति',
  Timetable: 'समय-सारणी',
  'The week’s periods and teachers': 'सप्ताह के पीरियड और शिक्षक',
  Queries: 'प्रश्न',
  'Ask, complain or apply for leave': 'प्रश्न पूछें, शिकायत करें या अवकाश माँगें',
  'School bus': 'स्कूल बस',
  'Boarding and alighting alerts': 'बस में चढ़ने-उतरने की सूचनाएँ',
  Profile: 'प्रोफ़ाइल',
  'Your details, consents and change requests': 'आपके विवरण, सहमति और परिवर्तन अनुरोध',
  Fees: 'फ़ीस',
  'Dues, receipts and online payment': 'बकाया, रसीदें और ऑनलाइन भुगतान',
  Results: 'परिणाम',
  'Report cards and progress': 'रिपोर्ट कार्ड और प्रगति',
  'Choose the school to view.': 'देखने के लिए विद्यालय चुनें।',
  'Your child’s school, in your pocket.': 'आपके बच्चे का विद्यालय, आपकी जेब में।',
  'Coming soon': 'शीघ्र आ रहा है',
  'Queries, complaints and leave': 'प्रश्न, शिकायतें और अवकाश',
  'New request': 'नया अनुरोध',
  'Quick feedback': 'त्वरित प्रतिक्रिया',
  'Send feedback': 'प्रतिक्रिया भेजें',
  Present: 'उपस्थित',
  Absent: 'अनुपस्थित',
  Late: 'विलंब',
  Date: 'तारीख़',
  Status: 'स्थिति',
  In: 'प्रवेश',
  Out: 'निकास',
  Previous: 'पिछला',
  Next: 'अगला',
  'No school days yet': 'अभी कोई विद्यालय दिवस नहीं',
  'No attendance marked in this month.': 'इस महीने उपस्थिति दर्ज नहीं हुई।',
  'Boarding and alighting': 'चढ़ना और उतरना',
  'Your consents': 'आपकी सहमति',
  Allow: 'अनुमति दें',
  Withdraw: 'वापस लें',
  Guardians: 'अभिभावक',
  'Privacy notice': 'गोपनीयता सूचना',
  'I have read the notice': 'मैंने सूचना पढ़ ली है',
  Continue: 'जारी रखें',
  'You are offline': 'आप ऑफ़लाइन हैं',
  'The page you asked for is not saved on this device. Check your connection and try again.':
    'यह पृष्ठ इस डिवाइस पर सहेजा नहीं है। कनेक्शन जाँचें और फिर कोशिश करें।',
  'Try again': 'फिर कोशिश करें',
  Language: 'भाषा',
};

/** Translates a known English string; unknown strings fall back to English. */
export const t = (lang: Lang, en: string): string => (lang === 'hi' ? (DICT[en] ?? en) : en);
