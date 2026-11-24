import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of "Appointments with me" (as the staff website's, in English and Hindi).
extension StaffApptWords on S {
  String _sa(String en, String hi) => hindi ? hi : en;

  String get saList => _sa('List', 'सूची');
  String get saCalendar => _sa('Calendar', 'कैलेंडर');
  String saToday(int n) => _sa('Today · $n', 'आज · $n');
  String saUpcoming(int n) => _sa('Still to come · $n', 'आने वाले · $n');
  String saPast(int n) => _sa('Past · $n', 'बीते · $n');
  String get saHelp => _sa(
    'Confirmed by the front desk. The front desk confirms and moves appointments.',
    'फ्रंट डेस्क द्वारा पुष्ट। फ्रंट डेस्क ही अपॉइंटमेंट पुष्ट करता और बदलता है।',
  );
  String get saNone => _sa(
    'Nobody has a confirmed appointment with you here.',
    'यहाँ आपसे किसी की पुष्ट अपॉइंटमेंट नहीं है।',
  );
  String get saNothingBooked => _sa('Nothing booked', 'कुछ तय नहीं');
  String get saVisitor => _sa('Visitor', 'आगंतुक');
  String get saAdmNo => _sa('Adm. no.', 'प्रवेश सं.');
  String get saMore => _sa('Show more', 'और दिखाएँ');
  String get saEarlier => _sa('Earlier', 'पहले');
  String get saLater => _sa('Later', 'बाद में');
  String saState(String state) => switch (state) {
    'requested' => _sa('Waiting for the front desk', 'फ्रंट डेस्क की प्रतीक्षा'),
    'approved' => _sa('Confirmed', 'पुष्ट'),
    'checked_in' => _sa('Arrived', 'पहुँच गए'),
    'completed' => _sa('Completed', 'पूर्ण'),
    'no_show' => _sa('Did not come', 'नहीं आए'),
    _ => state,
  };
}

/// The day (school time) of a moment the API gives, as YYYY-MM-DD.
String _dayOf(Object? v) {
  final x = DateTime.tryParse('$v');
  if (x == null) return '';
  final t = x.toUtc().add(const Duration(hours: 5, minutes: 30));
  return ymd(DateTime(t.year, t.month, t.day));
}

String _timeOf(Object? v) {
  final x = DateTime.tryParse('$v');
  if (x == null) return '';
  final t = x.toUtc().add(const Duration(hours: 5, minutes: 30));
  return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

DateTime _mondayOf(DateTime d) => d.subtract(Duration(days: (d.weekday + 6) % 7));

/// One list of "with me": today / still to come / past, and how many rows to show.
final staffWithMeProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String, int)>(
  (ref, k) async {
    final (p, list, size) = k;
    final r = await cached(
      'with-me:${p.id}:$list:$size',
      () => ref.read(apiProvider).appointmentsWithMe(when: list, size: size),
    );
    return Loaded(asJson(r.data), r.at, stale: r.stale);
  },
);

/// A week of "with me" (Monday to Sunday).
final staffWithMeWeekProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String)>((
  ref,
  k,
) async {
  final (p, monday) = k;
  final from = DateTime.parse(monday);
  final r = await cached(
    'with-me-week:${p.id}:$monday',
    () => ref
        .read(apiProvider)
        .appointmentsWithMe(
          when: 'all',
          from: monday,
          to: ymd(from.add(const Duration(days: 6))),
          size: 200,
        ),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// Appointments with me as on the staff website (0059): who comes to meet this member of staff — **Today**,
/// **Still to come** and **Past**, or a **week calendar**. The front desk confirms and moves appointments; the
/// visitor's contact details stay with the front desk. No web page.
class StaffAppointmentsScreen extends ConsumerStatefulWidget {
  const StaffAppointmentsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffAppointmentsScreen> createState() => _StaffAppointmentsScreenState();
}

class _StaffAppointmentsScreenState extends ConsumerState<StaffAppointmentsScreen> {
  bool _calendar = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    // the counts come with any list; the "still to come" one is loaded first
    final counts = asJson(
      ref.watch(staffWithMeProvider((widget.profile, 'upcoming', 25))).value?.data['counts'],
    );
    int n(String k) => (counts[k] as num?)?.toInt() ?? 0;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp3, Tokens.sp4, 0),
          child: SegmentedButton<bool>(
            key: const Key('saView'),
            segments: [
              ButtonSegment(value: false, icon: const Icon(Icons.list), label: Text(s.saList)),
              ButtonSegment(
                value: true,
                icon: const Icon(Icons.calendar_view_week),
                label: Text(s.saCalendar),
              ),
            ],
            selected: {_calendar},
            onSelectionChanged: (v) => setState(() => _calendar = v.first),
          ),
        ),
        Expanded(
          child: _calendar
              ? _Week(profile: widget.profile)
              : DefaultTabController(
                  length: 3,
                  initialIndex: 1,
                  child: Column(
                    children: [
                      Material(
                        color: Theme.of(context).colorScheme.surface,
                        child: TabBar(
                          key: const Key('saTabs'),
                          isScrollable: true,
                          tabAlignment: TabAlignment.start,
                          tabs: [
                            Tab(text: s.saToday(n('today'))),
                            Tab(text: s.saUpcoming(n('upcoming'))),
                            Tab(text: s.saPast(n('past'))),
                          ],
                        ),
                      ),
                      Expanded(
                        child: TabBarView(
                          children: [
                            _WhenList(profile: widget.profile, when: 'today'),
                            _WhenList(profile: widget.profile, when: 'upcoming'),
                            _WhenList(profile: widget.profile, when: 'past'),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
        ),
      ],
    );
  }
}

class _WhenList extends ConsumerStatefulWidget {
  const _WhenList({required this.profile, required this.when});
  final Profile profile;
  final String when;

  @override
  ConsumerState<_WhenList> createState() => _WhenListState();
}

class _WhenListState extends ConsumerState<_WhenList> with AutomaticKeepAliveClientMixin {
  int _size = 25;

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = ref.watch(stringsProvider);
    final key = (widget.profile, widget.when, _size);
    return LoadedList<Json>(
      value: ref.watch(staffWithMeProvider(key)),
      refresh: () => ref.refresh(staffWithMeProvider(key).future),
      children: (d) {
        final visits = asList(d['data']);
        final total = (asJson(d['page'])['total'] as num?)?.toInt() ?? visits.length;
        final days = <String>[];
        for (final v in visits) {
          final day = _dayOf(v['startsAt']);
          if (!days.contains(day)) days.add(day);
        }
        return [
          Text(s.saHelp, style: const TextStyle(fontSize: 13)),
          const SizedBox(height: Tokens.sp3),
          if (visits.isEmpty) Notice(text: s.saNone),
          for (final day in days)
            _DayCard(
              day: day,
              visits: [
                for (final v in visits)
                  if (_dayOf(v['startsAt']) == day) v,
              ],
            ),
          if (visits.length < total)
            Align(
              child: OutlinedButton(
                key: Key('saMore-${widget.when}'),
                onPressed: () => setState(() => _size += 25),
                child: Text(s.saMore),
              ),
            ),
        ];
      },
    );
  }
}

class _Week extends ConsumerStatefulWidget {
  const _Week({required this.profile});
  final Profile profile;

  @override
  ConsumerState<_Week> createState() => _WeekState();
}

class _WeekState extends ConsumerState<_Week> {
  late DateTime _monday = _mondayOf(schoolToday());

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final key = (widget.profile, ymd(_monday));
    final today = ymd(schoolToday());
    return LoadedList<Json>(
      value: ref.watch(staffWithMeWeekProvider(key)),
      refresh: () => ref.refresh(staffWithMeWeekProvider(key).future),
      children: (d) {
        final visits = asList(d['data']);
        final days = [for (var i = 0; i < 7; i++) ymd(_monday.add(Duration(days: i)))];
        return [
          Text(
            '${s.dayShort(days.first)} – ${s.dayShort(days.last)}',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
          const SizedBox(height: Tokens.sp2),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('saEarlier'),
                  icon: const Icon(Icons.chevron_left),
                  label: Text(s.saEarlier),
                  onPressed: () =>
                      setState(() => _monday = _monday.subtract(const Duration(days: 7))),
                ),
              ),
              const SizedBox(width: Tokens.sp2),
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('saLater'),
                  icon: const Icon(Icons.chevron_right),
                  label: Text(s.saLater),
                  onPressed: () => setState(() => _monday = _monday.add(const Duration(days: 7))),
                ),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
          for (final day in days)
            _DayCard(
              day: day,
              today: day == today,
              visits: [
                for (final v in visits)
                  if (_dayOf(v['startsAt']) == day) v,
              ],
            ),
        ];
      },
    );
  }
}

/// A day: its appointments, or "Nothing booked".
class _DayCard extends ConsumerWidget {
  const _DayCard({required this.day, required this.visits, this.today = false});
  final String day;
  final List<Json> visits;
  final bool today;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return Card(
      key: Key('saDay-$day'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      shape: today
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(Tokens.radiusMd),
              side: const BorderSide(color: Tokens.mobCyan700, width: 2),
            )
          : null,
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(s.dayLong(DateTime.parse(day)), style: const TextStyle(fontWeight: Tokens.fwBold)),
            if (visits.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(s.saNothingBooked, style: TextStyle(color: muted)),
              ),
            for (final v in visits) _VisitRow(visit: v),
          ],
        ),
      ),
    );
  }
}

class _VisitRow extends ConsumerWidget {
  const _VisitRow({required this.visit});
  final Json visit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final v = visit;
    final state = '${v['state']}';
    final party = (v['partySize'] as num?)?.toInt() ?? 1;
    final tint = switch (state) {
      'requested' => Tokens.mobAmber50,
      'approved' => Tokens.mobGreen50,
      'no_show' => Tokens.mobRed50,
      _ => Tokens.mobCyan100,
    };
    final detail = [
      '${v['number'] ?? ''}',
      if (v['student'] != null)
        '${v['student']}${v['section'] != null ? ' (${v['section']})' : ''}${v['admissionNo'] != null ? ' · ${s.saAdmNo} ${v['admissionNo']}' : ''}',
      if (v['visitorOrg'] != null) '${v['visitorOrg']}',
      if (v['place'] != null) '${v['place']}',
    ].where((x) => x.isNotEmpty).join(' · ');
    return Container(
      key: Key('saVisit-${v['id']}'),
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray200)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  '${_timeOf(v['startsAt'])} · ${v['visitorName'] ?? s.saVisitor}${party > 1 ? ' + ${party - 1}' : ''}',
                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                ),
              ),
              const SizedBox(width: Tokens.sp2),
              Tag(s.saState(state), color: tint),
            ],
          ),
          if ('${v['purpose'] ?? ''}'.isNotEmpty) Text('${v['purpose']}'),
          if (detail.isNotEmpty) Text(detail, style: TextStyle(color: muted, fontSize: 13)),
        ],
      ),
    );
  }
}
