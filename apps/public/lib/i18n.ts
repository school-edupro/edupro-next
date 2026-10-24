/**
 * The admission portal's own words in English and Hindi (docs/design/42): English by default, Hindi by
 * the `edupro_lang` cookie (lib/lang.ts). The school's form questions and messages stay as written.
 */
export type Lang = 'en' | 'hi';
export const LANG_COOKIE = 'edupro_lang';

const DICT: Record<string, string> = {
  'Admission Portal': 'प्रवेश पोर्टल',
  'Admission portal': 'प्रवेश पोर्टल',
  Home: 'होम',
  'My registrations': 'मेरे पंजीकरण',
  'Apply for a class': 'कक्षा के लिए आवेदन',
  Apply: 'आवेदन',
  'Payments & receipts': 'भुगतान और रसीदें',
  Payments: 'भुगतान',
  Messages: 'संदेश',
  Help: 'सहायता',
  'Main menu': 'मुख्य मेनू',
  'Quick menu': 'त्वरित मेनू',
  Sidebar: 'साइडबार',
  Collapse: 'छोटा करें',
  'Show or hide the menu': 'मेनू दिखाएँ या छिपाएँ',
  'Sign out': 'साइन आउट',
  Admissions: 'प्रवेश',
  'Sign in': 'साइन इन',
  'Sign in to register': 'पंजीकरण के लिए साइन इन करें',
  'One sign-in for all your children’s registrations. Families who registered before can use the registration number.':
    'आपके सभी बच्चों के पंजीकरण के लिए एक ही साइन-इन। जिन परिवारों ने पहले पंजीकरण किया है वे पंजीकरण संख्या का उपयोग कर सकते हैं।',
  'Fill the registration form, pay the registration fee and follow your child’s admission here.':
    'यहाँ पंजीकरण फ़ॉर्म भरें, पंजीकरण शुल्क दें और अपने बच्चे के प्रवेश की प्रगति देखें।',
  'Have a question first?': 'पहले कोई प्रश्न है?',
  'Send an enquiry': 'पूछताछ भेजें',
  'Open for registration': 'पंजीकरण के लिए खुला',
  'No admission session is open at the moment.': 'अभी कोई प्रवेश सत्र खुला नहीं है।',
  'Academic year': 'शैक्षणिक वर्ष',
  'registrations close': 'पंजीकरण बंद',
  Instructions: 'निर्देश',
  'Merit points': 'मेरिट अंक',
  'Registration dates': 'पंजीकरण तिथियाँ',
  'Date of birth': 'जन्म तिथि',
  'Registration fee': 'पंजीकरण शुल्क',
  'No fee': 'कोई शुल्क नहीं',
  from: 'से',
  to: 'तक',
  Open: 'खुला',
  'Opens soon': 'जल्द खुलेगा',
  Closed: 'बंद',
  Seats: 'सीटें',
  'Mobile number, email or registration number': 'मोबाइल नंबर, ईमेल या पंजीकरण संख्या',
  'New here? Use the mobile number or email you want the school to write to.':
    'नए हैं? वह मोबाइल नंबर या ईमेल दें जिस पर विद्यालय आपसे संपर्क करे।',
  'Send code': 'कोड भेजें',
  Code: 'कोड',
  Change: 'बदलें',
  'Checking your browser…': 'ब्राउज़र की जाँच हो रही है…',
  'Sending the code…': 'कोड भेजा जा रहा है…',
  'Signing in…': 'साइन इन हो रहा है…',
  'Enter your mobile number, email or registration number.':
    'अपना मोबाइल नंबर, ईमेल या पंजीकरण संख्या दर्ज करें।',
  'We sent a 6-digit code to': 'हमने 6 अंकों का कोड भेजा है',
  'It works for': 'यह मान्य है',
  minutes: 'मिनट',
  and: 'और',
  you: 'आपको',
  'No code? Mail can take a minute; look in the spam folder too.':
    'कोड नहीं मिला? ईमेल आने में एक मिनट लग सकता है; स्पैम फ़ोल्डर भी देखें।',
  'You can ask for a new code in': 'नया कोड माँग सकते हैं',
  'Send a new code': 'नया कोड भेजें',
  'The school is testing its messages: your code is':
    'विद्यालय अपने संदेशों की जाँच कर रहा है: आपका कोड है',
  'Late-entry passcode': 'देर से प्रवेश पासकोड',
  'Messages and notices': 'संदेश और सूचनाएँ',
  Notices: 'सूचनाएँ',
  'Messages from the school': 'विद्यालय के संदेश',
  English: 'English',
  'Points come from the form’s answers and are checked with the documents; test and interview marks, where there are any, are added. Equal totals: the older child first, then a draw of lots.':
    'अंक फ़ॉर्म के उत्तरों से मिलते हैं और दस्तावेज़ों से जाँचे जाते हैं; जहाँ परीक्षा और साक्षात्कार हैं, उनके अंक जोड़े जाते हैं। बराबर कुल पर बड़ी आयु का बच्चा पहले, फिर लॉटरी।',
};

export const t = (lang: Lang, en: string): string => (lang === 'hi' ? (DICT[en] ?? en) : en);
