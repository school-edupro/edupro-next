import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/staff/data.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// Phase C (docs/design/89 §5.2, §5.4, §5.6): a teacher's screens against a made-up school. Every name, number and
/// amount here is made up.
final today = schoolToday();
String day(int offset) => ymd(today.add(Duration(days: offset)));

const staffProfile = {
  'id': 'staff:7',
  'kind': 'staff',
  'schoolId': '7',
  'schoolCode': 'SAMPLE',
  'schoolName': 'Sample School',
  'name': 'Asha Teacher',
  'detail': 'Teacher · E015',
  'studentId': null,
  'app': 'teacher',
  'actingAs': null,
  'hasPhoto': false,
};

class School {
  School({this.webTab = false, this.arranged = false, this.lists = false});

  /// the school chose a tab that has only a web page (docs/design/94)
  final bool webTab;

  /// the school arranged the staff menu (docs/design/94, part 2): its order and names; hidden screens left out
  final bool arranged;

  /// the school's own list tabs (docs/design/94, part 3): Attendance renamed and given more, an Office list
  final bool lists;
  bool offline = false;
  bool marked = false;
  int applies = 0;
  final decided = <String>[];

  /// the person's own Home shortcuts (null: the school's)
  List<String>? own;

  Map<String, Object?> entry(String href, String label, String icon) => {
    'href': href,
    'label': label,
    'icon': icon,
  };

  /// `GET me/staff-layout` (docs/design/94): the school's tabs, shortcuts and cards, or the person's own shortcuts.
  Map<String, Object?> layout() {
    final screens = [
      entry('/attendance', 'Attendance', 'check'),
      entry('/daily-work', 'Daily work', 'book'),
      entry('/timetable', 'Timetable', 'calendar'),
      entry('/my-leave', 'My leave', 'calendar'),
      entry('/my-attendance', 'My attendance', 'clock'),
      entry('/leave-approvals', 'Leave to approve', 'check'),
      entry('/messages', 'Messages', 'message'),
      entry('/help', 'Help', 'search'),
    ];
    Map<String, Object?> by(String h) => screens.firstWhere((x) => x['href'] == h);
    final school = ['/attendance', '/daily-work', '/timetable', '/my-leave', '/leave-approvals'];
    Map<String, Object?> list(
      String key,
      String label,
      String? hi,
      String icon,
      List<Object?> items,
    ) => {'key': key, 'label': label, 'labelHi': hi, 'icon': icon, 'items': items};
    final attendance = lists
        ? list('attendance', 'Attendance & leave', 'उपस्थिति और अवकाश', 'check', [
            by('/attendance'),
            by('/my-attendance'),
            by('/my-leave'),
            by('/leave-approvals'),
          ])
        : list('attendance', 'Attendance', 'उपस्थिति', 'check', [
            by('/attendance'),
            by('/my-attendance'),
            by('/my-leave'),
          ]);
    final classes = list('classes', 'Classes', 'कक्षाएँ', 'book', [
      by('/daily-work'),
      entry('/marks', 'Marks', 'clipboard'),
      by('/timetable'),
      entry('/my-payslips', 'My payslips', 'wallet'),
      entry('/documents', 'Session plan, curriculum, date sheet', 'file'),
    ]);
    final office = list('list-1', 'Office', null, 'message', [by('/messages'), by('/help')]);
    Map<String, Object?> tabOf(Map<String, Object?> l) => {
      'href': l['key'],
      'label': l['label'],
      'labelHi': l['labelHi'],
      'icon': l['icon'],
    };
    return {
      'tabs': [
        entry('/', 'Home', 'home'),
        if (webTab) by('/leave-approvals') else tabOf(attendance),
        if (lists) tabOf(office),
        tabOf(classes),
        if (!lists) by('/messages'),
        entry('more', 'More', 'grid'),
      ],
      'lists': [if (!webTab) attendance, if (lists) office, classes],
      'shortcuts': [for (final h in own ?? school) by(h)],
      'ownShortcuts': own != null,
      'cards': [
        for (final (k, l) in [
          ('approvals', 'Approvals waiting'),
          ('to_mark', 'Classes to mark'),
          ('periods_today', "Today's periods"),
          ('marks_to_enter', 'Marks to enter'),
          ('my_leave', 'My leave'),
          ('notices', 'Latest messages'),
        ])
          {'key': k, 'label': l, 'labelHi': l, 'href': null},
      ],
      'screens': screens,
      'published': true,
    };
  }

  dynamic answer(Call c) {
    if (offline) throw const ApiException(0, 'offline', 'No connection');
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /me/profiles':
        return {
          'data': [staffProfile],
        };
      case 'GET /me/staff-layout':
        return layout();
      case 'PUT /me/staff-layout/shortcuts':
        own = [for (final x in c.body!['shortcuts'] as List) '$x'];
        return layout();
      case 'DELETE /me/staff-layout/shortcuts':
        own = null;
        return layout();
      case 'GET /comms/inbox':
        return {
          'data': [
            {'id': 'm1', 'title': 'Staff meeting at 3', 'unread': true},
            {'id': 'm2', 'title': 'Sports day duties', 'unread': false},
          ],
          'page': {'more': false},
        };
      case 'GET /me/menu' when arranged:
        return {
          'app': 'teacher',
          'groups': [
            {
              'id': 'leave',
              'label': 'My leave and attendance',
              'labelHi': 'मेरा अवकाश',
              'icon': 'calendar',
              'items': [
                {'href': '/my-leave', 'label': 'My leave', 'help': null, 'icon': 'calendar'},
              ],
            },
            {
              'id': 'classes',
              'label': 'My classes',
              'labelHi': null,
              'icon': 'book',
              'items': [
                {'href': '/daily-work', 'label': 'Daily work', 'help': null, 'icon': 'book'},
              ],
            },
          ],
        };
      case 'GET /me/menu':
        return {
          'app': 'teacher',
          'groups': [
            {
              'id': 'leave',
              'label': 'Leave',
              'icon': 'calendar',
              'items': [
                {'href': '/my-leave', 'label': 'My leave', 'help': null, 'icon': 'calendar'},
              ],
            },
          ],
        };
      case 'GET /academics/teacher-assignments/mine':
        return {
          'data': [
            {
              'id': 'a1',
              'classSectionId': '300',
              'classCode': 'VI',
              'section': 'A',
              'subjectId': null,
              'kind': 'class_teacher',
              'canMarkAttendance': true,
            },
            {
              'id': 'a2',
              'classSectionId': '301',
              'classCode': 'VII',
              'section': 'B',
              'subjectId': '90',
              'subjectName': 'Science',
              'kind': 'subject_teacher',
              'canMarkAttendance': true,
            },
          ],
        };
      case 'GET /academics/timetable/periods':
        return {
          'data': [
            {'id': 'p1', 'number': 1, 'name': 'I', 'startsAt': '08:00:00', 'endsAt': '08:40:00'},
          ],
        };
      case 'GET /academics/timetable/mine':
        return {
          'data': [
            for (var w = 1; w <= 7; w++)
              {
                'weekday': w,
                'periodId': 'p1',
                'periodNumber': 1,
                'classCode': 'VI',
                'section': 'A',
                'subjectName': 'Mathematics',
                'room': '12',
              },
          ],
        };
      case 'GET /academics/substitutions/mine':
        return {'data': []};
      case 'GET /attendance/summary':
        return {
          'date': c.query?['date'],
          'sections': [
            {
              'classSectionId': '300',
              'section': 'VI-A',
              'strength': 2,
              'sessionId': marked ? 's1' : null,
            },
            {'classSectionId': '999', 'section': 'X-Z', 'strength': 30, 'sessionId': null},
          ],
        };
      case 'GET /attendance/session':
        return {
          'id': null,
          'section': 'VI-A',
          'date': c.query?['date'],
          'locked': false,
          'markedBy': null,
          'roster': [
            {'studentId': '41', 'name': 'Kid Sample', 'rollNo': 1, 'code': null, 'locked': false},
            {'studentId': '42', 'name': 'Ria Sample', 'rollNo': 2, 'code': null, 'locked': true},
          ],
        };
      case 'POST /attendance/sessions':
        marked = true;
        return {'id': 's1', 'alertsSent': 1};
      case 'GET /exams/my-entry':
        return {
          'data': [
            {
              'examId': 'e1',
              'exam': 'Term 1',
              'section': 'VI-A',
              'area': 'marks',
              'what': 'Mathematics',
              'done': 0,
              'total': 2,
            },
          ],
        };
      case 'GET /exams/e1/entry/sections':
        return {
          'data': [
            {
              'classSectionId': '300',
              'code': 'VI-A',
              'subjects': [
                {
                  'examSubjectId': 'es1',
                  'subjectId': '91',
                  'name': 'Mathematics',
                  'maxMarks': 80,
                  'entryLocked': false,
                },
              ],
            },
          ],
        };
      case 'GET /exams/e1/marks':
        return {
          'exam': {'id': 'e1', 'marksLocked': false},
          'examSubject': {'id': 'es1', 'maxMarks': 80, 'entryLocked': false},
          'status': {'status': 'open'},
          'rows': [
            {'studentId': '41', 'name': 'Kid Sample', 'rollNo': 1, 'marks': null, 'absent': false},
            {'studentId': '42', 'name': 'Ria Sample', 'rollNo': 2, 'marks': null, 'absent': false},
          ],
        };
      case 'PUT /exams/e1/marks':
        return {'inserted': 2, 'updated': 0};
      case 'POST /exams/e1/entry-status/submit':
        return {'status': 'submitted'};
      case 'GET /approvals/inbox':
        final items = [
          {
            'kind': 'leave',
            'id': '701',
            'title': 'Kid Sample · VI-A',
            'detail': 'Sick leave · ${day(1)}',
            'by': 'Pia Sample',
            'at': '${day(-1)}T09:00:00Z',
            'amount': null,
            'href': '/leaves?tab=inbox&open=701',
            'app': 'teacher',
            'reasonOnReject': true,
            'reasonOnApprove': false,
            'decideHere': true,
            'approveAs': 'approve',
            'rejectAs': 'reject',
            'url': null,
          },
          {
            'kind': 'receipt',
            'id': '702',
            'title': 'GRN-4 · Sample Traders',
            'detail': null,
            'by': null,
            'at': '${day(-2)}T09:00:00Z',
            'amount': null,
            'href': '/purchase/receipts/702',
            'app': 'teacher',
            'reasonOnReject': true,
            'reasonOnApprove': false,
            'decideHere': false,
            'approveAs': 'approve',
            'rejectAs': 'reject',
            'url': null,
          },
        ].where((i) => !decided.contains(i['id'])).toList();
        return {
          'total': items.length,
          'kinds': [
            {'kind': 'leave', 'label': 'Student leave', 'count': 1},
            {'kind': 'receipt', 'label': 'Goods received to inspect', 'count': 1},
          ],
          'items': items,
          'unavailable': [],
        };
      case 'POST /approvals/leave/701/decision':
        decided.add('701');
        return {'kind': 'leave', 'id': '701', 'decision': c.body!['decision']};
      case 'GET /leave/mine':
        return {
          'balances': [
            {'typeId': 't1', 'code': 'CL', 'name': 'Casual leave', 'available': '6'},
          ],
          'types': [
            {'id': 't1', 'code': 'CL', 'name': 'Casual leave', 'halfDay': true},
          ],
          'rows': [
            {
              'id': '801',
              'leaveType': {'name': 'Casual leave'},
              'from': day(5),
              'to': day(5),
              'days': 1,
              'status': 'pending',
              'cancelStatus': null,
            },
          ],
          'can': {'apply': true},
        };
      case 'POST /leave/apply':
        applies++;
        if (c.body!['bridgeOk'] != true) {
          return {
            'confirm': {'kind': 'bridge', 'message': 'This leave spans a Sunday. Count it?'},
          };
        }
        return {'id': '802', 'status': 'pending', 'days': 3};
      case 'POST /leave/requests/801/withdraw':
        return {'status': 'withdrawn'};
      case 'GET /staff-attendance/mine':
        return {
          'month': c.query?['month'],
          'locked': false,
          'days': [
            {'day': day(-1), 'dayType': 'P', 'words': 'Present', 'in': '07:55', 'out': '14:10'},
          ],
          'regularisations': [],
        };
      case 'POST /staff-attendance/regularisations':
        return {'id': '901', 'status': 'pending'};
      case 'GET /academics/daily-work/sheet/options':
        return {
          'data': [
            {
              'classSectionId': '300',
              'section': 'VI-A',
              'subjects': [
                {'id': '91', 'code': 'MAT', 'name': 'Mathematics'},
              ],
            },
          ],
        };
      case 'POST /academics/daily-work':
        return {'id': '601'};
      // the day's sheet as on the staff website (docs/design/96)
      case 'GET /academics/daily-work/sheet':
        final assignment = c.query?['mode'] == 'assignment';
        return {
          'date': c.query?['date'] ?? '2026-11-20',
          'mode': assignment ? 'assignment' : 'daily',
          'classes': [
            {'id': '30', 'name': 'Class VI'},
          ],
          'classId': '30',
          'options': [
            {'classSectionId': '300', 'section': 'VI-A', 'classId': '30'},
            {'classSectionId': '301', 'section': 'VI-B', 'classId': '30'},
          ],
          'chosen': '${c.query?['sections'] ?? '300,301'}'.split(','),
          'rows': [
            {
              'subject': {'id': '91', 'code': 'MAT', 'name': 'Mathematics'},
              'sections': ['VI-A', 'VI-B'],
              'homework': assignment
                  ? null
                  : {
                      'text': 'Exercise 4.1',
                      'files': 1,
                      'attachments': [
                        {'workId': '611', 'fileId': '81'},
                      ],
                      'dueOn': null,
                      'sections': ['VI-A'],
                    },
              'classwork': null,
              'assignment': null,
            },
            {
              'subject': {'id': '92', 'code': 'SCI', 'name': 'Science'},
              'sections': ['VI-A'],
              'homework': null,
              'classwork': null,
              'assignment': null,
            },
          ],
          'publishAt': '2026-11-20T16:00',
          'publishTime': '16:00',
          'maxMb': 10,
        };
      case 'POST /academics/daily-work/sheet':
        return {'created': 1, 'updated': 1};
      case 'GET /academics/daily-work':
        return {
          'data': [
            {
              'id': '611',
              'kind': 'homework',
              'section': 'VI-A',
              'subjectName': 'Mathematics',
              'title': 'Homework',
              'body': 'Exercise 4.1',
              'assignedOn': '2026-11-20',
              'dueOn': null,
              'postedBy': 'Asha Teacher',
              'files': [
                {'id': '81'},
              ],
              'publishAt': '2026-11-20T10:30:00.000Z',
              'scheduled': false,
              'ackRequired': true,
              'ackCount': 3,
            },
            {
              'id': '612',
              'kind': 'assignment',
              'section': 'VI-A',
              'subjectName': 'Science',
              'title': 'Assignment',
              'body': 'Plant cell model',
              'assignedOn': '2026-11-19',
              'dueOn': '2026-11-26',
              'postedBy': 'Asha Teacher',
              'files': [],
              'publishAt': '2026-11-19T10:30:00.000Z',
              'scheduled': false,
              'ackRequired': false,
              'ackCount': 0,
            },
          ],
          'page': {'more': false},
        };
      case 'GET /academics/daily-work/report':
        return null;
      // session plan, curriculum, date sheet (docs/design/96, part 3)
      case 'GET /academics/documents':
        return {
          'data': [
            {
              'id': '23',
              'kind': 'session_plan',
              'kindLabel': 'Session plan',
              'title': 'Session plan for term 2',
              'remark': '<p>Read before the parents meeting.</p>',
              'classSectionId': '300',
              'section': 'VI-A',
              'subject': 'Science',
              'fileIds': ['81'],
              'publishAt': '2026-11-20T04:30:00.000Z',
              'scheduled': false,
              'ackRequired': true,
              'ackCount': 1,
              'postedBy': 'Asha Teacher',
            },
            {
              'id': '24',
              'kind': 'magazine',
              'kindLabel': 'School magazine',
              'title': 'The school magazine',
              'remark': null,
              'classSectionId': null,
              'section': null,
              'subject': null,
              'fileIds': ['82'],
              'publishAt': '2026-11-01T04:30:00.000Z',
              'scheduled': false,
              'ackRequired': false,
              'ackCount': 0,
              'postedBy': null,
            },
          ],
        };
      case 'POST /academics/documents':
        return {'id': '701'};
      case 'DELETE /academics/documents/23':
        return {'ok': true};
      case 'GET /academics/documents/report':
        return null;
      case 'GET /academics/acks':
        return {
          'title': 'Session plan for term 2',
          'section': 'VI-A',
          'ackRequired': true,
          'roster': true,
          'acknowledged': 1,
          'total': 2,
          'data': [
            {
              'id': '1',
              'name': 'Pupil One',
              'rollNo': 1,
              'ackedAt': '2026-11-20T10:00:00.000Z',
              'by': 'Parent One',
            },
            {'id': '2', 'name': 'Pupil Two', 'rollNo': 2, 'ackedAt': null, 'by': null},
          ],
        };
      case 'GET /payroll/me/payslips':
        return {
          'fy': c.query?['fy'],
          'years': ['2026'],
          'rows': [
            {'id': 'r1', 'month': '2026-10', 'netPay': '45210.00'},
          ],
          'passwordHint': 'Your PAN in capitals',
        };
      case 'GET /payroll/me/payslips/r1':
        return const ApiFile(bytes: [1], contentType: 'application/octet-stream', name: 'slip.pdf');
      case 'GET /comms/inbox/unread':
        return {'unread': 0};
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<(FakeTransport, School)> pumpStaff(
  WidgetTester tester, {
  bool hindi = false,
  Size size = const Size(420, 1600),
  School? with_,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  SharedPreferences.setMockInitialValues({'profile': 'staff:7', 'hindi': hindi});
  final school = with_ ?? School();
  final t = FakeTransport(school.answer);
  final mem = MemorySecureStore();
  final s = SessionStore(mem);
  await s.save(
    accessToken: 'otp.a',
    expiresAt: DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
    refreshToken: 'r' * 43,
  );
  await s.setPin('2468');
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        transportProvider.overrideWithValue(t),
        secureStoreProvider.overrideWithValue(mem),
        webFontsProvider.overrideWithValue(false),
        deviceProvider.overrideWith(
          (ref) async =>
              const DeviceDetails(id: 'phone-test0001', name: 'Test phone', platform: 'android'),
        ),
      ],
      child: const EduProApp(),
    ),
  );
  await tester.pumpAndSettle();
  await enterPin(tester, '2468');
  return (t, school);
}

Future<void> scrollTo(WidgetTester tester, Finder f) async {
  // built is not enough (a list builds a little past the screen): bring it into view
  if (f.evaluate().isEmpty) {
    // up first (back on a list scrolled down), then down
    try {
      await tester.scrollUntilVisible(
        f,
        -200,
        scrollable: find.byType(Scrollable).first,
        maxScrolls: 20,
      );
    } on StateError {
      await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
    }
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

Finder fig(String key, String value) =>
    find.descendant(of: find.byKey(Key(key)), matching: find.text(value));

void main() {
  testWidgets('My day: the figures, today\'s period, the class still to mark; the tabs', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpStaff(tester, size: const Size(420, 2200));
    // the school's layout (docs/design/94): Home + Attendance, Classes, Messages + More
    for (final tab in ['Home', 'Attendance', 'Classes', 'Messages', 'More']) {
      expect(
        find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)),
        findsOneWidget,
      );
    }
    expect(fig('figPeriods', '1'), findsOneWidget);
    // only the teacher's own day section, not every section of the school
    expect(fig('figToMark', '1'), findsOneWidget);
    expect(find.byKey(const Key('toMark-300')), findsOneWidget);
    expect(find.byKey(const Key('toMark-999')), findsNothing);
    expect(fig('figToEnter', '1'), findsOneWidget);
    expect(fig('figApprovals', '2'), findsOneWidget);
    expect(find.text('VI-A · Mathematics'), findsOneWidget);
    // the approvals count in the bar
    expect(
      find.descendant(of: find.byKey(const Key('approvalsButton')), matching: find.text('2')),
      findsOneWidget,
    );
    // today's roll is kept on the phone for later
    expect(t.calls.where((c) => c.path == '/attendance/session').length, 1);
  });

  testWidgets(
    'marking a class: the roll, a pupil absent, saved with a key; one on leave stays leave',
    (tester) async {
      final (t, _) = await pumpStaff(tester);
      await tester.tap(find.byKey(const Key('toMark-300')));
      await tester.pumpAndSettle();
      expect(find.text('Kid Sample'), findsOneWidget);
      expect(find.text('On approved leave'), findsOneWidget);
      await tester.tap(find.byKey(const Key('mark-41-A')));
      await tester.pumpAndSettle();
      expect(find.text('Present 0 · Absent 1 · of 2'), findsOneWidget);
      await tester.tap(find.byKey(const Key('saveMarks')));
      await tester.pumpAndSettle();
      final sent = t.calls.lastWhere((c) => c.path == '/attendance/sessions');
      expect(sent.body, {
        'classSectionId': '300',
        'date': day(0),
        'kind': 'day',
        'marks': [
          {'studentId': '41', 'code': 'A'},
          {'studentId': '42', 'code': 'LV'},
        ],
      });
      expect(sent.headers['Idempotency-Key'], isA<String>());
      expect(sent.headers['X-School-Id'], '7');
      expect(find.text('Saved.'), findsOneWidget);
    },
  );

  testWidgets('with no network the marks are kept on the phone and sent when it is back', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester);
    await tester.tap(find.byKey(const Key('toMark-300')));
    await tester.pumpAndSettle();
    school.offline = true;
    await tester.tap(find.byKey(const Key('saveMarks')));
    await tester.pumpAndSettle();
    expect(find.text('Saved on the phone. It is sent when the internet is back.'), findsOneWidget);
    expect(find.byKey(const Key('outboxBanner')), findsOneWidget);
    expect(school.marked, isFalse);
    // back online: the list of unsent work, send now
    school.offline = false;
    await tester.tap(find.byKey(const Key('outboxBanner')));
    await tester.pumpAndSettle();
    expect(find.textContaining('VI-A · Day attendance'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sendNow')));
    await tester.pumpAndSettle();
    expect(school.marked, isTrue);
    expect(find.byKey(const Key('sendNow')), findsNothing);
    final keys = t.calls
        .where((c) => c.path == '/attendance/sessions')
        .map((c) => c.headers['Idempotency-Key']);
    // every try of the one write carried the same key
    expect(keys.toSet().length, 1);
  });

  testWidgets('approvals: the list by kind; a reason to reject; one decided on its own page', (
    tester,
  ) async {
    final (t, _) = await pumpStaff(tester);
    await tester.tap(find.byKey(const Key('approvalsButton')));
    await tester.pumpAndSettle();
    expect(find.text('Kid Sample · VI-A'), findsOneWidget);
    expect(find.text('GRN-4 · Sample Traders'), findsOneWidget);
    // a goods receipt is decided line by line on its page
    await tester.tap(find.byKey(const Key('approval-receipt-702')));
    await tester.pumpAndSettle();
    expect(find.textContaining('decided on its own page'), findsOneWidget);
    expect(find.byKey(const Key('approveIt')), findsNothing);
    expect(find.byKey(const Key('openPage')), findsOneWidget);
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    // the leave: no reason, then a reason
    await tester.tap(find.byKey(const Key('approval-leave-701')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('rejectIt')));
    await tester.pumpAndSettle();
    expect(find.text('Write the reason (at least 3 letters).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('decisionReason')), 'Exams that week');
    await tester.tap(find.byKey(const Key('rejectIt')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/approvals/leave/701/decision').body, {
      'decision': 'reject',
      'reason': 'Exams that week',
    });
    expect(find.text('Kid Sample · VI-A'), findsNothing);
  });

  testWidgets('my leave: apply, confirm the bridge the school asks about; withdraw one waiting', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester);
    await tester.tap(find.text('Attendance').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('My leave'));
    await tester.pumpAndSettle();
    expect(find.text('Casual leave: 6 available'), findsOneWidget);
    await tester.tap(find.byKey(const Key('applyStaffLeave')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('staffLeaveType')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Casual leave').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('staffLeaveReason')), 'A family function');
    await tester.tap(find.byKey(const Key('sendStaffLeave')));
    await tester.pumpAndSettle();
    expect(find.text('This leave spans a Sunday. Count it?'), findsOneWidget);
    await tester.tap(find.byKey(const Key('confirmLeave')));
    await tester.pumpAndSettle();
    expect(school.applies, 2);
    final last = t.calls.lastWhere((c) => c.path == '/leave/apply');
    expect(last.body, containsPair('bridgeOk', true));
    expect(last.body, containsPair('leaveTypeId', 't1'));
    expect(find.text('Leave application sent.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('leaveAction-801')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/leave/requests/801/withdraw'), isTrue);
  });

  testWidgets('my attendance: the month from the punches; a correction asked for once', (
    tester,
  ) async {
    final (t, _) = await pumpStaff(tester);
    await tester.tap(find.text('Attendance').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('My attendance'));
    await tester.pumpAndSettle();
    expect(find.text('In 07:55 · Out 14:10'), findsOneWidget);
    await tester.tap(find.byKey(const Key('askCorrection')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('sendCorrection')));
    await tester.pumpAndSettle();
    expect(find.text('Give the in or out time, or what the day should be.'), findsOneWidget);
    await tester.tap(find.text('Half day'));
    await tester.enterText(find.byKey(const Key('corrReason')), 'Left early for a meeting');
    await tester.tap(find.byKey(const Key('sendCorrection')));
    await tester.pumpAndSettle();
    final c = t.calls.lastWhere((c) => c.path == '/staff-attendance/regularisations');
    expect(c.body, {'day': day(0), 'dayType': 'HD', 'reason': 'Left early for a meeting'});
    expect(c.headers['Idempotency-Key'], isA<String>());
    expect(find.text('Correction asked for.'), findsOneWidget);
  });

  testWidgets('marks: over the maximum is refused; saved, then sent for checking', (tester) async {
    final (t, _) = await pumpStaff(tester);
    await tester.tap(find.byKey(const Key('figToEnter')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('exam-e1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('sheet-300-91')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('marks-41')), '95');
    await tester.tap(find.byKey(const Key('saveMarksSheet')));
    await tester.pumpAndSettle();
    expect(find.text('Marks can be at most 80.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('marks-41')), '72');
    await tester.tap(find.byKey(const Key('absent-42')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('submitMarks')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.method == 'PUT' && c.path == '/exams/e1/marks').body, {
      'classSectionId': '300',
      'subjectId': '91',
      'rows': [
        {'studentId': '41', 'marks': 72, 'absent': false},
        {'studentId': '42', 'absent': true},
      ],
    });
    expect(t.calls.any((c) => c.path == '/exams/e1/entry-status/submit'), isTrue);
    expect(find.text('Sent for checking.'), findsOneWidget);
  });

  testWidgets(
    'Daily work as on the website: the sheet saved for the sections; assignments; the report',
    (tester) async {
      final (t, _) = await pumpStaff(tester, size: const Size(420, 2400));
      await tester.tap(find.text('Classes').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Daily work'));
      await tester.pumpAndSettle();
      // the day's sheet: the class's sections ticked, a card per subject with what was posted
      expect(find.byKey(const Key('workSheet-daily')), findsOneWidget);
      expect(find.byKey(const Key('sheetSection-300')), findsOneWidget);
      expect(find.text('Mathematics'), findsOneWidget);
      expect(find.text('VI-A only'), findsOneWidget);
      expect(find.textContaining('Posted for VI-A · 1 file(s) attached'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('sheet-classwork-91')), 'Fractions on the board');
      await tester.enterText(find.byKey(const Key('sheet-homework-92')), 'Read chapter 4');
      await tester.ensureVisible(find.byKey(const Key('saveSheet-daily')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sheetAck-daily')));
      await tester.tap(find.byKey(const Key('saveSheet-daily')));
      await tester.pumpAndSettle();
      final save = t.calls.lastWhere(
        (c) => c.path == '/academics/daily-work/sheet' && c.method == 'POST',
      );
      expect(save.body, containsPair('classSectionIds', ['300', '301']));
      expect(save.body, containsPair('mode', 'daily'));
      expect(save.body, containsPair('ackRequired', true));
      expect(save.body, containsPair('publishAt', '2026-11-20T16:00'));
      final rows = (save.body!['rows'] as List).cast<Map<String, Object?>>();
      expect(
        rows.firstWhere((r) => r['subjectId'] == '91'),
        containsPair('classwork', 'Fractions on the board'),
      );
      expect(
        rows.firstWhere((r) => r['subjectId'] == '91'),
        containsPair('homework', 'Exercise 4.1'),
      );
      expect(
        rows.firstWhere((r) => r['subjectId'] == '92'),
        containsPair('homework', 'Read chapter 4'),
      );
      expect(find.text('Saved: 1 new, 1 updated.'), findsOneWidget);
      // a section left out: the sheet reloads for the one ticked
      await tester.ensureVisible(find.byKey(const Key('sheetSection-301')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sheetSection-301')));
      await tester.pumpAndSettle();
      expect(
        t.calls.lastWhere((c) => c.path == '/academics/daily-work/sheet').query,
        containsPair('sections', '300'),
      );
      // assignments: the same sheet with a due date
      Finder tab(String label) =>
          find.descendant(of: find.byKey(const Key('dailyWorkTabs')), matching: find.text(label));
      await tester.tap(tab('Assignments'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('workSheet-assignment')), findsOneWidget);
      expect(find.byKey(const Key('sheetDue-91')), findsOneWidget);
      // the report: by date, class and subject; the acknowledged count; the PDF
      await tester.tap(tab('Report'));
      await tester.pumpAndSettle();
      expect(find.text('Exercise 4.1'), findsOneWidget);
      expect(find.textContaining('3 acknowledged'), findsOneWidget);
      expect(find.text('Plant cell model'), findsOneWidget);
      await tester.tap(find.byKey(const Key('reportPdf')));
      await tester.pumpAndSettle();
      final file = t.calls.lastWhere((c) => c.path == '/academics/daily-work/report');
      expect(file.query, containsPair('format', 'pdf'));
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      await tester.tap(find.text('My payslips'));
      await tester.pumpAndSettle();
      expect(find.textContaining('₹45,210'), findsOneWidget);
      await tester.tap(find.byKey(const Key('payslip-r1')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/payroll/me/payslips/r1'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      await tester.tap(find.text('More').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('My leave'));
      await tester.pumpAndSettle();
      // the native screen, not a web page
      expect(find.byKey(const Key('applyStaffLeave')), findsOneWidget);
    },
  );

  testWidgets(
    'Home like the students’: the greeting, the shortcuts with All, the cards in the school’s order',
    (tester) async {
      final (t, _) = await pumpStaff(tester, size: const Size(420, 2400));
      expect(t.calls.where((c) => c.path == '/me/staff-layout'), isNotEmpty);
      expect(find.textContaining(', Asha'), findsOneWidget);
      expect(find.text('Shortcuts'), findsOneWidget);
      for (final k in [
        'attendance',
        'dailyWork',
        'timetable',
        'myLeave',
        'leaveApprovals',
        'all',
      ]) {
        expect(find.byKey(Key('shortcut-$k')), findsOneWidget, reason: k);
      }
      // the cards in the school's order: approvals first, then classes to mark …
      final approvalsY = tester.getTopLeft(find.text('Approvals').last).dy;
      final toMarkY = tester.getTopLeft(find.byKey(const Key('toMark-300'))).dy;
      expect(approvalsY < toMarkY, isTrue);
      expect(find.byKey(const Key('homeApproval-leave-701')), findsOneWidget);
      expect(find.text('Casual leave: 6 available'), findsOneWidget);
      expect(find.text('Latest messages'), findsOneWidget);
      expect(find.byKey(const Key('homeMessage-m1')), findsOneWidget);
      // a native screen opens in the app
      await tester.tap(find.byKey(const Key('shortcut-myLeave')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('applyStaffLeave')), findsOneWidget);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // All: every screen (More)
      await tester.tap(find.byKey(const Key('shortcut-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('moreList')), findsOneWidget);
    },
  );

  testWidgets('Edit shortcuts: a staff member keeps their own, then back to the school’s', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2400));
    await tester.tap(find.byKey(const Key('editShortcuts')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('remove-dailyWork')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('add-help')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('saveShortcuts')));
    await tester.pumpAndSettle();
    final put = t.calls.lastWhere((c) => c.method == 'PUT');
    expect(put.path, '/me/staff-layout/shortcuts');
    expect(put.body, {
      'shortcuts': ['/attendance', '/timetable', '/my-leave', '/leave-approvals', '/help'],
    });
    expect(school.own, isNotNull);
    expect(find.text('Your own shortcuts'), findsOneWidget);
    expect(find.byKey(const Key('shortcut-help')), findsOneWidget);
    expect(find.byKey(const Key('shortcut-dailyWork')), findsNothing);
    await tester.tap(find.byKey(const Key('editShortcuts')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('resetShortcuts')));
    await tester.pumpAndSettle();
    expect(
      t.calls.where((c) => c.method == 'DELETE' && c.path == '/me/staff-layout/shortcuts'),
      hasLength(1),
    );
    expect(find.byKey(const Key('shortcut-dailyWork')), findsOneWidget);
  });

  testWidgets('a tab the school chose with only a web page opens it from the tab', (tester) async {
    await pumpStaff(tester, with_: School(webTab: true));
    await tester.tap(
      find.descendant(of: find.byType(NavigationBar), matching: find.text('Leave to approve')),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('openWeb-leaveApprovals')), findsOneWidget);
  });

  testWidgets('More follows the school’s staff menu: its order and its names', (tester) async {
    await pumpStaff(tester, with_: School(arranged: true));
    await tester.tap(find.text('More').last);
    await tester.pumpAndSettle();
    final leave = find.text('My leave and attendance');
    final classes = find.text('My classes');
    expect(leave, findsOneWidget);
    expect(classes, findsOneWidget);
    // the school's order: leave first
    expect(tester.getTopLeft(leave).dy, lessThan(tester.getTopLeft(classes).dy));
    // what the school hid never comes: only what the menu sends is listed
    expect(
      find.descendant(of: find.byKey(const Key('moreList')), matching: find.text('Timetable')),
      findsNothing,
    );
  });

  testWidgets(
    'Session plan, curriculum, date sheet in the app: upload checks, the list, who acknowledged, remove, PDF',
    (tester) async {
      final (t, _) = await pumpStaff(tester, size: const Size(420, 2400));
      await tester.tap(find.text('Classes').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Session plan, curriculum, date sheet'));
      await tester.pumpAndSettle();
      // no web page: the app's own screen
      expect(find.byKey(const Key('docsUpload')), findsOneWidget);
      expect(find.byKey(const Key('openWeb-documents')), findsNothing);
      // Upload: a class, a title and a file are asked for
      await tester.tap(find.byKey(const Key('docUpload')));
      await tester.pumpAndSettle();
      expect(find.text('Choose at least one class.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('docSection-300')));
      await tester.tap(find.byKey(const Key('docKind-date_sheet')));
      await tester.enterText(find.byKey(const Key('docTitle')), 'Unit test date sheet');
      await tester.tap(find.byKey(const Key('docUpload')));
      await tester.pumpAndSettle();
      expect(find.text('Attach at least one file.'), findsOneWidget);
      expect(t.calls.where((c) => c.path == '/academics/documents' && c.method == 'POST'), isEmpty);
      // Uploaded: the list with its files and who acknowledged
      Finder tab(String label) =>
          find.descendant(of: find.byKey(const Key('docsTabs')), matching: find.text(label));
      await tester.tap(tab('Uploaded'));
      await tester.pumpAndSettle();
      expect(find.text('Session plan for term 2'), findsOneWidget);
      expect(find.text('VI-A · Science'), findsOneWidget);
      expect(find.text('School magazine'), findsWidgets);
      // a school-wide item: not the teacher's to remove
      expect(find.byKey(const Key('docRemove-24')), findsNothing);
      await tester.tap(find.byKey(const Key('docAcks-23')));
      await tester.pumpAndSettle();
      expect(find.text('1 of 2 acknowledged'), findsOneWidget);
      expect(find.text('Not yet'), findsOneWidget);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('docRemove-23')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('docRemoveYes')));
      await tester.pumpAndSettle();
      expect(
        t.calls.any((c) => c.method == 'DELETE' && c.path == '/academics/documents/23'),
        isTrue,
      );
      expect(find.text('Removed.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('docsPdf')));
      await tester.pumpAndSettle();
      expect(
        t.calls.lastWhere((c) => c.path == '/academics/documents/report').query,
        containsPair('format', 'pdf'),
      );
    },
  );

  testWidgets('list tabs: the school’s names and screens, its own list; Hindi names (part 3)', (
    tester,
  ) async {
    await pumpStaff(tester, with_: School(lists: true));
    Finder tab(String label) =>
        find.descendant(of: find.byType(NavigationBar), matching: find.text(label));
    expect(tab('Attendance & leave'), findsOneWidget);
    expect(tab('Office'), findsOneWidget);
    expect(tab('Classes'), findsOneWidget);
    await tester.tap(tab('Attendance & leave'));
    await tester.pumpAndSettle();
    final list = find.byKey(const Key('listTab-attendance'));
    expect(list, findsOneWidget);
    // the school's screens in its order, the app's own words for its own screens
    final s = S(false);
    final rows = [s.markClass, s.myAttendance, s.myLeave, 'Leave to approve'];
    for (var i = 1; i < rows.length; i++) {
      expect(
        tester.getTopLeft(find.descendant(of: list, matching: find.text(rows[i]))).dy,
        greaterThan(
          tester.getTopLeft(find.descendant(of: list, matching: find.text(rows[i - 1]))).dy,
        ),
      );
    }
    await tester.tap(tab('Office'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('list-list-1-messages')), findsOneWidget);
    expect(find.byKey(const Key('list-list-1-help')), findsOneWidget);
    // the app's own screen opens from a list
    await tester.tap(tab('Attendance & leave'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('list-attendance-myLeave')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('applyStaffLeave')), findsOneWidget);
  });

  testWidgets('list tabs in Hindi: the school’s Hindi names', (tester) async {
    await pumpStaff(tester, hindi: true, with_: School(lists: true));
    Finder tab(String label) =>
        find.descendant(of: find.byType(NavigationBar), matching: find.text(label));
    expect(tab('उपस्थिति और अवकाश'), findsOneWidget);
    expect(tab('कक्षाएँ'), findsOneWidget);
    // no Hindi name given: the name as the school wrote it
    expect(tab('Office'), findsOneWidget);
  });

  testWidgets('More in Hindi: the school’s Hindi group name', (tester) async {
    await pumpStaff(tester, hindi: true, with_: School(arranged: true));
    final s = S(true);
    await tester.tap(find.text(s.more).last);
    await tester.pumpAndSettle();
    expect(find.text('मेरा अवकाश'), findsOneWidget);
    expect(find.text('My leave and attendance'), findsNothing);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''}): staff screens',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi);
        final s = S(hindi);
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

        await check('My day');
        await tester.tap(find.byKey(const Key('toMark-300')));
        await check('Mark a class');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('approvalsButton')));
        await check('Approvals');
        await tester.tap(find.byKey(const Key('approval-leave-701')));
        await check('Decide');
        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.attendance).last);
        await tester.pumpAndSettle();
        for (final screen in [s.myAttendance, s.myLeave]) {
          await tester.tap(find.text(screen));
          await check(screen);
          await tester.tap(find.byType(BackButton));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        for (final screen in [
          s.dailyWork,
          s.marksEntry,
          s.myTimetable,
          s.payslips,
          s.menu('Session plan, curriculum, date sheet'),
        ]) {
          await tester.tap(find.text(screen));
          await check(screen);
          await tester.tap(find.byType(BackButton));
          await tester.pumpAndSettle();
        }
        handle.dispose();
      },
    );
  }

  testWidgets('large text (twice the size): staff screens lay out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    expect(tester.takeException(), isNull, reason: 'My day');
    await scrollTo(tester, find.byKey(const Key('toMark-300')));
    expect(tester.takeException(), isNull, reason: 'My day, scrolled');
    await tester.tap(find.byKey(const Key('toMark-300')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Mark a class');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('approvalsButton')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Approvals');
    await tester.tap(find.byKey(const Key('approval-leave-701')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Decide');
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Attendance').last);
    await tester.pumpAndSettle();
    for (final screen in ['My attendance', 'My leave']) {
      await scrollTo(tester, find.text(screen));
      await tester.tap(find.text(screen));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: screen);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    for (final screen in [
      'Daily work',
      'Marks entry',
      'My timetable',
      'My payslips',
      'Session plan, curriculum, date sheet',
    ]) {
      await scrollTo(tester, find.text(screen));
      await tester.tap(find.text(screen));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: screen);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
    }
  });
}
