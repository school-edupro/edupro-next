import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/home_shell.dart' show MoreList;
import 'attendance.dart';
import 'calendar.dart';
import 'common.dart';
import 'data.dart';
import 'date_sheet.dart';
import 'fees.dart';
import 'homework.dart';
import 'layout.dart';
import 'library.dart' show libraryProvider, LibraryScreen, LibraryWords;
import 'messages.dart';
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
    // the school's layout (docs/design/90): the shortcuts (or the person's own) and the cards in its order
    final layout = ref.watch(familyLayoutProvider(p)).value ?? FamilyLayoutView.fallback(p, null);
    final cardKeys = [for (final c in layout.cards) c.key];
    final calendar = cardKeys.contains('coming_up') ? ref.watch(sessionCalendarProvider(p)) : null;
    final library = cardKeys.contains('library') ? ref.watch(libraryProvider(p)) : null;
    final feesCard = cardKeys.contains('fees_due') && fees == null
        ? ref.watch(feesProvider(p))
        : fees;
    void open(String title, Widget screen) => pushPage(context, title, screen);

    return RefreshIndicator(
      onRefresh: () {
        ref.invalidate(attendanceProvider((p, ym(now))));
        ref.invalidate(dateSheetProvider(p));
        ref.invalidate(noticesProvider(p));
        ref.invalidate(unreadProvider(p));
        ref.invalidate(timetableProvider(p));
        if (p.kind == 'parent' || cardKeys.contains('fees_due')) ref.invalidate(feesProvider(p));
        if (calendar != null) ref.invalidate(sessionCalendarProvider(p));
        if (library != null) ref.invalidate(libraryProvider(p));
        ref.invalidate(familyLayoutProvider(p));
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
                  if (!layout.hidden.contains('/attendance'))
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
                  if (!layout.hidden.contains('/homework'))
                    FigureTile(
                      key: const Key('figHomework'),
                      label: s.homeworkDue,
                      value: fig(work, (_) => '${due!.length}'),
                      icon: Icons.menu_book_outlined,
                      onTap: () => open(s.homework, HomeworkScreen(profile: p)),
                    ),
                  if (fees != null && !layout.hidden.contains('/fees'))
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
                  else if (fees == null && !layout.hidden.contains('/date-sheet'))
                    FigureTile(
                      key: const Key('figExam'),
                      label: s.nextExam,
                      value: fig(exams, (_) => next == null ? '—' : s.dayShort(next['examOn'])),
                      icon: Icons.edit_calendar_outlined,
                      onTap: () => open(s.dateSheet, DateSheetScreen(profile: p)),
                    ),
                  if (!layout.hidden.contains('/messages'))
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
            const SizedBox(height: Tokens.sp3),
            Padding(
              padding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp2, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(
                        layout.ownShortcuts ? s.layOwn : s.shortcuts,
                        style: Theme.of(context).textTheme.titleSmall
                            ?.copyWith(fontWeight: Tokens.fwSemibold),
                      ),
                    ),
                  ),
                  if (layout.screens.isNotEmpty)
                    TextButton.icon(
                      key: const Key('editShortcuts'),
                      icon: const Icon(Icons.tune, size: 18),
                      label: Text(s.layEdit),
                      onPressed: () =>
                          open(s.layEditTitle, EditShortcutsScreen(profile: p, layout: layout)),
                    ),
                ],
              ),
            ),
            ShortcutGrid(
              label: s.shortcuts,
              items: [
                for (final e in layout.shortcuts)
                  (
                    screenKey(e.href),
                    shortLabel(s, e),
                    screenIcon(e.href, e.icon),
                    () => openFamilyScreen(context, s, p, e),
                  ),
                // every screen: the More list
                ('all', s.layAll, Icons.apps, () => open(s.more, MoreList(profile: p))),
              ],
            ),
            const SizedBox(height: Tokens.sp2),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (stale.isNotEmpty) ...[
                    const SizedBox(height: Tokens.sp4),
                    StaleLine(at: stale.first.at),
                  ],
                  for (final k in cardKeys)
                    ...switch (k) {
                      'attendance_today' => [
                        SectionTitle(s.attendanceToday),
                        // a wrap: with large text the month's line goes under the chip
                        Wrap(
                          spacing: Tokens.sp3,
                          runSpacing: Tokens.sp1,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            if (att.hasError)
                              const Text('—')
                            else if (todayCode == null)
                              StatusChip(s.notMarked, Tone.neutral)
                            else
                              StatusChip(s.attendanceCode(todayCode), attendanceTone(todayCode)),
                            if (child != null)
                              Text(
                                s.presentOf(
                                  (sum['present'] as num? ?? 0).toInt(),
                                  (sum['days'] as num? ?? 0).toInt(),
                                ),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ],
                      'classes_today' => [
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
                      ],
                      'homework_due' => [
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
                      ],
                      'next_exam' => [
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
                      ],
                      'notices' => [
                        SectionTitle(
                          s.latestNotices,
                          action: TextButton(
                            onPressed: () => open(s.notices, NoticesList(profile: p)),
                            child: Text(s.seeAll),
                          ),
                        ),
                        if (notices.value != null && notices.value!.data.isEmpty)
                          EmptyLine(s.nothingYet),
                        for (final n in notices.value?.data.take(3) ?? const <Json>[])
                          NoticeTile(profile: p, notice: n),
                      ],
                      'coming_up' => _comingUp(context, s, p, calendar, now),
                      'fees_due' => _feesDue(context, s, p, feesCard),
                      'library' => _libraryCard(context, s, p, library),
                      _ => const <Widget>[],
                    },
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

/// Home's "Coming up" card: the school's holidays and events of the next 30 days (four at most).
List<Widget> _comingUp(
  BuildContext context,
  S s,
  Profile p,
  AsyncValue<Loaded<Json>>? cal,
  DateTime now,
) {
  final today = ymd(now);
  final until = ymd(now.add(const Duration(days: 30)));
  final data = cal?.value?.data;
  final rows =
      <(String, String)>[
          for (final h in asList(data?['holidays']))
            if ('${h['kind']}' != 'working_day') ('${h['startsOn']}', '${h['name']}'),
          for (final e in asList(data?['events'])) ('${e['startsOn']}', '${e['title']}'),
        ].where((x) => x.$1.compareTo(today) >= 0 && x.$1.compareTo(until) <= 0).toList()
        ..sort((a, b) => a.$1.compareTo(b.$1));
  return [
    SectionTitle(
      s.layComingUp,
      action: TextButton(
        onPressed: () => pushPage(context, s.calendar, CalendarScreen(profile: p)),
        child: Text(s.calendar),
      ),
    ),
    if (cal != null && cal.isLoading && !cal.hasValue) const LinearProgressIndicator(),
    if (data != null && rows.isEmpty) EmptyLine(s.layNothingComing),
    if (rows.isNotEmpty)
      Card(
        key: const Key('comingUpCard'),
        child: Column(
          children: [
            for (final (day, what) in rows.take(4))
              ListTile(
                dense: true,
                leading: const Icon(Icons.event_outlined),
                title: Text(what),
                subtitle: Text(s.dayShort(day)),
              ),
          ],
        ),
      ),
  ];
}

/// Home's "Fees due" card: what is to pay now, with Fees one tap away.
List<Widget> _feesDue(BuildContext context, S s, Profile p, AsyncValue<Loaded<Json?>>? fees) {
  final data = fees?.value?.data;
  final payable = num.tryParse('${data?['payableNow']}');
  return [
    SectionTitle(
      s.layFeesDue,
      action: TextButton(
        onPressed: () => pushPage(context, s.fees, FeesScreen(profile: p)),
        child: Text(s.seeAll),
      ),
    ),
    if (fees != null && fees.isLoading && !fees.hasValue) const LinearProgressIndicator(),
    if (fees?.value != null && (payable == null || payable <= 0)) EmptyLine(s.layNothingDue),
    if (payable != null && payable > 0)
      Card(
        key: const Key('feesDueCard'),
        child: ListTile(
          leading: const Icon(Icons.account_balance_wallet_outlined),
          title: Text(s.money(payable), style: const TextStyle(fontWeight: Tokens.fwBold)),
          subtitle: Text(s.layPayNow),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => pushPage(context, s.fees, FeesScreen(profile: p)),
        ),
      ),
  ];
}

/// Home's "Library books" card: the books out now and when each is due back (three at most).
List<Widget> _libraryCard(BuildContext context, S s, Profile p, AsyncValue<Loaded<Json?>>? lib) {
  final mine = asJson(lib?.value?.data?['mine']);
  final books = asList(mine['now']);
  return [
    SectionTitle(
      s.layLibrary,
      action: TextButton(
        onPressed: () => pushPage(context, s.menu('Library'), LibraryScreen(profile: p)),
        child: Text(s.seeAll),
      ),
    ),
    if (lib != null && lib.isLoading && !lib.hasValue) const LinearProgressIndicator(),
    if (lib?.value != null && books.isEmpty) EmptyLine(s.layNoBooks),
    if (books.isNotEmpty)
      Card(
        key: const Key('libraryCard'),
        child: Column(
          children: [
            for (final b in books.take(3))
              ListTile(
                dense: true,
                leading: const Icon(Icons.local_library_outlined),
                title: Text('${b['title'] ?? ''}'),
                subtitle: Text(s.libDueOn(s.dayShort(b['dueOn']))),
                trailing: ((b['daysLate'] as num?) ?? 0) > 0
                    ? StatusChip(s.libOverdueDays((b['daysLate'] as num).toInt()), Tone.danger)
                    : null,
              ),
          ],
        ),
      ),
  ];
}
