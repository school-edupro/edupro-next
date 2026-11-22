import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'menu_hindi.g.dart';

/// The app's words in English and Hindi (the person chooses; Hindi is kept for next time). The menus' words come
/// from the API in English and are put in Hindi from the web apps' own dictionaries (menu_hindi.g.dart).
class S {
  const S(this.hindi);
  final bool hindi;

  String _t(String en, String hi) => hindi ? hi : en;

  /// A menu label or help from the API.
  String menu(String english) => hindi ? (menuHindi[english] ?? english) : english;

  String get appName => 'EduPro';
  String get signInTitle => _t('Sign in', 'साइन इन करें');
  String get signInHelp => _t(
    'Staff: your mobile number or e-mail (not the employee code). Parents: also your child\'s admission number. We send a code to it.',
    'कर्मचारी: अपना मोबाइल नंबर या ई-मेल (कर्मचारी कोड नहीं)। अभिभावक: अपने बच्चे का प्रवेश क्रमांक भी। हम उस पर एक कोड भेजेंगे।',
  );
  String get loginLabel =>
      _t('Mobile number, e-mail or admission number', 'मोबाइल नंबर, ई-मेल या प्रवेश क्रमांक');

  /// the field's own label (short: it sits inside the field on one line)
  String get loginField => _t('Mobile, e-mail or admission no.', 'मोबाइल, ई-मेल या प्रवेश क्रमांक');
  String get sendCode => _t('Send the code', 'कोड भेजें');
  String get codeTitle => _t('Enter the code', 'कोड दर्ज करें');
  String codeSentTo(String to) =>
      _t('We sent a 6-digit code to $to.', 'हमने $to पर 6 अंकों का कोड भेजा है।');
  String get codeSent => _t('We sent you a 6-digit code.', 'हमने आपको 6 अंकों का कोड भेजा है।');
  String codeOnScreen(String code) =>
      _t('Your school shows the code here: $code', 'आपका विद्यालय कोड यहाँ दिखा रहा है: $code');
  String get codeLabel => _t('6-digit code', '6 अंकों का कोड');
  String get verify => _t('Sign in', 'साइन इन करें');
  String get resend => _t('Send a new code', 'नया कोड भेजें');
  String get changeLogin => _t('Use another number', 'दूसरा नंबर इस्तेमाल करें');
  String get enterLogin => _t(
    'Enter your mobile number, e-mail or admission number.',
    'अपना मोबाइल नंबर, ई-मेल या प्रवेश क्रमांक दर्ज करें।',
  );
  String get codeSix => _t('The code has 6 digits.', 'कोड में 6 अंक होते हैं।');
  String get pinTitle => _t('Set an app PIN', 'ऐप पिन बनाएँ');
  String get pinHelp => _t(
    'Choose 4 to 6 digits. You will open the app with this PIN or your fingerprint / face.',
    '4 से 6 अंक चुनें। आप इस पिन या अपने फ़िंगरप्रिंट / चेहरे से ऐप खोलेंगे।',
  );
  String get pinLabel => _t('App PIN', 'ऐप पिन');
  String get pinAgain => _t('The same PIN again', 'वही पिन दोबारा');
  String get pinMismatch => _t('The two PINs are not the same.', 'दोनों पिन एक जैसे नहीं हैं।');
  String get pinSave => _t('Save the PIN', 'पिन सहेजें');
  String get unlockTitle => _t('Open EduPro', 'EduPro खोलें');
  String get unlock => _t('Open', 'खोलें');
  String get useBiometric => _t('Use fingerprint / face', 'फ़िंगरप्रिंट / चेहरा इस्तेमाल करें');
  String get biometricReason => _t('Open EduPro', 'EduPro खोलें');
  String get wrongPin => _t('That PIN is not right.', 'यह पिन सही नहीं है।');
  String get forgotPin => _t('Forgot the PIN? Sign in again', 'पिन भूल गए? फिर से साइन इन करें');
  String get home => _t('Home', 'होम');
  String get more => _t('More', 'अधिक');
  String get profiles => _t('Switch profile', 'प्रोफ़ाइल बदलें');
  String get kindStaff => _t('Staff', 'कर्मचारी');
  String get kindParent => _t('Parent', 'अभिभावक');
  String get kindStudent => _t('Student', 'विद्यार्थी');
  String get noProfiles => _t(
    'Your account has no school profile yet. Please contact the school office.',
    'आपके खाते में अभी कोई विद्यालय प्रोफ़ाइल नहीं है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );
  String welcome(String name) => _t('Welcome, $name', 'स्वागत है, $name');

  // ---- the redesign (look B, navy band): sign-in, code, PIN and the homes ----
  String get tagline => _t('Your school, on your phone', 'आपका विद्यालय, आपके फ़ोन पर');
  String get poweredBy => _t('Powered by', 'संचालन');
  String get signInWelcome => _t('Welcome', 'स्वागत है');
  String get signInLead =>
      _t('Sign in to see your day at school.', 'विद्यालय में अपना दिन देखने के लिए साइन इन करें।');
  String schoolLogo(String school) => _t('$school logo', '$school का लोगो');
  String get otherLanguage => _t('हिन्दी', 'English');
  String get otherLanguageHelp => _t('Show the app in Hindi', 'ऐप अंग्रेज़ी में दिखाएँ');
  String get pinChoose => _t('Choose 4 to 6 digits.', '4 से 6 अंक चुनें।');
  String get pinEnter => _t('Enter your app PIN', 'अपना ऐप पिन दर्ज करें');
  String pinDots(int n, int of) => _t('$n of $of digits entered', '$of में से $n अंक दर्ज');
  String get deleteDigit => _t('Delete the last digit', 'आखिरी अंक मिटाएँ');
  String get numberPad => _t('Number pad', 'अंक पैड');
  String get startAgain => _t('Choose another PIN', 'दूसरा पिन चुनें');

  /// Good morning / afternoon / evening (by the phone's clock).
  String greeting(DateTime now) => now.hour < 12
      ? _t('Good morning', 'सुप्रभात')
      : now.hour < 17
      ? _t('Good afternoon', 'नमस्कार')
      : _t('Good evening', 'शुभ संध्या');
  String get shortcuts => _t('Shortcuts', 'शॉर्टकट');
  String get todaysClasses => _t('Today\'s classes', 'आज की कक्षाएँ');
  String get nowTag => _t('Now', 'अभी');
  String get doneTag => _t('Done', 'हो गया');
  String get substitutionTag => _t('Substitution', 'स्थानापन्न');
  String get markNow => _t('Mark now', 'अभी दर्ज करें');
  String get notMarkedToday =>
      _t('Today\'s attendance is not marked yet', 'आज की उपस्थिति अभी दर्ज नहीं हुई');
  String get todayComing => _t(
    'Today\'s screens arrive in the next update. Everything is under More meanwhile.',
    'आज की स्क्रीन अगले अपडेट में आएँगी। तब तक सब कुछ "और" में है।',
  );
  String get settings => _t('Settings', 'सेटिंग्स');
  String get language => _t('Language', 'भाषा');
  String get signOut => _t('Sign out of this phone', 'इस फ़ोन से साइन आउट करें');
  String get offline => _t(
    'No connection. Check the internet and try again.',
    'कनेक्शन नहीं है। इंटरनेट जाँचें और फिर कोशिश करें।',
  );
  String get retry => _t('Try again', 'फिर कोशिश करें');
  String get loading => _t('Loading…', 'लोड हो रहा है…');
  String get openInBrowser => _t('Open in the browser', 'ब्राउज़र में खोलें');

  // ---- phase B: the family's screens
  String get academics => _t('Academics', 'शैक्षणिक');
  String get fees => _t('Fees', 'फ़ीस');
  String get messages => _t('Messages', 'संदेश');
  String get homework => _t('Homework', 'गृहकार्य');
  String get timetable => _t('Timetable', 'समय-सारणी');
  String get results => _t('Results', 'परिणाम');
  String get attendance => _t('Attendance', 'उपस्थिति');
  String get calendar => _t('Calendar', 'कैलेंडर');
  String get dateSheet => _t('Date sheet', 'परीक्षा तिथि-पत्र');
  String get notices => _t('Notices', 'सूचनाएँ');
  String get queries => _t('Queries to the school', 'विद्यालय से प्रश्न');
  String get saveOrShare => _t('Save or share', 'सहेजें या भेजें');
  String get view => _t('View', 'देखें');
  String get download => _t('Download', 'डाउनलोड');
  String get nothingYet => _t('Nothing here yet.', 'यहाँ अभी कुछ नहीं है।');
  String get seeAll => _t('See all', 'सब देखें');
  String get previous => _t('Previous', 'पिछला');
  String get next => _t('Next', 'अगला');
  String get close => _t('Close', 'बंद करें');
  String get cancel => _t('Cancel', 'रद्द करें');
  String get send => _t('Send', 'भेजें');
  String updatedAt(String at) =>
      _t('No connection. This is the copy from $at.', 'कनेक्शन नहीं है। यह $at की प्रति है।');
  String attachmentN(int n) => _t('Attachment $n', 'संलग्नक $n');

  // home
  String get today => _t('Today', 'आज');
  String get attendanceToday => _t('Attendance today', 'आज की उपस्थिति');
  String get notMarked => _t('Not marked yet', 'अभी दर्ज नहीं');
  String get thisMonth => _t('This month', 'इस माह');
  String presentOf(int present, int days) =>
      _t('$present of $days days present', '$days में से $present दिन उपस्थित');
  // Home's Daily work card (docs/design/96): homework for today or tomorrow and assignments due then
  String get homeworkDue => _t('Daily work', 'दैनिक कार्य');
  String get noHomeworkDue => _t('Nothing for today or tomorrow.', 'आज या कल के लिए कुछ नहीं।');
  String get feesPayable => _t('Fees to pay', 'देय फ़ीस');
  String get nothingDue => _t('Nothing due', 'कुछ बकाया नहीं');
  String get nextExam => _t('Next exam', 'अगली परीक्षा');
  String get noExam => _t('No exam coming up.', 'आगे कोई परीक्षा नहीं।');
  String get latestNotices => _t('Latest notices', 'नवीनतम सूचनाएँ');
  String get unreadMessages => _t('Unread messages', 'अपठित संदेश');

  // attendance and leave
  String attendanceCode(String code) => switch (code) {
    'P' => _t('Present', 'उपस्थित'),
    'A' => _t('Absent', 'अनुपस्थित'),
    'LV' => _t('On leave', 'अवकाश पर'),
    'L' => _t('Late', 'विलंब'),
    'SR' => _t('Short leave', 'अल्प अवकाश'),
    'H' => _t('Half day', 'आधा दिन'),
    'OD' => _t('On duty', 'ड्यूटी पर'),
    'SB' => _t('Stay back', 'रुके रहे'),
    _ => code,
  };
  String get monthTab => _t('Month', 'माह');
  String get yearTab => _t('Year', 'वर्ष');
  String get schoolDays => _t('School days', 'विद्यालय के दिन');
  String get lateOrPart => _t('Late or part of the day', 'विलंब या आंशिक दिन');
  String get presentWord => _t('present', 'उपस्थित');
  String get noAttendanceMonth =>
      _t('No attendance marked in this month.', 'इस माह कोई उपस्थिति दर्ज नहीं।');
  String get noAttendanceYear =>
      _t('No attendance marked in this session yet.', 'इस सत्र में अभी कोई उपस्थिति दर्ज नहीं।');
  String get dayByDay => _t(
    'Day by day, with gate in and out times',
    'दिन-प्रतिदिन, गेट पर आने और जाने के समय के साथ',
  );
  String gateIn(String t) => _t('In $t', 'आए $t');
  String gateOut(String t) => _t('Out $t', 'गए $t');
  String get schoolBus => _t('School bus', 'स्कूल बस');
  String busTrips(int onBus, int trips) =>
      _t('$onBus/$trips trips on the bus', '$trips में से $onBus यात्राएँ बस में');
  String get morning => _t('Morning', 'सुबह');
  String get afternoon => _t('Afternoon', 'दोपहर');
  String busCode(String code) => switch (code) {
    'P' => _t('On the bus', 'बस में'),
    'A' => _t('Not on the bus', 'बस में नहीं'),
    'LV' => _t('On leave', 'अवकाश पर'),
    'GP' => _t('Gate pass', 'गेट पास'),
    'OT' => _t('Other arrangement', 'अन्य व्यवस्था'),
    _ => code,
  };
  String get route => _t('Route', 'मार्ग');
  String get monthByMonth => _t('Month by month', 'माह-दर-माह');
  String get monthBarsLabel => _t(
    'Attendance month by month; the list below has the same numbers',
    'माह-दर-माह उपस्थिति; नीचे की सूची में यही संख्याएँ हैं',
  );
  String monthLine(int days, int present, int absent, int leave, int late) => _t(
    '${daysN(days)} · Present $present · Absent $absent · Leave $leave · Late $late',
    '${daysN(days)} · उपस्थित $present · अनुपस्थित $absent · अवकाश $leave · विलंब $late',
  );
  String leaveRule(int days) => _t(
    'A leave of up to $days day(s) is approved by the class teacher; a longer one also goes to the '
        'coordinator and the principal. An approved leave is marked in class and bus attendance by itself.',
    '$days दिन तक का अवकाश कक्षा अध्यापक स्वीकृत करते हैं; उससे लंबा अवकाश समन्वयक और प्रधानाचार्य के पास '
        'भी जाता है। स्वीकृत अवकाश कक्षा और बस की उपस्थिति में अपने आप दर्ज हो जाता है।',
  );
  String get leavesThisSession => _t('Leave applied in this session', 'इस सत्र में आवेदित अवकाश');
  String get noLeaveYet => _t('No leave has been applied for yet.', 'अभी तक कोई अवकाश आवेदन नहीं।');
  String get longLeave => _t('long leave', 'लंबा अवकाश');
  String noteFromSchool(String n) => _t('Note from the school: $n', 'विद्यालय की टिप्पणी: $n');
  String endedEarly(String d) =>
      _t('Ended early: back at school from $d', 'पहले समाप्त: $d से विद्यालय में');
  String withWhom(String who) => _t('With: $who', '$who के पास');
  String get endLeaveToday =>
      _t('Child is back: end the leave today', 'बच्चा लौट आया: अवकाश आज समाप्त करें');
  String get endLeaveAsk => _t('End this leave from today?', 'क्या यह अवकाश आज से समाप्त करें?');
  String get certificateFile => _t(
    'Certificate or letter (PDF or photo, up to 5 MB)',
    'प्रमाण-पत्र या पत्र (PDF या फ़ोटो, 5 MB तक)',
  );
  String removeFile(String name) => _t('Remove $name', '$name हटाएँ');
  String get certAlways => _t('certificate always needed', 'प्रमाण-पत्र हमेशा चाहिए');
  String certLong(int days) => _t(
    'certificate needed for more than $days day(s)',
    '$days दिन से अधिक के लिए प्रमाण-पत्र चाहिए',
  );
  String get addCertificate => _t('Add the certificate or letter.', 'प्रमाण-पत्र या पत्र जोड़ें।');
  String get leaveFileTooBig =>
      _t('Each file must be 5 MB or smaller.', 'हर फ़ाइल 5 MB या उससे छोटी होनी चाहिए।');
  String get leaveFileType =>
      _t('Send a PDF, JPG, PNG or WebP file.', 'PDF, JPG, PNG या WebP फ़ाइल भेजें।');
  String get leaves => _t('Leave', 'अवकाश');
  String get applyLeave => _t('Apply for leave', 'अवकाश के लिए आवेदन करें');
  String get leaveType => _t('Kind of leave', 'अवकाश का प्रकार');
  String get fromDate => _t('First day', 'पहला दिन');
  String get toDate => _t('Last day', 'आखिरी दिन');
  String get reason => _t('Reason', 'कारण');
  String get reasonShort =>
      _t('Write the reason (at least 5 letters).', 'कारण लिखें (कम से कम 5 अक्षर)।');
  String get chooseLeaveType => _t('Choose the kind of leave.', 'अवकाश का प्रकार चुनें।');
  String get leaveSent => _t('Leave application sent.', 'अवकाश का आवेदन भेजा गया।');
  String get cancelLeave => _t('Cancel this leave', 'यह अवकाश रद्द करें');
  String get cancelLeaveAsk =>
      _t('Cancel this leave application?', 'क्या यह अवकाश का आवेदन रद्द करें?');
  String get leaveCancelled => _t('Leave cancelled.', 'अवकाश रद्द किया गया।');
  String get certificateNeeded => _t(
    'This leave needs a certificate or letter: add it below.',
    'इस अवकाश के लिए प्रमाण-पत्र या पत्र चाहिए: नीचे जोड़ें।',
  );
  String get applyOnWeb => _t('Apply on the web page', 'वेब पेज पर आवेदन करें');
  String leaveStatus(String status) => switch (status) {
    'pending' => _t('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'approved' => _t('Approved', 'स्वीकृत'),
    'rejected' => _t('Not approved', 'स्वीकृत नहीं'),
    'cancelled' => _t('Cancelled', 'रद्द'),
    _ => status,
  };
  String daysN(int n) => _t(n == 1 ? '1 day' : '$n days', '$n दिन');

  // homework and notices
  String workKind(String kind) => switch (kind) {
    'classwork' => _t('Classwork', 'कक्षा-कार्य'),
    'assignment' => _t('Assignment', 'असाइनमेंट'),
    _ => _t('Homework', 'गृहकार्य'),
  };
  String dueOn(String date) => _t('Due $date', 'जमा करें $date');
  String postedBy(String name) => _t('By $name', '$name द्वारा');
  String get acknowledge => _t('I have seen this', 'मैंने यह देख लिया');
  // messages, notices, calendar, directory
  String get messagesTitle => _t('Messages from school', 'विद्यालय से संदेश');
  String get messagesHelp => _t(
    'SMS, WhatsApp and email the school sent you',
    'विद्यालय ने आपको भेजे SMS, WhatsApp और ईमेल',
  );
  String channel(String c) => switch (c) {
    'sms' => 'SMS',
    'whatsapp' => 'WhatsApp',
    'email' => _t('Email', 'ईमेल'),
    'app' => _t('App', 'ऐप'),
    _ => c,
  };
  String deliveryState(String st) => switch (st) {
    'delivered' => _t('Delivered', 'पहुँच गया'),
    'sent' || 'sending' => _t('Sent', 'भेजा गया'),
    'queued' => _t('Queued', 'कतार में'),
    'failed' => _t('Failed', 'नहीं पहुँचा'),
    'read' => _t('Read on WhatsApp', 'WhatsApp पर पढ़ा गया'),
    _ => st,
  };
  String get openEmail => _t('Open the email', 'ईमेल खोलें');
  String get noMessagesYet => _t('No messages yet.', 'अभी कोई संदेश नहीं।');
  String get noticesTitle => _t('Notices and circulars', 'सूचनाएँ और परिपत्र');
  String noticesCount(int n, bool filtered, int toAck) =>
      '${filtered ? _t('$n found', '$n मिले') : _t('$n in all', 'कुल $n')} · ${_t('latest first', 'नवीनतम पहले')}'
      '${toAck > 0 ? ' · ${_t('$toAck to acknowledge', '$toAck की पावती बाकी')}' : ''}';
  String get noticeKindAll => _t('All', 'सभी');
  String get circulars => _t('Circulars', 'परिपत्र');
  String noticeKind(String k) => switch (k) {
    'circular' => _t('Circular', 'परिपत्र'),
    'office_order' => _t('Office order', 'कार्यालय आदेश'),
    _ => _t('Notice', 'सूचना'),
  };
  String get wordsInNotice => _t('Words in the notice', 'सूचना के शब्द');
  String get noNoticesNow => _t('No notices right now.', 'अभी कोई सूचना नहीं।');
  String attachmentsN(int n) => _t('$n attachments', '$n संलग्नक');
  String get toAcknowledge => _t('Acknowledge', 'पावती दें');
  String get holidayList => _t('Holiday list', 'अवकाश सूची');
  String sessionSpan(String from, String to) => _t('Session: $from – $to', 'सत्र: $from – $to');
  String nextHoliday(String what) => _t('Next holiday: $what', 'अगला अवकाश: $what');
  String calMark(String m) => switch (m) {
    'holiday' => _t('Holiday', 'अवकाश'),
    'vacation' => _t('Vacation', 'छुट्टियाँ'),
    'working_day' => _t('Working day', 'कार्य दिवस'),
    'exam' => _t('Exam', 'परीक्षा'),
    _ => _t('Event', 'कार्यक्रम'),
  };
  String get nothingOnDay =>
      _t('Nothing is scheduled on this day.', 'इस दिन कुछ निर्धारित नहीं है।');
  String get nothingScheduled => _t('Nothing scheduled', 'कुछ निर्धारित नहीं');
  String holidaysThisSession(int n, int days) =>
      _t('$n holidays this session · $days days in all', 'इस सत्र में $n अवकाश · कुल $days दिन');
  String get upcoming => _t('Upcoming', 'आने वाले');
  String get earlierThisYear => _t('Earlier this year', 'इस वर्ष पहले');
  String get calendarColours => _t('Colours', 'रंग');
  String get directoryTitle => _t('School directory', 'विद्यालय निर्देशिका');
  String get directoryHelp =>
      _t('Whom to contact at the school, and when.', 'विद्यालय में किससे और कब संपर्क करें।');
  String get directoryEmpty => _t(
    'The school has not published its directory yet.',
    'विद्यालय ने अभी अपनी निर्देशिका प्रकाशित नहीं की है।',
  );
  String get timings => _t('Timings', 'समय');

  // health
  String get healthTitle =>
      _t('Clinic visits and health cards', 'क्लिनिक विज़िट और स्वास्थ्य कार्ड');
  String healthCount(int n, bool filtered) => filtered
      ? _t('$n found · latest first', '$n मिले · नवीनतम पहले')
      : _t('$n in all · latest first', 'कुल $n · नवीनतम पहले');
  String get clinicVisits => _t('Clinic visits', 'क्लिनिक विज़िट');
  String get healthCards => _t('Health check-up cards', 'स्वास्थ्य जाँच कार्ड');
  String get fromWord => _t('From', 'से');
  String get healthSearch => _t('Complaint, treatment or remark', 'शिकायत, उपचार या टिप्पणी');
  String get nothingMatches => _t('Nothing matches these filters.', 'इन फ़िल्टर से कुछ नहीं मिला।');
  String get healthNothingYet => _t(
    'Nothing yet. Clinic visits show here, and the health card once the school doctor publishes it.',
    'अभी कुछ नहीं। क्लिनिक विज़िट यहाँ दिखती हैं, और स्वास्थ्य कार्ड विद्यालय के डॉक्टर के प्रकाशित करने पर।',
  );
  String outcome(String o) => switch (o) {
    'back_to_class' => _t('Back to class', 'कक्षा में लौटे'),
    'rest' => _t('Resting in the clinic', 'क्लिनिक में आराम'),
    'sent_home' => _t('Sent home', 'घर भेजा गया'),
    'referred' => _t('Referred', 'रेफ़र किया गया'),
    _ => o,
  };
  String medicineGiven(String list) => _t('Medicine given: $list', 'दी गई दवा: $list');
  String get clinicVisit => _t('Clinic visit', 'क्लिनिक विज़िट');
  String get healthCheckUp => _t('Health check-up', 'स्वास्थ्य जाँच');
  String get healthCardWord => _t('Health card', 'स्वास्थ्य कार्ड');
  String get seeDoctor => _t('Please see a doctor', 'कृपया डॉक्टर को दिखाएँ');
  String heightCm(String x) => _t('Height $x cm', 'ऊँचाई $x सेमी');
  String weightKg(String x) => _t('Weight $x kg', 'वज़न $x किग्रा');
  String bloodGroupIs(String x) => _t('Blood group $x', 'रक्त समूह $x');
  String get healthCardPdf => _t('Health card (PDF)', 'स्वास्थ्य कार्ड (PDF)');
  String pageOf(int n, int m) => _t('Page $n / $m', 'पृष्ठ $n / $m');
  String get timeIn => _t('Time in', 'आने का समय');
  String get timeOut => _t('Time out', 'जाने का समय');
  String get stillInClinic => _t('Still in the clinic', 'अभी क्लिनिक में');
  String get clinicLabel => _t('Clinic', 'क्लिनिक');
  String get nurse => _t('Nurse', 'नर्स');
  String get complaintExam => _t('Complaint and examination', 'शिकायत और जाँच');
  String get complaint => _t('Complaint', 'शिकायत');
  String get disease => _t('Disease', 'रोग');
  String get temperature => _t('Temperature', 'तापमान');
  String get pulse => _t('Pulse', 'नब्ज़');
  String get bloodPressure => _t('Blood pressure', 'रक्तचाप');
  String get weightLabel => _t('Weight', 'वज़न');
  String get doctorFound => _t('What the doctor found', 'डॉक्टर ने क्या पाया');
  String get treatmentTitle => _t('Treatment', 'उपचार');
  String get treatmentGiven => _t('Treatment given', 'दिया गया उपचार');
  String get prescription => _t('Prescription', 'नुस्ख़ा');
  String get referredTo => _t('Referred to', 'रेफ़र किया गया');
  String get medicinesGiven => _t('Medicines given', 'दी गई दवाएँ');
  String get medicine => _t('Medicine', 'दवा');
  String get quantity => _t('Quantity', 'मात्रा');
  String get dosage => _t('Dosage', 'खुराक');
  String get schoolAsks => _t('What the school asks of you', 'विद्यालय आपसे क्या चाहता है');
  String get advice => _t('Advice', 'सलाह');
  String referredText(String to) => _t(
    'The school clinic referred your child to $to.',
    'विद्यालय क्लिनिक ने आपके बच्चे को $to रेफ़र किया।',
  );
  String get sentHomeText =>
      _t('The school clinic sent your child home.', 'विद्यालय क्लिनिक ने आपके बच्चे को घर भेजा।');
  String get doctorLabel => _t('Doctor', 'डॉक्टर');
  String get recordedByClinic =>
      _t('Recorded by the school clinic.', 'विद्यालय क्लिनिक द्वारा दर्ज।');
  String get healthCheckUpCard => _t('Health check-up card', 'स्वास्थ्य जाँच कार्ड');
  String get dateOfBirth => _t('Date of birth', 'जन्म तिथि');
  String get examinedOn => _t('Examined on', 'जाँच की तारीख़');
  String get place => _t('Place', 'स्थान');
  String get remarksForParents => _t('Remarks for the parents', 'अभिभावकों के लिए टिप्पणी');
  String get seeDoctorAbout => _t(
    'Please see a doctor or specialist about the points above.',
    'ऊपर की बातों के लिए कृपया डॉक्टर या विशेषज्ञ को दिखाएँ।',
  );
  String get schoolDoctor => _t('School doctor', 'विद्यालय डॉक्टर');
  String get signatureLabel => _t('Signature', 'हस्ताक्षर');
  String get notCertificate => _t(
    'This card records a school health check-up. It is not a medical certificate.',
    'यह कार्ड विद्यालय की स्वास्थ्य जाँच का रिकॉर्ड है। यह मेडिकल प्रमाण-पत्र नहीं है।',
  );

  // certificates
  String get certsHelp => _t(
    'Certificates from the school, your requests, and asking for a new one.',
    'विद्यालय के प्रमाण-पत्र, आपके अनुरोध, और नया माँगना।',
  );
  String get readyFig => _t('Ready', 'तैयार');
  String get inProgress => _t('In progress', 'प्रक्रिया में');
  String get toPayFig => _t('To pay', 'भुगतान बाकी');
  String get canAskFig => _t('You can ask for', 'माँग सकते हैं');
  String get yourCertificates => _t('Your certificates', 'आपके प्रमाण-पत्र');
  String get awardTag => _t('Award', 'पुरस्कार');
  String duplicateN(int n) => _t('duplicate $n', 'प्रतिलिपि $n');
  String revisionN(int n) => _t('Revision $n', 'संशोधन $n');
  String get noCertificates => _t('No certificates yet.', 'अभी कोई प्रमाण-पत्र नहीं।');
  String get askBelow => _t('You can ask for one below.', 'आप नीचे से माँग सकते हैं।');
  String get requestsTitle => _t('Requests', 'अनुरोध');
  String get noRequestInProgress => _t('No request in progress.', 'कोई अनुरोध प्रक्रिया में नहीं।');
  String earlierRequests(int n) => _t('Earlier requests ($n)', 'पिछले अनुरोध ($n)');
  String askedOn(String d) => _t('Asked on $d', '$d को माँगा');
  String copiesN(int n) => _t('$n copies', '$n प्रतियाँ');
  String certStep(String step) => switch (step) {
    'Asked' => _t('Asked', 'माँगा'),
    'Approved' => _t('Approved', 'स्वीकृत'),
    'Fee' => _t('Fee', 'शुल्क'),
    'Being made' => _t('Being made', 'बन रहा है'),
    _ => _t('Ready', 'तैयार'),
  };
  String get whereRequestIs => _t('Where the request is', 'अनुरोध कहाँ है');
  String get notApproved => _t('Not approved', 'स्वीकृत नहीं');
  String get withdrawnTag => _t('Withdrawn', 'वापस लिया');
  String get underYourCerts =>
      _t('It is under Your certificates.', 'यह आपके प्रमाण-पत्रों में है।');
  String payFee(String amount) => _t('Pay the fee $amount', 'शुल्क दें $amount');
  String get withdrawRequestAsk => _t('Withdraw this request?', 'क्या यह अनुरोध वापस लें?');
  String get askTitle => _t('Ask for a certificate', 'प्रमाण-पत्र माँगें');
  String tapToAsk(String name) => _t(
    'Tap a certificate to ask for it for $name.',
    '$name के लिए माँगने को प्रमाण-पत्र पर टैप करें।',
  );
  String get findCertificate => _t('Find a certificate', 'प्रमाण-पत्र खोजें');
  String get noCertMatches => _t('No certificate matches.', 'कोई प्रमाण-पत्र नहीं मिला।');
  String decidedBy(List<String> who) {
    final words = (who.isEmpty ? ['the school'] : who).map(
      (w) => hindi
          ? switch (w) {
              'the school' => 'विद्यालय',
              'the office' => 'कार्यालय',
              'the class teacher' => 'कक्षा अध्यापक',
              'the principal' => 'प्रधानाचार्य',
              'the coordinator' => 'समन्वयक',
              _ => w,
            }
          : w,
    );
    return _t('Decided by ${words.join(', then ')}', 'निर्णय: ${words.join(', फिर ')}');
  }

  String forPurposes(String list) => _t('For: $list', 'किसके लिए: $list');
  String aCopy(String amount) => _t('$amount a copy', '$amount प्रति प्रति');
  String get freeWord => _t('Free', 'निःशुल्क');
  String get purposeLabel => _t('Purpose', 'उद्देश्य');
  String get purposeHint => _t('For example: bank account, passport', 'जैसे: बैंक खाता, पासपोर्ट');
  String get copiesLabel => _t('Copies', 'प्रतियाँ');
  String get noteForSchool =>
      _t('A note for the school (optional)', 'विद्यालय के लिए टिप्पणी (वैकल्पिक)');
  String feeHelp(String amount) => _t(
    'Fee: $amount a copy — to pay once the school approves it.',
    'शुल्क: $amount प्रति प्रति — विद्यालय की स्वीकृति के बाद देना है।',
  );
  String get noFee => _t('No fee.', 'कोई शुल्क नहीं।');
  String get requestSentCert => _t(
    'Your request is sent to the school. You will see here when it is ready.',
    'आपका अनुरोध विद्यालय को भेज दिया गया है। तैयार होने पर यहाँ दिखेगा।',
  );
  String get purposeNeeded => _t('Write the purpose.', 'उद्देश्य लिखें।');
  String get certPdfFailed => _t('The PDF could not be made.', 'PDF नहीं बन सका।');

  // timetable, shared papers, date sheet
  String get weekTab => _t('Week', 'सप्ताह');
  String get dayTab => _t('Day', 'दिन');
  String schoolDaysAWeek(int n) => _t('$n school days a week', 'सप्ताह में $n विद्यालय दिवस');
  String get timetableNotPublished =>
      _t('The timetable has not been published yet.', 'समय-सारिणी अभी प्रकाशित नहीं हुई है।');
  String get periodLabel => _t('Period', 'कालांश');
  String get weekTimetableLabel => _t('The week\'s timetable', 'सप्ताह की समय-सारिणी');
  String get docsTitle =>
      _t('Session plan, curriculum and date sheets', 'सत्र योजना, पाठ्यक्रम और डेट शीट');
  String get docsHelp => _t(
    'What the teachers and the school shared for this session.',
    'इस सत्र के लिए शिक्षकों और विद्यालय ने जो साझा किया।',
  );
  String get allKinds => _t('All', 'सभी');
  String get forTheClass => _t('For the class', 'कक्षा के लिए');
  String get fromTheSchool => _t('From the school', 'विद्यालय से');
  String get nothingShared => _t('Nothing has been shared yet.', 'अभी कुछ साझा नहीं किया गया है।');
  String get dateSheetHelp =>
      _t('The papers of each exam: date, day and time.', 'हर परीक्षा के पेपर: तारीख़, दिन और समय।');
  String nextPaperLine(String text) => _t('Next paper: $text', 'अगला पेपर: $text');
  String get noDateSheet => _t('No date sheet yet.', 'अभी कोई डेट शीट नहीं।');
  String earlierExams(int n) => _t('Earlier exams ($n)', 'पिछली परीक्षाएँ ($n)');
  String get timeLabel => _t('Time', 'समय');
  String get homeworkAndClasswork => _t('Homework and classwork', 'गृहकार्य और कक्षा-कार्य');
  String get assignmentsTab => _t('Assignments', 'असाइनमेंट');
  String get daysWithWork => _t('Days with work', 'कार्य वाले दिन');
  String get nothingToday =>
      _t('Nothing has been published for today yet.', 'आज के लिए अभी कुछ प्रकाशित नहीं हुआ है।');
  String get nothingThatDay => _t('Nothing was posted on this day.', 'इस दिन कुछ नहीं दिया गया।');
  String get generalSubject => _t('General', 'सामान्य');
  String dueShort(String d) => _t('due $d', 'जमा $d');
  String get overdueWord => _t('overdue', 'अतिदेय');
  String publishedAt(String d) => _t('Published $d', 'प्रकाशित $d');
  String givenOn(String d) => _t('given $d', 'दिया $d');
  String get givenFrom => _t('Given from', 'कब से दिया');
  String get givenTo => _t('To', 'तक');
  String get clearDates => _t('Clear', 'हटाएँ');
  String get toDo => _t('To do', 'करना है');
  String get pastDueDate => _t('Past the due date', 'जमा तिथि निकल गई');
  String get noPendingAssignment => _t('No assignment is pending.', 'कोई असाइनमेंट बाकी नहीं है।');
  String chooseDay(String d) => _t('Day: $d', 'दिन: $d');
  String get acknowledged => _t('Seen', 'देख लिया');
  String get pinned => _t('Pinned', 'पिन की गई');
  String get loadMore => _t('Show more', 'और दिखाएँ');

  // timetable, calendar, date sheet
  String get breakTime => _t('Break', 'अवकाश');
  String get holidays => _t('Holidays', 'अवकाश');
  String get events => _t('Events', 'कार्यक्रम');

  // results
  String get reportCard => _t('Report card', 'रिपोर्ट कार्ड');
  String get reportCardPdf => _t('Report card (PDF)', 'रिपोर्ट कार्ड (PDF)');
  String get pdfLate => _t(
    'The PDF is still being made. Try again in a minute.',
    'PDF अभी बन रहा है। एक मिनट बाद फिर कोशिश करें।',
  );
  String get pdfFailed => _t('The PDF could not be made.', 'PDF नहीं बन सका।');
  String get withheld => _t(
    'The school has held this report card back. Please contact the school.',
    'विद्यालय ने यह रिपोर्ट कार्ड रोका है। कृपया विद्यालय से संपर्क करें।',
  );
  String get heldForFees => _t(
    'This report card opens when the fees due are paid.',
    'बकाया शुल्क जमा होने पर यह रिपोर्ट कार्ड खुलेगा।',
  );
  String rank(int r) => _t('Rank $r', 'स्थान $r');

  // fees
  String get payableNow => _t('To pay now', 'अभी देय');
  String get balance => _t('Balance for the year', 'वर्ष का बकाया');
  String get paid => _t('Paid', 'भुगतान हुआ');
  String get payNow => _t('Pay online', 'ऑनलाइन भुगतान');
  String get instalments => _t('Instalments', 'किस्तें');
  String get receipts => _t('Receipts', 'रसीदें');
  String receiptNo(String no) => _t('Receipt $no', 'रसीद $no');
  String get feeBill => _t('Fee bill', 'फ़ीस बिल');
  String get taxCertificate => _t('Fee certificate for tax', 'कर हेतु शुल्क प्रमाण-पत्र');
  String instalmentStatus(String status) => switch (status) {
    'paid' => _t('Paid', 'भुगतान हुआ'),
    'overdue' => _t('Overdue', 'अतिदेय'),
    'due' => _t('Due', 'देय'),
    _ => _t('Upcoming', 'आगामी'),
  };
  String lateFee(String amount) => _t('Late fee $amount', 'विलंब शुल्क $amount');
  String get paymentDone =>
      _t('Payment received. The receipt is below.', 'भुगतान मिल गया। रसीद नीचे है।');
  String get paymentNotDone => _t(
    'The payment did not go through. No money was taken, or it comes back.',
    'भुगतान नहीं हुआ। पैसा नहीं कटा, या वापस आ जाएगा।',
  );
  String get noFees =>
      _t('No fee statement for this year yet.', 'इस वर्ष का शुल्क विवरण अभी नहीं है।');

  // ---- Fees in the app, as the web Fees page (no web page; docs/design/89 "Fees in the app") ----
  String get dueNow => _t('Due now', 'अभी देय');
  String get lateFeeIncluded => _t('Late fee included', 'विलंब शुल्क सहित');
  String get schoolFee => _t('School fee', 'विद्यालय शुल्क');
  String get hostelFee => _t('Hostel fee', 'छात्रावास शुल्क');
  String get otherFees => _t('Other fees', 'अन्य शुल्क');
  String get feeSections => _t('Fee sections', 'शुल्क के भाग');
  String payPlan(String plan) => _t(
    'Pay plan: ${switch (plan) {
      'monthly' => 'Monthly',
      'quarterly' => 'Quarterly',
      'half_yearly' => 'Half-yearly',
      _ => 'Yearly',
    }}',
    'भुगतान योजना: ${switch (plan) {
      'monthly' => 'मासिक',
      'quarterly' => 'त्रैमासिक',
      'half_yearly' => 'अर्धवार्षिक',
      _ => 'वार्षिक',
    }}',
  );
  String get hosteller => _t('Hosteller', 'छात्रावासी');
  String transportOf(String route) => _t('Transport: $route', 'परिवहन: $route');
  String discountOf(String list) => _t('Discount: $list', 'छूट: $list');
  String get oldestFirst => _t(
    'Tick the instalments to pay. They are paid the oldest first, so a tick takes the earlier ones with it.',
    'जिन किस्तों का भुगतान करना है उन पर टिक करें। पहले सबसे पुरानी किस्त चुकाई जाती है, इसलिए एक टिक पिछली किस्तों को भी साथ ले लेता है।',
  );
  String feeOf(String amount) => _t('Fee $amount', 'शुल्क $amount');
  String paidOf(String amount) => _t('Paid $amount', 'भुगतान $amount');
  String get counterOnly =>
      _t('Paid at the school fee counter only.', 'केवल विद्यालय के शुल्क काउंटर पर जमा होगा।');
  String payInstalment(String label) => _t('Pay $label', '$label का भुगतान');
  String get payThrough => _t('Pay through', 'भुगतान का माध्यम');
  String convenienceCharge(String what) => _t('Convenience charge $what', 'सुविधा शुल्क $what');
  String get noCharge => _t('No convenience charge', 'कोई सुविधा शुल्क नहीं');
  String get totalToPay => _t('Total to pay', 'कुल देय');
  String feePlusCharge(String fee, String charge) =>
      _t('$fee + convenience charge $charge', '$fee + सुविधा शुल्क $charge');
  String payAmount(String amount) => _t('Pay $amount', '$amount का भुगतान करें');
  String get tickToPay => _t('Tick an instalment to pay', 'भुगतान के लिए किस्त पर टिक करें');
  String get noGateway => _t(
    'Online payment is not open for this fee yet. Please pay at the school fee counter.',
    'इस शुल्क के लिए ऑनलाइन भुगतान अभी खुला नहीं है। कृपया विद्यालय के शुल्क काउंटर पर जमा करें।',
  );
  String get laterInstalments => _t(
    'Later instalments appear when the school opens them.',
    'आगे की किस्तें विद्यालय द्वारा खोले जाने पर दिखेंगी।',
  );
  String get noDemand =>
      _t('No fee demand has been raised yet.', 'अभी कोई शुल्क माँग नहीं बनी है।');
  String inHostel(String from, String to) =>
      _t('In the hostel: $from – $to', 'छात्रावास में: $from – $to');
  String get sessionStart => _t('session start', 'सत्र का आरंभ');
  String get sessionEnd => _t('session end', 'सत्र का अंत');
  String get miscHelpPay => _t(
    'Fees announced by the school for a trip, an activity or a form. Pay online in full, or at the school fee counter.',
    'यात्रा, गतिविधि या फ़ॉर्म के लिए विद्यालय द्वारा घोषित शुल्क। पूरा ऑनलाइन भुगतान करें, या विद्यालय के शुल्क काउंटर पर।',
  );
  String get miscHelpCounter => _t(
    'Fees announced by the school for a trip, an activity or a form. They are paid at the school fee counter.',
    'यात्रा, गतिविधि या फ़ॉर्म के लिए विद्यालय द्वारा घोषित शुल्क। ये विद्यालय के शुल्क काउंटर पर जमा होते हैं।',
  );
  String get noOtherFees => _t('No other fees.', 'कोई अन्य शुल्क नहीं।');
  String lastDate(String d) => _t('Last date $d', 'अंतिम तिथि $d');
  String amountOf(String a) => _t('Amount $a', 'राशि $a');
  String get mandatory => _t('Mandatory', 'अनिवार्य');
  String get optional => _t('Optional', 'वैकल्पिक');
  String seatsOf(int taken, int of) => _t('Seats $taken/$of', 'सीटें $taken/$of');
  String toPayOf(String a) => _t('To pay $a', 'देय $a');
  String payOnlineOf(String a) => _t('Pay online $a', 'ऑनलाइन भुगतान $a');
  String get noReceipts => _t('No receipts yet.', 'अभी कोई रसीद नहीं।');
  String get bounced => _t('Bounced', 'अनादृत');
  String refundedOf(String a) => _t('Refunded $a', 'वापस किया $a');
  String partlyRefundedOf(String a) => _t('Partly refunded $a', 'आंशिक वापसी $a');
  String get cancelledTag => _t('Cancelled', 'रद्द');
  String clearedOn(String d) => _t('Cleared $d', 'समाशोधित $d');
  String get settled => _t('Settled', 'निपटाया गया');
  String get onlinePayments => _t('Online payments', 'ऑनलाइन भुगतान');
  String receiptsOf(int n) =>
      _t(n == 1 ? '1 receipt' : '$n receipts', n == 1 ? '1 रसीद' : '$n रसीदें');
  String receivedOf(String amount) => _t('$amount received', '$amount प्राप्त');
  String intentStatus(String status) => switch (status) {
    'succeeded' => _t('Paid', 'भुगतान हुआ'),
    'failed' => _t('Failed', 'असफल'),
    'expired' => _t('Expired', 'समाप्त'),
    'cancelled' => _t('Cancelled', 'रद्द'),
    _ => _t('Waiting', 'प्रतीक्षा में'),
  };
  String get receiptPdf => _t('Receipt PDF', 'रसीद PDF');
  String get billAll => _t('All', 'सभी');
  String get billRegular => _t('Regular', 'नियमित');
  String get billHostel => _t('Hostel', 'छात्रावास');
  String get billNo => _t('Bill no.', 'बिल सं.');
  String get billDate => _t('Bill date', 'बिल तिथि');
  String get sessionLabel => _t('Session', 'सत्र');
  String get studentLabel => _t('Student', 'विद्यार्थी');
  String get admissionNoLabel => _t('Admission no.', 'प्रवेश क्रमांक');
  String get classLabel => _t('Class', 'कक्षा');
  String get guardianLabel => _t('Parent / guardian', 'अभिभावक');
  String get routeLabel => _t('Transport route', 'परिवहन मार्ग');
  String get feeForSession => _t('Fee for the session', 'सत्र का शुल्क');
  String get discountLabel => _t('Discount', 'छूट');
  String get optionalHead => _t('optional', 'वैकल्पिक');
  String scheduleOf(String ledger) => ledger == 'hostel'
      ? _t('Hostel fee instalments', 'छात्रावास शुल्क की किस्तें')
      : _t('School fee instalments', 'विद्यालय शुल्क की किस्तें');
  String get payableCol => _t('Payable', 'देय');
  String get balanceCol => _t('Balance', 'शेष');
  String get summary => _t('Summary', 'सारांश');
  String get dueLabel => _t('Due', 'देय');
  String get receivedLabel => _t('Received', 'प्राप्त');
  String get refundLabel => _t('Refund', 'वापसी');
  String get advanceLabel => _t('Advance', 'अग्रिम');
  String get balanceLabel => _t('Balance', 'शेष');
  String get billNotMade => _t(
    'The fee bill could not be made. Please try again.',
    'फ़ीस बिल नहीं बन सका। फिर कोशिश करें।',
  );
  String get financialYear => _t('Financial year', 'वित्तीय वर्ष');
  String get issuedOn => _t('Issued on', 'जारी तिथि');
  String get taxHelp => _t(
    'Tuition fee paid in a financial year, for your income-tax return.',
    'आयकर रिटर्न के लिए, एक वित्तीय वर्ष में जमा ट्यूशन शुल्क।',
  );
  String get taxCertifies => _t(
    'This is to certify that the following fee has been received by the school for the above student during the financial year.',
    'प्रमाणित किया जाता है कि उपरोक्त विद्यार्थी के लिए वित्तीय वर्ष में विद्यालय को निम्न शुल्क प्राप्त हुआ है।',
  );
  String get noTaxFee => _t(
    'No fee that counts for the certificate was received in this year.',
    'इस वर्ष प्रमाण-पत्र में गिना जाने वाला कोई शुल्क प्राप्त नहीं हुआ।',
  );
  String get totalLabel => _t('Total', 'कुल');
  String get amountInWords => _t('Amount in words', 'शब्दों में राशि');
  String get computerMade => _t(
    'A computer-generated certificate from the school’s fee records.',
    'विद्यालय के शुल्क अभिलेखों से कंप्यूटर द्वारा बना प्रमाण-पत्र।',
  );
  String get taxNotAvailable => _t(
    'The certificate is not available. Please contact the school office.',
    'प्रमाण-पत्र उपलब्ध नहीं है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );
  String get paying => _t('Pay', 'भुगतान');
  String get cancelPayment => _t('Stop paying?', 'भुगतान रोकें?');
  String get cancelPaymentHelp => _t(
    'Nothing is charged until you finish on the payment page.',
    'भुगतान पृष्ठ पर पूरा करने तक कुछ नहीं कटता।',
  );
  String get keepPaying => _t('Go on paying', 'भुगतान जारी रखें');
  String get stopPaying => _t('Stop', 'रोकें');
  String get devGateway => _t('Development gateway', 'परीक्षण गेटवे');
  String devGatewayHelp(String amount, String txn) => _t(
    '$amount for transaction $txn. No money moves here; choose how the gateway should answer.',
    'लेन-देन $txn के लिए $amount। यहाँ कोई पैसा नहीं जाता; चुनें कि गेटवे क्या उत्तर दे।',
  );
  String get paySuccess => _t('Pay (success)', 'भुगतान (सफल)');
  String get payFail => _t('Fail the payment', 'भुगतान असफल करें');
  String get choosePayThrough => _t('Choose how to pay', 'भुगतान का माध्यम चुनें');

  // ---- Profile in the app, as the web Profile page (no web page; docs/design/89 "Profile in the app") ----
  String get profileTitle => _t('Profile', 'प्रोफ़ाइल');
  String get rollNo => _t('Roll no', 'अनुक्रमांक');
  String get classTeacher => _t('Class teacher', 'कक्षा अध्यापक');
  String get teachersHelp => _t(
    'The class teacher and the teacher of each subject.',
    'कक्षा अध्यापक और हर विषय के शिक्षक।',
  );
  String teacherRole(String role) => switch (role) {
    'class_teacher' => classTeacher,
    'co_class_teacher' => _t('Co-class teacher', 'सह-कक्षा अध्यापक'),
    _ => _t('Subject teacher', 'विषय शिक्षक'),
  };
  String get mobileLabel => _t('Mobile', 'मोबाइल');
  String get emailLabel => _t('E-mail', 'ई-मेल');
  String callWho(String name) => _t('Call $name', '$name को फ़ोन करें');
  String emailWho(String name) => _t('E-mail $name', '$name को ई-मेल करें');
  String get noTeachers => _t(
    'The school has not assigned teachers to this class yet.',
    'विद्यालय ने अभी इस कक्षा के शिक्षक तय नहीं किए हैं।',
  );
  String get contactMasked => _t(
    'The school shows part of the number and e-mail only. To reach a teacher, raise a query or book an '
        'appointment from the Help desk.',
    'विद्यालय नंबर और ई-मेल का केवल कुछ भाग दिखाता है। शिक्षक से संपर्क के लिए हेल्प डेस्क से प्रश्न भेजें या '
        'मुलाक़ात का समय लें।',
  );
  String get profileComplete => _t('Profile complete', 'प्रोफ़ाइल पूर्ण');
  String get downloadProfile => _t('Download profile (PDF)', 'प्रोफ़ाइल डाउनलोड करें (PDF)');
  String get profilePdf => _t('Profile (PDF)', 'प्रोफ़ाइल (PDF)');
  String waitingForApprovalN(int n) =>
      _t('$n waiting for approval', '$n स्वीकृति की प्रतीक्षा में');
  String get father => _t('Father', 'पिता');
  String get mother => _t('Mother', 'माता');
  String get guardian => _t('Guardian', 'अभिभावक');
  String photoOf(String who) => _t('Photo: $who', 'फ़ोटो: $who');
  String get changePhoto => _t('Change photo', 'फ़ोटो बदलें');
  String get addPhoto => _t('Add photo', 'फ़ोटो जोड़ें');
  String get photoWaiting =>
      _t('New photo waiting for approval', 'नई फ़ोटो स्वीकृति की प्रतीक्षा में');
  String get pickPhoto => _t('Choose from the gallery', 'गैलरी से चुनें');
  String get photoTypeWrong =>
      _t('Send a JPG, PNG or WebP photo.', 'JPG, PNG या WebP फ़ोटो भेजें।');
  String get photoTooBig =>
      _t('The photo must be 5 MB or smaller.', 'फ़ोटो 5 MB या उससे छोटी होनी चाहिए।');
  String get photoSent => _t(
    'The photo is sent to the school for approval.',
    'फ़ोटो स्वीकृति के लिए विद्यालय को भेज दी गई है।',
  );
  String get photoSaved => _t('The photo is saved.', 'फ़ोटो सहेज ली गई है।');
  String get updatesClosed =>
      _t('Profile updates are closed at the moment.', 'प्रोफ़ाइल बदलाव अभी बंद हैं।');
  String updatesOpenUntil(String d) => _t('Updates are open until $d.', 'बदलाव $d तक खुले हैं।');
  String get changeRequests => _t('Changes asked for', 'माँगे गए बदलाव');
  String waitingN(int n) => _t('$n waiting', '$n प्रतीक्षा में');
  String decidedN(int n) => _t('$n decided', '$n निर्णीत');
  String get showHistory => _t('Show history', 'इतिहास देखें');
  String requestStatus(String st) => switch (st) {
    'pending' => _t('Waiting', 'प्रतीक्षा में'),
    'approved' => _t('Approved', 'स्वीकृत'),
    'rejected' => _t('Not approved', 'अस्वीकृत'),
    'partially_approved' => _t('Partly approved', 'आंशिक स्वीकृत'),
    'cancelled' => _t('Withdrawn', 'वापस लिया'),
    _ => st,
  };
  String waitingWith(String who) => _t('Waiting with $who', '$who के पास प्रतीक्षा में');
  String get withdrawRequest => _t('Withdraw', 'वापस लें');
  String get requestWithdrawn => _t('The request is withdrawn.', 'अनुरोध वापस ले लिया गया।');
  String get notGiven => _t('Not given', 'नहीं दिया');
  String get waitingForApproval => _t('Waiting for approval', 'स्वीकृति की प्रतीक्षा में');
  String get cleared => _t('(clear)', '(खाली)');
  String get update => _t('Update', 'बदलें');
  String updateSection(String t) => _t('Update: $t', 'बदलें: $t');
  String get savedAtOnce => _t('Saved at once', 'तुरंत सहेजा जाता है');
  String get needsApproval => _t('Needs approval', 'स्वीकृति आवश्यक');
  String get pendingField => _t(
    'A change is already waiting for approval.',
    'एक बदलाव पहले से स्वीकृति की प्रतीक्षा में है।',
  );
  String proofOf(String kind) => _t('Proof: $kind', 'प्रमाण: $kind');
  String proofFor(String labels) => _t('for $labels', '$labels के लिए');
  String get chooseFile => _t('Choose a file', 'फ़ाइल चुनें');
  String get proofNeeded =>
      _t('Add the proof the school asks for.', 'विद्यालय द्वारा माँगा गया प्रमाण जोड़ें।');
  String get changeReason => _t('Reason (optional)', 'कारण (वैकल्पिक)');
  String get sendChanges => _t('Send the changes', 'बदलाव भेजें');
  String get nothingChanged => _t('Nothing was changed.', 'कुछ नहीं बदला गया।');
  String get changesSaved => _t('Your changes are saved.', 'आपके बदलाव सहेज लिए गए।');
  String get changesSent => _t(
    'Your changes are sent to the school for approval.',
    'आपके बदलाव स्वीकृति के लिए विद्यालय को भेज दिए गए।',
  );
  String get changesBoth => _t(
    'Some changes are saved; the others wait for the school\'s approval.',
    'कुछ बदलाव सहेज लिए गए; बाकी विद्यालय की स्वीकृति की प्रतीक्षा में हैं।',
  );
  String get chooseDate => _t('Choose a date', 'तिथि चुनें');
  String get yourData => _t('Your data', 'आपका डेटा');
  String get yourDataHelp => _t(
    'Ask for a copy of the data the school holds, a correction, or raise a grievance.',
    'विद्यालय के पास रखे डेटा की प्रति, सुधार, या शिकायत के लिए अनुरोध करें।',
  );
  String get yourDataLaw => _t(
    'Under the Digital Personal Data Protection Act you may ask what the school holds about you and your children, ask for a correction, or raise a grievance. The school answers within the time the law allows.',
    'डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम के अंतर्गत आप पूछ सकते हैं कि विद्यालय के पास आपके और आपके बच्चों के बारे में क्या है, सुधार माँग सकते हैं, या शिकायत कर सकते हैं। विद्यालय कानून द्वारा तय समय में उत्तर देता है।',
  );
  String get whatDoYouNeed => _t('What do you need?', 'आपको क्या चाहिए?');
  String dsrKind(String k) => switch (k) {
    'access' => _t('A copy of the data the school holds', 'विद्यालय के पास रखे डेटा की प्रति'),
    'correction' => _t('A correction to the data', 'डेटा में सुधार'),
    'grievance' => _t('A grievance about how data is used', 'डेटा के उपयोग के बारे में शिकायत'),
    _ => k,
  };
  String dsrKindShort(String k) => switch (k) {
    'access' => _t('Access', 'प्रति'),
    'correction' => _t('Correction', 'सुधार'),
    'erasure' => _t('Erasure', 'मिटाना'),
    _ => _t('Grievance', 'शिकायत'),
  };
  String get aboutWhom => _t('About whom?', 'किसके बारे में?');
  String get myself => _t('Myself', 'स्वयं');
  String get details => _t('Details', 'विवरण');
  String get sendRequest => _t('Send the request', 'अनुरोध भेजें');
  String get requestRecorded => _t(
    'Your request is recorded. The school office will respond.',
    'आपका अनुरोध दर्ज हो गया। विद्यालय कार्यालय उत्तर देगा।',
  );
  String get yourRequests => _t('Your requests', 'आपके अनुरोध');
  String get noRequests => _t('No requests yet.', 'अभी कोई अनुरोध नहीं।');
  String receivedDue(String r, String d) =>
      _t('Received $r · Due by $d', 'प्राप्त $r · अंतिम तिथि $d');
  String get dataReport => _t('Your data report (PDF)', 'आपकी डेटा रिपोर्ट (PDF)');
  String get detailsNeeded => _t('Write the details.', 'विवरण लिखें।');
  String get yourConsents => _t('Your consents', 'आपकी सहमतियाँ');
  String get consentsHelp => _t(
    'Under the Digital Personal Data Protection Act you choose what the school may send you. Fee, attendance and safety messages are always sent.',
    'डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम के अंतर्गत आप चुनते हैं कि विद्यालय आपको क्या भेज सकता है। शुल्क, उपस्थिति और सुरक्षा संदेश हमेशा भेजे जाते हैं।',
  );
  String consentStatus(String? st) => switch (st) {
    'granted' => _t('Allowed', 'अनुमति दी'),
    'withdrawn' => _t('Withdrawn', 'वापस ली'),
    _ => _t('Not recorded', 'दर्ज नहीं'),
  };
  String get allow => _t('Allow', 'अनुमति दें');
  String allowWhat(String what) => _t('Allow: $what', 'अनुमति दें: $what');
  String withdrawWhat(String what) => _t('Withdraw: $what', 'वापस लें: $what');
  String get consentRecorded => _t('Your choice has been recorded.', 'आपकी पसंद दर्ज कर ली गई है।');
  String get pdfPreparing => _t(
    'The PDF is being prepared. Try again in a minute.',
    'PDF तैयार हो रहा है। एक मिनट बाद फिर कोशिश करें।',
  );
  String get notLinked => _t(
    'Your account is not linked to a student yet. Please contact the school office.',
    'आपका खाता अभी किसी विद्यार्थी से नहीं जुड़ा है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );

  // the phone's unsent work (phase C)
  String get unsent => _t('Not sent yet', 'अभी नहीं भेजा गया');
  String unsentN(int n) => _t(
    n == 1 ? '1 piece of work waits for the network' : '$n pieces of work wait for the network',
    '$n काम नेटवर्क की प्रतीक्षा में',
  );
  String get unsentHelp => _t(
    'Kept on this phone and sent by itself when the internet is back.',
    'इस फ़ोन पर रखा है और इंटरनेट आने पर अपने आप भेजा जाएगा।',
  );
  String get sendNow => _t('Send now', 'अभी भेजें');
  String get refusedKept => _t('Not accepted by the school:', 'विद्यालय ने स्वीकार नहीं किया:');
  String get remove => _t('Remove', 'हटाएँ');
  String get savedOffline => _t(
    'Saved on the phone. It is sent when the internet is back.',
    'फ़ोन पर सहेजा गया। इंटरनेट आने पर भेजा जाएगा।',
  );
  String signOutLoses(int n) => _t(
    '$n piece(s) of work not sent yet will be lost if you sign out now.',
    'अभी साइन आउट करने पर $n न भेजे गए काम खो जाएँगे।',
  );

  // ---- phase C: staff
  String get pdfPassword => _t('Password of the file', 'फ़ाइल का पासवर्ड');
  String get open => _t('Open', 'खोलें');
  String get myDay => _t('My day', 'मेरा दिन');
  String get classes => _t('Classes', 'कक्षाएँ');
  String get approvals => _t('Approvals', 'स्वीकृतियाँ');
  String approvalsWaiting(int n) => _t('Approvals: $n waiting', 'स्वीकृतियाँ: $n प्रतीक्षा में');
  String get todaysPeriods => _t('Today\'s periods', 'आज के पीरियड');
  String get noPeriods => _t('No periods for you today.', 'आज आपके कोई पीरियड नहीं।');
  String substitution(String forWhom) => _t('Substitution for $forWhom', '$forWhom के स्थान पर');
  String get toMark => _t('Attendance to mark', 'दर्ज करनी उपस्थिति');
  String get allMarked =>
      _t('All your classes are marked.', 'आपकी सभी कक्षाओं की उपस्थिति दर्ज है।');
  String get toEnter => _t('Marks to enter', 'दर्ज करने हैं अंक');
  String get nothingToEnter => _t('No marks waiting.', 'कोई अंक बाकी नहीं।');
  String enteredOf(int done, int total) =>
      _t('$done of $total entered', '$total में से $done दर्ज');
  String get markClass => _t('Mark a class', 'कक्षा की उपस्थिति');
  String get dayAttendance => _t('Day attendance', 'दिन की उपस्थिति');
  String get section => _t('Class and section', 'कक्षा और वर्ग');
  String get dateLabel => _t('Date', 'तारीख़');
  String get allPresent => _t('All present', 'सब उपस्थित');
  String get save => _t('Save', 'सहेजें');
  String get saved => _t('Saved.', 'सहेजा गया।');
  String get locked =>
      _t('Locked: it can no longer be changed here.', 'बंद: इसे यहाँ बदला नहीं जा सकता।');
  String markedBy(String who) => _t('Marked by $who', '$who ने दर्ज की');
  String presentAbsent(int p, int a, int n) =>
      _t('Present $p · Absent $a · of $n', 'उपस्थित $p · अनुपस्थित $a · कुल $n');
  String get onLeaveLocked => _t('On approved leave', 'स्वीकृत अवकाश पर');
  String get myAttendance => _t('My attendance', 'मेरी उपस्थिति');
  String get myLeave => _t('My leave', 'मेरा अवकाश');
  String get payslips => _t('My payslips', 'मेरी वेतन पर्चियाँ');
  String get askCorrection => _t('Ask for a correction', 'सुधार का अनुरोध');
  String get inTime => _t('In', 'प्रवेश');
  String get outTime => _t('Out', 'निकास');
  String get correctionSent => _t('Correction asked for.', 'सुधार का अनुरोध भेजा गया।');
  String get correctionNeeds => _t(
    'Give the in or out time, or what the day should be.',
    'आगमन या प्रस्थान का समय, या दिन क्या होना चाहिए, बताएँ।',
  );
  String get withdraw => _t('Withdraw', 'वापस लें');
  String get noPunches => _t('No punch', 'कोई पंच नहीं');
  String dayType(String code) => switch (code) {
    'P' => _t('Present', 'उपस्थित'),
    'HD' => _t('Half day', 'आधा दिन'),
    'A' => _t('Absent', 'अनुपस्थित'),
    'WO' => _t('Weekly off', 'साप्ताहिक अवकाश'),
    'H' => _t('Holiday', 'अवकाश'),
    'LV' => _t('On leave', 'अवकाश पर'),
    'HOLD' => _t('On hold', 'रोका गया'),
    _ => code,
  };
  String get balances => _t('Leave balance', 'अवकाश शेष');
  String available(String n) => _t('$n available', '$n उपलब्ध');
  String get halfDay => _t('Half day', 'आधा दिन');
  String get firstHalf => _t('First half', 'पहला भाग');
  String get secondHalf => _t('Second half', 'दूसरा भाग');
  String get confirm => _t('Go ahead', 'आगे बढ़ें');
  String get documentNeeded => _t(
    'This leave needs a document. Apply on the web page to attach it.',
    'इस अवकाश के लिए दस्तावेज़ चाहिए। उसे लगाने के लिए वेब पेज पर आवेदन करें।',
  );
  String get askCancel => _t('Ask to cancel', 'रद्द करने का अनुरोध');
  String staffLeaveStatus(String status) => switch (status) {
    'pending' => _t('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'approved' => _t('Approved', 'स्वीकृत'),
    'rejected' => _t('Not approved', 'स्वीकृत नहीं'),
    'withdrawn' => _t('Withdrawn', 'वापस लिया गया'),
    'cancelled' => _t('Cancelled', 'रद्द'),
    _ => status,
  };
  String get postWork => _t('Post homework', 'गृहकार्य दें');
  // Daily work as on the staff website (docs/design/96)
  String get dailyWork => _t('Daily work', 'दैनिक कार्य');
  String get workReport => _t('Report', 'रिपोर्ट');
  String get classwork => _t('Classwork', 'कक्षाकार्य');
  String get assignmentWord => _t('Assignment', 'असाइनमेंट');
  String get dateWord => _t('Date', 'तारीख');
  String get classWord => _t('Class', 'कक्षा');
  String get selectClass => _t('Select a class', 'कक्षा चुनें');
  String get sectionsUntick =>
      _t('Sections (untick one to leave it out)', 'वर्ग (किसी को छोड़ने के लिए उसका निशान हटाएँ)');
  String get sheetPickClass => _t(
    'Select the class. Every section of the class you teach comes ticked, and the same entry is posted to each of them.',
    'कक्षा चुनें। आप जिन वर्गों को पढ़ाते हैं वे सब चुने हुए आते हैं, और वही प्रविष्टि हर वर्ग को भेजी जाती है।',
  );
  String get noClassForWork => _t(
    'No class is assigned to you for daily work.',
    'दैनिक कार्य के लिए आपको कोई कक्षा नहीं दी गई है।',
  );
  String get noSubjectHere => _t(
    'No subject is assigned to you in this class. A teacher, the class teacher too, posts only for the subjects given in Teacher assignments; ask the office to add yours.',
    'इस कक्षा में आपको कोई विषय नहीं दिया गया है। शिक्षक (कक्षा शिक्षक भी) केवल शिक्षक नियुक्ति में दिए विषयों के लिए भेजते हैं; कार्यालय से अपना विषय जुड़वाएँ।',
  );
  String onlySections(String list) => _t('$list only', 'केवल $list');
  String enterWork(String what) => _t('Enter ${what.toLowerCase()}…', '$what लिखें…');
  String postedWork(String? forSections, int files) => _t(
    'Posted${forSections != null ? ' for $forSections' : ''}${files > 0 ? ' · $files file(s) attached' : ''}',
    '${forSections != null ? '$forSections के लिए ' : ''}भेजा गया${files > 0 ? ' · $files फ़ाइल संलग्न' : ''}',
  );
  String get publishOn => _t('Publish on', 'प्रकाशन');
  String publishHelp(String? schoolTime) => _t(
    'Parents and students see it from this time.${schoolTime != null ? " The school's usual time is $schoolTime." : ''}',
    'अभिभावक और विद्यार्थी इसे इस समय से देखेंगे।${schoolTime != null ? ' विद्यालय का सामान्य समय $schoolTime है।' : ''}',
  );
  String get askAckSheet =>
      _t('Ask the parent / student to acknowledge', 'अभिभावक / विद्यार्थी से पावती माँगें');
  String sheetHelp(int mb) => _t(
    'Fill only the subjects you want to post; a box left empty changes nothing. A file can be a PDF or a photo, up to $mb MB each.',
    'केवल वही विषय भरें जो भेजने हैं; खाली छोड़ा बॉक्स कुछ नहीं बदलता। फ़ाइल PDF या फ़ोटो हो सकती है, हर एक $mb MB तक।',
  );
  String get saveAndPublish => _t('Save and publish', 'सहेजें और प्रकाशित करें');
  String savedCounts(int created, int updated) =>
      _t('Saved: $created new, $updated updated.', 'सहेजा गया: $created नए, $updated बदले।');
  String fileTooBig(int mb) => _t('A file can be up to $mb MB.', 'फ़ाइल $mb MB तक हो सकती है।');
  String get toWord => _t('To', 'तक');
  String get allMyClasses => _t('All my classes', 'मेरी सभी कक्षाएँ');
  String get showWord => _t('Show', 'दिखाएँ');
  String get showBoth => _t('Daily work and assignments', 'दैनिक कार्य और असाइनमेंट');
  String get showDaily =>
      _t('Daily work (homework, classwork)', 'दैनिक कार्य (गृहकार्य, कक्षाकार्य)');
  String get nothingPostedDays =>
      _t('Nothing was posted in these days.', 'इन दिनों में कुछ नहीं भेजा गया।');
  String publishesAt(String when) => _t('Publishes $when', '$when को प्रकाशित होगा');
  String ackCount(int n) => _t('$n acknowledged', '$n ने पावती दी');
  String get workReportFile => _t('Daily work report', 'दैनिक कार्य रिपोर्ट');
  // marking a class as on the staff website (docs/design/96, part 6)
  String get attCodesHelp => _t(
    'Codes: P present · A absent · LV leave · L late · SR short leave · H half day · OD on duty · SB stay back. A student on approved leave is marked LV and cannot be changed here (the coordinator can); a student with a gate pass is flagged.',
    'कोड: P उपस्थित · A अनुपस्थित · LV अवकाश · L देर से · SR अल्प अवकाश · H आधा दिन · OD ड्यूटी पर · SB रुके रहे। स्वीकृत अवकाश वाला विद्यार्थी LV लगता है और यहाँ बदला नहीं जा सकता (समन्वयक बदल सकते हैं); गेट पास वाले विद्यार्थी चिह्नित हैं।',
  );
  String get notMarkedYetDate =>
      _t('Not marked yet for this date.', 'इस तारीख की उपस्थिति अभी नहीं लगी।');
  String savedCountsLine(int p, int a, int lv, int l) => _t(
    '$p present · $a absent · $lv leave · $l late',
    '$p उपस्थित · $a अनुपस्थित · $lv अवकाश · $l देर से',
  );
  String get rfidGate => _t('RFID gate', 'RFID गेट');
  String get markedLateWord => _t('late', 'देर से');
  String markingOpen(String? from, String? to) => _t(
    'Marking is open ${from ?? 'from the start of the day'} – ${to ?? 'the end of the day'}.',
    'उपस्थिति ${from ?? 'दिन की शुरुआत'} – ${to ?? 'दिन के अंत'} तक लगाई जा सकती है।',
  );
  String get registerLockedByCoordinator =>
      _t('This register was locked by the coordinator.', 'यह रजिस्टर समन्वयक ने बंद कर दिया है।');
  String get markingClosed => _t(
    'Marking is closed for this day; the coordinator can mark it or reopen it for you.',
    'इस दिन की उपस्थिति बंद है; समन्वयक इसे लगा सकते हैं या आपके लिए फिर खोल सकते हैं।',
  );
  String get onLeaveApproved => _t('On leave (approved)', 'अवकाश पर (स्वीकृत)');
  String gatePass(bool early, String? at) => _t(
    '${early ? 'Gate pass: leaves early' : 'Gate pass: comes late'}${at != null ? ' $at' : ''}',
    '${early ? 'गेट पास: जल्दी जाएगा' : 'गेट पास: देर से आएगा'}${at != null ? ' $at' : ''}',
  );
  String inAtWord(String time) => _t('in $time', 'प्रवेश $time');
  String registerOfMonth(String month) => _t('Register of $month', '$month का रजिस्टर');
  String get addRemark => _t('Remark', 'टिप्पणी');
  // the staff timetable as on the staff website (docs/design/96, part 5)
  String lessonsToday(int n) => _t('$n lesson${n == 1 ? '' : 's'} today', 'आज $n कालांश');
  String get noLessonsSunday => _t('No lessons on Sunday', 'रविवार को कोई कालांश नहीं');
  String get mySectionsTitle => _t('My sections', 'मेरे वर्ग');
  String assignmentRole(String kind) => switch (kind) {
    'class_teacher' => _t('Class teacher', 'कक्षा शिक्षक'),
    'subject_teacher' => _t('Subject teacher', 'विषय शिक्षक'),
    'coordinator' => _t('Coordinator', 'समन्वयक'),
    _ => _t('Indicator', 'संकेतक'),
  };
  String canDo(bool attendance, bool homework) => [
    if (attendance) _t('attendance', 'उपस्थिति'),
    if (homework) _t('homework', 'गृहकार्य'),
  ].join(', ');
  String get canWord => _t('Can', 'कर सकते हैं');
  String get noAssignmentsYear => _t('No assignments in this year.', 'इस वर्ष कोई नियुक्ति नहीं।');
  String get substitutionsWeek => _t('Substitutions this week', 'इस सप्ताह के प्रतिस्थापन');
  String coversFor(String substitute, String? absent) => _t(
    '$substitute covers for ${absent ?? 'the regular teacher'}',
    '$substitute, ${absent ?? 'नियमित शिक्षक'} के स्थान पर',
  );
  String get myWeekTitle => _t('My week', 'मेरा सप्ताह');
  String get periodFree => _t('free', 'खाली');
  String periodKindWord(String kind) => switch (kind) {
    'break' => _t('Break', 'अवकाश'),
    'assembly' => _t('Assembly', 'प्रार्थना सभा'),
    'activity' => _t('Activity', 'गतिविधि'),
    _ => kind,
  };
  String get todayMark => _t('today', 'आज');
  String get noPeriodsDefined =>
      _t('The school has not defined its periods yet.', 'विद्यालय ने अभी कालांश तय नहीं किए हैं।');
  // Session plan, curriculum, date sheet as on the staff website (docs/design/96, part 3)
  String get docsUploadTab => _t('Upload', 'अपलोड');
  String get docsUploadedTab => _t('Uploaded', 'अपलोड किए गए');
  String docKind(String kind) => switch (kind) {
    'session_plan' => _t('Session plan', 'सत्र योजना'),
    'curriculum' => _t('Curriculum / syllabus', 'पाठ्यक्रम'),
    'date_sheet' => _t('Date sheet', 'डेट शीट'),
    'magazine' => _t('School magazine', 'विद्यालय पत्रिका'),
    'almanac' => _t('School almanac', 'विद्यालय डायरी'),
    _ => _t('Other', 'अन्य'),
  };
  String get whatWord => _t('What', 'क्या');
  String get allDocKinds => _t('All kinds', 'सभी प्रकार');
  String get docClasses => _t('For the classes', 'किन कक्षाओं के लिए');
  String get remarkWord => _t('Remark', 'टिप्पणी');
  String get docsFilesHelp => _t(
    'Attachments: a PDF or a photo, up to 5 files.',
    'संलग्नक: PDF या फ़ोटो, अधिकतम 5 फ़ाइलें।',
  );
  String get uploadWord => _t('Upload', 'अपलोड करें');
  String get uploadedDone => _t('Uploaded.', 'अपलोड हो गया।');
  String get docsNeedTitle =>
      _t('Write a title (two letters at least).', 'शीर्षक लिखें (कम से कम दो अक्षर)।');
  String get docsNeedFile => _t('Attach at least one file.', 'कम से कम एक फ़ाइल जोड़ें।');
  String get docsNeedClass => _t('Choose at least one class.', 'कम से कम एक कक्षा चुनें।');
  String get docsTooMany => _t('Up to 5 files.', 'अधिकतम 5 फ़ाइलें।');
  String get noClassThisSession => _t(
    'You have no class assigned in this session yet.',
    'इस सत्र में आपको अभी कोई कक्षा नहीं दी गई है।',
  );
  String get nothingUploaded => _t('Nothing uploaded yet.', 'अभी कुछ अपलोड नहीं हुआ।');
  String get publishedFrom => _t('Published from', 'प्रकाशित, से');
  String get scheduledWord => _t('Scheduled', 'निर्धारित');
  String get whoAcknowledged => _t('Who acknowledged', 'किसने पावती दी');
  String acknowledgedOf(int a, int t) => _t('$a of $t acknowledged', '$t में से $a ने पावती दी');
  String get ackYes => _t('Acknowledged', 'पावती दी');
  String get ackNotYet => _t('Not yet', 'अभी नहीं');
  String removeDocAsk(String title) => _t(
    'Remove “$title”? Families no longer see it.',
    '“$title” हटाएँ? परिवार इसे फिर नहीं देखेंगे।',
  );
  String get removedDone => _t('Removed.', 'हटा दिया गया।');
  String get docsReportFile => _t('Class documents', 'कक्षा दस्तावेज़');
  String get clearWord => _t('Clear', 'हटाएँ');
  String get workTitle => _t('Title', 'शीर्षक');
  String get workBody => _t('What to do', 'क्या करना है');
  String get subject => _t('Subject', 'विषय');
  String get noSubject => _t('No subject (class note)', 'कोई विषय नहीं (कक्षा सूचना)');
  String get dueDate => _t('Due date', 'जमा करने की तारीख');
  String get askAck =>
      _t('Ask families to say they have seen it', 'परिवारों से देख लेने की पुष्टि माँगें');
  String get addFile => _t('Add a file', 'फ़ाइल जोड़ें');
  String get takePhoto => _t('Take a photo', 'फ़ोटो लें');
  String get posted => _t('Posted.', 'भेज दिया गया।');
  String get titleNeeded => _t('Write a title.', 'शीर्षक लिखें।');
  String get chooseSection => _t('Choose the class.', 'कक्षा चुनें।');
  String get marksEntry => _t('Marks entry', 'अंक प्रविष्टि');
  String maxMarks(String n) => _t('out of $n', '$n में से');
  String get absentShort => _t('Absent', 'अनुपस्थित');
  String get submitForCheck => _t('Send for checking', 'जाँच के लिए भेजें');
  String get submitted => _t('Sent for checking.', 'जाँच के लिए भेजा गया।');
  String get enterOnWeb => _t(
    'This subject is entered in parts. Enter it on the web page.',
    'यह विषय भागों में दर्ज होता है। इसे वेब पेज पर दर्ज करें।',
  );
  String get sheetClosed =>
      _t('This sheet is closed for entry.', 'यह पत्रक प्रविष्टि के लिए बंद है।');
  String marksOver(String max) => _t('Marks can be at most $max.', 'अंक अधिकतम $max हो सकते हैं।');
  String get myTimetable => _t('My timetable', 'मेरी समय-सारणी');
  String get net => _t('Net pay', 'शुद्ध वेतन');
  String get financialYearLabel => _t('Financial year', 'वित्तीय वर्ष');
  String fy(String start) {
    final y = int.tryParse(start) ?? 0;
    return '$start-${((y + 1) % 100).toString().padLeft(2, '0')}';
  }

  // approvals
  String get nothingToApprove => _t('Nothing waits for you.', 'आपके लिए कुछ लंबित नहीं है।');
  String get all => _t('All', 'सभी');
  String get approve => _t('Approve', 'स्वीकृत करें');
  String get reject => _t('Reject', 'अस्वीकार करें');
  String get sendBack => _t('Send back', 'वापस भेजें');
  String get acknowledgeIt => _t('Acknowledge', 'पावती दें');
  String get sign => _t('Sign', 'हस्ताक्षर करें');
  String get openPage => _t('Open the full page', 'पूरा पेज खोलें');
  String get decideOnPage => _t(
    'This is decided on its own page (it needs more than a yes or no).',
    'इसका निर्णय इसके अपने पेज पर होता है (इसमें हाँ या ना से अधिक चाहिए)।',
  );
  String get reasonNeeded =>
      _t('Write the reason (at least 3 letters).', 'कारण लिखें (कम से कम 3 अक्षर)।');
  String get reasonOptional => _t('Note (optional)', 'टिप्पणी (वैकल्पिक)');
  String get done => _t('Done.', 'हो गया।');
  String get secondFactor => _t(
    'This needs a recent second sign-in check. Decide it on the web page.',
    'इसके लिए हाल की दूसरी साइन-इन जाँच चाहिए। वेब पेज पर निर्णय लें।',
  );
  String someUnavailable(String kinds) =>
      _t('Could not be read just now: $kinds', 'अभी पढ़ा नहीं जा सका: $kinds');

  // ---- Lesson plans as on the staff website (docs/design/96 part 7) ----
  String get lpUploadTab => _t('Upload Lesson', 'पाठ अपलोड');
  String get lpReportTab => _t('Lesson Report', 'पाठ रिपोर्ट');
  String get lpSelectType => _t('Select type', 'प्रकार चुनें');
  String get lpMasterClassEvery => _t('Master class (every section)', 'पूरी कक्षा (हर वर्ग)');
  String get lpClassSection => _t('Class section', 'कक्षा वर्ग');
  String get lpMasterClass => _t('Master class', 'पूरी कक्षा');
  String get lpTopicName => _t('Topic name', 'विषय-वस्तु का नाम');
  String get lpDescription => _t('Description', 'विवरण');
  String lpAttachmentsUpTo(int n) =>
      _t('Attachments (up to $n): PDF or photo', 'संलग्नक ($n तक): PDF या फ़ोटो');
  String lpTooMany(int n) => _t('Up to $n attachments.', '$n संलग्नक तक।');
  String get lpSubmit => _t('Submit', 'भेजें');
  String get lpTickClass =>
      _t('Tick at least one class to submit.', 'भेजने के लिए कम से कम एक कक्षा चुनें।');
  String get lpNeedTopic => _t('Write the topic name.', 'विषय-वस्तु का नाम लिखें।');
  String get lpNoClass => _t('No class is assigned to you.', 'आपको कोई कक्षा नहीं दी गई है।');
  String get lpUploaded => _t(
    'The lesson is uploaded and sent for approval.',
    'पाठ अपलोड हो गया और स्वीकृति के लिए भेजा गया।',
  );
  String get lpTotal => _t('Total requests', 'कुल अनुरोध');
  String lpStatus(String v) => switch (v) {
    'pending' => _t('Pending', 'लंबित'),
    'acknowledged' => _t('Acknowledged', 'स्वीकृत'),
    'rejected' => _t('Rejected', 'अस्वीकृत'),
    _ => v,
  };
  String get lpFilters => _t('Filters', 'फ़िल्टर');
  String get lpFilterType => _t('Filter type', 'फ़िल्टर का प्रकार');
  String lpBy(String v) => switch (v) {
    'employee_code' => _t('Employee ID', 'कर्मचारी आईडी'),
    'employee' => _t('Employee name', 'कर्मचारी का नाम'),
    'class' => _t('Class', 'कक्षा'),
    'topic' => _t('Topic', 'विषय-वस्तु'),
    _ => _t('Any of these', 'इनमें से कोई'),
  };
  String get lpKeyword => _t('Search keyword', 'खोज शब्द');
  String get lpDateFrom => _t('Date from', 'तारीख से');
  String get lpDateTo => _t('Date to', 'तारीख तक');
  String get lpStatusWord => _t('Status', 'स्थिति');
  String get lpAllStatus => _t('All status', 'सभी स्थिति');
  String get lpLevel => _t('Level', 'स्तर');
  String get lpAllLevels => _t('All levels', 'सभी स्तर');
  String lpLevelPending(int n) => _t('Level $n pending', 'स्तर $n लंबित');
  String get lpRecord => _t('Record status', 'रिकॉर्ड की स्थिति');
  String get lpActive => _t('Active', 'सक्रिय');
  String get lpDeleted => _t('Deleted', 'हटाए गए');
  String lpShow(String v, bool office) => switch (v) {
    'approve' => _t('Waiting for me', 'मेरी प्रतीक्षा में'),
    'own' => _t('Uploaded by me', 'मेरे अपलोड'),
    _ =>
      office
          ? _t('All lessons', 'सभी पाठ')
          : _t('Mine and those I approve', 'मेरे और जिन्हें मैं स्वीकृत करता/करती हूँ'),
  };
  String get lpSearch => _t('Search', 'खोजें');
  String get lpReset => _t('Reset', 'रीसेट');
  String get lpNone => _t('No lesson for these filters.', 'इन फ़िल्टर के लिए कोई पाठ नहीं।');
  String get lpNotYourRole =>
      _t('The lesson report is not part of your role.', 'पाठ रिपोर्ट आपकी भूमिका में नहीं है।');
  String lpRequest(String id) => _t('Request #$id', 'अनुरोध #$id');
  String lpLevelOf(int n, int m) => _t('Level $n of $m pending', 'स्तर $n / $m लंबित');
  String lpFiles(int n) => _t('$n attachment${n == 1 ? '' : 's'}', '$n संलग्नक');
  String get lpReview => _t('Review', 'जाँचें');
  String get lpPrevious => _t('Previous', 'पिछला');
  String get lpNext => _t('Next', 'अगला');
  String get lpReportFile => _t('Lesson report', 'पाठ रिपोर्ट');
  String get lpLesson => _t('Lesson', 'पाठ');
  String get lpEmployee => _t('Employee', 'कर्मचारी');
  String get lpLessonDate => _t('Lesson date', 'पाठ की तारीख');
  String get lpRequested => _t('Requested', 'अनुरोध किया');
  String get lpNoDescription => _t('No description was written.', 'कोई विवरण नहीं लिखा गया।');
  String get lpAttachments => _t('Attachments', 'संलग्नक');
  String get lpApproval => _t('Approval', 'स्वीकृति');
  String lpRule(String? scope) => switch (scope) {
    'employee' => _t(
      'Approvers come from the rule for this employee.',
      'स्वीकृतकर्ता इस कर्मचारी के नियम से हैं।',
    ),
    'class' => _t(
      'Approvers come from the rule for the class.',
      'स्वीकृतकर्ता कक्षा के नियम से हैं।',
    ),
    'department' => _t(
      'Approvers come from the rule for the department.',
      'स्वीकृतकर्ता विभाग के नियम से हैं।',
    ),
    'default' => _t(
      'Approvers come from the school default.',
      'स्वीकृतकर्ता विद्यालय के सामान्य नियम से हैं।',
    ),
    _ => _t(
      'Approvers come from no rule (the principal / school admin).',
      'कोई नियम नहीं: स्वीकृतकर्ता प्रधानाचार्य / विद्यालय व्यवस्थापक हैं।',
    ),
  };
  String lpLevelN(int n) => _t('Level $n', 'स्तर $n');
  String get lpAnyoneWithRole => _t('anyone with this role', 'इस भूमिका वाला कोई भी');
  String get lpWaiting => _t('Waiting', 'प्रतीक्षा में');
  String get lpNotReached => _t('Not reached', 'अभी नहीं पहुँचा');
  String get lpRemarkReject =>
      _t('Remark (needed to reject)', 'टिप्पणी (अस्वीकार करने के लिए ज़रूरी)');
  String get lpNeedRemark =>
      _t('Write why the lesson is rejected.', 'लिखें कि पाठ क्यों अस्वीकार किया गया।');
  String get lpAcknowledge => _t('Acknowledge', 'स्वीकार करें');
  String get lpReject => _t('Reject', 'अस्वीकार करें');
  String get lpAcknowledgedDone => _t('Acknowledged.', 'स्वीकार किया गया।');
  String get lpRejectedDone => _t('Rejected.', 'अस्वीकार किया गया।');
  String get lpDelete => _t('Delete this lesson', 'यह पाठ हटाएँ');
  String lpDeleteAsk(String topic) => _t(
    'Delete the lesson "$topic"? It stays in the report under Deleted.',
    'पाठ "$topic" हटाएँ? यह रिपोर्ट में "हटाए गए" में रहेगा।',
  );
  String get lpDeletedDone => _t('The lesson was deleted.', 'पाठ हटा दिया गया।');
  String get lpWasDeleted => _t('This lesson was deleted.', 'यह पाठ हटा दिया गया था।');

  // who approves whose lessons (the admin app's Approvers)
  String get lpApproversTab => _t('Approvers', 'स्वीकृतकर्ता');
  String get lpRulesTitle => _t('Who approves whose lessons', 'किसके पाठ कौन स्वीकृत करता है');
  String get lpRulesHelp => _t(
    'When a teacher uploads a lesson the first rule that fits decides the approvers: the teacher’s own rule, else the rule of the class, else of the teacher’s department, else the school default. With no rule at all it goes to the principal / school admin.',
    'शिक्षक के पाठ अपलोड करने पर पहला लागू नियम स्वीकृतकर्ता तय करता है: शिक्षक का अपना नियम, फिर कक्षा का, फिर शिक्षक के विभाग का, फिर विद्यालय का सामान्य नियम। कोई नियम न हो तो पाठ प्रधानाचार्य / विद्यालय व्यवस्थापक को जाता है।',
  );
  String get lpNoRule => _t(
    'No rule yet: add the school default first.',
    'अभी कोई नियम नहीं: पहले विद्यालय का सामान्य नियम जोड़ें।',
  );
  String lpScope(String v) => switch (v) {
    'department' => _t('Department', 'विभाग'),
    'class' => _t('Class', 'कक्षा'),
    'employee' => _t('Employee', 'कर्मचारी'),
    _ => _t('School default', 'विद्यालय का सामान्य नियम'),
  };
  String get lpEveryoneElse =>
      _t('Everyone else (school default)', 'बाकी सभी (विद्यालय का सामान्य नियम)');
  String get lpAddRule => _t('Add or replace a rule', 'नियम जोड़ें या बदलें');
  String get lpAddRuleHelp => _t(
    'Choose what the rule is for, then the approver of each level. Saving a rule that already exists replaces its levels.',
    'चुनें कि नियम किसके लिए है, फिर हर स्तर का स्वीकृतकर्ता। पहले से बने नियम को सहेजने पर उसके स्तर बदल जाते हैं।',
  );
  String get lpRuleFor => _t('Rule for', 'नियम किसके लिए');
  String lpRuleForOption(String v) => switch (v) {
    'department' => _t('A department', 'एक विभाग'),
    'class' => _t('A class', 'एक कक्षा'),
    'employee' => _t('An employee', 'एक कर्मचारी'),
    _ => _t('School default (everyone else)', 'विद्यालय का सामान्य नियम (बाकी सभी)'),
  };
  String get lpDepartment => _t('Department', 'विभाग');
  String lpLevelApprover(int n) => _t('Level $n approver', 'स्तर $n स्वीकृतकर्ता');
  String get lpNoOne => _t('No one (no such level)', 'कोई नहीं (यह स्तर नहीं)');
  String lpRole(String name) => _t('Role: $name', 'भूमिका: $name');
  String get lpSaveRule => _t('Save rule', 'नियम सहेजें');
  String get lpRuleSaved => _t('The rule is saved.', 'नियम सहेज लिया गया।');
  String get lpChooseDepartment => _t('Choose the department.', 'विभाग चुनें।');
  String get lpChooseClass => _t('Choose the class.', 'कक्षा चुनें।');
  String get lpChooseEmployee => _t('Choose the employee.', 'कर्मचारी चुनें।');
  String get lpChooseLevel1 =>
      _t('Choose who approves at level 1.', 'चुनें कि स्तर 1 पर कौन स्वीकृत करेगा।');
  String lpRemoveRuleAsk(String label) =>
      _t('Remove the rule for $label?', '$label का नियम हटाएँ?');
  String get lpRuleRemoved => _t('The rule is removed.', 'नियम हटा दिया गया।');

  // ---- My syllabus as on the staff website (docs/design/96 part 9) ----
  String get sySubtitle => _t(
    'The classes and subjects you teach. Open one to mark what you have taught.',
    'आपकी कक्षाएँ और विषय। जो पढ़ाया है उसे चिह्नित करने के लिए कोई एक खोलें।',
  );
  String get syNone => _t(
    'No syllabus is entered yet for a class and subject assigned to you. The coordinator enters it under Academics → Syllabus.',
    'आपको दी गई कक्षा और विषय का पाठ्यक्रम अभी दर्ज नहीं है। समन्वयक इसे शैक्षणिक → पाठ्यक्रम में दर्ज करते हैं।',
  );
  String syDoneOf(int done, int topics, int partial) => _t(
    '$done of $topics topics done${partial > 0 ? ' (+$partial partly)' : ''}',
    '$topics में से $done विषय-बिंदु पूरे${partial > 0 ? ' (+$partial आंशिक)' : ''}',
  );
  String syCovered(int percent) => _t('$percent% covered', '$percent% पूरा');
  String syBehind(int n) => _t('$n behind', '$n पीछे');
  String get syOnTrack => _t('On track', 'समय पर');
  String syHeader(int percent, int done, int topics, int behind) => _t(
    '$percent% covered: $done of $topics topics done${behind > 0 ? ' · $behind behind the plan' : ''}',
    '$percent% पूरा: $topics में से $done विषय-बिंदु पूरे${behind > 0 ? ' · योजना से $behind पीछे' : ''}',
  );
  String syChapter(int n, String name) => _t('Chapter $n: $name', 'अध्याय $n: $name');
  String syPlanned(String month) => _t('planned $month', 'योजना: $month');
  String get syNoTopic =>
      _t('No topic in this chapter yet.', 'इस अध्याय में अभी कोई विषय-बिंदु नहीं।');
  String syPeriods(int n) => _t('$n period${n == 1 ? '' : 's'}', '$n कालांश');
  String syStatus(String? v) => switch (v) {
    'done' => _t('Done', 'पूरा'),
    'partial' => _t('Partly done', 'आंशिक'),
    'not_done' => _t('Not done', 'नहीं हुआ'),
    _ => _t('Pending', 'बाकी'),
  };
  String get syTaughtOn => _t('Taught on', 'पढ़ाया');
  String get syRemark => _t('Remark (needed for Not done)', 'टिप्पणी (नहीं हुआ के लिए ज़रूरी)');
  String get syDone => _t('Done', 'पूरा');
  String get syPartly => _t('Partly', 'आंशिक');
  String get syNotDone => _t('Not done', 'नहीं हुआ');
  String get syNeedReason =>
      _t('Write why the topic was not done.', 'लिखें कि यह विषय-बिंदु क्यों नहीं हुआ।');

  // ---- Marks as on the staff website (docs/design/96 part 10) ----
  String get mkExam => _t('Exam', 'परीक्षा');
  String get mkPick => _t('Section · subject', 'वर्ग · विषय');
  String get mkLockedWord => _t('locked', 'बंद');
  String mkEnteredN(int n) => _t('$n entered', '$n भरे');
  String get mkHelp => _t(
    'Leave a mark empty to skip a pupil; pick a code (AB absent, ML medical, EX exempt …) instead of marks. Marks are checked against the maximum and the lock before they are saved.',
    'किसी विद्यार्थी को छोड़ने के लिए अंक खाली रखें; अंकों के बजाय कोड चुनें (AB अनुपस्थित, ML चिकित्सा, EX छूट …)। सहेजने से पहले अंक अधिकतम और लॉक से जाँचे जाते हैं।',
  );
  String get mkNoExam =>
      _t('No exam is set up for this year yet.', 'इस वर्ष के लिए अभी कोई परीक्षा तय नहीं है।');
  String get mkNotAllowed => _t(
    'You are not allowed to enter marks in this school.',
    'आप इस विद्यालय में अंक नहीं भर सकते।',
  );
  String get mkNoSheet => _t(
    'No section or subject of this exam is given to you.',
    'इस परीक्षा का कोई वर्ग या विषय आपको नहीं दिया गया है।',
  );
  String mkOutOf(String max, String? pass) => _t(
    'out of $max${pass == null ? '' : ' (pass $pass)'}',
    '$max में से${pass == null ? '' : ' (उत्तीर्ण $pass)'}',
  );
  String get mkGraded => _t('graded', 'ग्रेड से');
  String mkEnteredOf(int a, int b) => _t('$a of $b entered', '$b में से $a भरे');
  String get mkLocked => _t('Locked', 'बंद');
  String mkPupils(int n) => _t('$n pupils', '$n विद्यार्थी');
  String mkInParts(String subject, String parts, String total) => _t(
    '$subject is entered in parts: $parts = $total. The total is worked out from the parts.',
    '$subject भागों में भरा जाता है: $parts = $total। कुल अंक भागों से बनते हैं।',
  );
  String get mkNotTaken => _t('Does not take the subject', 'यह विषय नहीं लेता/लेती');
  String get mkMarks => _t('Marks', 'अंक');
  String get mkGrade => _t('Grade', 'ग्रेड');
  String get mkCode => _t('Code', 'कोड');
  String get mkTotal => _t('Total', 'कुल');
  String get mkSave => _t('Save marks', 'अंक सहेजें');
  String mkSaved(int inserted, int updated) => _t(
    'Marks saved ($inserted new, $updated changed).',
    'अंक सहेजे गए ($inserted नए, $updated बदले)।',
  );
  String get mkSavedPlain => _t('Marks saved.', 'अंक सहेजे गए।');
  String get mkNothing => _t(
    'Nothing to save: enter marks, a grade or a code.',
    'सहेजने को कुछ नहीं: अंक, ग्रेड या कोड भरें।',
  );
  String get mkLockedNote => _t(
    'This sheet is locked; the coordinator can reopen it.',
    'यह शीट बंद है; समन्वयक इसे फिर खोल सकते हैं।',
  );
  String mkStage(String v) => switch (v) {
    'submitted' => _t('Submitted', 'जमा'),
    'verified' => _t('Verified', 'सत्यापित'),
    _ => _t('Open', 'खुला'),
  };
  String get mkSubmit => _t('Submit for verification', 'सत्यापन के लिए जमा करें');
  String get mkSubmitted => _t('Submitted for verification.', 'सत्यापन के लिए जमा किया गया।');
  String get mkSubmitHint => _t(
    'Submit once every pupil has marks or a code.',
    'हर विद्यार्थी के अंक या कोड भरने के बाद जमा करें।',
  );
  String mkNotNumber(String name) => _t('$name: write a number.', '$name: संख्या लिखें।');

  // ---- Verify marks as on the staff website (docs/design/96 part 11) ----
  String get vmSubtitle => _t(
    'Marks your sections’ teachers submitted. Open the sheet to check it, then verify (the marks lock) or send them back with what to correct.',
    'आपके वर्गों के शिक्षकों द्वारा जमा किए गए अंक। शीट खोलकर जाँचें, फिर सत्यापित करें (अंक बंद हो जाते हैं) या सुधार लिखकर वापस भेजें।',
  );
  String get vmNone => _t('Nothing waits for you to verify.', 'सत्यापन के लिए कुछ बाकी नहीं।');
  String vmSubmittedBy(String who, String when) =>
      _t('submitted by $who, $when', '$who ने जमा किया, $when');
  String get vmOpenSheet => _t('Open the sheet', 'शीट खोलें');
  String get vmVerify => _t('Verify', 'सत्यापित करें');
  String get vmWhatToCorrect => _t('What to correct', 'क्या सुधारना है');
  String get vmSendBack => _t('Send back', 'वापस भेजें');
  String get vmNeedNote => _t(
    'Write what to correct (at least 3 letters).',
    'लिखें कि क्या सुधारना है (कम से कम 3 अक्षर)।',
  );
  String get vmVerified => _t('Verified and locked.', 'सत्यापित और बंद।');
  String get vmSentBack => _t('Sent back to the teacher.', 'शिक्षक को वापस भेजा गया।');

  // ---- Indicators and progress card as on the staff website (docs/design/96 part 12) ----
  String get inSection => _t('Section', 'वर्ग');
  String get inIntro => _t(
    'Class teachers rate their section on the indicators of the exam.',
    'कक्षा-अध्यापक परीक्षा के संकेतकों पर अपने वर्ग का मूल्यांकन करते हैं।',
  );
  String get inDenied => _t(
    'You are not allowed to open exam registers in this school.',
    'आप इस विद्यालय में परीक्षा रजिस्टर नहीं खोल सकते।',
  );
  String get inNoSection => _t(
    'You rate no section in this exam: the class teacher does, or a teacher given areas in Teacher assignments.',
    'इस परीक्षा में आप किसी वर्ग का मूल्यांकन नहीं करते: कक्षा-अध्यापक करते हैं, या शिक्षक-नियुक्ति में क्षेत्र दिए गए शिक्षक।',
  );
  String get inNoneGiven => _t(
    'No indicator of this section is given to you.',
    'इस वर्ग का कोई संकेतक आपको नहीं दिया गया है।',
  );
  String get inNoSet => _t(
    'This section has no indicators in this exam.',
    'इस परीक्षा में इस वर्ग के कोई संकेतक नहीं हैं।',
  );
  String get inMappedNote => _t(
    'Only the indicators given to you are shown; the class teacher sees them all.',
    'केवल आपको दिए गए संकेतक दिखते हैं; कक्षा-अध्यापक सभी देखते हैं।',
  );
  String inAlsoBy(String names) => _t('Also entered by: $names', 'ये भी भरते हैं: $names');
  String get inOther => _t('Other', 'अन्य');
  String get inSaved => _t('Saved.', 'सहेजा गया।');
  String get inSave => _t('Save', 'सहेजें');
  String get inNote => _t('Your words', 'आपके शब्द');
  String? inError(String type) => switch (type) {
    'exams.entry_locked' => _t(
      'Indicator entry is locked; ask the coordinator to reopen it.',
      'संकेतक प्रविष्टि बंद है; समन्वयक से फिर खुलवाएँ।',
    ),
    'exams.not_assigned' => _t(
      'Only the class teacher of this section can enter these.',
      'इन्हें केवल इस वर्ग के कक्षा-अध्यापक भर सकते हैं।',
    ),
    'exams.indicator_not_mapped' => _t(
      'Some of these indicators are not given to you in this section.',
      'इनमें से कुछ संकेतक इस वर्ग में आपको नहीं दिए गए हैं।',
    ),
    'exams.feedback_by_family' => _t(
      'The parent wrote this in the parent app; it is kept as they wrote it.',
      'यह अभिभावक ने ऐप में लिखा है; जैसा लिखा वैसा ही रहता है।',
    ),
    'exams.portfolio_full' => _t(
      'A child has up to twelve photos in an exam; remove one first.',
      'एक परीक्षा में बच्चे की अधिकतम बारह फ़ोटो; पहले एक हटाएँ।',
    ),
    'scope-denied' => _t('You are not allowed to open this section.', 'आप यह वर्ग नहीं खोल सकते।'),
    _ => null,
  };

  // the sheet by Excel (indicators, remarks, height and weight)
  String get xlByExcel => _t('By Excel', 'Excel से');
  String get xlIndicatorsHelp => _t(
    'The sheet holds the indicators you rate in this section, filled with what is entered; a level from its list, or your words for a written item.',
    'शीट में इस वर्ग के वे संकेतक हैं जिनका आप मूल्यांकन करते हैं, भरे हुए मानों सहित; सूची से स्तर, या लिखित बिंदु के लिए आपके शब्द।',
  );
  String get xlDownload => _t('Download the sheet', 'शीट डाउनलोड करें');
  String get xlUpload => _t('Upload the filled sheet (.xlsx)', 'भरी हुई शीट अपलोड करें (.xlsx)');
  String get xlChecking => _t('Checking the sheet…', 'शीट जाँची जा रही है…');
  String xlSummary(int rows, int ready, int errors) => _t(
    '$rows rows read · $ready ready to save${errors > 0 ? ' · $errors with a problem' : ''}',
    '$rows पंक्तियाँ पढ़ीं · $ready सहेजने को तैयार${errors > 0 ? ' · $errors में समस्या' : ''}',
  );
  String xlSaveRows(int n) => _t('Save the rows ($n)', 'पंक्तियाँ सहेजें ($n)');
  String xlSaved(int n) => _t('Saved ($n).', 'सहेजा गया ($n)।');
  String get xlNothing => _t('Nothing was saved.', 'कुछ नहीं सहेजा गया।');
  String get xlTooLarge => _t('The file is larger than 1.4 MB.', 'फ़ाइल 1.4 MB से बड़ी है।');
  String xlRowProblem(Object row, String admissionNo, String name, String problem) => _t(
    'Row $row · $admissionNo · $name: $problem',
    'पंक्ति $row · $admissionNo · $name: $problem',
  );

  // the progress card's words and portfolio
  String inWordsTitle(String name) =>
      _t('In our words and the portfolio · $name', 'हमारे शब्द और पोर्टफ़ोलियो · $name');
  String get inPupil => _t('Pupil', 'विद्यार्थी');
  String inPhotosN(int n) => _t('$n photo${n == 1 ? '' : 's'}', '$n फ़ोटो');
  String inWordKind(String k) => switch (k) {
    'self' => _t('All about me (the child’s words)', 'मेरे बारे में (बच्चे के शब्द)'),
    'parent' => _t('The parent’s feedback', 'अभिभावक की प्रतिक्रिया'),
    _ => _t('My observations', 'मेरे अवलोकन'),
  };
  String get inByParent =>
      _t('Written by the parent in the parent app.', 'अभिभावक ने अभिभावक ऐप में लिखा।');
  String get inSaveWords => _t('Save the words', 'शब्द सहेजें');
  String get inPortfolio => _t('Portfolio', 'पोर्टफ़ोलियो');
  String get inNoPhoto => _t(
    'No photo yet (up to twelve; the card prints six).',
    'अभी कोई फ़ोटो नहीं (बारह तक; कार्ड पर छह छपती हैं)।',
  );
  String get inPhoto => _t('Photo', 'फ़ोटो');
  String get inCaption => _t('Caption', 'कैप्शन');
  String get inShows => _t('Shows (optional)', 'क्या दिखाती है (वैकल्पिक)');
  String get inAddPhoto => _t('Add the photo', 'फ़ोटो जोड़ें');
  String get inAdded => _t('Added.', 'जोड़ दी गई।');
  String get inChoosePhoto => _t('Choose a photo', 'फ़ोटो चुनें');
  String get inPhotoTooBig => _t('The photo is larger than 1 MB.', 'फ़ोटो 1 MB से बड़ी है।');
  String get inPhotoType => _t('Choose a PNG or JPEG photo.', 'PNG या JPEG फ़ोटो चुनें।');
  String get inRemovePhotoAsk =>
      _t('Remove this photo from the portfolio?', 'यह फ़ोटो पोर्टफ़ोलियो से हटाएँ?');

  // ---- Remarks as on the staff website (docs/design/96 part 13) ----
  String get rmIntro => _t(
    'One remark per pupil and category; the report card prints them.',
    'हर विद्यार्थी और श्रेणी के लिए एक टिप्पणी; रिपोर्ट कार्ड पर छपती है।',
  );
  String get rmNoCategory => _t(
    'There is no remark category for you to write in this section.',
    'इस वर्ग में आपके लिखने के लिए कोई टिप्पणी-श्रेणी नहीं है।',
  );
  String rmByOthers(String list) =>
      _t('Written by others here: $list', 'यहाँ दूसरे लिखते हैं: $list');
  String get rmChoose => _t('Choose a remark', 'टिप्पणी चुनें');
  String get xlRemarksHelp => _t(
    'The sheet holds the categories you write in this section, filled with what is written; a category that takes its list only accepts a listed remark.',
    'शीट में इस वर्ग की वे श्रेणियाँ हैं जो आप लिखते हैं, लिखी टिप्पणियों सहित; केवल सूची वाली श्रेणी में सूची की टिप्पणी ही चलती है।',
  );
  String? rmError(String type) => switch (type) {
    'exams.entry_locked' => _t(
      'Remarks are locked; ask the coordinator to reopen them.',
      'टिप्पणियाँ बंद हैं; समन्वयक से फिर खुलवाएँ।',
    ),
    'exams.not_assigned' => _t(
      'You write only the categories given to you: the class teacher all, a subject teacher their subject’s, others those named in Teacher assignments.',
      'आप केवल अपनी श्रेणियाँ लिखते हैं: कक्षा-अध्यापक सभी, विषय-शिक्षक अपने विषय की, अन्य शिक्षक-नियुक्ति में दी गई।',
    ),
    'exams.remark_list_only' => _t(
      'This category takes one of its listed remarks only.',
      'यह श्रेणी केवल अपनी सूची की टिप्पणी लेती है।',
    ),
    _ => null,
  };

  // ---- Height and weight as on the staff website (docs/design/96 part 14) ----
  String get hwIntro => _t(
    'The class teacher enters each pupil’s height and weight in the term exams.',
    'कक्षा-अध्यापक सत्र परीक्षाओं में हर विद्यार्थी की लंबाई और वज़न भरते हैं।',
  );
  String get hwNoExam => _t(
    'No exam of this year takes height and weight.',
    'इस वर्ष की कोई परीक्षा लंबाई और वज़न नहीं लेती।',
  );
  String get hwNoSection => _t(
    'You are not the class teacher of a section in this exam.',
    'आप इस परीक्षा में किसी वर्ग के कक्षा-अध्यापक नहीं हैं।',
  );
  String get hwNotTaken =>
      _t('This exam does not take height and weight.', 'यह परीक्षा लंबाई और वज़न नहीं लेती।');
  String get hwLast => _t('Last reading', 'पिछली माप');
  String get hwHealthCheck => _t('health check', 'स्वास्थ्य जाँच');
  String get hwHeight => _t('Height cm', 'लंबाई सेमी');
  String get hwWeight => _t('Weight kg', 'वज़न किग्रा');
  String get hwBlood => _t('Blood group', 'रक्त समूह');
  String get hwSave => _t('Save height and weight', 'लंबाई और वज़न सहेजें');
  String hwSaved(int n) => _t('Saved ($n).', 'सहेजा गया ($n)।');
  String get hwNothing => _t('Nothing changed.', 'कुछ नहीं बदला।');
  String get hwLockedNote => _t(
    'The exam is locked; the coordinator can reopen it.',
    'परीक्षा बंद है; समन्वयक इसे फिर खोल सकते हैं।',
  );
  String get hwOnlyClassTeacher => _t(
    'Only the class teacher of this section enters height and weight.',
    'इस वर्ग की लंबाई और वज़न केवल कक्षा-अध्यापक भरते हैं।',
  );
  String get hwRange =>
      _t('Height 40 to 250 cm, weight 3 to 200 kg.', 'लंबाई 40 से 250 सेमी, वज़न 3 से 200 किग्रा।');
  String hwNotNumber(String name) => _t('$name: write a number.', '$name: संख्या लिखें।');
  String get xlHealthHelp => _t(
    'The sheet lists the section with each pupil’s last reading; fill height in cm and weight in kg (BMI is worked out).',
    'शीट में वर्ग के हर विद्यार्थी की पिछली माप है; लंबाई सेमी में और वज़न किग्रा में भरें (BMI अपने आप बनता है)।',
  );
  String? hwError(String type) => switch (type) {
    'exams.entry_locked' => _t(
      'Height and weight is locked for this class; ask the coordinator to reopen it.',
      'इस कक्षा की लंबाई और वज़न बंद है; समन्वयक से फिर खुलवाएँ।',
    ),
    'exams.not_assigned' => _t(
      'Only the class teacher of this section enters height and weight.',
      'इस वर्ग की लंबाई और वज़न केवल कक्षा-अध्यापक भरते हैं।',
    ),
    'exams.area_off' => _t(
      'This exam does not take height and weight.',
      'यह परीक्षा लंबाई और वज़न नहीं लेती।',
    ),
    'validation-failed' => _t(
      'A value was not accepted: height 40 to 250 cm, weight 3 to 200 kg.',
      'कोई मान स्वीकार नहीं हुआ: लंबाई 40 से 250 सेमी, वज़न 3 से 200 किग्रा।',
    ),
    _ => null,
  };

  // ---- Subject choices as on the staff website (docs/design/96 part 15) ----
  String get scIntro => _t(
    'The subjects each student of your section takes this year. The report card and the mark register follow them.',
    'आपके वर्ग का हर विद्यार्थी इस वर्ष कौन-से विषय लेता है। रिपोर्ट कार्ड और अंक रजिस्टर इन्हीं के अनुसार चलते हैं।',
  );
  String get scNoSection => _t(
    "A section's class teacher sets its students' subject choices; you are not the class teacher of a section this year.",
    'वर्ग के विद्यार्थियों के विषय कक्षा-अध्यापक चुनते हैं; आप इस वर्ष किसी वर्ग के कक्षा-अध्यापक नहीं हैं।',
  );
  String get scViewOnly => _t(
    "You see this section's choices; its class teacher sets them.",
    'आप इस वर्ग के विषय देख रहे हैं; इन्हें इसके कक्षा-अध्यापक तय करते हैं।',
  );
  String scEveryone(String codes) => _t(
    'Everyone takes $codes. A subject with marks this year stays.',
    'सभी लेते हैं: $codes। जिस विषय में इस वर्ष अंक हैं, वह बना रहता है।',
  );
  String get scNothing => _t(
    'Every subject of the class is compulsory: nothing to choose.',
    'कक्षा के सभी विषय अनिवार्य हैं: चुनने को कुछ नहीं।',
  );
  String get scNotSet => _t('not set: takes every subject', 'तय नहीं: सभी विषय लेता/लेती है');
  String get scStream => _t('Stream', 'संकाय');
  String get scOther => _t('Other subjects', 'अन्य विषय');
  String get scOpt => _t('Opt (additional, out of total)', 'अतिरिक्त (कुल से बाहर)');
  String get scMarkedNote => _t('has marks this year: stays', 'इस वर्ष अंक हैं: बना रहेगा');
  String get scSave => _t('Save the choices', 'विषय सहेजें');
  String get scLastYearHelp => _t(
    "Students without choices take their last year's subjects and stream.",
    'जिन विद्यार्थियों के विषय तय नहीं, वे पिछले वर्ष के विषय और संकाय लेंगे।',
  );
  String get scLastYear => _t("Bring last year's choices", 'पिछले वर्ष के विषय लाएँ');
  String scCopied(int n) => _t(
    "$n students given last year's subjects.",
    '$n विद्यार्थियों को पिछले वर्ष के विषय दिए गए।',
  );

  // ---- Exam date sheet as on the staff website (docs/design/96 part 16) ----
  String get dsIntro => _t(
    'The papers of each exam for your classes: date, day and time.',
    'आपकी कक्षाओं की हर परीक्षा के पेपर: तारीख, दिन और समय।',
  );
  String get dsNone => _t('No date sheet yet.', 'अभी कोई डेट शीट नहीं।');
  String dsDayLong(int weekday) => (hindi
      ? const ['सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार', 'रविवार']
      : const [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ])[(weekday - 1) % 7];
  String get dsSheetLabel => _t(
    'Date sheet: a row a date, a column a class',
    'डेट शीट: हर तारीख एक पंक्ति, हर कक्षा एक कॉलम',
  );

  // ---- Marks by Excel; Exam attendance as on the staff website (docs/design/96 part 17) ----
  String get xlMarksHelp => _t(
    'The sheet lists the section’s pupils for this subject, filled with what is entered; write the marks (or a code such as AB, ML, EX) and upload it. Every row is checked before anything is saved.',
    'शीट में इस विषय के लिए वर्ग के विद्यार्थी हैं, भरे हुए अंकों सहित; अंक (या AB, ML, EX जैसा कोड) लिखें और अपलोड करें। सहेजने से पहले हर पंक्ति जाँची जाती है।',
  );
  String get eaIntro => _t(
    'Class teachers fill the register for their section.',
    'कक्षा-अध्यापक अपने वर्ग का रजिस्टर भरते हैं।',
  );
  String eaOf(String section) => _t('$section · exam attendance', '$section · परीक्षा उपस्थिति');
  String get eaPresent => _t('Days present', 'उपस्थित दिन');
  String get eaTotal => _t('Total days', 'कुल दिन');
  String get eaSave => _t('Save exam attendance', 'परीक्षा उपस्थिति सहेजें');
  String eaSaved(int n) =>
      _t('Saved ($n attendance rows changed).', 'सहेजा गया ($n पंक्तियाँ बदलीं)।');
  String get eaNothing => _t('No attendance entered.', 'कोई उपस्थिति नहीं भरी।');
  String eaOver(String name) => _t(
    '$name: days present cannot exceed the total days.',
    '$name: उपस्थित दिन कुल दिनों से ज़्यादा नहीं हो सकते।',
  );
  String eaNotNumber(String name) => _t('$name: write whole days.', '$name: पूरे दिन लिखें।');
  String get eaLocked => _t(
    'The exam is locked; the coordinator can reopen it.',
    'परीक्षा बंद है; समन्वयक इसे फिर खोल सकते हैं।',
  );
  String get eaFromDailyHelp => _t(
    'Count exam attendance from daily attendance (empty dates: from the start of the session to the last day of the exam).',
    'दैनिक उपस्थिति से परीक्षा उपस्थिति गिनें (तारीखें खाली: सत्र की शुरुआत से परीक्षा के अंतिम दिन तक)।',
  );
  String get eaReplace => _t('Replace what is entered', 'भरी हुई को बदलें');
  String get eaCount => _t('Count from daily attendance', 'दैनिक उपस्थिति से गिनें');
  String eaCounted(int filled, String from, String to, int kept) => _t(
    '$filled counted ($from to $to), $kept kept as entered.',
    '$filled गिने गए ($from से $to), $kept जैसे भरे थे वैसे रहे।',
  );
  String? eaError(String type) => switch (type) {
    'exams.entry_locked' => _t(
      'The exam is locked; ask the coordinator to reopen it.',
      'परीक्षा बंद है; समन्वयक से फिर खुलवाएँ।',
    ),
    'exams.not_assigned' => _t(
      'Only the class teacher of this section can fill the register.',
      'इस वर्ग का रजिस्टर केवल कक्षा-अध्यापक भर सकते हैं।',
    ),
    'exams.attendance_invalid' => _t(
      'Days present cannot exceed the total days.',
      'उपस्थित दिन कुल दिनों से ज़्यादा नहीं हो सकते।',
    ),
    _ => null,
  };

  // ---- the Exam register as on the staff website, and its sheet by Excel (docs/design/96 part 18) ----
  String erTitle(String section) => _t('Register · $section', 'रजिस्टर · $section');
  String get erRemark => _t('Remark', 'टिप्पणी');
  String get erTookPart => _t('Took part in', 'भाग लिया');
  String get erPromoted => _t('Promoted to (final term)', 'अगली कक्षा (अंतिम सत्र)');
  String erLastHealth(String date, String? bmi) => _t(
    'last health $date${bmi == null ? '' : ' · BMI $bmi'}',
    'पिछली स्वास्थ्य जाँच $date${bmi == null ? '' : ' · BMI $bmi'}',
  );
  String get erSaveRemarks => _t('Save remarks', 'टिप्पणियाँ सहेजें');
  String erRemarksSaved(int n) =>
      _t('Saved ($n remarks changed).', 'सहेजा गया ($n टिप्पणियाँ बदलीं)।');
  String get erNoRemark => _t('No remark entered.', 'कोई टिप्पणी नहीं भरी।');
  String erHealthSaved(int n) =>
      _t('Saved ($n health records saved).', 'सहेजा गया ($n स्वास्थ्य रिकॉर्ड)।');
  String get erNoHealth => _t('No measurement entered.', 'कोई माप नहीं भरी।');
  String get xlRegisterHelp => _t(
    'The sheet lists the section with each pupil’s remark, what they took part in, the class promoted to and the exam attendance (with height and weight when you see them), filled with what is entered. Leave a cell empty to keep it; only what you change is saved.',
    'शीट में वर्ग के हर विद्यार्थी की टिप्पणी, जिसमें भाग लिया, अगली कक्षा और परीक्षा उपस्थिति (और लंबाई-वज़न, यदि आप देखते हैं) भरे हुए मानों सहित है। रखने के लिए सेल खाली छोड़ें; केवल जो बदलें वही सहेजा जाता है।',
  );

  /// The API's marks refusals in words (as the website's).
  String? mkError(String type) => switch (type) {
    'exams.entered_in_parts' => _t(
      'This subject is entered in parts; choose the part.',
      'यह विषय भागों में भरा जाता है; भाग चुनें।',
    ),
    'exams.entry_locked' => _t(
      'Entry for this subject is locked; ask the coordinator to reopen it.',
      'इस विषय की प्रविष्टि बंद है; समन्वयक से फिर खुलवाएँ।',
    ),
    'exams.marks_out_of_range' => _t(
      'A mark is above the maximum for this subject.',
      'कोई अंक इस विषय के अधिकतम से ज़्यादा है।',
    ),
    'exams.not_assigned' => _t(
      'You are not assigned to this section or subject.',
      'आपको यह वर्ग या विषय नहीं दिया गया है।',
    ),
    'exams.student_not_in_section' => _t(
      'A student in the sheet is no longer in this section; reload.',
      'शीट का कोई विद्यार्थी अब इस वर्ग में नहीं है; फिर से खोलें।',
    ),
    'exams.subject_not_taken' => _t(
      'A pupil does not take this subject; leave the row empty.',
      'कोई विद्यार्थी यह विषय नहीं लेता; वह पंक्ति खाली रखें।',
    ),
    'exams.unknown_code' => _t(
      'That is not a marks code of the school.',
      'यह विद्यालय का अंक-कोड नहीं है।',
    ),
    'exams.grade_not_allowed' => _t(
      "That grade is not on the subject's scale.",
      'यह ग्रेड विषय के पैमाने में नहीं है।',
    ),
    'exams.entry_submitted' => _t(
      'The marks are submitted or verified; they change only after they are sent back.',
      'अंक जमा या सत्यापित हैं; वापस भेजे जाने के बाद ही बदलेंगे।',
    ),
    'exams.marks_missing' => _t(
      'Some pupils have no marks or code yet.',
      'कुछ विद्यार्थियों के अंक या कोड अभी नहीं भरे।',
    ),
    'scope-denied' => _t(
      'You are not allowed to enter marks for this section.',
      'आप इस वर्ग के अंक नहीं भर सकते।',
    ),
    _ => null,
  };

  // ---- phase D
  String get phones => _t('Phones signed in', 'साइन-इन फ़ोन');
  String get thisPhone => _t('This phone', 'यह फ़ोन');
  String lastUsed(String at) => _t('Last used $at', 'अंतिम उपयोग $at');
  String get signOutPhone => _t('Sign out', 'साइन आउट');
  String signOutPhoneAsk(String name) =>
      _t('Sign $name out of EduPro?', '$name को EduPro से साइन आउट करें?');
  String get phoneSignedOut => _t('That phone is signed out.', 'वह फ़ोन साइन आउट हो गया।');

  String get notifications => _t('Notifications', 'सूचनाएँ (नोटिफ़िकेशन)');
  String get notificationsHelp => _t(
    'Choose what this school may send to this phone. Messages still arrive in the app.',
    'चुनें कि यह विद्यालय इस फ़ोन पर क्या भेज सकता है। संदेश ऐप में फिर भी आएँगे।',
  );
  String pushEvent(String e) => switch (e) {
    'school_message' => _t('Messages from the school', 'विद्यालय के संदेश'),
    'attendance' => _t('Attendance and leave', 'उपस्थिति और अवकाश'),
    'fees' => _t('Fees', 'फ़ीस'),
    'transport' => _t('Bus and transport', 'बस और परिवहन'),
    'queries' => _t('Replies to queries', 'प्रश्नों के उत्तर'),
    'notices' => _t('Notices and circulars', 'सूचनाएँ और परिपत्र'),
    'homework' => _t('Homework', 'गृहकार्य'),
    'approvals' => _t('Approvals waiting for me', 'मेरी प्रतीक्षा में स्वीकृतियाँ'),
    _ => e,
  };
  String get schoolSendsNone =>
      _t('This school sends no notifications.', 'यह विद्यालय कोई सूचना नहीं भेजता।');
  String get updateTitle => _t('Update EduPro', 'EduPro अपडेट करें');
  String get updateNeeded => _t(
    'This version of EduPro no longer works. Please update the app to go on.',
    'EduPro का यह संस्करण अब काम नहीं करता। आगे बढ़ने के लिए ऐप अपडेट करें।',
  );
  String get updateAvailable =>
      _t('A new version of EduPro is available.', 'EduPro का नया संस्करण उपलब्ध है।');
  String get updateNow => _t('Update', 'अपडेट करें');

  // dates and money
  static const _monEn = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  static const _monHi = [
    'जन॰',
    'फ़र॰',
    'मार्च',
    'अप्रैल',
    'मई',
    'जून',
    'जुल॰',
    'अग॰',
    'सित॰',
    'अक्तू॰',
    'नव॰',
    'दिस॰',
  ];
  static const _monthEn = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  static const _monthHi = [
    'जनवरी',
    'फ़रवरी',
    'मार्च',
    'अप्रैल',
    'मई',
    'जून',
    'जुलाई',
    'अगस्त',
    'सितंबर',
    'अक्तूबर',
    'नवंबर',
    'दिसंबर',
  ];
  static const _dayEn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  static const _dayHi = ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'];

  /// 19 Nov 2026 (from a date or `2026-11-19`).
  String date(Object d) {
    final x = d is DateTime ? d : DateTime.tryParse('$d');
    if (x == null) return '$d';
    return '${x.day} ${(hindi ? _monHi : _monEn)[x.month - 1]} ${x.year}';
  }

  /// Thu, 19 Nov (and the year when it is not this year)
  String dayShort(Object d) {
    final x = d is DateTime ? d : DateTime.tryParse('$d');
    if (x == null) return '$d';
    final year = x.year == DateTime.now().year ? '' : ' ${x.year}';
    return '${(hindi ? _dayHi : _dayEn)[x.weekday - 1]}, ${x.day} ${(hindi ? _monHi : _monEn)[x.month - 1]}$year';
  }

  /// Thursday, 19 November
  String dayLong(DateTime x) =>
      '${(hindi ? _dayLongHi : _dayLongEn)[x.weekday - 1]}, ${x.day} ${(hindi ? _monthHi : _monthEn)[x.month - 1]}';
  static const _dayLongEn = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];
  static const _dayLongHi = [
    'सोमवार',
    'मंगलवार',
    'बुधवार',
    'गुरुवार',
    'शुक्रवार',
    'शनिवार',
    'रविवार',
  ];

  /// 19 Nov 2026, 10:42
  String dateTime(DateTime x) {
    final l = x.toLocal();
    return '${date(l)}, ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  /// November 2026
  String month(DateTime x) => '${(hindi ? _monthHi : _monthEn)[x.month - 1]} ${x.year}';

  /// Sep (a month's short name, for a chart)
  String monthShort(DateTime x) => (hindi ? _monHi : _monEn)[x.month - 1];

  /// Mon … Sat (1 … 7)
  String weekday(int n) => (hindi ? _dayHi : _dayEn)[(n - 1) % 7];

  /// 09:30 from `09:30:00`
  String time(String? t) => t == null || t.length < 5 ? (t ?? '') : t.substring(0, 5);

  /// ₹12,345 or ₹12,345.50, in Indian grouping, from the API's money strings.
  String money(Object? v) {
    final n = num.tryParse('$v') ?? 0;
    final neg = n < 0;
    final paise = (n.abs() * 100).round();
    final whole = '${paise ~/ 100}';
    final frac = paise % 100;
    String grouped;
    if (whole.length <= 3) {
      grouped = whole;
    } else {
      final last3 = whole.substring(whole.length - 3);
      var rest = whole.substring(0, whole.length - 3);
      final parts = <String>[];
      while (rest.length > 2) {
        parts.insert(0, rest.substring(rest.length - 2));
        rest = rest.substring(0, rest.length - 2);
      }
      if (rest.isNotEmpty) parts.insert(0, rest);
      grouped = '${parts.join(',')},$last3';
    }
    return '${neg ? '−' : ''}₹$grouped${frac == 0 ? '' : '.${frac.toString().padLeft(2, '0')}'}';
  }
}

/// The language in use (Hindi kept in preferences).
class HindiController extends Notifier<bool> {
  static const _key = 'hindi';

  @override
  bool build() {
    SharedPreferences.getInstance().then((p) {
      final v = p.getBool(_key) ?? false;
      if (v != state) state = v;
    });
    return false;
  }

  Future<void> set(bool hindi) async {
    state = hindi;
    (await SharedPreferences.getInstance()).setBool(_key, hindi);
  }
}

final hindiProvider = NotifierProvider<HindiController, bool>(HindiController.new);
final stringsProvider = Provider<S>((ref) => S(ref.watch(hindiProvider)));
