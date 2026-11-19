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
