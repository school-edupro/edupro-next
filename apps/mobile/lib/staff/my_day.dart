import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../family/common.dart';
import '../family/data.dart' show Loaded, inboxProvider;
import '../family/layout.dart';
import '../family/messages.dart' show MessagesScreen;
import '../family/today.dart' show ClassesCard;
import 'layout.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/home_shell.dart' show MoreList;
import '../ui/outbox_view.dart';
import 'approvals.dart';
import 'class_attendance.dart';
import 'data.dart';
import 'marks.dart';
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

/// The words of the staff Home's cards (docs/design/94), in English and Hindi.
extension StaffHomeWords on S {
  String _h(String en, String hi) => hindi ? hi : en;

  String get nothingWaitingForYou =>
      _h('Nothing is waiting for your decision.', 'आपके निर्णय के लिए कुछ प्रतीक्षा में नहीं है।');
  String get latestMessages => _h('Latest messages', 'नवीनतम संदेश');
  String get noMessages => _h('No messages yet.', 'अभी कोई संदेश नहीं।');
  String get openMyLeave => _h('Open My leave', 'मेरा अवकाश खोलें');
}

/// A staff member's Home (docs/design/94, look B as the students'): the navy band with the date and "Good morning"
/// with the first name, the figures card half over it — periods today, classes to mark, marks to enter, approvals waiting —
/// then the Shortcuts (the school's or the person's own, with All and Edit) and the work cards in the school's order:
/// classes to mark (Mark now), today's periods, marks to enter, approvals waiting, my leave, latest messages. Each
/// part loads on its own. Today's rolls are fetched here too, so they can be marked later with no network.
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

    final now = DateTime.now();
    // the school's staff layout (docs/design/94): the shortcuts (or the person's own) and the cards in its order
    final layout = ref.watch(staffLayoutProvider(p)).value ?? staffFallback();
    final cardKeys = [for (final c in layout.cards) c.key];
    final first = p.name.split(RegExp(r'\s+')).first;
    final leave = cardKeys.contains('my_leave') ? ref.watch(myLeaveProvider(p)) : null;
    final inbox = cardKeys.contains('notices') ? ref.watch(inboxProvider((p, 1))) : null;
    void open(String title, Widget screen) => pushPage(context, title, screen);
    final rows = [
      for (final x in periods ?? const <Json>[])
        {
          'startsAt': asJson(x['period'])['startsAt'],
          'endsAt': asJson(x['period'])['endsAt'],
          'title': [
            if (x['classCode'] != null) '${x['classCode']}-${x['section']}' else x['section'],
            x['subjectName'] ?? x['subject'],
          ].whereType<Object>().join(' · '),
          'subtitle': [
            if (x['substitute'] == true) s.substitution('${x['absentTeacher']}'),
            if (x['room'] != null) '${x['room']}',
          ].join(' · '),
          'substitute': x['substitute'] == true,
        },
    ].map((r) => {...r, if (r['subtitle'] == '') 'subtitle': null}).toList();

    return RefreshIndicator(
      onRefresh: () {
        ref.invalidate(myWeekProvider(p));
        ref.invalidate(assignmentsProvider(p));
        ref.invalidate(toEnterProvider(p));
        ref.invalidate(approvalsProvider(p));
        ref.invalidate(staffLayoutProvider(p));
        if (leave != null) ref.invalidate(myLeaveProvider(p));
        if (inbox != null) ref.invalidate(inboxProvider((p, 1)));
        _warmed = false;
        return ref.refresh(daySummaryProvider((p, day)).future);
      },
      child: Material(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: ListView(
          key: const Key('myDay'),
          padding: const EdgeInsets.only(bottom: Tokens.sp6),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            HomeBand(
              date: s.dayLong(now),
              heading: '${s.greeting(now)}, $first',
              detail: p.detail,
              figures: FigureGrid(
                raised: true,
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
                    () => openStaffScreen(context, s, p, e),
                  ),
                // every screen: the More list
                ('all', s.layAll, Icons.apps, () => open(s.more, MoreList(profile: p))),
              ],
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: Tokens.sp2),
                  const OutboxBanner(),
                  if (stale.isNotEmpty) ...[
                    const SizedBox(height: Tokens.sp3),
                    StaleLine(at: stale.first.at),
                  ],
                  for (final k in cardKeys)
                    ...switch (k) {
                      'to_mark' => [
                        SectionTitle(s.toMark),
                        if (toMark == null && !(assignments.hasError || summary.hasError))
                          const LinearProgressIndicator(),
                        if (toMark != null && toMark.isEmpty) EmptyLine(s.allMarked),
                        for (final x in toMark ?? const <Json>[]) ...[
                          _ToMarkCard(
                            key: Key('toMark-${x['classSectionId']}'),
                            section: '${x['section']}',
                            onOpen: () => open(
                              s.markClass,
                              MarkClassScreen(profile: p, sectionId: '${x['classSectionId']}'),
                            ),
                          ),
                          const SizedBox(height: Tokens.sp3),
                        ],
                      ],
                      'periods_today' => [
                        SectionTitle(s.todaysPeriods),
                        if (periods == null && !week.hasError) const LinearProgressIndicator(),
                        if (periods != null && periods.isEmpty) EmptyLine(s.noPeriods),
                        if (rows.isNotEmpty) ClassesCard(rows: rows, now: now),
                      ],
                      'marks_to_enter' => [
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
                              onTap: () => open(s.marksEntry, MarksHome(profile: p)),
                            ),
                          ),
                      ],
                      'approvals' => _approvalsCard(context, s, approvals),
                      'my_leave' => _leaveCard(context, s, leave),
                      'notices' => _messagesCard(context, s, inbox),
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

extension on _MyDayScreenState {
  void _open(BuildContext context, String title, Widget screen) => pushPage(context, title, screen);

  /// Approvals waiting: the first three, and See all (the approvals inbox).
  List<Widget> _approvalsCard(BuildContext context, S s, AsyncValue<Loaded<Json>> v) {
    final p = widget.profile;
    final box = v.value?.data;
    final items = asList(box?['items']);
    return [
      SectionTitle(s.approvals),
      if (box == null && !v.hasError) const LinearProgressIndicator(),
      if (box != null && items.isEmpty) EmptyLine(s.nothingWaitingForYou),
      for (final i in items.take(3))
        Card(
          child: ListTile(
            key: Key('homeApproval-${i['kind']}-${i['id']}'),
            leading: const Icon(Icons.fact_check_outlined),
            title: Text('${i['title']}', maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: i['detail'] == null ? null : Text('${i['detail']}', maxLines: 2),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _open(context, s.approvals, ApprovalsScreen(profile: p)),
          ),
        ),
      if (items.length > 3)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            key: const Key('homeApprovalsAll'),
            onPressed: () => _open(context, s.approvals, ApprovalsScreen(profile: p)),
            child: Text(s.seeAll),
          ),
        ),
    ];
  }

  /// My leave: the balances, and Open My leave.
  List<Widget> _leaveCard(BuildContext context, S s, AsyncValue<Loaded<Json>>? v) {
    final p = widget.profile;
    final m = v?.value?.data;
    final balances = asList(m?['balances']);
    return [
      SectionTitle(s.myLeave),
      if (m == null && !(v?.hasError ?? false)) const LinearProgressIndicator(),
      if (m != null && balances.isEmpty) EmptyLine(s.nothingYet),
      if (balances.isNotEmpty)
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final b in balances)
              Chip(label: Text('${b['name']}: ${s.available('${b['available']}')}')),
          ],
        ),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          key: const Key('homeOpenLeave'),
          onPressed: () => _open(context, s.myLeave, MyLeaveScreen(profile: p)),
          child: Text(s.openMyLeave),
        ),
      ),
    ];
  }

  /// Latest messages: the newest three, and See all.
  List<Widget> _messagesCard(BuildContext context, S s, AsyncValue<Loaded<Json>>? v) {
    final p = widget.profile;
    final inbox = v?.value?.data;
    final items = asList(inbox?['data']);
    return [
      SectionTitle(s.latestMessages),
      if (inbox == null && !(v?.hasError ?? false)) const LinearProgressIndicator(),
      if (inbox != null && items.isEmpty) EmptyLine(s.noMessages),
      for (final m in items.take(3))
        Card(
          child: ListTile(
            key: Key('homeMessage-${m['id']}'),
            leading: Icon(
              m['unread'] == true ? Icons.mark_email_unread_outlined : Icons.mail_outline,
            ),
            title: Text(
              '${m['title'] ?? m['subject'] ?? ''}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: m['unread'] == true ? const TextStyle(fontWeight: Tokens.fwBold) : null,
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _open(context, s.messages, MessagesScreen(profile: p)),
          ),
        ),
      if (items.isNotEmpty)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            key: const Key('homeMessagesAll'),
            onPressed: () => _open(context, s.messages, MessagesScreen(profile: p)),
            child: Text(s.seeAll),
          ),
        ),
    ];
  }
}

/// A class whose day attendance is not marked yet: a tinted card with "Mark now".
class _ToMarkCard extends ConsumerWidget {
  const _ToMarkCard({super.key, required this.section, required this.onOpen});
  final String section;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final big = MediaQuery.textScalerOf(context).scale(10) > 13;
    final words = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(section, style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 16)),
        Text(s.notMarkedToday, style: const TextStyle(fontSize: 14)),
      ],
    );
    final button = FilledButton(
      onPressed: onOpen,
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 44),
        padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4),
      ),
      child: Text(s.markNow),
    );
    return Material(
      color: dark ? Tokens.mobNavy700 : Tokens.statusInfoBg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radiusLg),
        side: BorderSide(color: dark ? Tokens.mobNavy600 : Tokens.mobCyan100),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(Tokens.radiusLg),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Tokens.sp4, 14, Tokens.sp3, 14),
          // large text: the button goes under the words (beside them it leaves the words no room)
          child: Flex(
            direction: big ? Axis.vertical : Axis.horizontal,
            crossAxisAlignment: big ? CrossAxisAlignment.start : CrossAxisAlignment.center,
            children: [
              if (big) words else Expanded(child: words),
              const SizedBox(width: Tokens.sp2, height: Tokens.sp2),
              button,
            ],
          ),
        ),
      ),
    );
  }
}
