import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../staff/data.dart' show PickedFile, uploadFile;
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'attendance.dart' show leaveFilePickerProvider;
import 'common.dart';
import 'data.dart';
import 'fee_pay.dart';

/// The words of the consent forms (as the website's, in English and Hindi).
extension ConsentWords on S {
  String _cf(String en, String hi) => hindi ? hi : en;

  // ---- the list
  String get cfTitle => _cf('Consent forms', 'सहमति फ़ॉर्म');
  String get cfStaffTitle => _cf('Forms and declarations', 'फ़ॉर्म और घोषणाएँ');
  String get cfStaffLead => _cf(
    'Consent forms, surveys and declarations the school asks you to answer.',
    'सहमति फ़ॉर्म, सर्वेक्षण और घोषणाएँ, जिनका उत्तर विद्यालय आपसे माँगता है।',
  );
  String get cfParentPays => _cf(
    'Your parent pays it (the parent app or the school office)',
    'आपके अभिभावक इसका भुगतान करते हैं (अभिभावक ऐप या विद्यालय कार्यालय)',
  );
  String get cfLead => _cf(
    'Trips, events and permissions the school asks you to answer.',
    'यात्राएँ, कार्यक्रम और अनुमतियाँ, जिनका उत्तर विद्यालय आपसे माँगता है।',
  );
  String get cfToAnswer => _cf('To answer', 'उत्तर देना है');
  String get cfWaiting => _cf('Waiting for the school', 'विद्यालय की प्रतीक्षा');
  String get cfFeeToPay => _cf('Fee to pay', 'देय शुल्क');
  String get cfAnswered => _cf('Answered', 'उत्तर दिया');
  String get cfClosed => _cf('Closed', 'बंद');
  String cfTab(String label, int n) => '$label ($n)';
  String get cfClosesToday => _cf('Closes today', 'आज बंद होगा');
  String get cfClosesTomorrow => _cf('Closes tomorrow', 'कल बंद होगा');
  String cfCloses(String day) => _cf('Closes $day', '$day को बंद होगा');
  String get cfHasFee => _cf('Has a fee', 'शुल्क लगेगा');
  String get cfSchoolApproves => _cf('School approves', 'विद्यालय स्वीकृति देगा');
  String get cfReadSchool => _cf('Read what the school says', 'विद्यालय का संदेश पढ़ें');
  String get cfApproved => _cf('Approved', 'स्वीकृत');
  String get cfNotApproved => _cf('Not approved', 'स्वीकृत नहीं');
  String cfFee(String amount) => _cf('Fee $amount', 'शुल्क $amount');
  String cfToPay(String amount) => _cf('$amount to pay', '$amount देय');
  String get cfPaid => _cf('paid', 'भुगतान हुआ');
  String get cfAfterApproval => _cf('after approval', 'स्वीकृति के बाद');
  String cfPay(String amount) => _cf('Pay $amount', '$amount का भुगतान करें');
  String get cfPayAtOffice => _cf('Pay at the school office', 'विद्यालय कार्यालय में भुगतान करें');
  String get cfChange => _cf('Change', 'बदलें');
  String cfChangeOf(String number) => _cf('Change $number', '$number बदलें');
  String get cfAnswerNow => _cf('Answer now', 'अभी उत्तर दें');
  String get cfAnswerAgain => _cf('Answer again', 'फिर से उत्तर दें');
  String cfEditUntil(String day) =>
      _cf('You can change your answer until $day', 'आप $day तक अपना उत्तर बदल सकते हैं');
  String get cfNothingToAnswer => _cf('Nothing to answer', 'उत्तर देने को कुछ नहीं');
  String get cfNoAnswers => _cf('No answers yet', 'अभी कोई उत्तर नहीं');
  String get cfNoClosed => _cf('No closed forms', 'कोई बंद फ़ॉर्म नहीं');
  String get cfEmptyTodo => _cf(
    'When the school asks for your consent, the form appears here and on your home screen.',
    'जब विद्यालय आपकी सहमति माँगेगा, फ़ॉर्म यहाँ और आपकी होम स्क्रीन पर दिखेगा।',
  );
  String get cfEmptyDone => _cf(
    'Forms you answer stay here with their PDF copy.',
    'जिन फ़ॉर्म का आप उत्तर देते हैं, वे अपनी PDF प्रति के साथ यहाँ रहते हैं।',
  );
  String cfSavedAs(String number) => _cf(
    'Thank you. Your answer is saved as $number.',
    'धन्यवाद। आपका उत्तर $number के रूप में सहेजा गया।',
  );
  String get cfWillApprove => _cf(
    'The school will approve it; you will be told.',
    'विद्यालय इसे स्वीकृत करेगा; आपको बताया जाएगा।',
  );
  String cfFeeDue(String amount) => _cf(
    'A fee of $amount is now due: pay it below.',
    '$amount का शुल्क अब देय है: नीचे भुगतान करें।',
  );
  String cfChanged(String number) =>
      _cf('Your answer $number is changed.', 'आपका उत्तर $number बदल दिया गया।');
  String get cfPaidOk => _cf(
    'Payment received. Thank you. The receipt is on the Fees page.',
    'भुगतान प्राप्त। धन्यवाद। रसीद फ़ीस पेज पर है।',
  );
  String get cfPaidNot => _cf(
    'The payment did not go through. No money was taken; you can try again.',
    'भुगतान नहीं हुआ। कोई पैसा नहीं कटा; आप फिर से कोशिश कर सकते हैं।',
  );

  // ---- filling a form
  String get cfForm => _cf('Consent form', 'सहमति फ़ॉर्म');
  String cfChangeYour(String number) =>
      _cf('Change your answer $number', 'अपना उत्तर $number बदलें');
  String get cfCannotChange =>
      _cf('This answer can no longer be changed.', 'यह उत्तर अब बदला नहीं जा सकता।');
  String cfAlready(String numbers) =>
      _cf('Already answered: $numbers', 'उत्तर पहले ही दिया जा चुका है: $numbers');
  String cfIsClosed(String? why) {
    final w = cfWhy(why);
    return w.isEmpty
        ? _cf('This form is closed.', 'यह फ़ॉर्म बंद है।')
        : _cf('This form is closed ($w).', 'यह फ़ॉर्म बंद है ($w)।');
  }

  /// why a form takes no answers (the API's words)
  String cfWhy(String? why) {
    final w = why ?? '';
    if (w.isEmpty || w == 'closed') return '';
    if (w == 'all places are taken') return _cf(w, 'सभी स्थान भर गए');
    if (w == 'not published yet') return _cf(w, 'अभी प्रकाशित नहीं हुआ');
    final opens = RegExp(r'^opens on (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?').firstMatch(w);
    if (opens != null) {
      final at = '${date(opens[1]!)}${opens[2] != null ? ', ${opens[2]}' : ''}';
      return _cf('opens on $at', '$at को खुलेगा');
    }
    return w;
  }

  String cfStep(int n, int of) => _cf('Step $n of $of', 'चरण $n (कुल $of)');
  String cfNeeded(String label) =>
      _cf('$label: an answer is needed', '$label: उत्तर देना ज़रूरी है');
  String cfAtLeast(String label, String n) => _cf('$label: at least $n', '$label: कम से कम $n');
  String cfAtMost(String label, String n) => _cf('$label: at most $n', '$label: अधिक से अधिक $n');
  String cfEmailNeeded(String label) =>
      _cf('$label: an email address is needed', '$label: ई-मेल पता चाहिए');
  String get cfYes => _cf('Yes', 'हाँ');
  String get cfNo => _cf('No', 'नहीं');
  String get cfChoose => _cf('Choose…', 'चुनें…');
  String get cfChooseDate => _cf('Choose a date', 'तारीख़ चुनें');
  String get cfChooseTime => _cf('Choose a time', 'समय चुनें');
  String cfFeeLine(String amount) => _cf('Fee: $amount', 'शुल्क: $amount');
  String get cfAfterApproves =>
      _cf('to pay after the school approves', 'विद्यालय की स्वीकृति के बाद देय');
  String get cfDueOnSubmit => _cf('due once you submit', 'जमा करते ही देय');
  String get cfSignerName =>
      _cf('Your name (as the parent signing)', 'आपका नाम (हस्ताक्षर करने वाले अभिभावक के रूप में)');
  String get cfNeedName =>
      _cf('Write your name (at least 2 letters).', 'अपना नाम लिखें (कम से कम 2 अक्षर)।');
  String get cfBack => _cf('Back', 'पीछे');
  String get cfNext => _cf('Next', 'आगे');
  String get cfSubmit => _cf('Submit', 'जमा करें');
  String get cfSaveChange => _cf('Save the change', 'बदलाव सहेजें');
  String get cfSending => _cf('Sending…', 'भेजा जा रहा है…');
  String cfSignHere(String label) =>
      _cf('$label: sign in this box', '$label: इस खाने में हस्ताक्षर करें');
  String get cfSigned => _cf('Signed', 'हस्ताक्षर हो गए');
  String get cfSignedEarlier => _cf(
    'Signed earlier: that signature stays unless you sign again',
    'पहले हस्ताक्षर किए थे: दोबारा हस्ताक्षर न करें तो वही रहेंगे',
  );
  String get cfSignAbove => _cf('Sign in the box above', 'ऊपर के खाने में हस्ताक्षर करें');
  String get cfClear => _cf('Clear', 'मिटाएँ');
  String cfClearOf(String label) => _cf('Clear $label', '$label मिटाएँ');
  String get cfAddFile => _cf('Add a file', 'फ़ाइल जोड़ें');
  String cfAddFileTo(String label) => _cf('Add a file: $label', 'फ़ाइल जोड़ें: $label');
  String cfFilesHelp(int n) => n == 1
      ? _cf('A PDF or a photo of up to 5 MB.', '5 MB तक की एक PDF या फ़ोटो।')
      : _cf(
          'PDF or photos, up to $n files of 5 MB each.',
          'PDF या फ़ोटो, 5 MB तक की अधिकतम $n फ़ाइलें।',
        );
  String cfRemoveFile(String name) => _cf('Remove $name', '$name हटाएँ');
  String get cfFileWrong =>
      _cf('Add PDFs or photos of 5 MB or less.', '5 MB तक की PDF या फ़ोटो जोड़ें।');
  String get cfFilesKept => _cf(
    'Sent earlier: those files stay unless you add new ones',
    'पहले भेजी गई: नई फ़ाइलें न जोड़ें तो वही रहेंगी',
  );
}

// ------------------------------------------------------------------------------------------------ the rules

/// No answer: nothing, an empty text or an empty list.
bool consentEmpty(Object? v) => v == null || v == '' || (v is List && v.isEmpty);

/// An answer as JavaScript's String() writes it (3, not 3.0).
String _js(Object? v) {
  if (v == null) return '';
  if (v is double && v.isFinite && v == v.truncateToDouble()) return '${v.toInt()}';
  return '$v';
}

/// A text as JavaScript's Number() reads it ('' is 0, nonsense is NaN).
double _jsNum(String s) {
  final t = s.trim();
  if (t.isEmpty) return 0;
  return double.tryParse(t) ?? double.nan;
}

double _n(Object? v) => v is num ? v.toDouble() : (double.tryParse('${v ?? ''}') ?? 0);

/// The same conditions as the server and the website (consent-fields.ts holds).
bool _holds(Json c, Object? v) {
  final text = v is List ? v.map(_js).join(', ') : _js(v);
  final want = '${c['value'] ?? ''}';
  switch ('${c['op']}') {
    case 'eq':
      return v is List ? v.map(_js).contains(want) : text.toLowerCase() == want.toLowerCase();
    case 'neq':
      return v is List ? !v.map(_js).contains(want) : text.toLowerCase() != want.toLowerCase();
    case 'contains':
      return text.toLowerCase().contains(want.toLowerCase());
    case 'gt':
      return text.isNotEmpty && _jsNum(text) > _jsNum(want);
    case 'lt':
      return text.isNotEmpty && _jsNum(text) < _jsNum(want);
    case 'in':
      final list = [for (final x in want.split(',')) x.trim().toLowerCase()];
      return v is List
          ? v.any((x) => list.contains(_js(x).toLowerCase()))
          : list.contains(text.toLowerCase());
    case 'empty':
      return consentEmpty(v);
    case 'not_empty':
      return !consentEmpty(v);
    default:
      return false;
  }
}

/// Is the field shown, and must it be answered, given the answers so far (the website's consentRuleState; the
/// server checks again).
({bool shown, bool required}) consentRuleState(Json f, Map<String, Object?> answers) {
  final required = f['required'] == true;
  final rule = f['rule'];
  if (rule is! Map) return (shown: true, required: required);
  final r = asJson(rule);
  final results = [for (final c in asList(r['conditions'])) _holds(c, answers['${c['field']}'])];
  final match = r['logic'] == 'any' ? results.any((x) => x) : results.every((x) => x);
  return switch ('${r['action']}') {
    'show' => (shown: match, required: match && required),
    'hide' => (shown: !match, required: !match && required),
    _ => (shown: true, required: required || match),
  };
}

/// The form's fee for the answers so far, as the server sums it (fixed; or a base, a rate times a number and a
/// price per choice — only for the fields shown).
double consentFeeOf(Json fee, List<Json> fields, Map<String, Object?> answers) {
  final mode = '${fee['mode'] ?? 'none'}';
  if (mode == 'none') return 0;
  if (mode == 'fixed') return _n(fee['amount']);
  var total = _n(fee['base']);
  for (final it in asList(fee['items'])) {
    final f = fields.where((x) => '${x['key']}' == '${it['field']}').firstOrNull;
    final v = answers['${it['field']}'];
    if (f == null || consentEmpty(v) || !consentRuleState(f, answers).shown) continue;
    final prices = it['prices'];
    if (f['type'] == 'number' && it['rate'] != null) {
      total += _jsNum(_js(v)) * _n(it['rate']);
    } else if (prices is Map) {
      final picked = v is List
          ? [for (final x in v) _js(x)]
          : [f['type'] == 'yesno' ? (v == true ? 'Yes' : 'No') : _js(v)];
      for (final p in picked) {
        total += _n(prices[p]);
      }
    }
  }
  return math.max(0, (total * 100).round() / 100);
}

/// The steps of a form: a page break starts a new one (empty steps dropped).
List<List<Json>> consentSteps(List<Json> fields) {
  final out = <List<Json>>[[]];
  for (final f in fields) {
    if (f['type'] == 'pagebreak') {
      if (out.last.isNotEmpty) out.add([]);
      continue;
    }
    out.last.add(f);
  }
  final steps = out.where((x) => x.isNotEmpty).toList();
  return steps.isEmpty ? [<Json>[]] : steps;
}

/// A drawing as the website's canvas sends it: a PNG data URL (`data:image/png;base64,…`), the strokes in navy on a
/// clear background at twice the size drawn.
Future<String> consentSignaturePng(
  List<List<Offset>> strokes,
  Size size, {
  double ratio = 2,
}) async {
  final rec = ui.PictureRecorder();
  final canvas = Canvas(rec)..scale(ratio);
  _paintInk(canvas, strokes, Tokens.mobNavy800);
  final picture = rec.endRecording();
  final image = await picture.toImage(
    math.max(1, (size.width * ratio).ceil()),
    math.max(1, (size.height * ratio).ceil()),
  );
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return 'data:image/png;base64,${base64Encode(bytes!.buffer.asUint8List())}';
}

void _paintInk(Canvas c, List<List<Offset>> strokes, Color color) {
  final pen = Paint()
    ..color = color
    ..strokeWidth = 2.5
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;
  for (final st in strokes) {
    if (st.isEmpty) continue;
    if (st.length == 1) {
      c.drawCircle(st.first, 1.5, Paint()..color = color);
      continue;
    }
    final path = Path()..moveTo(st.first.dx, st.first.dy);
    for (final o in st.skip(1)) {
      path.lineTo(o.dx, o.dy);
    }
    c.drawPath(path, pen);
  }
}

// ------------------------------------------------------------------------------------------------ the data

/// The forms for the family (`{forms: [...]}`): each with the people asked, their answers and whether they may
/// answer now.
final consentFormsProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((
  ref,
  p,
) async {
  final r = await cached('consents:${p.id}', () => ref.read(apiProvider).consentFormsMine());
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// One form to fill for the child `(form, child, answer being changed)`, and the signed-in person's name.
final consentFillProvider = FutureProvider.autoDispose
    .family<(Json, String), (String, String?, String?)>((ref, a) async {
      final (id, studentId, responseId) = a;
      final api = ref.read(apiProvider);
      final f = asJson(
        await api.consentFormsMineForm(id: id, studentId: studentId, responseId: responseId),
      );
      var me = '';
      try {
        me = '${asJson(asJson(await api.meMe())['user'])['displayName'] ?? ''}';
      } catch (_) {
        me = ''; // the name is then typed
      }
      return (f, me);
    });

/// Whole days from now (India time) to a `YYYY-MM-DDTHH:MM` wall-clock time, as the website counts them.
int? _daysTo(String? at) {
  if (at == null || at.length < 16) return null;
  final to = DateTime.tryParse('${at.substring(0, 16)}:00Z');
  if (to == null) return null;
  // by the calendar in India: tomorrow 17:00 is "tomorrow" at 19:00 today too
  final now = DateTime.now().toUtc().add(const Duration(minutes: 330));
  return DateTime.utc(
    to.year,
    to.month,
    to.day,
  ).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
}

double _due(Json r) =>
    r['lineId'] != null ? math.max(0, _n(r['lineAmount']) - _n(r['paid'])).toDouble() : 0;

// ------------------------------------------------------------------------------------------------ the list

/// The consent forms as the website's page (apps/parent/app/(app)/consents): the figures (to answer, waiting for the
/// school, fee to pay, answered), the tabs To answer / Answered / Closed, and a card per form: when it closes,
/// whether it has a fee or the school approves, the school's text folded, the child's answers with their status,
/// the fee, Pay, Change and the PDF copy; Answer now / Answer again.
class ConsentsScreen extends ConsumerStatefulWidget {
  const ConsentsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<ConsentsScreen> createState() => _ConsentsScreenState();
}

class _ConsentsScreenState extends ConsumerState<ConsentsScreen> {
  String _tab = 'todo';
  String? _message;
  String? _paid;

  Profile get _p => widget.profile;

  Future<void> _open(Json f, {String? responseId}) async {
    final s = ref.read(stringsProvider);
    final msg = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.cfForm,
          child: ConsentFillScreen(profile: _p, formId: '${f['id']}', responseId: responseId),
        ),
      ),
    );
    if (!mounted) return;
    ref.invalidate(consentFormsProvider);
    if (msg == null) return;
    setState(() {
      _message = msg;
      _paid = null;
      // a form answered once moves to Answered, where its fee is paid
      if (responseId == null && f['repeat'] != 'many') _tab = 'answered';
    });
  }

  Future<void> _pay(Json r, List<Json> gateways) async {
    final s = ref.read(stringsProvider);
    String? id = gateways.length == 1 ? '${gateways.first['id']}' : null;
    id ??= await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(s.choosePayThrough, style: Theme.of(c).textTheme.titleMedium)),
            for (final g in gateways)
              ListTile(
                key: Key('cfGateway-${g['id']}'),
                title: Text('${g['label']}'),
                subtitle: Text(
                  chargeText(s, g).isEmpty ? s.noCharge : s.convenienceCharge(chargeText(s, g)),
                ),
                onTap: () => Navigator.of(c).pop('${g['id']}'),
              ),
          ],
        ),
      ),
    );
    final gatewayId = id;
    if (gatewayId == null || !mounted) return;
    final paid = await payOnline(
      context,
      ref,
      (api) => api.paymentsCreateMineMisc(
        body: CreateFamilyMiscIntentDto(
          lineId: '${r['lineId']}',
          gatewayId: gatewayId,
          app: 'mobile',
        ),
      ),
    );
    if (paid == null || !mounted) return;
    ref.invalidate(consentFormsProvider);
    ref.invalidate(miscFeesProvider);
    setState(() {
      _paid = paid;
      _message = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final gateways = ref.watch(feeGatewaysProvider((_p, 'misc')));
    return LoadedList<Json>(
      value: ref.watch(consentFormsProvider(_p)),
      refresh: () {
        ref.invalidate(feeGatewaysProvider((_p, 'misc')));
        return ref.refresh(consentFormsProvider(_p).future);
      },
      children: (d) {
        // this child's part of each form
        final mine = <(Json, Json)>[
          for (final f in asList(d['forms']))
            if (asList(f['people'])
                    .where(
                      (x) => _p.isStaff
                          // staff: the part asked of themself (docs/design/28)
                          ? x['kind'] == 'staff'
                          : x['kind'] == 'student' &&
                                (_p.studentId == null || '${x['id']}' == _p.studentId),
                    )
                    .firstOrNull
                case final person?)
              (f, person),
        ];
        final todo = [
          for (final x in mine)
            if (x.$2['canAnswer'] == true) x,
        ];
        final answered = [
          for (final x in mine)
            if (x.$2['canAnswer'] != true &&
                x.$1['open'] == true &&
                asList(x.$2['responses']).isNotEmpty)
              x,
        ];
        final closed = [
          for (final x in mine)
            if (x.$1['open'] != true) x,
        ];
        final responses = [for (final x in mine) ...asList(x.$2['responses'])];
        final waiting = responses.where((r) => r['waiting'] == true).length;
        final feeDue = responses.fold<double>(0, (a, r) => a + _due(r));
        final answeredCount =
            answered.length + closed.where((x) => asList(x.$2['responses']).isNotEmpty).length;
        final list = switch (_tab) {
          'answered' => answered,
          'closed' => closed,
          _ => todo,
        };
        void go(String tab) => setState(() => _tab = tab);
        return [
          Text(
            _p.isStaff ? s.cfStaffTitle : s.cfTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(_p.isStaff ? s.cfStaffLead : s.cfLead, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
          if (_message != null) ...[
            _Alert(key: const Key('cfMessage'), text: _message!),
            const SizedBox(height: Tokens.sp3),
          ],
          if (_paid != null) ...[
            _Alert(
              key: const Key('cfPaid'),
              text: _paid == '1' ? s.cfPaidOk : s.cfPaidNot,
              danger: _paid != '1',
            ),
            const SizedBox(height: Tokens.sp3),
          ],
          FigureGrid(
            key: const Key('cfFigures'),
            tiles: [
              FigureTile(
                key: const Key('cfFig-todo'),
                label: s.cfToAnswer,
                value: '${todo.length}',
                icon: Icons.edit_note_outlined,
                tone: todo.isNotEmpty ? Tokens.statusWarning : null,
                onTap: () => go('todo'),
              ),
              FigureTile(
                key: const Key('cfFig-waiting'),
                label: s.cfWaiting,
                value: '$waiting',
                icon: Icons.hourglass_empty_outlined,
              ),
              FigureTile(
                key: const Key('cfFig-fee'),
                label: s.cfFeeToPay,
                value: s.money(feeDue),
                icon: Icons.payments_outlined,
                tone: feeDue > 0 ? Tokens.statusWarning : null,
              ),
              FigureTile(
                key: const Key('cfFig-answered'),
                label: s.cfAnswered,
                value: '$answeredCount',
                icon: Icons.task_alt_outlined,
                onTap: () => go('answered'),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp4),
          Semantics(
            label: s.cfTitle,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final (v, label, n) in [
                  ('todo', s.cfToAnswer, todo.length),
                  ('answered', s.cfAnswered, answered.length),
                  ('closed', s.cfClosed, closed.length),
                ])
                  ChoiceChip(
                    key: Key('cfTab-$v'),
                    label: Text(s.cfTab(label, n)),
                    selected: _tab == v,
                    showCheckmark: false,
                    onSelected: (_) => go(v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          if (list.isEmpty)
            Card(
              key: const Key('cfEmpty'),
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(switch (_tab) {
                      'answered' => s.cfNoAnswers,
                      'closed' => s.cfNoClosed,
                      _ => s.cfNothingToAnswer,
                    }, style: const TextStyle(fontWeight: Tokens.fwBold)),
                    const SizedBox(height: Tokens.sp1),
                    Text(
                      _tab == 'todo' ? s.cfEmptyTodo : s.cfEmptyDone,
                      style: TextStyle(color: muted, fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),
          for (final (f, person) in list) _card(s, f, person, gateways, muted, dark),
        ];
      },
    );
  }

  Widget _card(S s, Json f, Json person, AsyncValue<List<Json>?> gateways, Color muted, bool dark) {
    final id = '${f['id']}';
    final open = f['open'] == true;
    final canAnswer = person['canAnswer'] == true;
    final closesAt = f['closesAt'] as String?;
    final days = _daysTo(closesAt);
    final urgent = days != null && days <= 2;
    final stripe = !open
        ? (dark ? Tokens.mobGray500 : Tokens.borderStrong)
        : canAnswer
        ? (urgent ? Tokens.statusDanger : Tokens.mobCyan600)
        : Tokens.statusSuccess;
    final description = '${f['description'] ?? ''}'.trim();
    final responses = asList(person['responses']);
    final editUntil = f['editUntil'] as String?;
    return Card(
      key: Key('cf-$id'),
      child: Container(
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(color: stripe, width: Tokens.sp1),
          ),
        ),
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${f['title'] ?? ''}',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              children: [
                if (!open)
                  StatusChip(s.cfClosed, Tone.neutral)
                else if (closesAt != null)
                  StatusChip(
                    days != null && days <= 0
                        ? s.cfClosesToday
                        : days == 1
                        ? s.cfClosesTomorrow
                        : s.cfCloses(s.date(closesAt.substring(0, 10))),
                    urgent ? Tone.danger : Tone.warning,
                  ),
                if ((f['feeMode'] ?? 'none') != 'none') StatusChip(s.cfHasFee, Tone.info),
                if (f['approval'] == true) StatusChip(s.cfSchoolApproves, Tone.neutral),
              ],
            ),
            if (description.isNotEmpty)
              ExpansionTile(
                key: Key('cfRead-$id'),
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsets.only(bottom: Tokens.sp2),
                shape: const Border(),
                collapsedShape: const Border(),
                expandedCrossAxisAlignment: CrossAxisAlignment.start,
                expandedAlignment: AlignmentDirectional.centerStart,
                title: Text(
                  s.cfReadSchool,
                  style: const TextStyle(fontWeight: Tokens.fwSemibold, fontSize: 15),
                ),
                children: [SelectionArea(child: Text(description))],
              )
            else
              const SizedBox(height: Tokens.sp2),
            for (final r in responses) _answer(s, f, person, r, gateways, muted, dark),
            if (canAnswer) ...[
              const SizedBox(height: Tokens.sp2),
              Wrap(
                spacing: Tokens.sp3,
                runSpacing: Tokens.sp2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  FilledButton(
                    key: Key('cfAnswer-$id'),
                    onPressed: () => _open(f),
                    child: Semantics(
                      label:
                          '${responses.isEmpty ? s.cfAnswerNow : s.cfAnswerAgain}: ${f['title'] ?? ''}',
                      excludeSemantics: true,
                      child: Text(responses.isEmpty ? s.cfAnswerNow : s.cfAnswerAgain),
                    ),
                  ),
                  if (editUntil != null && editUntil.length >= 10)
                    Text(
                      s.cfEditUntil(s.date(editUntil.substring(0, 10))),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// One answer: its number and status, the school's note, the fee, Pay, Change and the PDF copy.
  Widget _answer(
    S s,
    Json f,
    Json person,
    Json r,
    AsyncValue<List<Json>?> gateways,
    Color muted,
    bool dark,
  ) {
    final rid = '${r['id']}';
    final number = '${r['number'] ?? ''}';
    final status = '${r['status']}';
    final fee = _n(r['fee']);
    final d = _due(r);
    final (word, tone) = r['waiting'] == true
        ? (s.cfWaiting, Tone.warning)
        : status == 'approved'
        ? (s.cfApproved, Tone.success)
        : status == 'rejected'
        ? (s.cfNotApproved, Tone.danger)
        : (s.cfAnswered, Tone.success);
    // none: the school takes no online payment for these fees (or the person may not pay online)
    final gw = gateways.value ?? const <Json>[];
    final canPay = _p.kind == 'parent' && gw.isNotEmpty;
    final note = '${r['decidedNote'] ?? ''}'.trim();
    return Container(
      key: Key('cfResponse-$rid'),
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: (dark ? Tokens.mobGray700 : Tokens.mobGray100))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(number, style: const TextStyle(fontWeight: Tokens.fwBold)),
              StatusChip(word, tone),
            ],
          ),
          if (note.isNotEmpty) Text(note, style: TextStyle(color: muted, fontSize: 13)),
          if (fee > 0)
            Text(
              [
                s.cfFee(s.money(fee)),
                if (r['lineId'] != null)
                  d > 0 ? s.cfToPay(s.money(d)) : s.cfPaid
                else if (status != 'rejected')
                  s.cfAfterApproval,
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (r['lineId'] != null && d > 0)
                if (canPay)
                  FilledButton.icon(
                    key: Key('cfPay-$rid'),
                    icon: const Icon(Icons.lock_outline, size: 18),
                    label: Text(s.cfPay(s.money(d))),
                    onPressed: () => _pay(r, gw),
                  )
                else if (_p.kind == 'student')
                  // a student answers their own forms; the fee is the parent's to pay
                  Text(
                    s.cfParentPays,
                    key: Key('cfParentPays-$rid'),
                    style: TextStyle(color: muted, fontSize: 13),
                  )
                else if (!gateways.isLoading || gateways.hasValue)
                  Text(
                    s.cfPayAtOffice,
                    key: Key('cfPayOffice-$rid'),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
              if (r['canEdit'] == true)
                OutlinedButton(
                  key: Key('cfChange-$rid'),
                  onPressed: () => _open(f, responseId: rid),
                  child: Semantics(
                    label: s.cfChangeOf(number),
                    excludeSemantics: true,
                    child: Text(s.cfChange),
                  ),
                ),
              FileIcons(
                name: 'cfPdf-$rid',
                label: '${f['title'] ?? ''} $number',
                load: () => ref.read(apiProvider).consentFormsMinePdf(rid: rid),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A line of news on a tint: green for done, red for did not work.
class _Alert extends StatelessWidget {
  const _Alert({super.key, required this.text, this.danger = false});
  final String text;
  final bool danger;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.all(Tokens.sp3),
      decoration: BoxDecoration(
        color: (danger ? Tokens.statusDangerBg : Tokens.statusSuccessBg),
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            danger ? Icons.error_outline : Icons.check_circle_outline,
            size: 20,
            color: (danger ? Tokens.mobRed600 : Tokens.mobGreen600),
          ),
          const SizedBox(width: Tokens.sp2),
          Expanded(
            child: Text(text, style: const TextStyle(color: Tokens.textBody)),
          ),
        ],
      ),
    ),
  );
}

// ------------------------------------------------------------------------------------------------ filling a form

/// Answering one consent form for the child, or changing an answer, as the website's form (ConsentFill): the
/// school's text, the questions step by step (a page break starts a step) with the show / hide / require rules,
/// the fee as the answers change, files, a signature drawn with a finger, the name of the parent signing. Pops with
/// the website's message: "Thank you. Your answer is saved as …" or "Your answer … is changed."
class ConsentFillScreen extends ConsumerStatefulWidget {
  const ConsentFillScreen({
    super.key,
    required this.profile,
    required this.formId,
    this.responseId,
  });
  final Profile profile;
  final String formId;

  /// the answer being changed
  final String? responseId;

  @override
  ConsumerState<ConsentFillScreen> createState() => _ConsentFillScreenState();
}

class _ConsentFillScreenState extends ConsumerState<ConsentFillScreen> {
  bool _ready = false;
  final Map<String, Object?> _answers = {};
  final Map<String, TextEditingController> _text = {};
  final Map<String, List<PickedFile>> _files = {};
  final Map<String, _Ink> _inks = {};
  final Map<String, Future<void>> _signing = {};
  final Map<String, int> _signGen = {};
  final Set<String> _drawn = {};
  final Set<String> _keptSignatures = {};
  final Set<String> _keptFiles = {};
  final _name = TextEditingController();
  final _scroll = ScrollController();
  int _step = 0;
  String? _problem;
  bool _busy = false;

  (String, String?, String?) get _key =>
      (widget.formId, widget.profile.studentId, widget.responseId);

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    for (final i in _inks.values) {
      i.dispose();
    }
    _name.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// Once, when the form comes: what was answered before (a change) and the name of the parent signing.
  void _setup(Json f, String me) {
    if (_ready) return;
    _ready = true;
    final editing = f['editing'] is Map ? asJson(f['editing']) : null;
    final fields = asList(f['fields']);
    if (editing != null) {
      final given = asJson(editing['answers']);
      String? typeOf(String k) =>
          fields.where((x) => '${x['key']}' == k).firstOrNull?['type'] as String?;
      // a signature or files given before are kept ("keep") unless given again
      for (final e in given.entries) {
        final t = typeOf(e.key);
        if (t == 'signature' || t == 'file') continue;
        _answers[e.key] = e.value is List ? [for (final x in e.value as List) '$x'] : e.value;
      }
      for (final k in (editing['signed'] as List? ?? const [])) {
        _answers['$k'] = 'keep';
        _keptSignatures.add('$k');
      }
      for (final x in fields) {
        final k = '${x['key']}';
        if (x['type'] == 'file' && given[k] is List) {
          _answers[k] = 'keep';
          _keptFiles.add(k);
        }
      }
    }
    _name.text = (editing?['signedName'] as String?) ?? me;
  }

  void _set(String key, Object? v) => setState(() {
    _answers[key] = v;
    _problem = null;
  });

  List<String> _options(Json f, Json lists) => f['source'] != null
      ? [for (final x in (lists['${f['source']}'] as List? ?? const [])) '$x']
      : [for (final x in (f['options'] as List? ?? const [])) '$x'];

  /// The first field of [list] still to answer, with what to say (also a number out of range, a wrong e-mail).
  (Json, String)? _missing(S s, List<Json> list) {
    for (final f in list) {
      final type = '${f['type']}';
      if (type == 'heading') continue;
      final key = '${f['key']}';
      final label = '${f['label'] ?? ''}';
      final st = consentRuleState(f, _answers);
      if (!st.shown) continue;
      final v = _answers[key];
      if (st.required) {
        if (type == 'file') {
          if ((_files[key] ?? const []).isEmpty && v != 'keep') return (f, s.cfNeeded(label));
          continue;
        }
        if (type == 'agree' ? v != true : consentEmpty(v)) return (f, s.cfNeeded(label));
      }
      // what the website's browser checks by itself: a number in range, an e-mail address
      if (type == 'number' && v is num) {
        final min = f['min'] as num?;
        final max = f['max'] as num?;
        if (min != null && v < min) return (f, s.cfAtLeast(label, _js(min)));
        if (max != null && v > max) return (f, s.cfAtMost(label, _js(max)));
      }
      if (type == 'email' &&
          v is String &&
          v.trim().isNotEmpty &&
          !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(v.trim())) {
        return (f, s.cfEmailNeeded(label));
      }
    }
    return null;
  }

  Future<void> _signatures() async {
    if (_signing.isEmpty) return;
    await Future.wait(_signing.values.toList());
  }

  void _toStep(int n) {
    _step = n;
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  Future<void> _next(List<List<Json>> steps) async {
    final s = ref.read(stringsProvider);
    await _signatures();
    if (!mounted) return;
    final m = _missing(s, steps[_step]);
    setState(() {
      if (m != null) {
        _problem = m.$2;
      } else {
        _problem = null;
        _toStep(_step + 1);
      }
    });
  }

  Future<void> _submit(Json f, List<List<Json>> steps) async {
    final s = ref.read(stringsProvider);
    final fields = asList(f['fields']);
    final editing = f['editing'] is Map ? asJson(f['editing']) : null;
    await _signatures();
    if (!mounted) return;
    final m = _missing(s, [for (final st in steps) ...st]);
    if (m != null) {
      return setState(() {
        _toStep(math.max(0, steps.indexWhere((st) => st.contains(m.$1))));
        _problem = m.$2;
      });
    }
    final name = _name.text.trim();
    if (name.length < 2) return setState(() => _problem = s.cfNeedName);
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final api = ref.read(apiProvider);
      String? typeOf(String k) =>
          fields.where((x) => '${x['key']}' == k).firstOrNull?['type'] as String?;
      // the answers as the website sends them: a file question only as "keep", its new files by their ids
      final answers = <String, Object?>{
        for (final e in _answers.entries)
          if (typeOf(e.key) != 'file' || e.value == 'keep') e.key: e.value,
      };
      for (final x in fields.where((x) => x['type'] == 'file')) {
        final key = '${x['key']}';
        // a question hidden by its rule sends no files
        if (!consentRuleState(x, _answers).shown) continue;
        final ids = [
          for (final p in _files[key] ?? const <PickedFile>[])
            await uploadFile(api, ref.read(transportProvider), p),
        ];
        if (ids.isNotEmpty) answers[key] = ids;
      }
      if (editing != null) {
        final r = asJson(
          await api.consentFormsEdit(
            rid: '${editing['id']}',
            body: ConsentEditDto(answers: answers, signedName: name),
          ),
        );
        if (mounted) Navigator.of(context).pop(s.cfChanged('${r['number'] ?? editing['number']}'));
      } else {
        final r = asJson(
          await api.consentFormsRespond(
            id: widget.formId,
            body: ConsentRespondDto(
              studentId: widget.profile.studentId,
              answers: answers,
              signedName: name,
            ),
          ),
        );
        final success = '${r['success'] ?? ''}'.trim();
        final waiting = r['waiting'] == true;
        final fee = _n(r['fee']);
        final msg = [
          s.cfSavedAs('${r['number'] ?? ''}'),
          if (success.isNotEmpty) success.length > 300 ? success.substring(0, 300) : success,
          if (waiting) s.cfWillApprove,
          if (fee > 0 && !waiting) s.cfFeeDue(s.money(fee)),
        ].join(' ');
        if (mounted) Navigator.of(context).pop(msg);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _problem = errorText(s, e);
        });
      }
    }
  }

  void _signed(String key, Size size) {
    final ink = _inks[key];
    if (ink == null || ink.isEmpty) return;
    final strokes = [for (final st in ink.strokes) List<Offset>.of(st)];
    final gen = (_signGen[key] ?? 0) + 1;
    _signGen[key] = gen;
    _signing[key] = () async {
      try {
        final url = await consentSignaturePng(strokes, size);
        if (mounted && _signGen[key] == gen) setState(() => _answers[key] = url);
      } catch (_) {
        // not made: the box counts as not signed and the check asks again
      } finally {
        if (_signGen[key] == gen) _signing.remove(key);
      }
    }();
    setState(() {
      _drawn.add(key);
      _problem = null;
    });
  }

  void _clearSignature(String key) {
    _inks[key]?.clear();
    _signGen[key] = (_signGen[key] ?? 0) + 1;
    _signing.remove(key);
    setState(() {
      _drawn.remove(key);
      _answers[key] = _keptSignatures.contains(key) ? 'keep' : null;
    });
  }

  void _setFiles(String key, List<PickedFile> files) => setState(() {
    _files[key] = files;
    _answers[key] = files.isNotEmpty
        ? '${files.length} file(s)'
        : (_keptFiles.contains(key) ? 'keep' : null);
    _problem = null;
  });

  Future<void> _addFiles(String key, int max) async {
    final s = ref.read(stringsProvider);
    final picked = await ref.read(leaveFilePickerProvider)();
    final ok = picked
        .where(
          (f) =>
              RegExp(r'^(application/pdf|image/(png|jpeg|webp))$').hasMatch(f.contentType) &&
              f.bytes.length <= 5 * 1024 * 1024,
        )
        .toList();
    if (!mounted) return;
    if (ok.length < picked.length) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.cfFileWrong)));
    }
    if (ok.isEmpty) return;
    _setFiles(key, [...?_files[key], ...ok].take(max).toList());
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return AsyncBody<(Json, String)>(
      value: ref.watch(consentFillProvider(_key)),
      retry: () => ref.invalidate(consentFillProvider(_key)),
      data: (both) {
        final (f, me) = both;
        _setup(f, me);
        final editing = f['editing'] is Map ? asJson(f['editing']) : null;
        final about = f['about'] is Map ? asJson(f['about']) : null;
        final title = '${f['title'] ?? ''}';
        Widget card(String text, Key key) => Card(
          key: key,
          child: Padding(padding: const EdgeInsets.all(Tokens.sp4), child: Text(text)),
        );
        return ListView(
          controller: _scroll,
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            if (about != null)
              Text(
                [
                  '${about['name'] ?? ''}',
                  if (about['section'] != null) '${about['section']}',
                ].join(' · '),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            Semantics(
              header: true,
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
              ),
            ),
            const SizedBox(height: Tokens.sp3),
            if (editing != null && f['canEdit'] != true)
              card(s.cfCannotChange, const Key('cfCannotChange'))
            else if (editing == null && f['canAnswer'] != true)
              card(
                f['open'] == true
                    ? s.cfAlready(asList(f['responses']).map((r) => '${r['number']}').join(', '))
                    : s.cfIsClosed(f['closedWhy'] as String?),
                const Key('cfNotOpen'),
              )
            else
              ..._form(s, f, editing, muted, dark),
          ],
        );
      },
    );
  }

  List<Widget> _form(S s, Json f, Json? editing, Color muted, bool dark) {
    final fields = asList(f['fields']);
    final lists = asJson(f['lists']);
    final steps = consentSteps(fields);
    if (_step >= steps.length) _step = steps.length - 1;
    final last = _step >= steps.length - 1;
    final fee = asJson(f['fee']);
    final hasFee = fee.isNotEmpty && (fee['mode'] ?? 'none') != 'none';
    final amount = hasFee ? consentFeeOf(fee, fields, _answers) : null;
    final approval = f['approval'] == true;
    final feeNote = editing != null
        ? (approval ? s.cfAfterApproves : null)
        : (approval ? s.cfAfterApproves : s.cfDueOnSubmit);
    final description = '${f['description'] ?? ''}'.trim();
    return [
      if (editing != null) SectionTitle(s.cfChangeYour('${editing['number'] ?? ''}')),
      if (description.isNotEmpty)
        Card(
          child: ExpansionTile(
            key: const Key('cfIntro'),
            initiallyExpanded: editing == null,
            title: Text(s.cfReadSchool, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
            shape: const Border(),
            collapsedShape: const Border(),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            expandedAlignment: AlignmentDirectional.centerStart,
            childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp4),
            children: [SelectionArea(child: Text(description))],
          ),
        ),
      if (steps.length > 1)
        Padding(
          padding: const EdgeInsets.only(top: Tokens.sp3),
          child: Semantics(
            liveRegion: true,
            child: Text(
              s.cfStep(_step + 1, steps.length),
              key: const Key('cfStep'),
              style: TextStyle(color: muted, fontSize: 14, fontWeight: Tokens.fwSemibold),
            ),
          ),
        ),
      const SizedBox(height: Tokens.sp3),
      for (final x in steps[_step]) ?_field(s, x, lists, muted, dark),
      if (last && amount != null)
        Padding(
          padding: const EdgeInsets.only(bottom: Tokens.sp4),
          child: Semantics(
            liveRegion: true,
            child: Container(
              key: const Key('cfFee'),
              padding: const EdgeInsets.all(Tokens.sp3),
              decoration: BoxDecoration(
                color: Tokens.statusInfoBg,
                borderRadius: BorderRadius.circular(Tokens.radiusSm),
              ),
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: s.cfFeeLine(s.money(amount)),
                      style: const TextStyle(fontWeight: Tokens.fwBold),
                    ),
                    if (feeNote != null) TextSpan(text: ' · $feeNote'),
                  ],
                ),
                style: const TextStyle(color: Tokens.textBody),
              ),
            ),
          ),
        ),
      if (last) ...[
        Text(s.cfSignerName, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        const SizedBox(height: Tokens.sp1),
        TextField(
          key: const Key('cfSignedName'),
          controller: _name,
          maxLength: 120,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(
            labelText: s.cfSignerName,
            floatingLabelBehavior: FloatingLabelBehavior.never,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
          onChanged: (_) {
            if (_problem != null) setState(() => _problem = null);
          },
        ),
      ],
      if (_problem != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_problem!)],
      const SizedBox(height: Tokens.sp4),
      Row(
        children: [
          if (_step > 0) ...[
            Expanded(
              child: OutlinedButton(
                key: const Key('cfBack'),
                onPressed: _busy
                    ? null
                    : () => setState(() {
                        _problem = null;
                        _toStep(_step - 1);
                      }),
                child: Text(s.cfBack),
              ),
            ),
            const SizedBox(width: Tokens.sp3),
          ],
          Expanded(
            child: last
                ? FilledButton(
                    key: const Key('cfSubmit'),
                    onPressed: _busy ? null : () => _submit(f, steps),
                    child: Text(
                      _busy ? s.cfSending : (editing != null ? s.cfSaveChange : s.cfSubmit),
                    ),
                  )
                : FilledButton(
                    key: const Key('cfNext'),
                    onPressed: _busy ? null : () => _next(steps),
                    child: Text(s.cfNext),
                  ),
          ),
        ],
      ),
    ];
  }

  TextEditingController _ctl(String key, String type) => _text.putIfAbsent(key, () {
    final v = _answers[key];
    return TextEditingController(
      text: type == 'number' ? (v == null ? '' : _js(v)) : (v is String ? v : ''),
    );
  });

  /// One question as its type asks (null: hidden by its rule).
  Widget? _field(S s, Json f, Json lists, Color muted, bool dark) {
    final key = '${f['key']}';
    final type = '${f['type']}';
    final label = '${f['label'] ?? ''}';
    final help = '${f['help'] ?? ''}'.trim();
    if (type == 'heading') {
      return Padding(
        key: Key('cfField-$key'),
        padding: const EdgeInsets.only(top: Tokens.sp2, bottom: Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text(
                label,
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
            ),
            if (help.isNotEmpty) Text(help, style: TextStyle(color: muted, fontSize: 13)),
          ],
        ),
      );
    }
    final st = consentRuleState(f, _answers);
    if (!st.shown) return null;
    final question = st.required ? '$label *' : label;
    final v = _answers[key];
    final helpText = help.isEmpty
        ? null
        : Padding(
            padding: const EdgeInsets.only(top: Tokens.sp1),
            child: Text(help, style: TextStyle(color: muted, fontSize: 13)),
          );
    Widget heading() => Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp1),
      child: Text(question, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
    );
    Widget group(List<Widget> children) => Semantics(
      container: true,
      explicitChildNodes: true,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
    );
    final Widget body;
    switch (type) {
      case 'radio' || 'yesno':
        final yesno = type == 'yesno';
        final opts = yesno ? const ['Yes', 'No'] : _options(f, lists);
        final cur = yesno
            ? (v == true ? 'Yes' : (v == false ? 'No' : null))
            : (v is String ? v : null);
        body = group([
          heading(),
          RadioGroup<String>(
            groupValue: cur,
            onChanged: (o) {
              if (o != null) _set(key, yesno ? o == 'Yes' : o);
            },
            child: Column(
              children: [
                for (final o in opts)
                  RadioListTile<String>(
                    key: Key('cf-$key-$o'),
                    value: o,
                    contentPadding: EdgeInsets.zero,
                    title: Text(yesno ? (o == 'Yes' ? s.cfYes : s.cfNo) : o),
                  ),
              ],
            ),
          ),
          ?helpText,
        ]);
      case 'checkbox':
        final list = v is List ? [for (final x in v) '$x'] : <String>[];
        body = group([
          heading(),
          for (final o in _options(f, lists))
            CheckboxListTile(
              key: Key('cf-$key-$o'),
              value: list.contains(o),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: Text(o),
              onChanged: (on) =>
                  _set(key, on == true ? [...list, o] : list.where((x) => x != o).toList()),
            ),
          ?helpText,
        ]);
      case 'agree':
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            CheckboxListTile(
              key: Key('cf-$key'),
              value: v == true,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: Text(question, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              onChanged: (on) => _set(key, on == true),
            ),
            ?helpText,
          ],
        );
      case 'select':
        final opts = _options(f, lists);
        // the question once, above (as on the website); the list is named by it for screen readers
        body = Semantics(
          container: true,
          explicitChildNodes: true,
          label: question,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ExcludeSemantics(child: heading()),
              DropdownMenu<String>(
                key: Key('cf-$key'),
                hintText: s.cfChoose,
                initialSelection: v is String && opts.contains(v) ? v : null,
                trailingIcon: dropArrow(label),
                selectedTrailingIcon: dropArrow(label, open: true),
                expandedInsets: EdgeInsets.zero,
                enableFilter: true,
                enableSearch: true,
                requestFocusOnTap: true,
                menuHeight: 320,
                onSelected: (o) => _set(key, o),
                dropdownMenuEntries: [for (final o in opts) DropdownMenuEntry(value: o, label: o)],
              ),
              ?helpText,
            ],
          ),
        );
      case 'date' || 'time':
        final date = type == 'date';
        final shown = v is String && v.isNotEmpty
            ? (date ? s.date(v) : v)
            : (date ? s.cfChooseDate : s.cfChooseTime);
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            heading(),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: OutlinedButton.icon(
                key: Key('cf-$key'),
                icon: Icon(date ? Icons.event : Icons.schedule),
                label: Semantics(
                  label: '$label: $shown',
                  excludeSemantics: true,
                  child: Text(shown),
                ),
                onPressed: () async {
                  if (date) {
                    final now = DateTime.now();
                    final d = await showDatePicker(
                      context: context,
                      initialDate: DateTime.tryParse(v is String ? v : '') ?? now,
                      firstDate: DateTime(1900),
                      lastDate: DateTime(2100, 12, 31),
                    );
                    if (d != null) _set(key, ymd(d));
                  } else {
                    final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(v is String ? v : '');
                    final t = await showTimePicker(
                      context: context,
                      initialTime: m == null
                          ? TimeOfDay.now()
                          : TimeOfDay(hour: int.parse(m[1]!), minute: int.parse(m[2]!)),
                    );
                    if (t != null) {
                      _set(
                        key,
                        '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}',
                      );
                    }
                  }
                },
              ),
            ),
            ?helpText,
          ],
        );
      case 'file':
        final files = _files[key] ?? const <PickedFile>[];
        final max = ((f['maxFiles'] as num?) ?? 1).toInt().clamp(1, 5);
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            heading(),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (var i = 0; i < files.length; i++)
                  InputChip(
                    key: Key('cf-$key-file-$i'),
                    avatar: const Icon(Icons.attach_file, size: 18),
                    label: Text(files[i].name),
                    deleteButtonTooltipMessage: s.cfRemoveFile(files[i].name),
                    onDeleted: () => _setFiles(key, [...files]..removeAt(i)),
                  ),
                if (files.length < max)
                  OutlinedButton.icon(
                    key: Key('cf-$key-add'),
                    icon: const Icon(Icons.upload_file),
                    label: Semantics(
                      label: s.cfAddFileTo(label),
                      excludeSemantics: true,
                      child: Text(s.cfAddFile),
                    ),
                    onPressed: () => _addFiles(key, max),
                  ),
              ],
            ),
            if (files.isEmpty && _keptFiles.contains(key))
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(s.cfFilesKept, style: TextStyle(color: muted, fontSize: 13)),
              ),
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp1),
              child: Text(s.cfFilesHelp(max), style: TextStyle(color: muted, fontSize: 13)),
            ),
            ?helpText,
          ],
        );
      case 'signature':
        final ink = _inks.putIfAbsent(key, _Ink.new);
        final kept = _keptSignatures.contains(key);
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            heading(),
            _SignaturePad(
              key: Key('cfPad-$key'),
              ink: ink,
              label: s.cfSignHere(label),
              border: (dark ? Tokens.mobGray500 : Tokens.mobGray300),
              onSigned: (size) => _signed(key, size),
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _drawn.contains(key) ? s.cfSigned : (kept ? s.cfSignedEarlier : s.cfSignAbove),
                    key: Key('cfSignState-$key'),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                ),
                TextButton(
                  key: Key('cfClear-$key'),
                  onPressed: () => _clearSignature(key),
                  child: Semantics(
                    label: s.cfClearOf(label),
                    excludeSemantics: true,
                    child: Text(s.cfClear),
                  ),
                ),
              ],
            ),
            ?helpText,
          ],
        );
      default:
        // text, textarea, number, email, phone
        final area = type == 'textarea';
        final max = (f['maxLength'] as num?)?.toInt() ?? (area ? 5000 : 500);
        body = MergeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              heading(),
              TextField(
                key: Key('cf-$key'),
                controller: _ctl(key, type),
                maxLength: type == 'number' ? null : max,
                minLines: area ? 3 : 1,
                maxLines: area ? 6 : 1,
                keyboardType: switch (type) {
                  'email' => TextInputType.emailAddress,
                  'phone' => TextInputType.phone,
                  'number' => const TextInputType.numberWithOptions(decimal: true, signed: true),
                  'textarea' => TextInputType.multiline,
                  _ => TextInputType.text,
                },
                decoration: InputDecoration(
                  hintText: '${f['placeholder'] ?? ''}'.isEmpty ? null : '${f['placeholder']}',
                  helperText: help.isEmpty ? null : help,
                  helperMaxLines: 4,
                  border: const OutlineInputBorder(),
                  counterText: '',
                ),
                onChanged: (t) => _set(key, type == 'number' ? _numOf(t) : t),
              ),
            ],
          ),
        );
    }
    return Padding(
      key: Key('cfField-$key'),
      padding: const EdgeInsets.only(bottom: Tokens.sp4),
      child: body,
    );
  }
}

/// A typed number as the website keeps it: a number, or nothing (an empty or unreadable box).
num? _numOf(String t) {
  final n = num.tryParse(t.trim());
  if (n == null || !n.isFinite) return null;
  return n is double && n == n.truncateToDouble() ? n.toInt() : n;
}

// ------------------------------------------------------------------------------------------------ the signature pad

/// The strokes drawn in a signature box (kept across the steps).
class _Ink extends ChangeNotifier {
  final List<List<Offset>> strokes = [];
  bool get isEmpty => strokes.isEmpty;

  void start(Offset o) {
    strokes.add([o]);
    notifyListeners();
  }

  void add(Offset o) {
    if (strokes.isEmpty) strokes.add([]);
    strokes.last.add(o);
    notifyListeners();
  }

  void clear() {
    strokes.clear();
    notifyListeners();
  }
}

/// A pan that takes the touch at once, so signing in the box does not scroll the page.
class _EagerPan extends PanGestureRecognizer {
  @override
  void addAllowedPointer(PointerDownEvent event) {
    super.addAllowedPointer(event);
    resolve(GestureDisposition.accepted);
  }

  @override
  String get debugDescription => 'signature';
}

class _InkPainter extends CustomPainter {
  _InkPainter(this.ink) : super(repaint: ink);
  final _Ink ink;

  @override
  void paint(Canvas canvas, Size size) => _paintInk(canvas, ink.strokes, Tokens.mobNavy800);

  @override
  bool shouldRepaint(_InkPainter old) => old.ink != ink;
}

/// A box to sign in with a finger: a sheet of paper (white in both themes, the ink navy), named for screen readers.
class _SignaturePad extends StatelessWidget {
  const _SignaturePad({
    super.key,
    required this.ink,
    required this.label,
    required this.border,
    required this.onSigned,
  });
  final _Ink ink;
  final String label;
  final Color border;
  final void Function(Size size) onSigned;

  static const double height = 160;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: label,
    image: true,
    child: Container(
      height: height,
      decoration: BoxDecoration(
        color: Tokens.mobWhite,
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
        border: Border.all(color: border, width: 1.5),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
        child: LayoutBuilder(
          builder: (context, c) {
            final size = Size(c.maxWidth, c.maxHeight);
            Offset inside(Offset o) =>
                Offset(o.dx.clamp(0, size.width).toDouble(), o.dy.clamp(0, size.height).toDouble());
            return RawGestureDetector(
              excludeFromSemantics: true,
              behavior: HitTestBehavior.opaque,
              gestures: {
                _EagerPan: GestureRecognizerFactoryWithHandlers<_EagerPan>(_EagerPan.new, (r) {
                  r
                    ..onStart = ((d) => ink.start(inside(d.localPosition)))
                    ..onUpdate = ((d) => ink.add(inside(d.localPosition)))
                    ..onEnd = ((_) => onSigned(size))
                    ..onCancel = (() => onSigned(size));
                }),
              },
              child: CustomPaint(painter: _InkPainter(ink), size: size),
            );
          },
        ),
      ),
    ),
  );
}
