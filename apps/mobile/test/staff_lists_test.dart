// The staff app's leave, gate pass, lesson, document and daily work lists: the latest 10, then 10 more as the person scrolls (as the staff website).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/daily_work.dart';
import 'package:edupro/staff/documents.dart';
import 'package:edupro/staff/gate_passes.dart';
import 'package:edupro/staff/leave_page.dart';
import 'package:edupro/staff/lesson_plans.dart';
import 'package:edupro/staff/student_leave.dart';
import 'package:edupro/theme/theme.dart';
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

const many = 23;

Map<String, Object?> _leave(int i, {bool team = false}) => {
  'id': 'x$i',
  'number': 'LV/2026-27/${1000 + i}',
  'leaveType': {'code': 'CL', 'name': 'Casual leave'},
  'from': '2026-11-20',
  'to': '2026-11-20',
  'days': 1,
  'reason': 'A made-up reason',
  'status': 'approved',
  'cancelStatus': null,
  'appliedAt': '2026-11-19T04:30:00.000Z',
  'can': {'withdraw': false, 'requestCancel': false, 'decide': false, 'decideCancel': false},
  if (team) ...{
    'employee': {'id': 'e20', 'name': 'Ravi Sample', 'code': 'E020', 'department': 'Maths'},
    'source': 'self',
    'what': 'leave',
  },
};

Map<String, Object?> _pass(int i, {bool mine = false}) => {
  'id': 'x$i',
  'number': 'GP-${100 + i}',
  'audience': mine ? 'staff' : 'student',
  'kind': mine ? 'rgp' : 'early_leave',
  'state': mine ? 'approved' : 'pending',
  'stage': mine ? 'Approved' : 'Waiting for the class teacher',
  'onDate': '2026-11-25',
  'atTime': '12:30',
  'returnBy': null,
  'reason': 'A made-up reason',
  'destination': null,
  'student': 'Kid Sample',
  'section': 'VI-A',
  'admissionNo': 'A1234',
  'escortName': null,
  'escortRelation': null,
  'items': 0,
  'passNo': null,
  'waitingOn': null,
  'decisionNote': null,
  'outAt': null,
  'inAt': null,
};

Object? answer(Call c) {
  final paged = c.query?['page'] != null;
  final page = int.tryParse('${c.query?['page'] ?? 1}') ?? 1;
  final size = int.tryParse('${c.query?['size'] ?? 10}') ?? 10;
  final from = (page - 1) * size;
  final upto = (from + size).clamp(0, many);
  switch ('${c.method} ${c.path}') {
    case 'GET /leave/mine':
      return {
        'employee': {'id': 'e7', 'name': 'Asha Teacher', 'code': 'E015', 'department': 'English'},
        'balances': <Object>[],
        'types': <Object>[],
        'rows': paged ? [for (var i = from; i < upto; i++) _leave(i)] : <Object>[],
        'total': paged ? many : 0,
        'page': page,
        'size': size,
        'can': {'apply': true},
      };
    case 'GET /leave/menu':
      return {'leave': 0, 'team': 1, 'corrections': 0, 'reports': 0};
    case 'GET /leave/self/team':
      return {
        'team': 1,
        'waiting': 0,
        'rows': [for (var i = from; i < upto; i++) _leave(i, team: true)],
        'total': many,
        'page': page,
        'size': size,
        'filters': {'employees': <Object>[], 'types': <Object>[]},
      };
    case 'GET /attendance/leaves':
      return {
        'inbox': many,
        'data': [
          for (var i = from; i < upto; i++)
            {
              'id': 'x$i',
              'number': 'SL-${100 + i}',
              'student': 'Kid Sample',
              'admissionNo': 'A1234',
              'section': 'VI-A',
              'leaveTypeLabel': 'Sick leave',
              'fromDate': '2026-11-24',
              'toDate': '2026-11-24',
              'days': 1,
              'reason': 'Fever',
              'long': false,
              'status': 'pending',
              'appliedBy': 'Mina Sample',
              'waitingOn': 'Class teacher',
              'decisionNote': null,
            },
        ],
        'page': {'number': page, 'size': size, 'total': many},
      };
    case 'GET /gate-passes/inbox':
      return {
        'data': [for (var i = from; i < upto; i++) _pass(i)],
        'waiting': many,
        'decided': <Object>[],
        'page': {'number': page, 'size': size, 'total': many},
      };
    case 'GET /academics/daily-work/sheet/options':
      return {'data': <Object>[]};
    case 'GET /academics/documents':
      return {
        'data': [
          for (var i = from; i < upto; i++)
            {
              'id': 'x$i',
              'kind': 'session_plan',
              'kindLabel': 'Session plan',
              'title': 'Plan $i',
              'remark': null,
              'section': 'VI-A',
              'subject': null,
              'fileIds': <Object>[],
              'publishAt': '2026-11-20T04:30:00.000Z',
              'scheduled': false,
              'ackRequired': false,
              'ackCount': 0,
              'postedBy': 'Asha Teacher',
            },
        ],
        'kinds': <Object>[],
        'page': {'number': page, 'size': size, 'total': many},
      };
    case 'GET /academics/lessons':
      return {
        'data': [
          for (var i = from; i < upto; i++)
            {
              'id': 'x$i',
              'date': '2026-11-20',
              'classes': 'VI-A',
              'topic': 'Topic $i',
              'employee': 'Asha Teacher',
              'employeeCode': 'E015',
              'department': 'English',
              'status': 'pending',
              'currentLevel': 1,
              'levels': 2,
              'approver': 'Sample Head',
              'requestedAt': '2026-11-19T04:30:00.000Z',
              'files': 0,
              'mine': true,
              'myTurn': false,
              'deleted': false,
            },
        ],
        'counts': {'total': many, 'pending': many, 'acknowledged': 0, 'rejected': 0},
        'page': {'number': page, 'size': size, 'total': many},
        'office': false,
      };
    case 'GET /academics/daily-work':
      return {
        'data': [
          for (var i = from; i < upto; i++)
            {
              'id': 'x$i',
              'kind': i.isEven ? 'homework' : 'assignment',
              'section': 'VI-A',
              'subjectName': 'S$i',
              'title': 'Work $i',
              'body': 'Made-up work $i',
              'assignedOn': '2026-11-20',
              'dueOn': null,
              'postedBy': 'Asha Teacher',
              'files': <Object>[],
              'publishAt': '2026-11-20T04:30:00.000Z',
              'scheduled': false,
              'ackRequired': false,
              'ackCount': 0,
            },
        ],
        'page': {'number': page, 'size': size, 'total': many},
      };
    case 'GET /gate-passes/staff':
      return {
        'data': [for (var i = from; i < upto; i++) _pass(i, mine: true)],
        'page': {'number': page, 'size': size, 'total': many},
      };
  }
  throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
}

Future<FakeTransport> pump(WidgetTester tester, Widget child) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = const Size(420, 900) * 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'hindi': false});
  final t = FakeTransport(answer);
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [transportProvider.overrideWithValue(t)],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        home: FamilyPage(title: 'Staff', child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

/// The list itself (the paged list's own scroller).
final _list = find
    .descendant(of: find.byType(RefreshIndicator), matching: find.byType(Scrollable))
    .first;

/// Scrolls down to the end of a list that loads as it scrolls: first a card of page 2, then the end.
Future<void> scrolls(WidgetTester tester, FakeTransport t, String path, String key) async {
  List<Call> pages() => t.calls.where((c) => c.path == path && c.query?['page'] != null).toList();
  expect(pages().first.query, allOf(containsPair('page', 1), containsPair('size', 10)));
  expect(find.byKey(Key('$key-x10')), findsNothing);
  await tester.scrollUntilVisible(find.byKey(Key('$key-x15')), 300, scrollable: _list);
  await tester.pumpAndSettle();
  expect(pages().map((c) => c.query?['page']).take(2), [1, 2]);
  await tester.scrollUntilVisible(find.byKey(const Key('feedEnd')), 300, scrollable: _list);
  await tester.pumpAndSettle();
  expect(pages().map((c) => c.query?['page']), [1, 2, 3]);
  expect(find.byKey(Key('$key-x22')), findsOneWidget);
}

void main() {
  testWidgets('My leave (under the leave cards that scroll away): 10, 10 more, the end', (
    tester,
  ) async {
    final t = await pump(tester, const LeaveAttendanceScreen(profile: staff));
    expect(find.byKey(const Key('lvInAll')), findsOneWidget);
    await scrolls(tester, t, '/leave/mine', 'lvLeave');
  });

  testWidgets('Reporties leave: 10, 10 more, the end', (tester) async {
    final t = await pump(
      tester,
      const LeaveAttendanceScreen(profile: staff, initialTab: 'team-leave'),
    );
    await scrolls(tester, t, '/leave/self/team', 'lvLeave');
  });

  testWidgets('Student leave to approve: 10, 10 more, the end; the tab counts all', (tester) async {
    final t = await pump(tester, const StudentLeaveScreen(profile: staff));
    expect(find.textContaining('$many'), findsWidgets);
    await scrolls(tester, t, '/attendance/leaves', 'slLeave');
  });

  testWidgets('Gate passes to approve: 10, 10 more, the end; the tab counts all', (tester) async {
    final t = await pump(tester, const StaffGatePassesScreen(profile: staff));
    expect(find.textContaining('$many'), findsWidgets);
    await scrolls(tester, t, '/gate-passes/inbox', 'sgInbox');
  });

  testWidgets('My gate passes: 10, 10 more, the end', (tester) async {
    final t = await pump(tester, const StaffGatePassesScreen(profile: staff));
    await tester.tap(find.byType(Tab).last);
    await tester.pumpAndSettle();
    await scrolls(tester, t, '/gate-passes/staff', 'sgMine');
  });

  testWidgets('Session plan, curriculum, date sheet (uploaded): 10, 10 more, the end', (
    tester,
  ) async {
    final t = await pump(tester, const DocumentsListTab(profile: staff));
    await scrolls(tester, t, '/academics/documents', 'doc');
  });

  testWidgets('Lesson report: 10, 10 more, the end; the counts over all', (tester) async {
    final t = await pump(tester, const LessonReportTab());
    expect(find.byKey(const Key('lpTile-total')), findsOneWidget);
    await scrolls(tester, t, '/academics/lessons', 'lpRow');
  });

  testWidgets(
    'Daily work report: one list by date, 10 posts, 10 more, the end; each with its kind',
    (tester) async {
      final t = await pump(tester, const WorkReportTab(profile: staff));
      final pages = t.calls.where((c) => c.path == '/academics/daily-work').toList();
      expect(pages.first.query, allOf(containsPair('page', 1), containsPair('size', 10)));
      expect(find.byKey(const Key('wrCard-2026-11-20|VI-A|S0')), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const Key('wrCard-2026-11-20|VI-A|S15')),
        300,
        scrollable: _list,
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const Key('feedEnd')), 300, scrollable: _list);
      await tester.pumpAndSettle();
      expect(t.calls.where((c) => c.path == '/academics/daily-work').map((c) => c.query?['page']), [
        1,
        2,
        3,
      ]);
      expect(find.byKey(const Key('wrCard-2026-11-20|VI-A|S22')), findsOneWidget);
    },
  );
}
