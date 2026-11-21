import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/appointments.dart';
import 'package:edupro/family/common.dart';
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
  detail: 'VI-A · A1234',
);

String day(int n) => DateTime.now().add(Duration(days: n)).toIso8601String().substring(0, 10);

/// A made-up school's appointments (no real names). Times are UTC as the API sends them: 04:30Z is 10:00 at school.
class School {
  bool empty = false;
  bool notLinked = false;
  bool noHosts = false;
  bool noDays = false;
  bool closedDay = false;
  bool slotTaken = false;
  final cancelled = <String>{};

  Map<String, Object?> appt(
    String id,
    String state, {
    String? hostName = 'Class teacher',
    String? withName = 'Teacher Sample',
    String? place = 'Room 4',
    String? startsAt,
    bool noTime = false,
  }) => {
    'id': id,
    'number': 'AP-$id',
    'source': 'parent',
    'state': cancelled.contains(id) ? 'cancelled' : state,
    'purpose': 'Progress in maths',
    'hostId': 'h1',
    'hostName': hostName,
    'hostKind': 'class_teacher',
    'withName': withName,
    'place': place,
    'startsAt': noTime ? null : (startsAt ?? '${day(2)}T04:30:00.000Z'),
    'endsAt': null,
    'studentId': '41',
    'student': 'Kid Sample',
    'admissionNo': 'A1234',
    'section': 'VI-A',
    'passLink': null,
  };

  Map<String, Object?> detail(Map<String, Object?> a, {List<Map<String, Object?>>? events}) {
    final live = const ['approved', 'checked_in'].contains(a['state']);
    return {
      ...a,
      'previousStartsAt': null,
      'visitorName': 'Parent Sample',
      'visitorMobile': '9000000001',
      'decisionNote': null,
      'cancelReason': a['state'] == 'cancelled' ? 'Cancelled by the parent' : null,
      'createdAt': '${day(0)}T03:30:00.000Z',
      'passCode': live ? 'PASS701' : null,
      'passQr': live ? '<svg/>' : null,
      'passBarcode': live ? '<svg/>' : null,
      'events':
          events ??
          [
            {
              'kind': 'requested',
              'at': '${day(0)}T03:30:00.000Z',
              'startsAt': null,
              'reason': null,
            },
          ],
    };
  }

  Object? answer(Call c) {
    final q = c.query ?? const {};
    switch ('${c.method} ${c.path}') {
      case 'GET /appointments/mine':
        if (notLinked) throw const ApiException(403, 'forbidden', 'Only for families');
        if (empty) {
          return {
            'data': [],
            'page': {'number': 1, 'size': 10, 'total': 0},
          };
        }
        return {
          'data': [
            appt('701', 'approved'),
            appt('702', 'requested'),
            appt(
              '703',
              'completed',
              hostName: 'Accounts desk',
              withName: null,
              place: null,
              noTime: true,
            ),
          ],
          'page': {'number': q['page'] ?? 1, 'size': 10, 'total': 12},
        };
      case 'GET /appointments/mine/hosts':
        return {
          'data': noHosts
              ? []
              : [
                  {
                    'id': 'h1',
                    'name': 'Class teacher',
                    'kind': 'class_teacher',
                    'person': 'Teacher Sample',
                    'location': 'Room 4',
                    'slotMinutes': 15,
                    'hours': [
                      for (var d = 1; d <= 5; d++)
                        {'weekday': d, 'starts': '14:00', 'ends': '15:00'},
                    ],
                  },
                  {
                    'id': 'h2',
                    'name': 'Front office',
                    'kind': 'desk',
                    'person': null,
                    'location': 'Main block',
                    'slotMinutes': 15,
                    'hours': [
                      {'weekday': 1, 'starts': '09:00', 'ends': '10:00'},
                      {'weekday': 3, 'starts': '09:00', 'ends': '10:00'},
                    ],
                  },
                  {
                    'id': 'h3',
                    'name': 'Sports desk',
                    'kind': 'desk',
                    'person': null,
                    'location': null,
                    'slotMinutes': 15,
                    'hours': [],
                  },
                ],
          'purposes': ['Progress', 'Fees'],
          'maxDaysAhead': 30,
          'instructions': 'Please come ten minutes early.',
        };
      case 'GET /appointments/mine/days':
        if (noDays) {
          return {
            'data': [],
            'note': 'No free time in the next 30 days. Please try another person or desk.',
          };
        }
        return {
          'data': [
            {'date': day(1), 'free': 1},
            {'date': day(2), 'free': 3},
          ],
          'note': null,
        };
      case 'GET /appointments/mine/slots':
        if (closedDay) return {'closed': 'The school is closed: Sample Holiday.', 'slots': []};
        final date = '${q['date']}';
        return {
          'closed': null,
          'slots': [
            {'time': '14:00', 'startsAt': '${date}T14:00', 'free': 0, 'available': false},
            {'time': '14:15', 'startsAt': '${date}T14:15', 'free': 1, 'available': true},
            {'time': '14:30', 'startsAt': '${date}T14:30', 'free': 1, 'available': true},
          ],
        };
      case 'POST /appointments/mine':
        if (slotTaken) {
          throw const ApiException(409, 'appointment.slot_taken', 'That time was just taken.');
        }
        return {'id': '900', 'number': 'AP-900', 'state': 'requested'};
      case 'GET /appointments/mine/701':
        return {
          ...detail(
            appt('701', 'approved'),
            events: [
              {
                'kind': 'requested',
                'at': '${day(0)}T03:30:00.000Z',
                'startsAt': null,
                'reason': null,
              },
              {
                'kind': 'approved',
                'at': '${day(0)}T05:00:00.000Z',
                'startsAt': null,
                'reason': null,
              },
              {
                'kind': 'rescheduled',
                'at': '${day(0)}T06:00:00.000Z',
                'startsAt': '${day(2)}T10:00',
                'reason': 'Teacher in a meeting',
              },
            ],
          ),
          'previousStartsAt': '${day(1)}T05:30:00.000Z',
          'decisionNote': cancelled.contains('701') ? null : 'Please bring the diary.',
        };
      case 'GET /appointments/mine/703':
        return detail(
          appt('703', 'completed', hostName: 'Accounts desk', withName: null, noTime: true),
        );
      case 'GET /appointments/mine/900':
        return detail(appt('900', 'requested', startsAt: '${day(2)}T09:00:00.000Z'));
      case 'GET /appointments/mine/701/card':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/octet-stream',
          name: 'visitor-card-AP-701.pdf',
        );
      case 'POST /appointments/mine/701/cancel':
      case 'POST /appointments/mine/702/cancel':
        cancelled.add(c.path.split('/')[3]);
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
    // a new scope each time: nothing kept from the screen pumped before
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
        home: FamilyPage(title: 'Appointments', child: child),
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

/// From the day step to the last one: a day, then a time.
Future<void> pickDayAndTime(WidgetTester tester) async {
  await tapIn(tester, find.byKey(Key('apptDay-${day(2)}')));
  await tapIn(tester, find.byKey(const Key('apptSlot-14:30')));
}

void main() {
  const s = S(false);

  testWidgets(
    'the list as on the website: count, cards, status and search, pages, a month, cancel asked first',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const AppointmentsScreen(profile: kid));
      expect(find.text('Meet the school'), findsOneWidget);
      expect(find.text('12 in all · latest first'), findsOneWidget);
      expect(t.calls.last.query, {'studentId': '41', 'page': 1, 'size': 10});
      // each card: whom to meet, state, purpose, the number · child · desk · place, the date block (school time)
      expect(find.text('Teacher Sample'), findsNWidgets(2));
      expect(find.text('Accounts desk'), findsOneWidget);
      expect(find.text('Confirmed'), findsOneWidget);
      expect(find.text('Waiting for the school'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
      expect(find.text('Progress in maths'), findsNWidgets(3));
      expect(
        find.text('AP-701 · Kid Sample (VI-A) · Adm. no. A1234 · Class teacher · Room 4'),
        findsOneWidget,
      );
      expect(find.text('AP-703 · Kid Sample (VI-A) · Adm. no. A1234'), findsOneWidget);
      expect(find.text('10:00'), findsNWidgets(2));
      expect(find.text('—'), findsOneWidget);
      expect(find.text('Details and gate pass'), findsOneWidget);
      expect(find.text('Details'), findsNWidgets(2));
      expect(find.byKey(const Key('apptCancel-701')), findsOneWidget);
      expect(find.byKey(const Key('apptCancel-702')), findsOneWidget);
      expect(find.byKey(const Key('apptCancel-703')), findsNothing);
      // status and search
      await tester.tap(find.byKey(const Key('apptState-open')));
      await tester.pumpAndSettle();
      expect(t.calls.last.query, {'studentId': '41', 'state': 'open', 'page': 1, 'size': 10});
      await tester.enterText(find.byKey(const Key('apptSearch')), 'maths');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(t.calls.last.query!['q'], 'maths');
      expect(find.text('12 found · latest first'), findsOneWidget);
      // ten a page
      await tapIn(tester, find.byKey(const Key('apptNext')));
      expect(t.calls.last.query!['page'], 2);
      expect(find.text('Page 2 / 2'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('apptClear')));
      expect(find.text('12 in all · latest first'), findsOneWidget);
      // a month: every appointment whose visit falls in it, by day
      await tapIn(tester, find.byKey(const Key('apptView-calendar')));
      final now = DateTime.now();
      String first(DateTime m) => '${m.year}-${m.month.toString().padLeft(2, '0')}-01';
      final last = DateTime(now.year, now.month + 1, 0);
      expect(t.calls.last.query, {
        'studentId': '41',
        'from': first(now),
        'to': '${last.year}-${last.month.toString().padLeft(2, '0')}-${last.day}',
        'size': 100,
      });
      expect(find.text('${s.month(DateTime(now.year, now.month))} · 12'), findsOneWidget);
      expect(find.text(s.dayShort(day(2))), findsOneWidget);
      expect(find.byKey(const Key('appt-703')), findsNothing);
      await tapIn(tester, find.byKey(const Key('apptMonthNext')));
      expect(t.calls.last.query!['from'], first(DateTime(now.year, now.month + 1)));
      // cancel, asked first
      await tapIn(tester, find.byKey(const Key('apptView-list')));
      await tapIn(tester, find.byKey(const Key('apptCancel-702')));
      expect(find.text('Cancel this appointment?'), findsOneWidget);
      await tester.tap(find.text('Keep it'));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path.endsWith('/cancel')), isFalse);
      await tapIn(tester, find.byKey(const Key('apptCancel-702')));
      await tester.tap(find.byKey(const Key('confirmApptCancel')));
      await tester.pumpAndSettle();
      final cancel = t.calls.lastWhere((c) => c.path.endsWith('/cancel'));
      expect(cancel.path, '/appointments/mine/702/cancel');
      expect(cancel.body, <String, Object?>{});
      expect(find.text('Appointment cancelled.'), findsOneWidget);
      expect(find.byKey(const Key('apptCancel-702')), findsNothing);
    },
  );

  testWidgets(
    'booking from the list: whom to meet, a day from the days, a time from the slots, why; it opens',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const AppointmentsScreen(profile: kid));
      await tapIn(tester, find.byKey(const Key('bookAppointment')));
      expect(find.text('Step 2 / 5'), findsOneWidget);
      expect(find.text('Kid Sample · VI-A · A1234'), findsOneWidget);
      expect(find.text('Whom do you want to meet?'), findsOneWidget);
      // each person or desk with the visiting hours (the same hours together) and the place
      expect(find.text('Teacher Sample\nMon–Fri 14:00–15:00\nRoom 4'), findsOneWidget);
      expect(find.text('Mon, Wed 09:00–10:00\nMain block'), findsOneWidget);
      expect(find.text('No visiting hours'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('apptHost-h1')));
      expect(t.calls.last.path, '/appointments/mine/days');
      expect(t.calls.last.query, {'hostId': 'h1', 'studentId': '41'});
      expect(find.text('Step 3 / 5'), findsOneWidget);
      expect(find.text('Class teacher · Teacher Sample'), findsOneWidget);
      expect(find.text(s.dayShort(day(1))), findsOneWidget);
      expect(find.text('1 time free'), findsOneWidget);
      expect(find.text('3 times free'), findsOneWidget);
      await tapIn(tester, find.byKey(Key('apptDay-${day(2)}')));
      expect(t.calls.last.path, '/appointments/mine/slots');
      expect(t.calls.last.query, {'hostId': 'h1', 'date': day(2), 'studentId': '41'});
      expect(find.text('Step 4 / 5'), findsOneWidget);
      // only the free times
      expect(find.byKey(const Key('apptSlot-14:00')), findsNothing);
      expect(find.byKey(const Key('apptSlot-14:15')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('apptSlot-14:30')));
      expect(find.text('Step 5 / 5'), findsOneWidget);
      expect(
        find.text(
          'Kid Sample · Class teacher (Teacher Sample) · ${s.dayShort(day(2))} · 14:30 · Room 4. '
          'The school confirms the request and sends you the gate pass.',
        ),
        findsOneWidget,
      );
      expect(find.text('Please come ten minutes early.'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('apptSend')));
      expect(find.text('Write why you want to meet (at least 3 letters).'), findsOneWidget);
      expect(t.calls.any((c) => c.method == 'POST'), isFalse);
      await reach(tester, find.byKey(const Key('apptPurpose')));
      await tester.enterText(find.byKey(const Key('apptPurpose')), '  Progress in maths ');
      await tapIn(tester, find.byKey(const Key('apptSend')));
      final post = t.calls.lastWhere((c) => c.method == 'POST');
      expect(post.path, '/appointments/mine');
      expect(post.body, {
        'studentId': '41',
        'hostId': 'h1',
        'startsAt': '${day(2)}T14:30',
        'purpose': 'Progress in maths',
      });
      // the new one opens, said so
      expect(
        find.text('Appointment requested. The school will confirm it and send you the pass.'),
        findsOneWidget,
      );
      expect(find.text('Appointment AP-900'), findsOneWidget);
      expect(find.text('Gate pass card (PDF)'), findsNothing);
    },
  );

  testWidgets('whom to meet given by the caller; Change goes back a step; a time taken meanwhile', (
    tester,
  ) async {
    await tall(tester);
    final school = School()..slotTaken = true;
    final t = await pump(
      tester,
      const AppointmentForm(profile: kid, hostId: 'h2'),
      school: school,
    );
    expect(find.text('Step 3 / 5'), findsOneWidget);
    expect(find.text('Front office'), findsOneWidget);
    expect(t.calls.last.query, {'hostId': 'h2', 'studentId': '41'});
    await pickDayAndTime(tester);
    expect(find.text('Step 5 / 5'), findsOneWidget);
    // the day again: the time goes with it
    await tapIn(tester, find.byKey(const Key('apptChange-day')));
    expect(find.text('Step 3 / 5'), findsOneWidget);
    expect(find.byKey(const Key('apptChange-time')), findsNothing);
    await pickDayAndTime(tester);
    await reach(tester, find.byKey(const Key('apptPurpose')));
    await tester.enterText(find.byKey(const Key('apptPurpose')), 'Fee receipt');
    final before = t.calls.where((c) => c.path == '/appointments/mine/slots').length;
    await tapIn(tester, find.byKey(const Key('apptSend')));
    expect(find.text('That time was just taken.'), findsOneWidget);
    // the free times asked for again
    expect(t.calls.where((c) => c.path == '/appointments/mine/slots').length, before + 1);
    expect(find.byKey(const Key('apptSend')), findsOneWidget);
    // someone else to meet: back to the list of whom
    await tapIn(tester, find.byKey(const Key('apptChange-host')));
    expect(find.text('Step 2 / 5'), findsOneWidget);
    expect(find.byKey(const Key('apptHost-h1')), findsOneWidget);
  });

  testWidgets(
    'empty states: none yet, nothing matches, an empty month, not linked, no one open, no day, a closed day',
    (tester) async {
      await tall(tester);
      await pump(tester, const AppointmentsScreen(profile: kid), school: School()..empty = true);
      expect(
        find.text('No appointments yet. Use Book an appointment to meet a teacher or the office.'),
        findsOneWidget,
      );
      expect(find.text('0 in all · latest first'), findsOneWidget);
      await tester.tap(find.byKey(const Key('apptState-past')));
      await tester.pumpAndSettle();
      expect(find.text('Nothing matches these filters.'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('apptView-calendar')));
      expect(find.text('No appointments in this month.'), findsOneWidget);

      await pump(
        tester,
        const AppointmentsScreen(profile: kid),
        school: School()..notLinked = true,
      );
      expect(
        find.text('Your account is not linked to a student yet. Please contact the school office.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('bookAppointment')), findsNothing);

      await pump(tester, const AppointmentForm(profile: kid), school: School()..noHosts = true);
      expect(find.text('The school has not opened appointments for parents yet.'), findsOneWidget);

      await pump(
        tester,
        const AppointmentForm(profile: kid, hostId: 'h1'),
        school: School()..noDays = true,
      );
      expect(
        find.text('No free time in the next 30 days. Please try another person or desk.'),
        findsOneWidget,
      );

      await pump(
        tester,
        const AppointmentForm(profile: kid, hostId: 'h1'),
        school: School()..closedDay = true,
      );
      await tapIn(tester, find.byKey(Key('apptDay-${day(1)}')));
      expect(find.text('The school is closed: Sample Holiday.'), findsOneWidget);
      expect(find.byKey(const Key('apptSend')), findsNothing);
    },
  );

  testWidgets(
    'an appointment in full: the pass card to view or save, details, history folded, cancel after a yes',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const AppointmentDetail(profile: kid, id: '701'));
      expect(find.text('Appointment AP-701'), findsOneWidget);
      expect(find.text('Kid Sample · Teacher Sample'), findsOneWidget);
      expect(find.text('Confirmed'), findsOneWidget);
      // the pass: who comes, the child, the number · whom · when · where, and the card (no file name)
      expect(find.text('Gate pass'), findsOneWidget);
      expect(find.text('Parent Sample'), findsNWidgets(2));
      expect(
        find.text('AP-701 · Teacher Sample · ${s.dayShort(day(2))}, 10:00 · Room 4'),
        findsOneWidget,
      );
      expect(find.text('Gate pass card (PDF)'), findsOneWidget);
      expect(find.textContaining('visitor-card'), findsNothing);
      expect(find.textContaining('QR code at the school gate'), findsOneWidget);
      // the details
      expect(find.text('Kid Sample (VI-A) · Adm. no. A1234'), findsNWidgets(2));
      expect(find.text('Class teacher · Teacher Sample'), findsOneWidget);
      expect(find.text('${s.dayShort(day(2))}, 10:00'), findsOneWidget);
      expect(find.text('${s.dayShort(day(1))}, 11:00'), findsOneWidget);
      expect(find.text('9000000001'), findsOneWidget);
      expect(find.text('${s.dayShort(day(0))}, 09:00'), findsOneWidget);
      expect(find.text('Please bring the diary.'), findsOneWidget);
      // the history, folded with a hint
      expect(find.text('3 entries · last: Moved to a new time'), findsOneWidget);
      final moved = 'Moved to a new time · ${s.dayShort(day(2))}, 10:00 · Teacher in a meeting';
      expect(find.text(moved), findsNothing);
      await tapIn(tester, find.byKey(const Key('apptHistory')));
      expect(find.text(moved), findsOneWidget);
      expect(find.text('Requested'), findsOneWidget);
      // the card: viewed in the app
      await reach(tester, find.byKey(const Key('view-apptCard')));
      await tester.tap(find.byKey(const Key('view-apptCard')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/appointments/mine/701/card'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // cancel, asked first
      await tapIn(tester, find.byKey(const Key('apptDetailCancel')));
      await tester.tap(find.text('Keep it'));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path.endsWith('/cancel')), isFalse);
      await tapIn(tester, find.byKey(const Key('apptDetailCancel')));
      await tester.tap(find.byKey(const Key('confirmApptCancel')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/appointments/mine/701/cancel'), isTrue);
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.text('Cancelled by the parent'), findsOneWidget);
      expect(find.byKey(const Key('apptPass')), findsNothing);
      expect(find.byKey(const Key('apptDetailCancel')), findsNothing);
    },
  );

  testWidgets('over and without a time: no card, no cancel, "not decided yet"', (tester) async {
    await tall(tester);
    await pump(tester, const AppointmentDetail(profile: kid, id: '703'));
    expect(find.text('Kid Sample · Accounts desk'), findsOneWidget);
    expect(find.text('Completed'), findsOneWidget);
    expect(find.text('Not decided yet'), findsOneWidget);
    expect(find.text('Gate pass card (PDF)'), findsNothing);
    expect(find.byKey(const Key('apptDetailCancel')), findsNothing);
    expect(find.text('1 entry · last: Requested'), findsOneWidget);
    expect(s.apptState('no_show'), 'Did not come');
    expect(const S(true).apptState('approved'), 'पुष्ट');
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the list, the form (each step) and an appointment', (
      tester,
    ) async {
      await tall(tester);
      final handle = tester.ensureSemantics();
      Future<void> check(String what) async {
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g), reason: '$what: ${g.description}');
        }
      }

      await pump(
        tester,
        const AppointmentsScreen(profile: kid),
        hindi: hindi,
        dark: dark,
      );
      await check('list');
      await tapIn(tester, find.byKey(const Key('apptView-calendar')));
      await check('month');
      await pump(
        tester,
        const AppointmentForm(profile: kid),
        hindi: hindi,
        dark: dark,
      );
      await check('form: whom');
      await tapIn(tester, find.byKey(const Key('apptHost-h1')));
      await check('form: day');
      await pickDayAndTime(tester);
      await check('form: why');
      await pump(
        tester,
        const AppointmentDetail(profile: kid, id: '701', booked: true),
        hindi: hindi,
        dark: dark,
      );
      await check('appointment');
      await tapIn(tester, find.byKey(const Key('apptHistory')));
      await check('appointment, history open');
      handle.dispose();
    });
  }

  testWidgets('large text (twice the size) on a phone: the list, the form and an appointment', (
    tester,
  ) async {
    await tall(tester, const Size(360, 780));
    for (final hindi in [false, true]) {
      Future<void> scrolled(String what) async {
        expect(tester.takeException(), isNull, reason: '$what hindi=$hindi');
        await tester.drag(find.byType(ListView).first, const Offset(0, -3000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '$what scrolled hindi=$hindi');
      }

      await pump(tester, const AppointmentsScreen(profile: kid), hindi: hindi, text: 2);
      await scrolled('list');
      await pump(tester, const AppointmentForm(profile: kid), hindi: hindi, text: 2);
      await scrolled('form: whom');
      await pump(
        tester,
        const AppointmentForm(profile: kid, hostId: 'h1'),
        hindi: hindi,
        text: 2,
      );
      await pickDayAndTime(tester);
      await reach(tester, find.byKey(const Key('apptSend')));
      expect(find.byKey(const Key('apptSend')), findsOneWidget);
      await scrolled('form: why');
      await pump(
        tester,
        const AppointmentDetail(profile: kid, id: '701', booked: true),
        hindi: hindi,
        text: 2,
      );
      await tapIn(tester, find.byKey(const Key('apptHistory')));
      await scrolled('appointment');
    }
  });
}
