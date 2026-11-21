import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';

/// One common question and its answer, in English and Hindi; [needs] is the menu page the answer is about (the
/// question is left out when the person has no such page), [parentOnly] for questions only a parent has.
class _Faq {
  const _Faq(this.q, this.qHi, this.a, this.aHi, {this.needs, this.parentOnly = false});
  final String q;
  final String qHi;
  final String a;
  final String aHi;
  final String? needs;
  final bool parentOnly;
}

/// The help centre as the website has it (apps/parent/app/(app)/help), with the answers that name a web-only place
/// (leave under Queries, the Retry button, the language link) said the app's way.
const _faq = <_Faq>[
  _Faq(
    'How do I switch between my children?',
    'मैं अपने बच्चों के बीच कैसे बदलूँ?',
    'Every screen with a child switch shows one child at a time; tap the name at the top to change. Fees, results and attendance are per child.',
    'बच्चा बदलने वाली हर स्क्रीन एक समय में एक बच्चा दिखाती है; बदलने के लिए ऊपर नाम पर टैप करें। शुल्क, परिणाम और उपस्थिति प्रति बच्चा हैं।',
    parentOnly: true,
  ),
  _Faq(
    'I paid online but the receipt is not showing.',
    'मैंने ऑनलाइन भुगतान किया पर रसीद नहीं दिख रही।',
    'Open Fees; Online payments lists each payment as Waiting, Paid or Failed. A receipt appears only after the gateway confirms; the school office can see the transaction too.',
    'शुल्क खोलें; ऑनलाइन भुगतान में हर भुगतान प्रतीक्षा में, भुगतान हुआ या असफल दिखता है। रसीद गेटवे की पुष्टि के बाद ही बनती है; कार्यालय भी लेन-देन देख सकता है।',
    needs: '/fees',
    parentOnly: true,
  ),
  _Faq(
    'How do I apply for leave?',
    'अवकाश के लिए आवेदन कैसे करूँ?',
    'Attendance → Apply for leave, with the dates and the reason. The class teacher approves it and the attendance shows leave for those days.',
    'उपस्थिति → अवकाश के लिए आवेदन करें, तिथियाँ और कारण सहित। कक्षा शिक्षक स्वीकृत करते हैं और उपस्थिति में वे दिन अवकाश दिखते हैं।',
    needs: '/attendance',
  ),
  _Faq(
    'How do I ask to meet a teacher?',
    'शिक्षक से मिलने का अनुरोध कैसे करूँ?',
    'Appointments → Book an appointment: pick the child, whom to meet, an open day and a free time. The school confirms it and the gate pass shows on the appointment.',
    'भेंट → बच्चा, किससे मिलना है और दिन चुनें, फिर खाली समय। विद्यालय पुष्टि करके गेट पास भेजता है।',
    needs: '/appointments',
  ),
  _Faq(
    'Why did I not get an absence alert?',
    'मुझे अनुपस्थिति अलर्ट क्यों नहीं मिला?',
    'Alerts go once a day per child after the attendance time. Check Profile → Your consents; safety and attendance alerts are always sent, but the mobile number on record must be current.',
    'अलर्ट उपस्थिति समय के बाद प्रति बच्चा दिन में एक बार जाते हैं। प्रोफ़ाइल → आपकी सहमतियाँ देखें; सुरक्षा और उपस्थिति अलर्ट हमेशा जाते हैं, पर दर्ज मोबाइल नंबर सही होना चाहिए।',
  ),
  _Faq(
    'How do I change my mobile number or address?',
    'मोबाइल नंबर या पता कैसे बदलूँ?',
    'Profile → Update on the section (address, contact, parents). Some changes save at once; others wait for the school’s approval and may need a document such as an electricity bill. Follow them under Changes asked for.',
    'प्रोफ़ाइल → अनुभाग पर बदलें (पता, संपर्क, माता-पिता)। कुछ बदलाव तुरंत सहेजे जाते हैं; अन्य विद्यालय की स्वीकृति की प्रतीक्षा करते हैं और बिजली बिल जैसे दस्तावेज़ की आवश्यकता हो सकती है। उन्हें माँगे गए बदलाव में देखें।',
    needs: '/profile',
  ),
  _Faq(
    'Where is the report card?',
    'रिपोर्ट कार्ड कहाँ है?',
    'Results shows each released term; the PDF button prepares the card for download. A card can be withheld while fees are due.',
    'परिणाम हर जारी सत्र दिखाता है; PDF बटन कार्ड डाउनलोड के लिए तैयार करता है। शुल्क बकाया होने पर कार्ड रोका जा सकता है।',
    needs: '/results',
  ),
  _Faq(
    'What data does the school hold about my child?',
    'विद्यालय मेरे बच्चे का कौन सा डेटा रखता है?',
    'Profile → Your data lets you ask for a copy, a correction or raise a grievance under the DPDP Act. The school answers within the legal time.',
    'प्रोफ़ाइल → आपका डेटा से DPDP अधिनियम के तहत प्रति, सुधार या शिकायत माँग सकते हैं। विद्यालय कानूनी समय में उत्तर देता है।',
    needs: '/profile',
  ),
  _Faq(
    'The app works offline but shows old data.',
    'ऐप ऑफ़लाइन चलता है पर पुराना डेटा दिखाता है।',
    'The app keeps the last copy of pages for reading when offline; it refreshes when the connection returns. Sign out clears the copies.',
    'ऐप ऑफ़लाइन पढ़ने के लिए पृष्ठों की अंतिम प्रति रखता है; कनेक्शन लौटने पर ताज़ा होता है। साइन आउट प्रतियाँ हटा देता है।',
  ),
  _Faq(
    'How do I change the language?',
    'भाषा कैसे बदलूँ?',
    'Settings (at the top of the home screen) → Language: English or हिन्दी switches every screen.',
    'सेटिंग्स (होम स्क्रीन पर ऊपर) → भाषा: English या हिन्दी हर स्क्रीन बदल देता है।',
  ),
];

/// Help as the website shows it: the common questions, each folded until tapped, in the app's language.
class HelpScreen extends ConsumerWidget {
  const HelpScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    // the pages the person has; until the menu is in, every question shows
    final menu = ref.watch(menuProvider(profile.id)).value;
    final pages = menu == null
        ? null
        : {
            for (final g in menu.groups)
              for (final i in g.items) i.href.split('?').first,
          };
    final faq = _faq.where(
      (f) =>
          (!f.parentOnly || profile.kind == 'parent') &&
          (f.needs == null || pages == null || pages.contains(f.needs)),
    );
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(
          s.hindi ? 'आम प्रश्नों के उत्तर। किसी और बात के लिए विद्यालय कार्यालय पहला संपर्क है।' : 'Answers to the common questions. For anything else, the school office is the first contact.',
          key: const Key('helpIntro'),
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: Tokens.sp3),
        for (final (i, f) in faq.indexed)
          Card(
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              key: Key('help-$i'),
              leading: const Icon(Icons.help_outline),
              title: Text(
                s.hindi ? f.qHi : f.q,
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
              shape: const Border(),
              collapsedShape: const Border(),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp4),
              children: [Text(s.hindi ? f.aHi : f.a)],
            ),
          ),
      ],
    );
  }
}
