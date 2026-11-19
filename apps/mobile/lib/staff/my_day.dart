import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/outbox_view.dart';
import 'approvals.dart';
import 'class_attendance.dart';
import 'data.dart';
import 'marks.dart';
import 'my_attendance.dart';
import 'my_leave.dart';

/// The day sections the person marks (class teacher or coordinator) that have no attendance yet.
List<Json> sectionsToMark(List<Json> assignments, Json? summary) {
  final mine = {
    for (final a in assignments)
      if (a['subjectId'] == null && a['canMarkAttendance'] == true) '${a['classSectionId']}': a,
  };
  return [
    for (final x in asList(summary?['sections']))
      if (mine.containsKey('${x['classSectionId']}') && x['sessionId'] == null) x,
  ];
}

/// Today's periods: the person's slots for today's weekday, with substitutions given to them.
List<Json> periodsToday(Json week, DateTime today) {
  final periods = {for (final p in asList(week['periods'])) '${p['id']}': p};
  final day = ymd(today);
  final rows = <Json>[
    for (final x in asList(week['slots']))
      if (x['weekday'] == today.weekday) {...x, 'period': periods['${x['periodId']}']},
    for (final x in asList(week['substitutions']))
      if (x['onDate'] == day) {...x, 'substitute': true},
  ];
  int order(Json x) =>
      ((x['periodNumber'] ?? asJson(x['period'])['number']) as num?)?.toInt() ?? 99;
  return rows..sort((a, b) => order(a).compareTo(order(b)));
}

/// A staff member's Home (docs/design/89 §5.2): the figures first — periods today, classes to mark, marks to enter,
/// approvals waiting — then today's periods, the classes still to mark and the marks waiting. Each part loads on its
/// own. Today's rolls are fetched here too, so they can be marked later with no network.
class MyDayScreen extends ConsumerStatefulWidget {
  const MyDayScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<MyDayScreen> createState() => _MyDayScreenState();
}

class _MyDayScreenState extends ConsumerState<MyDayScreen> {
  bool _warmed = false;

  // keep today's rolls of the classes this person marks on the phone
  void _warm(List<Json> toMark) {
    if (_warmed) return;
    _warmed = true;
    final day = ymd(schoolToday());
    for (final x in toMark) {
      ref.read(rollProvider((widget.profile, '${x['classSectionId']}', day, null)).future).ignore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final today = schoolToday();
    final day = ymd(today);
    final week = ref.watch(myWeekProvider(p));
    final assignments = ref.watch(assignmentsProvider(p));
    final summary = ref.watch(daySummaryProvider((p, day)));
    final toEnter = ref.watch(toEnterProvider(p));
    final approvals = ref.watch(approvalsProvider(p));

    final periods = week.value == null ? null : periodsToday(week.value!.data, today);
    final toMark = assignments.value == null || summary.value == null
        ? null
        : sectionsToMark(assignments.value!.data, summary.value!.data);
    if (toMark != null) _warm(toMark);
    final marks = toEnter.value?.data.where((x) => x['done'] != x['total']).toList();
    final waiting = (approvals.value?.data['total'] as num?)?.toInt();
    final stale = [
      week,
      assignments,
      summary,
    ].map((x) => x.value).whereType<Loaded<Object?>>().where((x) => x.stale);

    String fig(Object? v) => v == null ? '…' : '$v';

    return RefreshIndicator(
      onRefresh: () {
        ref.invalidate(myWeekProvider(p));
        ref.invalidate(assignmentsProvider(p));
        ref.invalidate(toEnterProvider(p));
        ref.invalidate(approvalsProvider(p));
        _warmed = false;
        return ref.refresh(daySummaryProvider((p, day)).future);
      },
      child: ListView(
        key: const Key('myDay'),
        padding: const EdgeInsets.all(Tokens.sp4),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const OutboxBanner(),
          if (stale.isNotEmpty) ...[
            StaleLine(at: stale.first.at),
            const SizedBox(height: Tokens.sp3),
          ],
          Text(s.welcome(p.name), style: Theme.of(context).textTheme.titleLarge),
          if (p.detail != null) Text(p.detail!, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: Tokens.sp4),
          FigureGrid(
            tiles: [
              FigureTile(
                key: const Key('figPeriods'),
                label: s.todaysPeriods,
                value: fig(periods?.length),
                icon: Icons.view_week_outlined,
              ),
              FigureTile(
                key: const Key('figToMark'),
                label: s.toMark,
                value: fig(toMark?.length),
                icon: Icons.fact_check_outlined,
                tone: (toMark?.length ?? 0) > 0 ? Tokens.statusWarning : null,
                onTap: () => pushPage(context, s.markClass, MarkClassScreen(profile: p)),
              ),
              FigureTile(
                key: const Key('figToEnter'),
                label: s.toEnter,
                value: fig(marks?.length),
                icon: Icons.edit_note,
                onTap: () => pushPage(context, s.marksEntry, MarksHome(profile: p)),
              ),
              FigureTile(
                key: const Key('figApprovals'),
                label: s.approvals,
                value: fig(waiting),
                icon: Icons.fact_check_outlined,
                onTap: () => pushPage(context, s.approvals, ApprovalsScreen(profile: p)),
              ),
            ],
          ),
          SectionTitle(s.todaysPeriods),
          if (periods == null && !week.hasError) const LinearProgressIndicator(),
          if (periods != null && periods.isEmpty) EmptyLine(s.noPeriods),
          for (final x in periods ?? const <Json>[])
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  child: Text('${x['periodNumber'] ?? asJson(x['period'])['number'] ?? ''}'),
                ),
                title: Text(
                  [
                    if (x['classCode'] != null)
                      '${x['classCode']}-${x['section']}'
                    else
                      x['section'],
                    x['subjectName'] ?? x['subject'],
                  ].whereType<Object>().join(' · '),
                ),
                subtitle: Text(
                  [
                    if (x['substitute'] == true) s.substitution('${x['absentTeacher']}'),
                    if (x['room'] != null) '${x['room']}',
                    if (x['period'] != null)
                      '${s.time(asJson(x['period'])['startsAt'] as String?)}–${s.time(asJson(x['period'])['endsAt'] as String?)}',
                  ].join(' · '),
                ),
              ),
            ),
          SectionTitle(s.toMark),
          if (toMark == null && !(assignments.hasError || summary.hasError))
            const LinearProgressIndicator(),
          if (toMark != null && toMark.isEmpty) EmptyLine(s.allMarked),
          for (final x in toMark ?? const <Json>[])
            Card(
              child: ListTile(
                key: Key('toMark-${x['classSectionId']}'),
                leading: const Icon(Icons.fact_check_outlined),
                title: Text('${x['section']}'),
                subtitle: Text(s.dayAttendance),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => pushPage(
                  context,
                  s.markClass,
                  MarkClassScreen(profile: p, sectionId: '${x['classSectionId']}'),
                ),
              ),
            ),
          SectionTitle(s.toEnter),
          if (marks != null && marks.isEmpty) EmptyLine(s.nothingToEnter),
          for (final x in marks?.take(5) ?? const <Json>[])
            Card(
              child: ListTile(
                leading: const Icon(Icons.edit_note),
                title: Text('${x['exam']} · ${x['section']}'),
                subtitle: Text(
                  '${x['what']} · ${s.enteredOf((x['done'] as num? ?? 0).toInt(), (x['total'] as num? ?? 0).toInt())}',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => pushPage(context, s.marksEntry, MarksHome(profile: p)),
              ),
            ),
        ],
      ),
    );
  }
}

/// A staff member's Attendance tab: mark a class, their own attendance and leave.
class StaffAttendanceTab extends ConsumerWidget {
  const StaffAttendanceTab({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final items = <(String, IconData, Widget)>[
      (s.markClass, Icons.fact_check_outlined, MarkClassScreen(profile: profile)),
      (s.myAttendance, Icons.badge_outlined, MyAttendanceScreen(profile: profile)),
      (s.myLeave, Icons.beach_access_outlined, MyLeaveScreen(profile: profile)),
    ];
    return ListView(
      key: const Key('staffAttendanceTab'),
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: Tokens.sp4),
          child: OutboxBanner(),
        ),
        for (final (title, icon, screen) in items)
          ListTile(
            leading: Icon(icon),
            title: Text(title),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => pushPage(context, title, screen),
          ),
      ],
    );
  }
}
