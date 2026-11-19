import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'attendance.dart';
import 'common.dart';
import 'data.dart';
import 'date_sheet.dart';
import 'fees.dart';
import 'homework.dart';
import 'messages.dart';

/// Home for a parent's child or a student (docs/design/89 §5.2): the day's figures first — attendance this month,
/// homework due, fees to pay (a student: the next exam), unread messages — then today's attendance, the homework
/// due today and tomorrow, the next exam and the latest notices. Each part loads on its own; one failing leaves the
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

    return RefreshIndicator(
      onRefresh: () {
        ref.invalidate(attendanceProvider((p, ym(now))));
        ref.invalidate(dateSheetProvider(p));
        ref.invalidate(noticesProvider(p));
        ref.invalidate(unreadProvider(p));
        if (p.kind == 'parent') ref.invalidate(feesProvider(p));
        return ref.refresh(homeworkProvider(workRange(p)).future);
      },
      child: ListView(
        key: const Key('today'),
        padding: const EdgeInsets.all(Tokens.sp4),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
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
                key: const Key('figAttendance'),
                label: s.thisMonth,
                value: fig(
                  att,
                  (_) => child == null ? '—' : '${sum['present'] ?? 0}/${sum['days'] ?? 0}',
                ),
                icon: Icons.fact_check_outlined,
                onTap: () => pushPage(context, s.attendance, AttendanceScreen(profile: p)),
              ),
              FigureTile(
                key: const Key('figHomework'),
                label: s.homeworkDue,
                value: fig(work, (_) => '${due!.length}'),
                icon: Icons.menu_book_outlined,
                onTap: () => pushPage(context, s.homework, HomeworkScreen(profile: p)),
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
                  onTap: () => pushPage(context, s.fees, FeesScreen(profile: p)),
                )
              else
                FigureTile(
                  key: const Key('figExam'),
                  label: s.nextExam,
                  value: fig(exams, (_) => next == null ? '—' : s.dayShort(next['examOn'])),
                  icon: Icons.edit_calendar_outlined,
                  onTap: () => pushPage(context, s.dateSheet, DateSheetScreen(profile: p)),
                ),
              FigureTile(
                key: const Key('figUnread'),
                label: s.unreadMessages,
                value: fig(unread, (n) => '$n'),
                icon: Icons.chat_bubble_outline,
                onTap: () => pushPage(context, s.messages, MessagesScreen(profile: p)),
              ),
            ],
          ),
          SectionTitle(s.attendanceToday),
          Row(
            children: [
              if (att.hasError)
                Text('—')
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
          SectionTitle(s.homeworkDue),
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
                onTap: () => pushPage(context, s.dateSheet, DateSheetScreen(profile: p)),
              ),
            ),
          SectionTitle(
            s.latestNotices,
            action: TextButton(
              onPressed: () => pushPage(context, s.notices, NoticesList(profile: p)),
              child: Text(s.seeAll),
            ),
          ),
          if (notices.value != null && notices.value!.data.isEmpty) EmptyLine(s.nothingYet),
          for (final n in notices.value?.data.take(3) ?? const <Json>[])
            NoticeTile(profile: p, notice: n),
        ],
      ),
    );
  }
}
