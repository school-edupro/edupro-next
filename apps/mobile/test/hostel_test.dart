import 'dart:convert';

import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/data.dart';
import 'package:edupro/family/gate_pass.dart';
import 'package:edupro/family/hostel.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/data.dart' show PickedFile;
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// The Hostel screen (apps/parent/app/(app)/hostel on the phone) against a made-up hostel. Every name, number and
/// date here is made up.
final now = DateTime.now();
String day(int offset) => ymd(DateTime(now.year, now.month, now.day + offset));
String at(int offset, int hour) =>
    DateTime(now.year, now.month, now.day + offset, hour).toUtc().toIso8601String();
final monday = DateTime(now.year, now.month, now.day - (now.weekday - 1));

const kid = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);

/// A made-up photo (the API checks it is an image; the app only its type and size).
final photoBytes = List<int>.generate(180, (i) => i % 251);

/// A 1×1 PNG (a visitor's photo from the school).
final png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);

/// What the fake API answers for the hostel.
class Hostel {
  /// the child boards (the menu has a hostel)
  bool boards = true;

  /// not boarding: the child left the hostel (else never boarded)
  bool left = false;

  /// a request to leave the hostel waits for the office
  bool pendingExit = true;

  /// the summary call fails (the website shows the page without it)
  bool summaryFails = false;

  Map<String, Object?> week(DateTime mon, {String breakfast = 'Poha, milk'}) => {
    'weekOf': ymd(mon),
    'meals': [
      {'id': '11', 'name': 'Breakfast', 'atTime': '07:30'},
      {'id': '12', 'name': 'Dinner', 'atTime': '20:00'},
    ],
    'days': [
      for (var i = 0; i < 7; i++)
        () {
          final d = ymd(DateTime(mon.year, mon.month, mon.day + i));
          final isToday = d == day(0);
          return {
            'date': d,
            'meals': [
              {'mealId': '11', 'items': breakfast, 'changed': false, 'note': null},
              {
                'mealId': '12',
                'items': 'Dal, rice, roti',
                'changed': isToday,
                'note': isToday ? 'Festival dinner' : null,
              },
            ],
          };
        }(),
    ],
  };

  dynamic answer(Call c) {
    final key = '${c.method} ${c.path}';
    final q = c.query ?? const <String, Object?>{};
    switch (key) {
      case 'GET /hostel/mine/menu':
        if (!boards) {
          return {
            'hostel': null,
            'week': null,
            'diet': null,
            'left': left
                ? {'on': '2026-10-31', 'hostel': 'Tagore House', 'feeUntil': '2026-10-01'}
                : null,
          };
        }
        final w = q['weekOf'];
        return {
          'hostel': {'id': '3', 'name': 'Tagore House'},
          'diet': {
            'diet': 'veg',
            'dietName': null,
            'noOnionGarlic': true,
            'allergies': ['Peanuts'],
            'notes': 'Less spice',
          },
          'week': w is String ? week(DateTime.parse(w), breakfast: 'Upma, tea') : week(monday),
        };
      case 'GET /hostel/mine/exit':
        if (!boards) {
          return {
            'hostel': null,
            'requests': [],
            'withdrawals': left
                ? [
                    {
                      'id': '16',
                      'leavingOn': '2026-10-31',
                      'status': 'completed',
                      'completedAt': at(-20, 12),
                    },
                  ]
                : [],
          };
        }
        return {
          'hostel': 'Tagore House',
          'requests': [
            if (pendingExit)
              {
                'id': '21',
                'leavingOn': day(30),
                'reason': 'parent_request',
                'note': 'Moving closer to school',
                'status': 'pending',
                'declineNote': null,
                'createdAt': at(-1, 10),
              },
            {
              'id': '19',
              'leavingOn': day(-40),
              'reason': 'health',
              'note': null,
              'status': 'declined',
              'declineNote': 'Dues pending',
              'createdAt': at(-60, 10),
            },
          ],
          'withdrawals': [
            {
              'id': '15',
              'leavingOn': '2025-03-31',
              'status': 'completed',
              'completedAt': '2025-03-31T06:30:00.000Z',
            },
          ],
        };
      case 'GET /hostel/mine/summary':
        if (summaryFails) throw const ApiException(500, 'server', 'Something went wrong');
        if (!boards) return {'boarder': false};
        return {
          'boarder': true,
          'stay': {
            'hostel': 'Tagore House',
            'hostelPhone': null,
            'block': 'A',
            'room': '12',
            'bed': 'B',
            'since': '2026-04-02',
            'roomMates': 2,
          },
          'wardens': [
            {'name': 'Meena Rao', 'isHead': true, 'mobile': '98765 43210'},
            {'name': 'Ravi Kumar', 'isHead': false, 'mobile': null},
          ],
          'now': {'state': 'in_hostel'},
          'next': {
            'number': 'GP-9',
            'kind': 'hostel_home',
            'onDate': day(2),
            'atTime': '16:00',
            'state': 'approved',
          },
          'lastRoll': {
            'status': 'present',
            'session': 'Night',
            'on': day(-1),
            'at': '21:00',
            'label': 'Present',
          },
          'todayMenu': [
            {'meal': 'Breakfast', 'atTime': '07:30', 'items': 'Poha, milk', 'changed': false},
            {'meal': 'Dinner', 'atTime': '20:00', 'items': 'Dal, rice, roti', 'changed': true},
          ],
          'passes': [
            {
              'id': '501',
              'number': 'GP-9',
              'kind': 'hostel_home',
              'state': 'approved',
              'onDate': day(2),
              'atTime': '16:00',
              'returnBy': at(4, 18),
              'outAt': null,
              'inAt': null,
              'lateMinutes': null,
              'reason': 'Cousin’s wedding',
            },
            {
              'id': '480',
              'number': 'GP-4',
              'kind': 'hostel_outing',
              'state': 'returned',
              'onDate': day(-10),
              'atTime': '10:00',
              'returnBy': at(-10, 17),
              'outAt': at(-10, 10),
              'inAt': at(-10, 18),
              'lateMinutes': 25,
              'reason': 'Market visit',
            },
          ],
        };
      case 'GET /hostel/mine/visitors':
        return {
          'onRecord': [
            {'name': 'Sunil Sample', 'relation': 'father', 'mobile': '9800000001'},
            {'name': 'Rita Sample', 'relation': 'mother', 'mobile': null},
          ],
          'visitors': [
            {
              'id': '71',
              'name': 'Asha Verma',
              'relation': 'Aunt',
              'mobile': '9800000002',
              'status': 'approved',
              'note': null,
              'hasPhoto': true,
            },
            {
              'id': '72',
              'name': 'Dev Verma',
              'relation': 'Uncle',
              'mobile': '9800000003',
              'status': 'pending',
              'note': null,
              'hasPhoto': false,
            },
          ],
        };
      case 'GET /hostel/mine/visitors/71/photo':
        return ApiFile(bytes: png, contentType: 'image/png', name: 'visitor.png');
      case 'POST /hostel/mine/visitors':
        return {'id': '73', 'status': 'pending'};
      case 'DELETE /hostel/mine/visitors/72':
        return {'ok': true};
      case 'GET /hostel/mine/feedback':
        return {
          'data': [
            {
              'mealId': '11',
              'meal': 'Breakfast',
              'atTime': '07:30',
              'onDate': day(0),
              'rating': null,
              'comment': null,
            },
            {
              'mealId': '12',
              'meal': 'Dinner',
              'atTime': '20:00',
              'onDate': day(-1),
              'rating': 4,
              'comment': 'Tasty',
            },
          ],
        };
      case 'POST /hostel/mine/feedback':
        return {'ok': true};
      case 'GET /hostel/mine/complaint-heads':
        return {
          'data': [
            {'code': 'room', 'name': 'Room and furniture'},
            {'code': 'water', 'name': 'Water'},
          ],
        };
      case 'GET /hostel/mine/complaints':
        return {
          'data': [
            {
              'id': '61',
              'number': 'HC-3',
              'status': 'in_progress',
              'subject': 'Fan not working',
              'head': 'Room and furniture',
              'openedAt': at(-2, 9),
              'closedAt': null,
              'resolution': null,
            },
            {
              'id': '58',
              'number': 'HC-1',
              'status': 'closed',
              'subject': 'Leaking tap',
              'head': 'Water',
              'openedAt': at(-30, 9),
              'closedAt': at(-28, 9),
              'resolution': 'Tap replaced',
            },
          ],
        };
      case 'POST /hostel/mine/complaints':
        return {'id': '62', 'number': 'HC-4'};
      case 'GET /hostel/mine/incidents':
        return {
          'data': [
            {
              'id': '31',
              'occurredAt': at(-3, 22),
              'category': 'health',
              'what': 'Mild fever at night',
              'action': 'Seen by the nurse',
            },
          ],
        };
      case 'POST /hostel/mine/exit':
        return {'id': '22', 'status': 'pending'};
      case 'POST /hostel/mine/exit/21/withdraw':
        return {'ok': true};
      case 'GET /hostel/mine/withdrawals/15/certificate':
      case 'GET /hostel/mine/withdrawals/16/certificate':
        return null; // the fake transport's PDF
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

/// A screen on test: the calls it made, the calls and chats it started.
class Run {
  Run(this.t);
  final FakeTransport t;
  final launched = <String>[];

  /// what the phone's camera or gallery gives
  PickedFile? photo = PickedFile(name: 'aunt.jpg', bytes: photoBytes, contentType: 'image/jpeg');

  Iterable<Call> calls(String method, String path) =>
      t.calls.where((c) => c.method == method && c.path == path);
}

Future<Run> pumpHostel(WidgetTester tester, Hostel h, {bool hindi = false}) async {
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final run = Run(FakeTransport(h.answer));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        transportProvider.overrideWithValue(run.t),
        hostelPhotoPickerProvider.overrideWithValue((context, s) async => run.photo),
        hostelLaunchProvider.overrideWithValue((uri) async => run.launched.add('$uri')),
      ],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        home: FamilyPage(
          title: S(hindi).hostelTitle,
          child: const HostelScreen(profile: kid),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return run;
}

Future<void> tall(WidgetTester tester, [Size size = const Size(420, 3000)]) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
}

Future<void> tab(WidgetTester tester, String t) async {
  await tester.ensureVisible(find.byKey(Key('hostelTab-$t')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key('hostelTab-$t')));
  await tester.pumpAndSettle();
}

/// Brings a part of the page into view by dragging the page's list itself (not a text field's scroller): down
/// first, then back up.
Future<void> reach(WidgetTester tester, Finder f) async {
  if (f.evaluate().isEmpty) {
    try {
      await tester.dragUntilVisible(
        f,
        find.byType(ListView).first,
        const Offset(0, -250),
        maxIteration: 30,
      );
    } on StateError {
      await tester.dragUntilVisible(f, find.byType(ListView).first, const Offset(0, 250));
    }
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
    'the main view shows the website\'s summary: hostel, figures, room, warden, meals, leave',
    (tester) async {
      await tall(tester);
      final run = await pumpHostel(tester, Hostel());
      expect(tester.takeException(), isNull);
      expect(find.text('Tagore House'), findsOneWidget);
      expect(find.text(s.hostelIntro), findsOneWidget);
      // the figures, an even number: room, now, approved visitors (two on record, one approved), open complaints
      Finder fig(String x) =>
          find.descendant(of: find.byKey(const Key('hostelFigures')), matching: find.text(x));
      expect(find.byType(FigureTile), findsNWidgets(4));
      expect(fig('A · 12 / B'), findsOneWidget);
      expect(fig('In the hostel'), findsOneWidget);
      expect(fig('3'), findsOneWidget);
      expect(fig('1'), findsOneWidget);
      // the summary: since when, with whom, the last roll-call, the next leave
      expect(find.text('since ${s.dayShort('2026-04-02')} · 2 room-mates'), findsOneWidget);
      expect(find.text('Last roll-call: Present · Night ${s.dayShort(day(-1))}'), findsOneWidget);
      expect(find.text('Next home leave: ${s.dayShort(day(2))} 16:00'), findsOneWidget);
      // the wardens: the head first; a call and WhatsApp from the phone when there is a mobile
      expect(find.text('Meena Rao (head)'), findsOneWidget);
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.byKey(const Key('callWarden-1')), findsNothing);
      await tester.tap(find.byKey(const Key('callWarden-0')));
      await tester.tap(find.byKey(const Key('whatsappWarden-0')));
      expect(run.launched, ['tel:98765%2043210', 'https://wa.me/919876543210']);
      // today's meals, the special one marked
      expect(find.text('Breakfast · 07:30'), findsOneWidget);
      expect(find.text('Poha, milk'), findsOneWidget);
      expect(find.text('Special today'), findsOneWidget);
      // Leave and outings first: the approved pass, the one back folded
      expect(find.byKey(const Key('hostelTab-leave')), findsOneWidget);
      final pass = find.byKey(const Key('pass-501'));
      expect(
        find.descendant(of: pass, matching: find.text('Home leave · ${s.dayShort(day(2))} 16:00')),
        findsOneWidget,
      );
      expect(find.descendant(of: pass, matching: find.text('Approved')), findsOneWidget);
      expect(find.descendant(of: pass, matching: find.text('Cousin’s wedding')), findsOneWidget);
      expect(find.byKey(const Key('pass-480')), findsNothing);
      await tapIn(tester, find.byKey(const Key('earlierPasses')));
      expect(find.byKey(const Key('pass-480')), findsOneWidget);
      expect(find.text('Late 25 min'), findsOneWidget);
      expect(find.text('Back'), findsOneWidget);
      // home leave, an outing and a pass open the app's own gate-pass screens, no web page
      for (final (key, kind) in [
        ('askHomeLeave', 'hostel_home'),
        ('askOuting2', 'hostel_outing'),
      ]) {
        await tapIn(tester, find.byKey(Key(key)));
        expect(tester.widget<GatePassForm>(find.byType(GatePassForm)).kind, kind);
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
      }
      await tapIn(tester, find.byKey(const Key('openPass-501')));
      expect(tester.widget<GatePassDetail>(find.byType(GatePassDetail)).id, '501');
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(
        run.t.calls.any((c) => c.path.contains('/web') || c.path.contains('handoff')),
        isFalse,
      );
      // the website's calls, the menu of this week without a week
      final menu = run.calls('GET', '/hostel/mine/menu').first;
      expect(menu.query, {'studentId': '41'});
      for (final p in [
        '/hostel/mine/exit',
        '/hostel/mine/summary',
        '/hostel/mine/visitors',
        '/hostel/mine/complaints',
        '/hostel/mine/incidents',
        '/hostel/mine/feedback',
      ]) {
        expect(run.calls('GET', p).first.query, {'studentId': '41'}, reason: p);
      }
      expect(run.calls('GET', '/hostel/mine/complaint-heads'), isNotEmpty);
    },
  );

  testWidgets('each part shows the website\'s facts: visitors, mess, complaints, notes, leaving', (
    tester,
  ) async {
    await tall(tester);
    final run = await pumpHostel(tester, Hostel());

    await tab(tester, 'visitors');
    expect(find.text(s.hostelVisitorsHelp), findsOneWidget);
    expect(find.text('Sunil Sample'), findsOneWidget);
    expect(find.text('Father · 9800000001'), findsOneWidget);
    expect(find.text('Mother · —'), findsOneWidget);
    expect(find.text('On the school record'), findsNWidgets(2));
    expect(find.text('Aunt · 9800000002'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('visitor-71')), matching: find.text('Approved')),
      findsOneWidget,
    );
    expect(find.text('Waiting for the warden'), findsOneWidget);
    // the photo that helps the gate, for the visitor who has one
    expect(find.byKey(const Key('visitorPhoto-71')), findsOneWidget);
    expect(run.calls('GET', '/hostel/mine/visitors/71/photo'), isNotEmpty);
    expect(run.calls('GET', '/hostel/mine/visitors/72/photo'), isEmpty);

    await tab(tester, 'mess');
    expect(find.text('Week of ${s.dayShort(ymd(monday))}'), findsOneWidget);
    expect(find.text('Vegetarian · no onion or garlic'), findsOneWidget);
    expect(find.text('Allergy: Peanuts'), findsOneWidget);
    expect(find.text('Less spice'), findsOneWidget);
    // the days folded but today, which shows its special dinner
    expect(find.byType(ExpansionTile), findsNWidgets(8)); // seven days and the meals to rate
    expect(find.text('${s.dayShort(day(0))} · Today'), findsOneWidget);
    expect(find.text('Special: Festival dinner'), findsOneWidget);
    // today's dinner: in the summary's meals of today and in today's menu
    expect(find.text('Dal, rice, roti'), findsNWidgets(2));
    // the meals of the last three days to rate, folded with how many are left
    expect(find.text('1 of 2 to rate'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('rateMeals')));
    expect(find.text('★★★★'), findsOneWidget);
    expect(find.text('Tasty'), findsOneWidget);
    expect(find.byKey(Key('rateMeal-11-${day(0)}')), findsOneWidget);

    await tab(tester, 'complaints');
    expect(find.text(s.hostelComplaintsHelp), findsOneWidget);
    expect(find.text('Fan not working'), findsOneWidget);
    expect(
      find.text('HC-3 · Room and furniture · ${s.date(DateTime.parse(at(-2, 9)).toLocal())}'),
      findsOneWidget,
    );
    expect(find.text('Being worked on'), findsOneWidget);
    expect(find.text('Leaking tap'), findsNothing);
    await tapIn(tester, find.byKey(const Key('closedComplaints')));
    expect(find.text('Leaking tap'), findsOneWidget);
    expect(find.text('Resolution: Tap replaced'), findsOneWidget);
    expect(find.text('Closed'), findsOneWidget);

    await tab(tester, 'notes');
    expect(find.text('Health'), findsOneWidget);
    expect(find.text('Mild fever at night'), findsOneWidget);
    expect(find.text('Action taken: Seen by the nurse'), findsOneWidget);

    await tab(tester, 'leaving');
    expect(find.text('Request · last day ${s.dayShort(day(30))}'), findsOneWidget);
    expect(find.text('Moving closer to school'), findsOneWidget);
    expect(find.text('Waiting for the office'), findsOneWidget);
    expect(find.byKey(const Key('takeBack-21')), findsOneWidget);
    // a request waits: no new one until it is answered or taken back
    expect(find.byKey(const Key('askExit')), findsNothing);
    expect(find.text('Hostel withdrawal · last day ${s.dayShort('2025-03-31')}'), findsOneWidget);
    expect(find.text('Left the hostel'), findsOneWidget);
    // the declined request folded, with the office's answer
    expect(find.text('The hostel office replied: Dues pending'), findsNothing);
    await tapIn(tester, find.byKey(const Key('earlierExit')));
    expect(find.text('The hostel office replied: Dues pending'), findsOneWidget);
    expect(find.text('Not taken up'), findsOneWidget);
    // the clearance certificate: View and Download, no file name; it opens in the app
    expect(find.byKey(const Key('download-clearance-15')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('view-clearance-15')));
    expect(run.calls('GET', '/hostel/mine/withdrawals/15/certificate'), isNotEmpty);
  });

  testWidgets('adding a visitor sends the name, relation, mobile and photo as the website does', (
    tester,
  ) async {
    await tall(tester);
    final run = await pumpHostel(tester, Hostel());
    await tab(tester, 'visitors');
    await tapIn(tester, find.byKey(const Key('addVisitor')));
    await tester.enterText(find.byKey(const Key('visitorName')), 'Asha Verma');
    await tester.enterText(find.byKey(const Key('visitorRelation')), 'Aunt');
    await tester.enterText(find.byKey(const Key('visitorMobile')), '12345');
    await tester.tap(find.byKey(const Key('sendVisitor')));
    await tester.pumpAndSettle();
    expect(find.text(s.hostelMobileWrong), findsOneWidget);
    // a photo too big for the gate is refused before anything is sent
    run.photo = PickedFile(
      name: 'big.jpg',
      bytes: List<int>.filled(300001, 1),
      contentType: 'image/jpeg',
    );
    await tester.tap(find.byKey(const Key('visitorPhoto')));
    await tester.pumpAndSettle();
    expect(find.text(s.hostelPhotoBad), findsOneWidget);
    expect(find.byKey(const Key('visitorPhotoPreview')), findsNothing);
    expect(run.calls('POST', '/hostel/mine/visitors'), isEmpty);
    // a right one
    run.photo = PickedFile(name: 'aunt.jpg', bytes: photoBytes, contentType: 'image/jpeg');
    await tester.tap(find.byKey(const Key('visitorPhoto')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('visitorPhotoPreview')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('visitorMobile')), '9876500011');
    await tester.tap(find.byKey(const Key('sendVisitor')));
    await tester.pumpAndSettle();
    expect(run.calls('POST', '/hostel/mine/visitors').single.body, {
      'studentId': '41',
      'name': 'Asha Verma',
      'relation': 'Aunt',
      'mobile': '9876500011',
      'photo': 'data:image/jpeg;base64,${base64Encode(photoBytes)}',
    });
    // back on the page: the website's message, the list loaded again
    expect(find.byKey(const Key('visitorName')), findsNothing);
    expect(find.text(s.hostelAdded), findsOneWidget);
    expect(run.calls('GET', '/hostel/mine/visitors').length, 2);
  });

  testWidgets('removing a visitor asks first, then sends the removal', (tester) async {
    await tall(tester);
    final run = await pumpHostel(tester, Hostel());
    await tab(tester, 'visitors');
    await tapIn(tester, find.byKey(const Key('removeVisitor-72')));
    expect(find.text(s.hostelRemoveAsk('Dev Verma')), findsOneWidget);
    await tester.tap(find.text(s.close));
    await tester.pumpAndSettle();
    expect(run.calls('DELETE', '/hostel/mine/visitors/72'), isEmpty);
    await tapIn(tester, find.byKey(const Key('removeVisitor-72')));
    await tester.tap(find.byKey(const Key('confirmRemoveVisitor')));
    await tester.pumpAndSettle();
    expect(run.calls('DELETE', '/hostel/mine/visitors/72'), hasLength(1));
    expect(find.text(s.hostelRemoved), findsOneWidget);
  });

  testWidgets('rating a meal sends the meal, the day, the stars and the comment', (tester) async {
    await tall(tester);
    final run = await pumpHostel(tester, Hostel());
    await tab(tester, 'mess');
    await tapIn(tester, find.byKey(const Key('rateMeals')));
    await tapIn(tester, find.byKey(Key('rateMeal-11-${day(0)}')));
    // no stars chosen: asked to choose
    await tester.tap(find.byKey(const Key('sendRating')));
    await tester.pumpAndSettle();
    expect(find.text(s.hostelChooseRating), findsOneWidget);
    await tester.tap(find.byKey(const Key('star-5')));
    await tester.pumpAndSettle();
    expect(find.text('5 of 5: very good'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('rateComment')), 'Hot and fresh');
    await tester.tap(find.byKey(const Key('sendRating')));
    await tester.pumpAndSettle();
    expect(run.calls('POST', '/hostel/mine/feedback').single.body, {
      'studentId': '41',
      'mealId': '11',
      'onDate': day(0),
      'rating': 5,
      'comment': 'Hot and fresh',
    });
    expect(find.text(s.hostelRated), findsOneWidget);
    // a rated meal keeps its rating to change; a cleared comment clears it
    await tapIn(tester, find.byKey(const Key('rateMeals')));
    await tapIn(tester, find.byKey(Key('rateMeal-12-${day(-1)}')));
    expect(find.text('4 of 5: good'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('rateComment')), '');
    await tester.tap(find.byKey(const Key('sendRating')));
    await tester.pumpAndSettle();
    expect(run.calls('POST', '/hostel/mine/feedback').last.body, {
      'studentId': '41',
      'mealId': '12',
      'onDate': day(-1),
      'rating': 4,
    });
  });

  testWidgets('the mess menu goes a week back and forward, and back to this week', (tester) async {
    await tall(tester);
    final run = await pumpHostel(tester, Hostel());
    await tab(tester, 'mess');
    await tester.tap(find.byKey(const Key('nextWeek')));
    await tester.pumpAndSettle();
    final next = ymd(DateTime(monday.year, monday.month, monday.day + 7));
    expect(run.calls('GET', '/hostel/mine/menu').last.query, {'studentId': '41', 'weekOf': next});
    expect(find.text('Week of ${s.dayShort(next)}'), findsOneWidget);
    // another week: every day folded, its own menu
    await tapIn(tester, find.byKey(Key('menuDay-$next')));
    expect(find.text('Upma, tea'), findsOneWidget);
    await tester.tap(find.byKey(const Key('prevWeek')));
    await tester.pumpAndSettle();
    expect(run.calls('GET', '/hostel/mine/menu').last.query, {
      'studentId': '41',
      'weekOf': ymd(monday),
    });
    await tester.tap(find.byKey(const Key('prevWeek')));
    await tester.pumpAndSettle();
    final before = ymd(DateTime(monday.year, monday.month, monday.day - 7));
    expect(find.text('Week of ${s.dayShort(before)}'), findsOneWidget);
    await tester.tap(find.byKey(const Key('thisWeek')));
    await tester.pumpAndSettle();
    expect(find.text('Week of ${s.dayShort(ymd(monday))}'), findsOneWidget);
    expect(find.text('Special: Festival dinner'), findsOneWidget);
  });

  testWidgets('raising a complaint sends the head (type to search), the subject and the details', (
    tester,
  ) async {
    await tall(tester);
    final run = await pumpHostel(tester, Hostel());
    await tab(tester, 'complaints');
    await tapIn(tester, find.byKey(const Key('raiseComplaint')));
    await tester.enterText(find.byKey(const Key('complaintSubject')), 'No hot water');
    await tester.tap(find.byKey(const Key('sendComplaint')));
    await tester.pumpAndSettle();
    expect(find.text(s.hostelChooseHead), findsOneWidget);
    await tester.tap(find.byKey(const Key('complaintHead')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Water').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('complaintBody')),
      'The geyser on the first floor is off.',
    );
    await tester.tap(find.byKey(const Key('sendComplaint')));
    await tester.pumpAndSettle();
    expect(run.calls('POST', '/hostel/mine/complaints').single.body, {
      'studentId': '41',
      'categoryCode': 'water',
      'subject': 'No hot water',
      'body': 'The geyser on the first floor is off.',
    });
    expect(find.text(s.hostelComplaintRaised), findsOneWidget);
    expect(run.calls('GET', '/hostel/mine/complaints').length, 2);
  });

  testWidgets('leaving the hostel: ask with the last day, reason and note; take a request back', (
    tester,
  ) async {
    await tall(tester);
    final h = Hostel()..pendingExit = false;
    final run = await pumpHostel(tester, h);
    await tab(tester, 'leaving');
    expect(find.text(s.hostelExitHelp), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('askExit')));
    // the last day is needed
    await tester.tap(find.byKey(const Key('sendExit')));
    await tester.pumpAndSettle();
    expect(find.text(s.hostelChooseDay), findsOneWidget);
    // the request form's tap targets, labels and contrast
    final handle = tester.ensureSemantics();
    for (final g in [
      androidTapTargetGuideline,
      iOSTapTargetGuideline,
      labeledTapTargetGuideline,
      textContrastGuideline,
    ]) {
      await expectLater(tester, meetsGuideline(g), reason: 'exit form: ${g.description}');
    }
    handle.dispose();
    await tester.tap(find.byKey(const Key('exitDay')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('${s.hostelLastDay}: ${s.date(DateTime.parse(day(0)))}'), findsOneWidget);
    // the reason, type to search (our own reasons unless chosen)
    await tester.tap(find.byKey(const Key('exitReason')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Health').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('exitNote')), 'Doctor advised home food');
    await tester.tap(find.byKey(const Key('sendExit')));
    await tester.pumpAndSettle();
    expect(run.calls('POST', '/hostel/mine/exit').single.body, {
      'studentId': '41',
      'leavingOn': day(0),
      'reason': 'health',
      'note': 'Doctor advised home food',
    });
    expect(find.text(s.hostelExitSent), findsOneWidget);

    // a request waiting: taken back after a yes
    h.pendingExit = true;
    run.t.calls.clear();
    await tester.pumpWidget(const SizedBox());
    final again = await pumpHostel(tester, h);
    await tab(tester, 'leaving');
    await tapIn(tester, find.byKey(const Key('takeBack-21')));
    expect(find.text(s.hostelTakeBackAsk), findsOneWidget);
    await tester.tap(find.byKey(const Key('confirmTakeBack')));
    await tester.pumpAndSettle();
    final w = again.calls('POST', '/hostel/mine/exit/21/withdraw').single;
    expect(w.body, isNull);
    expect(find.text(s.hostelTakenBack), findsOneWidget);
  });

  testWidgets(
    'not in the hostel: when the child left, the fee month and the clearance certificate',
    (tester) async {
      await tall(tester);
      final run = await pumpHostel(
        tester,
        Hostel()
          ..boards = false
          ..left = true,
      );
      expect(find.byKey(const Key('hostelNone')), findsOneWidget);
      expect(
        find.text('Your child left the hostel on ${s.date('2026-10-31')} (Tagore House).'),
        findsOneWidget,
      );
      expect(find.text('The hostel fee is charged up to October 2026.'), findsOneWidget);
      expect(find.byKey(const Key('view-clearance-16')), findsOneWidget);
      expect(find.byKey(const Key('download-clearance-16')), findsOneWidget);
      // no figures, no parts, and only the calls the website makes for a child who does not board
      expect(find.byType(FigureTile), findsNothing);
      expect(find.byKey(const Key('hostelTab-leave')), findsNothing);
      expect(run.calls('GET', '/hostel/mine/visitors'), isEmpty);
      expect(run.calls('GET', '/hostel/mine/complaints'), isEmpty);
      await tester.tap(find.byKey(const Key('view-clearance-16')));
      await tester.pumpAndSettle();
      expect(run.calls('GET', '/hostel/mine/withdrawals/16/certificate'), isNotEmpty);
    },
  );

  testWidgets('never boarded: the website\'s line, nothing else', (tester) async {
    await tall(tester);
    await pumpHostel(tester, Hostel()..boards = false);
    expect(find.text(s.hostelNotBoarder), findsOneWidget);
    expect(find.text(s.hostelClearance), findsNothing);
  });

  testWidgets('without the summary (the API refuses it) the page shows the rest, two figures', (
    tester,
  ) async {
    await tall(tester);
    await pumpHostel(tester, Hostel()..summaryFails = true);
    expect(find.text('Tagore House'), findsOneWidget);
    expect(find.byType(FigureTile), findsNWidgets(2));
    expect(find.byKey(const Key('hostelSummary')), findsNothing);
    expect(find.text(s.hostelNoPasses), findsOneWidget);
    await tab(tester, 'visitors');
    expect(find.text('Sunil Sample'), findsOneWidget);
  });

  testWidgets('in Hindi', (tester) async {
    await tall(tester);
    await pumpHostel(tester, Hostel(), hindi: true);
    const hi = S(true);
    expect(find.text(hi.hostelIntro), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('hostelFigures')),
        matching: find.text('छात्रावास में'),
      ),
      findsOneWidget,
    );
    expect(find.text('पिछली हाज़िरी: उपस्थित · Night ${hi.dayShort(day(-1))}'), findsOneWidget);
    expect(find.text('नाश्ता · 07:30'), findsOneWidget);
    await tab(tester, 'visitors');
    expect(find.text('पिता · 9800000001'), findsOneWidget);
    await tab(tester, 'mess');
    expect(find.text('शाकाहारी · बिना प्याज़-लहसुन'), findsOneWidget);
  });

  testWidgets('large text (twice the size): every part and form lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tall(tester, const Size(360, 780));
    await pumpHostel(tester, Hostel()..pendingExit = false);
    expect(tester.takeException(), isNull);
    expect(MediaQuery.of(tester.element(find.byType(HostelScreen))).textScaler.scale(10), 20);
    for (final t in ['leave', 'visitors', 'mess', 'complaints', 'notes', 'leaving']) {
      await reach(tester, find.byKey(Key('hostelTab-$t')));
      await tester.tap(find.byKey(Key('hostelTab-$t')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: t);
      // down the whole part
      await tester.drag(find.byType(ListView).first, const Offset(0, -4000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: '$t, the end');
    }
    // the forms
    for (final (t, button) in [
      ('visitors', 'addVisitor'),
      ('complaints', 'raiseComplaint'),
      ('leaving', 'askExit'),
    ]) {
      await reach(tester, find.byKey(Key('hostelTab-$t')));
      await tester.tap(find.byKey(Key('hostelTab-$t')));
      await tester.pumpAndSettle();
      await tapIn(tester, find.byKey(Key(button)));
      expect(tester.takeException(), isNull, reason: button);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
    }
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''}): tap targets, labelled controls '
      'and text contrast on the main view and every part',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        await tall(tester);
        final handle = tester.ensureSemantics();
        await pumpHostel(tester, Hostel(), hindi: hindi);
        Future<void> check(String where) async {
          await tester.pumpAndSettle();
          for (final g in [
            androidTapTargetGuideline,
            iOSTapTargetGuideline,
            labeledTapTargetGuideline,
            textContrastGuideline,
          ]) {
            await expectLater(tester, meetsGuideline(g), reason: '$where: ${g.description}');
          }
        }

        await check('main view');
        await tapIn(tester, find.byKey(const Key('earlierPasses')));
        await check('leave, earlier passes open');
        for (final t in ['visitors', 'mess', 'complaints', 'notes', 'leaving']) {
          await tab(tester, t);
          await check(t);
        }
        await tapIn(tester, find.byKey(const Key('earlierExit')));
        await check('leaving, earlier open');
        // the forms (light only: the same widgets in each run)
        if (!dark && !hindi) {
          for (final (t, open, where) in [
            ('visitors', 'addVisitor', 'add a visitor'),
            ('complaints', 'raiseComplaint', 'raise a complaint'),
            ('mess', 'rateMeals', 'rate a meal'),
          ]) {
            await tab(tester, t);
            await tapIn(tester, find.byKey(Key(open)));
            if (open == 'rateMeals') {
              await check('mess, meals to rate open');
              await tapIn(tester, find.byKey(Key('rateMeal-12-${day(-1)}')));
            }
            await check(where);
            await tester.tap(find.byType(BackButton));
            await tester.pumpAndSettle();
          }
        }
        handle.dispose();
      },
    );
  }
}
