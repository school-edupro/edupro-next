import { cookies } from 'next/headers';

/** Teacher app languages (Hindi pass): English by default, Hindi through the `edupro_lang` cookie. */
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
  // Home
  'My classes': 'मेरी कक्षाएँ',
  'Your sections, subjects and this week’s timetable':
    'आपके अनुभाग, विषय और इस सप्ताह की समय-सारणी',
  Attendance: 'उपस्थिति',
  'Mark today’s attendance for your sections': 'अपने अनुभागों की आज की उपस्थिति दर्ज करें',
  'Daily work': 'दैनिक कार्य',
  'Post homework and classwork': 'गृहकार्य और कक्षा-कार्य पोस्ट करें',
  'Lesson plans': 'पाठ योजनाएँ',
  'Weekly plans with approvals': 'अनुमोदन सहित साप्ताहिक योजनाएँ',
  Queries: 'प्रश्न',
  'Family queries and leave requests for your sections':
    'आपके अनुभागों के पारिवारिक प्रश्न और अवकाश अनुरोध',
  Students: 'विद्यार्थी',
  'Your sections and student profiles': 'आपके अनुभाग और विद्यार्थी प्रोफ़ाइल',
  Marks: 'अंक',
  'Enter exam marks for your subjects': 'अपने विषयों के परीक्षा अंक दर्ज करें',
  'Exam register': 'परीक्षा रजिस्टर',
  'Remarks, exam attendance, height and weight': 'टिप्पणियाँ, परीक्षा उपस्थिति, ऊँचाई और वज़न',
  Assistant: 'सहायक',
  'Ask about your sections in English, Hindi or Hinglish':
    'अपने अनुभागों के बारे में अंग्रेज़ी, हिन्दी या हिंग्लिश में पूछें',
  Notices: 'सूचनाएँ',
  'Notices and circulars for staff': 'कर्मचारियों के लिए सूचनाएँ और परिपत्र',
  Calendar: 'कैलेंडर',
  'Holidays and the almanac': 'छुट्टियाँ और पंचांग',
  Leave: 'अवकाश',
  'Apply for leave and approvals': 'अवकाश के लिए आवेदन और अनुमोदन',
  'Welcome,': 'स्वागत है,',
  'permissions in this school': 'अनुमतियाँ इस विद्यालय में',
  'Sign out': 'साइन आउट',
  Session: 'सत्र',
  View: 'देखें',
  'Viewing a previous session (read-only)': 'पिछला सत्र देख रहे हैं (केवल देखने के लिए)',
  Home: 'होम',
  // Marks
  'You are not allowed to enter marks in this school.':
    'आपको इस विद्यालय में अंक दर्ज करने की अनुमति नहीं है।',
  locked: 'लॉक',
  entered: 'दर्ज',
  'out of': 'में से',
  pass: 'उत्तीर्णांक',
  of: 'में से',
  'Choose the section and subject.': 'अनुभाग और विषय चुनें।',
  'No exam is set up for this year yet.': 'इस वर्ष के लिए अभी कोई परीक्षा निर्धारित नहीं है।',
  'Marks saved': 'अंक सहेजे गए',
  'Entry for this subject is locked; ask the coordinator to reopen it.':
    'इस विषय की प्रविष्टि लॉक है; समन्वयक से इसे पुनः खोलने को कहें।',
  'A mark is above the maximum for this subject.': 'कोई अंक इस विषय के अधिकतम से अधिक है।',
  'You are not assigned to this section or subject.':
    'आप इस अनुभाग या विषय के लिए नियुक्त नहीं हैं।',
  'A student in the sheet is no longer in this section; reload.':
    'शीट का कोई विद्यार्थी अब इस अनुभाग में नहीं है; पुनः लोड करें।',
  'You are not allowed to enter marks for this section.':
    'आपको इस अनुभाग के अंक दर्ज करने की अनुमति नहीं है।',
  'Some values were not accepted.': 'कुछ मान स्वीकार नहीं किए गए।',
  Exam: 'परीक्षा',
  'Section · subject': 'अनुभाग · विषय',
  'Open sheet': 'शीट खोलें',
  'Leave a mark empty to skip a pupil; tick AB for absent or EX for exempt. Marks are checked against the maximum and the lock before they are saved.':
    'किसी विद्यार्थी को छोड़ने के लिए अंक खाली रखें; अनुपस्थित के लिए AB या छूट के लिए EX पर टिक करें। सहेजने से पहले अंकों की अधिकतम और लॉक से जाँच होती है।',
  Locked: 'लॉक',
  pupils: 'विद्यार्थी',
  Pupil: 'विद्यार्थी',
  Absent: 'अनुपस्थित',
  Exempt: 'छूट',
  'Save marks': 'अंक सहेजें',
  'This sheet is locked; the coordinator can reopen it.':
    'यह शीट लॉक है; समन्वयक इसे पुनः खोल सकते हैं।',
  // Exam register
  'You are not allowed to open exam registers in this school.':
    'आपको इस विद्यालय में परीक्षा रजिस्टर खोलने की अनुमति नहीं है।',
  'The exam is locked; ask the coordinator to reopen it.':
    'परीक्षा लॉक है; समन्वयक से इसे पुनः खोलने को कहें।',
  'Only the class teacher of this section can fill the register.':
    'केवल इस अनुभाग के कक्षा शिक्षक ही रजिस्टर भर सकते हैं।',
  'Days present cannot exceed the total days.': 'उपस्थित दिन कुल दिनों से अधिक नहीं हो सकते।',
  'You are not allowed to open this section.': 'आपको यह अनुभाग खोलने की अनुमति नहीं है।',
  'remarks, exam attendance, height and weight': 'टिप्पणियाँ, परीक्षा उपस्थिति, ऊँचाई और वज़न',
  'remarks, exam attendance': 'टिप्पणियाँ, परीक्षा उपस्थिति',
  'Class teachers fill the register for their section.':
    'कक्षा शिक्षक अपने अनुभाग का रजिस्टर भरते हैं।',
  Saved: 'सहेजा गया',
  Section: 'अनुभाग',
  'Open register': 'रजिस्टर खोलें',
  'You are not the class teacher of a section in this exam.':
    'आप इस परीक्षा में किसी अनुभाग के कक्षा शिक्षक नहीं हैं।',
  Register: 'रजिस्टर',
  Remark: 'टिप्पणी',
  'Present / total days': 'उपस्थित / कुल दिन',
  'Height cm': 'ऊँचाई सेमी',
  'Weight kg': 'वज़न किग्रा',
  Blood: 'रक्त',
  'last health': 'पिछली स्वास्थ्य जाँच',
  'Days present': 'उपस्थित दिन',
  'Total days': 'कुल दिन',
  Height: 'ऊँचाई',
  Weight: 'वज़न',
  'Blood group': 'रक्त समूह',
  'Save remarks': 'टिप्पणियाँ सहेजें',
  'Save exam attendance': 'परीक्षा उपस्थिति सहेजें',
  'Save height and weight': 'ऊँचाई और वज़न सहेजें',
  'The exam is locked; the coordinator can reopen it.':
    'परीक्षा लॉक है; समन्वयक इसे पुनः खोल सकते हैं।',
  // Lesson plans
  'Lesson plans are written by teaching staff with an employee record.':
    'पाठ योजनाएँ कर्मचारी रिकॉर्ड वाले शिक्षण स्टाफ द्वारा लिखी जाती हैं।',
  'My weekly plans': 'मेरी साप्ताहिक योजनाएँ',
  'Plans go to the coordinator, the vice principal and the principal for approval.':
    'योजनाएँ अनुमोदन के लिए समन्वयक, उप-प्रधानाचार्य और प्रधानाचार्य के पास जाती हैं।',
  'New plan': 'नई योजना',
  'No plans yet. Start with next week.': 'अभी कोई योजना नहीं। अगले सप्ताह से शुरू करें।',
  'Week of': 'सप्ताह',
  Draft: 'प्रारूप',
  'Awaiting approval': 'अनुमोदन की प्रतीक्षा',
  Approved: 'स्वीकृत',
  Rejected: 'अस्वीकृत',
  'Returned for changes': 'बदलाव के लिए लौटाया',
  // Assistant
  'The assistant is not enabled for your role in this school.':
    'इस विद्यालय में आपकी भूमिका के लिए सहायक सक्षम नहीं है।',
  'Ask about your sections': 'अपने अनुभागों के बारे में पूछें',
  'Attendance, absentees, homework, queries and mark entry of the sections you hold. Every answer names the query it came from.':
    'आपके अनुभागों की उपस्थिति, अनुपस्थित विद्यार्थी, गृहकार्य, प्रश्न और अंक प्रविष्टि। हर उत्तर अपने स्रोत क्वेरी का नाम बताता है।',
  You: 'आप',
  rows: 'पंक्तियाँ',
  'Your question': 'आपका प्रश्न',
  'Who was absent today? · Aaj kaun absent hai? · मेरे अनुभाग की उपस्थिति':
    'आज कौन अनुपस्थित था? · Aaj kaun absent hai? · Who was absent today?',
  Language: 'भाषा',
  Auto: 'स्वतः',
  Ask: 'पूछें',
  'New conversation': 'नई बातचीत',
  'What you can ask': 'आप क्या पूछ सकते हैं',
  'Recent conversations': 'हाल की बातचीत',
  turns: 'संदेश',
  'No conversations yet.': 'अभी कोई बातचीत नहीं।',
  // Queries
  'You have no sections assigned, so no family queries reach you.':
    'आपको कोई अनुभाग नियुक्त नहीं है, इसलिए कोई पारिवारिक प्रश्न आप तक नहीं पहुँचता।',
  'Family queries': 'पारिवारिक प्रश्न',
  'waiting for a reply': 'उत्तर की प्रतीक्षा में',
  All: 'सभी',
  Open: 'खुला',
  'In progress': 'प्रक्रिया में',
  Answered: 'उत्तर दिया',
  Closed: 'बंद',
  'No queries.': 'कोई प्रश्न नहीं।',
  query: 'प्रश्न',
  complaint: 'शिकायत',
  leave: 'अवकाश',
};

/** Translates a known English string; unknown strings fall back to English. */
export const t = (lang: Lang, en: string): string => (lang === 'hi' ? (DICT[en] ?? en) : en);
