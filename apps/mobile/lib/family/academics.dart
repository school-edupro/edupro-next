import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import 'attendance.dart';
import 'calendar.dart';
import 'common.dart';
import 'date_sheet.dart';
import 'homework.dart';
import 'results.dart';
import 'timetable.dart';

export 'attendance.dart' show AttendanceScreen;
export 'calendar.dart' show CalendarScreen;
export 'date_sheet.dart' show DateSheetScreen;
export 'homework.dart' show HomeworkScreen;
export 'results.dart' show ResultsScreen;
export 'timetable.dart' show TimetableScreen;

/// A parent's Academics tab: the child's school day screens, one tap each.
class AcademicsScreen extends ConsumerWidget {
  const AcademicsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final items = <(String, IconData, Widget)>[
      (s.attendance, Icons.fact_check_outlined, AttendanceScreen(profile: profile)),
      (s.homework, Icons.menu_book_outlined, HomeworkScreen(profile: profile)),
      (s.timetable, Icons.view_week_outlined, TimetableScreen(profile: profile)),
      (s.dateSheet, Icons.edit_calendar_outlined, DateSheetScreen(profile: profile)),
      (s.results, Icons.insert_chart_outlined, ResultsScreen(profile: profile)),
      (s.calendar, Icons.calendar_month_outlined, CalendarScreen(profile: profile)),
    ];
    return ListView(
      key: const Key('academicsList'),
      children: [
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
