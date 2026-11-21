import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The words of the appointments (as the website's, in English and Hindi).
extension AppointmentWords on S {
  String _ap(String en, String hi) => hindi ? hi : en;

  String get apptMenu => _ap('Appointments', 'भेंट');
  String get apptOne => _ap('Appointment', 'भेंट');
  String apptNumber(String n) => _ap('Appointment $n', 'भेंट $n');
  String get apptTitle => _ap('Meet the school', 'विद्यालय से मिलें');
  String apptCount(int n, bool filtered) =>
      '${filtered ? _ap('$n found', '$n मिले') : _ap('$n in all', 'कुल $n')} · ${_ap('latest first', 'नवीनतम पहले')}';
  String get apptList => _ap('List', 'सूची');
  String get apptCalendar => _ap('Calendar', 'कैलेंडर');
  String get apptViews => _ap('Show as', 'ऐसे दिखाएँ');
  String get apptBook => _ap('Book an appointment', 'भेंट बुक करें');
  String get apptAll => _ap('All', 'सभी');
  String get apptOpenOnes => _ap('Still to come', 'आने वाली');
  String get apptPastOnes => _ap('Over or closed', 'हो चुकी या बंद');
  String get apptSearch => _ap('Number, purpose or whom to meet', 'संख्या, कारण या किससे मिलना है');
  String get apptClear => _ap('Clear', 'हटाएँ');
  String get apptNone => _ap(
    'No appointments yet. Use Book an appointment to meet a teacher or the office.',
    'अभी कोई भेंट नहीं। शिक्षक या कार्यालय से मिलने के लिए “भेंट बुक करें” दबाएँ।',
  );
  String get apptNoneMonth => _ap('No appointments in this month.', 'इस माह कोई भेंट नहीं है।');
  String get apptNothingMatches =>
      _ap('Nothing matches these filters.', 'इन फ़िल्टर से कुछ नहीं मिला।');
  String get apptEarlier => _ap('Earlier', 'पहले');
  String get apptLater => _ap('Later', 'आगे');
  String get apptPrevious => _ap('Previous', 'पिछला');
  String get apptNext => _ap('Next', 'अगला');
  String apptPage(int n, int m) => _ap('Page $n / $m', 'पृष्ठ $n / $m');
  String apptState(String st) => switch (st) {
    'requested' => _ap('Waiting for the school', 'विद्यालय की प्रतीक्षा'),
    'approved' => _ap('Confirmed', 'पुष्ट'),
    'rejected' => _ap('Not confirmed', 'पुष्टि नहीं हुई'),
    'checked_in' => _ap('Arrived', 'पहुँचे'),
    'completed' => _ap('Completed', 'पूर्ण'),
    'no_show' => _ap('Did not come', 'नहीं आए'),
    _ => _ap('Cancelled', 'रद्द'),
  };
  String apptEvent(String kind) => switch (kind) {
    'requested' => _ap('Requested', 'अनुरोध किया'),
    'approved' => _ap('Confirmed', 'पुष्ट'),
    'rejected' => _ap('Declined', 'अस्वीकृत'),
    'rescheduled' => _ap('Moved to a new time', 'नया समय दिया गया'),
    'cancelled' => _ap('Cancelled', 'रद्द'),
    'checked_in' => _ap('Checked in', 'पहुँचे (चेक-इन)'),
    'checked_out' => _ap('Checked out', 'गए (चेक-आउट)'),
    'no_show' => _ap('Did not come', 'नहीं आए'),
    'reminded' => _ap('Reminder sent', 'अनुस्मारक भेजा गया'),
    _ => kind,
  };
  String get apptDetails => _ap('Details', 'विवरण');
  String get apptDetailsAndPass => _ap('Details and gate pass', 'विवरण और गेट पास');
  String get apptCancel => _ap('Cancel', 'रद्द करें');
  String get apptCancelAsk => _ap('Cancel this appointment?', 'क्या यह भेंट रद्द करें?');
  String get apptKeep => _ap('Keep it', 'रहने दें');
  String get apptCancelled => _ap('Appointment cancelled.', 'भेंट रद्द की गई।');
  String apptAdmNo(String n) => _ap('Adm. no. $n', 'प्रवेश सं. $n');
  String apptStep(int n) => _ap('Step $n / 5', 'चरण $n / 5');
  String get apptChild => _ap('Child', 'बच्चा');
  String get apptToMeet => _ap('To meet', 'किससे मिलना');
  String get apptWhomQ => _ap('Whom do you want to meet?', 'आप किससे मिलना चाहते हैं?');
  String get apptNoHours => _ap('No visiting hours', 'मिलने का समय तय नहीं');
  String get apptNotOpen => _ap(
    'The school has not opened appointments for parents yet.',
    'विद्यालय ने अभी अभिभावकों के लिए भेंट नहीं खोली है।',
  );
  String get apptDay => _ap('Day', 'दिन');
  String get apptPickDay => _ap('Pick a day', 'दिन चुनें');
  String apptFree(int n) => _ap(n == 1 ? '$n time free' : '$n times free', '$n समय खाली');
  String get apptDaysFailed => _ap(
    'The days could not be loaded. Please try again.',
    'दिन लोड नहीं हो सके। कृपया फिर कोशिश करें।',
  );
  String get apptTime => _ap('Time', 'समय');
  String get apptPickTime => _ap('Pick a time', 'समय चुनें');
  String get apptNoTime => _ap(
    'No free time on this day. Please try another day.',
    'इस दिन कोई समय खाली नहीं है। कृपया दूसरा दिन चुनें।',
  );
  String get apptWhyQ => _ap('Why do you want to meet?', 'आप क्यों मिलना चाहते हैं?');
  String get apptPurpose => _ap('Purpose', 'उद्देश्य');
  String get apptNeedPurpose => _ap(
    'Write why you want to meet (at least 3 letters).',
    'मिलने का कारण लिखें (कम से कम 3 अक्षर)।',
  );
  String get apptConfirmHelp => _ap(
    'The school confirms the request and sends you the gate pass.',
    'विद्यालय अनुरोध की पुष्टि करके आपको गेट पास भेजता है।',
  );
  String get apptSend => _ap('Send the request', 'अनुरोध भेजें');
  String get apptChange => _ap('Change', 'बदलें');
  String get apptBooked => _ap(
    'Appointment requested. The school will confirm it and send you the pass.',
    'भेंट का अनुरोध भेजा गया। विद्यालय पुष्टि करके पास भेजेगा।',
  );
  String get apptPass => _ap('Gate pass', 'गेट पास');
  String get apptCard => _ap('Gate pass card (PDF)', 'गेट पास कार्ड (PDF)');
  String get apptShowHelp => _ap(
    'Open the card and show its QR code at the school gate on the day of the appointment.',
    'भेंट के दिन कार्ड खोलकर उसका क्यूआर कोड विद्यालय के गेट पर दिखाएँ।',
  );
  String get apptWhen => _ap('When', 'कब');
  String get apptNotDecided => _ap('Not decided yet', 'अभी तय नहीं');
  String get apptMovedFrom => _ap('Moved from', 'पहले का समय');
  String get apptWhere => _ap('Where', 'कहाँ');
  String get apptRequestedBy => _ap('Requested by', 'अनुरोधकर्ता');
  String get apptMobile => _ap('Mobile', 'मोबाइल');
  String get apptRequestedOn => _ap('Requested on', 'अनुरोध की तिथि');
  String get apptNote => _ap('Note from the school', 'विद्यालय की टिप्पणी');
  String get apptHistory => _ap('History', 'इतिहास');
  String apptHistoryHint(int n, String last) =>
      _ap('$n ${n == 1 ? 'entry' : 'entries'} · last: $last', '$n प्रविष्टि · अंतिम: $last');
  String get apptNotLinked => _ap(
    'Your account is not linked to a student yet. Please contact the school office.',
    'आपका खाता अभी किसी विद्यार्थी से नहीं जुड़ा है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );
}

const _live = {'approved', 'checked_in'};
const _cancellable = {'requested', 'approved'};

Tone _tone(String st) => switch (st) {
  'requested' => Tone.warning,
  'approved' => Tone.success,
  'rejected' || 'no_show' => Tone.danger,
  'checked_in' => Tone.info,
  _ => Tone.neutral,
};

/// A moment as the school's clock shows it (India time, as the website does); a slot's own `2026-11-23T10:00`
/// is already school time.
DateTime? _school(Object? v) {
  final t = DateTime.tryParse('${v ?? ''}');
  if (t == null) return null;
  if (!t.isUtc) return t;
  final u = t.add(const Duration(minutes: 330));
  return DateTime(u.year, u.month, u.day, u.hour, u.minute);
}

String _hm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// Mon, 23 Nov, 10:00 (school time).
String? _when(S s, Object? v) {
  final t = _school(v);
  return t == null ? null : '${s.dayShort(t)}, ${_hm(t)}';
}

/// A pupil wherever an appointment names one: name, class and the admission number.
String? _studentLabel(S s, Json a) => a['student'] == null
    ? null
    : '${a['student']}${a['section'] != null ? ' (${a['section']})' : ''}'
          '${a['admissionNo'] != null ? ' · ${s.apptAdmNo('${a['admissionNo']}')}' : ''}';

/// Visiting hours on one line, the days with the same hours together: Mon–Fri 14:00–15:00.
String _hoursLine(S s, List<Json> hours) {
  final byTime = <String, List<int>>{};
  for (final o in hours) {
    final k = '${s.time('${o['starts']}')}–${s.time('${o['ends']}')}';
    (byTime[k] ??= []).add(((o['weekday'] as num?) ?? 1).toInt());
  }
  return byTime.entries
      .map((e) {
        final d = e.value.toSet().toList()..sort();
        var run = d.length > 2;
        for (var n = 1; run && n < d.length; n++) {
          run = d[n] == d[n - 1] + 1;
        }
        final days = run
            ? '${s.weekday(d.first)}–${s.weekday(d.last)}'
            : d.map(s.weekday).join(', ');
        return '$days ${e.key}';
      })
      .join(' · ');
}

/// The child's appointments: `(profile, state, words, page, from, to)` (empty: no filter; a month: from–to).
/// An account not linked to a child gets `{notLinked: true}`.
final appointmentsProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, String, int, String, String)>((ref, a) async {
      final (p, state, q, page, from, to) = a;
      try {
        final r = await cached(
          'appt:${p.id}:$state:$q:$page:$from:$to',
          () => ref
              .read(apiProvider)
              .appointmentsMine(
                studentId: p.studentId,
                state: state.isEmpty ? null : state,
                q: q.isEmpty ? null : q,
                from: from.isEmpty ? null : from,
                to: to.isEmpty ? null : to,
                page: from.isEmpty ? page : null,
                size: from.isEmpty ? 10 : 100,
              ),
        );
        return Loaded(asJson(r.data), r.at, stale: r.stale);
      } on ApiException catch (e) {
        if (e.status == 403) return Loaded(const {'notLinked': true}, DateTime.now());
        rethrow;
      }
    });

/// One appointment in full, with its history and (once confirmed) its pass.
final appointmentProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).appointmentsMineGet(id: id)),
);

/// Whom a parent can meet (with the visiting hours) and the school's instructions.
final _hostsProvider = FutureProvider.autoDispose<Json>(
  (ref) async => asJson(await ref.read(apiProvider).appointmentsMineHosts()),
);

/// The next days a person or desk has free times: `(hostId, studentId)`.
final _daysProvider = FutureProvider.autoDispose.family<Json, (String, String?)>(
  (ref, a) async =>
      asJson(await ref.read(apiProvider).appointmentsMineDays(hostId: a.$1, studentId: a.$2)),
);

/// The times of one day: `(hostId, date, studentId)`.
final _slotsProvider = FutureProvider.autoDispose.family<Json, (String, String, String?)>(
  (ref, a) async => asJson(
    await ref.read(apiProvider).appointmentsMineSlots(hostId: a.$1, date: a.$2, studentId: a.$3),
  ),
);

/// Loading, an error (the API's sentence) with "try again", or the content.
Widget _async<T>(S s, AsyncValue<T> v, VoidCallback retry, Widget Function(T) data) => v.when(
  data: data,
  loading: () => Padding(
    padding: const EdgeInsets.all(Tokens.sp4),
    child: Center(
      child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
    ),
  ),
  error: (e, _) => Padding(
    padding: const EdgeInsets.all(Tokens.sp4),
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ErrorText(errorText(s, e)),
          const SizedBox(height: Tokens.sp3),
          OutlinedButton(onPressed: retry, child: Text(s.retry)),
        ],
      ),
    ),
  ),
);

/// The appointments as the website's page (apps/parent/app/(app)/appointments): a list with the status and a
/// search, ten a page, or a month; each with its date block, whom to meet, its state, the purpose, the number and
/// place; Details (and the pass) and Cancel; Book an appointment.
class AppointmentsScreen extends ConsumerStatefulWidget {
  const AppointmentsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends ConsumerState<AppointmentsScreen> {
  bool _calendar = false;
  String _state = '';
  String _q = '';
  int _page = 1;
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  final _words = TextEditingController();

  @override
  void dispose() {
    _words.dispose();
    super.dispose();
  }

  (Profile, String, String, int, String, String) get _key => _calendar
      ? (widget.profile, '', '', 1, ymd(_month), ymd(DateTime(_month.year, _month.month + 1, 0)))
      : (widget.profile, _state, _q, _page, '', '');

  Future<void> _book() async {
    final s = ref.read(stringsProvider);
    final id = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.apptBook,
          child: AppointmentForm(profile: widget.profile),
        ),
      ),
    );
    if (!mounted) return;
    ref.invalidate(appointmentsProvider);
    if (id != null) openAppointment(context, widget.profile, id, booked: true);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final filtered = _state.isNotEmpty || _q.isNotEmpty;
    return LoadedList<Json>(
      value: ref.watch(appointmentsProvider(_key)),
      refresh: () => ref.refresh(appointmentsProvider(_key).future),
      children: (d) {
        if (d['notLinked'] == true) return [EmptyLine(s.apptNotLinked)];
        final rows = asList(d['data']);
        final total = ((asJson(d['page'])['total'] as num?) ?? rows.length).toInt();
        final pages = (total / 10).ceil();
        return [
          Text(
            s.apptTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(
            _calendar ? '${s.month(_month)} · $total' : s.apptCount(total, filtered),
            key: const Key('apptCount'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
          const SizedBox(height: Tokens.sp3),
          FilledButton.icon(
            key: const Key('bookAppointment'),
            icon: const Icon(Icons.add),
            label: Text(s.apptBook),
            onPressed: _book,
          ),
          const SizedBox(height: Tokens.sp3),
          Semantics(
            label: s.apptViews,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              children: [
                for (final (v, label) in [(false, s.apptList), (true, s.apptCalendar)])
                  ChoiceChip(
                    key: Key('apptView-${v ? 'calendar' : 'list'}'),
                    label: Text(label),
                    selected: _calendar == v,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _calendar = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          if (_calendar)
            Row(
              children: [
                IconButton(
                  key: const Key('apptMonthBack'),
                  tooltip: s.apptEarlier,
                  icon: const Icon(Icons.chevron_left),
                  onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
                ),
                Expanded(
                  child: Text(
                    s.month(_month),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: Tokens.fwBold),
                  ),
                ),
                IconButton(
                  key: const Key('apptMonthNext'),
                  tooltip: s.apptLater,
                  icon: const Icon(Icons.chevron_right),
                  onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
                ),
              ],
            )
          else
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp2,
                      children: [
                        for (final (v, label) in [
                          ('', s.apptAll),
                          ('open', s.apptOpenOnes),
                          ('past', s.apptPastOnes),
                        ])
                          ChoiceChip(
                            key: Key('apptState-${v.isEmpty ? 'all' : v}'),
                            label: Text(label),
                            selected: _state == v,
                            showCheckmark: false,
                            onSelected: (_) => setState(() {
                              _state = v;
                              _page = 1;
                            }),
                          ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: const Key('apptSearch'),
                      controller: _words,
                      maxLength: 80,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(
                        labelText: s.apptSearch,
                        prefixIcon: const Icon(Icons.search),
                        border: const OutlineInputBorder(),
                        counterText: '',
                      ),
                      onSubmitted: (v) => setState(() {
                        _q = v.trim();
                        _page = 1;
                      }),
                    ),
                    if (filtered)
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: TextButton(
                          key: const Key('apptClear'),
                          onPressed: () => setState(() {
                            _state = '';
                            _q = '';
                            _words.clear();
                            _page = 1;
                          }),
                          child: Text(s.apptClear),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: Tokens.sp2),
          if (rows.isEmpty)
            EmptyLine(_calendar ? s.apptNoneMonth : (filtered ? s.apptNothingMatches : s.apptNone)),
          if (_calendar)
            // the month: each day with its appointments, in time order (as the website's month)
            for (final day in {
              for (final x in rows)
                if (_school(x['startsAt']) != null) ymd(_school(x['startsAt'])!),
            }.toList()..sort()) ...[
              SectionTitle(s.dayShort(day)),
              for (final x in rows.where(
                (x) => _school(x['startsAt']) != null && ymd(_school(x['startsAt'])!) == day,
              ))
                _AppointmentCard(profile: widget.profile, appointment: x),
            ]
          else
            for (final x in rows) _AppointmentCard(profile: widget.profile, appointment: x),
          if (!_calendar && total > 10)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  key: const Key('apptPrev'),
                  tooltip: s.apptPrevious,
                  icon: const Icon(Icons.chevron_left),
                  onPressed: _page > 1 ? () => setState(() => _page -= 1) : null,
                ),
                Flexible(child: Text(s.apptPage(_page, pages), textAlign: TextAlign.center)),
                IconButton(
                  key: const Key('apptNext'),
                  tooltip: s.apptNext,
                  icon: const Icon(Icons.chevron_right),
                  onPressed: _page < pages ? () => setState(() => _page += 1) : null,
                ),
              ],
            ),
        ];
      },
    );
  }
}

/// Opens an appointment in full in the app; `booked`: just requested.
void openAppointment(BuildContext context, Profile profile, String id, {bool booked = false}) {
  final s = ProviderScope.containerOf(context, listen: false).read(stringsProvider);
  pushPage(context, s.apptOne, AppointmentDetail(profile: profile, id: id, booked: booked));
}

/// Asks to cancel an appointment and does it; true when cancelled.
Future<bool> _cancelAppointment(BuildContext context, WidgetRef ref, String id) async {
  final s = ref.read(stringsProvider);
  final yes = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      content: Text(s.apptCancelAsk),
      actions: [
        TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.apptKeep)),
        FilledButton(
          key: const Key('confirmApptCancel'),
          onPressed: () => Navigator.of(c).pop(true),
          child: Text(s.apptCancel),
        ),
      ],
    ),
  );
  if (yes != true) return false;
  try {
    await ref.read(apiProvider).appointmentsMineCancel(id: id, body: const AppointmentCancelDto());
    ref.invalidate(appointmentsProvider);
    ref.invalidate(appointmentProvider(id));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.apptCancelled)));
    }
    return true;
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
    }
    return false;
  }
}

/// An appointment in a list: the date block (day, month, weekday, time), whom to meet, its state, the purpose,
/// the number, child, desk and place; Details (and the pass) and Cancel.
class _AppointmentCard extends ConsumerWidget {
  const _AppointmentCard({required this.profile, required this.appointment});
  final Profile profile;
  final Json appointment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final a = appointment;
    final id = '${a['id']}';
    final state = '${a['state']}';
    final number = '${a['number'] ?? ''}';
    final at = _school(a['startsAt']);
    final meta = [
      number,
      _studentLabel(s, a) ?? '',
      if (a['withName'] != null) '${a['hostName'] ?? ''}',
      '${a['place'] ?? ''}',
    ].where((t) => t.isNotEmpty).join(' · ');
    return Card(
      key: Key('appt-$id'),
      child: InkWell(
        onTap: () => openAppointment(context, profile, id),
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 64,
                padding: const EdgeInsets.symmetric(vertical: Tokens.sp2, horizontal: 2),
                decoration: BoxDecoration(
                  color: (dark ? Tokens.mobNavy700 : Tokens.mobNavy50),
                  borderRadius: BorderRadius.circular(Tokens.radiusSm),
                ),
                child: at == null
                    ? const Text('—', textAlign: TextAlign.center)
                    : Column(
                        children: [
                          Text(
                            at.day.toString().padLeft(2, '0'),
                            style: const TextStyle(fontSize: 20, fontWeight: Tokens.fwBold),
                          ),
                          Text(s.monthShort(at), style: const TextStyle(fontSize: 12)),
                          Text(s.weekday(at.weekday), style: const TextStyle(fontSize: 12)),
                          Text(
                            _hm(at),
                            style: const TextStyle(fontSize: 12, fontWeight: Tokens.fwSemibold),
                          ),
                        ],
                      ),
              ),
              const SizedBox(width: Tokens.sp3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          '${a['withName'] ?? a['hostName'] ?? s.apptOne}',
                          style: const TextStyle(fontWeight: Tokens.fwBold),
                        ),
                        StatusChip(s.apptState(state), _tone(state)),
                      ],
                    ),
                    if ('${a['purpose'] ?? ''}'.isNotEmpty) Text('${a['purpose']}'),
                    if (meta.isNotEmpty) Text(meta, style: TextStyle(color: muted, fontSize: 13)),
                    Wrap(
                      children: [
                        TextButton(
                          key: Key('apptDetails-$id'),
                          onPressed: () => openAppointment(context, profile, id),
                          child: Semantics(
                            label:
                                '${_live.contains(state) ? s.apptDetailsAndPass : s.apptDetails} $number',
                            excludeSemantics: true,
                            child: Text(
                              _live.contains(state) ? s.apptDetailsAndPass : s.apptDetails,
                            ),
                          ),
                        ),
                        if (_cancellable.contains(state))
                          TextButton(
                            key: Key('apptCancel-$id'),
                            onPressed: () => _cancelAppointment(context, ref, id),
                            child: Semantics(
                              label: '${s.apptCancel} $number',
                              excludeSemantics: true,
                              child: Text(s.apptCancel),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A step's number in a small circle (the words beside it say the step).
class _StepNo extends StatelessWidget {
  const _StepNo(this.n);
  final int n;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return ExcludeSemantics(
      child: Container(
        constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
        padding: const EdgeInsets.all(Tokens.sp1),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: (dark ? Tokens.mobCyan100 : Tokens.mobNavy800),
          shape: BoxShape.circle,
        ),
        child: Text(
          '$n',
          style: TextStyle(
            color: (dark ? Tokens.mobNavy800 : Tokens.mobWhite),
            fontWeight: Tokens.fwBold,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

/// The step being answered: its number and the question.
class _StepHead extends StatelessWidget {
  const _StepHead(this.n, this.text);
  final int n;
  final String text;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(top: Tokens.sp4, bottom: Tokens.sp2),
      child: Row(
        children: [
          _StepNo(n),
          const SizedBox(width: Tokens.sp3),
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                text,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: Tokens.fwSemibold,
                  color: (dark ? Tokens.mobWhite : Tokens.mobNavy800),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A step already answered: its answer, with Change.
class _Done extends StatelessWidget {
  const _Done({
    required this.n,
    required this.label,
    required this.value,
    this.change,
    this.changeWord,
    this.changeKey,
  });
  final int n;
  final String label;
  final String value;
  final VoidCallback? change;
  final String? changeWord;
  final Key? changeKey;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
      child: Row(
        children: [
          _StepNo(n),
          const SizedBox(width: Tokens.sp3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: (dark ? Tokens.mobGray300 : Tokens.textMuted),
                    fontSize: 13,
                  ),
                ),
                Text(value, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              ],
            ),
          ),
          if (change != null)
            TextButton(
              key: changeKey,
              onPressed: change,
              child: Semantics(
                label: '$changeWord: $label',
                excludeSemantics: true,
                child: Text(changeWord ?? ''),
              ),
            ),
        ],
      ),
    );
  }
}

/// A line the school sent when nothing can be picked (no free day, the day is closed).
class _Warn extends StatelessWidget {
  const _Warn(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(Tokens.sp3),
      decoration: BoxDecoration(
        color: Tokens.statusWarningBg,
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
      ),
      child: Text(text, style: const TextStyle(color: Tokens.textBody)),
    ),
  );
}

/// Booking an appointment as on the website, one step at a time: the child (the profile's), whom to meet (with the
/// visiting hours), a day that is open (with how many times are free), a time, then why, with a summary before it
/// is sent. Each choice is a tap; a step already answered shows its answer with Change. Pops with the new id.
class AppointmentForm extends ConsumerStatefulWidget {
  const AppointmentForm({super.key, required this.profile, this.hostId});
  final Profile profile;

  /// whom to meet, when the caller already knows (a teacher's page)
  final String? hostId;

  @override
  ConsumerState<AppointmentForm> createState() => _AppointmentFormState();
}

class _AppointmentFormState extends ConsumerState<AppointmentForm> {
  late String? _hostId = widget.hostId;
  String? _date;
  String? _time;
  final _purpose = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _purpose.dispose();
    super.dispose();
  }

  Future<void> _send(Json host, Json slot) async {
    final s = ref.read(stringsProvider);
    final purpose = _purpose.text.trim();
    if (purpose.length < 3) return setState(() => _error = s.apptNeedPurpose);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .appointmentsMineBook(
              body: FamilyBookDto(
                studentId: widget.profile.studentId!,
                hostId: '${host['id']}',
                startsAt: '${slot['startsAt']}',
                purpose: purpose,
              ),
            ),
      );
      if (mounted) Navigator.of(context).pop('${r['id']}');
    } catch (e) {
      if (!mounted) return;
      // the time may have been taken meanwhile: the free times again
      ref.invalidate(_slotsProvider);
      setState(() {
        _busy = false;
        _error = errorText(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final kid = widget.profile.studentId;
    if (kid == null) return Center(child: EmptyLine(s.apptNotLinked));
    return _async<Json>(s, ref.watch(_hostsProvider), () => ref.invalidate(_hostsProvider), (h) {
      final hosts = asList(h['data']);
      final host = hosts.where((x) => '${x['id']}' == _hostId).firstOrNull;
      final hostId = '${host?['id']}';
      final days = host == null ? null : ref.watch(_daysProvider((hostId, kid)));
      final dayList = asList(days?.value?['data']);
      final date = dayList.any((d) => '${d['date']}' == _date) ? _date : null;
      final slots = date == null ? null : ref.watch(_slotsProvider((hostId, date, kid)));
      final slot = asList(slots?.value?['slots'])
          .where((x) => '${x['time']}' == _time && x['available'] == true)
          .firstOrNull;
      final step = host == null
          ? 2
          : date == null
          ? 3
          : slot == null
          ? 4
          : 5;
      final hostLabel = host == null
          ? ''
          : '${host['name'] ?? ''}${host['person'] != null ? ' · ${host['person']}' : ''}';
      return ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(
            s.apptStep(step),
            key: const Key('apptStep'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
          if (_error != null && step < 5) ...[
            const SizedBox(height: Tokens.sp2),
            ErrorText(_error!),
          ],
          const SizedBox(height: Tokens.sp2),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: Tokens.sp3, vertical: Tokens.sp2),
              child: Column(
                children: [
                  _Done(
                    n: 1,
                    label: s.apptChild,
                    value: [
                      widget.profile.name,
                      if ((widget.profile.detail ?? '').isNotEmpty) widget.profile.detail!,
                    ].join(' · '),
                  ),
                  if (host != null)
                    _Done(
                      n: 2,
                      label: s.apptToMeet,
                      value: hostLabel,
                      changeWord: s.apptChange,
                      changeKey: const Key('apptChange-host'),
                      change: () => setState(() {
                        _hostId = null;
                        _date = null;
                        _time = null;
                        _error = null;
                      }),
                    ),
                  if (date != null)
                    _Done(
                      n: 3,
                      label: s.apptDay,
                      value: s.dayShort(date),
                      changeWord: s.apptChange,
                      changeKey: const Key('apptChange-day'),
                      change: () => setState(() {
                        _date = null;
                        _time = null;
                        _error = null;
                      }),
                    ),
                  if (slot != null)
                    _Done(
                      n: 4,
                      label: s.apptTime,
                      value: '${slot['time']}',
                      changeWord: s.apptChange,
                      changeKey: const Key('apptChange-time'),
                      change: () => setState(() {
                        _time = null;
                        _error = null;
                      }),
                    ),
                ],
              ),
            ),
          ),
          // 2: whom to meet
          if (host == null) ...[
            _StepHead(2, s.apptWhomQ),
            if (hosts.isEmpty)
              EmptyLine(s.apptNotOpen)
            else
              for (final x in hosts)
                Card(
                  child: ListTile(
                    key: Key('apptHost-${x['id']}'),
                    title: Text(
                      '${x['name'] ?? ''}',
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                    subtitle: Text(
                      [
                        if (x['person'] != null) '${x['person']}',
                        _hoursLine(s, asList(x['hours'])).isEmpty
                            ? s.apptNoHours
                            : _hoursLine(s, asList(x['hours'])),
                        if (x['location'] != null) '${x['location']}',
                      ].join('\n'),
                      style: TextStyle(color: muted),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => setState(() {
                      _hostId = '${x['id']}';
                      _date = null;
                      _time = null;
                      _error = null;
                    }),
                  ),
                ),
          ],
          // 3: the day
          if (host != null && date == null) ...[
            _StepHead(3, s.apptPickDay),
            _async<Json>(s, days!, () => ref.invalidate(_daysProvider((hostId, kid))), (d) {
              final list = asList(d['data']);
              if (list.isEmpty) {
                return _Warn('${d['note'] ?? s.apptDaysFailed}', key: const Key('apptNoDays'));
              }
              return Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  for (final x in list)
                    OutlinedButton(
                      key: Key('apptDay-${x['date']}'),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                          horizontal: Tokens.sp3,
                          vertical: Tokens.sp2,
                        ),
                      ),
                      onPressed: () => setState(() {
                        _date = '${x['date']}';
                        _time = null;
                        _error = null;
                      }),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            s.dayShort('${x['date']}'),
                            style: const TextStyle(fontWeight: Tokens.fwBold),
                          ),
                          Text(s.apptFree(((x['free'] as num?) ?? 0).toInt())),
                        ],
                      ),
                    ),
                ],
              );
            }),
          ],
          // 4: the time
          if (date != null && slot == null) ...[
            _StepHead(4, s.apptPickTime),
            _async<Json>(s, slots!, () => ref.invalidate(_slotsProvider((hostId, date, kid))), (d) {
              final free = asList(d['slots']).where((x) => x['available'] == true).toList();
              if (free.isEmpty) {
                return _Warn('${d['closed'] ?? s.apptNoTime}', key: const Key('apptNoTimes'));
              }
              return Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  for (final x in free)
                    OutlinedButton(
                      key: Key('apptSlot-${x['time']}'),
                      onPressed: () => setState(() {
                        _time = '${x['time']}';
                        _error = null;
                      }),
                      child: Text(
                        '${x['time']}',
                        style: const TextStyle(fontWeight: Tokens.fwBold),
                      ),
                    ),
                ],
              );
            }),
          ],
          // 5: why, and send
          if (host != null && date != null && slot != null) ...[
            _StepHead(5, s.apptWhyQ),
            TextField(
              key: const Key('apptPurpose'),
              controller: _purpose,
              maxLength: 500,
              minLines: 2,
              maxLines: 5,
              decoration: InputDecoration(
                labelText: '${s.apptPurpose} *',
                border: const OutlineInputBorder(),
                counterText: '',
              ),
            ),
            const SizedBox(height: Tokens.sp2),
            Text(
              '${[widget.profile.name, '${host['name'] ?? ''}${host['person'] != null ? ' (${host['person']})' : ''}', s.dayShort(date), '${slot['time']}', if (host['location'] != null) '${host['location']}'].join(' · ')}. ${s.apptConfirmHelp}',
              key: const Key('apptSummary'),
              style: TextStyle(color: muted, fontSize: 14),
            ),
            if ('${h['instructions'] ?? ''}'.trim().isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Notice(text: '${h['instructions']}'),
            ],
            if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
            const SizedBox(height: Tokens.sp4),
            FilledButton(
              key: const Key('apptSend'),
              onPressed: _busy ? null : () => _send(host, slot),
              child: Text(s.apptSend),
            ),
          ],
        ],
      );
    });
  }
}

/// An appointment in full as the website: whom and when, its state; once confirmed, the gate pass (the card with
/// its QR code, to view or save, as the app shows no SVG); the details; Cancel before it happens; the history
/// (folded).
class AppointmentDetail extends ConsumerWidget {
  const AppointmentDetail({
    super.key,
    required this.profile,
    required this.id,
    this.booked = false,
  });
  final Profile profile;
  final String id;

  /// just requested: say so
  final bool booked;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return _async<Json>(
      s,
      ref.watch(appointmentProvider(id)),
      () {
        ref.invalidate(appointmentProvider(id));
      },
      (a) {
        final state = '${a['state']}';
        final number = '${a['number'] ?? ''}';
        final student = _studentLabel(s, a);
        final whom = a['withName'] ?? a['hostName'];
        final events = asList(a['events']);
        final facts = <(String, String?)>[
          (s.apptChild, student),
          (
            s.apptToMeet,
            [
              if (a['hostName'] != null) '${a['hostName']}',
              if (a['withName'] != null) '${a['withName']}',
            ].join(' · '),
          ),
          (s.apptWhen, _when(s, a['startsAt']) ?? s.apptNotDecided),
          (s.apptMovedFrom, _when(s, a['previousStartsAt'])),
          (s.apptWhere, a['place'] as String?),
          (s.apptPurpose, a['purpose'] as String?),
          (s.apptRequestedBy, a['visitorName'] as String?),
          (s.apptMobile, a['visitorMobile'] as String?),
          (s.apptRequestedOn, _when(s, a['createdAt'])),
          (s.apptNote, (a['decisionNote'] ?? a['cancelReason']) as String?),
        ];
        String eventLine(Json e) => [
          s.apptEvent('${e['kind']}'),
          if (e['startsAt'] != null) _when(s, e['startsAt']) ?? '${e['startsAt']}',
          if (e['reason'] != null) '${e['reason']}',
        ].join(' · ');
        return ListView(
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(s.apptNumber(number), style: TextStyle(color: muted, fontSize: 14)),
            Text(
              [if (a['student'] != null) '${a['student']}', if (whom != null) '$whom'].join(' · '),
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
            ),
            const SizedBox(height: Tokens.sp2),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: StatusChip(s.apptState(state), _tone(state)),
            ),
            if (booked) ...[
              const SizedBox(height: Tokens.sp3),
              Notice(key: const Key('apptBooked'), text: s.apptBooked),
            ],
            if (a['passQr'] != null || (_live.contains(state) && a['passCode'] != null)) ...[
              SectionTitle(s.apptPass),
              Card(
                key: const Key('apptPass'),
                child: Padding(
                  padding: const EdgeInsets.all(Tokens.sp4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${a['visitorName'] ?? a['student'] ?? ''}',
                        style: const TextStyle(fontSize: 18, fontWeight: Tokens.fwBold),
                      ),
                      if (student != null) Text(student),
                      Text(
                        [
                          number,
                          if (whom != null) '$whom',
                          if (_when(s, a['startsAt']) != null) _when(s, a['startsAt'])!,
                          if (a['place'] != null) '${a['place']}',
                        ].join(' · '),
                      ),
                      const SizedBox(height: Tokens.sp2),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              s.apptCard,
                              style: const TextStyle(fontWeight: Tokens.fwSemibold),
                            ),
                          ),
                          FileIcons(
                            name: 'apptCard',
                            label: s.apptCard,
                            load: () => ref.read(apiProvider).appointmentsMineCardData(id: id),
                          ),
                        ],
                      ),
                      Text(s.apptShowHelp, style: TextStyle(color: muted, fontSize: 13)),
                    ],
                  ),
                ),
              ),
            ],
            SectionTitle(s.apptDetails),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp4),
                child: Column(
                  children: [
                    for (final (k, v) in facts)
                      if ((v ?? '').trim().isNotEmpty) FactLine(k, v!),
                  ],
                ),
              ),
            ),
            if (_cancellable.contains(state))
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: OutlinedButton(
                  key: const Key('apptDetailCancel'),
                  onPressed: () => _cancelAppointment(context, ref, id),
                  child: Text(s.apptCancel),
                ),
              ),
            if (events.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp3),
              Card(
                clipBehavior: Clip.antiAlias,
                child: ExpansionTile(
                  key: const Key('apptHistory'),
                  leading: const Icon(Icons.history_outlined),
                  title: Text(s.apptHistory, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                  subtitle: Text(
                    s.apptHistoryHint(events.length, s.apptEvent('${events.last['kind']}')),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  shape: const Border(),
                  collapsedShape: const Border(),
                  expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, e) in events.indexed)
                      ListTile(
                        key: Key('apptEvent-$i'),
                        title: Text(eventLine(e)),
                        subtitle: _when(s, e['at']) == null
                            ? null
                            : Text(_when(s, e['at'])!, style: TextStyle(color: muted)),
                      ),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}
