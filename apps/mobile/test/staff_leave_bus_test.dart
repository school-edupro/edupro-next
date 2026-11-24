// The staff app's Student leave and Bus attendance, native as on the staff website (no web page).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/bus_attendance.dart';
import 'package:edupro/staff/student_leave.dart';
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
  School({this.noLeaveRight = false, this.closed = false});
  final bool noLeaveRight;
  final bool closed;
  final decided = <Map<String, Object?>>[];
  final marked = <Map<String, Object?>>[];

  static const _leave = {
    'id': '41',
    'number': 'SL-41',
    'student': 'Kid Sample',
    'admissionNo': 'A1234',
    'section': 'VI-A',
    'leaveTypeLabel': 'Sick leave',
    'fromDate': '2026-11-24',
    'toDate': '2026-11-26',
    'days': 3,
    'reason': 'Fever',
    'long': false,
    'status': 'pending',
    'appliedBy': 'Mina Sample',
    'waitingOn': 'Class teacher',
    'decisionNote': null,
  };

  Object? answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /attendance/leaves':
        if (noLeaveRight) throw const ApiException(403, 'forbidden', 'Not allowed');
        final all = c.query?['tab'] == 'all';
        return {
          'inbox': 1,
          'data': [
            _leave,
            if (all)
              {..._leave, 'id': '42', 'number': 'SL-42', 'status': 'approved', 'waitingOn': null},
          ],
        };
      case 'GET /attendance/leaves/41':
        return {
          ..._leave,
          'files': [
            {'id': '9', 'name': 'certificate.pdf'},
          ],
          'approvals': [
            {
              'seq': 1,
              'label': 'Class teacher',
              'status': 'pending',
              'actedBy': null,
              'approvers': 'Asha Teacher',
              'note': null,
            },
            {
              'seq': 2,
              'label': 'Coordinator',
              'status': 'next',
              'actedBy': null,
              'approvers': null,
              'note': null,
            },
          ],
          'canDecide': true,
        };
      case 'POST /attendance/leaves/41/decide':
        decided.add(c.body!);
        return {'ok': true};
      case 'GET /attendance/bus-roll/routes':
        return {
          'data': [
            {
              'routeId': '5',
              'code': 'R1',
              'name': 'North loop',
              'trip': 'pick',
              'tripLabel': 'Morning (pick)',
            },
            {
              'routeId': '5',
              'code': 'R1',
              'name': 'North loop',
              'trip': 'drop',
              'tripLabel': 'Afternoon (drop)',
            },
          ],
        };
      case 'GET /attendance/bus-roll':
        return {
          'id': null,
          'route': 'R1 North loop',
          'vehicle': 'Bus 3',
          'date': c.query?['date'],
          'trip': c.query?['trip'],
          'tripLabel': 'Morning (pick)',
          'markedBy': null,
          'markedLate': false,
          'window': {
            'open': !closed,
            'late': false,
            'from': '07:00',
            'to': '10:00',
            'note': closed ? 'Marking closed at 10:00.' : null,
          },
          'roster': [
            {
              'studentId': '101',
              'name': 'Kid Sample',
              'admissionNo': 'A1234',
              'section': 'VI-A',
              'stop': 'Park gate',
              'atTime': '07:20',
              'code': null,
              'remarks': null,
              'hint': null,
              'classCode': null,
              'tapped': '07:21',
              'suggested': 'P',
            },
            {
              'studentId': '102',
              'name': 'Other Sample',
              'admissionNo': 'A1235',
              'section': 'VI-B',
              'stop': 'Mill road',
              'atTime': '07:30',
              'code': null,
              'remarks': null,
              'hint': {
                'leave': {'number': 'SL-50', 'from': '2026-11-24', 'to': '2026-11-24'},
                'pass': null,
              },
              'classCode': 'LV',
              'tapped': null,
              'suggested': 'LV',
              'locked': true,
            },
          ],
          'counts': {},
        };
      case 'POST /attendance/bus-roll':
        marked.add(c.body!);
        return {'ok': true};
      case 'GET /attendance/bus-roll/register':
        return {
          'route': 'R1 North loop',
          'tripLabel': 'Both',
          'trips': ['pick', 'drop'],
          'month': c.query?['month'],
          'days': ['2026-11-02', '2026-11-03'],
          'rows': [
            {
              'studentId': '101',
              'name': 'Kid Sample',
              'admissionNo': 'A1234',
              'section': 'VI-A',
              'stop': 'Park gate',
              'rides': ['pick', 'drop'],
              'pick': {'2026-11-02': 'P', '2026-11-03': 'A'},
              'drop': {'2026-11-02': 'P'},
              'presentPick': 1,
              'presentDrop': 1,
              'present': 2,
              'absent': 1,
              'leave': 0,
              'gatePass': 0,
              'other': 0,
            },
          ],
        };
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<(FakeTransport, School)> pump(
  WidgetTester tester,
  Widget child, {
  School? school,
  bool hindi = false,
  bool dark = false,
  double text = 1,
  Size size = const Size(420, 2000),
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
        home: FamilyPage(title: 'Staff', child: child),
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

  test('the staff menu opens both natively (no web page)', () {
    expect(nativeScreen(staff, '/leaves', s), isA<StudentLeaveScreen>());
    expect(nativeScreen(staff, '/bus-attendance', s), isA<BusAttendanceScreen>());
  });

  testWidgets('student leave: to approve, the details, not approving needs a note, approving', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StudentLeaveScreen(profile: staff));
    expect(find.text(s.slInboxTab(1)), findsOneWidget);
    expect(find.text('Kid Sample'), findsOneWidget);
    expect(find.textContaining('Sick leave'), findsOneWidget);
    expect(find.text(s.slWaiting('Class teacher')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('slOpen-41')));
    expect(find.byKey(const Key('slDetail')), findsOneWidget);
    expect(find.text('Fever'), findsOneWidget);
    expect(find.byKey(const Key('view-slFile-9')), findsOneWidget);
    expect(find.textContaining('Class teacher: waiting for Asha Teacher'), findsOneWidget);
    expect(find.textContaining('Coordinator: next'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('slReject')));
    expect(find.text(s.slNeedNote), findsOneWidget);
    expect(school.decided, isEmpty);
    await tester.enterText(find.byKey(const Key('slNote')), 'Exams this week');
    await tapIn(tester, find.byKey(const Key('slReject')));
    expect(school.decided.single, {'outcome': 'rejected', 'note': 'Exams this week'});
    await tapIn(tester, find.byKey(const Key('slOpen-41')));
    await tapIn(tester, find.byKey(const Key('slApprove')));
    expect(school.decided.last, {'outcome': 'approved'});
  });

  testWidgets('student leave: all that came to me; a role without the right is told so', (
    tester,
  ) async {
    await pump(tester, const StudentLeaveScreen(profile: staff));
    await tapIn(tester, find.text(s.slAllTab));
    expect(find.textContaining('SL-42'), findsOneWidget);
    expect(find.text(s.slStatus('approved')), findsOneWidget);
    await pump(
      tester,
      const StudentLeaveScreen(profile: staff),
      school: School(noLeaveRight: true),
    );
    expect(find.text(s.slNotYours), findsWidgets);
  });

  testWidgets('bus attendance: the riders, a leave fixed as LV, mark and save', (tester) async {
    final (t, school) = await pump(tester, const BusAttendanceScreen(profile: staff));
    expect(find.byKey(const Key('busRoll')), findsOneWidget);
    expect(find.text(s.busNotMarked), findsOneWidget);
    expect(find.textContaining('card read 07:21'), findsOneWidget);
    expect(find.text(s.busLeave(true)), findsOneWidget);
    // the approved leave cannot be changed: only LV
    final aOnLeave = tester.widget<ChoiceChip>(find.byKey(const Key('bus-102-A')));
    expect(aOnLeave.onSelected, isNull);
    await tapIn(tester, find.byKey(const Key('bus-101-A')));
    await tester.enterText(find.byKey(const Key('busRemarks-101')), 'Missed the bus');
    await tapIn(tester, find.byKey(const Key('busSave')));
    expect(school.marked.single, {
      'routeId': '5',
      'date': isA<String>(),
      'trip': 'pick',
      'marks': [
        {'studentId': '101', 'code': 'A', 'remarks': 'Missed the bus'},
        {'studentId': '102', 'code': 'LV'},
      ],
    });
    expect(t.calls.where((c) => c.path == '/attendance/bus-roll').length, greaterThan(1));
  });

  testWidgets('bus attendance: a closed window cannot be saved; the monthly register', (
    tester,
  ) async {
    await pump(tester, const BusAttendanceScreen(profile: staff), school: School(closed: true));
    expect(find.text('Marking closed at 10:00.'), findsOneWidget);
    expect(find.byKey(const Key('busSave')), findsNothing);
    await tapIn(tester, find.byKey(const Key('busRegister')));
    expect(find.byKey(const Key('busRegGrid')), findsOneWidget);
    expect(find.text('02 M'), findsOneWidget);
    expect(find.text('Kid Sample (VI-A)'), findsOneWidget);
    expect(find.byKey(const Key('busRegFile-pdf')), findsOneWidget);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): student leave and bus attendance', (tester) async {
      Future<void> check() async {
        for (final g in [
          textContrastGuideline,
          androidTapTargetGuideline,
          labeledTapTargetGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g));
        }
      }

      await pump(
        tester,
        const StudentLeaveScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.byKey(const Key('slOpen-41')));
      await check();
      await pump(
        tester,
        const BusAttendanceScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.byKey(const Key('busRegister')));
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    await pump(
      tester,
      const StudentLeaveScreen(profile: staff),
      text: 2,
      size: const Size(360, 3000),
    );
    await tapIn(tester, find.byKey(const Key('slOpen-41')));
    expect(tester.takeException(), isNull);
    await pump(
      tester,
      const BusAttendanceScreen(profile: staff),
      text: 2,
      size: const Size(360, 4000),
    );
    expect(tester.takeException(), isNull);
    await tapIn(tester, find.byKey(const Key('busRegister')));
    expect(tester.takeException(), isNull);
  });
}
