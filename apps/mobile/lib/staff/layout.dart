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
import 'classes.dart';
import 'my_day.dart';

/// The app's Classes tab (my sections: homework, marks) in the school's staff layout (docs/design/94).
const classesTab = 'classes';

/// The staff app as it was before the school arranged it (no layout has come yet, offline the first time).
FamilyLayoutView staffFallback() => const FamilyLayoutView(
  tabs: [
    FamilyEntry('/', 'Home', 'home'),
    FamilyEntry('/attendance', 'Attendance', 'check'),
    FamilyEntry(classesTab, 'Classes', 'book'),
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

/// A staff member's tabs from the school's layout: Home, the three the school chose (a screen, or Classes), More.
List<AppTab> staffTabs(Profile p, S s, FamilyLayoutView layout) => [
  for (final t in layout.tabs)
    switch (t.href) {
      '/' => AppTab(Icons.home_outlined, s.home, (p) => MyDayScreen(profile: p), href: '/'),
      'more' => AppTab(Icons.apps, s.more, (p) => MoreList(profile: p), href: 'more'),
      classesTab => AppTab(
        Icons.class_outlined,
        s.classes,
        (p) => ClassesTab(profile: p),
        href: classesTab,
      ),
      // the Attendance tab: mark a class, my attendance, my leave (as the app had it)
      '/attendance' => AppTab(
        Icons.fact_check_outlined,
        s.attendance,
        (p) => StaffAttendanceTab(profile: p),
        href: '/attendance',
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
