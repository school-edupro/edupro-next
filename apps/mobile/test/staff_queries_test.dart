// The staff app's Queries and helpdesk, native as on the staff website (no web page).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/queries.dart' show QueryWords;
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/approvals.dart' show ApprovalsScreen;
import 'package:edupro/staff/queries.dart';
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

Map<String, Object?> ticket(
  String id, {
  String raisedBy = '20',
  Map<String, Object?> more = const {},
}) => {
  'id': id,
  'number': 'HD-$id',
  'desk': 'parent',
  'head': 'Transport',
  'categoryCode': 'transport',
  'studentName': 'Kid Sample',
  'section': 'VI-A',
  'admissionNo': 'A1234',
  'raisedBy': 'Mina Sample',
  'raisedByUserId': raisedBy,
  'subject': 'Bus late every day',
  'body': 'The bus comes 20 minutes late.',
  'fileIds': ['70'],
  'status': 'open',
  'priority': 'normal',
  'level': 1,
  'dueAt': null,
  'overdue': false,
  'assignedTo': 'Asha Teacher',
  'assignedRoleName': null,
  'resolution': null,
  'rating': null,
  'openedAt': '2026-11-20T04:30:00.000Z',
  ...more,
};

class School {
  School({this.handler = true, this.mineClosed = false});
  final bool handler;
  final bool mineClosed;
  final sent = <String, List<Map<String, Object?>>>{};

  void _keep(String what, Map<String, Object?>? body) => (sent[what] ??= []).add(body ?? const {});

  Object? answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /approvals/inbox':
        return {
          'total': 1,
          'kinds': [
            {'kind': 'query', 'label': 'Queries to answer', 'count': 1},
          ],
          'items': [
            {
              'kind': 'query',
              'id': '5',
              'title': 'HD-5 · Bus late every day',
              'detail': 'Transport · Kid Sample (VI-A)',
              'by': 'Mina Sample',
              'at': '2026-11-20T04:30:00.000Z',
              'amount': null,
              'href': '/queries/t/5',
              'app': 'teacher',
              'reasonOnReject': false,
              'reasonOnApprove': false,
              'decideHere': false,
              'approveAs': 'approve',
              'rejectAs': 'reject',
              'url': null,
              'adminHref': '/engagement/helpdesk/parent/5',
              'staffUrl': 'http://localhost:3002/queries/t/5',
            },
          ],
          'unavailable': <Object>[],
        };
      case 'GET /me':
        return {
          'user': {'id': '11', 'displayName': 'Asha Teacher'},
        };
      case 'GET /helpdesk/tickets':
        if (c.query?['view'] == 'mine') {
          return {
            'data': [
              ticket(
                '8',
                raisedBy: '11',
                more: {
                  'desk': 'staff',
                  'head': 'Salary',
                  'studentName': null,
                  'section': null,
                  'subject': 'Payslip missing',
                  'assignedTo': null,
                  'assignedRoleName': 'Accounts',
                  'status': mineClosed ? 'closed' : 'answered',
                },
              ),
            ],
          };
        }
        return {
          'data': [
            ticket('5', more: {'level': 2, 'overdue': true}),
            // raised by me: shown under My requests only
            ticket('8', raisedBy: '11', more: {'subject': 'Payslip missing'}),
          ],
        };
      case 'GET /helpdesk/tickets/5':
        return {
          ...ticket('5', more: {'level': 2, 'overdue': true}),
          'replies': [
            {
              'id': '1',
              'author': 'Asha Teacher',
              'authorKind': 'staff',
              'fromRaiser': false,
              'body': 'Checking with transport.',
              'fileIds': <String>[],
              'isInternal': true,
              'createdAt': '2026-11-20T05:00:00.000Z',
            },
          ],
          'events': [
            {
              'kind': 'created',
              'level': 1,
              'at': '2026-11-20T04:30:00.000Z',
              'actor': null,
              'to': 'Asha Teacher',
            },
            {
              'kind': 'escalated',
              'level': 2,
              'at': '2026-11-21T04:30:00.000Z',
              'actor': null,
              'to': 'Coordinator',
            },
          ],
          'you': {
            'handler': handler,
            'raiser': false,
            'canReply': handler,
            'canAssign': handler,
            'canClose': handler,
            'canReopen': false,
            'canRate': false,
            'reopenUntil': null,
          },
        };
      case 'GET /helpdesk/tickets/8':
        return {
          ...ticket(
            '8',
            raisedBy: '11',
            more: {
              'desk': 'staff',
              'head': 'Salary',
              'studentName': null,
              'subject': 'Payslip missing',
              'fileIds': <String>[],
              'assignedTo': null,
              'assignedRoleName': 'Accounts',
              'status': mineClosed ? 'closed' : 'answered',
              'resolution': mineClosed ? 'Sent again by e-mail.' : null,
            },
          ),
          'replies': <Object>[],
          'events': <Object>[],
          'you': {
            'handler': false,
            'raiser': true,
            'canReply': !mineClosed,
            'canAssign': false,
            'canClose': false,
            'canReopen': mineClosed,
            'canRate': mineClosed,
            'reopenUntil': mineClosed ? '2026-12-01T00:00:00.000Z' : null,
          },
        };
      case 'GET /helpdesk/assignees':
        return {
          'staff': [
            {'id': '31', 'name': 'Ravi Sample'},
          ],
          'roles': [
            {
              'code': 'transport_incharge',
              'name': 'Transport in-charge',
              'people': 'Dev Sample',
              'n': 1,
            },
          ],
        };
      case 'GET /helpdesk/heads/staff':
      case 'GET /helpdesk/heads/provider':
        return {
          'data': [
            {'code': 'salary', 'name': 'Salary', 'description': null},
            {'code': 'it', 'name': 'IT support', 'description': null},
          ],
        };
      case 'POST /helpdesk/tickets':
        _keep('create', c.body);
        return {'id': '9'};
      case 'GET /helpdesk/tickets/9':
        return {
          ...ticket(
            '9',
            raisedBy: '11',
            more: {'desk': 'staff', 'subject': 'Laptop broken', 'fileIds': <String>[]},
          ),
          'replies': <Object>[],
          'events': <Object>[],
          'you': {'handler': false, 'raiser': true, 'canReply': true},
        };
      case 'POST /helpdesk/tickets/5/replies':
        _keep('reply', c.body);
        return {'ok': true};
      case 'POST /helpdesk/tickets/5/assign':
        _keep('assign', c.body);
        return {'ok': true};
      case 'POST /helpdesk/tickets/5/close':
        _keep('close', c.body);
        return {'ok': true};
      case 'POST /helpdesk/tickets/8/reopen':
        _keep('reopen', c.body);
        return {'ok': true};
      case 'POST /helpdesk/tickets/8/rate':
        _keep('rate', c.body);
        return {'ok': true};
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
  Size size = const Size(420, 2400),
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

Future<void> choose(WidgetTester tester, Key menu, String label) async {
  await tapIn(tester, find.byKey(menu));
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

void main() {
  final s = S(false);

  test(
    'the staff menu opens Queries and helpdesk natively, on the tab asked for; no leave tab',
    () {
      expect(nativeScreen(staff, '/queries', s), isA<StaffQueriesScreen>());
      // student leave is decided under Student leave, not in Queries: an old leave link opens To answer
      expect((nativeScreen(staff, '/queries?tab=leave', s)! as StaffQueriesScreen).initialTab, 0);
      expect((nativeScreen(staff, '/queries?tab=mine', s)! as StaffQueriesScreen).initialTab, 1);
    },
  );

  testWidgets('to answer: not what I raised; the ticket in full; reply as an internal note', (
    tester,
  ) async {
    final (t, school) = await pump(tester, const StaffQueriesScreen(profile: staff));
    expect(find.byKey(const Key('sqTicket-5')), findsOneWidget);
    expect(find.byKey(const Key('sqTicket-8')), findsNothing);
    expect(find.text(s.sqLevel(2)), findsOneWidget);
    expect(find.text(s.sqPastDue), findsOneWidget);
    expect(find.textContaining('Family query'), findsOneWidget);
    expect(t.calls.firstWhere((c) => c.path == '/helpdesk/tickets').query?['status'], 'active');
    await tapIn(tester, find.byKey(const Key('sqTicket-5')));
    expect(find.byKey(const Key('sqTicketDetail')), findsOneWidget);
    expect(find.text('The bus comes 20 minutes late.'), findsOneWidget);
    expect(find.byKey(const Key('view-sqf-70')), findsOneWidget);
    expect(find.text(s.sqInternalTag), findsWidgets);
    expect(find.textContaining('Escalated to Coordinator'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('sqReplySend')));
    expect(find.text(s.qryNeedDetails), findsOneWidget);
    await tester.enterText(find.byKey(const Key('sqReplyText')), 'Spoke to the driver.');
    await tapIn(tester, find.byKey(const Key('sqInternal')));
    await tapIn(tester, find.byKey(const Key('sqReplySend')));
    expect(school.sent['reply']!.single, {
      'body': 'Spoke to the driver.',
      'fileIds': <String>[],
      'isInternal': true,
    });
    expect(find.byKey(const Key('sqSaved')), findsOneWidget);
  });

  testWidgets('a ticket: hand over to a role, close as resolved (a resolution needed)', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StaffTicketDetail(id: '5'));
    await tapIn(tester, find.byKey(const Key('sqHandOverBtn')));
    expect(find.text(s.sqChooseWho), findsOneWidget);
    await choose(tester, const Key('sqTo'), s.sqRole('Transport in-charge', 'Dev Sample'));
    await tester.enterText(find.byKey(const Key('sqHandNote')), 'Please look into the timing.');
    await tapIn(tester, find.byKey(const Key('sqHandOverBtn')));
    expect(school.sent['assign']!.single, {
      'roleCode': 'transport_incharge',
      'note': 'Please look into the timing.',
    });
    await tapIn(tester, find.byKey(const Key('sqCloseBtn')));
    expect(find.text(s.sqNeedResolution), findsOneWidget);
    await tester.enterText(find.byKey(const Key('sqResolutionText')), 'New timing from Monday.');
    await tapIn(tester, find.byKey(const Key('sqCloseBtn')));
    expect(school.sent['close']!.single, {
      'resolution': 'New timing from Monday.',
      'fileIds': <String>[],
    });
  });

  testWidgets('someone else’s ticket: only they can answer — no reply, close or hand over', (
    tester,
  ) async {
    await pump(tester, const StaffTicketDetail(id: '5'), school: School(handler: false));
    expect(find.byKey(const Key('sqOnlyThey')), findsOneWidget);
    expect(find.byKey(const Key('sqReplySend')), findsNothing);
    expect(find.byKey(const Key('sqCloseBtn')), findsNothing);
    expect(find.byKey(const Key('sqHandOverBtn')), findsNothing);
  });

  testWidgets('raise a staff query: the type, subject and details; it opens after sending', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StaffQueriesScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('sqRaiseStaff')));
    expect(find.byKey(const Key('sqRaiseForm')), findsOneWidget);
    expect(find.byKey(const Key('sqPriority')), findsNothing);
    await tapIn(tester, find.byKey(const Key('sqSend')));
    expect(find.text(s.sqChooseType), findsOneWidget);
    await choose(tester, const Key('sqHead'), 'IT support');
    await tester.enterText(find.byKey(const Key('sqSubject')), 'Laptop broken');
    await tester.enterText(find.byKey(const Key('sqBody')), 'The screen does not turn on.');
    await tapIn(tester, find.byKey(const Key('sqSend')));
    expect(school.sent['create']!.single, {
      'desk': 'staff',
      'categoryCode': 'it',
      'subject': 'Laptop broken',
      'body': 'The screen does not turn on.',
      'priority': 'normal',
      'fileIds': <String>[],
    });
    expect(find.byKey(const Key('sqTicketDetail')), findsOneWidget);
    expect(find.byKey(const Key('sqSaved')), findsOneWidget);
  });

  testWidgets('a ticket to the ERP provider asks how urgent', (tester) async {
    final (_, school) = await pump(tester, const StaffQueriesScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('sqRaiseProvider')));
    await choose(tester, const Key('sqHead'), 'IT support');
    await choose(tester, const Key('sqPriority'), s.sqPriority('urgent'));
    await tester.enterText(find.byKey(const Key('sqSubject')), 'Marks page error');
    await tester.enterText(find.byKey(const Key('sqBody')), 'Saving marks fails.');
    await tapIn(tester, find.byKey(const Key('sqSend')));
    expect(school.sent['create']!.single['desk'], 'provider');
    expect(school.sent['create']!.single['priority'], 'urgent');
  });

  testWidgets('my requests: with whom; closed shows the resolution, reopen and rate', (
    tester,
  ) async {
    final (t, school) = await pump(
      tester,
      const StaffQueriesScreen(profile: staff, initialTab: 1),
      school: School(mineClosed: true),
    );
    expect(find.byKey(const Key('sqTicket-8')), findsOneWidget);
    expect(find.textContaining(s.sqWith('Accounts')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('sqClosed')));
    expect(t.calls.where((c) => c.path == '/helpdesk/tickets').last.query?['status'], 'closed');
    await tapIn(tester, find.byKey(const Key('sqTicket-8')));
    expect(find.byKey(const Key('sqResolution')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('sqReopenReason')), 'Still not received.');
    await tapIn(tester, find.byKey(const Key('sqReopen')));
    expect(school.sent['reopen']!.single, {'reason': 'Still not received.', 'fileIds': <String>[]});
    await tapIn(tester, find.byKey(const Key('sqRateStar-4')));
    await tapIn(tester, find.byKey(const Key('sqRate')));
    expect(school.sent['rate']!.single, {'rating': 4});
  });

  testWidgets(
    'a query with me in the header’s Approvals opens its own screen in the app (no web page)',
    (tester) async {
      final (_, school) = await pump(tester, const ApprovalsScreen(profile: staff));
      await tapIn(tester, find.text('HD-5 · Bus late every day'));
      expect(find.byKey(const Key('sqTicketDetail')), findsOneWidget);
      expect(find.text('The bus comes 20 minutes late.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('sqReplyText')), 'On it.');
      await tapIn(tester, find.byKey(const Key('sqReplySend')));
      expect(school.sent['reply'], isNotEmpty);
    },
  );

  testWidgets(
    'two tabs, To answer and My requests: no leave requests (they are under Student leave)',
    (tester) async {
      final (t, _) = await pump(tester, const StaffQueriesScreen(profile: staff));
      expect(find.text(s.sqAnswerTab), findsOneWidget);
      expect(find.text(s.sqMineTab), findsOneWidget);
      expect(find.text('Leave requests'), findsNothing);
      expect(t.calls.where((c) => c.path.startsWith('/engagement/queries')), isEmpty);
    },
  );

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the lists, a ticket, the raise form', (tester) async {
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
        const StaffQueriesScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.byKey(const Key('sqTicket-5')));
      await check();
      await pump(
        tester,
        const StaffRaiseForm(desk: 'provider'),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await pump(
        tester,
        const StaffQueriesScreen(profile: staff, initialTab: 1),
        hindi: hindi,
        dark: dark,
      );
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    for (final w in const <Widget>[
      StaffQueriesScreen(profile: staff),
      StaffQueriesScreen(profile: staff, initialTab: 1),
      StaffTicketDetail(id: '5'),
      StaffTicketDetail(id: '8'),
      StaffRaiseForm(desk: 'provider'),
    ]) {
      await pump(tester, w, text: 2, size: const Size(360, 5000));
      expect(tester.takeException(), isNull);
    }
  });
}
