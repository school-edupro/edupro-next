import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart' show FilteringTextInputFormatter;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart' show ImagePicker, ImageSource;
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../staff/data.dart' show PickedFile, contentTypeOf;
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

// ------------------------------------------------------------------------------------------------ the API

/// A part of the page the website loads with `.catch(() => null)`: none when the API refuses it (no network still
/// fails, so the copy kept last time shows).
Future<Object?> _soft(Future<Object?> Function() load) async {
  try {
    return await load();
  } on ApiException catch (e) {
    if (e.offline) rethrow;
    return null;
  }
}

/// The child's hostel as the website's Hostel page loads it: this week's mess menu with the child's diet (no hostel:
/// the child does not board, or left it), the requests to leave the hostel, the summary (room, wardens, where the
/// child is now, the last roll-call, today's meals, the hostel leave and outings) and, for a boarder, the visitor
/// list, the complaints with their heads, what the hostel shared and the meals to rate:
/// `{menu, exit, summary, visitors, complaints, heads, incidents, feedback}`.
final hostelProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('hostel:${p.id}', () async {
    final api = ref.read(apiProvider);
    final id = p.studentId ?? '';
    // the week of today: the generated call always sends a week, the website sends none
    final menu = asJson(
      await ref.read(transportProvider).send('GET', '/hostel/mine/menu', query: {'studentId': id}),
    );
    final boards = menu['hostel'] != null;
    final got = await Future.wait<Object?>([
      _soft(() => api.hostelExitFamilyList(studentId: id)),
      _soft(() => api.hostelExitSummary(studentId: id)),
      if (boards) ...[
        api.hostelH3FamilyVisitors(studentId: id),
        api.hostelCareFamilyComplaints(studentId: id),
        api.hostelCareFamilyHeads(),
        api.hostelCareFamilyIncidents(studentId: id),
        _soft(() => api.hostelMessFamilyFeedback(studentId: id)),
      ],
    ]);
    return {
      'menu': menu,
      'exit': got[0],
      'summary': got[1],
      if (boards) ...{
        'visitors': got[2],
        'complaints': asJson(got[3])['data'],
        'heads': asJson(got[4])['data'],
        'incidents': asJson(got[5])['data'],
        'feedback': asJson(got[6])['data'],
      },
    };
  });
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// Another week's mess menu (`2026-11-23`, any day of it) with the child's diet.
final hostelWeekProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String)>((
  ref,
  a,
) async {
  final (p, week) = a;
  final r = await cached(
    'hostelWeek:${p.id}:$week',
    () => ref.read(apiProvider).hostelH3FamilyMenu(studentId: p.studentId ?? '', weekOf: week),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The photo of a visitor on the child's list; none when it cannot be had.
final hostelVisitorPhotoProvider = FutureProvider.autoDispose.family<ApiFile?, String>((
  ref,
  id,
) async {
  try {
    final f = await ref.read(apiProvider).hostelH3FamilyPhoto(id: id);
    return RegExp(r'^image/(png|jpeg|webp)').hasMatch(f.contentType) ? f : null;
  } on ApiException {
    return null;
  }
});

/// The largest photo the API takes for a visitor.
const _photoMax = 300000;

/// The phone's camera or gallery for a visitor's photo, made small for the gate; a test puts its own in.
final hostelPhotoPickerProvider = Provider<Future<PickedFile?> Function(BuildContext context, S s)>(
  (ref) => (context, s) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const Key('visitorPhotoCamera'),
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(s.takePhoto),
              onTap: () => Navigator.of(c).pop(ImageSource.camera),
            ),
            ListTile(
              key: const Key('visitorPhotoGallery'),
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(s.pickPhoto),
              onTap: () => Navigator.of(c).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return null;
    // a face for the gate: small, so it stays under the API's 300 KB
    final x = await ImagePicker().pickImage(
      source: source,
      maxWidth: 600,
      maxHeight: 600,
      imageQuality: 70,
    );
    if (x == null) return null;
    return PickedFile(
      name: x.name,
      bytes: await x.readAsBytes(),
      contentType: x.mimeType ?? contentTypeOf(x.name),
    );
  },
);

/// Opens a web app page in the app (the gate passes have no native screen yet); a test puts its own in.
final hostelWebProvider =
    Provider<Future<void> Function(BuildContext context, Profile p, String to, String title)>(
      (ref) => (context, p, to, title) async {
        await context.push(
          Uri(path: '/web', queryParameters: {'app': p.app, 'to': to, 'title': title}).toString(),
        );
      },
    );

/// Calls or writes on WhatsApp from the phone; a test puts its own in.
final hostelLaunchProvider = Provider<Future<void> Function(Uri uri)>(
  (ref) => (uri) async {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  },
);

// ------------------------------------------------------------------------------------------------ the words

/// The Hostel screen's words in English and Hindi.
extension HostelWords on S {
  String _h(String en, String hi) => hindi ? hi : en;

  String get hostelTitle => _h('Hostel', 'छात्रावास');
  String get hostelIntro => _h(
    'Where your child stays, leave and outings, visitors, the mess and the warden — all in one place.',
    'बच्चा कहाँ रहता है, छुट्टी और बाहर जाना, आगंतुक, भोजनालय और वार्डन — सब एक ही जगह।',
  );
  String get hostelNotBoarder =>
      _h('Your child does not board in the hostel.', 'आपका बच्चा छात्रावास में नहीं रहता।');
  String hostelLeftOn(String on, String hostel) => _h(
    'Your child left the hostel on $on ($hostel).',
    'आपका बच्चा $on को छात्रावास ($hostel) से चला गया।',
  );
  String hostelFeeUntil(String month) =>
      _h('The hostel fee is charged up to $month.', 'छात्रावास शुल्क $month तक लिया जाएगा।');
  String get hostelClearance => _h('Clearance certificate', 'अनापत्ति प्रमाणपत्र');

  String get hostelTabLeave => _h('Leave and outings', 'छुट्टी और बाहर जाना');
  String get hostelTabVisitors => _h('Visitors', 'आगंतुक');
  String get hostelTabMess => _h('Mess', 'भोजनालय');
  String get hostelTabComplaints => _h('Complaints', 'शिकायतें');
  String get hostelTabNotes => _h('From the hostel', 'छात्रावास से');
  String get hostelTabLeaving => _h('Leaving the hostel', 'छात्रावास छोड़ना');

  String get hostelRoomFig => _h('Room / bed', 'कमरा / बिस्तर');
  String get hostelNowFig => _h('Now', 'अभी');
  String get hostelVisitorsFig => _h('Approved visitors', 'स्वीकृत आगंतुक');
  String get hostelOpenComplaintsFig => _h('Open complaints', 'खुली शिकायतें');

  String get hostelSummary => _h('Summary', 'सारांश');
  String hostelSince(String day) => _h('since $day', '$day से');
  String hostelRoomMates(int n) => n == 0
      ? _h('no room-mate now', 'अभी कमरे में कोई साथी नहीं')
      : n == 1
      ? _h('1 room-mate', 'कमरे में 1 साथी')
      : _h('$n room-mates', 'कमरे में $n साथी');
  String get hostelInHostel => _h('In the hostel', 'छात्रावास में');
  String get hostelOnHomeLeave => _h('On home leave', 'घर की छुट्टी पर');
  String get hostelOnOuting => _h('On an outing', 'बाहर गया है');
  String hostelBackBy(String at) => _h('back by $at', '$at तक वापसी');
  String hostelBackOn(String at) => _h('back on $at', '$at को वापस आया');
  String hostelLate(int min) => _h('Late $min min', '$min मिनट देर');
  String hostelLastRoll(String label, String session, String day) => _h(
    'Last roll-call: $label · $session $day',
    'पिछली हाज़िरी: $label · $session $day',
  );
  String hostelRoll(String status, String fallback) => switch (status) {
    'present' => _h('Present', 'उपस्थित'),
    'absent' => _h('Absent', 'अनुपस्थित'),
    'on_leave' => _h('On leave', 'अवकाश पर'),
    'sick' => _h('Sick bay', 'बीमार-कक्ष में'),
    _ => fallback,
  };
  String hostelNextHome(String at) => _h('Next home leave: $at', 'अगली घर की छुट्टी: $at');
  String hostelNextOuting(String at) => _h('Next outing: $at', 'अगली बार बाहर जाना: $at');
  String get hostelWarden => _h('Warden', 'वार्डन');
  String get hostelHead => _h('head', 'मुख्य');
  String get hostelNoWarden => _h('No warden named yet.', 'अभी कोई वार्डन तय नहीं।');
  String hostelCall(String name) => _h('Call $name', '$name को फ़ोन करें');
  String hostelWhatsApp(String name) => _h('WhatsApp $name', '$name को WhatsApp करें');
  String get hostelTodayMeals => _h('Today’s meals', 'आज का भोजन');
  String get hostelSpecialToday => _h('Special today', 'आज विशेष');
  String hostelMeal(String name) => switch (name.trim().toLowerCase()) {
    'breakfast' => _h(name, 'नाश्ता'),
    'lunch' => _h(name, 'दोपहर का भोजन'),
    'snacks' => _h(name, 'नाश्ता (शाम)'),
    'dinner' => _h(name, 'रात का भोजन'),
    _ => name,
  };
  String get hostelAskHome => _h('Ask for home leave', 'घर की छुट्टी माँगें');
  String get hostelAskOuting => _h('Ask for an outing', 'बाहर जाने की अनुमति माँगें');
  String get hostelAddVisitor => _h('Add a visitor', 'आगंतुक जोड़ें');
  String get hostelRaiseComplaint => _h('Raise a complaint', 'शिकायत करें');
  String get hostelGatePass => _h('Gate pass', 'गेट पास');

  String get hostelNoPasses =>
      _h('No hostel leave or outing yet.', 'अभी तक छात्रावास से कोई छुट्टी या बाहर जाना नहीं।');
  String get hostelHomeLeave => _h('Home leave', 'घर की छुट्टी');
  String get hostelOuting => _h('Outing', 'बाहर जाना');
  String hostelPassState(String st) => switch (st) {
    'pending' => _h('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'approved' => _h('Approved', 'स्वीकृत'),
    'handed_over' => _h('Handed over', 'सौंपा गया'),
    'out' => _h('Out', 'बाहर'),
    'returned' => _h('Back', 'वापस आ गया'),
    'rejected' => _h('Not approved', 'स्वीकृत नहीं'),
    'cancelled' => _h('Cancelled', 'रद्द'),
    _ => st,
  };
  String hostelEarlier(int n) => _h('Earlier ($n)', 'पहले के ($n)');
  String get hostelTapToSee => _h('Tap to see them', 'देखने के लिए छुएँ');

  String get hostelVisitorsHelp => _h(
    'Only people on this list may visit your child, in the hostel’s visiting hours. Anyone else waits at the gate for the warden, and you are told.',
    'केवल इस सूची के लोग छात्रावास के मिलने के समय में आपके बच्चे से मिल सकते हैं। अन्य लोग गेट पर वार्डन की प्रतीक्षा करते हैं, और आपको सूचना दी जाती है।',
  );
  String get hostelOnRecord => _h('On the school record', 'स्कूल रिकॉर्ड में');
  String hostelVisitorStatus(String st) => switch (st) {
    'approved' => _h('Approved', 'स्वीकृत'),
    'pending' => _h('Waiting for the warden', 'वार्डन की प्रतीक्षा'),
    'rejected' => _h('Not approved', 'स्वीकृत नहीं'),
    _ => st,
  };
  String hostelRelationWord(String r) {
    final k = r.trim().toLowerCase();
    final hi = const {
      'father': 'पिता',
      'mother': 'माता',
      'guardian': 'अभिभावक',
      'grandfather': 'दादा / नाना',
      'grandmother': 'दादी / नानी',
      'brother': 'भाई',
      'sister': 'बहन',
      'uncle': 'चाचा / मामा',
      'aunt': 'चाची / मामी',
    }[k];
    if (hindi && hi != null) return hi;
    return k.isEmpty ? r : '${r.trim()[0].toUpperCase()}${r.trim().substring(1)}';
  }

  String hostelRemoveWho(String name) => _h('Remove $name', '$name को हटाएँ');
  String hostelRemoveAsk(String name) => _h(
    'Remove $name from the list? They can then no longer visit your child.',
    '$name को सूची से हटाएँ? फिर वे आपके बच्चे से मिलने नहीं आ सकेंगे।',
  );
  String get hostelRemoved => _h('Removed from the list.', 'सूची से हटाया गया।');
  String get hostelNoVisitors => _h('No one on the list yet.', 'सूची में अभी कोई नहीं।');
  String hostelPhotoOf(String name) => _h('Photo of $name', '$name की फ़ोटो');
  String get hostelName => _h('Name', 'नाम');
  String get hostelRelation => _h('Relation to the child', 'बच्चे से संबंध');
  String get hostelMobile => _h('Mobile', 'मोबाइल');
  String get hostelMobileHelp => _h('10 digits', '10 अंक');
  String get hostelPhoto => _h('Photo (helps the gate)', 'फ़ोटो (गेट पर पहचान में मदद)');
  String get hostelPhotoHelp => _h('A JPEG or PNG under 300 KB.', '300 KB से छोटी JPEG या PNG।');
  String get hostelAddPhoto => _h('Add a photo', 'फ़ोटो जोड़ें');
  String get hostelChangePhoto => _h('Change the photo', 'फ़ोटो बदलें');
  String get hostelRemovePhoto => _h('Remove the photo', 'फ़ोटो हटाएँ');
  String get hostelPhotoBad =>
      _h('Choose a JPEG or PNG photo under 300 KB.', '300 KB से छोटी JPEG या PNG फ़ोटो चुनें।');
  String get hostelAddToList => _h('Add to the list', 'सूची में जोड़ें');
  String get hostelAdded =>
      _h('Added. The warden will approve the visitor.', 'जोड़ा गया। वार्डन आगंतुक को स्वीकृत करेंगे।');
  String get hostelAddHelp => _h(
    'The warden approves the visitor; until then they wait at the gate.',
    'वार्डन आगंतुक को स्वीकृत करेंगे; तब तक वे गेट पर प्रतीक्षा करेंगे।',
  );
  String get hostelNameShort =>
      _h('Write the name (at least 2 letters).', 'नाम लिखें (कम से कम 2 अक्षर)।');
  String get hostelRelationShort =>
      _h('Write how they are related to the child.', 'लिखें कि वे बच्चे के क्या लगते हैं।');
  String get hostelMobileWrong => _h(
    'Write a 10-digit mobile number that starts with 6, 7, 8 or 9.',
    '6, 7, 8 या 9 से शुरू होने वाला 10 अंकों का मोबाइल नंबर लिखें।',
  );

  String get hostelMessMenu => _h('Mess menu', 'भोजन मेनू');
  String hostelWeekOf(String day) => _h('Week of $day', '$day से शुरू सप्ताह');
  String get hostelPrevWeek => _h('Previous week', 'पिछला सप्ताह');
  String get hostelNextWeek => _h('Next week', 'अगला सप्ताह');
  String get hostelThisWeek => _h('Back to this week', 'इस सप्ताह पर लौटें');
  String get hostelNoMenu =>
      _h('The hostel has not put up its menu yet.', 'छात्रावास ने अभी मेनू नहीं डाला है।');
  String hostelDiet(String code, String? name) {
    final known = switch (code) {
      'veg' => _h('Vegetarian', 'शाकाहारी'),
      'non_veg' => _h('Non-vegetarian', 'मांसाहारी'),
      'eggetarian' => _h('Vegetarian with egg', 'अंडे सहित शाकाहारी'),
      'jain' => _h('Jain', 'जैन'),
      'vegan' => _h('Vegan', 'वीगन'),
      _ => null,
    };
    // the school's own name for the diet, but ours in Hindi when we know it
    if (name != null && name.trim().isNotEmpty && !(hindi && known != null)) return name;
    return known ?? code;
  }

  String get hostelNoOnion => _h('no onion or garlic', 'बिना प्याज़-लहसुन');
  String hostelAllergy(String a) => _h('Allergy: $a', 'एलर्जी: $a');
  String get hostelSpecial => _h('Special', 'विशेष');
  String hostelMealsN(int n) => _h(n == 1 ? '1 meal' : '$n meals', '$n भोजन');
  String get hostelSpecialMeal => _h('A special meal', 'विशेष भोजन');
  String get hostelRateTitle => _h('Rate the meals', 'भोजन की रेटिंग दें');
  String get hostelRateHelp => _h(
    'How was the food? Rate the meals of the last three days (1 poor, 5 very good).',
    'भोजन कैसा था? पिछले तीन दिनों के भोजन की रेटिंग दें (1 खराब, 5 बहुत अच्छा)।',
  );
  String hostelToRate(int n, int all) => n == 0
      ? _h('All $all rated', 'सभी $all की रेटिंग दी गई')
      : _h('$n of $all to rate', '$all में से $n की रेटिंग बाकी');
  String get hostelRate => _h('Rate', 'रेटिंग दें');
  String get hostelChangeRating => _h('Change', 'बदलें');
  String hostelRateWho(String meal, String day) =>
      _h('Rate $meal, $day', '$meal ($day) की रेटिंग दें');
  String hostelStars(int n) => _h('$n of 5', '5 में से $n');
  String hostelStarLabel(int n) {
    final words = hindi
        ? const ['खराब', 'औसत से कम', 'ठीक-ठाक', 'अच्छा', 'बहुत अच्छा']
        : const ['poor', 'below average', 'fair', 'good', 'very good'];
    return '${hostelStars(n)}: ${words[(n - 1).clamp(0, 4)]}';
  }

  String get hostelRating => _h('Rating', 'रेटिंग');
  String get hostelComment => _h('Comment (optional)', 'टिप्पणी (वैकल्पिक)');
  String get hostelChooseRating => _h('Choose a rating from 1 to 5.', '1 से 5 तक रेटिंग चुनें।');
  String get hostelRated =>
      _h('Thank you. The warden sees your rating.', 'धन्यवाद। वार्डन आपकी रेटिंग देखते हैं।');

  String get hostelComplaintsHelp => _h(
    'Something wrong in your child’s room (a fan, water, furniture, cleaning, food)? Tell the warden here.',
    'बच्चे के कमरे में कोई समस्या (पंखा, पानी, फ़र्नीचर, सफ़ाई, भोजन)? यहाँ वार्डन को बताएँ।',
  );
  String hostelComplaintStatus(String st) => switch (st) {
    'open' => _h('Open', 'खुली'),
    'in_progress' => _h('Being worked on', 'काम चल रहा है'),
    'answered' => _h('Answered', 'उत्तर दिया'),
    'closed' => _h('Closed', 'बंद'),
    _ => st,
  };
  String hostelResolution(String x) => _h('Resolution: $x', 'समाधान: $x');
  String get hostelNoComplaints => _h('No complaint raised.', 'कोई शिकायत दर्ज नहीं।');
  String hostelClosedN(int n) => _h('Closed ($n)', 'बंद ($n)');
  String get hostelAbout => _h('About', 'किस बारे में');
  String get hostelChooseHead =>
      _h('Choose what the complaint is about.', 'चुनें कि शिकायत किस बारे में है।');
  String get hostelSubjectShort =>
      _h('Write a subject (at least 3 letters).', 'विषय लिखें (कम से कम 3 अक्षर)।');
  String get hostelDetailsShort =>
      _h('Write the details (at least 3 letters).', 'विवरण लिखें (कम से कम 3 अक्षर)।');
  String get hostelRaiseTheComplaint => _h('Raise the complaint', 'शिकायत दर्ज करें');
  String get hostelComplaintRaised => _h(
    'Complaint raised. The warden will look into it.',
    'शिकायत दर्ज हुई। वार्डन इसे देखेंगे।',
  );
  String get hostelNoHeads => _h(
    'The hostel takes no complaints in the app yet.',
    'छात्रावास अभी ऐप में शिकायतें नहीं लेता।',
  );

  String hostelCategory(String c) => switch (c) {
    'discipline' => _h('Discipline', 'अनुशासन'),
    'health' => _h('Health', 'स्वास्थ्य'),
    'safety' => _h('Safety', 'सुरक्षा'),
    'property' => _h('Property', 'संपत्ति'),
    'other' => _h('Other', 'अन्य'),
    _ => c,
  };
  String hostelActionTaken(String x) => _h('Action taken: $x', 'की गई कार्रवाई: $x');
  String get hostelNoNotes => _h('Nothing from the hostel yet.', 'अभी छात्रावास से कुछ नहीं।');

  String get hostelExitHelp => _h(
    'Want your child to leave the hostel and stay in school as a day scholar? Ask here; the hostel office checks the room and the dues and starts it.',
    'क्या आप चाहते हैं कि बच्चा छात्रावास छोड़कर डे-स्कॉलर के रूप में विद्यालय में पढ़े? यहाँ अनुरोध करें; छात्रावास कार्यालय कमरा और बकाया जाँचकर इसे शुरू करेगा।',
  );
  String hostelRequestLastDay(String d) => _h('Request · last day $d', 'अनुरोध · अंतिम दिन $d');
  String hostelWithdrawalLastDay(String d) =>
      _h('Hostel withdrawal · last day $d', 'छात्रावास से नाम वापसी · अंतिम दिन $d');
  String hostelOfficeReplied(String x) =>
      _h('The hostel office replied: $x', 'छात्रावास कार्यालय का उत्तर: $x');
  String hostelRequestStatus(String st) => switch (st) {
    'pending' => _h('Waiting for the office', 'कार्यालय की प्रतीक्षा'),
    'started' => _h('Started by the office', 'कार्यालय ने शुरू किया'),
    'declined' => _h('Not taken up', 'आगे नहीं बढ़ाया गया'),
    _ => _h('Taken back', 'वापस लिया गया'),
  };
  String hostelWithdrawalStatus(String st) => switch (st) {
    'completed' => _h('Left the hostel', 'छात्रावास छोड़ दिया'),
    'requested' => _h('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'rejected' => _h('Not approved', 'स्वीकृत नहीं'),
    'revoked' => _h('Revoked: back in the hostel', 'रद्द: छात्रावास में वापस'),
    _ => _h('Cancelled', 'रद्द'),
  };
  String get hostelTakeBack => _h('Take back', 'वापस लें');
  String get hostelTakeBackAsk => _h(
    'Take back this request to leave the hostel?',
    'छात्रावास छोड़ने का यह अनुरोध वापस लें?',
  );
  String get hostelTakenBack => _h('Your request is taken back.', 'आपका अनुरोध वापस ले लिया गया।');
  String get hostelAskToLeave => _h('Ask to leave the hostel', 'छात्रावास छोड़ने का अनुरोध करें');
  String get hostelLastDay => _h('Last day in the hostel', 'छात्रावास में अंतिम दिन');
  String hostelReason(String code) => switch (code) {
    'health' => _h('Health', 'स्वास्थ्य'),
    'other' => _h('Other', 'अन्य'),
    _ => _h('Our own reasons', 'हमारे अपने कारण'),
  };
  String get hostelNoteOffice => _h('Note for the hostel office', 'छात्रावास कार्यालय के लिए टिप्पणी');
  String get hostelSendRequest => _h('Send the request', 'अनुरोध भेजें');
  String get hostelExitSent => _h(
    'Your request is sent. The hostel office will start the withdrawal or reply here.',
    'आपका अनुरोध भेज दिया गया। छात्रावास कार्यालय नाम वापसी शुरू करेगा या यहाँ उत्तर देगा।',
  );
  String get hostelChooseDay =>
      _h('Choose the last day in the hostel.', 'छात्रावास में अंतिम दिन चुनें।');
  String get hostelNoExit =>
      _h('No request to leave the hostel.', 'छात्रावास छोड़ने का कोई अनुरोध नहीं।');
}

// ------------------------------------------------------------------------------------------------ helpers

Tone _passTone(String st) => switch (st) {
  'pending' => Tone.warning,
  'approved' => Tone.success,
  'handed_over' || 'out' => Tone.info,
  'rejected' => Tone.danger,
  _ => Tone.neutral,
};

Tone _visitorTone(String st) => switch (st) {
  'approved' => Tone.success,
  'pending' => Tone.warning,
  _ => Tone.danger,
};

Tone _complaintTone(String st) => switch (st) {
  'open' => Tone.warning,
  'in_progress' => Tone.info,
  'answered' => Tone.success,
  _ => Tone.neutral,
};

Tone _requestTone(String st) => switch (st) {
  'pending' => Tone.warning,
  'started' => Tone.success,
  _ => Tone.neutral,
};

Tone _withdrawalTone(String st) => switch (st) {
  'completed' => Tone.success,
  'requested' => Tone.warning,
  _ => Tone.neutral,
};

Tone _ratingTone(int r) => r >= 4
    ? Tone.success
    : r >= 3
    ? Tone.warning
    : Tone.danger;

/// 19 Nov 2026, 18:00 from a stamp (the phone's own time).
String _stamp(S s, Object? v) {
  final t = DateTime.tryParse('${v ?? ''}');
  return t == null ? '${v ?? ''}' : s.dateTime(t);
}

/// 19 Nov 2026 from a stamp (the phone's own day).
String _on(S s, Object? v) {
  final t = DateTime.tryParse('${v ?? ''}');
  return t == null ? '${v ?? ''}' : s.date(t.toLocal());
}

/// `2026-11-23` from `2026-11-16` and 7.
String _shift(String iso, int days) {
  final d = DateTime.tryParse(iso) ?? DateTime.now();
  return ymd(DateTime(d.year, d.month, d.day + days));
}

String _mondayOf(DateTime d) => ymd(DateTime(d.year, d.month, d.day - (d.weekday - 1)));

String _str(Object? v) => v == null ? '' : '$v'.trim();

/// A long part of the page folded in a card until tapped (earlier passes, closed complaints …).
Widget _fold(
  BuildContext context, {
  required String id,
  required String title,
  required String hint,
  required List<Widget> children,
  IconData icon = Icons.history_outlined,
}) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return Card(
    clipBehavior: Clip.antiAlias,
    child: ExpansionTile(
      key: Key(id),
      leading: Icon(icon),
      title: Text(title, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
      subtitle: Text(
        hint,
        style: TextStyle(color: (dark ? Tokens.mobGray300 : Tokens.textMuted), fontSize: 13),
      ),
      shape: const Border(),
      collapsedShape: const Border(),
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

// ------------------------------------------------------------------------------------------------ the screen

/// The child's hostel as the website shows it (apps/parent/app/(app)/hostel), on the phone: the hostel's name, the
/// figures (room, where the child is now, approved visitors, open complaints), the summary (since when and with
/// whom, back by, the last roll-call, the next leave, the wardens to call or WhatsApp, today's meals, the quick
/// asks) and six parts to pick from: **Leave and outings** (the gate passes; asking for one opens the website's
/// gate-pass page), **Visitors** (the approved list; add one with a photo, remove one), **Mess** (the week's menu
/// day by day, the diet, the meals to rate), **Complaints** (raise one, follow them), **From the hostel** (what the
/// hostel shared) and **Leaving the hostel** (ask, take a request back, the clearance certificate). A child who does
/// not board sees that, or when they left, with the clearance certificate.
class HostelScreen extends ConsumerStatefulWidget {
  const HostelScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<HostelScreen> createState() => _HostelScreenState();
}

class _HostelScreenState extends ConsumerState<HostelScreen> {
  static const _tabs = ['leave', 'visitors', 'mess', 'complaints', 'notes', 'leaving'];
  static const _passOpen = ['pending', 'approved', 'handed_over', 'out'];

  String _tab = 'leave';

  /// the week of the mess menu shown (null: this week, loaded with the page)
  String? _week;
  String? _message;
  String? _error;

  Profile get _p => widget.profile;
  String get _id => _p.studentId ?? '';

  void _done(String? message, {String? error, String? tab}) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _error = error;
      if (tab != null) _tab = tab;
    });
    ref.invalidate(hostelProvider(_p));
    if (_week != null) ref.invalidate(hostelWeekProvider((_p, _week!)));
  }

  Future<bool> _confirm(String text, String yes, String key) async {
    final s = ref.read(stringsProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(text),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.close)),
          FilledButton(
            key: Key(key),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(yes),
          ),
        ],
      ),
    );
    return ok == true;
  }

  /// A website page (the gate passes); the page is loaded again on the way back.
  Future<void> _web(String to, String title) async {
    await ref.read(hostelWebProvider)(context, _p, to, title);
    if (mounted) ref.invalidate(hostelProvider(_p));
  }

  void _gatePass(String kind) {
    final s = ref.read(stringsProvider);
    _web(
      '/gate-passes/new?student=${Uri.encodeQueryComponent(_id)}&kind=$kind',
      kind == 'hostel_home' ? s.hostelAskHome : s.hostelAskOuting,
    );
  }

  void _addVisitor() {
    final s = ref.read(stringsProvider);
    pushPage(
      context,
      s.hostelAddVisitor,
      _VisitorForm(profile: _p, onSent: (m) => _done(m, tab: 'visitors')),
    );
  }

  void _raise(List<Json> heads) {
    final s = ref.read(stringsProvider);
    pushPage(
      context,
      s.hostelRaiseComplaint,
      _ComplaintForm(profile: _p, heads: heads, onSent: (m) => _done(m, tab: 'complaints')),
    );
  }

  void _rate(Json meal) {
    final s = ref.read(stringsProvider);
    pushPage(
      context,
      s.hostelRateTitle,
      _RateForm(profile: _p, meal: meal, onSent: (m) => _done(m, tab: 'mess')),
    );
  }

  void _askExit() {
    final s = ref.read(stringsProvider);
    pushPage(
      context,
      s.hostelAskToLeave,
      _ExitForm(profile: _p, onSent: (m) => _done(m, tab: 'leaving')),
    );
  }

  Future<void> _remove(Json v) async {
    final s = ref.read(stringsProvider);
    if (!await _confirm(s.hostelRemoveAsk(_str(v['name'])), s.remove, 'confirmRemoveVisitor')) {
      return;
    }
    try {
      await ref.read(apiProvider).hostelH3FamilyRemove(id: '${v['id']}');
      _done(s.hostelRemoved, tab: 'visitors');
    } catch (e) {
      _done(null, error: errorText(s, e));
    }
  }

  Future<void> _takeBack(Json r) async {
    final s = ref.read(stringsProvider);
    if (!await _confirm(s.hostelTakeBackAsk, s.hostelTakeBack, 'confirmTakeBack')) return;
    try {
      await ref.read(apiProvider).hostelExitFamilyWithdraw(id: '${r['id']}');
      _done(s.hostelTakenBack, tab: 'leaving');
    } catch (e) {
      _done(null, error: errorText(s, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return LoadedList<Json>(
      value: ref.watch(hostelProvider(_p)),
      refresh: () {
        if (_week != null) ref.invalidate(hostelWeekProvider((_p, _week!)));
        return ref.refresh(hostelProvider(_p).future);
      },
      children: (d) => _page(s, d),
    );
  }

  List<Widget> _page(S s, Json d) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final menu = asJson(d['menu']);
    final hostel = menu['hostel'] is Map ? asJson(menu['hostel']) : null;
    final exit = d['exit'] is Map ? asJson(d['exit']) : null;
    final sum = asJson(d['summary']);
    final head = [
      Text(
        hostel == null ? s.hostelTitle : _str(hostel['name']),
        key: const Key('hostelName'),
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
      ),
      Text(s.hostelIntro, style: TextStyle(color: muted, fontSize: 14)),
      const SizedBox(height: Tokens.sp3),
      if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
      if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
    ];
    if (hostel == null) return [...head, _notBoarder(s, menu, exit)];

    final visitors = asJson(d['visitors']);
    final onRecord = asList(visitors['onRecord']);
    final added = asList(visitors['visitors']);
    final complaints = asList(d['complaints']);
    final heads = asList(d['heads']);
    final stay = sum['boarder'] == true && sum['stay'] is Map ? asJson(sum['stay']) : null;
    final now = asJson(sum['now']);
    final approved = onRecord.length + added.where((v) => v['status'] == 'approved').length;
    final open = complaints
        .where((c) => c['status'] == 'open' || c['status'] == 'in_progress')
        .length;
    final late = now['late'] == true;
    final nowWord = switch (now['state']) {
      'in_hostel' => s.hostelInHostel,
      'home_leave' => s.hostelOnHomeLeave,
      'outing' => s.hostelOnOuting,
      _ => '—',
    };
    void go(String tab) => setState(() => _tab = tab);
    return [
      ...head,
      FigureGrid(
        key: const Key('hostelFigures'),
        tiles: [
          if (stay != null) ...[
            FigureTile(
              label: s.hostelRoomFig,
              value: [
                if (_str(stay['block']).isNotEmpty) _str(stay['block']),
                '${_str(stay['room'])} / ${_str(stay['bed'])}',
              ].join(' · '),
              icon: Icons.bed_outlined,
            ),
            FigureTile(
              label: s.hostelNowFig,
              value: nowWord,
              icon: Icons.place_outlined,
              tone: now['state'] == 'in_hostel'
                  ? Tokens.statusSuccess
                  : late
                  ? Tokens.statusDanger
                  : Tokens.statusInfo,
              onTap: () => go('leave'),
            ),
          ],
          FigureTile(
            label: s.hostelVisitorsFig,
            value: '$approved',
            icon: Icons.people_outline,
            tone: Tokens.statusSuccess,
            onTap: () => go('visitors'),
          ),
          FigureTile(
            label: s.hostelOpenComplaintsFig,
            value: '$open',
            icon: Icons.report_problem_outlined,
            tone: open > 0 ? Tokens.statusWarning : null,
            onTap: () => go('complaints'),
          ),
        ],
      ),
      if (stay != null) ...[
        const SizedBox(height: Tokens.sp3),
        _summary(s, muted, sum, stay, nowWord, heads),
      ],
      const SizedBox(height: Tokens.sp3),
      Semantics(
        label: s.hostelTitle,
        container: true,
        explicitChildNodes: true,
        child: Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final t in _tabs)
              ChoiceChip(
                key: Key('hostelTab-$t'),
                label: Text(switch (t) {
                  'visitors' => s.hostelTabVisitors,
                  'mess' => s.hostelTabMess,
                  'complaints' => s.hostelTabComplaints,
                  'notes' => s.hostelTabNotes,
                  'leaving' => s.hostelTabLeaving,
                  _ => s.hostelTabLeave,
                }),
                selected: _tab == t,
                showCheckmark: false,
                onSelected: (_) => go(t),
              ),
          ],
        ),
      ),
      ...switch (_tab) {
        'visitors' => _visitors(s, muted, onRecord, added),
        'mess' => _mess(s, muted, menu, asList(d['feedback'])),
        'complaints' => _complaints(s, muted, complaints, heads),
        'notes' => _notes(s, muted, asList(d['incidents'])),
        'leaving' => _leaving(s, muted, exit),
        _ => _leave(s, muted, asList(sum['passes'])),
      },
    ];
  }

  // ---------------------------------------------------------------- not boarding

  Widget _notBoarder(S s, Json menu, Json? exit) {
    final left = menu['left'] is Map ? asJson(menu['left']) : null;
    final feeUntil = DateTime.tryParse(_str(left?['feeUntil']));
    final done = asList(exit?['withdrawals']).where((w) => w['status'] == 'completed').toList();
    return Card(
      key: const Key('hostelNone'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              left == null
                  ? s.hostelNotBoarder
                  : s.hostelLeftOn(s.date(_str(left['on'])), _str(left['hostel'])),
            ),
            if (feeUntil != null) Text(s.hostelFeeUntil(s.month(feeUntil))),
            for (final w in done) ...[
              const SizedBox(height: Tokens.sp2),
              _clearance(s, w),
            ],
          ],
        ),
      ),
    );
  }

  /// The clearance certificate of a completed hostel withdrawal: View and Download.
  Widget _clearance(S s, Json w) => Row(
    children: [
      Expanded(
        child: Text(s.hostelClearance, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
      ),
      FileIcons(
        name: 'clearance-${w['id']}',
        label: s.hostelClearance,
        load: () => ref.read(apiProvider).hostelExitFamilyCertificate(id: '${w['id']}'),
      ),
    ],
  );

  // ---------------------------------------------------------------- summary

  Widget _summary(S s, Color muted, Json sum, Json stay, String nowWord, List<Json> heads) {
    final now = asJson(sum['now']);
    final next = sum['next'] is Map ? asJson(sum['next']) : null;
    final roll = sum['lastRoll'] is Map ? asJson(sum['lastRoll']) : null;
    final wardens = asList(sum['wardens']).take(2).toList();
    final meals = asList(sum['todayMenu']);
    final away = now['state'] != null && now['state'] != 'in_hostel';
    final strong = const TextStyle(fontWeight: Tokens.fwSemibold);
    final small = TextStyle(color: muted, fontSize: 14);
    return Card(
      key: const Key('hostelSummary'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Semantics(
          label: s.hostelSummary,
          container: true,
          explicitChildNodes: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${s.hostelSince(s.dayShort(_str(stay['since'])))} · '
                '${s.hostelRoomMates(((stay['roomMates'] as num?) ?? 0).toInt())}',
              ),
              if (away) ...[
                const SizedBox(height: Tokens.sp2),
                StatusChip(
                  [
                    nowWord,
                    if (now['returnBy'] != null) s.hostelBackBy(_stamp(s, now['returnBy'])),
                  ].join(' · '),
                  now['late'] == true ? Tone.danger : Tone.info,
                ),
              ],
              if (roll != null)
                Padding(
                  padding: const EdgeInsets.only(top: Tokens.sp1),
                  child: Text(
                    s.hostelLastRoll(
                      s.hostelRoll(_str(roll['status']), _str(roll['label'])),
                      _str(roll['session']),
                      s.dayShort(_str(roll['on'])),
                    ),
                    key: const Key('hostelLastRoll'),
                    style: small,
                  ),
                ),
              if (next != null)
                Text(
                  () {
                    final at =
                        '${s.dayShort(_str(next['onDate']))}'
                        '${_str(next['atTime']).isEmpty ? '' : ' ${_str(next['atTime'])}'}';
                    return next['kind'] == 'hostel_home'
                        ? s.hostelNextHome(at)
                        : s.hostelNextOuting(at);
                  }(),
                  key: const Key('hostelNext'),
                  style: small,
                ),
              const Divider(height: Tokens.sp5),
              Text(s.hostelWarden, style: strong),
              if (wardens.isEmpty) Text(s.hostelNoWarden, style: small),
              for (final (i, w) in wardens.indexed) _warden(s, muted, i, w),
              if (meals.isNotEmpty) ...[
                const Divider(height: Tokens.sp5),
                Text(s.hostelTodayMeals, style: strong),
                for (final m in meals)
                  Padding(
                    padding: const EdgeInsets.only(top: Tokens.sp2),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${s.hostelMeal(_str(m['meal']))} · ${_str(m['atTime'])}',
                          style: TextStyle(color: muted, fontSize: 13),
                        ),
                        Text(_str(m['items']).isEmpty ? '—' : _str(m['items'])),
                        if (m['changed'] == true)
                          Text(s.hostelSpecialToday, style: TextStyle(color: muted, fontSize: 13)),
                      ],
                    ),
                  ),
              ],
              const Divider(height: Tokens.sp5),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  FilledButton(
                    key: const Key('askHomeLeave'),
                    onPressed: () => _gatePass('hostel_home'),
                    child: Text(s.hostelAskHome),
                  ),
                  OutlinedButton(
                    key: const Key('askOuting'),
                    onPressed: () => _gatePass('hostel_outing'),
                    child: Text(s.hostelAskOuting),
                  ),
                  OutlinedButton(
                    key: const Key('quickAddVisitor'),
                    onPressed: _addVisitor,
                    child: Text(s.hostelAddVisitor),
                  ),
                  OutlinedButton(
                    key: const Key('quickRaiseComplaint'),
                    onPressed: () => _raise(heads),
                    child: Text(s.hostelRaiseComplaint),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _warden(S s, Color muted, int i, Json w) {
    final name = _str(w['name']);
    final mobile = _str(w['mobile']);
    final digits = mobile.replaceAll(RegExp(r'\D'), '');
    final launch = ref.read(hostelLaunchProvider);
    return Row(
      key: Key('warden-$i'),
      children: [
        Expanded(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: name, style: const TextStyle(fontWeight: Tokens.fwBold)),
                if (w['isHead'] == true)
                  TextSpan(
                    text: ' (${s.hostelHead})',
                    style: TextStyle(color: muted),
                  ),
              ],
            ),
          ),
        ),
        if (digits.isNotEmpty) ...[
          IconButton(
            key: Key('callWarden-$i'),
            tooltip: s.hostelCall(name),
            icon: const Icon(Icons.call_outlined),
            onPressed: () => launch(Uri(scheme: 'tel', path: mobile)),
          ),
          IconButton(
            key: Key('whatsappWarden-$i'),
            tooltip: s.hostelWhatsApp(name),
            icon: const Icon(Icons.chat_outlined),
            onPressed: () => launch(
              Uri.parse(
                'https://wa.me/91${digits.length > 10 ? digits.substring(digits.length - 10) : digits}',
              ),
            ),
          ),
        ],
      ],
    );
  }

  // ---------------------------------------------------------------- leave and outings

  List<Widget> _leave(S s, Color muted, List<Json> passes) {
    final open = passes.where((x) => _passOpen.contains(x['state'])).toList();
    final closed = passes.where((x) => !_passOpen.contains(x['state'])).toList();
    return [
      SectionTitle(s.hostelTabLeave),
      if (passes.isEmpty) EmptyLine(s.hostelNoPasses),
      for (final x in open) Card(child: _pass(s, muted, x)),
      if (closed.isNotEmpty)
        _fold(
          context,
          id: 'earlierPasses',
          title: s.hostelEarlier(closed.length),
          hint: s.hostelTapToSee,
          children: [for (final x in closed) _pass(s, muted, x)],
        ),
      const SizedBox(height: Tokens.sp3),
      Wrap(
        spacing: Tokens.sp2,
        runSpacing: Tokens.sp2,
        children: [
          FilledButton.icon(
            key: const Key('askHomeLeave2'),
            icon: const Icon(Icons.home_outlined),
            label: Text(s.hostelAskHome),
            onPressed: () => _gatePass('hostel_home'),
          ),
          OutlinedButton.icon(
            key: const Key('askOuting2'),
            icon: const Icon(Icons.directions_walk),
            label: Text(s.hostelAskOuting),
            onPressed: () => _gatePass('hostel_outing'),
          ),
        ],
      ),
    ];
  }

  Widget _pass(S s, Color muted, Json x) {
    final state = _str(x['state']);
    final late = ((x['lateMinutes'] as num?) ?? 0).toInt();
    final at = _str(x['atTime']);
    return Padding(
      key: Key('pass-${x['id']}'),
      padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp3, Tokens.sp4, Tokens.sp2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${x['kind'] == 'hostel_home' ? s.hostelHomeLeave : s.hostelOuting} · '
            '${s.dayShort(_str(x['onDate']))}${at.isEmpty ? '' : ' $at'}',
            style: const TextStyle(fontWeight: Tokens.fwBold),
          ),
          Text(
            [
              _str(x['number']),
              if (x['returnBy'] != null) s.hostelBackBy(_stamp(s, x['returnBy'])),
              if (x['inAt'] != null) s.hostelBackOn(_stamp(s, x['inAt'])),
            ].where((t) => t.isNotEmpty).join(' · '),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (_str(x['reason']).isNotEmpty) Text(_str(x['reason'])),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusChip(s.hostelPassState(state), _passTone(state)),
              if (late > 0) StatusChip(s.hostelLate(late), Tone.danger),
              TextButton(
                key: Key('openPass-${x['id']}'),
                onPressed: () => _web('/gate-passes/${x['id']}', s.hostelGatePass),
                child: Text(s.open),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- visitors

  List<Widget> _visitors(S s, Color muted, List<Json> onRecord, List<Json> added) {
    Widget card(Key key, Widget photo, String name, String line, Widget chip, [Widget? action]) =>
        Card(
          key: key,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Tokens.sp3, Tokens.sp3, Tokens.sp1, Tokens.sp3),
            child: Row(
              children: [
                photo,
                const SizedBox(width: Tokens.sp3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: const TextStyle(fontWeight: Tokens.fwBold)),
                      Text(line, style: TextStyle(color: muted, fontSize: 13)),
                      const SizedBox(height: Tokens.sp1),
                      chip,
                    ],
                  ),
                ),
                ?action,
              ],
            ),
          ),
        );
    return [
      SectionTitle(s.hostelVisitorsFig),
      Text(s.hostelVisitorsHelp, style: TextStyle(color: muted, fontSize: 14)),
      const SizedBox(height: Tokens.sp3),
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: FilledButton.icon(
          key: const Key('addVisitor'),
          icon: const Icon(Icons.person_add_alt_outlined),
          label: Text(s.hostelAddVisitor),
          onPressed: _addVisitor,
        ),
      ),
      const SizedBox(height: Tokens.sp2),
      if (onRecord.isEmpty && added.isEmpty) EmptyLine(s.hostelNoVisitors),
      for (final (i, g) in onRecord.indexed)
        card(
          Key('onRecord-$i'),
          const _Face(),
          _str(g['name']),
          '${s.hostelRelationWord(_str(g['relation']))} · ${_str(g['mobile']).isEmpty ? '—' : _str(g['mobile'])}',
          StatusChip(s.hostelOnRecord, Tone.success),
        ),
      for (final v in added)
        card(
          Key('visitor-${v['id']}'),
          v['hasPhoto'] == true
              ? _VisitorPhoto(id: '${v['id']}', name: _str(v['name']))
              : const _Face(),
          _str(v['name']),
          [
            // as the family wrote it (the website translates only the parents' relation on record)
            _str(v['relation']),
            _str(v['mobile']),
            if (_str(v['note']).isNotEmpty) _str(v['note']),
          ].join(' · '),
          StatusChip(s.hostelVisitorStatus(_str(v['status'])), _visitorTone(_str(v['status']))),
          IconButton(
            key: Key('removeVisitor-${v['id']}'),
            tooltip: s.hostelRemoveWho(_str(v['name'])),
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _remove(v),
          ),
        ),
    ];
  }

  // ---------------------------------------------------------------- mess

  List<Widget> _mess(S s, Color muted, Json menu, List<Json> rate) {
    final week = _week;
    final toRate = rate.where((m) => m['rating'] == null).length;
    return [
      SectionTitle(s.hostelMessMenu),
      if (week == null)
        ..._weekView(s, muted, menu)
      else
        Consumer(
          builder: (context, ref, _) => switch (ref.watch(hostelWeekProvider((_p, week)))) {
            AsyncValue(:final value?) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (value.stale) ...[StaleLine(at: value.at), const SizedBox(height: Tokens.sp2)],
                ..._weekView(s, muted, value.data),
              ],
            ),
            AsyncValue(:final error?) => Column(
              children: [
                ErrorText(errorText(s, error)),
                TextButton(
                  onPressed: () => ref.invalidate(hostelWeekProvider((_p, week))),
                  child: Text(s.retry),
                ),
                TextButton(
                  key: const Key('thisWeek'),
                  onPressed: () => setState(() => _week = null),
                  child: Text(s.hostelThisWeek),
                ),
              ],
            ),
            _ => Padding(
              padding: const EdgeInsets.all(Tokens.sp4),
              child: Center(
                child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
              ),
            ),
          },
        ),
      if (rate.isNotEmpty) ...[
        SectionTitle(s.hostelRateTitle),
        Text(s.hostelRateHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp2),
        _fold(
          context,
          id: 'rateMeals',
          title: s.hostelRateTitle,
          hint: s.hostelToRate(toRate, rate.length),
          icon: Icons.star_outline,
          children: [for (final m in rate) _rateRow(s, muted, m)],
        ),
      ],
    ];
  }

  List<Widget> _weekView(S s, Color muted, Json menu) {
    final week = menu['week'] is Map ? asJson(menu['week']) : null;
    final diet = menu['diet'] is Map ? asJson(menu['diet']) : null;
    final weekOf = _str(week?['weekOf']).isEmpty
        ? _mondayOf(DateTime.now())
        : _str(week?['weekOf']);
    final meals = asList(week?['meals']);
    final mealOf = {for (final m in meals) '${m['id']}': m};
    final today = ymd(DateTime.now());
    final allergies = [for (final a in (diet?['allergies'] as List? ?? const [])) '$a'];
    return [
      Row(
        children: [
          IconButton(
            key: const Key('prevWeek'),
            tooltip: s.hostelPrevWeek,
            icon: const Icon(Icons.chevron_left),
            onPressed: () => setState(() => _week = _shift(weekOf, -7)),
          ),
          Expanded(
            child: Text(
              s.hostelWeekOf(s.dayShort(weekOf)),
              key: const Key('weekOf'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: Tokens.fwSemibold),
            ),
          ),
          IconButton(
            key: const Key('nextWeek'),
            tooltip: s.hostelNextWeek,
            icon: const Icon(Icons.chevron_right),
            onPressed: () => setState(() => _week = _shift(weekOf, 7)),
          ),
        ],
      ),
      if (_week != null)
        Center(
          child: TextButton(
            key: const Key('thisWeek'),
            onPressed: () => setState(() => _week = null),
            child: Text(s.hostelThisWeek),
          ),
        ),
      if (diet != null) ...[
        const SizedBox(height: Tokens.sp2),
        Wrap(
          key: const Key('hostelDiet'),
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp1,
          children: [
            StatusChip(
              [
                s.hostelDiet(_str(diet['diet']), diet['dietName'] as String?),
                if (diet['noOnionGarlic'] == true) s.hostelNoOnion,
              ].join(' · '),
              Tone.info,
            ),
            for (final a in allergies) StatusChip(s.hostelAllergy(a), Tone.danger),
          ],
        ),
        if (_str(diet['notes']).isNotEmpty)
          Text(_str(diet['notes']), style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp2),
      ],
      if (week == null || meals.isEmpty)
        EmptyLine(s.hostelNoMenu)
      else
        for (final day in asList(week['days'])) _day(s, muted, day, mealOf, today),
    ];
  }

  /// A day of the week's menu, folded but for today: each meal with its time, what is on it and a special.
  Widget _day(S s, Color muted, Json day, Map<String, Json> mealOf, String today) {
    final date = _str(day['date']);
    final isToday = date == today;
    final items = asList(day['meals']);
    final special = items.any((m) => m['changed'] == true);
    return Card(
      key: Key('menuDay-$date'),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        key: PageStorageKey('menuDayTile-$date'),
        initiallyExpanded: isToday,
        title: Text(
          '${s.dayShort(date)}${isToday ? ' · ${s.today}' : ''}',
          style: const TextStyle(fontWeight: Tokens.fwSemibold),
        ),
        subtitle: Text(
          special ? s.hostelSpecialMeal : s.hostelMealsN(items.length),
          style: TextStyle(color: muted, fontSize: 13),
        ),
        shape: const Border(),
        collapsedShape: const Border(),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp3),
        children: [
          for (final m in items)
            Padding(
              padding: const EdgeInsets.only(bottom: Tokens.sp2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${s.hostelMeal(_str(mealOf['${m['mealId']}']?['name']))} · '
                    '${_str(mealOf['${m['mealId']}']?['atTime'])}',
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  Text(_str(m['items']).isEmpty ? '—' : _str(m['items'])),
                  if (m['changed'] == true)
                    Text(
                      '${s.hostelSpecial}${_str(m['note']).isEmpty ? '' : ': ${_str(m['note'])}'}',
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _rateRow(S s, Color muted, Json m) {
    final rating = (m['rating'] as num?)?.toInt();
    final key = '${m['mealId']}-${m['onDate']}';
    final meal = s.hostelMeal(_str(m['meal']));
    final day = s.dayShort(_str(m['onDate']));
    return Padding(
      key: Key('rate-$key'),
      padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp2, Tokens.sp2, Tokens.sp2),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(meal, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                Text(
                  '$day · ${_str(m['atTime'])}',
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                if (rating != null) ...[
                  const SizedBox(height: Tokens.sp1),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Semantics(
                        label: s.hostelStars(rating),
                        excludeSemantics: true,
                        child: StatusChip('★' * rating.clamp(1, 5), _ratingTone(rating)),
                      ),
                      if (_str(m['comment']).isNotEmpty)
                        Text(_str(m['comment']), style: TextStyle(color: muted, fontSize: 13)),
                    ],
                  ),
                ],
              ],
            ),
          ),
          Semantics(
            label: s.hostelRateWho(meal, day),
            button: true,
            excludeSemantics: true,
            child: TextButton(
              key: Key('rateMeal-$key'),
              onPressed: () => _rate(m),
              child: Text(rating == null ? s.hostelRate : s.hostelChangeRating),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- complaints

  List<Widget> _complaints(S s, Color muted, List<Json> list, List<Json> heads) {
    final closed = list.where((c) => c['status'] == 'closed').toList();
    final open = list.where((c) => c['status'] != 'closed').toList();
    return [
      SectionTitle(s.hostelTabComplaints),
      Text(s.hostelComplaintsHelp, style: TextStyle(color: muted, fontSize: 14)),
      const SizedBox(height: Tokens.sp3),
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: FilledButton.icon(
          key: const Key('raiseComplaint'),
          icon: const Icon(Icons.edit_note),
          label: Text(s.hostelRaiseComplaint),
          onPressed: () => _raise(heads),
        ),
      ),
      const SizedBox(height: Tokens.sp2),
      if (list.isEmpty) EmptyLine(s.hostelNoComplaints),
      for (final c in open) Card(child: _complaint(s, muted, c)),
      if (closed.isNotEmpty)
        _fold(
          context,
          id: 'closedComplaints',
          title: s.hostelClosedN(closed.length),
          hint: s.hostelTapToSee,
          children: [for (final c in closed) _complaint(s, muted, c)],
        ),
    ];
  }

  Widget _complaint(S s, Color muted, Json c) {
    final st = _str(c['status']);
    return Padding(
      key: Key('complaint-${c['id']}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_str(c['subject']), style: const TextStyle(fontWeight: Tokens.fwBold)),
          Text(
            [
              _str(c['number']),
              _str(c['head']),
              _on(s, c['openedAt']),
            ].where((x) => x.isNotEmpty).join(' · '),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (_str(c['resolution']).isNotEmpty)
            Text(
              s.hostelResolution(_str(c['resolution'])),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          const SizedBox(height: Tokens.sp1),
          StatusChip(s.hostelComplaintStatus(st), _complaintTone(st)),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------- from the hostel

  List<Widget> _notes(S s, Color muted, List<Json> list) {
    Widget note(Json i) => Padding(
      key: Key('incident-${i['id']}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Tokens.sp2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                s.hostelCategory(_str(i['category'])),
                style: const TextStyle(fontWeight: Tokens.fwBold),
              ),
              Text(_on(s, i['occurredAt']), style: TextStyle(color: muted, fontSize: 13)),
            ],
          ),
          Text(_str(i['what'])),
          if (_str(i['action']).isNotEmpty)
            Text(
              s.hostelActionTaken(_str(i['action'])),
              style: TextStyle(color: muted, fontSize: 13),
            ),
        ],
      ),
    );
    return [
      SectionTitle(s.hostelTabNotes),
      if (list.isEmpty) EmptyLine(s.hostelNoNotes),
      for (final i in list.take(5)) Card(child: note(i)),
      if (list.length > 5)
        _fold(
          context,
          id: 'earlierNotes',
          title: s.hostelEarlier(list.length - 5),
          hint: s.hostelTapToSee,
          children: [for (final i in list.skip(5)) note(i)],
        ),
    ];
  }

  // ---------------------------------------------------------------- leaving the hostel

  List<Widget> _leaving(S s, Color muted, Json? exit) {
    final requests = asList(exit?['requests']);
    final withdrawals = asList(exit?['withdrawals']);
    bool currentRequest(Json r) => r['status'] == 'pending' || r['status'] == 'started';
    bool currentWithdrawal(Json w) => w['status'] == 'requested' || w['status'] == 'completed';
    final current = [
      for (final r in requests)
        if (currentRequest(r)) _request(s, muted, r),
      for (final w in withdrawals)
        if (currentWithdrawal(w)) _withdrawal(s, w),
    ];
    final earlier = [
      for (final r in requests)
        if (!currentRequest(r)) _request(s, muted, r),
      for (final w in withdrawals)
        if (!currentWithdrawal(w)) _withdrawal(s, w),
    ];
    final canAsk =
        exit != null &&
        exit['hostel'] != null &&
        !requests.any((r) => r['status'] == 'pending') &&
        !withdrawals.any((w) => w['status'] == 'requested');
    return [
      SectionTitle(s.hostelTabLeaving),
      if (current.isEmpty && earlier.isEmpty) EmptyLine(s.hostelNoExit),
      for (final w in current) Card(child: w),
      if (earlier.isNotEmpty)
        _fold(
          context,
          id: 'earlierExit',
          title: s.hostelEarlier(earlier.length),
          hint: s.hostelTapToSee,
          children: earlier,
        ),
      if (canAsk) ...[
        const SizedBox(height: Tokens.sp3),
        Text(s.hostelExitHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp2),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton(
            key: const Key('askExit'),
            onPressed: _askExit,
            child: Text(s.hostelAskToLeave),
          ),
        ),
      ],
    ];
  }

  Widget _request(S s, Color muted, Json r) {
    final st = _str(r['status']);
    return Padding(
      key: Key('exitRequest-${r['id']}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            s.hostelRequestLastDay(s.dayShort(_str(r['leavingOn']))),
            style: const TextStyle(fontWeight: Tokens.fwBold),
          ),
          if (_str(r['note']).isNotEmpty)
            Text(_str(r['note']), style: TextStyle(color: muted, fontSize: 13)),
          if (st == 'declined' && _str(r['declineNote']).isNotEmpty)
            Text(
              s.hostelOfficeReplied(_str(r['declineNote'])),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusChip(s.hostelRequestStatus(st), _requestTone(st)),
              if (st == 'pending')
                TextButton(
                  key: Key('takeBack-${r['id']}'),
                  onPressed: () => _takeBack(r),
                  child: Text(s.hostelTakeBack),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _withdrawal(S s, Json w) {
    final st = _str(w['status']);
    return Padding(
      key: Key('withdrawal-${w['id']}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            s.hostelWithdrawalLastDay(s.dayShort(_str(w['leavingOn']))),
            style: const TextStyle(fontWeight: Tokens.fwBold),
          ),
          const SizedBox(height: Tokens.sp1),
          StatusChip(s.hostelWithdrawalStatus(st), _withdrawalTone(st)),
          if (st == 'completed') ...[const SizedBox(height: Tokens.sp1), _clearance(s, w)],
        ],
      ),
    );
  }
}

/// A person with no photo.
class _Face extends StatelessWidget {
  const _Face();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return ExcludeSemantics(
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: (dark ? Tokens.mobNavy700 : Tokens.mobNavy50),
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
        ),
        child: Icon(Icons.person_outline, color: (dark ? Tokens.mobWhite : Tokens.mobNavy800)),
      ),
    );
  }
}

/// A visitor's photo from the school (it helps the gate), or the plain face while it loads or when it cannot.
class _VisitorPhoto extends ConsumerWidget {
  const _VisitorPhoto({required this.id, required this.name});
  final String id;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final f = ref.watch(hostelVisitorPhotoProvider(id)).value;
    if (f == null) return const _Face();
    return Semantics(
      image: true,
      label: s.hostelPhotoOf(name),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
        child: Image.memory(
          Uint8List.fromList(f.bytes),
          key: Key('visitorPhoto-$id'),
          width: 48,
          height: 48,
          fit: BoxFit.cover,
          excludeFromSemantics: true,
          errorBuilder: (_, _, _) => const _Face(),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------------------------------------ the forms

/// Adds a visitor to the child's list, as on the website: the name, the relation, the mobile and a photo for the
/// gate (JPEG, PNG or WebP under 300 KB, sent as the website sends it); a warden approves.
class _VisitorForm extends ConsumerStatefulWidget {
  const _VisitorForm({required this.profile, required this.onSent});
  final Profile profile;
  final ValueChanged<String> onSent;

  @override
  ConsumerState<_VisitorForm> createState() => _VisitorFormState();
}

class _VisitorFormState extends ConsumerState<_VisitorForm> {
  final _name = TextEditingController();
  final _relation = TextEditingController();
  final _mobile = TextEditingController();
  PickedFile? _photo;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    _relation.dispose();
    _mobile.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final s = ref.read(stringsProvider);
    final f = await ref.read(hostelPhotoPickerProvider)(context, s);
    if (f == null || !mounted) return;
    final ok =
        RegExp(r'^image/(png|jpeg|webp)$').hasMatch(f.contentType) &&
        f.bytes.length >= 100 &&
        f.bytes.length <= _photoMax;
    setState(() {
      if (ok) {
        _photo = f;
        _error = null;
      } else {
        _error = s.hostelPhotoBad;
      }
    });
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final name = _name.text.trim();
    final relation = _relation.text.trim();
    final mobile = _mobile.text.trim();
    if (name.length < 2) return setState(() => _error = s.hostelNameShort);
    if (relation.length < 2) return setState(() => _error = s.hostelRelationShort);
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(mobile)) {
      return setState(() => _error = s.hostelMobileWrong);
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final photo = _photo;
    try {
      await ref
          .read(apiProvider)
          .hostelH3FamilyAdd(
            body: VisitorAddDto(
              studentId: widget.profile.studentId ?? '',
              name: name,
              relation: relation,
              mobile: mobile,
              photo: photo == null
                  ? null
                  : 'data:${photo.contentType};base64,${base64Encode(photo.bytes)}',
            ),
          );
      if (!mounted) return;
      widget.onSent(s.hostelAdded);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final photo = _photo;
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.hostelAddHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('visitorName'),
          controller: _name,
          maxLength: 120,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(
            labelText: s.hostelName,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('visitorRelation'),
          controller: _relation,
          maxLength: 60,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: s.hostelRelation,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('visitorMobile'),
          controller: _mobile,
          maxLength: 10,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(
            labelText: s.hostelMobile,
            helperText: s.hostelMobileHelp,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: Tokens.sp4),
        Text(s.hostelPhoto, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        Text(s.hostelPhotoHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp2),
        if (photo != null) ...[
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Semantics(
              image: true,
              label: s.hostelPhotoOf(_name.text.trim()),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(Tokens.radiusSm),
                child: Image.memory(
                  Uint8List.fromList(photo.bytes),
                  key: const Key('visitorPhotoPreview'),
                  width: 96,
                  height: 96,
                  fit: BoxFit.cover,
                  excludeFromSemantics: true,
                  errorBuilder: (_, _, _) => const SizedBox.square(
                    dimension: 96,
                    child: Icon(Icons.image_outlined, size: 40),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: Tokens.sp2),
        ],
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            OutlinedButton.icon(
              key: const Key('visitorPhoto'),
              icon: const Icon(Icons.add_a_photo_outlined),
              label: Text(photo == null ? s.hostelAddPhoto : s.hostelChangePhoto),
              onPressed: _busy ? null : _pick,
            ),
            if (photo != null)
              TextButton(
                key: const Key('visitorPhotoRemove'),
                onPressed: _busy ? null : () => setState(() => _photo = null),
                child: Text(s.hostelRemovePhoto),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        FilledButton(
          key: const Key('sendVisitor'),
          onPressed: _busy ? null : _send,
          child: Text(s.hostelAddToList),
        ),
      ],
    );
  }
}

/// A complaint about the child's room to the warden, as on the website: what it is about (the hostel's heads,
/// type to search), a subject and the details.
class _ComplaintForm extends ConsumerStatefulWidget {
  const _ComplaintForm({required this.profile, required this.heads, required this.onSent});
  final Profile profile;
  final List<Json> heads;
  final ValueChanged<String> onSent;

  @override
  ConsumerState<_ComplaintForm> createState() => _ComplaintFormState();
}

class _ComplaintFormState extends ConsumerState<_ComplaintForm> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  String? _head;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final subject = _subject.text.trim();
    final body = _body.text.trim();
    if (_head == null) return setState(() => _error = s.hostelChooseHead);
    if (subject.length < 3) return setState(() => _error = s.hostelSubjectShort);
    if (body.length < 3) return setState(() => _error = s.hostelDetailsShort);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .hostelCareFamilyRaise(
            body: ComplaintDto(
              studentId: widget.profile.studentId ?? '',
              categoryCode: _head!,
              subject: subject,
              body: body,
            ),
          );
      if (!mounted) return;
      widget.onSent(s.hostelComplaintRaised);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.hostelComplaintsHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp4),
        if (widget.heads.isEmpty)
          EmptyLine(s.hostelNoHeads)
        else
          DropdownMenu<String>(
            key: const Key('complaintHead'),
            label: Text(s.hostelAbout),
            trailingIcon: dropArrow(s.hostelAbout),
            selectedTrailingIcon: dropArrow(s.hostelAbout, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            onSelected: (v) => setState(() => _head = v),
            dropdownMenuEntries: [
              for (final h in widget.heads)
                DropdownMenuEntry(value: _str(h['code']), label: _str(h['name'])),
            ],
          ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('complaintSubject'),
          controller: _subject,
          maxLength: 200,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: s.subject,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('complaintBody'),
          controller: _body,
          minLines: 3,
          maxLines: 6,
          maxLength: 2000,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(labelText: s.details, border: const OutlineInputBorder()),
        ),
        const SizedBox(height: Tokens.sp2),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        FilledButton(
          key: const Key('sendComplaint'),
          onPressed: _busy || widget.heads.isEmpty ? null : _send,
          child: Text(s.hostelRaiseTheComplaint),
        ),
      ],
    );
  }
}

/// A rating of a meal the child had (1 to 5, with a comment), as on the website; a later rating replaces it.
class _RateForm extends ConsumerStatefulWidget {
  const _RateForm({required this.profile, required this.meal, required this.onSent});
  final Profile profile;
  final Json meal;
  final ValueChanged<String> onSent;

  @override
  ConsumerState<_RateForm> createState() => _RateFormState();
}

class _RateFormState extends ConsumerState<_RateForm> {
  late int? _rating = (widget.meal['rating'] as num?)?.toInt();
  late final _comment = TextEditingController(text: _str(widget.meal['comment']));
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final rating = _rating;
    if (rating == null) return setState(() => _error = s.hostelChooseRating);
    setState(() {
      _busy = true;
      _error = null;
    });
    final comment = _comment.text.trim();
    try {
      await ref
          .read(apiProvider)
          .hostelMessSaveFeedback(
            body: FeedbackDto(
              studentId: widget.profile.studentId ?? '',
              mealId: '${widget.meal['mealId']}',
              onDate: '${widget.meal['onDate']}',
              rating: rating,
              comment: comment.isEmpty ? null : comment,
            ),
          );
      if (!mounted) return;
      widget.onSent(s.hostelRated);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final m = widget.meal;
    final rating = _rating;
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(
          s.hostelMeal(_str(m['meal'])),
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
        ),
        Text(
          '${s.dayShort(_str(m['onDate']))} · ${_str(m['atTime'])}',
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: Tokens.sp2),
        Text(s.hostelRateHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp3),
        Text(s.hostelRating, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        Semantics(
          label: s.hostelRating,
          container: true,
          explicitChildNodes: true,
          child: Wrap(
            children: [
              for (var n = 1; n <= 5; n++)
                IconButton(
                  key: Key('star-$n'),
                  tooltip: s.hostelStarLabel(n),
                  isSelected: rating != null && n <= rating,
                  icon: const Icon(Icons.star_border),
                  selectedIcon: const Icon(Icons.star, color: Tokens.mobAmber600),
                  onPressed: _busy ? null : () => setState(() => _rating = n),
                ),
            ],
          ),
        ),
        if (rating != null) Text(s.hostelStarLabel(rating), key: const Key('ratingWords')),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('rateComment'),
          controller: _comment,
          maxLength: 500,
          maxLines: 3,
          minLines: 1,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: s.hostelComment,
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: Tokens.sp2),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        FilledButton(
          key: const Key('sendRating'),
          onPressed: _busy ? null : _send,
          child: Text(s.send),
        ),
      ],
    );
  }
}

/// A request for the child to leave the hostel and stay on as a day scholar, as on the website: the last day (today
/// or later), the reason (type to search) and a note; the hostel office starts it or answers.
class _ExitForm extends ConsumerStatefulWidget {
  const _ExitForm({required this.profile, required this.onSent});
  final Profile profile;
  final ValueChanged<String> onSent;

  @override
  ConsumerState<_ExitForm> createState() => _ExitFormState();
}

class _ExitFormState extends ConsumerState<_ExitForm> {
  static const _reasons = ['parent_request', 'health', 'other'];
  final _note = TextEditingController();
  DateTime? _day;
  String _reason = 'parent_request';
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final d = await showDatePicker(
      context: context,
      initialDate: _day ?? today,
      firstDate: today,
      lastDate: today.add(const Duration(days: 400)),
    );
    if (d != null && mounted) setState(() => _day = d);
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final day = _day;
    if (day == null) return setState(() => _error = s.hostelChooseDay);
    setState(() {
      _busy = true;
      _error = null;
    });
    final note = _note.text.trim();
    try {
      await ref
          .read(apiProvider)
          .hostelExitFamilyRequest(
            body: ExitRequestDto(
              studentId: widget.profile.studentId ?? '',
              leavingOn: ymd(day),
              reason: _reason,
              note: note.isEmpty ? null : note,
            ),
          );
      if (!mounted) return;
      widget.onSent(s.hostelExitSent);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final day = _day;
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.hostelExitHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp4),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            key: const Key('exitDay'),
            icon: const Icon(Icons.event),
            label: Text('${s.hostelLastDay}: ${day == null ? '—' : s.date(day)}'),
            onPressed: _busy ? null : _pick,
          ),
        ),
        const SizedBox(height: Tokens.sp4),
        DropdownMenu<String>(
          key: const Key('exitReason'),
          label: Text(s.reason),
          trailingIcon: dropArrow(s.reason),
          selectedTrailingIcon: dropArrow(s.reason, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          initialSelection: _reason,
          onSelected: (v) => setState(() => _reason = v ?? 'parent_request'),
          dropdownMenuEntries: [
            for (final r in _reasons) DropdownMenuEntry(value: r, label: s.hostelReason(r)),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('exitNote'),
          controller: _note,
          minLines: 2,
          maxLines: 5,
          maxLength: 1000,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: s.hostelNoteOffice,
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: Tokens.sp2),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        FilledButton(
          key: const Key('sendExit'),
          onPressed: _busy ? null : _send,
          child: Text(s.hostelSendRequest),
        ),
      ],
    );
  }
}
