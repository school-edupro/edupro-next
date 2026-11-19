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
    'Your mobile number, e-mail, or your child\'s admission number. We send a code to it.',
    'अपना मोबाइल नंबर, ई-मेल, या अपने बच्चे का प्रवेश क्रमांक। हम उस पर एक कोड भेजेंगे।',
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
  String get more => _t('More', 'और');
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
  String get academics => _t('Academics', 'पढ़ाई');
  String get fees => _t('Fees', 'शुल्क');
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
  String get thisMonth => _t('This month', 'इस महीने');
  String presentOf(int present, int days) =>
      _t('$present of $days days present', '$days में से $present दिन उपस्थित');
  String get homeworkDue => _t('Homework due', 'बाकी गृहकार्य');
  String get noHomeworkDue =>
      _t('No homework due today or tomorrow.', 'आज या कल कोई गृहकार्य बाकी नहीं।');
  String get feesPayable => _t('Fees to pay', 'देय शुल्क');
  String get nothingDue => _t('Nothing due', 'कुछ बाकी नहीं');
  String get nextExam => _t('Next exam', 'अगली परीक्षा');
  String get noExam => _t('No exam coming up.', 'कोई परीक्षा नहीं आ रही।');
  String get latestNotices => _t('Latest notices', 'नई सूचनाएँ');
  String get unreadMessages => _t('Unread messages', 'अपठित संदेश');

  // attendance and leave
  String attendanceCode(String code) => switch (code) {
    'P' => _t('Present', 'उपस्थित'),
    'A' => _t('Absent', 'अनुपस्थित'),
    'LV' => _t('On leave', 'छुट्टी पर'),
    'L' => _t('Late', 'देर से'),
    'SR' => _t('Short leave', 'अल्प अवकाश'),
    'H' => _t('Half day', 'आधा दिन'),
    'OD' => _t('On duty', 'ड्यूटी पर'),
    'SB' => _t('Stay back', 'रुके रहे'),
    _ => code,
  };
  String monthSummary(int present, int absent, int leave, int days) => _t(
    'Present $present · Absent $absent · Leave $leave · of $days days',
    'उपस्थित $present · अनुपस्थित $absent · छुट्टी $leave · कुल $days दिन',
  );
  String get leaves => _t('Leave', 'छुट्टी');
  String get applyLeave => _t('Apply for leave', 'छुट्टी के लिए आवेदन');
  String get leaveType => _t('Kind of leave', 'छुट्टी का प्रकार');
  String get fromDate => _t('First day', 'पहला दिन');
  String get toDate => _t('Last day', 'आखिरी दिन');
  String get reason => _t('Reason', 'कारण');
  String get reasonShort =>
      _t('Write the reason (at least 5 letters).', 'कारण लिखें (कम से कम 5 अक्षर)।');
  String get chooseLeaveType => _t('Choose the kind of leave.', 'छुट्टी का प्रकार चुनें।');
  String get leaveSent => _t('Leave application sent.', 'छुट्टी का आवेदन भेजा गया।');
  String get cancelLeave => _t('Cancel this leave', 'यह छुट्टी रद्द करें');
  String get cancelLeaveAsk =>
      _t('Cancel this leave application?', 'क्या यह छुट्टी का आवेदन रद्द करें?');
  String get leaveCancelled => _t('Leave cancelled.', 'छुट्टी रद्द की गई।');
  String get certificateNeeded => _t(
    'This leave needs a certificate. Apply on the web page to attach it.',
    'इस छुट्टी के लिए प्रमाण-पत्र चाहिए। उसे लगाने के लिए वेब पेज पर आवेदन करें।',
  );
  String get applyOnWeb => _t('Apply on the web page', 'वेब पेज पर आवेदन करें');
  String leaveStatus(String status) => switch (status) {
    'pending' => _t('Waiting for approval', 'स्वीकृति की प्रतीक्षा'),
    'approved' => _t('Approved', 'स्वीकृत'),
    'rejected' => _t('Not approved', 'अस्वीकृत'),
    'cancelled' => _t('Cancelled', 'रद्द'),
    _ => status,
  };
  String daysN(int n) => _t(n == 1 ? '1 day' : '$n days', '$n दिन');

  // homework and notices
  String workKind(String kind) => switch (kind) {
    'classwork' => _t('Classwork', 'कक्षा कार्य'),
    'assignment' => _t('Assignment', 'असाइनमेंट'),
    _ => _t('Homework', 'गृहकार्य'),
  };
  String dueOn(String date) => _t('Due $date', 'जमा करें $date');
  String postedBy(String name) => _t('By $name', '$name द्वारा');
  String get acknowledge => _t('I have seen this', 'मैंने यह देख लिया');
  String get acknowledged => _t('Seen', 'देख लिया');
  String get pinned => _t('Pinned', 'पिन किया गया');
  String get loadMore => _t('Show more', 'और दिखाएँ');

  // timetable, calendar, date sheet
  String get breakTime => _t('Break', 'अवकाश');
  String get holidays => _t('Holidays', 'छुट्टियाँ');
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
  String get paid => _t('Paid', 'जमा');
  String get payNow => _t('Pay online', 'ऑनलाइन भुगतान करें');
  String get instalments => _t('Instalments', 'किस्तें');
  String get receipts => _t('Receipts', 'रसीदें');
  String receiptNo(String no) => _t('Receipt $no', 'रसीद $no');
  String get feeBill => _t('Fee bill', 'शुल्क बिल');
  String get taxCertificate => _t('Fee certificate for tax', 'कर हेतु शुल्क प्रमाण-पत्र');
  String instalmentStatus(String status) => switch (status) {
    'paid' => _t('Paid', 'जमा'),
    'overdue' => _t('Overdue', 'देरी'),
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
