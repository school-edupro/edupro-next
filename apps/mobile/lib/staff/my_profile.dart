import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException, ApiFile;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../family/hostel.dart' show hostelPhotoPickerProvider;
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of My profile (as the staff website's, in English and Hindi).
extension MyProfileWords on S {
  String _m(String en, String hi) => hindi ? hi : en;

  String get mpNotLinked => _m(
    'Your sign-in is not linked to a staff record. Please contact the school office.',
    'आपका साइन-इन किसी कर्मचारी रिकॉर्ड से नहीं जुड़ा है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );
  String mpHead(String code, int percent) => _m(
    'Employee code $code · profile $percent% complete',
    'कर्मचारी कोड $code · प्रोफ़ाइल $percent% पूर्ण',
  );
  String get mpPdf => _m('Download PDF', 'PDF डाउनलोड करें');
  String get mpPdfTitle => _m('My profile (PDF)', 'मेरी प्रोफ़ाइल (PDF)');
  String get mpClosed =>
      _m('Profile updates are closed at the moment.', 'प्रोफ़ाइल बदलाव अभी बंद हैं।');
  String get mpPhoto => _m('My photo', 'मेरी फ़ोटो');
  String get mpPhotoHelp =>
      _m('On the profile printout and the ID card.', 'प्रोफ़ाइल प्रिंट और पहचान पत्र पर।');
  String mpPhotoLevel(String level) => switch (level) {
    'edit_direct' => _m('A new photo shows at once.', 'नई फ़ोटो तुरंत दिखती है।'),
    'edit_approval' => _m(
      'A new photo shows after the school approves it.',
      'नई फ़ोटो विद्यालय की स्वीकृति के बाद दिखती है।',
    ),
    _ => _m('The office changes it.', 'कार्यालय इसे बदलता है।'),
  };
  String get mpPhotoWaiting =>
      _m('Waiting for approval: new photo', 'स्वीकृति की प्रतीक्षा: नई फ़ोटो');
  String get mpChangePhoto => _m('Change photo', 'फ़ोटो बदलें');
  String get mpSendPhoto => _m('Send for approval', 'स्वीकृति के लिए भेजें');
  String mpPhotoOf(String name) => _m('Photo of $name', '$name की फ़ोटो');
  String get mpPhotoWrong =>
      _m('A photo (JPG, PNG or WebP) of up to 5 MB.', '5 MB तक की फ़ोटो (JPG, PNG या WebP)।');
  String get mpUpdate => _m('Update', 'बदलें');
  String get mpWaiting => _m('Waiting for approval', 'स्वीकृति की प्रतीक्षा');
  String get mpYes => _m('Yes', 'हाँ');
  String get mpNo => _m('No', 'नहीं');
  String mpListLevel(String level) => switch (level) {
    'edit_direct' => _m('changes save at once', 'बदलाव तुरंत सहेजे जाते हैं'),
    'edit_approval' => _m('changes need approval', 'बदलाव के लिए स्वीकृति चाहिए'),
    _ => _m('shown only', 'केवल देखने हेतु'),
  };
  String mpAttach(String name) => _m('attach $name', '$name संलग्न करें');
  String get mpAdd => _m('Add', 'जोड़ें');
  String get mpChange => _m('Change', 'बदलें');
  String get mpRemove => _m('Remove', 'हटाएँ');
  String mpRemoveAsk(String what) => _m('Remove “$what”?', '“$what” हटाएँ?');
  String get mpKeep => _m('Keep it', 'रहने दें');
  String mpRowWaiting(bool remove) => _m(
    'Waiting for approval: ${remove ? 'removal' : 'change'}',
    'स्वीकृति की प्रतीक्षा: ${remove ? 'हटाना' : 'बदलाव'}',
  );
  String get mpNewWaiting => _m('Waiting for approval: new', 'स्वीकृति की प्रतीक्षा: नया');
  String get mpNoRows => _m('Nothing here yet.', 'अभी यहाँ कुछ नहीं।');
  String get mpDocument => _m('Document', 'दस्तावेज़');
  String get mpNumber => _m('Number', 'संख्या');
  String get mpIssued => _m('Issued on', 'जारी तिथि');
  String get mpValid => _m('Valid till', 'वैध तक');
  String get mpFile => _m('File', 'फ़ाइल');
  String get mpChecked => _m('Checked by HR', 'HR द्वारा जाँचा');
  String get mpNotYet => _m('Not yet', 'अभी नहीं');
  String get mpRequests => _m('My requests', 'मेरे अनुरोध');
  String mpRequestsCount(int n, int waiting) => _m(
    '$n${waiting > 0 ? ', $waiting waiting' : ''}',
    '$n${waiting > 0 ? ', $waiting प्रतीक्षा में' : ''}',
  );
  String get mpNoRequests => _m('No requests yet.', 'अभी कोई अनुरोध नहीं।');
  String mpStatus(String st, bool auto) => auto
      ? _m('Saved at once', 'तुरंत सहेजा गया')
      : switch (st) {
          'pending' => _m('Waiting for approval', 'स्वीकृति की प्रतीक्षा'),
          'approved' => _m('Approved', 'स्वीकृत'),
          'rejected' => _m('Refused', 'अस्वीकृत'),
          'partially_approved' => _m('Partly approved', 'आंशिक स्वीकृत'),
          _ => _m('Withdrawn', 'वापस लिया'),
        };
  String mpWith(String who, int at, int of) => _m('with $who ($at/$of)', '$who के पास ($at/$of)');
  String mpRefused(String? note) =>
      _m('refused${note != null ? ': $note' : ''}', 'अस्वीकृत${note != null ? ': $note' : ''}');
  String get mpWithdraw => _m('Withdraw', 'वापस लें');
  String get mpWithdrawAsk => _m('Withdraw this request?', 'यह अनुरोध वापस लें?');
  String get mpWithdrawn => _m('Request withdrawn.', 'अनुरोध वापस लिया गया।');
  String get mpView => _m('View', 'देखें');
  // the section form
  String get mpSectionHelp => _m(
    'Change what is wrong or out of date. Some changes need the school’s approval.',
    'जो गलत या पुराना है उसे बदलें। कुछ बदलावों के लिए विद्यालय की स्वीकृति चाहिए।',
  );
  String mpFieldWaiting(String v) => _m('waiting for approval: $v', 'स्वीकृति की प्रतीक्षा: $v');
  String get mpAtOnce => _m('saved at once', 'तुरंत सहेजा जाता है');
  String get mpNeedsApproval => _m('needs approval', 'स्वीकृति चाहिए');
  String get mpProofs => _m('Documents for the changes', 'बदलावों के दस्तावेज़');
  String get mpProofHelp => _m(
    'PDF or photo, up to 5 MB; needed only when you change its field',
    'PDF या फ़ोटो, 5 MB तक; केवल उसका क्षेत्र बदलने पर आवश्यक',
  );
  String get mpChooseFile => _m('Choose a file', 'फ़ाइल चुनें');
  String get mpWhy => _m('Why (optional)', 'क्यों (वैकल्पिक)');
  String get mpSend => _m('Send', 'भेजें');
  String get mpNoChange => _m('Nothing was changed.', 'कुछ नहीं बदला गया।');
  String mpSent(int saved, int pending) => [
    if (saved > 0) _m('$saved saved', '$saved सहेजे गए'),
    if (pending > 0) _m('$pending sent for approval', '$pending स्वीकृति के लिए भेजे गए'),
  ].join(', ');
  String get mpChoose => _m('Choose', 'चुनें');
  // the row form
  String mpRowTitle(String list, bool change) =>
      _m('$list: ${change ? 'change' : 'add'}', '$list: ${change ? 'बदलें' : 'जोड़ें'}');
  String get mpRowDirect => _m('Saved at once.', 'तुरंत सहेजा जाता है।');
  String get mpRowApproval => _m(
    'Goes to the school for approval; you can withdraw it from My profile until it is decided.',
    'विद्यालय की स्वीकृति के लिए जाता है; निर्णय होने तक आप इसे मेरी प्रोफ़ाइल से वापस ले सकते हैं।',
  );
  String mpNeedsExpiry(String name) =>
      _m('$name (needs valid-till date)', '$name (वैध-तक तिथि आवश्यक)');
  String mpFileField(String label) =>
      _m('$label (PDF or photo, up to 5 MB)', '$label (PDF या फ़ोटो, 5 MB तक)');
  String mpAttachProof(String name) =>
      _m('Attach $name (PDF or photo, up to 5 MB)', '$name संलग्न करें (PDF या फ़ोटो, 5 MB तक)');
  String get mpSendChange => _m('Send the change', 'बदलाव भेजें');
  String mpRequired(String label) => _m('Fill “$label”.', '“$label” भरें।');
  String get mpAttachDoc => _m('Attach the document file.', 'दस्तावेज़ फ़ाइल संलग्न करें।');
  String get mpSaved => _m('Saved.', 'सहेजा गया।');
  String get mpSentForApproval => _m('Sent for approval.', 'स्वीकृति के लिए भेजा गया।');
  String get mpRemoved => _m('Removed.', 'हटाया गया।');
  String get mpRemovalSent =>
      _m('Removal sent for approval.', 'हटाने का अनुरोध स्वीकृति के लिए भेजा गया।');
  String get mpPhotoChanged => _m('Your photo is changed.', 'आपकी फ़ोटो बदल गई।');
  String get mpPhotoSent =>
      _m('Your new photo is sent for approval.', 'आपकी नई फ़ोटो स्वीकृति के लिए भेजी गई।');
  // the checks of the inputs (as the server's)
  String mpIsRequired(String label) => _m('$label is required.', '$label आवश्यक है।');
  String get mpFixFields => _m(
    'Some values need a fix: see the fields marked below.',
    'कुछ मान ठीक करने हैं: नीचे चिह्नित क्षेत्र देखें।',
  );
  String get mpRuleName =>
      _m("Letters, spaces and . ' - only.", "केवल अक्षर, रिक्त स्थान और . ' -।");
  String get mpRuleMobile => _m(
    '10-digit mobile starting 6-9, no +91 or 0.',
    '6-9 से शुरू होने वाला 10 अंकों का मोबाइल, +91 या 0 नहीं।',
  );
  String get mpRuleEmail => _m('A valid email address.', 'सही ईमेल पता।');
  String get mpRule12 => _m('12 digits, no spaces.', '12 अंक, बिना रिक्त स्थान।');
  String get mpRulePan => _m('10 characters, e.g. ABCDE1234F.', '10 अक्षर, जैसे ABCDE1234F।');
  String get mpRuleIfsc =>
      _m('11 characters, 5th is 0, e.g. SBIN0001234.', '11 अक्षर, 5वाँ 0, जैसे SBIN0001234।');
  String get mpRuleAccount => _m('9 to 18 digits.', '9 से 18 अंक।');
  String get mpRuleChildren => _m('A whole number from 0 to 20.', '0 से 20 तक पूर्ण संख्या।');
  String get mpRuleNumber => _m('A number of 0 or more.', '0 या अधिक की संख्या।');
  String get mpRuleAge => _m('The age must be from 18 to 80.', 'आयु 18 से 80 के बीच होनी चाहिए।');
  String get mpRuleFuture => _m('Cannot be in the future.', 'भविष्य की तिथि नहीं हो सकती।');
  String get mpRuleAfterBirth =>
      _m('Must be after the date of birth.', 'जन्म तिथि के बाद होनी चाहिए।');
  String get mpRulePhone => _m('A phone number of 6 to 15 digits.', '6 से 15 अंकों का फ़ोन नंबर।');
  String get mpRuleOwnMobile => _m(
    "Give another person's number, not your own.",
    'किसी अन्य व्यक्ति का नंबर दें, अपना नहीं।',
  );
  String mpRuleYear(int now) => _m('A year from 1940 to $now.', '1940 से $now तक का वर्ष।');
  String get mpRuleEndBeforeStart =>
      _m('The end is before the start.', 'अंत की तिथि शुरुआत से पहले है।');
  String get mpRuleValidTill => _m(
    'The valid-till date must be after the issue date.',
    'वैध-तक तिथि जारी तिथि के बाद होनी चाहिए।',
  );
  String get mpFileWrong =>
      _m('Attach a PDF or a photo of up to 5 MB.', '5 MB तक की PDF या फ़ोटो संलग्न करें।');
}

/// My employee profile (`/me/employee-profile`); null: the sign-in has no staff record.
final myStaffProfileProvider = FutureProvider.autoDispose.family<Loaded<Json?>, Profile>((
  ref,
  p,
) async {
  try {
    final r = await cached(
      'my-staff-profile:${p.id}',
      () => ref.read(apiProvider).employeeSelfMine(),
    );
    return Loaded<Json?>(asJson(r.data), r.at, stale: r.stale);
  } on ApiException catch (e) {
    if (e.status == 404) return Loaded<Json?>(null, DateTime.now());
    rethrow;
  }
});

/// One of my photos (the one on file, or a new one waiting); null when it cannot be read.
final _myPhotoProvider = FutureProvider.autoDispose.family<ApiFile?, String>((ref, fileId) async {
  try {
    return await ref.read(apiProvider).employeeSelfMyPhoto(file: fileId);
  } catch (_) {
    return null;
  }
});

/// A value as the website shows it: — for nothing, Yes / No, a date as DD-MM-YYYY.
String mpShown(S s, Object? v) {
  if (v == null || v == '') return '—';
  if (v is bool) return v ? s.mpYes : s.mpNo;
  final x = '$v';
  return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(x)
      ? '${x.substring(8, 10)}-${x.substring(5, 7)}-${x.substring(0, 4)}'
      : x;
}

bool _editable(Object? level) => level == 'edit_approval' || level == 'edit_direct';

/// The people's names among the fields (letters, spaces and . ' - only).
const _names = {
  'first_name',
  'last_name',
  'spouse_name',
  'father_name',
  'emergency_name',
  'bank_account_name',
};

/// Today (India) as YYYY-MM-DD.
String _today() => ymd(schoolToday());

/// Whole years between two YYYY-MM-DD dates.
int _years(String from, String to) {
  final f = DateTime.parse(from);
  final t = DateTime.parse(to);
  return t.year - f.year - ((t.month < f.month || (t.month == f.month && t.day < f.day)) ? 1 : 0);
}

/// What is wrong with one value of my profile, as the server checks it (each field's format and the staff's own
/// checks: required, names, age, anniversary, children, phone, the emergency mobile); null when it is fine.
/// [all] are the form's values (the other half of a pair: the date of birth, my mobile).
String? mpCheck(S s, Json f, String raw, Map<String, String> all) {
  final key = '${f['key']}';
  final v = raw.trim();
  if (v.isEmpty) return f['required'] == true ? s.mpIsRequired('${f['label']}') : null;
  if (_names.contains(key)) {
    return RegExp(r"^[A-Za-z][A-Za-z .'-]*$").hasMatch(v) ? null : s.mpRuleName;
  }
  final today = _today();
  switch ('${f['type']}') {
    case 'mobile':
      final m = v
          .replaceAll(RegExp(r'[\s-]'), '')
          .replaceFirst(RegExp(r'^(\+91|0091|0)(?=\d{10}$)'), '');
      if (!RegExp(r'^[6-9]\d{9}$').hasMatch(m)) return s.mpRuleMobile;
      if (key == 'emergency_mobile' &&
          (all['mobile'] ?? '').replaceAll(RegExp(r'\D'), '').endsWith(m)) {
        return s.mpRuleOwnMobile;
      }
      return null;
    case 'email':
      return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$').hasMatch(v) ? null : s.mpRuleEmail;
    case 'digits12':
      return RegExp(r'^\d{12}$').hasMatch(v.replaceAll(RegExp(r'[\s-]'), '')) ? null : s.mpRule12;
    case 'pan':
      return RegExp(r'^[A-Z]{5}\d{4}[A-Z]$').hasMatch(v.toUpperCase()) ? null : s.mpRulePan;
    case 'ifsc':
      return RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$').hasMatch(v.toUpperCase()) ? null : s.mpRuleIfsc;
    case 'account':
      return RegExp(r'^\d{9,18}$').hasMatch(v.replaceAll(RegExp(r'[\s-]'), ''))
          ? null
          : s.mpRuleAccount;
    case 'number':
      final n = num.tryParse(v);
      if (key == 'sons' || key == 'daughters') {
        return n != null && n == n.roundToDouble() && n >= 0 && n <= 20 ? null : s.mpRuleChildren;
      }
      return n != null && n >= 0 ? null : s.mpRuleNumber;
    case 'date':
      if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v)) return null;
      if (key == 'dob') {
        if (v.compareTo(today) > 0) return s.mpRuleFuture;
        final age = _years(v, today);
        return age < 18 || age > 80 ? s.mpRuleAge : null;
      }
      if (key == 'anniversary') {
        if (v.compareTo(today) > 0) return s.mpRuleFuture;
        final dob = all['dob'] ?? '';
        return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dob) && v.compareTo(dob) <= 0
            ? s.mpRuleAfterBirth
            : null;
      }
      return null;
    default:
      if (key == 'phone') {
        final digits = v.replaceAll(RegExp(r'\D'), '');
        return RegExp(r'^\+?[\d\s-]+$').hasMatch(v) && digits.length >= 6 && digits.length <= 15
            ? null
            : s.mpRulePhone;
      }
      return null;
  }
}

/// The list columns that record what already happened (not after today).
const _pastDates = {'fromOn', 'toOn', 'trainedOn', 'enteredOn', 'issuedOn'};

final _okFile = RegExp(r'^(application/pdf|image/(png|jpeg|webp))$');

/// Picks one PDF or photo of up to 5 MB; null when none (or a wrong one, said in a note).
Future<PickedFile?> _pickOne(BuildContext context, WidgetRef ref, S s) async {
  final picked = await ref.read(leaveFilePickerProvider)();
  if (picked.isEmpty) return null;
  final f = picked.first;
  if (!_okFile.hasMatch(f.contentType) || f.bytes.length > 5 * 1024 * 1024) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.mpFileWrong)));
    }
    return null;
  }
  return f;
}

Future<String> _upload(WidgetRef ref, PickedFile f) =>
    uploadFile(ref.read(apiProvider), ref.read(transportProvider), f, classification: 'personal');

/// My profile as on the staff website (docs/design/33): my photo, my record by section with Update (saved at once or
/// for approval, with the documents asked for), the lists — education, languages, experience, training, documents —
/// with Add, Change and Remove, my requests with Withdraw, and my profile as a PDF. No web page.
class StaffProfileScreen extends ConsumerStatefulWidget {
  const StaffProfileScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffProfileScreen> createState() => _StaffProfileScreenState();
}

class _StaffProfileScreenState extends ConsumerState<StaffProfileScreen> {
  bool _busy = false;

  void _say(String text) {
    if (!mounted) return;
    // the newest note replaces the one showing
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  void _reload() => ref.invalidate(myStaffProfileProvider(widget.profile));

  /// My profile as a PDF, made at once by the API (it no longer waits for the background workers).
  Future<void> _pdf() async {
    final s = ref.read(stringsProvider);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            FileScreen(title: s.mpPdfTitle, load: () => ref.read(apiProvider).employeeSelfPdfNow()),
      ),
    );
  }

  Future<void> _photo(Json photo) async {
    final s = ref.read(stringsProvider);
    final f = await ref.read(hostelPhotoPickerProvider)(context, s);
    if (f == null) return;
    if (!RegExp(r'^image/(png|jpeg|webp)$').hasMatch(f.contentType) ||
        f.bytes.length > 5 * 1024 * 1024) {
      return _say(s.mpPhotoWrong);
    }
    setState(() => _busy = true);
    try {
      final id = await _upload(ref, f);
      final r = asJson(
        await ref.read(apiProvider).employeeSelfSubmit(body: EmployeeChangesDto(photo: id)),
      );
      _reload();
      _say(asList(r['applied']).isNotEmpty ? s.mpPhotoChanged : s.mpPhotoSent);
    } catch (e) {
      _say(errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _ask(String text, String yes) async {
    final s = ref.read(stringsProvider);
    return await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            content: Text(text),
            actions: [
              TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.mpKeep)),
              FilledButton(
                key: const Key('mpAskYes'),
                onPressed: () => Navigator.of(c).pop(true),
                child: Text(yes),
              ),
            ],
          ),
        ) ==
        true;
  }

  Future<void> _withdraw(String id) async {
    final s = ref.read(stringsProvider);
    if (!await _ask(s.mpWithdrawAsk, s.mpWithdraw)) return;
    try {
      await ref.read(apiProvider).employeeSelfCancel(id: id);
      _reload();
      _say(s.mpWithdrawn);
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  Future<void> _remove(String kind, Json row) async {
    final s = ref.read(stringsProvider);
    if (!await _ask(s.mpRemoveAsk('${row['summary'] ?? ''}'), s.mpRemove)) return;
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .employeeSelfSubmit(
              body: EmployeeChangesDto(
                rows: [EmployeeChangesDtoRowsItem(kind: kind, op: 'remove', rowId: '${row['id']}')],
              ),
            ),
      );
      _reload();
      _say(asList(r['applied']).isNotEmpty ? s.mpRemoved : s.mpRemovalSent);
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  Future<void> _open(String title, Widget form) async {
    final msg = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(title: title, child: form),
      ),
    );
    if (msg == null) return;
    _reload();
    _say(msg);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return LoadedList<Json?>(
      value: ref.watch(myStaffProfileProvider(widget.profile)),
      refresh: () => ref.refresh(myStaffProfileProvider(widget.profile).future),
      children: (p) {
        if (p == null) return [Notice(key: const Key('mpNotLinked'), text: s.mpNotLinked)];
        final emp = asJson(p['employee']);
        final canEdit = p['canEdit'] == true;
        final window = asJson(p['window']);
        final photo = asJson(p['photo']);
        final requests = asList(p['requests']);
        final waiting = requests.where((r) => r['status'] == 'pending').length;
        Widget card(Widget child, {Key? key}) => Card(
          key: key,
          margin: const EdgeInsets.only(bottom: Tokens.sp3),
          child: Padding(padding: const EdgeInsets.all(Tokens.sp4), child: child),
        );
        Widget title(String text, {Widget? action}) => Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Semantics(
                header: true,
                child: Text(
                  text,
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: Tokens.fwBold),
                ),
              ),
            ),
            ?action,
          ],
        );
        return [
          Text(
            '${emp['name'] ?? ''}',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(
            s.mpHead(
              '${emp['code'] ?? ''}',
              (asJson(p['completeness'])['percent'] as num? ?? 0).toInt(),
            ),
            style: TextStyle(color: muted),
          ),
          const SizedBox(height: Tokens.sp2),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: OutlinedButton.icon(
              key: const Key('mpPdf'),
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: Text(s.mpPdf),
              onPressed: _pdf,
            ),
          ),
          if (window['open'] != true || window['message'] != null) ...[
            const SizedBox(height: Tokens.sp2),
            Notice(text: '${window['message'] ?? s.mpClosed}'),
          ],
          const SizedBox(height: Tokens.sp3),
          // my photo
          card(
            key: const Key('mpPhotoCard'),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Photo(fileId: photo['fileId'] as String?, name: '${emp['name'] ?? ''}', size: 72),
                const SizedBox(width: Tokens.sp3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      title(s.mpPhoto),
                      Text(
                        '${s.mpPhotoHelp} ${s.mpPhotoLevel('${photo['level']}')}',
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                      if (photo['pending'] != null) ...[
                        const SizedBox(height: Tokens.sp2),
                        Wrap(
                          spacing: Tokens.sp2,
                          runSpacing: Tokens.sp1,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            _Photo(
                              fileId: '${photo['pending']}',
                              name: '${emp['name'] ?? ''}',
                              size: 48,
                            ),
                            Tag(s.mpPhotoWaiting, color: Tokens.mobAmber50),
                          ],
                        ),
                      ] else if (canEdit && _editable(photo['level'])) ...[
                        const SizedBox(height: Tokens.sp2),
                        OutlinedButton.icon(
                          key: const Key('mpPhotoChange'),
                          icon: const Icon(Icons.photo_camera_outlined),
                          label: Text(
                            photo['level'] == 'edit_direct' ? s.mpChangePhoto : s.mpSendPhoto,
                          ),
                          onPressed: _busy ? null : () => _photo(photo),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          // the sections
          for (final sec in asList(p['sections']))
            card(
              key: Key('mpSection-${sec['id']}'),
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  title(
                    '${sec['title']}',
                    action: canEdit && asList(sec['fields']).any((f) => _editable(f['level']))
                        ? TextButton(
                            key: Key('mpUpdate-${sec['id']}'),
                            onPressed: () => _open(
                              '${sec['title']}',
                              _SectionForm(
                                section: sec,
                                known: {
                                  for (final x in asList(p['sections']))
                                    for (final f in asList(x['fields']))
                                      if (f['key'] == 'mobile' || f['key'] == 'dob')
                                        '${f['key']}': f['value'] == null ? '' : '${f['value']}',
                                },
                              ),
                            ),
                            child: Text(s.mpUpdate),
                          )
                        : null,
                  ),
                  const SizedBox(height: Tokens.sp2),
                  for (final f in asList(sec['fields']))
                    Padding(
                      padding: const EdgeInsets.only(bottom: Tokens.sp2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${f['label']}', style: TextStyle(color: muted, fontSize: 13)),
                          SelectionArea(child: Text(mpShown(s, f['value']))),
                          if (f.containsKey('pending'))
                            Padding(
                              padding: const EdgeInsets.only(top: Tokens.sp1),
                              child: Tag(
                                '${s.mpWaiting}: ${mpShown(s, f['pending'])}',
                                color: Tokens.mobAmber50,
                              ),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          // the lists
          for (final l in asList(p['lists']))
            card(key: Key('mpList-${l['id']}'), _list(s, muted, l, canEdit, title)),
          // my requests
          Card(
            key: const Key('mpRequests'),
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              initiallyExpanded: waiting > 0,
              title: Text(
                '${s.mpRequests} (${s.mpRequestsCount(requests.length, waiting)})',
                style: const TextStyle(fontWeight: Tokens.fwBold),
              ),
              shape: const Border(),
              collapsedShape: const Border(),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp3),
              children: [
                if (requests.isEmpty) Text(s.mpNoRequests, style: TextStyle(color: muted)),
                for (final r in requests) _request(s, muted, r),
              ],
            ),
          ),
        ];
      },
    );
  }

  Widget _list(
    S s,
    Color muted,
    Json l,
    bool canEdit,
    Widget Function(String, {Widget? action}) title,
  ) {
    final kind = '${l['id']}';
    final canChange = canEdit && _editable(l['level']);
    final proof = asJson(l['proof']);
    final cols = asList(l['columns']);
    List<(String, Widget)> cells(Json v) {
      String text(Object? x) => mpShown(s, x);
      if (kind == 'documents') {
        final file = v['fileId'];
        return [
          (s.mpDocument, Text(text(v['typeName']))),
          (s.mpNumber, Text(text(v['number']))),
          (s.mpIssued, Text(text(v['issuedOn']))),
          (s.mpValid, Text(text(v['expiresOn']))),
          (
            s.mpFile,
            file is String && file.isNotEmpty
                ? FileIcons(
                    name: 'mpFile-$file',
                    label: '${v['typeName'] ?? s.mpDocument}',
                    load: () => ref.read(apiProvider).employeeSelfMyFile(fileId: file),
                  )
                : const Text('—'),
          ),
          (s.mpChecked, Text(v['verified'] == true ? s.mpYes : s.mpNotYet)),
        ];
      }
      return [
        for (final c in cols)
          (
            '${c['label']}',
            Text(
              c['type'] == 'boolean' ? (v[c['key']] == true ? s.mpYes : s.mpNo) : text(v[c['key']]),
            ),
          ),
      ];
    }

    final rows = asList(l['rows']);
    final adds = asList(l['pendingAdds']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        title(
          '${l['title']}',
          action: canChange
              ? TextButton.icon(
                  key: Key('mpAdd-$kind'),
                  icon: const Icon(Icons.add),
                  label: Text(s.mpAdd),
                  onPressed: () =>
                      _open(s.mpRowTitle('${l['title']}', false), _RowForm(list: l, row: null)),
                )
              : null,
        ),
        Text(
          [
            s.mpListLevel('${l['level']}'),
            if (proof.isNotEmpty) s.mpAttach('${proof['name']}'),
          ].join(' · '),
          style: TextStyle(color: muted, fontSize: 13),
        ),
        const SizedBox(height: Tokens.sp2),
        if (rows.isEmpty && adds.isEmpty) Text(s.mpNoRows, style: TextStyle(color: muted)),
        for (final r in rows)
          Container(
            key: Key('mpRow-${r['id']}'),
            margin: const EdgeInsets.only(bottom: Tokens.sp2),
            padding: const EdgeInsets.all(Tokens.sp3),
            decoration: BoxDecoration(
              border: Border.all(color: muted.withValues(alpha: 0.4)),
              borderRadius: BorderRadius.circular(Tokens.radiusSm),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final (label, value) in cells(asJson(r['values'])))
                  Padding(
                    padding: const EdgeInsets.only(bottom: Tokens.sp1),
                    child: Wrap(
                      spacing: Tokens.sp2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('$label:', style: TextStyle(color: muted, fontSize: 13)),
                        value,
                      ],
                    ),
                  ),
                if (r['pending'] != null)
                  Tag(
                    s.mpRowWaiting(asJson(r['pending'])['op'] == 'remove'),
                    color: Tokens.mobAmber50,
                  )
                else if (canChange)
                  Wrap(
                    spacing: Tokens.sp2,
                    children: [
                      if (kind != 'documents')
                        TextButton(
                          key: Key('mpChange-${r['id']}'),
                          onPressed: () =>
                              _open(s.mpRowTitle('${l['title']}', true), _RowForm(list: l, row: r)),
                          child: Text(s.mpChange),
                        ),
                      TextButton(
                        key: Key('mpRemove-${r['id']}'),
                        onPressed: () => _remove(kind, r),
                        child: Text(s.mpRemove),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        for (final a in adds)
          Padding(
            padding: const EdgeInsets.only(bottom: Tokens.sp2),
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('${a['summary'] ?? ''}'),
                Tag(s.mpNewWaiting, color: Tokens.mobAmber50),
              ],
            ),
          ),
      ],
    );
  }

  Widget _request(S s, Color muted, Json r) {
    final step = asJson(r['step']);
    final when = DateTime.tryParse('${r['createdAt']}');
    return Padding(
      key: Key('mpRequest-${r['id']}'),
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            [
              s.mpStatus('${r['status']}', r['autoApplied'] == true),
              if (when != null) s.date(when),
              if (step.isNotEmpty)
                s.mpWith(
                  '${step['with']}',
                  (step['at'] as num? ?? 0).toInt(),
                  (step['of'] as num? ?? 0).toInt(),
                ),
            ].join(' · '),
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
          for (final f in asList(r['fields']))
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp1),
              child: Wrap(
                spacing: Tokens.sp2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    '${f['label']}: ${mpShown(s, f['from'])} → ${mpShown(s, f['to'])}${f['status'] == 'rejected' ? ' (${s.mpRefused(f['note'] as String?)})' : ''}',
                  ),
                  if (f['file'] is String)
                    FileIcons(
                      name: 'mpReqFile-${r['id']}-${f['key']}',
                      label: '${f['label']}',
                      load: () => ref.read(apiProvider).employeeSelfMyFile(fileId: '${f['file']}'),
                    ),
                ],
              ),
            ),
          if (r['note'] != null && r['status'] != 'pending')
            Text('${r['note']}', style: TextStyle(color: muted, fontSize: 13)),
          if (r['status'] == 'pending')
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                key: Key('mpWithdraw-${r['id']}'),
                onPressed: () => _withdraw('${r['id']}'),
                child: Text(s.mpWithdraw),
              ),
            ),
        ],
      ),
    );
  }
}

/// One of my photos, or my initials while it loads or when there is none.
class _Photo extends ConsumerWidget {
  const _Photo({required this.fileId, required this.name, required this.size});
  final String? fileId;
  final String name;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final f = fileId == null ? null : ref.watch(_myPhotoProvider(fileId!)).value;
    final initials = name
        .split(RegExp(r'\s+'))
        .where((x) => x.isNotEmpty)
        .take(2)
        .map((x) => x[0].toUpperCase())
        .join();
    return ClipRRect(
      borderRadius: BorderRadius.circular(Tokens.radiusSm),
      child: SizedBox(
        width: size,
        height: size,
        child: f == null
            ? ColoredBox(
                color: Tokens.mobNavy800,
                child: Center(
                  child: Text(
                    initials,
                    style: const TextStyle(color: Tokens.textInverse, fontWeight: Tokens.fwBold),
                  ),
                ),
              )
            : Image.memory(
                Uint8List.fromList(f.bytes),
                fit: BoxFit.cover,
                semanticLabel: s.mpPhotoOf(name),
              ),
      ),
    );
  }
}

/// A date or a choice shown as a labelled field; a tap opens its picker.
class _PickField extends StatelessWidget {
  const _PickField({
    super.key,
    required this.label,
    required this.value,
    required this.onTap,
    this.error,
  });
  final String label;
  final String value;
  final VoidCallback? onTap;
  final String? error;

  @override
  Widget build(BuildContext context) => Semantics(
    button: onTap != null,
    label: '$label: $value${error != null ? '. $error' : ''}',
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: const Icon(Icons.event),
          enabled: onTap != null,
          errorText: error,
        ),
        child: Text(value),
      ),
    ),
  );
}

/// Update one section of my profile, as the website's: each field says whether it is saved at once or goes for
/// approval; a field already waiting cannot be changed again; the documents the school asks for are attached here.
/// Pops with what happened.
class _SectionForm extends ConsumerStatefulWidget {
  const _SectionForm({required this.section, this.known = const {}});
  final Json section;

  /// the profile's other values the checks pair with (my mobile, my date of birth)
  final Map<String, String> known;

  @override
  ConsumerState<_SectionForm> createState() => _SectionFormState();
}

class _SectionFormState extends ConsumerState<_SectionForm> {
  late final List<Json> _fields = [
    for (final f in asList(widget.section['fields']))
      if (_editable(f['level'])) f,
  ];
  late final Map<String, String> _was = {
    for (final f in _fields) '${f['key']}': f['value'] == null ? '' : '${f['value']}',
  };
  late final Map<String, String> _now = {..._was};
  late final Map<String, TextEditingController> _text = {
    for (final f in _fields)
      if (f['options'] == null && f['type'] != 'date')
        '${f['key']}': TextEditingController(text: _was['${f['key']}']),
  };
  final _reason = TextEditingController();
  final Map<String, PickedFile> _proofs = {};
  Map<String, String> _errors = {};
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    for (final e in _text.entries) {
      _now[e.key] = e.value.text.trim();
    }
    // every field that can be changed now, as the server checks it (my mobile and birth date from the whole profile)
    final all = {...widget.known, ..._now};
    final errors = <String, String>{};
    for (final f in _fields) {
      if (f.containsKey('pending')) continue;
      final e = mpCheck(s, f, _now['${f['key']}'] ?? '', all);
      if (e != null) errors['${f['key']}'] = e;
    }
    if (errors.isNotEmpty) {
      return setState(() {
        _errors = errors;
        _error = s.mpFixFields;
      });
    }
    _errors = {};
    final changes = <String, Object?>{
      for (final f in _fields)
        if (!f.containsKey('pending') && _now['${f['key']}'] != _was['${f['key']}'])
          '${f['key']}': _now['${f['key']}']!.isEmpty ? null : _now['${f['key']}'],
    };
    if (changes.isEmpty) return setState(() => _error = s.mpNoChange);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final proofs = [
        for (final e in _proofs.entries)
          EmployeeChangesDtoProofsItem(typeId: e.key, fileId: await _upload(ref, e.value)),
      ];
      final r = asJson(
        await ref
            .read(apiProvider)
            .employeeSelfSubmit(
              body: EmployeeChangesDto(
                changes: changes,
                reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
                proofs: proofs,
              ),
            ),
      );
      if (mounted) {
        Navigator.of(context)
            .pop('${s.mpSent(asList(r['applied']).length, asList(r['pending']).length)}.');
      }
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
    final proofs = <String, Json>{
      for (final f in _fields)
        if (f['proof'] != null) '${asJson(f['proof'])['typeId']}': asJson(f['proof']),
    };
    return ListView(
      key: const Key('mpSectionForm'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.mpSectionHelp, style: TextStyle(color: muted)),
        const SizedBox(height: Tokens.sp3),
        for (final f in _fields) ...[
          Builder(
            builder: (context) {
              final key = '${f['key']}';
              final waiting = f.containsKey('pending');
              final hint = [
                waiting
                    ? s.mpFieldWaiting(mpShown(s, f['pending']))
                    : f['level'] == 'edit_direct'
                    ? s.mpAtOnce
                    : s.mpNeedsApproval,
                if (f['proof'] != null) s.mpAttach('${asJson(f['proof'])['name']}'),
              ].join(' · ');
              final label = '${f['label']}';
              Widget input;
              if (f['options'] is List) {
                final opts = [for (final o in f['options'] as List) '$o'];
                final was = _was[key]!;
                input = DropdownMenu<String>(
                  key: Key('mpField-$key'),
                  label: Text(label),
                  enabled: !waiting,
                  errorText: _errors[key],
                  trailingIcon: dropArrow(label),
                  selectedTrailingIcon: dropArrow(label, open: true),
                  expandedInsets: EdgeInsets.zero,
                  enableFilter: true,
                  enableSearch: true,
                  requestFocusOnTap: true,
                  initialSelection: _now[key],
                  onSelected: (v) => setState(() => _now[key] = v ?? ''),
                  dropdownMenuEntries: [
                    const DropdownMenuEntry(value: '', label: '—'),
                    if (was.isNotEmpty && !opts.contains(was))
                      DropdownMenuEntry(value: was, label: was),
                    for (final o in opts) DropdownMenuEntry(value: o, label: o),
                  ],
                );
              } else if (f['type'] == 'date') {
                input = _PickField(
                  key: Key('mpField-$key'),
                  label: label,
                  error: _errors[key],
                  value: mpShown(s, _now[key]),
                  onTap: waiting
                      ? null
                      : () async {
                          final d = await showDatePicker(
                            context: context,
                            initialDate: DateTime.tryParse(_now[key]!) ?? DateTime(1990),
                            firstDate: DateTime(1940),
                            // a birth or an anniversary has happened already
                            lastDate: key == 'dob' || key == 'anniversary'
                                ? schoolToday()
                                : DateTime(2100),
                          );
                          if (d != null) setState(() => _now[key] = ymd(d));
                        },
                );
              } else {
                final type = '${f['type']}';
                input = TextField(
                  key: Key('mpField-$key'),
                  controller: _text[key],
                  enabled: !waiting,
                  maxLength: switch (type) {
                    'mobile' => 15,
                    'digits12' => 14,
                    'pan' => 10,
                    'ifsc' => 11,
                    'account' => 18,
                    _ => 300,
                  },
                  keyboardType: switch (type) {
                    'email' => TextInputType.emailAddress,
                    'mobile' => TextInputType.phone,
                    'digits12' || 'account' || 'number' => TextInputType.number,
                    _ => key == 'phone' ? TextInputType.phone : TextInputType.text,
                  },
                  textCapitalization: f['upper'] == true || type == 'pan' || type == 'ifsc'
                      ? TextCapitalization.characters
                      : TextCapitalization.none,
                  decoration: InputDecoration(
                    labelText: label,
                    border: const OutlineInputBorder(),
                    counterText: '',
                    errorText: _errors[key],
                    errorMaxLines: 3,
                  ),
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  input,
                  Padding(
                    padding: const EdgeInsets.only(top: Tokens.sp1),
                    child: Text(
                      [hint, if (f['help'] != null) '${f['help']}'].join(' · '),
                      style: TextStyle(color: muted, fontSize: 12),
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: Tokens.sp3),
        ],
        if (proofs.isNotEmpty) ...[
          SectionTitle(s.mpProofs),
          for (final pr in proofs.values) ...[
            Text('${pr['name']} (${s.mpProofHelp})', style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp1),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton.icon(
                  key: Key('mpProof-${pr['typeId']}'),
                  icon: const Icon(Icons.upload_file),
                  label: Text(s.mpChooseFile),
                  onPressed: () async {
                    final f = await _pickOne(context, ref, s);
                    if (f != null) setState(() => _proofs['${pr['typeId']}'] = f);
                  },
                ),
                if (_proofs['${pr['typeId']}'] != null) Text(_proofs['${pr['typeId']}']!.name),
              ],
            ),
            const SizedBox(height: Tokens.sp2),
          ],
        ],
        TextField(
          key: const Key('mpWhy'),
          controller: _reason,
          maxLength: 500,
          decoration: InputDecoration(
            labelText: s.mpWhy,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
        const SizedBox(height: Tokens.sp3),
        FilledButton(
          key: const Key('mpSend'),
          onPressed: _busy ? null : _send,
          child: Text(s.mpSend),
        ),
      ],
    );
  }
}

/// Add or change one row of a list (education, languages, experience, training, documents), as the website's: the
/// list's columns, a document's file, the proof the school asks for, why. Pops with what happened.
class _RowForm extends ConsumerStatefulWidget {
  const _RowForm({required this.list, required this.row});
  final Json list;
  final Json? row;

  @override
  ConsumerState<_RowForm> createState() => _RowFormState();
}

class _RowFormState extends ConsumerState<_RowForm> {
  late final List<Json> _cols = asList(widget.list['columns']);
  late final Json _v = asJson(widget.row?['values']);
  late final Map<String, Object?> _data = {
    for (final c in _cols)
      if (c['type'] != 'file') '${c['key']}': _v[c['key']],
  };
  late final Map<String, TextEditingController> _text = {
    for (final c in _cols)
      if (c['type'] == 'text' || c['type'] == 'year')
        '${c['key']}': TextEditingController(text: _v[c['key']] == null ? '' : '${_v[c['key']]}'),
  };
  final _reason = TextEditingController();
  PickedFile? _doc;
  PickedFile? _proof;
  bool _busy = false;
  String? _error;

  String get _kind => '${widget.list['id']}';

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final now = schoolToday().year;
    for (final c in _cols) {
      final key = '${c['key']}';
      if (c['type'] == 'year' && (_text[key]?.text.trim() ?? '').isNotEmpty) {
        final y = int.tryParse(_text[key]!.text.trim());
        if (y == null || y < 1940 || y > now) {
          return setState(() => _error = '${c['label']}: ${s.mpRuleYear(now)}');
        }
      }
    }
    final from = '${_data['fromOn'] ?? ''}';
    final to = '${_data['toOn'] ?? ''}';
    if (from.isNotEmpty && to.isNotEmpty && to.compareTo(from) < 0) {
      return setState(() => _error = s.mpRuleEndBeforeStart);
    }
    final issued = '${_data['issuedOn'] ?? ''}';
    final till = '${_data['expiresOn'] ?? ''}';
    if (issued.isNotEmpty && till.isNotEmpty && till.compareTo(issued) <= 0) {
      return setState(() => _error = s.mpRuleValidTill);
    }
    final data = <String, Object?>{};
    for (final c in _cols) {
      final key = '${c['key']}';
      final type = '${c['type']}';
      if (type == 'file') continue;
      if (type == 'boolean') {
        data[key] = _data[key] == true;
        continue;
      }
      final raw = (_text[key]?.text ?? '${_data[key] ?? ''}').trim();
      if (raw.isEmpty) {
        if (c['required'] == true) return setState(() => _error = s.mpRequired('${c['label']}'));
        continue;
      }
      data[key] = type == 'year' ? (int.tryParse(raw) ?? raw) : raw;
    }
    if (_kind == 'documents' && _doc == null) return setState(() => _error = s.mpAttachDoc);
    final proof = asJson(widget.list['proof']);
    if (proof.isNotEmpty && _proof == null) {
      return setState(() => _error = s.mpAttachProof('${proof['name']}'));
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_doc != null) data['fileId'] = await _upload(ref, _doc!);
      final proofs = [
        if (_proof != null)
          EmployeeChangesDtoProofsItem(
            typeId: '${proof['typeId']}',
            fileId: await _upload(ref, _proof!),
          ),
      ];
      final r = asJson(
        await ref
            .read(apiProvider)
            .employeeSelfSubmit(
              body: EmployeeChangesDto(
                rows: [
                  EmployeeChangesDtoRowsItem(
                    kind: _kind,
                    op: widget.row == null ? 'add' : 'edit',
                    rowId: widget.row == null ? null : '${widget.row!['id']}',
                    data: data,
                  ),
                ],
                reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
                proofs: proofs.isEmpty ? null : proofs,
              ),
            ),
      );
      if (mounted) {
        Navigator.of(context)
            .pop(asList(r['applied']).isNotEmpty ? s.mpSaved : s.mpSentForApproval);
      }
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
    final proof = asJson(widget.list['proof']);
    return ListView(
      key: const Key('mpRowForm'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(
          widget.list['level'] == 'edit_direct' ? s.mpRowDirect : s.mpRowApproval,
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: Tokens.sp3),
        for (final c in _cols) ...[
          Builder(
            builder: (context) {
              final key = '${c['key']}';
              final label = '${c['label']}${c['required'] == true ? ' *' : ''}';
              switch ('${c['type']}') {
                case 'file':
                  return Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(s.mpFileField('${c['label']}')),
                      OutlinedButton.icon(
                        key: const Key('mpDocFile'),
                        icon: const Icon(Icons.upload_file),
                        label: Text(s.mpChooseFile),
                        onPressed: () async {
                          final f = await _pickOne(context, ref, s);
                          if (f != null) setState(() => _doc = f);
                        },
                      ),
                      if (_doc != null) Text(_doc!.name),
                    ],
                  );
                case 'boolean':
                  return CheckboxListTile(
                    key: Key('mpCol-$key'),
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: _data[key] == true,
                    onChanged: (v) => setState(() => _data[key] = v ?? false),
                    title: Text('${c['label']}'),
                  );
                case 'select':
                case 'doctype':
                  final now = _data[key] == null ? null : '${_data[key]}';
                  final entries = [
                    for (final o in (c['options'] as List? ?? const []))
                      o is Map
                          ? DropdownMenuEntry(
                              value: '${o['id']}',
                              label: o['hasExpiry'] == true
                                  ? s.mpNeedsExpiry('${o['name']}')
                                  : '${o['name']}',
                            )
                          : DropdownMenuEntry(value: '$o', label: '$o'),
                  ];
                  return DropdownMenu<String>(
                    key: Key('mpCol-$key'),
                    label: Text(label),
                    trailingIcon: dropArrow(label),
                    selectedTrailingIcon: dropArrow(label, open: true),
                    expandedInsets: EdgeInsets.zero,
                    enableFilter: true,
                    enableSearch: true,
                    requestFocusOnTap: true,
                    initialSelection: now,
                    onSelected: (v) => setState(() => _data[key] = v),
                    dropdownMenuEntries: [
                      ...entries,
                      if (now != null && !entries.any((e) => e.value == now))
                        DropdownMenuEntry(value: now, label: now),
                    ],
                  );
                case 'date':
                  final now = _data[key] == null ? null : '${_data[key]}';
                  return _PickField(
                    key: Key('mpCol-$key'),
                    label: label,
                    value: now == null || now.isEmpty ? s.mpChoose : mpShown(s, now),
                    onTap: () async {
                      final last = _pastDates.contains(key) ? schoolToday() : DateTime(2100);
                      final at = DateTime.tryParse(now ?? '') ?? schoolToday();
                      final d = await showDatePicker(
                        context: context,
                        initialDate: at.isAfter(last) ? last : at,
                        firstDate: DateTime(1940),
                        // what already happened (a job, a training, an issue) is not after today
                        lastDate: last,
                      );
                      if (d != null) setState(() => _data[key] = ymd(d));
                    },
                  );
                default:
                  return TextField(
                    key: Key('mpCol-$key'),
                    controller: _text[key],
                    maxLength: c['type'] == 'year' ? 4 : ((c['max'] as num?)?.toInt() ?? 200),
                    keyboardType: c['type'] == 'year' ? TextInputType.number : TextInputType.text,
                    decoration: InputDecoration(
                      labelText: label,
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                  );
              }
            },
          ),
          const SizedBox(height: Tokens.sp3),
        ],
        if (proof.isNotEmpty) ...[
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(s.mpAttachProof('${proof['name']}')),
              OutlinedButton.icon(
                key: const Key('mpRowProof'),
                icon: const Icon(Icons.upload_file),
                label: Text(s.mpChooseFile),
                onPressed: () async {
                  final f = await _pickOne(context, ref, s);
                  if (f != null) setState(() => _proof = f);
                },
              ),
              if (_proof != null) Text(_proof!.name),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
        ],
        TextField(
          key: const Key('mpRowWhy'),
          controller: _reason,
          maxLength: 500,
          decoration: InputDecoration(
            labelText: s.mpWhy,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
        const SizedBox(height: Tokens.sp3),
        FilledButton(
          key: const Key('mpRowSend'),
          onPressed: _busy ? null : _send,
          child: Text(widget.row == null ? s.mpAdd : s.mpSendChange),
        ),
      ],
    );
  }
}
