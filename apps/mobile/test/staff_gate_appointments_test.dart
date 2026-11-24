// The staff app's Gate passes and Appointments with me, native as on the staff website (no web page).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/appointments.dart';
import 'package:edupro/staff/data.dart' show ymd;
import 'package:edupro/staff/gate_passes.dart';
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

/// An India time (given as a plain date-time) as the API's UTC moment.
String _iso(DateTime ist) => DateTime.utc(
  ist.year,
  ist.month,
  ist.day,
  ist.hour,
  ist.minute,
).subtract(const Duration(hours: 5, minutes: 30)).toIso8601String();
DateTime _todayIst() {
  final n = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  return DateTime(n.year, n.month, n.day);
}

class School {
  final decided = <Map<String, Object?>>[];
  final applied = <Map<String, Object?>>[];
  final cancelled = <String>[];

  Object? answer(Call c) {
    final key = '${c.method} ${c.path}';
    final today = _todayIst();
    final day =
        '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}';
    switch (key) {
      case 'GET /gate-passes/inbox':
        return {
          'data': [
            {
              'id': '11',
              'number': 'GP-11',
              'audience': 'student',
              'kind': 'early_leave',
              'state': 'pending',
              'stage': 'Waiting for the class teacher',
              'onDate': day,
              'atTime': '12:30',
              'returnBy': null,
              'reason': 'Doctor visit',
              'destination': null,
              'student': 'Kid Sample',
              'section': 'VI-A',
              'admissionNo': 'A1234',
              'escortName': 'Mina Sample',
              'escortRelation': 'mother',
              'items': 0,
            },
          ],
        };
      case 'GET /gate-passes/staff':
        return {
          'data': [
            {
              'id': '21',
              'number': 'GP-21',
              'audience': 'staff',
              'kind': 'rgp',
              'state': 'approved',
              'stage': 'Approved',
              'onDate': day,
              'atTime': '10:00',
              'returnBy': _iso(today.add(const Duration(hours: 12))),
              'reason': 'Bank work',
              'destination': 'Town bank',
              'items': 1,
              'passNo': 'P-21',
              'waitingOn': null,
              'decisionNote': null,
              'outAt': null,
              'inAt': null,
            },
            {
              'id': '22',
              'number': 'GP-22',
              'audience': 'staff',
              'kind': 'nrgp',
              'state': 'rejected',
              'stage': 'Rejected',
              'onDate': day,
              'atTime': '14:00',
              'returnBy': null,
              'reason': 'Personal',
              'items': 0,
              'passNo': null,
              'decisionNote': 'Exam duty',
            },
          ],
        };
      case 'POST /gate-passes/11/decide':
        decided.add(c.body!);
        return {'ok': true};
      case 'POST /gate-passes/staff':
        applied.add(c.body!);
        return {'id': '23'};
      case 'POST /gate-passes/staff/21/cancel':
        cancelled.add('21');
        return {'ok': true};
      case 'GET /appointments/with-me':
        final when = '${c.query?['when']}';
        final at = when == 'today'
            ? today.add(const Duration(hours: 11))
            : today.add(const Duration(days: 1, hours: 15));
        return {
          'data': [
            if (when != 'past')
              {
                'id': when == 'today' ? '31' : '32',
                'number': 'AP-${when == 'today' ? 31 : 32}',
                'state': when == 'today' ? 'checked_in' : 'approved',
                'startsAt': _iso(at),
                'place': 'Room 4',
                'purpose': 'Progress of the term',
                'visitorName': 'Mina Sample',
                'visitorOrg': null,
                'partySize': 2,
                'student': 'Kid Sample',
                'section': 'VI-A',
                'admissionNo': 'A1234',
              },
          ],
          'page': {'total': when == 'past' ? 0 : 1},
          'counts': {'today': 1, 'upcoming': 1, 'past': 0},
        };
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<(FakeTransport, School)> pump(
  WidgetTester tester,
  Widget child, {
  bool hindi = false,
  bool dark = false,
  double text = 1,
  Size size = const Size(420, 1800),
}) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final school = School();
  final t = FakeTransport(school.answer);
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
  return (t, school);
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
    expect(nativeScreen(staff, '/gate-passes', s), isA<StaffGatePassesScreen>());
    expect(nativeScreen(staff, '/appointments', s), isA<StaffAppointmentsScreen>());
  });

  testWidgets('gate passes: one waits on me — rejecting needs a reason; approving sends it', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StaffGatePassesScreen(profile: staff));
    expect(find.text(s.sgInboxTab(1)), findsOneWidget);
    expect(find.textContaining('Kid Sample (VI-A)'), findsOneWidget);
    expect(find.textContaining('Doctor visit'), findsOneWidget);
    expect(find.textContaining('With Mina Sample (mother)'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('sgReject-11')));
    expect(find.text(s.sgNeedNote), findsOneWidget);
    expect(school.decided, isEmpty);
    await tester.enterText(find.byKey(const Key('sgNote-11')), 'Exam today');
    await tapIn(tester, find.byKey(const Key('sgReject-11')));
    expect(school.decided.single, {'outcome': 'rejected', 'note': 'Exam today'});
    await tapIn(tester, find.byKey(const Key('sgApprove-11')));
    expect(school.decided.last['outcome'], 'approved');
  });

  testWidgets('gate passes: my own — the card, cancel, and the reason it was refused', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StaffGatePassesScreen(profile: staff));
    await tapIn(tester, find.text(s.sgMineTab));
    expect(find.textContaining('GP-21 · RGP · returnable'), findsOneWidget);
    expect(find.textContaining('Town bank'), findsOneWidget);
    expect(find.textContaining('1 item(s) carried out'), findsOneWidget);
    expect(find.byKey(const Key('view-sgCard-21')), findsOneWidget);
    expect(find.textContaining('Exam duty'), findsOneWidget);
    // a refused pass cannot be cancelled
    expect(find.byKey(const Key('sgCancel-22')), findsNothing);
    await tapIn(tester, find.byKey(const Key('sgCancel-21')));
    await tapIn(tester, find.byKey(const Key('sgCancelYes')));
    expect(school.cancelled, ['21']);
  });

  testWidgets(
    'gate passes: apply as the websites — tiles, time out, back by for RGP, the purpose, items added',
    (tester) async {
      final (_, school) = await pump(tester, const StaffGatePassesScreen(profile: staff));
      // Apply for a gate pass is on To approve too (a floating button on both tabs)
      expect(find.byKey(const Key('sgApply')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('sgApply')));
      expect(find.byKey(const Key('sgForm')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('sgSend')));
      expect(find.text(s.sgNeedOut), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('sgOut')));
      await tapIn(tester, find.text('OK'));
      await tapIn(tester, find.byKey(const Key('sgSend')));
      expect(find.text(s.sgNeedBack), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('sgBack')));
      await tapIn(tester, find.text('OK'));
      await tester.enterText(find.byKey(const Key('sgPurpose')), 'Lab equipment repair');
      // nothing carried out to start with; a row per item, each removable; an empty row must be named or removed
      expect(find.byKey(const Key('sgNoItems')), findsOneWidget);
      expect(find.byKey(const Key('sgItemName-0')), findsNothing);
      await tapIn(tester, find.byKey(const Key('sgAddItem')));
      await tapIn(tester, find.byKey(const Key('sgAddItem')));
      expect(find.byKey(const Key('sgItemName-1')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('sgItemName-0')), 'Microscope');
      await tester.enterText(find.byKey(const Key('sgItemSerial-0')), 'LAB-7');
      await tapIn(tester, find.byKey(const Key('sgSend')));
      expect(find.text(s.sgNeedName), findsOneWidget);
      expect(school.applied, isEmpty);
      await tapIn(tester, find.byKey(const Key('sgItemRemove-1')));
      expect(find.byKey(const Key('sgItemName-1')), findsNothing);
      await tapIn(tester, find.byKey(const Key('sgSend')));
      expect(school.applied.single, {
        'category': 'rgp',
        'onDate': isA<String>(),
        'atTime': '11:00',
        'returnTime': '13:00',
        'reason': 'Lab equipment repair',
        'items': [
          {'name': 'Microscope', 'qty': 1, 'serialNo': 'LAB-7', 'returnable': true},
        ],
      });
      // the note shows above the floating button, which stays to tap
      expect(find.text(s.sgRequested), findsOneWidget);
      expect(
        tester.getRect(find.byKey(const Key('sgApply'))).bottom,
        lessThanOrEqualTo(tester.getRect(find.byType(SnackBar)).top),
      );
      // sent from To approve: My gate passes is shown
      expect(tester.widget<TabBar>(find.byKey(const Key('sgTabs'))).controller, isNull);
      expect(DefaultTabController.of(tester.element(find.byKey(const Key('sgTabs')))).index, 1);
      // NRGP: no return time asked; the chosen tile is marked selected
      await tapIn(tester, find.byKey(const Key('sgApply')));
      expect(find.byKey(const Key('sgBack')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('sgNrgp')));
      expect(find.byKey(const Key('sgBack')), findsNothing);
      expect(
        tester
            .widget<Semantics>(
              find
                  .descendant(of: find.byKey(const Key('sgNrgp')), matching: find.byType(Semantics))
                  .first,
            )
            .properties
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<Semantics>(
              find
                  .descendant(of: find.byKey(const Key('sgRgp')), matching: find.byType(Semantics))
                  .first,
            )
            .properties
            .selected,
        isFalse,
      );
    },
  );

  testWidgets('appointments with me: still to come, today, past, and the week calendar', (
    tester,
  ) async {
    final (t, _) = await pump(tester, const StaffAppointmentsScreen(profile: staff));
    expect(find.text(s.saUpcoming(1)), findsOneWidget);
    expect(find.text(s.saToday(1)), findsOneWidget);
    expect(find.textContaining('15:00 · Mina Sample + 1'), findsOneWidget);
    expect(find.text('Confirmed'), findsOneWidget);
    expect(
      find.textContaining('AP-32 · Kid Sample (VI-A) · Adm. no. A1234 · Room 4'),
      findsOneWidget,
    );
    await tapIn(tester, find.text(s.saToday(1)));
    expect(find.text('Arrived'), findsOneWidget);
    await tapIn(tester, find.text(s.saPast(0)));
    expect(find.text(s.saNone), findsOneWidget);
    // the week: seven days, today's appointment on its day; earlier and later weeks
    await tapIn(tester, find.text(s.saCalendar));
    final week = t.calls.where((c) => c.query?['when'] == 'all').toList();
    expect(week.single.query?['from'], isNotNull);
    expect(find.byKey(Key('saDay-${ymd(_todayIst())}')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('saLater')));
    expect(t.calls.where((c) => c.query?['when'] == 'all').length, 2);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): gate passes and appointments with me', (tester) async {
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
        const StaffGatePassesScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.text(S(hindi).sgMineTab));
      await check();
      await tapIn(tester, find.byKey(const Key('sgApply')));
      await check();
      // with an item row, as the websites' form
      await tapIn(tester, find.byKey(const Key('sgAddItem')));
      await check();
      await pump(
        tester,
        const StaffAppointmentsScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.text(S(hindi).saCalendar));
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    await pump(
      tester,
      const StaffGatePassesScreen(profile: staff),
      text: 2,
      size: const Size(360, 3000),
    );
    await tapIn(tester, find.text(s.sgMineTab));
    await tapIn(tester, find.byKey(const Key('sgApply')));
    await tapIn(tester, find.byKey(const Key('sgAddItem')));
    expect(tester.takeException(), isNull);
    await pump(
      tester,
      const StaffAppointmentsScreen(profile: staff),
      text: 2,
      size: const Size(360, 3000),
    );
    await tapIn(tester, find.text(s.saCalendar));
    expect(tester.takeException(), isNull);
  });
}
