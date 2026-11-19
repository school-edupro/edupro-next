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
  String get homeworkDue => _t('Homework due', 'बाकी गृहकार्य');
  String get noHomeworkDue =>
      _t('No homework due today or tomorrow.', 'आज या कल कोई गृहकार्य बाकी नहीं।');
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
  String monthSummary(int present, int absent, int leave, int days) => _t(
    'Present $present · Absent $absent · Leave $leave · of $days days',
    'उपस्थित $present · अनुपस्थित $absent · अवकाश $leave · कुल $days दिन',
  );
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
    'This leave needs a certificate. Apply on the web page to attach it.',
    'इस अवकाश के लिए प्रमाण-पत्र चाहिए। उसे लगाने के लिए वेब पेज पर आवेदन करें।',
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

  /// 19 Nov 2026, 10:42
  String dateTime(DateTime x) {
    final l = x.toLocal();
    return '${date(l)}, ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  /// November 2026
  String month(DateTime x) => '${(hindi ? _monthHi : _monthEn)[x.month - 1]} ${x.year}';

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
