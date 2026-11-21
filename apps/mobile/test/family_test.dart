import 'dart:convert';

import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/family/attendance.dart';
import 'package:edupro/family/data.dart';
import 'package:edupro/family/layout.dart' show familyLayoutProvider;
import 'package:edupro/family/queries.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/staff/data.dart' show PickedFile;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// Phase B (docs/design/89 §5.2): a parent's and a student's screens against a made-up school. Every name, number
/// and amount here is made up.
final now = DateTime.now();
String day(int offset) => ymd(now.add(Duration(days: offset)));

Map<String, Object?> profile(String kind) => {
  'id': kind == 'parent' ? 'parent:7:41' : 'student:7:41',
  'kind': kind,
  'schoolId': '7',
  'schoolCode': 'SAMPLE',
  'schoolName': 'Sample School',
  'name': 'Kid Sample',
  'detail': 'VI-A · A1234',
  'studentId': '41',
  'app': 'parent',
  'actingAs': null,
  'hasPhoto': false,
};

/// What the fake API answers; [offline] makes every call fail as if there were no network.
class School {
  bool offline = false;
  String kind = 'parent';

  /// the school takes queries from this parent: the menu has the Queries page
  bool queries = false;

  /// the school shows the teachers' numbers and e-mails in full (otherwise in part)
  bool teachersFull = false;

  /// the school's layout for this person (docs/design/90); none: the app as it was (the call fails)
  Map<String, Object?>? layout;

  /// the person's own Home shortcuts saved here
  List<String>? own;

  /// the school's published side menu for the menu call (docs/design/90); none: the menu as built
  List<Map<String, Object?>>? menuGroups;
  int statusPolls = 0;
  final leaves = <Map<String, Object?>>[
    {
      'id': '901',
      'number': 'LV-1',
      'studentId': '41',
      'student': 'Kid Sample',
      'leaveTypeLabel': 'Sick leave',
      'fromDate': day(3),
      'toDate': day(3),
      'days': 1,
      'reason': 'Doctor visit',
      'fileIds': [],
      'long': false,
      'status': 'pending',
      'decisionNote': null,
      'endedOn': null,
      'waitingOn': 'Class teacher',
    },
    {
      'id': '902',
      'number': 'LV-2',
      'studentId': '41',
      'student': 'Kid Sample',
      'leaveTypeLabel': 'Medical leave',
      'fromDate': day(-1),
      'toDate': day(2),
      'days': 4,
      'reason': 'Recovering at home',
      'fileIds': ['77'],
      'long': true,
      'status': 'approved',
      'decisionNote': 'Get well soon',
      'endedOn': null,
      'waitingOn': null,
    },
    {
      'id': '902',
      'number': 'LV-2',
      'studentId': '99',
      'student': 'Another Child',
      'leaveTypeLabel': 'Sick leave',
      'fromDate': day(1),
      'toDate': day(1),
      'days': 1,
      'reason': 'Not this child',
      'fileIds': [],
      'long': false,
      'status': 'pending',
      'decisionNote': null,
      'endedOn': null,
      'waitingOn': null,
    },
  ];

  dynamic answer(Call c) {
    if (offline) throw const ApiException(0, 'offline', 'No connection');
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /me/app-layout':
        if (layout == null) throw const ApiException(404, 'not-found', 'no layout');
        return withOwn(layout!, own);
      case 'PUT /me/app-layout/shortcuts':
        own = [for (final x in c.body!['shortcuts'] as List) '$x'];
        return withOwn(layout!, own);
      case 'DELETE /me/app-layout/shortcuts':
        own = null;
        return withOwn(layout!, own);
      case 'GET /me/profiles':
        return {
          'data': [profile(kind)],
        };
      case 'GET /me/menu' when menuGroups != null:
        return {'app': 'parent', 'groups': menuGroups};
      case 'GET /me/menu':
        return {
          'app': 'parent',
          'groups': [
            {
              'label': 'My child',
              'icon': 'users',
              'items': [
                {'href': '/profile', 'label': 'Profile', 'help': null, 'icon': 'user'},
                {'href': '/teachers', 'label': 'My teachers', 'help': null, 'icon': 'users'},
                {
                  'href': '/documents',
                  'label': 'Session plan and date sheets',
                  'help': null,
                  'icon': 'file',
                },
                {'href': '/health', 'label': 'Health', 'help': null, 'icon': 'heart'},
                {'href': '/directory', 'label': 'School directory', 'help': null, 'icon': 'search'},
                {'href': '/certificates', 'label': 'Certificates', 'help': null, 'icon': 'file'},
              ],
            },
            if (queries)
              {
                'label': 'Home',
                'icon': 'home',
                'items': [
                  {'href': '/queries', 'label': 'Queries', 'help': null, 'icon': 'inbox'},
                ],
              },
          ],
        };
      case 'GET /attendance/mine':
        return {
          'month': c.query?['month'],
          'children': [
            {
              'id': '41',
              'name': 'Kid Sample',
              'section': 'VI-A',
              'month': c.query?['month'],
              'days': [
                {
                  'date': day(0),
                  'code': 'P',
                  'inAt': '${day(0)}T02:35:00.000Z',
                  'outAt': '${day(0)}T08:40:00.000Z',
                },
              ],
              'summary': {'days': 20, 'present': 18, 'absent': 1, 'leave': 1},
            },
            {
              'id': '99',
              'name': 'Another Child',
              'section': 'II-B',
              'days': [],
              'summary': {'days': 20, 'present': 2, 'absent': 18, 'leave': 0},
            },
          ],
        };
      case 'GET /academics/my-teachers':
        final how = teachersFull ? 'full' : 'masked';
        return {
          'contact': {'mobile': how, 'email': how},
          'students': [
            {
              'id': '41',
              'name': 'Kid Sample',
              'section': 'VI-A',
              'teachers': [
                {
                  'employeeId': '51',
                  'name': 'Tara Teacher',
                  'designation': 'TGT',
                  'role': 'class_teacher',
                  'subjects': ['English'],
                  'mobile': teachersFull ? '9000000051' : '90XXXXXX51',
                  'email': teachersFull ? 'tara@example.test' : 't***@example.test',
                  'hasPhoto': true,
                },
                {
                  'employeeId': '52',
                  'name': 'Sam Tutor',
                  'designation': null,
                  'role': 'subject_teacher',
                  'subjects': ['Maths', 'Science'],
                  'mobile': null,
                  'email': null,
                  'hasPhoto': false,
                },
              ],
            },
            {'id': '99', 'name': 'Another Child', 'section': 'II-B', 'teachers': []},
          ],
        };
      case 'GET /academics/my-teachers/51/photo':
        // a 1 × 1 PNG
        return ApiFile(
          bytes: base64Decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          ),
          contentType: 'image/png',
          name: 'photo.png',
        );
      case 'GET /attendance/bus-roll/mine':
        return {
          'month': c.query?['month'],
          'children': [
            {
              'id': '41',
              'days': [
                {'date': day(0), 'pick': 'P', 'drop': null, 'route': 'R1'},
              ],
              'summary': {'trips': 1, 'onBus': 1, 'notOnBus': 0},
            },
          ],
        };
      case 'GET /attendance/desk/mine/year':
        return {
          'months': ['2026-07', '2026-08'],
          'children': [
            {
              'id': '41',
              'name': 'Kid Sample',
              'section': 'VI-A',
              'months': [
                {'month': '2026-07', 'days': 20, 'present': 19, 'absent': 1, 'leave': 0, 'late': 2},
                {'month': '2026-08', 'days': 20, 'present': 14, 'absent': 4, 'leave': 2, 'late': 0},
              ],
              'total': {'days': 40, 'present': 33, 'absent': 5, 'leave': 2, 'late': 2},
            },
          ],
        };
      case 'GET /attendance/leaves/mine/902/files/77':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'c.pdf',
        );
      case 'POST /platform/files':
        return {
          'file': {'id': '88'},
          'upload': {'url': '/upload/88', 'method': 'PUT'},
        };
      case 'PUT /upload/88':
        return null;
      case 'POST /platform/files/88/complete':
        return {'ok': true};
      case 'GET /attendance/leaves/mine':
        return {
          'longDays': 3,
          'backDays': 7,
          'types': [
            {'value': 'SICK', 'label': 'Sick leave', 'certificate': 'long', 'maxDays': null},
            {'value': 'MED', 'label': 'Medical leave', 'certificate': 'always', 'maxDays': null},
          ],
          'students': [
            {'id': '41', 'name': 'Kid Sample'},
          ],
          'leaves': leaves,
        };
      case 'POST /attendance/leaves/mine':
        leaves.insert(0, {
          ...leaves.first,
          'id': '903',
          'reason': c.body!['reason'],
          'status': 'pending',
        });
        return {'id': '903'};
      case 'POST /attendance/leaves/mine/901/cancel':
        leaves.firstWhere((l) => l['id'] == '901')['status'] = 'cancelled';
        return {'ok': true};
      case 'GET /academics/daily-work/viewer':
        return {
          'kind': 'family',
          'students': [
            {'id': '41', 'name': 'Kid Sample', 'classSectionId': '300', 'section': 'VI-A'},
          ],
        };
      case 'GET /academics/daily-work' when (c.query ?? const {})['kind'] == 'assignment':
        expect(c.query!['classSectionId'], '300');
        return {
          'data': [
            for (final (id, due, title) in [
              ('511', day(3), 'Project on rivers'),
              ('512', day(-1), 'Essay on trees'),
            ])
              {
                'id': id,
                'kind': 'assignment',
                'classSectionId': '300',
                'section': 'VI-A',
                'subjectName': 'Geography',
                'title': title,
                'body': '',
                'assignedOn': day(-5),
                'dueOn': due,
                'postedBy': 'Ravi Teacher',
                'files': [],
                'publishAt': '${day(-5)}T04:00:00Z',
                'ackRequired': false,
                'ackedFor': [],
              },
          ],
        };
      case 'GET /academics/daily-work':
        expect(c.query!['classSectionId'], '300');
        return {
          'data': [
            {
              'id': '510',
              'kind': 'assignment',
              'classSectionId': '300',
              'section': 'VI-A',
              'subjectName': 'Geography',
              'title': 'An assignment, not on the day view',
              'body': '',
              'assignedOn': day(0),
              'dueOn': day(9),
              'postedBy': null,
              'files': [],
              'publishAt': day(0),
              'ackRequired': false,
              'ackedFor': [],
            },
            {
              'id': '501',
              'kind': 'homework',
              'classSectionId': '300',
              'section': 'VI-A',
              'subjectName': 'Science',
              'title': 'Plant a seed',
              'body': 'Plant a seed in a cup and note what happens each day.',
              'assignedOn': day(0),
              'dueOn': day(1),
              'postedBy': 'Asha Teacher',
              'files': [
                {'id': '71', 'name': 'sheet.pdf'},
              ],
              'publishAt': day(0),
              'ackRequired': true,
              'ackedFor': [],
            },
            {
              'id': '502',
              'kind': 'classwork',
              'classSectionId': '300',
              'section': 'VI-A',
              'subjectName': 'Maths',
              'title': 'Fractions page 12',
              'body': 'Done in class.',
              'assignedOn': day(-2),
              'dueOn': null,
              'postedBy': null,
              'files': [],
              'publishAt': day(-2),
              'ackRequired': false,
              'ackedFor': [],
            },
          ],
        };
      case 'POST /academics/acks':
        return {'ok': true};
      case 'GET /academics/daily-work/501/files/71':
        return const ApiFile(bytes: [1, 2, 3], contentType: 'application/octet-stream', name: 'x');
      case 'GET /academics/notices':
        return {
          'data': [
            {
              'id': '601',
              'kind': 'circular',
              'title': 'Sports day',
              'body': '<p>Sports day is on <b>Friday</b>.</p>',
              'bodyFormat': 'html',
              'ackRequired': true,
              'ackedFor': [],
              'publishFrom': '${day(-1)}T09:00:00Z',
              'publishedBy': 'Office',
              'isPinned': false,
              'targets': [],
              'files': [],
            },
          ],
        };
      case 'GET /academics/notices/601':
        return {
          'id': '601',
          'kind': 'circular',
          'title': 'Sports day',
          'body': '<p>Sports day is on <b>Friday</b>.</p>',
          'bodyFormat': 'html',
          'ackRequired': true,
          'ackedFor': [],
          'publishFrom': '${day(-1)}T09:00:00Z',
          'publishedBy': 'Office',
          'isPinned': false,
          'targets': [],
          'files': [],
        };
      case 'GET /comms/inbox/unread':
        return {'unread': 3};
      case 'GET /comms/inbox':
        return {
          'data': [
            {
              'id': 'm1',
              'messageIds': ['801', '802'],
              'title': 'Fee reminder',
              'channels': ['sms', 'whatsapp'],
              'subject': null,
              'text': 'The second instalment is due on the 10th.',
              'html': '<p>The second instalment is due on the <b>10th</b>.</p>',
              'student': {'id': '41', 'name': 'Kid Sample'},
              'sentAt': '${day(-1)}T10:00:00Z',
              'status': {'sms': 'delivered', 'whatsapp': 'sent'},
              'readOnPhone': false,
              'unread': true,
              'attachments': [],
            },
          ],
          'children': [
            {'id': '41', 'name': 'Kid Sample'},
          ],
          'page': {'number': 1, 'size': 20, 'more': false},
        };
      case 'POST /comms/inbox/read':
        return {'read': 2};
      case 'GET /academics/timetable/periods':
        return {
          'data': [
            {
              'id': 'p1',
              'number': 1,
              'name': 'I',
              'startsAt': '08:00:00',
              'endsAt': '08:40:00',
              'isBreak': false,
            },
            {
              'id': 'p2',
              'number': 2,
              'name': 'Break',
              'startsAt': '08:40:00',
              'endsAt': '09:00:00',
              'isBreak': true,
            },
          ],
        };
      case 'GET /academics/timetable/slots':
        return {
          'data': [
            for (var w = 1; w <= 6; w++)
              {
                'weekday': w,
                'periodId': 'p1',
                'subjectName': w.isEven ? 'Hindi' : 'English',
                'teacherName': 'Asha Teacher',
                'room': '12',
              },
          ],
        };
      case 'GET /clinic/mine/list':
        final asked = (c.query ?? const {})['kind'];
        final visit = {
          'kind': 'visit',
          'visit': {
            'id': 'v1',
            'number': 'CV-7',
            'studentId': '41',
            'student': 'Kid Sample',
            'section': 'VI-A',
            'admissionNo': 'A1234',
            'inAt': '${day(-1)}T04:30:00Z',
            'outAt': '${day(-1)}T05:10:00Z',
            'complaint': 'Headache',
            'diseases': ['Fever'],
            'temperatureC': 38.5,
            'pulse': 96,
            'bp': null,
            'spo2': 98,
            'weightKg': null,
            'diagnosis': 'Mild fever',
            'treatment': 'Rest and water',
            'prescription': null,
            'remark': 'Please keep the child at home tomorrow.',
            'outcome': 'sent_home',
            'referredTo': null,
            'clinic': 'Main clinic',
            'doctor': 'Dr. Sample',
            'nurse': 'Nurse Sample',
            'medicines': [
              {
                'id': 'm1',
                'name': 'Paracetamol',
                'strength': '500mg',
                'unit': 'tab',
                'qty': 1,
                'dosage': 'once',
              },
            ],
          },
        };
        final card = {
          'kind': 'card',
          'card': {
            'id': 'c1',
            'camp': 'Annual check-up 2026',
            'studentId': '41',
            'student': 'Kid Sample',
            'section': 'VI-A',
            'admissionNo': 'A1234',
            'examDate': day(-10),
            'place': 'School hall',
            'doctor': 'Dr. Sample',
            'heightCm': 140,
            'weightKg': 35,
            'bmi': 17.9,
            'bloodGroup': 'B+',
            'remarks': 'Eyes to be checked.',
            'needsAttention': true,
          },
        };
        return {
          'data': [if (asked != 'card') visit, if (asked != 'visit') card],
          'page': {
            'number': int.tryParse('${(c.query ?? const {})['page']}') ?? 1,
            'size': 10,
            'total': asked == null ? 12 : 1,
          },
          'students': [
            {'id': '41', 'name': 'Kid Sample'},
          ],
        };
      case 'GET /clinic/mine/visits/v1':
        return {
          'id': 'v1',
          'number': 'CV-7',
          'school': 'Sample School',
          'student': 'Kid Sample',
          'section': 'VI-A',
          'admissionNo': 'A1234',
          'inAt': '${day(-1)}T04:30:00Z',
          'outAt': null,
          'complaint': 'Headache',
          'diseases': ['Fever'],
          'temperatureC': 38.5,
          'pulse': 96,
          'bp': null,
          'spo2': 98,
          'weightKg': null,
          'diagnosis': 'Mild fever',
          'treatment': 'Rest and water',
          'prescription': null,
          'remark': 'Please keep the child at home tomorrow.',
          'outcome': 'sent_home',
          'referredTo': null,
          'clinic': 'Main clinic',
          'doctor': 'Dr. Sample',
          'nurse': 'Nurse Sample',
          'medicines': [
            {
              'id': 'm1',
              'name': 'Paracetamol',
              'strength': '500mg',
              'unit': 'tab',
              'qty': 1,
              'dosage': 'once',
            },
          ],
        };
      case 'GET /clinic/mine/cards/c1/detail':
        return {
          'id': 'c1',
          'camp': 'Annual check-up 2026',
          'school': 'Sample School',
          'student': 'Kid Sample',
          'section': 'VI-A',
          'admissionNo': 'A1234',
          'dob': '2015-02-01',
          'examDate': day(-10),
          'place': 'School hall',
          'doctor': 'Dr. Sample',
          'remarks': 'Eyes to be checked.',
          'needsAttention': true,
          'note': null,
          'groups': [
            {
              'title': 'Eyes',
              'rows': [
                ['Vision', '6/9'],
              ],
            },
          ],
        };
      case 'GET /clinic/mine/cards/c1':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'card.pdf',
        );
      case 'GET /engagement/mine/certificates':
        return {
          'data': [
            {
              'id': '70',
              'studentId': '41',
              'student': 'Kid Sample',
              'serialNo': 'ACH-1',
              'title': 'Best in Science',
              'text': 'Science fair',
              'issuedOn': day(-30),
            },
          ],
        };
      case 'GET /certificate-requests/mine':
        return {
          'students': [
            {'id': '41', 'name': 'Kid Sample', 'self': kind == 'student'},
          ],
          'types': [
            {
              'code': 'BONAFIDE',
              'name': 'Bonafide certificate',
              'audience': 'STUDENT',
              'purposes': [],
              'maxCopies': 2,
              'fee': null,
              'forParents': true,
              'forStudents': true,
              'decidedBy': ['the office'],
            },
            {
              'code': 'CHAR',
              'name': 'Character certificate',
              'audience': 'STUDENT',
              'purposes': ['Admission', 'Passport'],
              'maxCopies': 1,
              'fee': 50,
              'forParents': true,
              'forStudents': false,
              'decidedBy': ['the class teacher', 'the principal'],
            },
          ],
          'requests': [
            {
              'id': '81',
              'typeName': 'Character certificate',
              'studentId': '41',
              'person': 'Kid Sample',
              'purpose': 'Passport',
              'copies': 2,
              'stage': 'fee',
              'fee': 50,
              'feePaid': false,
              'decisionNote': null,
              'createdAt': '${day(-4)}T05:00:00Z',
            },
            {
              'id': '82',
              'typeName': 'Bonafide certificate',
              'studentId': '41',
              'person': 'Kid Sample',
              'purpose': 'Bank account',
              'copies': 1,
              'stage': 'waiting',
              'fee': null,
              'feePaid': false,
              'decisionNote': null,
              'createdAt': '${day(-2)}T05:00:00Z',
            },
            {
              'id': '80',
              'typeName': 'Bonafide certificate',
              'studentId': '41',
              'person': 'Kid Sample',
              'purpose': 'Bank account',
              'copies': 1,
              'stage': 'issued',
              'fee': null,
              'feePaid': false,
              'decisionNote': null,
              'createdAt': '${day(-20)}T05:00:00Z',
            },
          ],
          'certificates': [
            {
              'id': '5',
              'typeName': 'Bonafide certificate',
              'number': 'BC/2026/0005',
              'copyNo': 0,
              'issuedOn': day(-15),
              'person': 'Kid Sample',
              'studentId': '41',
              'purpose': 'Bank account',
              'revision': 1,
              'award': false,
              'awardText': null,
              'achievementId': null,
            },
          ],
        };
      case 'POST /certificate-requests/mine/certificates/5/pdf':
        return {'exportId': 'x9', 'ready': true};
      case 'GET /certificate-requests/mine/exports/x9':
        return {
          'export': {'id': 'x9', 'status': 'done'},
          'download': {'url': '/files/cert.pdf'},
        };
      case 'GET /files/cert.pdf':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'c.pdf',
        );
      case 'POST /certificate-requests/mine':
        return {'id': '83'};
      case 'POST /certificate-requests/mine/82/withdraw':
        return {'ok': true};
      case 'GET /academics/documents':
        return {
          'kinds': [
            {'value': 'session_plan', 'label': 'Session plan'},
            {'value': 'curriculum', 'label': 'Curriculum / syllabus'},
            {'value': 'date_sheet', 'label': 'Date sheet'},
            {'value': 'other', 'label': 'Other'},
          ],
          'data': [
            {
              'id': 'd1',
              'kind': 'session_plan',
              'kindLabel': 'Session plan',
              'title': 'Session plan 2026-27',
              'remark': '<p>The plan for the <b>whole</b> year.</p>',
              'classSectionId': '300',
              'section': 'VI-A',
              'fileIds': ['81'],
              'publishAt': '${day(-3)}T04:30:00Z',
              'ackRequired': true,
              'ackedFor': [],
              'postedBy': 'Asha Teacher',
            },
            {
              'id': 'd2',
              'kind': 'date_sheet',
              'kindLabel': 'Date sheet',
              'title': 'Not this class',
              'remark': null,
              'classSectionId': '301',
              'section': 'VI-B',
              'fileIds': ['82'],
              'publishAt': '${day(-2)}T04:30:00Z',
              'ackRequired': false,
              'ackedFor': [],
              'postedBy': null,
            },
            {
              'id': 'd3',
              'kind': 'magazine',
              'kindLabel': 'School magazine',
              'title': 'Our magazine',
              'remark': null,
              'classSectionId': null,
              'section': null,
              'fileIds': ['83'],
              'publishAt': '${day(-1)}T04:30:00Z',
              'ackRequired': false,
              'ackedFor': [],
              'postedBy': null,
            },
          ],
        };
      case 'GET /academics/documents/d1/files/81':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'plan.pdf',
        );
      case 'GET /academics/calendar':
        return {
          'holidays': [
            {
              'id': 'h1',
              'name': 'Festival break',
              'kind': 'holiday',
              'startsOn': day(10),
              'endsOn': day(12),
            },
            {
              'id': 'h0',
              'name': 'Founders day',
              'kind': 'holiday',
              'startsOn': day(-30),
              'endsOn': day(-30),
            },
          ],
          'events': [
            {
              'id': 'ev1',
              'title': 'Annual sports',
              'kind': 'event',
              'startsOn': day(0),
              'endsOn': day(0),
              'startsAt': '09:00',
              'description': 'Wear the house T-shirt.',
            },
            {
              'id': 'ev0',
              'title': 'Unit test 1',
              'kind': 'exam',
              'startsOn': day(-5),
              'endsOn': day(-5),
              'startsAt': null,
              'description': null,
            },
          ],
          'from': '2026-04-01',
          'to': '2027-03-31',
        };
      case 'GET /academics/directory':
        return {
          'data': [
            {
              'heading': 'Office',
              'name': 'Office Head',
              'designation': 'Administrator',
              'phone': '0000-000001',
              'email': 'office@example.test',
              'timings': '08:00–14:00',
              'note': null,
            },
            {
              'heading': 'Transport',
              'name': 'Bus Desk',
              'designation': null,
              'phone': null,
              'email': null,
              'timings': null,
              'note': 'Ask about routes',
            },
          ],
        };
      case 'GET /exams/mine/date-sheets':
        return {
          'children': [
            {
              'student': {'id': '41', 'name': 'Kid Sample', 'section': 'VI-A'},
              'exams': [
                {
                  'id': 'e1',
                  'name': 'Periodic test 2',
                  'startsOn': day(5),
                  'endsOn': day(6),
                  'note': 'Bring your own geometry box.',
                  'papers': [
                    {
                      'subject': 'Maths',
                      'examOn': day(5),
                      'startsAt': '09:00:00',
                      'endsAt': '10:00:00',
                    },
                    {'subject': 'Science', 'examOn': day(6), 'startsAt': null, 'endsAt': null},
                  ],
                },
                {
                  'id': 'e0',
                  'name': 'Periodic test 1',
                  'startsOn': day(-40),
                  'endsOn': day(-40),
                  'note': null,
                  'papers': [
                    {'subject': 'English', 'examOn': day(-40), 'startsAt': null, 'endsAt': null},
                  ],
                },
              ],
            },
          ],
        };
      case 'GET /exams/mine/results':
        return {
          'children': [
            {
              'student': {'id': '41', 'name': 'Kid Sample', 'section': 'VI-A'},
              'terms': [
                {
                  'releaseId': 'r1',
                  'kind': 'term',
                  'termCode': 'T1',
                  'name': 'Term 1',
                  'releasedAt': '${day(-20)}T10:00:00Z',
                  'exams': [
                    {
                      'code': 'T1',
                      'name': 'Term 1 total',
                      'pct': '82.5',
                      'grade': 'A2',
                      'result': 'Pass',
                      'rank': 4,
                    },
                  ],
                  'withheld': false,
                  'held': false,
                  'feeDue': false,
                },
                {
                  'releaseId': 'r2',
                  'kind': 'exam',
                  'termCode': 'PT1',
                  'name': 'Periodic test 1',
                  'releasedAt': null,
                  'exams': [],
                  'withheld': false,
                  'held': true,
                  'feeDue': true,
                },
              ],
            },
          ],
        };
      case 'POST /exams/mine/report-cards/r1/41/pdf':
        return {'exportId': 'x1'};
      case 'GET /exams/mine/exports/x1':
        statusPolls++;
        return statusPolls < 2
            ? {
                'export': {'id': 'x1', 'status': 'running'},
                'download': null,
              }
            : {
                'export': {'id': 'x1', 'status': 'ready'},
                'download': {'url': 'https://files.example.test/rc.pdf?token=t'},
              };
      case 'GET https://files.example.test/rc.pdf?token=t':
        return const ApiFile(bytes: [1], contentType: 'application/octet-stream', name: 'rc.pdf');
      case 'GET /fees/mine':
        return {
          'children': [
            {
              'student': {'id': '41', 'name': 'Kid Sample', 'admissionNo': 'A1234'},
              'instalments': [
                {
                  'dueOn': day(-30),
                  'ledger': 'school',
                  'label': 'April–June',
                  'net': '15000.00',
                  'paid': '15000.00',
                  'balance': '0.00',
                  'lateFee': {'outstanding': '0.00'},
                  'visible': true,
                  'feePay': true,
                  'status': 'paid',
                },
                {
                  'dueOn': day(-2),
                  'ledger': 'school',
                  'label': 'July–September',
                  'net': '12500.00',
                  'paid': '0.00',
                  'balance': '12500.00',
                  'lateFee': {'outstanding': '150.00'},
                  'visible': true,
                  'feePay': true,
                  'status': 'overdue',
                },
              ],
              'totals': {'net': '27500.00', 'paid': '15000.00', 'balance': '12500.00'},
              'payments': [
                {
                  'id': '1001',
                  'receiptNo': 'R-77',
                  'receivedOn': day(-31),
                  'amount': '15000.00',
                  'mode': 'Online',
                  'ledger': 'school',
                  'status': 'posted',
                  'lateFee': '0.00',
                  'refunded': '0.00',
                  'settled': true,
                  'clearedOn': null,
                },
              ],
              'payableNow': '12650.00',
              'payableSchool': '12650.00',
              'payableHostel': '0.00',
              'hidden': 1,
              'year': {'code': '2026-27', 'status': 'active'},
              'fee': {
                'feeGroup': 'general',
                'payPlan': 'quarterly',
                'hosteller': false,
                'transport': null,
                'discounts': ['Sibling'],
                'optionalHeads': [],
              },
            },
          ],
        };
      // ---- Fees in the app (made-up): other fees, gateways, online payments, bill, tax certificate ----
      case 'GET /fees/misc-fees/mine':
        return {
          'children': [
            {
              'student': {'id': '41', 'name': 'Kid Sample'},
              'lines': [
                {
                  'id': 'm1',
                  'title': 'Science trip',
                  'mandatory': false,
                  'seats': 40,
                  'seatsTaken': 12,
                  'remark': null,
                  'amount': '800.00',
                  'paid': '0.00',
                  'balance': '800.00',
                  'lastDate': day(10),
                  'status': 'open',
                  'blocked': null,
                },
              ],
              'receipts': [
                {
                  'id': 'mr1',
                  'receiptNo': 'MF-12',
                  'receivedOn': day(-3),
                  'amount': '500.00',
                  'refunded': '0.00',
                  'mode': 'cash',
                  'status': 'posted',
                  'title': 'Art kit',
                  'announced': true,
                },
              ],
            },
          ],
        };
      case 'GET /fees/misc-fees/mine/receipts/mr1/file':
        return const ApiFile(bytes: [1], contentType: 'application/pdf', name: 'mf.pdf');
      case 'GET /payments/gateways/options' when kind == 'student':
      case 'GET /payments/intents/mine' when kind == 'student':
        // the payment right is the parent's
        throw const ApiException(403, 'permission-denied', 'Not allowed');
      case 'GET /payments/gateways/options':
        return {
          'data': [
            {'id': 'g1', 'label': 'Cards and UPI', 'chargePercent': '1.50', 'chargeFlat': '0.00'},
            {'id': 'g2', 'label': 'Net banking', 'chargePercent': '0', 'chargeFlat': '10.00'},
          ],
        };
      case 'GET /payments/intents/mine':
        return {
          'data': [
            {
              'id': 'i1',
              'txnId': 'TXN1',
              'amount': '12650.00',
              'status': 'failed',
              'provider': 'mock',
              'entityId': '41',
              'createdAt': '${day(-1)}T10:00:00Z',
            },
          ],
        };
      case 'POST /payments/intents/mine':
      case 'POST /payments/intents/mine/misc':
        return {
          'intent': {
            'id': 'i9',
            'txnId': 'TXN9',
            'amount': '${c.body!['amount'] ?? '800.00'}',
            'returnUrl': 'https://parent.example.test/api/payments/mobile-done?student=41',
          },
          'checkout': {
            'kind': 'form',
            'provider': 'mock',
            'mode': 'mock',
            'action': '/api/v1/payments/payu/mock',
            'method': 'POST',
            'fields': <String, String>{},
          },
        };
      case 'POST /payments/payu/mock':
        return c.body!['outcome'] == 'success'
            ? {'outcome': 'applied', 'status': 'succeeded'}
            : {'outcome': 'failed', 'status': 'failed'};
      case 'GET /fees/mine/bill':
        return {
          'billNo': 'SPS/2026-27/A1234',
          'billDate': day(0),
          'session': {'from': '2026-04-01', 'to': '2027-03-31'},
          'student': {
            'name': 'Kid Sample',
            'admissionNo': 'A1234',
            'section': 'VI-A',
            'guardian': 'Parent Sample',
            'route': null,
          },
          'heads': [
            {'ledger': 'school', 'head': 'Tuition fee', 'optional': false, 'amount': '50000.00'},
            {'ledger': 'school', 'head': 'Computer fee', 'optional': true, 'amount': '4000.00'},
          ],
          'discount': '1500.00',
          'schedules': [
            {
              'ledger': 'school',
              'payPlan': 'quarterly',
              'rows': [
                {
                  'no': '2',
                  'months': 'Jul–Sep',
                  'dueOn': day(-2),
                  'payable': '12500.00',
                  'paid': '0.00',
                  'balance': '12500.00',
                  'lateFee': '150.00',
                },
              ],
            },
          ],
          'receipts': [
            {
              'receiptNo': 'R-77',
              'mode': 'online',
              'receivedOn': day(-31),
              'amount': '15000.00',
              'finalAmount': '15000.00',
              'counted': true,
            },
          ],
          'summary': {
            'due': '27500.00',
            'lateFee': '150.00',
            'received': '15000.00',
            'refund': '0.00',
            'advance': '0.00',
            'balance': '12650.00',
            'balanceWords': 'Rupees Twelve Thousand Six Hundred Fifty Only',
          },
        };
      case 'GET /fees/mine/bill/file':
        return const ApiFile(bytes: [1], contentType: 'application/pdf', name: 'bill.pdf');
      case 'GET /fees/mine/tax-certificate':
        final fy = c.query?['financialYearId'] ?? 'fy2';
        return {
          'school': {'name': 'Sample School', 'address': 'Sample City'},
          'financialYear': {
            'id': fy,
            'name': fy == 'fy1' ? '2025-26' : '2026-27',
            'from': fy == 'fy1' ? '2025-04-01' : '2026-04-01',
            'to': fy == 'fy1' ? '2026-03-31' : '2027-03-31',
          },
          'student': {
            'id': '41',
            'name': 'Kid Sample',
            'admissionNo': 'A1234',
            'section': 'VI-A',
            'guardian': 'Parent Sample',
          },
          'rows': fy == 'fy1'
              ? []
              : [
                  {
                    'receivedOn': day(-31),
                    'receiptNo': 'R-77',
                    'mode': 'online',
                    'head': 'Tuition fee',
                    'amount': '15000.00',
                  },
                ],
          'total': fy == 'fy1' ? '0.00' : '15000.00',
          'totalWords': fy == 'fy1' ? 'Rupees Zero Only' : 'Rupees Fifteen Thousand Only',
          'otherPaid': '0.00',
          'issuedOn': day(0),
          'years': [
            {'id': 'fy2', 'name': '2026-27'},
            {'id': 'fy1', 'name': '2025-26'},
          ],
        };
      case 'GET /fees/mine/tax-certificate/file':
        return const ApiFile(bytes: [1], contentType: 'application/pdf', name: 'tax.pdf');
      // ---- Profile in the app (made-up) ----
      case 'GET /engagement/family':
        return {
          'children': [
            {'id': '41', 'name': 'Kid Sample'},
          ],
          'consents': [
            {
              'code': 'news',
              'name': 'School news',
              'description': 'Newsletters and events',
              'status': 'granted',
              'isRequired': false,
            },
            {
              'code': 'safety',
              'name': 'Fee and safety',
              'description': 'Always sent',
              'status': 'granted',
              'isRequired': true,
            },
          ],
        };
      case 'GET /engagement/mine/profile/41':
        Map<String, Object?> field(
          String key,
          String label,
          Object? value, {
          String type = 'text',
          String level = 'view',
          List<String>? options,
          String? proof,
        }) => {
          'key': key,
          'label': label,
          'type': type,
          'level': level,
          'value': value,
          'options': options,
          'help': null,
          'required': false,
          'upper': false,
          'when': null,
          'proof': proof,
          'pending': null,
        };
        return {
          'studentId': '41',
          'audience': kind == 'student' ? 'student' : 'parent',
          'admissionNo': 'A1234',
          'name': 'Kid Sample',
          'enrolment': {'className': 'VI', 'section': 'A', 'rollNo': 7, 'academicYear': '2026-27'},
          'classTeacher': 'Tara Teacher',
          'completeness': 80,
          'photos': {'student': true, 'father': false, 'mother': false},
          'photoVersions': {'student': 'v1'},
          'window': {'open': true, 'message': null, 'until': day(20)},
          'canEdit': true,
          'proofKinds': [
            {'id': 'aadhaar_card', 'label': 'Aadhaar card'},
          ],
          'sections': [
            {
              'id': 'personal',
              'title': 'Personal',
              'fields': [
                field(
                  'blood_group',
                  'Blood group',
                  'O+',
                  level: 'edit_direct',
                  options: ['A+', 'B+', 'O+', 'AB+'],
                ),
                field(
                  'aadhaar',
                  'Aadhaar number',
                  null,
                  type: 'digits12',
                  level: 'edit_approval',
                  proof: 'aadhaar_card',
                ),
                field('house', 'House', 'Blue'),
              ],
            },
            {
              'id': 'parents',
              'title': 'Parents',
              'fields': [
                field('father_name', 'Father', 'Parent Sample'),
                field('father_mobile', 'Father mobile', '9000000001'),
                field('mother_name', 'Mother', null),
              ],
            },
          ],
          'photoFields': [
            {
              'key': 'photo_student',
              'party': 'student',
              'label': 'Photo',
              'level': 'edit_approval',
              'pending': null,
            },
          ],
          'geography': {'states': [], 'cities': []},
        };
      case 'GET /engagement/mine/profile/41/requests':
        return {
          'data': [
            {
              'id': 'r1',
              'status': 'pending',
              'autoApplied': false,
              'requestedBy': 'Parent Sample',
              'level': 1,
              'levels': 1,
              'waitingFor': 'Class teacher',
              'items': [
                {'key': 'house', 'label': 'House', 'to': 'Red', 'status': 'pending', 'note': null},
              ],
              'decisionNote': null,
              'createdAt': day(-1),
              'mine': true,
            },
          ],
        };
      case 'POST /engagement/mine/profile/41/changes':
        final keys = asJson(c.body!['changes']).keys.toList();
        return {
          'applied': [
            for (final k in keys)
              if (k == 'blood_group') k,
          ],
          'pending': [
            for (final k in keys)
              if (k != 'blood_group') k,
          ],
        };
      case 'POST /engagement/mine/change-requests/r1/cancel':
        return {'cancelled': true};
      case 'GET /engagement/mine/profile/41/photo/student':
        return {
          'file': {'contentType': 'image/png'},
          'download': {'url': '/files/photo-student'},
        };
      case 'GET /files/photo-student':
        // a 1 × 1 PNG
        return ApiFile(
          bytes: base64Decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          ),
          contentType: 'image/png',
          name: 'photo.png',
        );
      case 'GET /engagement/mine/profile/41/print/file':
        return const ApiFile(bytes: [1], contentType: 'application/pdf', name: 'profile.pdf');
      case 'POST /comms/consents/mine':
        return {'recorded': true};
      case 'GET /privacy/requests/mine':
        return {
          'data': [
            {
              'id': 'd1',
              'kind': 'access',
              'principal': 'Kid Sample',
              'status': 'completed',
              'receivedOn': day(-10),
              'dueOn': day(20),
              'outcome': null,
              'exportId': 'e1',
              'exportStatus': 'done',
            },
          ],
        };
      case 'POST /privacy/requests/mine':
        return {'id': 'd2'};
      case 'GET /privacy/requests/mine/d1/export':
        return {
          'export': {'id': 'e1', 'status': 'done'},
          'download': {'url': '/files/data-report.pdf'},
        };
      case 'GET /fees/mine/receipts/1001/file':
        return const ApiFile(bytes: [1], contentType: 'application/octet-stream', name: 'r.pdf');
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

const _layoutLabels = {
  '/': 'Home',
  'more': 'More',
  'academics': 'Academics',
  '/attendance': 'Attendance',
  '/homework': 'Homework',
  '/timetable': 'Timetable',
  '/results': 'Results',
  '/library': 'Library',
  '/health': 'Health',
  '/certificates': 'Certificates',
  '/help': 'Help',
  '/notices': 'Notices',
  '/calendar': 'Calendar',
};
const _cardLabels = {
  'attendance_today': 'Attendance today',
  'notices': 'Latest notices',
  'coming_up': 'Coming up (holidays and events)',
  'library': 'Library books',
  'fees_due': 'Fees due',
};
Map<String, Object?> entry(String h) => {'href': h, 'label': _layoutLabels[h] ?? h, 'icon': 'book'};

/// A layout as `GET me/app-layout` gives it (made-up school choices).
Map<String, Object?> layoutJson({
  required List<String> tabs,
  required List<String> shortcuts,
  required List<String> cards,
  required List<String> academics,
  List<String> screens = const [
    '/attendance',
    '/homework',
    '/timetable',
    '/results',
    '/library',
    '/health',
    '/certificates',
    '/help',
    '/notices',
    '/calendar',
  ],
}) => {
  'audience': 'student',
  'tabs': [entry('/'), for (final t in tabs) entry(t), entry('more')],
  'shortcuts': [for (final x in shortcuts) entry(x)],
  'ownShortcuts': false,
  'cards': [
    for (final k in cards)
      {'key': k, 'label': _cardLabels[k] ?? k, 'labelHi': _cardLabels[k] ?? k, 'href': '/'},
  ],
  'academics': [for (final a in academics) entry(a)],
  'screens': [for (final x in screens) entry(x)],
  'published': true,
};

Map<String, Object?> withOwn(Map<String, Object?> l, List<String>? own) => own == null
    ? l
    : {
        ...l,
        'shortcuts': [for (final x in own) entry(x)],
        'ownShortcuts': true,
      };

Future<(FakeTransport, School)> pumpFamily(
  WidgetTester tester, {
  String kind = 'parent',
  bool hindi = false,
  School? school,
}) async {
  SharedPreferences.setMockInitialValues({
    'profile': kind == 'parent' ? 'parent:7:41' : 'student:7:41',
    'hindi': hindi,
  });
  school ??= School();
  school.kind = kind;
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
        // the phone's file picker: a made-up doctor's note
        leaveFilePickerProvider.overrideWithValue(
          () async => const [
            PickedFile(name: 'note.pdf', bytes: [37, 80, 68, 70], contentType: 'application/pdf'),
          ],
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
        scrollable: find.byType(Scrollable).last,
        maxScrolls: 20,
      );
    } on StateError {
      await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).last);
    }
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

void main() {
  group('the school\'s layout (docs/design/90)', () {
    Map<String, Object?> studentLayout() => layoutJson(
      tabs: ['academics', '/library', '/results'],
      shortcuts: ['/library', '/health', '/certificates', '/help'],
      cards: ['notices', 'coming_up', 'library'],
      academics: ['/timetable', '/homework'],
    );
    Finder tab(String label) =>
        find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

    testWidgets('its tabs, its shortcuts (with All), its cards in order, its Academics list', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(420, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final school = School()..layout = studentLayout();
      final (t, _) = await pumpFamily(tester, kind: 'student', school: school);
      expect(t.calls.firstWhere((c) => c.path == '/me/app-layout').query, {'kind': 'student'});
      for (final label in ['Home', 'Academics', 'Library', 'Results', 'More']) {
        expect(tab(label), findsOneWidget, reason: label);
      }
      expect(tab('Homework'), findsNothing);
      for (final k in ['library', 'health', 'certificates', 'help', 'all']) {
        expect(find.byKey(Key('shortcut-$k')), findsOneWidget, reason: k);
      }
      expect(find.byKey(const Key('shortcut-attendance')), findsNothing);
      // the cards the school chose, in its order; the others not
      final notices = tester.getTopLeft(find.text('Latest notices')).dy;
      await scrollTo(tester, find.text('Library books'));
      expect(find.text('Coming up'), findsOneWidget);
      expect(find.text('No books out now.'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Coming up')).dy, greaterThan(notices - 2000));
      expect(find.text('Attendance today'), findsNothing);

      // All opens every screen (More)
      await scrollTo(tester, find.byKey(const Key('shortcut-all')));
      await tester.tap(find.byKey(const Key('shortcut-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('moreList')), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();

      // the Academics tab lists the school's Academics screens
      await tester.tap(tab('Academics'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('academics-timetable')), findsOneWidget);
      expect(find.byKey(const Key('academics-homework')), findsOneWidget);
      expect(find.byKey(const Key('academics-results')), findsNothing);
    });

    testWidgets('Edit shortcuts: pin, remove, reorder, save; then back to the school\'s', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(420, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final school = School()..layout = studentLayout();
      final (t, _) = await pumpFamily(tester, kind: 'student', school: school);
      expect(find.text('Shortcuts'), findsOneWidget);
      await tester.tap(find.byKey(const Key('editShortcuts')));
      await tester.pumpAndSettle();
      expect(find.text('Your shortcuts (4 of 12)'), findsOneWidget);
      expect(find.byKey(const Key('resetShortcuts')), findsNothing);
      // fewer than four cannot be kept
      await tester.tap(find.byKey(const Key('remove-help')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('saveShortcuts')));
      await tester.pumpAndSettle();
      expect(find.text('Choose at least 4 shortcuts.'), findsOneWidget);
      expect(t.calls.where((c) => c.method == 'PUT'), isEmpty);
      // pin Attendance and Notices, Attendance first
      await scrollTo(tester, find.byKey(const Key('add-attendance')));
      await tester.tap(find.byKey(const Key('add-attendance')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('findScreen')), 'noti');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('add-homework')), findsNothing);
      await tester.tap(find.byKey(const Key('add-notices')));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const Key('mine-attendance')));
      for (var i = 0; i < 3; i++) {
        await tester.tap(find.byTooltip('Move Attendance up'));
        await tester.pumpAndSettle();
      }
      await scrollTo(tester, find.byKey(const Key('saveShortcuts')));
      await tester.tap(find.byKey(const Key('saveShortcuts')));
      await tester.pumpAndSettle();
      final put = t.calls.lastWhere((c) => c.method == 'PUT');
      expect(put.path, '/me/app-layout/shortcuts');
      expect(put.query, {'kind': 'student'});
      expect(put.body, {
        'shortcuts': ['/attendance', '/library', '/health', '/certificates', '/notices'],
      });
      // Home has them, as the person's own
      expect(find.text('Your own shortcuts'), findsOneWidget);
      expect(find.byKey(const Key('shortcut-attendance')), findsOneWidget);
      expect(find.byKey(const Key('shortcut-help')), findsNothing);
      // back to the school's
      await tester.tap(find.byKey(const Key('editShortcuts')));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byKey(const Key('resetShortcuts')));
      await tester.tap(find.byKey(const Key('resetShortcuts')));
      await tester.pumpAndSettle();
      final reset = t.calls.lastWhere((c) => c.method == 'DELETE');
      expect(reset.path, '/me/app-layout/shortcuts');
      expect(reset.query, {'kind': 'student'});
      expect(find.text('Shortcuts'), findsOneWidget);
      expect(find.byKey(const Key('shortcut-help')), findsOneWidget);
    });

    for (final dark in [false, true]) {
      testWidgets(
        'accessibility (${dark ? 'dark' : 'light'}): Home by the layout, Edit shortcuts',
        (tester) async {
          await tester.binding.setSurfaceSize(const Size(420, 2400));
          addTearDown(() => tester.binding.setSurfaceSize(null));
          final handle = tester.ensureSemantics();
          tester.platformDispatcher.platformBrightnessTestValue = dark
              ? Brightness.dark
              : Brightness.light;
          addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
          final school = School()..layout = studentLayout();
          await pumpFamily(tester, kind: 'student', school: school);
          Future<void> check(String where) async {
            for (final g in [
              androidTapTargetGuideline,
              iOSTapTargetGuideline,
              labeledTapTargetGuideline,
              textContrastGuideline,
            ]) {
              await expectLater(tester, meetsGuideline(g), reason: '$where: ${g.description}');
            }
          }

          await check('Home');
          await tester.tap(find.byKey(const Key('editShortcuts')));
          await tester.pumpAndSettle();
          await check('Edit shortcuts');
          handle.dispose();
        },
      );
    }

    testWidgets('large text (2×): Home by the layout and Edit shortcuts lay out', (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 3600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final school = School()..layout = studentLayout();
      await pumpFamily(tester, kind: 'student', school: school);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('editShortcuts')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('a layout published while the app is away reaches it when it comes back', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(420, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final school = School();
      await pumpFamily(tester, kind: 'student', school: school);
      expect(tab('Library'), findsNothing);
      // the school publishes; the app goes to the background and comes back
      school.layout = studentLayout();
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pumpAndSettle();
      expect(tab('Library'), findsOneWidget);
      expect(find.byKey(const Key('shortcut-health')), findsOneWidget);
    });

    for (final hindi in [false, true]) {
      testWidgets(
        'More follows the school\'s side menu: its order and its names${hindi ? ' (Hindi)' : ''}',
        (tester) async {
          await tester.binding.setSurfaceSize(const Size(420, 1600));
          addTearDown(() => tester.binding.setSurfaceSize(null));
          Map<String, Object?> item(String h, String l) => {
            'href': h,
            'label': l,
            'help': null,
            'icon': 'book',
          };
          final school = School()
            ..menuGroups = [
              {
                'id': 'home',
                'label': 'Home',
                'labelHi': null,
                'icon': 'home',
                'items': [item('/', 'Home')],
              },
              {
                'id': 'school',
                'label': 'Campus life',
                'labelHi': 'परिसर',
                'icon': 'book',
                'items': [item('/library', 'Library'), item('/notices', 'Notices')],
              },
              {
                'id': 'child',
                'label': 'My child',
                'labelHi': null,
                'icon': 'users',
                'items': [item('/profile', 'Profile')],
              },
            ];
          {
            await pumpFamily(tester, kind: 'student', school: school, hindi: hindi);
            await tester.tap(tab(hindi ? 'अधिक' : 'More'));
            await tester.pumpAndSettle();
            final campus = find.text(hindi ? 'परिसर' : 'Campus life');
            final child = find.text(hindi ? 'मेरा बच्चा' : 'My child');
            expect(campus, findsOneWidget);
            expect(child, findsOneWidget);
            // the school's order: Campus life above My child
            expect(tester.getTopLeft(campus).dy, lessThan(tester.getTopLeft(child).dy));
          }
        },
      );
    }

    testWidgets('in Hindi: the cards and the words of Edit shortcuts', (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final school = School()..layout = studentLayout();
      await pumpFamily(tester, kind: 'student', school: school, hindi: true);
      expect(find.text('सभी'), findsOneWidget);
      await scrollTo(tester, find.text('पुस्तकालय की पुस्तकें'));
      expect(find.text('आगे'), findsOneWidget);
      await scrollTo(tester, find.byKey(const Key('editShortcuts')));
      await tester.tap(find.byKey(const Key('editShortcuts')));
      await tester.pumpAndSettle();
      expect(find.text('आपके शॉर्टकट (12 में से 4)'), findsOneWidget);
    });
  });

  testWidgets(
    'Home\'s shortcuts: eight tiles four a row; Messages when the school takes no queries',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await pumpFamily(tester);
      final keys = [
        'attendance',
        'homework',
        'timetable',
        'results',
        'calendar',
        'dateSheet',
        'notices',
        'messages',
      ];
      for (final k in keys) {
        expect(find.byKey(Key('shortcut-$k')), findsOneWidget, reason: k);
      }
      expect(find.byKey(const Key('shortcut-queries')), findsNothing);
      // four a row: the fifth starts the second row under the first
      final first = tester.getTopLeft(find.byKey(const Key('shortcut-attendance')));
      final fifth = tester.getTopLeft(find.byKey(const Key('shortcut-calendar')));
      expect(fifth.dx, first.dx);
      expect(fifth.dy, greaterThan(first.dy));
      expect(tester.getTopLeft(find.byKey(const Key('shortcut-results'))).dy, first.dy);
      await tester.tap(find.byKey(const Key('shortcut-homework')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('entry-501')), findsWidgets);
    },
  );

  testWidgets('Home\'s shortcuts: Queries in place of Messages when the school takes queries', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final school = School()..queries = true;
    await pumpFamily(tester, school: school);
    expect(find.byKey(const Key('shortcut-queries')), findsOneWidget);
    expect(find.byKey(const Key('shortcut-messages')), findsNothing);
    // Queries opens in the app, not as a web page
    await tester.tap(find.byKey(const Key('shortcut-queries')));
    await tester.pumpAndSettle();
    expect(find.byType(QueriesScreen), findsOneWidget);
  });

  testWidgets(
    'Fees in the app: due now, ticked the oldest first, the gateway charge, paid through the gateway — no web page',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 2200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester);
      await tester.tap(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('Fees')),
      );
      await tester.pumpAndSettle();
      // due now: the school fee and the other fee (late fee included)
      expect(
        find.descendant(of: find.byKey(const Key('figDueNow')), matching: find.text('₹13,450')),
        findsOneWidget,
      );
      expect(find.text('Pay plan: Quarterly'), findsOneWidget);
      expect(find.text('Discount: Sibling'), findsOneWidget);
      expect(find.text('Later instalments appear when the school opens them.'), findsOneWidget);
      // the overdue instalment is ticked; Cards and UPI adds 1.5%
      String? total() => tester.widget<Text>(find.byKey(const Key('payTotal-school'))).data;
      expect(total(), '₹12,839.75');
      await tester.tap(find.byKey(const Key('gateway-school-g2')));
      await tester.pumpAndSettle();
      expect(total(), '₹12,660');
      // untick: nothing to pay
      await tester.tap(find.byKey(Key('tick-school-${day(-2)}')));
      await tester.pumpAndSettle();
      expect(find.text('Tick an instalment to pay'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('pay-school'))).onPressed, isNull);
      await tester.tap(find.byKey(Key('tick-school-${day(-2)}')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pay-school')));
      await tester.pumpAndSettle();
      // the app starts the payment itself, for the phone
      expect(
        t.calls.lastWhere((c) => c.method == 'POST' && c.path == '/payments/intents/mine').body,
        {
          'studentId': '41',
          'amount': 12650,
          'ledger': 'school',
          'gatewayId': 'g2',
          'app': 'mobile',
        },
      );
      // the development gateway answers in the app (a real one opens its own page only)
      expect(find.text('Development gateway'), findsOneWidget);
      await tester.tap(find.byKey(const Key('mockSuccess')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/payments/payu/mock').body, {
        'txnid': 'TXN9',
        'outcome': 'success',
      });
      expect(find.text('Payment received. The receipt is below.'), findsOneWidget);
      // the receipts by fee type: the school fee and the other fees (no hostel: not a hosteller)
      String? title(String k) => tester
          .widget<Text>(
            find.descendant(of: find.byKey(Key('receipts-$k')), matching: find.byType(Text)).first,
          )
          .data;
      expect(title('school'), 'School fee · 1 receipt · ₹15,000 received');
      expect(title('other'), 'Other fees · 1 receipt · ₹500 received');
      expect(find.byKey(const Key('receipts-hostel')), findsNothing);
      expect(find.textContaining('Art kit'), findsOneWidget);
      await tester.tap(find.byKey(const Key('view-miscReceipt-mr1')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/fees/misc-fees/mine/receipts/mr1/file'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // each receipt with View / Download, and the online payments
      expect(find.byKey(const Key('view-receipt-1001')), findsOneWidget);
      expect(find.byKey(const Key('download-receipt-1001')), findsOneWidget);
      expect(find.byKey(const Key('intent-i1')), findsOneWidget);
      expect(find.text('Failed'), findsOneWidget);
      // no web page was opened for any of it
      expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
    },
  );

  testWidgets('Fees in the app: other fees paid online, the fee bill and the tax certificate', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Fees')));
    await tester.pumpAndSettle();
    // other fees: a trip, paid in full; two gateways, so the parent chooses
    await tester.tap(find.byKey(const Key('section-other')));
    await tester.pumpAndSettle();
    expect(find.text('Science trip'), findsOneWidget);
    expect(find.textContaining('Seats 12/40'), findsOneWidget);
    await tester.tap(find.byKey(const Key('payMisc-m1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('miscGateway-g1')));
    await tester.pumpAndSettle();
    expect(
      t.calls.lastWhere((c) => c.method == 'POST' && c.path == '/payments/intents/mine/misc').body,
      {'lineId': 'm1', 'gatewayId': 'g1', 'app': 'mobile'},
    );
    await tester.tap(find.byKey(const Key('mockFail')));
    await tester.pumpAndSettle();
    expect(
      find.text('The payment did not go through. No money was taken, or it comes back.'),
      findsOneWidget,
    );

    // the fee bill on screen, and its PDF
    await tester.tap(find.byKey(const Key('section-bill')));
    await tester.pumpAndSettle();
    expect(find.text('SPS/2026-27/A1234'), findsOneWidget);
    expect(find.text('Computer fee (optional)'), findsOneWidget);
    expect(find.text('Rupees Twelve Thousand Six Hundred Fifty Only'), findsOneWidget);
    await tester.tap(find.byKey(const Key('view-feeBill')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/fees/mine/bill/file').query, {
      'studentId': '41',
      'ledger': 'school',
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    // the tax certificate: this year's, its PDF, then last year's
    await tester.tap(find.byKey(const Key('taxCertificate')));
    await tester.pumpAndSettle();
    expect(find.text('Rupees Fifteen Thousand Only'), findsOneWidget);
    await tester.tap(find.byKey(const Key('view-taxCertificate')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/fees/mine/tax-certificate/file').query, {
      'studentId': '41',
      'financialYearId': 'fy2',
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('taxYear')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2025-26').last);
    await tester.pumpAndSettle();
    expect(
      find.text('No fee that counts for the certificate was received in this year.'),
      findsOneWidget,
    );
    expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
  });

  testWidgets(
    'a parent\'s Home: the figures, today\'s attendance, homework due, next exam, notices',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester);
      expect(find.text('Kid Sample'), findsOneWidget);
      for (final tab in ['Home', 'Academics', 'Fees', 'Messages', 'More']) {
        expect(
          find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)),
          findsOneWidget,
        );
      }
      // the figures: this child's month (not the other child's), homework due, fees to pay, unread
      expect(
        find.descendant(of: find.byKey(const Key('figAttendance')), matching: find.text('18/20')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('figHomework')), matching: find.text('1')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('figFees')), matching: find.text('₹12,650')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('figUnread')), matching: find.text('3')),
        findsOneWidget,
      );
      expect(find.text('Present'), findsOneWidget);
      expect(find.text('18 of 20 days present'), findsOneWidget);
      expect(find.text('Plant a seed'), findsOneWidget);
      expect(find.text('Maths'), findsOneWidget);
      expect(find.text('Sports day'), findsOneWidget);
      // the family's calls go out with the child
      expect(t.calls.firstWhere((c) => c.path == '/academics/notices').query!['studentId'], '41');
    },
  );

  Future<void> openAttendance(WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Attendance'));
    await tester.pumpAndSettle();
  }

  testWidgets('attendance Month, as on the website: figures, ring, calendar, gate times, the bus', (
    tester,
  ) async {
    final (t, _) = await pumpFamily(tester);
    await openAttendance(tester);
    // the figures: school days, present, absent, on leave, late or part of the day, the percentage
    Finder fig(String text) =>
        find.descendant(of: find.byKey(const Key('attFigures')), matching: find.text(text));
    for (final x in ['School days', '20', 'Present', '18', 'Absent', 'On leave', '0', '90%']) {
      expect(fig(x), findsWidgets, reason: x);
    }
    expect(fig('Late or part of the day'), findsOneWidget);
    expect(find.bySemanticsLabel('Present 18, Absent 1, On leave 1'), findsOneWidget);
    expect(find.bySemanticsLabel('${S(false).date(now)}: Present'), findsOneWidget);
    expect(find.text('Late or part of the day'), findsWidgets);
    // the days with the gate times stay folded until tapped
    expect(find.byKey(Key('day-${day(0)}')), findsNothing);
    await tester.tap(find.byKey(const Key('dayByDay')));
    await tester.pumpAndSettle();
    expect(find.byKey(Key('day-${day(0)}')), findsOneWidget);
    String hm(DateTime x) =>
        '${x.hour.toString().padLeft(2, '0')}:${x.minute.toString().padLeft(2, '0')}';
    final inAt = DateTime.parse('${day(0)}T02:35:00.000Z').toLocal();
    final outAt = DateTime.parse('${day(0)}T08:40:00.000Z').toLocal();
    expect(find.text('In ${hm(inAt)} · Out ${hm(outAt)}'), findsOneWidget);
    // the school bus of the month
    expect(find.text('School bus · 1/1 trips on the bus'), findsOneWidget);
    expect(find.text('Morning: On the bus'), findsOneWidget);
    expect(find.text('Afternoon: —'), findsOneWidget);
    expect(t.calls.any((c) => c.path == '/attendance/bus-roll/mine'), isTrue);
    // the month before
    await tester.tap(find.byKey(const Key('monthBack')));
    await tester.pumpAndSettle();
    final before = DateTime(now.year, now.month - 1);
    expect(
      t.calls.lastWhere((c) => c.path == '/attendance/mine').query!['month'],
      '${before.year}-${before.month.toString().padLeft(2, '0')}',
    );
    expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
  });

  testWidgets('attendance Year: the session month by month; a month opens in full', (tester) async {
    final (t, _) = await pumpFamily(tester);
    await openAttendance(tester);
    await tester.tap(find.byKey(const Key('attView-year')));
    await tester.pumpAndSettle();
    Finder fig(String text) =>
        find.descendant(of: find.byKey(const Key('attFigures')), matching: find.text(text));
    for (final x in ['40', '33', '5', '2', '83%']) {
      expect(fig(x), findsWidgets, reason: x);
    }
    expect(
      find.bySemanticsLabel('Attendance month by month; the list below has the same numbers'),
      findsOneWidget,
    );
    expect(find.text('20 days · Present 19 · Absent 1 · Leave 0 · Late 2'), findsOneWidget);
    expect(find.text('95%'), findsOneWidget);
    expect(find.text('70%'), findsOneWidget);
    await tester.tap(find.byKey(const Key('month-2026-08')));
    await tester.pumpAndSettle();
    expect(find.text('August 2026'), findsOneWidget);
    expect(t.calls.lastWhere((c) => c.path == '/attendance/mine').query!['month'], '2026-08');
  });

  testWidgets(
    'attendance Leave: the list as on the website; a leave sent, one cancelled, one ended',
    (tester) async {
      final (t, school) = await pumpFamily(tester);
      await openAttendance(tester);
      await tester.tap(find.byKey(const Key('attView-leave')));
      await tester.pumpAndSettle();
      // only this child's leave is listed; who has it now; the certificate; the school's note
      expect(find.text('Not this child'), findsNothing);
      expect(find.text('With: Class teacher'), findsOneWidget);
      expect(find.text('LV-2 · 4 days · long leave'), findsOneWidget);
      expect(find.text('Note from the school: Get well soon'), findsOneWidget);
      await tester.tap(find.byKey(const Key('view-0')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/attendance/leaves/mine/902/files/77'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // apply: the kind, the reason, send (no certificate needed for a day's sick leave)
      await tester.tap(find.byKey(const Key('applyLeave')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('sendLeave')));
      await tester.pumpAndSettle();
      expect(find.text('Choose the kind of leave.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('leaveType')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sick leave').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('leaveReason')), 'Fever since last night');
      await tester.tap(find.byKey(const Key('sendLeave')));
      await tester.pumpAndSettle();
      final sent = t.calls.lastWhere(
        (c) => c.method == 'POST' && c.path == '/attendance/leaves/mine',
      );
      expect(sent.body, {
        'studentId': '41',
        'leaveType': 'SICK',
        'fromDate': day(0),
        'toDate': day(0),
        'reason': 'Fever since last night',
      });
      expect(find.text('Leave application sent.'), findsOneWidget);
      // the leave under way ends today; the one waiting is cancelled
      expect(find.text('Child is back: end the leave today'), findsOneWidget);
      await tester.tap(find.byKey(const Key('cancelLeave-901')));
      await tester.pumpAndSettle();
      expect(find.text('Cancel this leave application?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('confirmCancelLeave')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/attendance/leaves/mine/901/cancel'), isTrue);
      expect(school.leaves.firstWhere((l) => l['id'] == '901')['status'], 'cancelled');

      expect(t.calls.any((c) => c.path.contains('handoff') || c.path == '/web'), isFalse);
    },
  );

  testWidgets('a leave that needs a certificate takes it from the phone: no web page', (
    tester,
  ) async {
    final (t, _) = await pumpFamily(tester);
    await openAttendance(tester);
    await scrollTo(tester, find.byKey(const Key('applyLeave')));
    await tester.tap(find.byKey(const Key('applyLeave')));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Sick leave: certificate needed for more than 3 day(s) · Medical leave: certificate always needed',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('leaveType')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Medical leave').last);
    await tester.pumpAndSettle();
    expect(find.text('This leave needs a certificate or letter: add it below.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('leaveReason')), 'Doctor advised rest');
    await tester.tap(find.byKey(const Key('sendLeave')));
    await tester.pumpAndSettle();
    expect(find.text('Add the certificate or letter.'), findsOneWidget);
    expect(t.calls.any((c) => c.method == 'POST' && c.path == '/attendance/leaves/mine'), isFalse);
    // the doctor's note from the phone, sent with the leave
    await tester.tap(find.byKey(const Key('leaveAddFile')));
    await tester.pumpAndSettle();
    expect(find.text('note.pdf'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sendLeave')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.method == 'PUT' && c.path == '/upload/88'), isTrue);
    final sent = t.calls.lastWhere(
      (c) => c.method == 'POST' && c.path == '/attendance/leaves/mine',
    );
    expect(sent.body!['leaveType'], 'MED');
    expect(sent.body!['fileIds'], ['88']);
    expect(find.byKey(const Key('leaveOnWeb')), findsNothing);
  });

  Future<void> openTeachers(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'My teachers'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'My teachers in the app, as on the website: class teacher first, photo, subjects, contact in part',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester, kind: 'student');
      await openTeachers(tester);
      expect(t.calls.any((c) => c.path == '/academics/my-teachers'), isTrue);
      expect(find.text('Kid Sample · VI-A'), findsOneWidget);
      expect(find.text('The class teacher and the teacher of each subject.'), findsOneWidget);
      // the class teacher first, with the photo from the API; the subject teacher with initials
      expect(
        tester.getTopLeft(find.byKey(const Key('teacher-51'))).dy,
        lessThan(tester.getTopLeft(find.byKey(const Key('teacher-52'))).dy),
      );
      expect(find.text('Class teacher'), findsOneWidget);
      expect(find.text('Subject teacher'), findsOneWidget);
      expect(t.calls.any((c) => c.path == '/academics/my-teachers/51/photo'), isTrue);
      expect(find.byKey(const Key('teacherPhoto-51')), findsOneWidget);
      expect(find.text('ST'), findsOneWidget);
      expect(find.text('Subject: Maths, Science'), findsOneWidget);
      expect(find.text('TGT'), findsOneWidget);
      // in part: shown as it is, nothing to tap, and where to reach the teacher
      expect(find.text('Mobile: 90XXXXXX51'), findsOneWidget);
      expect(find.byKey(const Key('call-51')), findsNothing);
      expect(find.byKey(const Key('contactMasked')), findsOneWidget);
      expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
    },
  );

  testWidgets('My teachers: a number and e-mail the school shows in full can be tapped', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final school = School()..teachersFull = true;
    await pumpFamily(tester, school: school);
    await openTeachers(tester);
    expect(find.byKey(const Key('call-51')), findsOneWidget);
    expect(find.byKey(const Key('mail-51')), findsOneWidget);
    expect(find.bySemanticsLabel('Call Tara Teacher'), findsOneWidget);
    expect(find.byKey(const Key('contactMasked')), findsNothing);
  });

  testWidgets('Messages and Notices as on the website: channels, delivery, filters, tags', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await tester.tap(
      find.descendant(of: find.byType(NavigationBar), matching: find.text('Messages')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Messages from school'), findsOneWidget);
    expect(find.textContaining('Kid Sample · SMS + WhatsApp'), findsOneWidget);
    await tester.tap(find.byKey(const Key('message-m1')));
    await tester.pumpAndSettle();
    expect(find.text('SMS: Delivered · WhatsApp: Sent'), findsOneWidget);
    expect(find.byKey(const Key('openEmail')), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    // notices: how many and still to acknowledge, the tags, a type and words
    await tester.tap(find.text('Notices'));
    await tester.pumpAndSettle();
    expect(find.text('Notices and circulars'), findsOneWidget);
    expect(find.text('1 in all · latest first · 1 to acknowledge'), findsOneWidget);
    expect(find.text('Circular'), findsOneWidget);
    expect(find.text('Acknowledge'), findsOneWidget);
    expect(find.text('Sports day is on Friday.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('noticeKind-circular')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/academics/notices').query!['kind'], 'circular');
    await tester.enterText(find.byKey(const Key('noticeWords')), 'sports');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/academics/notices').query!['q'], 'sports');
    expect(find.text('1 found · latest first · 1 to acknowledge'), findsOneWidget);
  });

  testWidgets('Calendar as on the website: the month grid, a day, the holiday list and events', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Calendar').last);
    await tester.pumpAndSettle();
    final s = S(false);
    // the whole session, read once
    expect(t.calls.lastWhere((c) => c.path == '/academics/calendar').query ?? const {}, isEmpty);
    expect(find.textContaining('Next holiday: Festival break'), findsOneWidget);
    // today is picked: what falls on it
    expect(find.byKey(const Key('calPicked')), findsOneWidget);
    expect(find.text('Annual sports'), findsWidgets);
    expect(find.text('Wear the house T-shirt.'), findsWidgets);
    expect(find.bySemanticsLabel('${s.dayShort(day(0))}: Annual sports'), findsOneWidget);
    // the holiday list: how many and how long, upcoming and earlier
    await tester.tap(find.byKey(const Key('calView-holidays')));
    await tester.pumpAndSettle();
    expect(find.text('2 holidays this session · 4 days in all'), findsOneWidget);
    expect(find.text('Festival break'), findsOneWidget);
    expect(find.text('Founders day'), findsOneWidget);
    // events: upcoming and earlier
    await tester.tap(find.byKey(const Key('calView-events')));
    await tester.pumpAndSettle();
    expect(find.text('Annual sports'), findsOneWidget);
    expect(find.text('Unit test 1'), findsOneWidget);
    expect(find.text('Exam'), findsOneWidget);
  });

  testWidgets('School directory in the app: headings, people, a number to call', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester, kind: 'student');
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.widgetWithText(ListTile, 'School directory'));
    await tester.tap(find.widgetWithText(ListTile, 'School directory'));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/academics/directory'), isTrue);
    expect(find.text('Whom to contact at the school, and when.'), findsOneWidget);
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('Transport'), findsOneWidget);
    expect(find.text('Office Head'), findsOneWidget);
    expect(find.text('Administrator'), findsOneWidget);
    expect(find.bySemanticsLabel('Call Office Head'), findsOneWidget);
    expect(find.text('Timings: 08:00–14:00'), findsOneWidget);
    expect(find.text('Ask about routes'), findsOneWidget);
    expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
  });

  Future<void> openMore(WidgetTester tester, String label) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.widgetWithText(ListTile, label));
    await tester.tap(find.widgetWithText(ListTile, label));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'Health in the app as on the website: the list, filters, a visit and a card in full',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 2000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester, kind: 'student');
      await openMore(tester, 'Health');
      expect(find.text('Clinic visits and health cards'), findsOneWidget);
      expect(find.text('12 in all · latest first'), findsOneWidget);
      expect(t.calls.lastWhere((c) => c.path == '/clinic/mine/list').query!['studentId'], '41');
      // a visit and a card, as the website lists them
      expect(find.text('Headache'), findsOneWidget);
      expect(find.text('Sent home'), findsOneWidget);
      expect(find.text('Rest and water · Medicine given: Paracetamol 500mg'), findsOneWidget);
      expect(find.text('Annual check-up 2026'), findsOneWidget);
      expect(find.text('Please see a doctor'), findsOneWidget);
      expect(find.text('Height 140 cm · Weight 35 kg · BMI 17.9 · Blood group B+'), findsOneWidget);
      // pages of ten
      expect(find.text('Page 1 / 2'), findsOneWidget);
      await tester.tap(find.byKey(const Key('healthNext')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/clinic/mine/list').query!['page'], 2);
      // the type and a search
      await tester.tap(find.byKey(const Key('healthKind-visit')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/clinic/mine/list').query!['kind'], 'visit');
      expect(find.text('1 found · latest first'), findsOneWidget);
      expect(find.text('Annual check-up 2026'), findsNothing);
      await tester.enterText(find.byKey(const Key('healthSearch')), 'fever');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/clinic/mine/list').query!['q'], 'fever');
      // the visit in full
      await tester.tap(find.byKey(const Key('visitDetails-v1')));
      await tester.pumpAndSettle();
      expect(find.text('Clinic visit · CV-7'), findsOneWidget);
      expect(find.text('38.5 °C'), findsOneWidget);
      expect(find.text('Still in the clinic'), findsOneWidget);
      expect(find.text('Medicines given'), findsOneWidget);
      expect(find.text('What the school asks of you'), findsOneWidget);
      expect(
        find.text(
          'The school clinic sent your child home.\nPlease keep the child at home tomorrow.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // the card in full, with its PDF
      await tester.tap(find.byKey(const Key('healthClear')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cardDetails-c1')));
      await tester.pumpAndSettle();
      expect(find.text('Eyes'), findsOneWidget);
      expect(find.text('6/9'), findsOneWidget);
      expect(
        find.text('Eyes to be checked.\nPlease see a doctor or specialist about the points above.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('view-hcardPdf')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/clinic/mine/cards/c1'), isTrue);
      expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
    },
  );

  testWidgets('Certificates in the app as on the website: figures, PDF, requests, asking for one', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await openMore(tester, 'Certificates');
    Finder fig(String x) =>
        find.descendant(of: find.byKey(const Key('certFigures')), matching: find.text(x));
    // ready: the register's one and the award; in progress: the waiting one; to pay: one
    expect(fig('2'), findsWidgets);
    expect(fig('To pay'), findsOneWidget);
    expect(find.text('Bonafide certificate'), findsWidgets);
    expect(find.text('Best in Science'), findsOneWidget);
    expect(find.text('Award'), findsOneWidget);
    // a certificate's PDF, opened in the app
    await tester.tap(find.byKey(const Key('view-cert-r5')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/certificate-requests/mine/certificates/5/pdf'), isTrue);
    expect(t.calls.any((c) => c.path == '/files/cert.pdf'), isTrue);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    // requests: where each is; the fee to pay; the issued one folded away
    expect(find.text('Pay the fee ₹100'), findsOneWidget);
    expect(find.byKey(const Key('request-80')), findsNothing);
    expect(find.text('Earlier requests (1)'), findsOneWidget);
    await tester.tap(find.byKey(const Key('withdrawCert-82')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirmWithdraw')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/certificate-requests/mine/82/withdraw'), isTrue);
    expect(find.text('The request is withdrawn.'), findsOneWidget);
    // ask for one: the purpose is needed, two copies, sent
    await scrollTo(tester, find.byKey(const Key('askType-BONAFIDE')));
    await tester.tap(find.byKey(const Key('askType-BONAFIDE')));
    await tester.pumpAndSettle();
    expect(find.text('Decided by the office'), findsOneWidget);
    await scrollTo(tester, find.byKey(const Key('sendCert-BONAFIDE')));
    await tester.tap(find.byKey(const Key('sendCert-BONAFIDE')));
    await tester.pumpAndSettle();
    expect(find.text('Write the purpose.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('purpose-BONAFIDE')), 'Bank account');
    await tester.tap(find.byKey(const Key('copiesMore-BONAFIDE')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('sendCert-BONAFIDE')));
    await tester.pumpAndSettle();
    expect(
      t.calls.lastWhere((c) => c.method == 'POST' && c.path == '/certificate-requests/mine').body,
      {'typeCode': 'BONAFIDE', 'studentId': '41', 'purpose': 'Bank account', 'copies': 2},
    );
    await scrollTo(
      tester,
      find.text('Your request is sent to the school. You will see here when it is ready.'),
    );
    expect(
      find.text('Your request is sent to the school. You will see here when it is ready.'),
      findsOneWidget,
    );
    expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
  });

  testWidgets(
    'exam date sheet as on the website: the next paper, the papers, earlier exams folded',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await pumpFamily(tester);
      await tester.tap(find.text('Academics'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Date sheet').last);
      await tester.pumpAndSettle();
      final s = S(false);
      expect(find.text('The papers of each exam: date, day and time.'), findsOneWidget);
      expect(
        find.text('Next paper: Maths · ${s.dayLong(DateTime.parse(day(5)))} · 09:00–10:00'),
        findsOneWidget,
      );
      expect(find.text('Periodic test 2'), findsOneWidget);
      expect(find.text('Bring your own geometry box.'), findsOneWidget);
      expect(find.text('09:00–10:00'), findsOneWidget);
      // the earlier exam folded away until tapped
      expect(find.text('Earlier exams (1)'), findsOneWidget);
      expect(find.text('Periodic test 1'), findsNothing);
      await tester.tap(find.byKey(const Key('earlierExams')));
      await tester.pumpAndSettle();
      expect(find.text('Periodic test 1'), findsOneWidget);
    },
  );

  testWidgets(
    'session plan and date sheets in the app: the class\'s and the school\'s, a kind, a file',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester, kind: 'student');
      await tester.tap(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('More')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Session plan and date sheets'));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/academics/documents'), isTrue);
      expect(find.text('Session plan, curriculum and date sheets'), findsWidgets);
      // the child's class and the whole school; another class's paper is not shown
      expect(find.text('For the class'), findsOneWidget);
      expect(find.text('From the school'), findsOneWidget);
      expect(find.text('Session plan 2026-27'), findsOneWidget);
      expect(find.text('The plan for the whole year.'), findsOneWidget);
      expect(find.text('Our magazine'), findsOneWidget);
      expect(find.text('Not this class'), findsNothing);
      // the kinds that have papers
      expect(find.byKey(const Key('docKind-session_plan')), findsOneWidget);
      expect(find.byKey(const Key('docKind-curriculum')), findsNothing);
      await tester.tap(find.byKey(const Key('docKind-session_plan')));
      await tester.pumpAndSettle();
      expect(find.text('Our magazine'), findsNothing);
      // the file and "I have seen this"
      await tester.tap(find.byKey(const Key('view-0')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/academics/documents/d1/files/81'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('docAck-d1')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/academics/acks').body, {
        'type': 'document',
        'id': 'd1',
        'studentId': '41',
      });
      expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
    },
  );

  testWidgets(
    'homework as on the website: a day at a time, earlier days, "I have seen this", a file',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester, kind: 'student');
      await tester.tap(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('Homework')),
      );
      await tester.pumpAndSettle();
      // today: each subject with its work; the assignment is on its own tab
      expect(find.text(S(false).dayLong(DateTime.parse(day(0)))), findsOneWidget);
      expect(find.text('Science'), findsOneWidget);
      expect(find.text('Plant a seed'), findsOneWidget);
      expect(find.text('Plant a seed in a cup and note what happens each day.'), findsOneWidget);
      expect(find.text('due ${S(false).dayShort(day(1))}'), findsOneWidget);
      expect(find.text('An assignment, not on the day view'), findsNothing);
      expect(find.text('Fractions page 12'), findsNothing);
      expect(find.text('Assignments (1)'), findsOneWidget);
      // no day after today
      expect(tester.widget<IconButton>(find.byKey(const Key('dayNext'))).onPressed, isNull);
      // "I have seen this" and the file, in the app
      await tester.tap(find.byKey(const Key('ack-501')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/academics/acks').body, {
        'type': 'daily_work',
        'id': '501',
        'studentId': '41',
      });
      expect(find.text('Seen'), findsOneWidget);
      await tester.tap(find.byKey(const Key('view-0')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/academics/daily-work/501/files/71'), isTrue);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // an earlier day with work, from the days that had some
      await tester.tap(find.byKey(Key('workDay-${day(-2)}')));
      await tester.pumpAndSettle();
      expect(find.text('Maths'), findsOneWidget);
      expect(find.text('Fractions page 12'), findsOneWidget);
      expect(find.text('Classwork'), findsOneWidget);
      expect(find.text('Plant a seed'), findsNothing);
      final asked = t.calls.lastWhere(
        (c) => c.path == '/academics/daily-work' && c.query?['kind'] == null,
      );
      expect(asked.query!['to'], day(-2));
      expect(asked.query!['from'], day(-15));
      // the day before it: nothing; back to today
      await tester.tap(find.byKey(const Key('dayBack')));
      await tester.pumpAndSettle();
      expect(find.text('Nothing was posted on this day.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('dayToday')));
      await tester.pumpAndSettle();
      expect(find.text('Plant a seed'), findsOneWidget);
      expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
    },
  );

  testWidgets('homework Assignments: still to do (nearest first), then past the due date', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 1800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Homework'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('hwView-assignments')));
    await tester.pumpAndSettle();
    expect(
      t.calls.any(
        (c) => c.path == '/academics/daily-work' && (c.query ?? const {})['kind'] == 'assignment',
      ),
      isTrue,
    );
    expect(find.text('To do'), findsOneWidget);
    expect(find.text('Past the due date'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('Project on rivers')).dy,
      lessThan(tester.getTopLeft(find.text('Past the due date')).dy),
    );
    expect(
      tester.getTopLeft(find.text('Essay on trees')).dy,
      greaterThan(tester.getTopLeft(find.text('Past the due date')).dy),
    );
    expect(find.text('due ${S(false).dayShort(day(-1))} · overdue'), findsOneWidget);
    expect(find.text('Geography · given ${S(false).dayShort(day(-5))}'), findsNWidgets(2));
    expect(find.byKey(const Key('asgClear')), findsNothing);
  });

  testWidgets('results: marks, a card held for fees, the report card PDF made and fetched', (
    tester,
  ) async {
    final (t, school) = await pumpFamily(tester);
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Results'));
    await tester.pumpAndSettle();
    expect(find.text('Term 1'), findsOneWidget);
    expect(find.text('82.5%'), findsOneWidget);
    expect(find.text('A2'), findsOneWidget);
    expect(find.text('Rank 4'), findsOneWidget);
    expect(find.text('This report card opens when the fees due are paid.'), findsOneWidget);
    expect(find.byKey(const Key('reportCardPdf-r2')), findsNothing);
    await tester.tap(find.byKey(const Key('reportCardPdf-r1')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(school.statusPolls, 2);
    expect(t.calls.any((c) => c.path == 'https://files.example.test/rc.pdf?token=t'), isTrue);
    expect(find.byKey(const Key('shareFile')), findsOneWidget);
  });

  testWidgets('fees: to pay now, instalments, a receipt; messages read; a notice acknowledged', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await tester.tap(find.text('Fees'));
    await tester.pumpAndSettle();
    expect(
      find.descendant(of: find.byKey(const Key('figSchoolFee')), matching: find.text('₹12,650')),
      findsOneWidget,
    );
    expect(find.text('Overdue'), findsOneWidget);
    expect(find.textContaining('Late fee ₹150'), findsOneWidget);
    await tester.tap(find.byKey(const Key('section-receipts')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('view-receipt-1001')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/fees/mine/receipts/1001/file'), isTrue);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Messages'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('message-m1')));
    await tester.pumpAndSettle();
    expect(find.text('The second instalment is due on the 10th.'), findsWidgets);
    expect(t.calls.lastWhere((c) => c.path == '/comms/inbox/read').body, {
      'ids': ['801', '802'],
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Notices'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('notice-601')));
    await tester.pumpAndSettle();
    // the HTML notice as plain text
    expect(find.text('Sports day is on Friday.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('ackNotice')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/academics/acks').body, {
      'type': 'notice',
      'id': '601',
      'studentId': '41',
    });
  });

  testWidgets(
    'a student: Home, Homework, Timetable, Results tabs; no fee figure; today\'s periods',
    (tester) async {
      final (t, _) = await pumpFamily(tester, kind: 'student');
      for (final tab in ['Home', 'Homework', 'Timetable', 'Results', 'More']) {
        expect(
          find.descendant(of: find.byType(NavigationBar), matching: find.text(tab)),
          findsOneWidget,
        );
      }
      expect(find.byKey(const Key('figFees')), findsNothing);
      expect(find.byKey(const Key('figExam')), findsOneWidget);
      expect(t.calls.any((c) => c.path == '/fees/mine'), isFalse);
      await tester.tap(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('Timetable')),
      );
      await tester.pumpAndSettle();
      // the week, as on the website: a column per school day
      expect(find.byKey(const Key('ttWeek')), findsOneWidget);
      expect(find.text('6 school days a week'), findsOneWidget);
      expect(find.text('Hindi'), findsNWidgets(3));
      expect(find.text('English'), findsNWidgets(3));
      expect(find.text('Asha Teacher · 12'), findsNWidgets(6));
      // a day at a time
      await tester.tap(find.byKey(const Key('ttView-day')));
      await tester.pumpAndSettle();
      final weekday = now.weekday == 7 ? 1 : now.weekday;
      expect(find.text(weekday.isEven ? 'Hindi' : 'English'), findsOneWidget);
      expect(find.text('08:00–08:40'), findsOneWidget);
      expect(find.text('Break'), findsOneWidget);
      await tester.tap(find.text(S(false).weekday(weekday == 6 ? 5 : weekday + 1)));
      await tester.pumpAndSettle();
      expect(find.text(weekday.isEven ? 'English' : 'Hindi'), findsOneWidget);
    },
  );

  testWidgets('a student sees their own fees from Home, view only: no Pay anywhere', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester, kind: 'student');
    // Results is a student tab: Fees takes its tile on Home
    expect(find.byKey(const Key('shortcut-results')), findsNothing);
    await tester.tap(find.byKey(const Key('shortcut-fees')));
    await tester.pumpAndSettle();
    expect(find.text('Overdue'), findsOneWidget);
    expect(find.byKey(const Key('pay-school')), findsNothing);
    expect(find.byKey(Key('tick-school-${day(-2)}')), findsNothing);
    await tester.tap(find.byKey(const Key('section-other')));
    await tester.pumpAndSettle();
    expect(find.text('Science trip'), findsOneWidget);
    expect(find.byKey(const Key('payMisc-m1')), findsNothing);
    await tester.tap(find.byKey(const Key('section-receipts')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('receipts-school')), findsOneWidget);
    expect(find.byKey(const Key('receipts-other')), findsOneWidget);
    await tester.tap(find.byKey(const Key('view-receipt-1001')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/fees/mine/receipts/1001/file'), isTrue);
    expect(t.calls.any((c) => c.method == 'POST' && c.path.startsWith('/payments/')), isFalse);
  });

  Future<void> openProfile(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Profile'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'Profile in the app: facts, sections, a change withdrawn, consents and the PDF — no web page',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(420, 2600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final (t, _) = await pumpFamily(tester);
      await openProfile(tester);
      expect(find.text('Profile complete 80%'), findsOneWidget);
      expect(find.text('Tara Teacher'), findsOneWidget);
      expect(find.text('VI A · Roll no 7'), findsOneWidget);
      // the parents (a parent's profile) and the sections
      expect(find.text('Parent Sample'), findsWidgets);
      expect(find.byKey(const Key('section-personal')), findsOneWidget);
      expect(find.text('Not given'), findsWidgets);
      // the photo comes from the API, not a web page
      expect(t.calls.any((c) => c.path == '/files/photo-student'), isTrue);
      expect(find.byKey(const Key('photo-student')), findsOneWidget);
      // the changes asked for stay folded until tapped; the one waiting for approval: withdrawn
      expect(find.text('House: Red'), findsNothing);
      expect(find.text('1 waiting · 0 decided · Show history'), findsOneWidget);
      await tester.tap(find.byKey(const Key('changeRequests')));
      await tester.pumpAndSettle();
      expect(find.text('House: Red'), findsOneWidget);
      await tester.tap(find.byKey(const Key('withdraw-r1')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/engagement/mine/change-requests/r1/cancel'), isTrue);
      expect(find.text('The request is withdrawn.'), findsOneWidget);
      // consents: news withdrawn; fee and safety cannot be
      await tester.tap(find.byKey(const Key('consent-news')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/comms/consents/mine').body, {
        'purposeCode': 'news',
        'status': 'withdrawn',
      });
      expect(tester.widget<TextButton>(find.byKey(const Key('consent-safety'))).onPressed, isNull);
      // the profile PDF: made at once by the API, opened in the app (no export to wait for)
      await tester.tap(find.byKey(const Key('view-profilePdf')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/engagement/mine/profile/41/print/file'), isTrue);
      expect(t.calls.any((c) => c.path.contains('/exports/')), isFalse);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path.contains('handoff')), isFalse);
    },
  );

  testWidgets('Profile Update: a field saved at once; one needing a proof asks for it', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await openProfile(tester);
    await tester.tap(find.byKey(const Key('update-personal')));
    await tester.pumpAndSettle();
    expect(find.text('Saved at once'), findsOneWidget);
    expect(find.text('Needs approval'), findsOneWidget);
    // nothing changed: nothing to send
    expect(tester.widget<FilledButton>(find.byKey(const Key('sendChanges'))).onPressed, isNull);
    // a number that needs the Aadhaar card: the proof is asked for
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('field-aadhaar')),
        matching: find.byType(EditableText),
      ),
      '123412341234',
    );
    await tester.pumpAndSettle();
    expect(find.text('Proof: Aadhaar card *'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sendChanges')));
    await tester.pumpAndSettle();
    expect(find.text('Add the proof the school asks for.'), findsOneWidget);
    expect(t.calls.any((c) => c.path == '/engagement/mine/profile/41/changes'), isFalse);
    // back to what it was, and the blood group (saved at once) instead
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('field-aadhaar')),
        matching: find.byType(EditableText),
      ),
      '',
    );
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('field-blood_group')),
        matching: find.byType(EditableText),
      ),
      'B+',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('sendChanges')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/engagement/mine/profile/41/changes').body, {
      'changes': {'blood_group': 'B+'},
      'proofs': <Object?>[],
    });
    expect(find.text('Your changes are saved.'), findsOneWidget);
  });

  testWidgets('Your data: the requests and their report; a new request sent', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, _) = await pumpFamily(tester);
    await openProfile(tester);
    await tester.tap(find.byKey(const Key('yourData')));
    await tester.pumpAndSettle();
    expect(find.text('Access · Kid Sample'), findsOneWidget);
    await tester.tap(find.byKey(const Key('view-dsr-d1')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/files/data-report.pdf'), isTrue);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    // details are needed
    await tester.tap(find.byKey(const Key('dsrSend')));
    await tester.pumpAndSettle();
    expect(find.text('Write the details.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('dsrDetail')), 'A copy of what you hold');
    await tester.tap(find.byKey(const Key('dsrSend')));
    await tester.pumpAndSettle();
    expect(
      t.calls.lastWhere((c) => c.path == '/privacy/requests/mine' && c.method == 'POST').body,
      {'kind': 'access', 'detail': 'A copy of what you hold'},
    );
    expect(find.text('Your request is recorded. The school office will respond.'), findsOneWidget);
  });

  testWidgets("a student's own profile: no parents' block", (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpFamily(tester, kind: 'student');
    await openProfile(tester);
    expect(find.text('Profile complete 80%'), findsOneWidget);
    expect(find.byKey(const Key('photoBox-father')), findsNothing);
    expect(find.byKey(const Key('photoBox-student')), findsOneWidget);
  });

  testWidgets('no network: the screen shows the copy it had, with when it was', (tester) async {
    final (_, school) = await pumpFamily(tester);
    await tester.tap(find.text('Fees'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('staleLine')), findsNothing);
    school.offline = true;
    await tester.fling(find.byType(ListView).first, const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('staleLine')), findsOneWidget);
    expect(find.textContaining('No connection. This is the copy from'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('figSchoolFee')), matching: find.text('₹12,650')),
      findsOneWidget,
    );
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''}): tap targets, labelled '
      'controls and text contrast on every family screen',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpFamily(tester, hindi: hindi);
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

        await check('Home');
        await tester.tap(find.text(s.academics).last);
        await check('Academics');
        for (final screen in [
          s.attendance,
          s.homework,
          s.timetable,
          s.dateSheet,
          s.results,
          s.calendar,
        ]) {
          await tester.tap(find.text(screen).last);
          await check(screen);
          if (screen == s.calendar) {
            for (final v in ['holidays', 'events']) {
              await tester.tap(find.byKey(Key('calView-$v')));
              await check('$screen, $v');
            }
          }
          if (screen == s.timetable) {
            await tester.tap(find.byKey(const Key('ttView-day')));
            await check('$screen, day');
          }
          if (screen == s.homework) {
            await tester.tap(find.byKey(const Key('hwView-assignments')));
            await check('$screen, assignments');
          }
          if (screen == s.attendance) {
            for (final v in ['year', 'leave']) {
              await tester.tap(find.byKey(Key('attView-$v')));
              await check('$screen, $v');
            }
          }
          await tester.tap(find.byType(BackButton));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.text(s.fees).last);
        await check('Fees');
        for (final x in ['other', 'receipts', 'bill']) {
          await scrollTo(tester, find.byKey(Key('section-$x')));
          await tester.tap(find.byKey(Key('section-$x')));
          await check('Fees, $x');
        }
        await scrollTo(tester, find.byKey(const Key('taxCertificate')));
        await tester.tap(find.byKey(const Key('taxCertificate')));
        await check('Tax certificate');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.messages).last);
        await check('Messages');
        await tester.tap(find.text(s.notices).last);
        await check('Notices');
        await tester.tap(
          find.descendant(of: find.byType(NavigationBar), matching: find.text(s.more)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(ListTile, s.menu('Profile')));
        await check('Profile');
        await scrollTo(tester, find.byKey(const Key('update-personal')));
        await tester.tap(find.byKey(const Key('update-personal')));
        await check('Profile update');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await scrollTo(tester, find.byKey(const Key('yourData')));
        await tester.tap(find.byKey(const Key('yourData')));
        await check('Your data');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(ListTile, s.menu('My teachers')));
        await check('My teachers');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(ListTile, s.menu('Session plan and date sheets')));
        await check('Session plan and date sheets');
        for (final page in ['Health', 'Certificates', 'School directory']) {
          await tester.tap(find.byType(BackButton));
          await tester.pumpAndSettle();
          await scrollTo(tester, find.widgetWithText(ListTile, s.menu(page)));
          await tester.tap(find.widgetWithText(ListTile, s.menu(page)));
          await check(page);
        }
        handle.dispose();
      },
    );
  }

  testWidgets('large text (twice the size): every family screen lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.binding.setSurfaceSize(const Size(360, 780));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpFamily(tester);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Academics').last);
    await tester.pumpAndSettle();
    for (final screen in [
      'Attendance',
      'Homework',
      'Timetable',
      'Date sheet',
      'Results',
      'Calendar',
    ]) {
      await scrollTo(tester, find.text(screen));
      await tester.tap(find.text(screen).last);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: screen);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
    }
    // the detail pages and the leave form
    await scrollTo(tester, find.text('Homework'));
    await tester.tap(find.text('Homework').last);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'homework, a day');
    await tester.tap(find.byKey(Key('workDay-${day(-2)}')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'homework, an earlier day');
    await scrollTo(tester, find.byKey(const Key('hwView-assignments')));
    await tester.tap(find.byKey(const Key('hwView-assignments')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'homework, assignments');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Attendance'));
    await tester.tap(find.text('Attendance').last);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'attendance month');
    await scrollTo(tester, find.byKey(const Key('dayByDay')));
    await tester.tap(find.byKey(const Key('dayByDay')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'attendance day by day');
    for (final v in ['year', 'leave']) {
      await scrollTo(tester, find.byKey(Key('attView-$v')));
      await tester.tap(find.byKey(Key('attView-$v')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'attendance $v');
    }
    await scrollTo(tester, find.byKey(const Key('applyLeave')));
    await tester.tap(find.byKey(const Key('applyLeave')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'leave form');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fees').last);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Fees');
    for (final x in ['other', 'receipts', 'bill']) {
      await scrollTo(tester, find.byKey(Key('section-$x')));
      await tester.tap(find.byKey(Key('section-$x')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'Fees, $x');
    }
    await scrollTo(tester, find.byKey(const Key('taxCertificate')));
    await tester.tap(find.byKey(const Key('taxCertificate')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'tax certificate');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Messages').last);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Messages');
    await scrollTo(tester, find.byKey(const Key('message-m1')));
    await tester.tap(find.byKey(const Key('message-m1')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'message in full');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notices').last);
    await tester.pumpAndSettle();
    // the filters have a search box: move the notices' own list
    await tester.dragUntilVisible(
      find.byKey(const Key('notice-601')),
      find.byType(ListView).last,
      const Offset(0, -300),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('notice-601')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'notice in full');
    // the profile, its update and Your data
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('More')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Profile'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Profile');
    await scrollTo(tester, find.byKey(const Key('update-personal')));
    await tester.tap(find.byKey(const Key('update-personal')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Profile update');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const Key('yourData')));
    await tester.tap(find.byKey(const Key('yourData')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Your data');
    // My teachers
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'My teachers'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'My teachers');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Session plan and date sheets'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Session plan and date sheets');
    for (final page in ['Health', 'Certificates', 'School directory']) {
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await scrollTo(tester, find.widgetWithText(ListTile, page));
      await tester.tap(find.widgetWithText(ListTile, page));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: page);
      if (page == 'Health') {
        // the search box scrolls too: move the page's own list
        await tester.dragUntilVisible(
          find.byKey(const Key('visitDetails-v1')),
          find.byType(ListView).first,
          const Offset(0, -300),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('visitDetails-v1')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'clinic visit in full');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
      }
    }
  });

  test('the copies are kept per profile and wiped at sign-out', () async {
    SharedPreferences.setMockInitialValues({});
    final first = await cached('fees:parent:7:41', () async => {'a': 1});
    expect(first.stale, isFalse);
    final again = await cached(
      'fees:parent:7:41',
      () async => throw const ApiException(0, 'offline', 'No connection'),
    );
    expect(again.stale, isTrue);
    expect(again.data, {'a': 1});
    // an API refusal is not hidden behind the copy
    expect(
      () =>
          cached('fees:parent:7:41', () async => throw const ApiException(403, 'forbidden', 'No')),
      throwsA(isA<ApiException>()),
    );
    await clearCache();
    expect(
      () => cached(
        'fees:parent:7:41',
        () async => throw const ApiException(0, 'offline', 'No connection'),
      ),
      throwsA(isA<ApiException>()),
    );
  });

  test('the school\'s layout is kept for offline use; none kept: the app as it was', () async {
    SharedPreferences.setMockInitialValues({});
    await clearCache();
    final school = School()
      ..kind = 'student'
      ..layout = layoutJson(
        tabs: ['academics', '/library', '/results'],
        shortcuts: ['/library', '/health', '/certificates', '/help'],
        cards: ['notices'],
        academics: ['/timetable', '/homework'],
      );
    const p = Profile(
      id: 'student:7:41',
      kind: 'student',
      schoolId: '7',
      schoolName: 'Sample School',
      name: 'Kid Sample',
      app: 'parent',
      studentId: '41',
    );
    Future<List<String>> tabs() async {
      final c = ProviderContainer(
        overrides: [transportProvider.overrideWithValue(FakeTransport(school.answer))],
      );
      addTearDown(c.dispose);
      final l = await c.read(familyLayoutProvider(p).future);
      return [for (final t in l.tabs) t.href];
    }

    const theSchools = ['/', 'academics', '/library', '/results', 'more'];
    expect(await tabs(), theSchools);
    // no network, a fresh start: the copy kept last time
    school.offline = true;
    expect(await tabs(), theSchools);
    // no copy either: the app as it was
    await clearCache();
    expect(await tabs(), ['/', '/homework', '/timetable', '/results', 'more']);
  });

  test('money in Indian grouping, dates in English and Hindi', () {
    const en = S(false);
    const hi = S(true);
    expect(en.money('12650.00'), '₹12,650');
    expect(en.money('1234567.5'), '₹12,34,567.50');
    expect(en.money('999'), '₹999');
    expect(en.date('2026-11-19'), '19 Nov 2026');
    expect(hi.date('2026-11-19'), '19 नव॰ 2026');
    expect(en.dayShort('2026-11-19'), 'Thu, 19 Nov');
    expect(en.time('09:30:00'), '09:30');
  });
}
