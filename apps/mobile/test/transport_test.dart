import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/data.dart';
import 'package:edupro/family/transport.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// The School bus screen against a made-up school. Every name, number and place here is made up.
final now = DateTime.now();
String month(int k) => ym(DateTime(now.year, now.month + k));
String ago(Duration d) => now.subtract(d).toUtc().toIso8601String();

const kid = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);

Map<String, Object?> period(
  String id, {
  required String phase,
  required String stop,
  required int from,
  required int to,
  num amount = 1800,
  String slab = 'Slab A',
}) => {
  'id': id,
  'service': 'both',
  'serviceLabel': 'Pick and drop',
  'pickRoute': 'R1 North loop',
  'pickStop': stop,
  'pickTime': '07:25',
  'dropRoute': 'R1 North loop',
  'dropStop': stop,
  'dropTime': '14:10',
  'vehicle': 'RJ14 PA 1234',
  'slab': slab,
  'monthlyAmount': amount,
  'fromMonth': month(from),
  'toMonth': month(to),
  'status': 'active',
  'phase': phase,
};

/// What the fake API answers for the bus.
class Bus {
  Bus({this.riding = true, this.pending = true, this.denied = false, this.replacement = false});

  /// the child rides now (otherwise: no transport, no requests, no taps)
  bool riding;

  /// a request waits for a decision
  bool pending;

  /// the account may not see the bus (the website's "not linked")
  bool denied;

  /// a replacement bus runs the route today
  bool replacement;

  dynamic answer(Call c) {
    switch ('${c.method} ${c.path}') {
      case 'GET /attendance/bus/mine':
        if (denied) throw const ApiException(403, 'forbidden', 'Not allowed');
        return {
          'date': ymd(now),
          'children': [
            {
              'id': '41',
              'name': 'Kid Sample',
              'section': 'VI-A',
              'events': riding
                  ? [
                      {
                        'id': 't1',
                        'occurredAt': ago(Duration.zero),
                        'outcome': 'boarded',
                        'route': 'R1',
                        'lat': '26.9200',
                        'lng': '75.7873',
                      },
                      {
                        'id': 't2',
                        'occurredAt': ago(const Duration(days: 2)),
                        'outcome': 'alighted',
                        'route': 'R1',
                        'lat': null,
                        'lng': null,
                      },
                      {
                        'id': 't3',
                        'occurredAt': ago(const Duration(days: 3)),
                        'outcome': 'boarded',
                        'route': 'R1',
                        'lat': null,
                        'lng': null,
                      },
                    ]
                  : [],
            },
          ],
        };
      case 'GET /transport/requests/mine':
        return {
          'canApply': true,
          'children': [
            {
              'id': '41',
              'name': 'Kid Sample',
              'section': 'VI-A',
              'current': riding
                  ? period('p1', phase: 'running', stop: 'Gandhi Nagar gate', from: -2, to: 4)
                  : null,
              'incharge': riding
                  ? [
                      {'name': 'Mr Sample Incharge', 'mobile': '90000 00001'},
                    ]
                  : [],
              'periods': riding
                  ? [
                      period('p1', phase: 'running', stop: 'Gandhi Nagar gate', from: -2, to: 4),
                      period(
                        'p0',
                        phase: 'over',
                        stop: 'Old market',
                        from: -6,
                        to: -3,
                        amount: 1500,
                        slab: 'Slab B',
                      ),
                    ]
                  : [],
              'requests': riding
                  ? [
                      {
                        'id': '501',
                        'number': 'TR-2611-0501',
                        'kind': 'change',
                        'service': 'pick',
                        'pickRoute': 'R2 South loop',
                        'pickStop': 'Lake view',
                        'dropRoute': null,
                        'dropStop': null,
                        'monthlyAmount': 900,
                        'fromMonth': month(1),
                        'toMonth': month(4),
                        'status': pending ? 'pending' : 'cancelled',
                        'waitingOn': pending ? 'Transport in-charge' : null,
                        'requestedAt': ago(const Duration(days: 1)),
                        'decisionNote': pending ? null : 'Cancelled by the family',
                      },
                      {
                        'id': '401',
                        'number': 'TR-2609-0401',
                        'kind': 'join',
                        'service': 'both',
                        'pickRoute': 'R1 North loop',
                        'pickStop': 'Gandhi Nagar gate',
                        'dropRoute': 'R1 North loop',
                        'dropStop': 'Gandhi Nagar gate',
                        'monthlyAmount': 1800,
                        'fromMonth': month(-2),
                        'toMonth': month(4),
                        'status': 'approved',
                        'waitingOn': null,
                        'requestedAt': ago(const Duration(days: 70)),
                        'decisionNote': 'Welcome aboard',
                      },
                    ]
                  : [],
            },
            {
              'id': '99',
              'name': 'Another Child',
              'section': 'II-B',
              'current': null,
              'incharge': [],
              'periods': [],
              'requests': [
                {
                  'id': '777',
                  'number': 'TR-OTHER-0777',
                  'kind': 'join',
                  'service': 'both',
                  'status': 'pending',
                  'requestedAt': ago(const Duration(days: 1)),
                },
              ],
            },
          ],
        };
      case 'GET /transport/gps/mine':
        return {
          'children': [
            {
              'student': {'id': '41', 'name': 'Kid Sample'},
              'route': riding
                  ? {
                      'code': 'R1',
                      'name': 'North loop',
                      'stop': 'Gandhi Nagar gate',
                      'pickup': '07:25',
                      'stopLat': '26.9124',
                      'stopLng': '75.7873',
                    }
                  : null,
              'vehicle': riding ? {'id': 'v1', 'regNo': 'RJ14 PA 1234'} : null,
              'upcoming': null,
              'replacement': riding && replacement
                  ? {
                      'regular': 'RJ14 PA 9999',
                      'until': ymd(now.add(const Duration(days: 3))),
                      'reason': 'Service',
                      'driver': 'Mr Sample Driver',
                      'driverMobile': '90000 00002',
                    }
                  : null,
              'position': riding
                  ? {
                      'recordedAt': ago(const Duration(minutes: 3)),
                      'lat': '26.9200',
                      'lng': '75.7873',
                      'speedKmh': '32.4',
                      'ageSeconds': 180,
                    }
                  : null,
            },
          ],
        };
      case 'GET /attendance/bus-roll/mine':
        return {
          'children': [
            {
              'id': '41',
              'days': riding
                  ? [
                      {'date': ymd(now), 'route': 'R1', 'pick': 'P', 'drop': null},
                    ]
                  : [],
              'summary': {'onBus': riding ? 17 : 0, 'trips': riding ? 18 : 0},
            },
          ],
        };
      case 'GET /transport/requests/mine/options':
        return {
          'settings': {'oneWayPercent': 60, 'twoStopRule': 'higher'},
          'routes': [
            {
              'id': '11',
              'code': 'R1',
              'name': 'North loop',
              'vehicle': 'RJ14 PA 1234',
              'stops': [
                {
                  'id': '1101',
                  'name': 'Gandhi Nagar gate',
                  'pickupTime': '07:25',
                  'dropTime': '14:10',
                  'slab': 'Slab A',
                  'amount': 1800,
                },
                {
                  'id': '1102',
                  'name': 'Clock tower',
                  'pickupTime': '07:35',
                  'dropTime': '14:00',
                  'slab': null,
                  'amount': null,
                },
              ],
            },
            {
              'id': '12',
              'code': 'R2',
              'name': 'South loop',
              'vehicle': null,
              'stops': [
                {
                  'id': '1201',
                  'name': 'Lake view',
                  'pickupTime': '07:15',
                  'dropTime': '14:20',
                  'slab': 'Slab B',
                  'amount': 1500,
                },
              ],
            },
          ],
          'months': [month(-1), month(0), month(1), month(2), month(3)],
          'thisMonth': month(0),
          'riding': riding,
          'students': [
            {'id': '41', 'name': 'Kid Sample', 'section': 'VI-A'},
          ],
          'canApply': true,
        };
      case 'POST /transport/requests/mine':
        pending = true;
        return {'id': '601'};
      case 'POST /transport/requests/mine/501/cancel':
        pending = false;
        return {'id': '501'};
    }
    throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
  }
}

/// The links the screen opened (maps, calls).
final opened = <Uri>[];

Future<FakeTransport> pumpBus(
  WidgetTester tester,
  Bus bus, {
  bool hindi = false,
  double scale = 1,
  Size size = const Size(400, 2600),
}) async {
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  opened.clear();
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final t = FakeTransport(bus.answer);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        transportProvider.overrideWithValue(t),
        stringsProvider.overrideWithValue(S(hindi)),
        busLinkProvider.overrideWithValue((u) async {
          opened.add(u);
          return true;
        }),
      ],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: FamilyPage(
          title: S(hindi).busTransportTitle,
          child: const TransportScreen(profile: kid),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

/// Picks an entry of a type-to-search list.
Future<void> choose(WidgetTester tester, String key, String entry) async {
  await reach(tester, find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.text(entry).last);
  await tester.pumpAndSettle();
}

/// A figure tile with its label and value.
void expectFigure(String label, String value) {
  final tile = find.ancestor(
    of: find.descendant(of: find.byKey(const Key('busFigures')), matching: find.text(label)),
    matching: find.byType(FigureTile),
  );
  expect(
    find.descendant(of: tile, matching: find.text(value)),
    findsOneWidget,
    reason: label,
  );
}

/// Brings a part into view (a long list builds only what is near the screen): down first, then up.
Future<void> reach(WidgetTester tester, Finder f) async {
  if (f.evaluate().isEmpty) {
    final list = find.byType(ListView).last;
    try {
      await tester.dragUntilVisible(f, list, const Offset(0, -300), maxIteration: 30);
    } on StateError {
      await tester.dragUntilVisible(f, list, const Offset(0, 300), maxIteration: 60);
    }
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

Future<void> tapKey(WidgetTester tester, String key) async {
  await reach(tester, find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  const s = S(false);

  testWidgets('the route, the stop, the bus, the staff and the live position as facts', (
    tester,
  ) async {
    final t = await pumpBus(tester, Bus(replacement: true));
    // the figures first: route, bus, the charge, until when, the month's trips, today's taps
    final validUntil = DateTime(now.year, now.month + 4);
    for (final (label, value) in [
      (s.route, 'R1'),
      (s.busBusWord, 'RJ14 PA 1234'),
      (s.busMonthlyFig, '₹1,800'),
      (s.busValidFig, '${s.monthShort(validUntil)} ${validUntil.year}'),
      (s.busTripsFig, '17/18'),
      (s.busTapsTodayFig, '1'),
    ]) {
      expectFigure(label, value);
    }
    // the live bus: the route and the stop, the replacement bus, last seen, the speed, how far from the stop
    expect(find.text('R1 · North loop · Gandhi Nagar gate · 07:25'), findsOneWidget);
    expect(find.byKey(const Key('busReplacement')), findsOneWidget);
    expect(
      find.textContaining('Replacement bus RJ14 PA 1234 runs this route in place of RJ14 PA 9999'),
      findsOneWidget,
    );
    expect(find.textContaining('3 min ago'), findsOneWidget);
    expect(find.text('32 km/h'), findsOneWidget);
    expect(find.text('About 850 m'), findsOneWidget);
    await tester.tap(find.byKey(const Key('busOpenMap')));
    await tester.pumpAndSettle();
    expect(opened.last.host, 'www.google.com');
    expect(opened.last.queryParameters['query'], '26.9200,75.7873');
    await tester.tap(find.byKey(const Key('busCallDriver')));
    await tester.pumpAndSettle();
    expect(opened.last.toString(), 'tel:9000000002');
    // the transport as approved: service, slab and charge, until when, the ride, the in-charge to call
    expect(find.textContaining('Pick and drop'), findsWidgets);
    expect(
      find.text('Pick: Gandhi Nagar gate · R1 North loop · 07:25 · RJ14 PA 1234'),
      findsOneWidget,
    );
    expect(
      find.text('Drop: Gandhi Nagar gate · R1 North loop · 14:10 · RJ14 PA 1234'),
      findsOneWidget,
    );
    expect(find.text('Mr Sample Incharge'), findsOneWidget);
    await tester.tap(find.byKey(const Key('busCall-0')));
    await tester.pumpAndSettle();
    expect(opened.last.toString(), 'tel:9000000001');
    // today: the bus roll's morning and afternoon, today's tap with its place; the week folded
    expect(find.text('${s.morning}: ${s.busCode('P')}'), findsOneWidget);
    expect(find.text('${s.afternoon}: —'), findsOneWidget);
    expect(find.byKey(const Key('busTap-t1')), findsOneWidget);
    expect(find.byKey(const Key('busTap-t2')), findsNothing);
    await tester.tap(find.byKey(const Key('busTapMap-t1')));
    await tester.pumpAndSettle();
    expect(opened.last.queryParameters['query'], '26.9200,75.7873');
    await tapKey(tester, 'busEarlier');
    expect(find.byKey(const Key('busTap-t2')), findsOneWidget);
    expect(find.byKey(const Key('busTap-t3')), findsOneWidget);
    expect(find.byKey(const Key('busTapMap-t2')), findsNothing);
    // the history, folded until tapped
    expect(find.byKey(const Key('busPeriod-p0')), findsNothing);
    await tapKey(tester, 'busHistory');
    expect(find.byKey(const Key('busPeriod-p0')), findsOneWidget);
    expect(find.text(s.busPhase('over')), findsOneWidget);
    // the taps are the last week's (no date asked: as the website)
    final call = t.calls.firstWhere((c) => c.path == '/attendance/bus/mine');
    expect(call.query, isEmpty);
  });

  testWidgets('the requests with their status; the one waiting is cancelled after a confirm', (
    tester,
  ) async {
    final t = await pumpBus(tester, Bus());
    // the request waiting: what it asks, the charge, with whom; no new request while it waits
    final box = find.byKey(const Key('busPending'));
    expect(find.descendant(of: box, matching: find.textContaining('TR-2611-0501')), findsOneWidget);
    expect(
      find.descendant(
        of: box,
        matching: find.textContaining('Pick only: Lake view (R2 South loop)'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(of: box, matching: find.text('Waiting with Transport in-charge')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('busApply')), findsNothing);
    // the other child's request is not this child's
    expect(find.textContaining('TR-OTHER-0777'), findsNothing);
    // all the requests, folded, with their status and the school's note
    await tapKey(tester, 'busRequests');
    expect(find.byKey(const Key('busRequest-501')), findsOneWidget);
    expect(find.byKey(const Key('busRequest-401')), findsOneWidget);
    expect(find.text(s.busStatus('pending')), findsOneWidget);
    expect(find.text(s.busStatus('approved')), findsOneWidget);
    expect(find.text(s.noteFromSchool('Welcome aboard')), findsOneWidget);
    // asked, then not: nothing is sent
    await tapKey(tester, 'busCancel-501');
    expect(find.text(s.busCancelAsk), findsOneWidget);
    await tester.tap(find.text(s.close));
    await tester.pumpAndSettle();
    expect(t.calls.where((c) => c.method == 'POST'), isEmpty);
    // confirmed: cancelled, the screen loads again
    await tapKey(tester, 'busCancel-501');
    await tester.tap(find.byKey(const Key('busConfirmCancel')));
    await tester.pumpAndSettle();
    expect(
      t.calls.where((c) => c.method == 'POST').single.path,
      '/transport/requests/mine/501/cancel',
    );
    expect(find.text(s.busCancelled), findsOneWidget);
    expect(find.byKey(const Key('busPending')), findsNothing);
    expect(find.text(s.busChangeOrStop), findsOneWidget);
  });

  testWidgets('a change of route sends the stoppage and the months the API offers', (tester) async {
    final t = await pumpBus(tester, Bus(pending: false), size: const Size(400, 1600));
    await tapKey(tester, 'busApply');
    expect(find.text(s.busApplyTitle), findsOneWidget);
    expect(t.calls.lastWhere((c) => c.path == '/transport/requests/mine/options').query, {
      'studentId': '41',
    }, reason: 'the options are the child\'s');
    // riding: a change by default; pick and drop by default
    expect(find.text(s.busDoChange), findsOneWidget);
    expect(find.text(s.busChooseToSee), findsOneWidget);
    // nothing chosen: told, nothing sent
    await tapKey(tester, 'busSend');
    expect(find.text(s.busChoosePick), findsOneWidget);
    await choose(tester, 'busPickRoute', 'R2 · South loop');
    await choose(tester, 'busPickStop', 'Lake view · 07:15 · Slab B ₹1,500');
    expect(find.textContaining(s.busQuote('Slab B', '₹1,500')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('busNote')), 'From next month please');
    await tapKey(tester, 'busSend');
    final sent = t.calls.lastWhere(
      (c) => c.method == 'POST' && c.path == '/transport/requests/mine',
    );
    expect(sent.body, {
      'studentId': '41',
      'kind': 'change',
      'service': 'both',
      'pickRouteId': '12',
      'pickStopId': '1201',
      'fromMonth': month(1),
      'toMonth': month(3),
      'note': 'From next month please',
    });
    // back on the screen: told, and the request waits
    expect(find.text(s.busApplyTitle), findsNothing);
    expect(find.text(s.busRequested), findsOneWidget);
    expect(find.byKey(const Key('busPending')), findsOneWidget);
  });

  testWidgets('a withdrawal sends only the first month without the bus', (tester) async {
    final t = await pumpBus(tester, Bus(pending: false), size: const Size(400, 1600));
    await tapKey(tester, 'busApply');
    await tapKey(tester, 'busKind-leave');
    expect(find.text(s.busServiceLabel), findsNothing);
    expect(find.text(s.busLeaveFromLabel), findsWidgets);
    await choose(
      tester,
      'busFrom',
      '${s.monthShort(DateTime(now.year, now.month + 2))} ${DateTime(now.year, now.month + 2).year}',
    );
    await tapKey(tester, 'busSend');
    final sent = t.calls.lastWhere((c) => c.method == 'POST');
    expect(sent.body, {'studentId': '41', 'kind': 'leave', 'fromMonth': month(2)});
  });

  testWidgets('no transport: told so, applying for a drop only with its one-way charge', (
    tester,
  ) async {
    final t = await pumpBus(
      tester,
      Bus(riding: false, pending: false),
      size: const Size(400, 1600),
    );
    expect(find.byKey(const Key('liveBus')), findsNothing);
    expect(find.text(s.busNotOnBus), findsOneWidget);
    expect(find.text(s.busNoTapsWeek), findsOneWidget);
    expect(find.byKey(const Key('busHistory')), findsNothing);
    expect(find.byKey(const Key('busRequests')), findsNothing);
    expectFigure(s.route, '–');
    expectFigure(s.busMonthlyFig, '–');
    expectFigure(s.busTapsTodayFig, '0');
    expect(find.text(s.busApply), findsOneWidget);
    await tapKey(tester, 'busApply');
    // not riding: no change or withdrawal to choose
    expect(find.byKey(const Key('busKind-leave')), findsNothing);
    await tapKey(tester, 'busService-drop');
    expect(find.byKey(const Key('busPickRoute')), findsNothing);
    await choose(tester, 'busDropRoute', 'R1 · North loop (RJ14 PA 1234)');
    // a stoppage with no slab: told, nothing sent
    await choose(tester, 'busDropStop', 'Clock tower · 14:00 · ${s.busNoSlab}');
    expect(find.text(s.busSlabMissing('Clock tower')), findsOneWidget);
    await tapKey(tester, 'busSend');
    expect(t.calls.where((c) => c.method == 'POST'), isEmpty);
    await choose(tester, 'busDropStop', 'Gandhi Nagar gate · 14:10 · Slab A ₹1,800');
    expect(find.textContaining(s.busQuote('Slab A', '₹1,080')), findsOneWidget);
    expect(find.textContaining(s.busRuleDrop('60')), findsOneWidget);
    await tapKey(tester, 'busSend');
    final sent = t.calls.lastWhere((c) => c.method == 'POST');
    expect(sent.body, {
      'studentId': '41',
      'kind': 'join',
      'service': 'drop',
      'dropRouteId': '11',
      'dropStopId': '1101',
      'fromMonth': month(1),
      'toMonth': month(3),
    });
  });

  testWidgets('an account that may not see the bus is told it is not linked', (tester) async {
    await pumpBus(tester, Bus(denied: true));
    expect(find.text(s.notLinked), findsOneWidget);
    expect(find.byKey(const Key('busFigures')), findsNothing);
  });

  for (final hindi in [false, true]) {
    testWidgets('large text (2×${hindi ? ', Hindi' : ''}): every part and the form fit', (
      tester,
    ) async {
      await pumpBus(tester, Bus(replacement: true), hindi: hindi, scale: 2);
      expect(tester.takeException(), isNull);
      for (final fold in ['busEarlier', 'busHistory', 'busRequests']) {
        await tapKey(tester, fold);
        expect(tester.takeException(), isNull, reason: fold);
      }
      await tapKey(tester, 'busCancel-501');
      expect(tester.takeException(), isNull, reason: 'the confirm');
      await tester.tap(find.text(S(hindi).close));
      await tester.pumpAndSettle();
    });
  }

  testWidgets('large text (2×): the request form fits', (tester) async {
    await pumpBus(tester, Bus(pending: false), scale: 2, size: const Size(400, 3200));
    await tapKey(tester, 'busApply');
    await tapKey(tester, 'busOtherDrop');
    expect(tester.takeException(), isNull);
    await choose(tester, 'busPickRoute', 'R1 · North loop (RJ14 PA 1234)');
    await choose(tester, 'busPickStop', 'Gandhi Nagar gate · 07:25 · Slab A ₹1,800');
    await choose(tester, 'busDropRoute', 'R2 · South loop');
    await choose(tester, 'busDropStop', 'Lake view · 14:20 · Slab B ₹1,500');
    expect(tester.takeException(), isNull);
    expect(find.textContaining(s.busRuleHigher), findsOneWidget);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''}): tap targets, labelled '
      'controls and text contrast',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpBus(tester, Bus(replacement: true), hindi: hindi);
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

        await check('the bus');
        for (final fold in ['busEarlier', 'busHistory', 'busRequests']) {
          await tapKey(tester, fold);
        }
        await check('the folds open');
        handle.dispose();
      },
    );
  }
}
