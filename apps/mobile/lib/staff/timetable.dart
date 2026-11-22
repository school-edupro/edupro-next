import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'data.dart';

/// The staff timetable as on the staff website's "Sections and timetable" (docs/design/96, part 5): how many lessons
/// today, **My sections** (the role, the subject, what the person can do), **Substitutions this week**, and **My
/// week** — the week as a grid (a row per period, Monday to Saturday, today marked, breaks and free periods shown) or
/// a day at a time.
class StaffTimetable extends ConsumerStatefulWidget {
  const StaffTimetable({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffTimetable> createState() => _StaffTimetableState();
}

class _StaffTimetableState extends ConsumerState<StaffTimetable> {
  String _view = 'week';
  int _day = schoolToday().weekday == 7 ? 1 : schoolToday().weekday;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final sections = ref.watch(assignmentsProvider(p)).value?.data ?? const <Json>[];
    return LoadedList<Json>(
      value: ref.watch(myWeekProvider(p)),
      refresh: () async {
        ref.invalidate(assignmentsProvider(p));
        return ref.refresh(myWeekProvider(p).future);
      },
      children: (w) {
        final periods = asList(w['periods'])
          ..sort((a, b) => ((a['number'] as num?) ?? 0).compareTo((b['number'] as num?) ?? 0));
        final slots = asList(w['slots']);
        final subs = asList(w['substitutions']);
        final today = schoolToday().weekday;
        final lessonsToday = slots.where((x) => x['weekday'] == today).length;
        Widget title(String text) => Padding(
          padding: const EdgeInsets.only(top: Tokens.sp4, bottom: Tokens.sp2),
          child: Semantics(
            header: true,
            child: Text(
              text,
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: Tokens.fwSemibold),
            ),
          ),
        );
        return [
          Text(
            today <= 6 ? s.lessonsToday(lessonsToday) : s.noLessonsSunday,
            key: const Key('ttToday'),
            style: TextStyle(color: muted),
          ),
          // My sections
          title(s.mySectionsTitle),
          if (sections.isEmpty)
            EmptyLine(s.noAssignmentsYear)
          else
            for (final a in sections)
              Card(
                key: Key('ttSection-${a['id']}'),
                child: Padding(
                  padding: const EdgeInsets.all(Tokens.sp3),
                  // the role under the section (a long role or large text wraps instead of crowding the line)
                  child: Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        '${a['classCode']}-${a['section']}',
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                      StatusChip(
                        s.assignmentRole('${a['kind']}'),
                        a['kind'] == 'class_teacher' ? Tone.info : Tone.neutral,
                      ),
                      if (a['subjectName'] != null || a['canMarkAttendance'] == true)
                        Text(
                          [
                            if (a['subjectName'] != null) '${a['subjectName']}',
                            if (a['canMarkAttendance'] == true || a['canPostHomework'] == true)
                              '${s.canWord}: ${s.canDo(a['canMarkAttendance'] == true, a['canPostHomework'] == true)}',
                          ].join(' · '),
                          style: TextStyle(color: muted),
                        ),
                    ],
                  ),
                ),
              ),
          // Substitutions this week
          if (subs.isNotEmpty) ...[
            title(s.substitutionsWeek),
            for (final x in subs)
              Card(
                key: Key('ttSub-${x['id']}'),
                child: ListTile(
                  title: Text(
                    [
                      s.dayShort('${x['onDate']}'),
                      '${x['periodName']}',
                      '${x['section']}',
                      if (x['subject'] != null) '${x['subject']}',
                    ].join(' · '),
                  ),
                  subtitle: Text(
                    '${s.coversFor('${x['substitute']}', x['absentTeacher'] as String?)}'
                    '${x['reason'] != null ? ' (${x['reason']})' : ''}',
                  ),
                ),
              ),
          ],
          // My week
          title(s.myWeekTitle),
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
          if (periods.isEmpty)
            EmptyLine(s.noPeriodsDefined)
          else if (_view == 'week')
            _StaffWeekGrid(periods: periods, slots: slots)
          else ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SegmentedButton<int>(
                key: const Key('ttWeekday'),
                showSelectedIcon: false,
                segments: [
                  for (var d = 1; d <= 6; d++) ButtonSegment(value: d, label: Text(s.weekday(d))),
                ],
                selected: {_day},
                onSelectionChanged: (v) => setState(() => _day = v.first),
              ),
            ),
            const SizedBox(height: Tokens.sp3),
            for (final period in periods)
              _dayRow(s, period, slots.where((x) => x['weekday'] == _day).toList(), muted),
          ],
        ];
      },
    );
  }

  /// A period of the chosen day: a lesson (the section, the subject, the room), free, or a break or assembly.
  Widget _dayRow(S s, Json period, List<Json> slots, Color muted) {
    final time = '${s.time(period['startsAt'] as String?)}–${s.time(period['endsAt'] as String?)}';
    final kind = '${period['kind'] ?? 'teaching'}';
    if (kind != 'teaching') {
      return ListTile(
        dense: true,
        key: Key('ttDay-${period['id']}'),
        leading: const Icon(Icons.free_breakfast_outlined),
        title: Text('${period['name'] ?? s.periodKindWord(kind)}'),
        trailing: Text(time),
      );
    }
    final slot = slots.where((x) => '${x['periodId']}' == '${period['id']}').firstOrNull;
    return Card(
      key: Key('ttDay-${period['id']}'),
      child: ListTile(
        leading: CircleAvatar(child: Text('${period['number'] ?? ''}')),
        title: Text(
          slot == null ? s.periodFree : '${slot['classCode']}-${slot['section']}',
          style: slot == null ? TextStyle(color: muted) : null,
        ),
        subtitle: slot == null
            ? null
            : Text(
                [
                  '${slot['subjectName'] ?? slot['subjectCode'] ?? ''}',
                  if (slot['room'] != null) '${slot['room']}',
                ].where((x) => x.isNotEmpty).join(' · '),
              ),
        trailing: Text(time),
      ),
    );
  }
}

/// My week as on the website: a row per period (its name and time), Monday to Saturday, today's column marked; a
/// lesson shows the section, the subject and the room; a period with none says free; a break or assembly its kind.
/// Wider than a phone: it slides sideways.
class _StaffWeekGrid extends ConsumerWidget {
  const _StaffWeekGrid({required this.periods, required this.slots});
  final List<Json> periods;
  final List<Json> slots;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final line = (dark ? Tokens.mobGray700 : Tokens.mobGray200);
    final today = schoolToday().weekday;
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
            defaultColumnWidth: const FixedColumnWidth(110),
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
                  for (var d = 1; d <= 6; d++)
                    cell(
                      Text(
                        d == today ? '${s.weekday(d)} (${s.todayMark})' : s.weekday(d),
                        style: const TextStyle(fontWeight: Tokens.fwBold),
                      ),
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
                    for (var d = 1; d <= 6; d++)
                      cell(
                        '${p['kind'] ?? 'teaching'}' != 'teaching'
                            ? Text(
                                s.periodKindWord('${p['kind']}'),
                                style: TextStyle(color: muted, fontSize: 12),
                              )
                            : _slot(s, at(d, p['id']), muted),
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

  Widget _slot(S s, Json? x, Color muted) {
    if (x == null) return Text(s.periodFree, style: TextStyle(color: muted, fontSize: 12));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${x['classCode']}-${x['section']}',
          style: const TextStyle(fontWeight: Tokens.fwSemibold),
        ),
        Text(
          [
            '${x['subjectCode'] ?? ''}',
            if (x['room'] != null) '${x['room']}',
          ].where((v) => v.isNotEmpty).join(' · '),
          style: TextStyle(color: muted, fontSize: 12),
        ),
      ],
    );
  }
}
