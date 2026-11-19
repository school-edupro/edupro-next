import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// The child's timetable as the website shows it (apps/parent/app/(app)/timetable): **Week**, the periods down the
/// side and the school days across (slide sideways for the later days), each with its subject, teacher and room,
/// breaks shown as such; and **Day**, one day at a time (today first) for a quick look on the phone.
class TimetableScreen extends ConsumerStatefulWidget {
  const TimetableScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<TimetableScreen> createState() => _TimetableScreenState();
}

class _TimetableScreenState extends ConsumerState<TimetableScreen> {
  String _view = 'week';
  // Monday … Saturday; on Sunday the week ahead opens on Monday
  int _day = DateTime.now().weekday == 7 ? 1 : DateTime.now().weekday;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return LoadedList<Json>(
      value: ref.watch(timetableProvider(p)),
      refresh: () => ref.refresh(timetableProvider(p).future),
      children: (tt) {
        final periods = asList(tt['periods'])
          ..sort((a, b) => ((a['number'] as num?) ?? 0).compareTo((b['number'] as num?) ?? 0));
        final slots = asList(tt['slots']);
        final days = [
          for (var d = 1; d <= 6; d++)
            if (slots.any((x) => x['weekday'] == d)) d,
        ];
        return [
          if (slots.isNotEmpty)
            Text(
              s.schoolDaysAWeek(days.length),
              key: const Key('ttDays'),
              style: TextStyle(color: muted, fontSize: 14),
            ),
          const SizedBox(height: Tokens.sp2),
          Semantics(
            label: s.timetable,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              children: [
                for (final (v, label) in [('week', s.weekTab), ('day', s.dayTab)])
                  ChoiceChip(
                    key: Key('ttView-$v'),
                    label: Text(label),
                    selected: _view == v,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _view = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          if (slots.isEmpty)
            EmptyLine(s.timetableNotPublished)
          else if (_view == 'week')
            _WeekGrid(periods: periods, slots: slots, days: days)
          else ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SegmentedButton<int>(
                key: const Key('weekday'),
                showSelectedIcon: false,
                segments: [
                  for (var d = 1; d <= 6; d++) ButtonSegment(value: d, label: Text(s.weekday(d))),
                ],
                selected: {_day},
                onSelectionChanged: (v) => setState(() => _day = v.first),
              ),
            ),
            const SizedBox(height: Tokens.sp3),
            if (!slots.any((x) => x['weekday'] == _day))
              EmptyLine(s.nothingYet)
            else
              for (final period in periods)
                _row(context, s, period, slots.where((x) => x['weekday'] == _day).toList()),
          ],
        ];
      },
    );
  }

  Widget _row(BuildContext context, S s, Json period, List<Json> slots) {
    final slot = slots.where((x) => '${x['periodId']}' == '${period['id']}').firstOrNull;
    final time = '${s.time(period['startsAt'] as String?)}–${s.time(period['endsAt'] as String?)}';
    if (period['isBreak'] == true) {
      return ListTile(
        dense: true,
        leading: const Icon(Icons.free_breakfast_outlined),
        title: Text(s.breakTime),
        trailing: Text(time),
      );
    }
    return Card(
      child: ListTile(
        leading: CircleAvatar(child: Text('${period['number'] ?? ''}')),
        title: Text(slot?['subjectName'] as String? ?? '—'),
        subtitle: Text(
          [
            if (slot?['teacherName'] != null) '${slot!['teacherName']}',
            if (slot?['room'] != null) '${slot!['room']}',
          ].join(' · '),
        ),
        trailing: Text(time),
      ),
    );
  }
}

/// The week as on the website: a row per period (its name and time), a column per school day; today's column is
/// marked. Wider than a phone: it slides sideways.
class _WeekGrid extends ConsumerWidget {
  const _WeekGrid({required this.periods, required this.slots, required this.days});
  final List<Json> periods;
  final List<Json> slots;
  final List<int> days;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final line = (dark ? Tokens.mobGray700 : Tokens.mobGray200);
    final today = DateTime.now().weekday;
    Json? at(int day, Object? periodId) =>
        slots.where((x) => x['weekday'] == day && '${x['periodId']}' == '$periodId').firstOrNull;
    Widget cell(Widget child, {bool head = false, bool mark = false}) => Container(
      padding: const EdgeInsets.all(Tokens.sp2),
      color: mark
          ? (dark ? Tokens.mobNavy700 : Tokens.mobCyan50)
          : head
          ? (dark ? Tokens.mobGray700 : Tokens.mobGray50)
          : null,
      child: child,
    );
    return Card(
      key: const Key('ttWeek'),
      clipBehavior: Clip.antiAlias,
      child: Semantics(
        label: s.weekTimetableLabel,
        container: true,
        explicitChildNodes: true,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Table(
            defaultColumnWidth: const FixedColumnWidth(118),
            columnWidths: const {0: FixedColumnWidth(96)},
            defaultVerticalAlignment: TableCellVerticalAlignment.top,
            border: TableBorder(horizontalInside: BorderSide(color: line)),
            children: [
              TableRow(
                children: [
                  cell(
                    Text(s.periodLabel, style: const TextStyle(fontWeight: Tokens.fwBold)),
                    head: true,
                  ),
                  for (final d in days)
                    cell(
                      Text(s.weekday(d), style: const TextStyle(fontWeight: Tokens.fwBold)),
                      head: true,
                      mark: d == today,
                    ),
                ],
              ),
              for (final p in periods)
                TableRow(
                  key: ValueKey('ttRow-${p['id']}'),
                  children: [
                    cell(
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${p['name'] ?? ''}',
                            style: const TextStyle(fontWeight: Tokens.fwSemibold),
                          ),
                          Text(
                            '${s.time(p['startsAt'] as String?)}–${s.time(p['endsAt'] as String?)}',
                            style: TextStyle(color: muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    for (final d in days)
                      cell(
                        p['isBreak'] == true
                            ? Text('—', style: TextStyle(color: muted))
                            : _slot(at(d, p['id']), muted),
                        mark: d == today,
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _slot(Json? x, Color muted) {
    if (x == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${x['subjectName'] ?? ''}'),
        if (x['teacherName'] != null || x['room'] != null)
          Text(
            [
              if (x['teacherName'] != null) '${x['teacherName']}',
              if (x['room'] != null) '${x['room']}',
            ].join(' · '),
            style: TextStyle(color: muted, fontSize: 12),
          ),
      ],
    );
  }
}
