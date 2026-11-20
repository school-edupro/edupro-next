import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// A holiday or an event on the calendar: from, to, what, the time, its mark and a note.
typedef _Entry = ({
  String key,
  String date,
  String end,
  String label,
  String? at,
  String mark,
  String? note,
});

/// When a day carries several things, its square takes the colour of the first of these.
const _markOrder = ['holiday', 'vacation', 'exam', 'working_day', 'event'];

Color _markColor(String m) => switch (m) {
  'holiday' || 'vacation' => Tokens.statusSuccess,
  'exam' => Tokens.statusDanger,
  'working_day' => Tokens.statusWarning,
  _ => Tokens.statusInfo,
};

Color _markTint(String m) => switch (m) {
  'holiday' || 'vacation' => Tokens.statusSuccessBg,
  'exam' => Tokens.statusDangerBg,
  'working_day' => Tokens.statusWarningBg,
  _ => Tokens.statusInfoBg,
};

Tone _markTone(String m) => switch (m) {
  'holiday' || 'vacation' => Tone.success,
  'exam' => Tone.danger,
  'working_day' => Tone.warning,
  _ => Tone.neutral,
};

int _daysOf(String a, String b) => DateTime.parse(b).difference(DateTime.parse(a)).inDays + 1;

/// The school's calendar as the website shows it (apps/parent/app/(app)/calendar): **Calendar**, a month as a grid
/// (Previous / Today / Next, the next holiday, each day coloured by what falls on it, a tap lists that day, then
/// all of the month); **Holiday list** (how many this session, upcoming and earlier); **Events** (upcoming and
/// earlier). The whole session is read once.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  String _view = 'month';
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  String? _picked = ymd(DateTime.now());

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return LoadedList<Json>(
      key: ValueKey('cal-$_view'),
      value: ref.watch(sessionCalendarProvider(p)),
      refresh: () => ref.refresh(sessionCalendarProvider(p).future),
      children: (cal) {
        final today = ymd(DateTime.now());
        final holidays = <_Entry>[
          for (final h in asList(cal['holidays']))
            (
              key: 'h${h['id']}',
              date: '${h['startsOn']}',
              end: '${h['endsOn']}',
              label: '${h['name']}',
              at: null,
              mark: h['kind'] == 'vacation'
                  ? 'vacation'
                  : h['kind'] == 'working_day'
                  ? 'working_day'
                  : 'holiday',
              note: null,
            ),
        ];
        final events = <_Entry>[
          for (final e in asList(cal['events']))
            (
              key: 'e${e['id']}',
              date: '${e['startsOn']}',
              end: '${e['endsOn']}',
              label: '${e['title']}',
              at: e['startsAt'] as String?,
              mark: e['kind'] == 'exam' ? 'exam' : 'event',
              note: e['description'] as String?,
            ),
        ];
        final all = [...holidays, ...events]..sort((a, b) => a.date.compareTo(b.date));
        final daysOff = holidays.where((h) => h.mark != 'working_day').toList()
          ..sort((a, b) => a.date.compareTo(b.date));
        return [
          if (cal['from'] != null && cal['to'] != null)
            Text(
              s.sessionSpan(s.date(cal['from']), s.date(cal['to'])),
              style: TextStyle(color: muted, fontSize: 14),
            ),
          const SizedBox(height: Tokens.sp2),
          Semantics(
            label: s.calendar,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final (v, label) in [
                  ('month', s.calendar),
                  ('holidays', s.holidayList),
                  ('events', s.events),
                ])
                  ChoiceChip(
                    key: Key('calView-$v'),
                    label: Text(label),
                    selected: _view == v,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _view = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          ...switch (_view) {
            'holidays' => [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(Tokens.sp4),
                  child: Text(
                    s.holidaysThisSession(
                      daysOff.length,
                      daysOff.fold<int>(0, (n, h) => n + _daysOf(h.date, h.end)),
                    ),
                    key: const Key('holidayCount'),
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                ),
              ),
              SectionTitle(s.upcoming),
              _List(
                rows: holidays.where((h) => h.end.compareTo(today) >= 0).toList(),
                withDays: true,
              ),
              SectionTitle(s.earlierThisYear),
              _List(
                rows: holidays.where((h) => h.end.compareTo(today) < 0).toList(),
                withDays: true,
              ),
            ],
            'events' => [
              SectionTitle(s.upcoming),
              _List(rows: events.where((e) => e.end.compareTo(today) >= 0).toList()),
              SectionTitle(s.earlierThisYear),
              _List(rows: events.where((e) => e.end.compareTo(today) < 0).toList()),
            ],
            _ => _monthView(s, all, daysOff, today),
          },
        ];
      },
    );
  }

  List<Widget> _monthView(S s, List<_Entry> all, List<_Entry> daysOff, String today) {
    final next = daysOff.where((h) => h.end.compareTo(today) >= 0).firstOrNull;
    final first = ymd(_month);
    final last = ymd(DateTime(_month.year, _month.month + 1, 0));
    final inMonth = all
        .where((e) => e.date.compareTo(last) <= 0 && e.end.compareTo(first) >= 0)
        .toList();
    final picked = _picked != null && _picked!.startsWith(first.substring(0, 7)) ? _picked : null;
    final onPicked = picked == null
        ? <_Entry>[]
        : all.where((e) => e.date.compareTo(picked) <= 0 && e.end.compareTo(picked) >= 0).toList();
    String span(_Entry e) =>
        e.date == e.end ? s.dayShort(e.date) : '${s.dayShort(e.date)} – ${s.dayShort(e.end)}';
    return [
      Row(
        children: [
          IconButton(
            key: const Key('calBack'),
            tooltip: s.previous,
            icon: const Icon(Icons.chevron_left),
            onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
          ),
          Expanded(
            child: Text(
              s.month(_month),
              key: const Key('calMonth'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
          ),
          IconButton(
            key: const Key('calNext'),
            tooltip: s.next,
            icon: const Icon(Icons.chevron_right),
            onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
          ),
        ],
      ),
      Align(
        child: TextButton(
          key: const Key('calToday'),
          onPressed: () => setState(() {
            final now = DateTime.now();
            _month = DateTime(now.year, now.month);
            _picked = ymd(now);
          }),
          child: Text(s.today),
        ),
      ),
      if (next != null) ...[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Text(
              s.nextHoliday('${next.label} · ${span(next)}'),
              key: const Key('nextHoliday'),
              style: const TextStyle(fontWeight: Tokens.fwSemibold),
            ),
          ),
        ),
        const SizedBox(height: Tokens.sp2),
      ],
      Card(
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Grid(
                month: _month,
                entries: all,
                today: today,
                picked: picked,
                onPick: (d) => setState(() => _picked = d),
              ),
              const SizedBox(height: Tokens.sp3),
              const _Legend(),
            ],
          ),
        ),
      ),
      if (picked != null) ...[
        SectionTitle(
          '${s.dayLong(DateTime.parse(picked))} ${picked.substring(0, 4)}',
          key: const Key('calPicked'),
        ),
        if (onPicked.isEmpty) EmptyLine(s.nothingOnDay) else _List(rows: onPicked),
      ],
      SectionTitle(s.thisMonth),
      _List(rows: inMonth),
    ];
  }
}

/// The month as a grid, Monday first: each day coloured by the first of what falls on it, Sunday marked; a tap
/// lists the day.
class _Grid extends ConsumerWidget {
  const _Grid({
    required this.month,
    required this.entries,
    required this.today,
    required this.picked,
    required this.onPick,
  });
  final DateTime month;
  final List<_Entry> entries;
  final String today;
  final String? picked;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final count = DateTime(month.year, month.month + 1, 0).day;
    final lead = DateTime(month.year, month.month).weekday - 1;
    final cells = <int?>[for (var i = 0; i < lead; i++) null, for (var d = 1; d <= count; d++) d];
    while (cells.length % 7 != 0) {
      cells.add(null);
    }
    Widget day(int d, int column) {
      final date = ymd(DateTime(month.year, month.month, d));
      final list = entries
          .where((e) => e.date.compareTo(date) <= 0 && e.end.compareTo(date) >= 0)
          .toList();
      final mark = _markOrder.where((m) => list.any((e) => e.mark == m)).firstOrNull;
      final isPicked = date == picked;
      return Semantics(
        button: true,
        selected: isPicked,
        label:
            '${s.dayShort(date)}${list.isEmpty ? '' : ': ${list.map((e) => e.label).join(', ')}'}',
        excludeSemantics: true,
        child: InkWell(
          key: Key('calDay-$date'),
          onTap: () => onPick(date),
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
          child: Container(
            decoration: BoxDecoration(
              color: mark == null ? null : _markTint(mark),
              borderRadius: BorderRadius.circular(Tokens.radiusSm),
              border: isPicked
                  ? Border.all(color: Tokens.mobCyan600, width: 2)
                  : date == today
                  ? Border.all(color: (dark ? Tokens.mobGray300 : Tokens.mobNavy800))
                  : null,
            ),
            padding: const EdgeInsets.all(2),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '$d',
                    style: TextStyle(
                      fontWeight: date == today ? Tokens.fwBold : null,
                      color: mark != null
                          ? Tokens.textBody
                          : column == 6
                          ? Tokens.statusDanger
                          : null,
                    ),
                  ),
                  if (mark != null)
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: _markColor(mark), shape: BoxShape.circle),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      children: [
        Row(
          children: [
            for (var w = 1; w <= 7; w++)
              Expanded(
                child: Center(
                  child: ExcludeSemantics(
                    child: Text(s.weekday(w), style: Theme.of(context).textTheme.labelSmall),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp1),
        for (var i = 0; i < cells.length; i += 7)
          Row(
            children: [
              for (var j = 0; j < 7; j++)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: AspectRatio(
                      aspectRatio: 1,
                      child: cells[i + j] == null ? const SizedBox() : day(cells[i + j]!, j),
                    ),
                  ),
                ),
            ],
          ),
      ],
    );
  }
}

/// What the colours mean.
class _Legend extends ConsumerWidget {
  const _Legend();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return ExcludeSemantics(
      child: Wrap(
        spacing: Tokens.sp4,
        runSpacing: Tokens.sp1,
        children: [
          for (final m in _markOrder)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: _markColor(m), shape: BoxShape.circle),
                ),
                const SizedBox(width: Tokens.sp1),
                Text(s.calMark(m), style: const TextStyle(fontSize: 13)),
              ],
            ),
        ],
      ),
    );
  }
}

/// Holidays or events as the website's table: the date (and time), what, the note, the days (holidays) and the
/// kind.
class _List extends ConsumerWidget {
  const _List({required this.rows, this.withDays = false});
  final List<_Entry> rows;
  final bool withDays;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    if (rows.isEmpty) return EmptyLine(s.nothingScheduled);
    return Card(
      child: Column(
        children: [
          for (final (i, e) in rows.indexed)
            Container(
              key: Key('calEntry-${e.key}'),
              padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: Tokens.sp3),
              decoration: BoxDecoration(
                border: i == 0
                    ? null
                    : Border(
                        top: BorderSide(color: (dark ? Tokens.mobGray700 : Tokens.mobGray100)),
                      ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(e.label, style: const TextStyle(fontWeight: Tokens.fwBold)),
                        Text(
                          [
                            e.date == e.end
                                ? s.dayShort(e.date)
                                : '${s.dayShort(e.date)} – ${s.dayShort(e.end)}',
                            if (e.at != null) s.time(e.at),
                            if (withDays) s.daysN(_daysOf(e.date, e.end)),
                          ].join(' · '),
                          style: TextStyle(color: muted, fontSize: 13),
                        ),
                        if ((e.note ?? '').isNotEmpty)
                          Text(e.note!, style: const TextStyle(fontSize: 13)),
                      ],
                    ),
                  ),
                  const SizedBox(width: Tokens.sp2),
                  StatusChip(s.calMark(e.mark), _markTone(e.mark)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
