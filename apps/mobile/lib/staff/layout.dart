import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../family/assistant.dart' show openAssistant;
import '../family/common.dart';
import '../family/data.dart';
import '../family/layout.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/home_shell.dart' show AppTab, MoreList, nativeScreen;
import '../ui/outbox_view.dart';
import 'my_day.dart';

/// The standard list tabs (docs/design/94, part 3): the app's Attendance and Classes tabs as they were.
const attendanceList = 'attendance';
const classesTab = 'classes';

/// The two standard lists (the app as it was; a layout from before the lists).
const standardStaffLists = [
  LayoutList(attendanceList, 'Attendance', 'उपस्थिति', 'check', [
    FamilyEntry('/attendance', 'Attendance', 'check'),
    FamilyEntry('/my-attendance', 'My attendance', 'clock'),
    FamilyEntry('/my-leave', 'My leave', 'calendar'),
  ]),
  LayoutList(classesTab, 'Classes', 'कक्षाएँ', 'book', [
    FamilyEntry('/daily-work', 'Daily work', 'book'),
    FamilyEntry('/marks', 'Marks', 'clipboard'),
    FamilyEntry('/timetable', 'Timetable', 'calendar'),
    FamilyEntry('/my-payslips', 'My payslips', 'wallet'),
  ]),
];

/// The staff app as it was before the school arranged it (no layout has come yet, offline the first time).
FamilyLayoutView staffFallback() => const FamilyLayoutView(
  tabs: [
    FamilyEntry('/', 'Home', 'home'),
    FamilyEntry(attendanceList, 'Attendance', 'check', 'उपस्थिति'),
    FamilyEntry(classesTab, 'Classes', 'book', 'कक्षाएँ'),
    FamilyEntry('/messages', 'Messages', 'message'),
    FamilyEntry('more', 'More', 'grid'),
  ],
  shortcuts: [
    FamilyEntry('/attendance', 'Attendance', 'check'),
    FamilyEntry('/daily-work', 'Daily work', 'book'),
    FamilyEntry('/timetable', 'Timetable', 'calendar'),
    FamilyEntry('/my-leave', 'My leave', 'calendar'),
    FamilyEntry('/my-attendance', 'My attendance', 'clock'),
    FamilyEntry('/messages', 'Messages', 'message'),
  ],
  ownShortcuts: false,
  cards: [
    FamilyCardEntry('to_mark', 'Classes to mark', 'उपस्थिति लगानी है'),
    FamilyCardEntry('periods_today', "Today's periods", 'आज के पीरियड'),
    FamilyCardEntry('marks_to_enter', 'Marks to enter', 'अंक भरने हैं'),
    FamilyCardEntry('approvals', 'Approvals waiting', 'प्रतीक्षारत स्वीकृतियाँ'),
  ],
  academics: [],
  screens: [],
  lists: standardStaffLists,
);

/// The staff layout of a profile (`GET me/staff-layout`), kept for offline use; the app as it was when none has
/// come (or the call fails with no copy kept).
final staffLayoutProvider = FutureProvider.family<FamilyLayoutView, Profile>((ref, p) async {
  try {
    final r = await cached('staff-layout:${p.id}', () => ref.read(apiProvider).staffLayoutMine());
    final v = FamilyLayoutView.fromJson(asJson(r.data));
    if (v.tabs.length >= 2) return v;
  } catch (_) {
    // no layout and no copy: the app as it was
  }
  return staffFallback();
});

/// A list tab of the layout by its key; a layout kept from before the lists has the two standard ones.
LayoutList? staffList(FamilyLayoutView layout, String key) {
  for (final l in [...layout.lists, ...standardStaffLists]) {
    if (l.key == key) return l;
  }
  return null;
}

/// A staff member's tabs from the school's layout: Home, the three the school chose (a screen, or a list tab with the
/// school's name and screens — docs/design/94, part 3), More.
List<AppTab> staffTabs(Profile p, S s, FamilyLayoutView layout) => [
  for (final t in layout.tabs)
    switch (t.href) {
      '/' => AppTab(Icons.home_outlined, s.home, (p) => MyDayScreen(profile: p), href: '/'),
      'more' => AppTab(Icons.apps, s.more, (p) => MoreList(profile: p), href: 'more'),
      final key when !key.startsWith('/') => AppTab(
        switch (key) {
          attendanceList => Icons.fact_check_outlined,
          classesTab => Icons.class_outlined,
          _ => screenIcon(staffList(layout, key)?.items.firstOrNull?.href ?? key, t.icon),
        },
        tabLabel(s, t),
        (p) {
          final list = staffList(layout, key);
          return list == null ? MoreList(profile: p) : StaffListTab(profile: p, list: list);
        },
        href: key,
      ),
      _ => AppTab(
        screenIcon(t.href, t.icon),
        shortLabel(s, t),
        (p) => nativeScreen(p, t.href, s) ?? WebScreenTab(profile: p, entry: t),
        href: t.href,
      ),
    },
];

/// Opens a staff screen of the layout: the app's own when it has one, else the staff website's page in the app.
void openStaffScreen(BuildContext context, S s, Profile p, FamilyEntry e) {
  if (e.href.split('?').first == '/assistant') {
    openAssistant(context, p);
    return;
  }
  final screen = nativeScreen(p, e.href, s);
  if (screen != null) {
    pushPage(context, shortLabel(s, e), screen);
    return;
  }
  context.push(
    Uri(
      path: '/web',
      queryParameters: {'app': 'teacher', 'to': e.href, 'title': shortLabel(s, e)},
    ).toString(),
  );
}

/// A screen's name in a list tab: the words the app's own tabs always used for its screens, else the menu's.
String staffListLabel(S s, FamilyEntry e) => switch (e.href) {
  '/attendance' => s.markClass,
  '/daily-work' => s.dailyWork,
  '/marks' => s.marksEntry,
  '/timetable' => s.myTimetable,
  '/my-payslips' => s.payslips,
  '/my-attendance' => s.myAttendance,
  '/my-leave' => s.myLeave,
  // the staff menu's own name (the families' short "Date sheet" is theirs)
  '/date-sheet' => s.menu(e.label),
  _ => shortLabel(s, e),
};

/// A list tab (docs/design/94, part 3): the screens the school put in it that the person can open, in its order; the
/// app's own screen where it has one, else the staff website's page in the app. With Mark a class in it, the offline
/// marks waiting to be sent show on top (as the Attendance tab had them).
class StaffListTab extends ConsumerWidget {
  const StaffListTab({super.key, required this.profile, required this.list});
  final Profile profile;
  final LayoutList list;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return ListView(
      key: Key('listTab-${list.key}'),
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
      children: [
        if (list.items.any((e) => e.href == '/attendance'))
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: Tokens.sp4),
            child: OutboxBanner(),
          ),
        for (final e in list.items)
          ListTile(
            key: Key('list-${list.key}-${screenKey(e.href)}'),
            leading: Icon(screenIcon(e.href, e.icon)),
            title: Text(staffListLabel(s, e)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              final screen = nativeScreen(profile, e.href, s);
              if (screen != null) {
                pushPage(context, staffListLabel(s, e), screen);
              } else {
                openStaffScreen(context, s, profile, e);
              }
            },
          ),
      ],
    );
  }
}

/// A tab the school chose that has only a web page: what it is and a button that opens it in the app.
class WebScreenTab extends ConsumerWidget {
  const WebScreenTab({super.key, required this.profile, required this.entry});
  final Profile profile;
  final FamilyEntry entry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(screenIcon(entry.href, entry.icon), size: 32),
                const SizedBox(height: Tokens.sp2),
                Text(
                  shortLabel(s, entry),
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: Tokens.fwSemibold),
                ),
                const SizedBox(height: Tokens.sp3),
                FilledButton.icon(
                  key: Key('openWeb-${screenKey(entry.href)}'),
                  icon: const Icon(Icons.open_in_new),
                  label: Text(s.layOpenScreen(shortLabel(s, entry))),
                  onPressed: () => openStaffScreen(context, s, profile, entry),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
