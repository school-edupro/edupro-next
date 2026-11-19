import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/theme.dart';
import '../theme/tokens.g.dart';
import '../family/academics.dart';
import '../family/fees.dart';
import '../family/messages.dart';
import '../family/common.dart';
import '../family/today.dart';
import '../staff/approvals.dart';
import '../staff/class_attendance.dart';
import '../staff/classes.dart';
import '../staff/marks.dart';
import '../staff/my_attendance.dart';
import '../staff/my_day.dart';
import '../staff/my_leave.dart';
import 'widgets.dart';

/// A tab of the app's bottom bar.
class AppTab {
  const AppTab(this.icon, this.label, this.build);
  final IconData icon;
  final String label;
  final Widget Function(Profile) build;
}

/// The tabs of a profile (docs/design/89 §5.2): a parent's Home, Academics, Fees, Messages, More; a student's Home,
/// Homework, Timetable, Results, More; staff (phase C) Home and More.
List<AppTab> tabsFor(Profile p, S s) => switch (p.kind) {
  'parent' => [
    AppTab(Icons.home_outlined, s.home, (p) => TodayScreen(profile: p)),
    AppTab(Icons.menu_book_outlined, s.academics, (p) => AcademicsScreen(profile: p)),
    AppTab(Icons.account_balance_wallet_outlined, s.fees, (p) => FeesScreen(profile: p)),
    AppTab(Icons.chat_bubble_outline, s.messages, (p) => MessagesScreen(profile: p)),
    AppTab(Icons.apps, s.more, (p) => _More(profile: p)),
  ],
  'student' => [
    AppTab(Icons.home_outlined, s.home, (p) => TodayScreen(profile: p)),
    AppTab(Icons.menu_book_outlined, s.homework, (p) => HomeworkScreen(profile: p)),
    AppTab(Icons.calendar_month_outlined, s.timetable, (p) => TimetableScreen(profile: p)),
    AppTab(Icons.insert_chart_outlined, s.results, (p) => ResultsScreen(profile: p)),
    AppTab(Icons.apps, s.more, (p) => _More(profile: p)),
  ],
  _ => [
    AppTab(Icons.today_outlined, s.myDay, (p) => MyDayScreen(profile: p)),
    AppTab(Icons.fact_check_outlined, s.attendance, (p) => StaffAttendanceTab(profile: p)),
    AppTab(Icons.class_outlined, s.classes, (p) => ClassesTab(profile: p)),
    AppTab(Icons.chat_bubble_outline, s.messages, (p) => MessagesScreen(profile: p)),
    AppTab(Icons.apps, s.more, (p) => _More(profile: p)),
  ],
};

/// A web page of the menu that has a screen in the app: More opens that instead (docs/design/89 §5.5).
Widget? nativeScreen(Profile p, String href, S s) {
  final path = href.split('?').first;
  if (p.isStaff) {
    return switch (path) {
      '/attendance' => MarkClassScreen(profile: p),
      '/my-attendance' => MyAttendanceScreen(profile: p),
      '/my-leave' => MyLeaveScreen(profile: p),
      '/my-payslips' => PayslipsScreen(profile: p),
      '/daily-work' => PostWorkScreen(profile: p),
      '/marks' => MarksHome(profile: p),
      '/timetable' => StaffTimetable(profile: p),
      '/messages' => MessagesScreen(profile: p),
      _ => null,
    };
  }
  return switch (path) {
    '/attendance' => AttendanceScreen(profile: p),
    '/homework' => HomeworkScreen(profile: p),
    '/timetable' => TimetableScreen(profile: p),
    '/calendar' => CalendarScreen(profile: p),
    '/date-sheet' => DateSheetScreen(profile: p),
    '/results' => ResultsScreen(profile: p),
    '/fees' when p.kind == 'parent' => FeesScreen(profile: p),
    '/messages' => MessagesScreen(profile: p),
    '/notices' => NoticesList(profile: p),
    _ => null,
  };
}

/// The signed-in app: the profile in the bar (a tap switches) and the profile's tabs.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final profiles = ref.watch(profilesProvider);
    return AsyncBody<ProfilesState>(
      value: profiles,
      retry: () => ref.invalidate(profilesProvider),
      data: (st) {
        final p = st.current;
        if (p == null) {
          return Scaffold(
            appBar: AppBar(title: Text(s.appName)),
            body: Padding(padding: const EdgeInsets.all(Tokens.sp5), child: Text(s.noProfiles)),
          );
        }
        final tabs = tabsFor(p, s);
        return Scaffold(
          appBar: AppBar(
            titleSpacing: Tokens.sp3,
            title: InkWell(
              key: const Key('profileSwitch'),
              onTap: st.all.length > 1 ? () => _switch(context, st) : null,
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: Tokens.mobCyan600,
                    child: Text(
                      p.name.isEmpty ? '?' : p.name[0].toUpperCase(),
                      style: const TextStyle(color: Tokens.mobWhite),
                    ),
                  ),
                  const SizedBox(width: Tokens.sp3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.name, overflow: TextOverflow.ellipsis),
                        Text(
                          '${_kind(s, p)} · ${p.schoolName}',
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: Tokens.mobNavy100),
                        ),
                      ],
                    ),
                  ),
                  if (st.all.length > 1)
                    Semantics(label: s.profiles, child: const Icon(Icons.expand_more)),
                ],
              ),
            ),
            actions: [
              if (p.isStaff) ApprovalsButton(profile: p),
              IconButton(
                tooltip: s.settings,
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => context.push('/settings'),
              ),
            ],
          ),
          body: tabs[_tab.clamp(0, tabs.length - 1)].build(p),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tab.clamp(0, tabs.length - 1),
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: [
              for (final t in tabs) NavigationDestination(icon: Icon(t.icon), label: t.label),
            ],
          ),
        );
      },
    );
  }

  static String _kind(S s, Profile p) => switch (p.kind) {
    'staff' => s.kindStaff,
    'student' => s.kindStudent,
    _ => s.kindParent,
  };

  Future<void> _switch(BuildContext context, ProfilesState st) async {
    final s = ref.read(stringsProvider);
    final chosen = await showModalBottomSheet<Profile>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(s.profiles, style: Theme.of(context).textTheme.titleMedium)),
            for (final p in st.all)
              ListTile(
                key: Key('profile-${p.id}'),
                leading: Icon(p.isStaff ? Icons.badge_outlined : Icons.family_restroom),
                title: Text(p.name),
                subtitle: Text(
                  [_kind(s, p), p.detail, p.schoolName].whereType<String>().join(' · '),
                ),
                selected: p.id == st.current?.id,
                onTap: () => Navigator.of(context).pop(p),
              ),
          ],
        ),
      ),
    );
    if (chosen != null) {
      await ref.read(profilesProvider.notifier).choose(chosen);
      setState(() => _tab = 0);
    }
  }
}

/// Every screen of the profile's menu; one without a native screen opens its web page inside the app.
class _More extends ConsumerWidget {
  const _More({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final menu = ref.watch(menuProvider(profile.id));
    return AsyncBody<ProfileMenu>(
      value: menu,
      retry: () => ref.invalidate(menuProvider(profile.id)),
      data: (m) => ListView(
        key: const Key('moreList'),
        children: [
          for (final g in m.groups) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp4, Tokens.sp4, Tokens.sp1),
              child: Semantics(
                header: true,
                child: Text(
                  s.menu(g.label),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: Tokens.fwSemibold,
                  ),
                ),
              ),
            ),
            for (final i in g.items)
              ListTile(
                leading: Icon(menuIcon(i.icon)),
                title: Text(s.menu(i.label)),
                subtitle: i.help == null ? null : Text(s.menu(i.help!)),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  final native = nativeScreen(profile, i.href, s);
                  if (native != null) {
                    pushPage(context, s.menu(i.label), native);
                    return;
                  }
                  context.push(
                    Uri(
                      path: '/web',
                      queryParameters: {'app': m.app, 'to': i.href, 'title': s.menu(i.label)},
                    ).toString(),
                  );
                },
              ),
          ],
        ],
      ),
    );
  }
}
