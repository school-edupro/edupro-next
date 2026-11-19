import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'attendance.dart';
import 'calendar.dart';
import 'common.dart';
import 'data.dart';
import 'date_sheet.dart';
import 'fees.dart';
import 'homework.dart';
import 'messages.dart';
import 'results.dart';
import 'timetable.dart';

/// Home for a parent's child or a student (docs/design/89 §5.2; look B): the navy band goes on with the date and a
/// greeting, the figures card sits half over it — attendance this month, homework due, fees to pay (a student: the
/// next exam), unread messages — then shortcuts, today's attendance, today's classes (now marked), the homework due
/// today and tomorrow, the next exam and the latest notices. Each part loads on its own; one failing leaves the
/// others.
class TodayScreen extends ConsumerWidget {
  const TodayScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final p = profile;
    final now = DateTime.now();
    final att = ref.watch(attendanceProvider((p, ym(now))));
    final work = ref.watch(homeworkProvider(workRange(p)));
    final fees = p.kind == 'parent' ? ref.watch(feesProvider(p)) : null;
    final exams = ref.watch(dateSheetProvider(p));
    final notices = ref.watch(noticesProvider(p));
    final unread = ref.watch(unreadProvider(p));
    final timetable = ref.watch(timetableProvider(p));
    final classes = timetable.value == null ? null : classesToday(timetable.value!.data, now);

    final child = att.value?.data;
    final sum = asJson(child?['summary']);
    final todayCode =
        asList(child?['days']).where((d) => d['date'] == ymd(now)).firstOrNull?['code'] as String?;
    final due = work.value == null ? null : dueSoon(work.value!.data, days: 1);
    final next = exams.value == null ? null : nextPaper(exams.value!.data);
    final payable = num.tryParse('${fees?.value?.data?['payableNow']}');
    final stale = [
      att,
      work,
      notices,
    ].map((x) => x.value).whereType<Loaded<Object?>>().where((x) => x.stale);

    String fig<T>(AsyncValue<T> v, String Function(T) show) => switch (v) {
      AsyncValue(:final value?) => show(value),
      AsyncValue(hasError: true) => '—',
      _ => '…',
    };

    final first = p.name.split(RegExp(r'\s+')).first;
    void open(String title, Widget screen) => pushPage(context, title, screen);

    return RefreshIndicator(
      onRefresh: () {
        ref.invalidate(attendanceProvider((p, ym(now))));
        ref.invalidate(dateSheetProvider(p));
        ref.invalidate(noticesProvider(p));
        ref.invalidate(unreadProvider(p));
        ref.invalidate(timetableProvider(p));
        if (p.kind == 'parent') ref.invalidate(feesProvider(p));
        return ref.refresh(homeworkProvider(workRange(p)).future);
      },
      child: Material(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: ListView(
          key: const Key('today'),
          padding: const EdgeInsets.only(bottom: Tokens.sp6),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            HomeBand(
              date: s.dayLong(now),
              heading: p.kind == 'student' ? '${s.greeting(now)}, $first' : s.greeting(now),
              detail: p.detail,
              figures: FigureGrid(
                raised: true,
                tiles: [
                  FigureTile(
                    key: const Key('figAttendance'),
                    label: s.thisMonth,
                    value: fig(
                      att,
                      (_) => child == null ? '—' : '${sum['present'] ?? 0}/${sum['days'] ?? 0}',
                    ),
                    icon: Icons.fact_check_outlined,
                    onTap: () => open(s.attendance, AttendanceScreen(profile: p)),
                  ),
                  FigureTile(
                    key: const Key('figHomework'),
                    label: s.homeworkDue,
                    value: fig(work, (_) => '${due!.length}'),
                    icon: Icons.menu_book_outlined,
                    onTap: () => open(s.homework, HomeworkScreen(profile: p)),
                  ),
                  if (fees != null)
                    FigureTile(
                      key: const Key('figFees'),
                      label: s.feesPayable,
                      value: fig(
                        fees,
                        (_) => payable == null || payable <= 0 ? s.nothingDue : s.money(payable),
                      ),
                      icon: Icons.account_balance_wallet_outlined,
                      tone: (payable ?? 0) > 0 ? Tokens.statusWarning : null,
                      onTap: () => open(s.fees, FeesScreen(profile: p)),
                    )
                  else
                    FigureTile(
                      key: const Key('figExam'),
                      label: s.nextExam,
                      value: fig(exams, (_) => next == null ? '—' : s.dayShort(next['examOn'])),
                      icon: Icons.edit_calendar_outlined,
                      onTap: () => open(s.dateSheet, DateSheetScreen(profile: p)),
                    ),
                  FigureTile(
                    key: const Key('figUnread'),
                    label: s.unreadMessages,
                    value: fig(unread, (n) => '$n'),
                    icon: Icons.chat_bubble_outline,
                    onTap: () => open(s.messages, MessagesScreen(profile: p)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Tokens.sp4),
            ShortcutRow(
              label: s.shortcuts,
              items: [
                (
                  s.homework,
                  Icons.menu_book_outlined,
                  () => open(s.homework, HomeworkScreen(profile: p)),
                ),
                (
                  s.attendance,
                  Icons.fact_check_outlined,
                  () => open(s.attendance, AttendanceScreen(profile: p)),
                ),
                (s.timetable, Icons.schedule, () => open(s.timetable, TimetableScreen(profile: p))),
                (
                  s.results,
                  Icons.insert_chart_outlined,
                  () => open(s.results, ResultsScreen(profile: p)),
                ),
                (
                  s.calendar,
                  Icons.calendar_month_outlined,
                  () => open(s.calendar, CalendarScreen(profile: p)),
                ),
                (
                  s.dateSheet,
                  Icons.edit_calendar_outlined,
                  () => open(s.dateSheet, DateSheetScreen(profile: p)),
                ),
                (
                  s.notices,
                  Icons.campaign_outlined,
                  () => open(s.notices, NoticesList(profile: p)),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (stale.isNotEmpty) ...[
                    const SizedBox(height: Tokens.sp4),
                    StaleLine(at: stale.first.at),
                  ],
                  SectionTitle(s.attendanceToday),
                  Row(
                    children: [
                      if (att.hasError)
                        const Text('—')
                      else if (todayCode == null)
                        StatusChip(s.notMarked, Tone.neutral)
                      else
                        StatusChip(s.attendanceCode(todayCode), attendanceTone(todayCode)),
                      const SizedBox(width: Tokens.sp3),
                      if (child != null)
                        Expanded(
                          child: Text(
                            s.presentOf(
                              (sum['present'] as num? ?? 0).toInt(),
                              (sum['days'] as num? ?? 0).toInt(),
                            ),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                    ],
                  ),
                  if (classes != null && classes.isNotEmpty) ...[
                    SectionTitle(
                      s.todaysClasses,
                      action: TextButton(
                        onPressed: () => open(s.timetable, TimetableScreen(profile: p)),
                        child: Text(s.timetable),
                      ),
                    ),
                    ClassesCard(rows: classes, now: now),
                  ],
                  SectionTitle(
                    s.homeworkDue,
                    action: TextButton(
                      onPressed: () => open(s.homework, HomeworkScreen(profile: p)),
                      child: Text(s.seeAll),
                    ),
                  ),
                  if (due == null && !work.hasError) const LinearProgressIndicator(),
                  if (due != null && due.isEmpty) EmptyLine(s.noHomeworkDue),
                  if (due != null)
                    for (final w in due.take(3)) WorkTile(profile: p, work: w),
                  SectionTitle(s.nextExam),
                  if (exams.value != null && next == null) EmptyLine(s.noExam),
                  if (next != null)
                    Card(
                      child: ListTile(
                        leading: const Icon(Icons.edit_calendar_outlined),
                        title: Text('${next['subject']}'),
                        subtitle: Text('${next['exam']} · ${s.dayShort(next['examOn'])}'),
                        onTap: () => open(s.dateSheet, DateSheetScreen(profile: p)),
                      ),
                    ),
                  SectionTitle(
                    s.latestNotices,
                    action: TextButton(
                      onPressed: () => open(s.notices, NoticesList(profile: p)),
                      child: Text(s.seeAll),
                    ),
                  ),
                  if (notices.value != null && notices.value!.data.isEmpty) EmptyLine(s.nothingYet),
                  for (final n in notices.value?.data.take(3) ?? const <Json>[])
                    NoticeTile(profile: p, notice: n),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Today's periods of the child's section from its week (breaks left out), in order, each with its times.
List<Json> classesToday(Json week, DateTime now) {
  final slots = asList(week['slots']).where((x) => x['weekday'] == now.weekday).toList();
  if (slots.isEmpty) return const [];
  return [
    for (final period in asList(week['periods']))
      if (period['isBreak'] != true)
        for (final slot in slots.where((x) => '${x['periodId']}' == '${period['id']}').take(1))
          {
            'number': period['number'],
            'startsAt': period['startsAt'],
            'endsAt': period['endsAt'],
            'title': slot['subjectName'] ?? '—',
          },
  ];
}

/// Minutes from midnight of `09:20` / `09:20:00` (null when it is not a time).
int? minutesOf(Object? t) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch('${t ?? ''}');
  return m == null ? null : int.parse(m[1]!) * 60 + int.parse(m[2]!);
}

/// A day's periods in one card: the start time, what it is; the one on now tagged, the ones over ticked.
class ClassesCard extends ConsumerWidget {
  const ClassesCard({super.key, required this.rows, required this.now});

  /// each: startsAt, endsAt, title, and optional subtitle and substitute
  final List<Json> rows;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final at = now.hour * 60 + now.minute;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      key: const Key('classesCard'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: Tokens.sp1),
        child: Column(
          children: [
            for (var i = 0; i < rows.length; i++)
              Builder(
                builder: (context) {
                  final r = rows[i];
                  final from = minutesOf(r['startsAt']);
                  final to = minutesOf(r['endsAt']);
                  final isNow = from != null && to != null && at >= from && at < to;
                  final over = to != null && at >= to;
                  final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
                  return Container(
                    constraints: const BoxConstraints(minHeight: 56),
                    decoration: BoxDecoration(
                      border: i + 1 < rows.length
                          ? Border(
                              bottom: BorderSide(
                                color: dark ? Tokens.mobGray700 : Tokens.mobGray100,
                              ),
                            )
                          : null,
                    ),
                    padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 56,
                          child: Text(
                            s.time(r['startsAt'] as String?),
                            style: TextStyle(
                              fontSize: 14,
                              color: isNow ? (dark ? Tokens.mobWhite : Tokens.mobNavy800) : muted,
                              fontWeight: isNow ? Tokens.fwBold : Tokens.fwRegular,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${r['title']}',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: isNow ? Tokens.fwBold : Tokens.fwSemibold,
                                  color: over ? muted : null,
                                ),
                              ),
                              if (r['subtitle'] != null)
                                Text(
                                  '${r['subtitle']}',
                                  style: TextStyle(fontSize: 13, color: muted),
                                ),
                            ],
                          ),
                        ),
                        if (r['substitute'] == true) ...[
                          Tag(s.substitutionTag, color: Tokens.statusWarningBg),
                          const SizedBox(width: Tokens.sp2),
                        ],
                        if (isNow)
                          Tag(s.nowTag)
                        else if (over)
                          Icon(
                            Icons.check,
                            size: 18,
                            color: Tokens.statusSuccess,
                            semanticLabel: s.doneTag,
                          ),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}
