import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/gate_pass.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

const kid = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);

String day(int n) => DateTime.now().add(Duration(days: n)).toIso8601String().substring(0, 10);

/// A made-up school's gate passes (no real names).
class School {
  bool boarder = true;

  Map<String, Object?> pass(String id, String state, {String kind = 'early_leave'}) => {
    'id': id,
    'number': 'GP-$id',
    'kind': kind,
    'state': state,
    'returnBy': null,
    'onDate': day(1),
    'atTime': '11:30',
    'reason': 'Dentist visit',
    'student': 'Kid Sample',
    'section': 'VI-A',
    'admissionNo': 'A1234',
    'escortName': 'Parent Sample',
    'escortRelation': 'Father',
    'approvedLevels': state == 'pending' ? 0 : 1,
    'levels': 1,
    'approvalMode': 'sequence',
    'approvalNeed': 1,
    'waitingOn': state == 'pending' ? 'Class teacher' : null,
    'decisionNote': null,
    'cancelReason': null,
    'passNo': state == 'pending' ? null : 'P-$id',
    'passCode': state == 'pending' ? null : 'C$id',
    'handoverAt': null,
    'outAt': null,
    'inAt': null,
  };

  Object? answer(Call c) {
    switch ('${c.method} ${c.path}') {
      case 'GET /gate-passes/mine':
        final page = (c.query ?? const {})['page'];
        return {
          'data': [pass('501', 'approved'), pass('502', 'pending', kind: 'late_arrival')],
          'page': {'number': page ?? 1, 'size': 10, 'total': 12},
        };
      case 'GET /gate-passes/mine/options':
        return {
          'data': [
            {
              'id': '41',
              'name': 'Kid Sample',
              'hostel': boarder ? 'Boys hostel' : null,
              'guardians': [
                {'relation': 'father', 'name': 'Parent Sample'},
                {'relation': 'mother', 'name': 'Mother Sample'},
              ],
            },
          ],
          'outingReturnBy': '18:00',
        };
      case 'POST /gate-passes/mine':
        return {'id': '900'};
      case 'GET /gate-passes/mine/900':
        return {
          ...pass('900', 'pending'),
          'createdAt': '${day(0)}T04:00:00Z',
          'otpNeeded': false,
          'qr': null,
          'barcode': null,
          'approvals': [
            {
              'seq': 1,
              'label': 'Class teacher',
              'status': 'pending',
              'actedBy': null,
              'actedAt': null,
              'note': null,
            },
          ],
        };
      case 'GET /gate-passes/mine/501':
        return {
          ...pass('501', 'approved'),
          'createdAt': '${day(0)}T04:00:00Z',
          'otpNeeded': true,
          'qr': '<svg/>',
          'barcode': null,
          'approvals': [
            {
              'seq': 1,
              'label': 'Class teacher',
              'status': 'approved',
              'actedBy': 'Teacher Sample',
              'actedAt': '${day(0)}T05:00:00Z',
              'note': 'OK',
            },
            {
              'seq': 2,
              'label': 'Principal',
              'status': 'skipped',
              'actedBy': null,
              'actedAt': null,
              'note': null,
            },
          ],
        };
      case 'GET /gate-passes/mine/501/card':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'gp.pdf',
        );
      case 'POST /gate-passes/mine/502/cancel':
      case 'POST /gate-passes/mine/501/cancel':
        return {'ok': true};
    }
    throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
  }
}

Future<FakeTransport> pump(
  WidgetTester tester,
  Widget child, {
  School? school,
  bool hindi = false,
  bool dark = false,
  double text = 1,
}) async {
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final t = FakeTransport((school ?? School()).answer);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [transportProvider.overrideWithValue(t)],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        builder: (context, w) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(text)),
          child: w!,
        ),
        home: FamilyPage(title: 'Gate passes', child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

/// A phone-shaped screen (what the dialogs lay out against too).
Future<void> tall(WidgetTester tester, [Size size = const Size(420, 2600)]) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
}

/// Into view by dragging the page's own list (a text field scrolls too).
Future<void> reach(WidgetTester tester, Finder f) async {
  if (f.evaluate().isEmpty) {
    await tester.dragUntilVisible(f, find.byType(ListView).first, const Offset(0, -250));
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

Future<void> tapIn(WidgetTester tester, Finder f) async {
  await reach(tester, f);
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  const s = S(false);

  testWidgets(
    'the list as on the website: count, passes, status and search, pages, a month, cancel',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const GatePassesScreen(profile: kid));
      expect(find.text('Early leave and late arrival'), findsOneWidget);
      expect(find.text('12 in all · latest first'), findsOneWidget);
      expect(t.calls.last.query, {'studentId': '41', 'page': 1, 'size': 10});
      expect(find.text('Leaving early'), findsOneWidget);
      expect(find.text('Approved: collect at the front desk'), findsOneWidget);
      expect(find.text('Arriving late'), findsOneWidget);
      expect(find.text('Waiting for the school'), findsOneWidget);
      expect(
        find.text('GP-502 · With Parent Sample (Father) · Waiting on Class teacher'),
        findsOneWidget,
      );
      expect(find.text('Details and gate pass'), findsOneWidget);
      // status and search
      await tester.tap(find.byKey(const Key('gateState-open')));
      await tester.pumpAndSettle();
      expect(t.calls.last.query!['state'], 'open');
      await tester.enterText(find.byKey(const Key('gateSearch')), 'dentist');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(t.calls.last.query!['q'], 'dentist');
      expect(find.text('12 found · latest first'), findsOneWidget);
      // ten a page
      await tapIn(tester, find.byKey(const Key('gateNext')));
      expect(t.calls.last.query!['page'], 2);
      // a month
      await tapIn(tester, find.byKey(const Key('gateView-calendar')));
      final now = DateTime.now();
      final first = DateTime(now.year, now.month);
      expect(
        t.calls.last.query!['from'],
        '${first.year}-${first.month.toString().padLeft(2, '0')}-01',
      );
      expect(t.calls.last.query!['size'], 100);
      // cancel, asked first
      await tapIn(tester, find.byKey(const Key('gateView-list')));
      await tapIn(tester, find.byKey(const Key('gateCancel-502')));
      await tester.tap(find.text('Keep it'));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path.endsWith('/cancel')), isFalse);
      await tapIn(tester, find.byKey(const Key('gateCancel-502')));
      await tester.tap(find.byKey(const Key('confirmGateCancel')));
      await tester.pumpAndSettle();
      expect(
        t.calls.lastWhere((c) => c.path.endsWith('/cancel')).path,
        '/gate-passes/mine/502/cancel',
      );
      expect(find.text('Gate pass cancelled.'), findsOneWidget);
    },
  );

  testWidgets(
    'asking to leave early: the time and reason asked for, a parent on record takes the child',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const GatePassForm(profile: kid));
      // a boarder may also ask for home leave and outings
      expect(find.byKey(const Key('gateKind-hostel_home')), findsOneWidget);
      await tester.tap(find.byKey(const Key('gateKind-early_leave')));
      await tester.pumpAndSettle();
      await tapIn(tester, find.byKey(const Key('gateSend')));
      expect(find.text('Choose the time.'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('gateAt')));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tapIn(tester, find.byKey(const Key('gateSend')));
      expect(find.text('Write the reason (at least 3 letters).'), findsOneWidget);
      await reach(tester, find.byKey(const Key('gateReason')));
      await tester.enterText(find.byKey(const Key('gateReason')), 'Dentist visit');
      await tapIn(tester, find.byKey(const Key('gateSend')));
      expect(t.calls.lastWhere((c) => c.method == 'POST').body, {
        'studentId': '41',
        'kind': 'early_leave',
        'onDate': day(0),
        'atTime': '12:00',
        'reason': 'Dentist visit',
        'escortKind': 'father',
      });
    },
  );

  testWidgets('home leave from the hostel: the day back, someone else with a mobile', (
    tester,
  ) async {
    await tall(tester, const Size(420, 3000));
    final t = await pump(tester, const GatePassForm(profile: kid, kind: 'hostel_home'));
    await tapIn(tester, find.byKey(const Key('gateAt')));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await reach(tester, find.byKey(const Key('gateReason')));
    await tester.enterText(find.byKey(const Key('gateReason')), 'Family function');
    await tapIn(tester, find.byKey(const Key('gateSend')));
    expect(find.text('Choose the day of coming back.'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('gateReturnOn')));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('gateEscort-other')));
    await reach(tester, find.byKey(const Key('gateOtherName')));
    await tester.enterText(find.byKey(const Key('gateOtherName')), 'Uncle Sample');
    await tester.enterText(find.byKey(const Key('gateOtherRelation')), 'Uncle');
    await tester.enterText(find.byKey(const Key('gateOtherMobile')), '12345');
    await tapIn(tester, find.byKey(const Key('gateSend')));
    expect(
      find.text('Fill the name, relation and a 10-digit mobile of the person.'),
      findsOneWidget,
    );
    await tester.enterText(find.byKey(const Key('gateOtherMobile')), '9000000099');
    await tapIn(tester, find.byKey(const Key('gateSend')));
    expect(t.calls.lastWhere((c) => c.method == 'POST').body, {
      'studentId': '41',
      'kind': 'hostel_home',
      'onDate': day(0),
      'atTime': '12:00',
      'returnOn': day(0),
      'returnAt': '17:00',
      'reason': 'Family function',
      'escortKind': 'other',
      'escortName': 'Uncle Sample',
      'escortRelation': 'Uncle',
      'escortMobile': '9000000099',
    });
  });

  testWidgets('hostel leave only for a boarder', (tester) async {
    await tall(tester);
    await pump(
      tester,
      const GatePassForm(profile: kid, kind: 'hostel_outing'),
      school: School()..boarder = false,
    );
    expect(find.byKey(const Key('gateKind-hostel_outing')), findsNothing);
    expect(find.text('Hostel leave is for children who board in the hostel.'), findsOneWidget);
    expect(find.byKey(const Key('gateSend')), findsNothing);
  });

  testWidgets(
    'a pass in full: the card with its QR code to view or save, details, approval, cancel',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const GatePassDetail(profile: kid, id: '501'));
      expect(find.text('Gate pass GP-501'), findsOneWidget);
      expect(find.text('Approved: collect at the front desk'), findsOneWidget);
      expect(find.text('Gate pass card (PDF)'), findsOneWidget);
      expect(find.textContaining('one-time code to your mobile'), findsOneWidget);
      expect(find.text('Dentist visit'), findsWidgets);
      expect(find.text('Parent Sample (Father)'), findsOneWidget);
      expect(find.text('Class teacher · Teacher Sample · OK'), findsOneWidget);
      expect(find.text('Principal'), findsNothing);
      await tester.tap(find.byKey(const Key('view-gateCard')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/gate-passes/mine/501/card'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tapIn(tester, find.byKey(const Key('gateDetailCancel')));
      await tester.tap(find.byKey(const Key('confirmGateCancel')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/gate-passes/mine/501/cancel'), isTrue);
    },
  );

  testWidgets('just requested: said so; no card while it waits', (tester) async {
    await tall(tester);
    await pump(tester, const GatePassDetail(profile: kid, id: '900', sent: true));
    expect(
      find.text('Gate pass requested. The school will approve it and send you the pass.'),
      findsOneWidget,
    );
    expect(find.text('Gate pass card (PDF)'), findsNothing);
    expect(find.text('Deciding now'), findsOneWidget);
    expect(s.gateState('pending', 'early_leave'), 'Waiting for the school');
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the list, the form and a pass', (tester) async {
      await tall(tester);
      final handle = tester.ensureSemantics();
      for (final w in const [
        GatePassesScreen(profile: kid),
        GatePassForm(profile: kid, kind: 'hostel_home'),
        GatePassDetail(profile: kid, id: '501'),
      ]) {
        await pump(tester, w, hindi: hindi, dark: dark);
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(
            tester,
            meetsGuideline(g),
            reason: '${w.runtimeType}: ${g.description}',
          );
        }
      }
      handle.dispose();
    });
  }

  testWidgets('large text (twice the size) on a phone: the list, the form and a pass', (
    tester,
  ) async {
    await tall(tester, const Size(360, 780));
    for (final hindi in [false, true]) {
      for (final w in const [
        GatePassesScreen(profile: kid),
        GatePassForm(profile: kid, kind: 'hostel_home'),
        GatePassDetail(profile: kid, id: '501'),
      ]) {
        await pump(tester, w, hindi: hindi, text: 2);
        expect(tester.takeException(), isNull, reason: '${w.runtimeType} hindi=$hindi');
        await tester.drag(find.byType(ListView).first, const Offset(0, -3000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '${w.runtimeType} scrolled');
      }
    }
  });
}
