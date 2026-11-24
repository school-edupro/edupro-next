// The staff app's My day (the daily activity log) and My library books, native as on the staff website (no web
// page). Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/library.dart' show LibraryScreen;
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/activity_log.dart';
import 'package:edupro/theme/theme.dart';
import 'package:edupro/ui/home_shell.dart' show nativeScreen;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

const staff = Profile(
  id: 'staff:7',
  kind: 'staff',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Asha Teacher',
  app: 'teacher',
);

class School {
  School({this.state = 'draft', this.editable = true, this.leave});
  final String? state;
  final bool editable;
  final Map<String, Object?>? leave;
  final saved = <Map<String, Object?>>[];
  final asked = <String?>[];

  Object? answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /staff/activity/mine':
        final date = c.query?['date'] as String?;
        asked.add(date);
        return {
          'employee': {'id': '36', 'name': 'Asha Teacher'},
          'log': {
            'id': state == null ? null : '9',
            'date': date ?? '2026-11-24',
            'state': state,
            'tomorrowPlan': null,
            'pendingNote': state == 'submitted' ? 'Mark the quiz' : null,
            'submittedAt': null,
            'late': false,
            'reviewNote': state == 'returned' ? 'Add the afternoon' : null,
            'reviewedBy': state == 'returned' ? 'Ravi Head' : null,
            'leave': leave,
            'editedAt': null,
            'entries': state == 'submitted'
                ? [
                    {
                      'from': '09:00',
                      'to': '09:40',
                      'categoryId': '24',
                      'category': 'Teaching',
                      'description': 'VI-A Maths',
                      'source': 'timetable',
                    },
                  ]
                : <Object>[],
            'minutes': state == 'submitted' ? 40 : 0,
          },
          'suggested': [
            {
              'from': '10:30',
              'to': '11:10',
              'description': 'VI-A · Science (Period 4)',
              'source': 'timetable',
              'categoryId': '24',
            },
          ],
          'categories': [
            {'id': '24', 'name': 'Teaching'},
            {'id': '25', 'name': 'Substitution period'},
          ],
          'cutoffTime': '18:00',
          'backDays': 8,
          'editable': editable,
          'leaveTypes': ['Casual leave', 'Sick leave'],
          'recent': [
            {'date': '2026-11-24', 'state': state, 'late': false},
            {'date': '2026-11-23', 'state': 'submitted', 'late': true},
          ],
        };
      case 'PUT /staff/activity/mine':
        saved.add(c.body!);
        return {'ok': true};
      case 'GET /staff/activity/mine/report':
        return {
          'filename': 'my-log.pdf',
          'contentType': 'application/pdf',
          'base64': 'JVBERi0xLjQK',
        };
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<(FakeTransport, School)> pump(
  WidgetTester tester, {
  School? school,
  bool hindi = false,
  bool dark = false,
  double text = 1,
  Size size = const Size(420, 2600),
}) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final sc = school ?? School();
  final t = FakeTransport(sc.answer);
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [transportProvider.overrideWithValue(t)],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        builder: (context, w) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(text)),
          child: w!,
        ),
        home: const FamilyPage(
          title: 'My day',
          child: ActivityLogScreen(profile: staff),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (t, sc);
}

Future<void> tapIn(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  final s = S(false);

  test('the staff menu opens My day and My library books natively (no web page)', () {
    expect(nativeScreen(staff, '/activity-log', s), isA<ActivityLogScreen>());
    expect(nativeScreen(staff, '/library', s), isA<LibraryScreen>());
  });

  testWidgets('a new day starts from the timetable; a half-filled row is named; draft and submit', (
    tester,
  ) async {
    final (_, school) = await pump(tester);
    expect(find.text(s.alFromTimetable), findsOneWidget);
    expect(find.textContaining(s.alState('draft')), findsWidgets);
    // the timetable row, and one empty row to fill
    expect(find.text('VI-A · Science (Period 4)'), findsOneWidget);
    expect(find.byKey(const Key('alWhat-1')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('alWhat-1')), 'Staff meeting');
    await tapIn(tester, find.byKey(const Key('alDraft')));
    expect(find.text(s.alRowProblem(2)), findsOneWidget);
    expect(school.saved, isEmpty);
    // the empty row goes; the draft is saved with the timetable row
    await tapIn(tester, find.byKey(const Key('alRemove-1')));
    await tester.enterText(find.byKey(const Key('alPending')), 'Check notebooks');
    await tapIn(tester, find.byKey(const Key('alDraft')));
    expect(school.saved.single, {
      'date': '2026-11-24',
      'entries': [
        {
          'from': '10:30',
          'to': '11:10',
          'categoryId': '24',
          'description': 'VI-A · Science (Period 4)',
          'source': 'timetable',
        },
      ],
      'pendingNote': 'Check notebooks',
      'submit': false,
    });
    expect(find.text(s.alDrafted), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('alSubmit')));
    expect(school.saved.last['submit'], true);
  });

  testWidgets('leave: the kind is needed; another day from the last seven', (tester) async {
    final (t, school) = await pump(tester);
    await tapIn(tester, find.byKey(const Key('alDayKind')));
    await tester.tap(find.text(s.alDayKind('full')).last);
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('alSubmit')));
    expect(find.text(s.alNeedLeaveKind), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('alLeaveType')));
    await tester.tap(find.text('Sick leave').last);
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('alSubmit')));
    expect(school.saved.single['leave'], {'kind': 'full', 'type': 'Sick leave'});
    expect(school.saved.single['entries'], isEmpty);
    // the day before, from the chips
    await tapIn(tester, find.byKey(const Key('alRecent-2026-11-23')));
    expect(school.asked.last, '2026-11-23');
    expect(t.calls.where((c) => c.path == '/staff/activity/mine').length, greaterThan(1));
  });

  testWidgets('a submitted day is shown, locked; the log downloads as PDF', (tester) async {
    await pump(tester, school: School(state: 'submitted', editable: false));
    expect(find.text('09:00 – 09:40 · Teaching'), findsOneWidget);
    expect(find.text('VI-A Maths'), findsOneWidget);
    expect(find.text(s.alLocked), findsOneWidget);
    expect(find.byKey(const Key('alSubmit')), findsNothing);
    expect(find.textContaining('Mark the quiz'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('alRep-pdf')));
    expect(find.text(s.alDownload), findsWidgets);
  });

  testWidgets('a day sent back says by whom and why', (tester) async {
    await pump(tester, school: School(state: 'returned'));
    expect(find.text(s.alSentBack('Ravi Head', 'Add the afternoon')), findsOneWidget);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): My day, editable and locked', (tester) async {
      Future<void> check() async {
        for (final g in [
          textContrastGuideline,
          androidTapTargetGuideline,
          labeledTapTargetGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g));
        }
      }

      await pump(tester, hindi: hindi, dark: dark);
      await check();
      await pump(
        tester,
        school: School(state: 'submitted', editable: false),
        hindi: hindi,
        dark: dark,
      );
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    await pump(tester, text: 2, size: const Size(360, 6000));
    expect(tester.takeException(), isNull);
    await pump(
      tester,
      school: School(state: 'submitted', editable: false),
      text: 2,
      size: const Size(360, 4000),
    );
    expect(tester.takeException(), isNull);
  });
}
