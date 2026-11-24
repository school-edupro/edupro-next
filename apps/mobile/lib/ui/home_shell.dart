import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/theme.dart';
import '../theme/tokens.g.dart';
import '../family/teachers.dart';
import '../family/documents.dart';
import '../family/gate_pass.dart';
import '../family/directory.dart';
import '../family/hostel.dart';
import '../family/library.dart';
import '../family/transport.dart';
import '../family/health.dart';
import '../family/certificates.dart';
import '../family/consents.dart';
import '../family/academics.dart';
import '../family/appointments.dart';
import '../family/assistant.dart';
import '../family/help.dart';
import '../family/layout.dart';
import '../family/fees.dart';
import '../family/profile.dart';
import '../family/queries.dart';
import '../family/messages.dart';
import '../family/common.dart';
import '../family/data.dart' show unreadProvider;
import '../family/today.dart';
import '../staff/appointments.dart' show StaffAppointmentsScreen;
import '../staff/bus_attendance.dart' show BusAttendanceScreen;
import '../staff/activity_log.dart' show ActivityLogScreen;
import '../staff/queries.dart' show StaffQueriesScreen;
import '../staff/student_leave.dart' show StudentLeaveScreen;
import '../staff/gate_passes.dart' show StaffGatePassesScreen;
import '../staff/approvals.dart';
import '../staff/class_attendance.dart';
import '../staff/classes.dart';
import '../staff/daily_work.dart';
import '../staff/date_sheet.dart';
import '../staff/documents.dart';
import '../staff/exam_attendance.dart';
import '../staff/health.dart';
import '../staff/indicators.dart';
import '../staff/leave_page.dart';
import '../staff/lesson_plans.dart';
import '../staff/syllabus.dart';
import '../staff/verify_marks.dart';
import '../staff/marks.dart';
import '../staff/remarks.dart';
import '../staff/subject_choices.dart';
import '../staff/layout.dart' show staffFallback, staffLayoutProvider, staffTabs;
import 'brand.dart';
import 'widgets.dart';
import '../staff/timetable.dart';

/// A tab of the app's bottom bar.
class AppTab {
  const AppTab(this.icon, this.label, this.build, {this.href = ''});
  final IconData icon;
  final String label;
  final Widget Function(Profile) build;

  /// The screen it shows (`/messages` carries the unread badge).
  final String href;
}

/// A parent's or student's tabs from the school's layout (docs/design/90): Home, the three the school chose (a
/// screen, or Academics listing the layout's Academics screens), More.
List<AppTab> familyTabs(Profile p, S s, FamilyLayoutView layout) => [
  for (final t in layout.tabs)
    switch (t.href) {
      '/' => AppTab(Icons.home_outlined, s.home, (p) => TodayScreen(profile: p), href: '/'),
      'more' => AppTab(Icons.apps, s.more, (p) => MoreList(profile: p), href: 'more'),
      'academics' => AppTab(
        screenIcon('academics'),
        // the school's name for it (docs/design/94, part 3), else Academics
        tabLabel(s, t),
        (p) => AcademicsScreen(profile: p, items: layout.academics),
        href: 'academics',
      ),
      _ => AppTab(
        screenIcon(t.href, t.icon),
        shortLabel(s, t),
        (p) => nativeScreen(p, t.href, s) ?? MoreList(profile: p),
        href: t.href,
      ),
    },
];

/// A web page of the menu that has a screen in the app: More opens that instead (docs/design/89 §5.5).
Widget? nativeScreen(Profile p, String href, S s) {
  final path = href.split('?').first;
  if (p.isStaff) {
    if (path == '/exam-register') {
      // the menu's Exam attendance (`?only=attendance`) or the whole Exam register (docs/design/96 parts 17, 18)
      return ExamAttendanceScreen(profile: p, full: !href.contains('only=attendance'));
    }
    // the menu's approval pages as the app's Approvals, their kinds only — no web page (docs/design/100)
    const approvalPages = {
      '/leave-approvals': ['staff_leave', 'staff_leave_cancel'],
      '/attendance-corrections': ['staff_regularisation'],
      '/consent-approvals': ['consent'],
      '/profile/approvals': ['staff_profile'],
      '/admission-approvals': ['admission'],
      '/exit-approvals': ['exit'],
      '/no-dues': ['no_dues'],
    };
    final kinds = approvalPages[path];
    if (kinds != null) return ApprovalsScreen(profile: p, only: kinds);
    return switch (path) {
      '/attendance' => MarkClassScreen(profile: p),
      // Leave & attendance as the admin's Employee Leave / Attendance, on the menu item's tab (docs/design/99)
      '/my-attendance' => LeaveAttendanceScreen(profile: p, initialTab: 'attendance'),
      '/my-leave' => LeaveAttendanceScreen(
        profile: p,
        initialTab: href.contains('tab=team-leave') ? 'team-leave' : 'leave',
      ),
      '/my-team' => LeaveAttendanceScreen(profile: p, initialTab: 'team-attendance'),
      '/my-payslips' => PayslipsScreen(profile: p),
      // as on the staff website: the day's sheet, assignments, the report (docs/design/96)
      '/daily-work' => DailyWorkScreen(profile: p),
      // session plan, curriculum, date sheet: upload and the list, as on the staff website (docs/design/96 part 3)
      '/documents' => StaffDocumentsScreen(profile: p),
      // the session's holidays and almanac for staff, as the families' calendar shows them (docs/design/96 part 4)
      '/holidays' => CalendarScreen(profile: p),
      '/marks' => MarksHome(profile: p),
      // the sheets submitted for the person's sections: open, verify, send back (docs/design/96 part 11)
      '/verify-marks' => VerifyMarksScreen(profile: p),
      // rate the indicators, the sheet by Excel, the progress card's words and photos (docs/design/96 part 12)
      '/indicators' => IndicatorsScreen(profile: p),
      // a remark a pupil and category, the sheet by Excel (docs/design/96 part 13)
      '/remarks' => RemarksScreen(profile: p),
      // height, weight, blood group a pupil, the sheet by Excel (docs/design/96 part 14)
      '/health' => StaffHealthScreen(profile: p),
      // each student's subjects: the stream, a group's subject, the others, Opt (docs/design/96 part 15)
      '/subject-choices' => SubjectChoicesScreen(profile: p),
      // the date sheets of the teacher's classes: a row a date, a column a class (docs/design/96 part 16)
      '/date-sheet' => StaffDateSheetScreen(profile: p),
      '/timetable' => StaffTimetable(profile: p),
      // upload a lesson for approval, the lesson report, a lesson in full (docs/design/96 part 7)
      '/lesson-plans' => LessonPlansScreen(profile: p),
      // my classes and subjects with their coverage; a subject's topics to mark (docs/design/96 part 9)
      '/syllabus' => MySyllabusScreen(profile: p),
      '/messages' => MessagesScreen(profile: p),
      // student leave as on the staff website: waiting for me and all that came to me, details, approve
      '/leaves' => StudentLeaveScreen(profile: p),
      // bus attendance as on the staff website: the route and trip, mark P / A / LV / GP / OT, the register
      '/bus-attendance' => BusAttendanceScreen(profile: p),
      // gate passes as on the staff website: those waiting on me to approve, my own RGP / NRGP, apply, the card
      '/gate-passes' => StaffGatePassesScreen(profile: p),
      // queries and helpdesk as on the staff website: to answer and my own (a staff query, a ticket to the ERP
      // provider), each in full with replies, files, hand over, close, reopen, rate (student leave: /leaves)
      '/queries' => StaffQueriesScreen(profile: p, initialTab: href.contains('tab=mine') ? 1 : 0),
      // appointments with me as on the staff website: today, still to come, past, and the week calendar
      '/appointments' => StaffAppointmentsScreen(profile: p),
      // my library books as on the staff website: books now, read before, find a book, reservations, digital
      '/library' => LibraryScreen(profile: p),
      // My day (the daily activity log) as on the staff website: the day's slots, leave, draft or submit, my log
      '/activity-log' => ActivityLogScreen(profile: p),
      // the assistant for staff: own sections or the whole school, by the person's rights (docs/design/91 D)
      '/assistant' => AssistantScreen(profile: p),
      // Help for staff kept on Helpdesk set-up, as on the staff website: headings, search, the screen, helpful?
      '/help' => HelpScreen(profile: p),
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
    // a student sees their own fees, view only (no Pay: the payment right is the parent's)
    '/fees' => FeesScreen(profile: p),
    '/messages' => MessagesScreen(profile: p),
    '/notices' => NoticesList(profile: p),
    // the profile, its changes, Your data and consents: on the phone, no web page
    '/profile' => ProfileScreen(profile: p),
    // who teaches the child, with the contact the school shows: on the phone, no web page
    '/teachers' => TeachersScreen(profile: p),
    // the session plan, curriculum, date sheets, magazine and almanac the school shared: no web page
    '/documents' => DocumentsScreen(profile: p),
    // clinic visits and health cards, and the certificates (ask, follow, open): on the phone, no web page
    '/health' => HealthScreen(profile: p),
    // whom to contact at the school: no web page
    '/directory' => DirectoryScreen(profile: p),
    // the child's books, reservations, history and the catalogue: no web page
    '/library' => LibraryScreen(profile: p),
    // the child's bus: route, live position, requests and applying: no web page
    '/transport' => TransportScreen(profile: p),
    // the hostel: summary, leave and outings, visitors, mess, complaints, leaving (gate passes still on the web)
    '/hostel' => HostelScreen(profile: p),
    // gate passes: ask (leaving early, arriving late, hostel home leave and outings), follow, the pass card
    '/gate-passes' => GatePassesScreen(profile: p),
    // queries and complaints to the school, with quick feedback: no web page
    '/queries' => QueriesScreen(profile: p),
    // meeting the school: book with whom, the day and the time, follow, the gate pass card: no web page
    '/appointments' => AppointmentsScreen(profile: p),
    // consent forms: answer (the school's questions, a signature, files, the fee), change, pay, the PDF copy
    '/consents' => ConsentsScreen(profile: p),
    '/certificates' => CertificatesScreen(profile: p),
    // the family assistant (own children only, with the consent) and the help centre: no web page
    '/assistant' => AssistantScreen(profile: p),
    '/help' => HelpScreen(profile: p),
    _ => null,
  };
}

/// The signed-in app: the profile in the bar (a tap switches) and the profile's tabs.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> with WidgetsBindingObserver {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // the school of the profile in use: its logo and name on the sign-in and PIN screens from now on
    ref.listenManual(profilesProvider, (_, next) {
      final p = next.value?.current;
      if (p != null) {
        ref.read(schoolBrandProvider.notifier).remember(code: p.schoolCode, name: p.schoolName);
      }
    }, fireImmediately: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Back on the screen: the school may have published a new layout meanwhile (docs/design/90).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final p = ref.read(profilesProvider).value?.current;
    if (p != null && p.isStaff) {
      // the school may have published a new staff layout meanwhile (docs/design/94)
      ref.invalidate(staffLayoutProvider(p));
      ref.invalidate(menuProvider(p.id));
    }
    if (p != null && !p.isStaff) {
      ref.invalidate(familyLayoutProvider(p));
      // the side menu's order and names (More) may have been published too
      ref.invalidate(menuProvider(p.id));
    }
  }

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
        final tabs = p.isStaff
            // the school's staff layout (docs/design/94): Home, three chosen, More
            ? staffTabs(p, s, ref.watch(staffLayoutProvider(p)).value ?? staffFallback())
            : familyTabs(
                p,
                s,
                ref.watch(familyLayoutProvider(p)).value ?? FamilyLayoutView.fallback(p, null),
              );
        final i = _tab.clamp(0, tabs.length - 1);
        final unread = ref.watch(unreadProvider(p)).value ?? 0;
        // Ask on Home when the person's menu has the assistant (the school may hide it or switch it off)
        final asst = ref
            .watch(menuProvider(p.id))
            .value
            ?.groups
            .expand((g) => g.items)
            .where((x) => x.href.split('?').first == '/assistant')
            .firstOrNull;
        return Scaffold(
          backgroundColor: Tokens.mobNavy800,
          floatingActionButton: i == 0 && asst != null
              ? FloatingActionButton.extended(
                  key: const Key('homeAsk'),
                  tooltip: s.asstTitleOf(
                    p.isStaff ? 'teacher' : (p.kind == 'student' ? 'student' : 'parent'),
                  ),
                  icon: const Icon(Icons.forum_outlined),
                  label: Text(s.asstAsk),
                  onPressed: () => openAssistant(context, p),
                )
              : null,
          body: SafeArea(
            bottom: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ProfileBar(
                  profile: p,
                  kind: _kind(s, p),
                  canSwitch: st.all.length > 1,
                  onSwitch: () => _switch(context, st),
                ),
                Expanded(
                  // Home goes on from the band (its figures sit half over it); the other tabs are a sheet
                  child: i == 0
                      ? tabs[0].build(p)
                      : BandSheet(title: tabs[i].label, child: tabs[i].build(p)),
                ),
              ],
            ),
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: i,
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: [
              for (final t in tabs)
                NavigationDestination(
                  icon: Badge(
                    isLabelVisible: (t.href == '/messages' || t.label == s.messages) && unread > 0,
                    backgroundColor: Tokens.mobWhite,
                    textColor: Tokens.mobNavy800,
                    label: Text(unread > 99 ? '99+' : '$unread'),
                    child: Icon(t.icon),
                  ),
                  label: t.label,
                ),
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

/// The navy bar of the signed-in app: who (a tap switches profile), then approvals (staff) and settings.
class _ProfileBar extends ConsumerWidget {
  const _ProfileBar({
    required this.profile,
    required this.kind,
    required this.canSwitch,
    required this.onSwitch,
  });
  final Profile profile;
  final String kind;
  final bool canSwitch;
  final VoidCallback onSwitch;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final p = profile;
    final initials = p.name
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => w[0].toUpperCase())
        .join();
    return Padding(
      padding: const EdgeInsets.fromLTRB(Tokens.sp3, Tokens.sp2, Tokens.sp3, Tokens.sp2),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              key: const Key('profileSwitch'),
              borderRadius: BorderRadius.circular(Tokens.radiusMd),
              onTap: canSwitch ? onSwitch : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: Tokens.sp1, vertical: Tokens.sp1),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: Tokens.mobCyan600,
                      child: Text(
                        initials.isEmpty ? '?' : initials,
                        style: TextStyle(
                          color: Tokens.mobNavy800,
                          fontWeight: Tokens.fwSemibold,
                          fontFamily: Theme.of(context).textTheme.titleLarge?.fontFamily,
                        ),
                      ),
                    ),
                    const SizedBox(width: Tokens.sp3),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p.name,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(color: Tokens.mobWhite, fontWeight: Tokens.fwSemibold),
                          ),
                          Text(
                            '$kind · ${p.schoolName}',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Tokens.mobNavy100, fontSize: 14),
                          ),
                        ],
                      ),
                    ),
                    if (canSwitch)
                      Semantics(
                        label: s.profiles,
                        child: const Icon(Icons.expand_more, color: Tokens.mobWhite),
                      ),
                  ],
                ),
              ),
            ),
          ),
          if (p.isStaff) ...[const SizedBox(width: Tokens.sp2), ApprovalsButton(profile: p)],
          const SizedBox(width: Tokens.sp2),
          BandIconButton(
            icon: Icons.settings_outlined,
            tooltip: s.settings,
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
    );
  }
}

/// Every screen of the profile's menu; one without a native screen opens its web page inside the app.
class MoreList extends ConsumerWidget {
  const MoreList({super.key, required this.profile});
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
                  s.hindi && g.labelHi != null ? g.labelHi! : s.menu(g.label),
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
                  // the assistant opens over the app as the chat window (docs/design/92)
                  if (i.href.split('?').first == '/assistant') {
                    openAssistant(context, profile);
                    return;
                  }
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
