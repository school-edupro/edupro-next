import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/staff/data.dart';
import 'package:edupro/staff/indicators.dart';
import 'package:edupro/staff/sheet_excel.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
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
  School({
    this.webTab = false,
    this.arranged = false,
    this.lists = false,
    this.register,
    this.lessonSetup = false,
  });

  /// the person may set who approves lessons (the set-up right; docs/design/96, part 8)
  final bool lessonSetup;

  /// the school chose a tab that has only a web page (docs/design/94)
  final bool webTab;

  /// the school arranged the staff menu (docs/design/94, part 2): its order and names; hidden screens left out
  final bool arranged;

  /// the school's own list tabs (docs/design/94, part 3): Attendance renamed and given more, an Office list
  final bool lists;

  /// a register as the website shows it (docs/design/96, part 6): `open` (saved, a window note) or `closed`
  final String? register;
  bool offline = false;
  bool marked = false;
  int applies = 0;
  final decided = <String>[];

  /// lesson plans (docs/design/96, part 7): what was uploaded, decided and deleted
  Map<String, Object?>? lessonUploaded;
  String? lessonDecision;
  bool lessonDeleted = false;
  Map<String, Object?>? ruleSaved;
  final topicsMarked = <Map<String, Object?>>[];

  /// marks saved by pupil (docs/design/96, part 10), and the sheet's stage
  final marksSaved = <String, Map<String, Object?>>{};
  String marksStage = 'open';

  /// the sheets waiting to be verified that were verified or sent back (part 11)
  final marksDone = <String>{};

  /// indicators and the progress card (part 12): what was saved, and the Excel checks
  final indicatorPuts = <Map<String, Object?>>[];
  final wordsPuts = <Map<String, Object?>>[];
  final photosAdded = <Map<String, Object?>>[];
  final photosRemoved = <String>[];
  int sheetChecks = 0;
  final remarkPuts = <Map<String, Object?>>[];
  final healthPuts = <Map<String, Object?>>[];
  final choicePuts = <Map<String, Object?>>[];
  final attendancePuts = <Map<String, Object?>>[];
  final registerRemarkPuts = <Map<String, Object?>>[];
  int marksSheetChecks = 0;
  final lessonRules = <Map<String, Object?>>[
    {
      'id': 'r1',
      'scope': 'default',
      'employeeId': null,
      'classId': null,
      'department': null,
      'label': 'Everyone else (school default)',
      'levels': [
        {
          'level': 1,
          'kind': 'role',
          'employeeId': null,
          'roleCode': 'academic_coordinator',
          'label': 'Academic Coordinator',
        },
        {
          'level': 2,
          'kind': 'employee',
          'employeeId': '15',
          'roleCode': null,
          'label': 'Asha Teacher',
        },
      ],
    },
  ];

  Map<String, Object?> lessonRow(
    String id,
    String topic, {
    bool mine = false,
    bool myTurn = false,
    String status = 'pending',
    int files = 0,
  }) => {
    'id': id,
    'date': '2026-11-20',
    'classes': 'VI',
    'topic': topic,
    'employee': mine ? 'Asha Teacher' : 'Ravi Sample',
    'employeeCode': mine ? 'E015' : 'E099',
    'department': 'Science',
    'status': status,
    'currentLevel': 1,
    'levels': 2,
    'approver': 'Asha Teacher',
    'requestedAt': '2026-11-20T05:00:00.000Z',
    'files': files,
    'mine': mine,
    'myTurn': myTurn,
    'deleted': false,
  };

  Map<String, Object?> lessonDetail(String id) {
    final row = switch (id) {
      '9' => lessonRow(
        '9',
        'Food chains',
        myTurn: lessonDecision == null,
        status: lessonDecision == 'acknowledge' ? 'pending' : (lessonDecision ?? 'pending'),
      ),
      '12' => lessonRow('12', 'Parts of a leaf', mine: true, files: 1),
      _ => lessonRow(id, '${lessonUploaded?['topic'] ?? ''}', mine: true),
    };
    final decided = id == '9' && lessonDecision != null;
    return {
      ...row,
      if (id == '9' && lessonDecision == 'acknowledge') 'currentLevel': 2,
      if (id == '9' && lessonDecision == 'acknowledge') 'approver': 'Principal',
      'description': id == '12' ? '<p>Read the chapter.</p><p>Draw a leaf.</p>' : null,
      'fileIds': id == '12' ? ['91'] : <String>[],
      'ruleScope': id == '9' ? 'class' : null,
      'approvals': [
        {
          'level': 1,
          'approver': 'Asha Teacher',
          'byRole': false,
          'state': decided ? 'acknowledged' : 'pending',
          'remark': decided ? 'Fine' : null,
          'actedBy': decided ? 'Asha Teacher' : null,
          'actedAt': decided ? '2026-11-21T06:00:00.000Z' : null,
        },
        {
          'level': 2,
          'approver': 'Principal',
          'byRole': true,
          'state': 'pending',
          'remark': null,
          'actedBy': null,
          'actedAt': null,
        },
      ],
    };
  }

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
      entry('/lesson-plans', 'Lesson plans', 'book'),
      entry('/syllabus', 'My syllabus', 'book'),
      entry('/verify-marks', 'Verify marks', 'check'),
      entry('/indicators', 'Indicators and progress card', 'chart'),
      entry('/remarks', 'Remarks', 'message'),
      entry('/health', 'Height and weight', 'heart'),
      entry('/subject-choices', 'Subject choices', 'book'),
      entry('/date-sheet', 'Exam date sheet', 'calendar'),
      entry('/exam-register?only=attendance', 'Exam attendance', 'clipboard'),
      entry('/exam-register', 'Exam register', 'clipboard'),
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
                {
                  'href': '/holidays',
                  'label': 'Holidays and almanac',
                  'help': null,
                  'icon': 'calendar',
                },
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
            {
              'id': 'p2',
              'number': 2,
              'name': 'Lunch',
              'startsAt': '10:00:00',
              'endsAt': '10:20:00',
              'kind': 'break',
            },
            {
              'id': 'p3',
              'number': 3,
              'name': 'III',
              'startsAt': '10:20:00',
              'endsAt': '11:00:00',
              'kind': 'teaching',
            },
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
        return {
          'data': [
            // not today (the Home's periods count only today's)
            {
              'id': 'sub1',
              'onDate': '2026-11-18',
              'section': 'VIII-C',
              'periodName': 'III',
              'absentTeacher': 'Ravi Teacher',
              'substitute': 'Asha Teacher',
              'substituteEmployeeId': '7',
              'subject': 'English',
              'reason': 'On leave',
            },
          ],
        };
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
      case 'GET /attendance/session' when register != null:
        return {
          'id': 's9',
          'section': 'VI-A',
          'date': c.query?['date'],
          'kind': 'day',
          'locked': false,
          'markedBy': 'Asha Teacher',
          'source': 'rfid',
          'markedLate': true,
          'window': register == 'open'
              ? {
                  'open': true,
                  'late': true,
                  'from': '07:00',
                  'to': '18:00',
                  'note': 'An earlier day: saved as marked late.',
                }
              : {'open': false, 'late': false, 'from': '07:00', 'to': '10:00', 'note': null},
          'counts': {'P': 1, 'LV': 1, 'strength': 2},
          'roster': [
            {
              'studentId': '41',
              'name': 'Kid Sample',
              'admissionNo': 'A-41',
              'rollNo': 1,
              'code': 'P',
              'remarks': 'Fever',
              'inAt': '2026-11-20T02:35:00.000Z',
              'hint': {
                'leave': null,
                'pass': {'kind': 'early_leave', 'number': 'GP-1', 'atTime': '12:30'},
              },
              'locked': false,
            },
            {
              'studentId': '42',
              'name': 'Ria Sample',
              'admissionNo': 'A-42',
              'rollNo': 2,
              'code': 'LV',
              'locked': true,
            },
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
      case 'GET /attendance/desk/class-register.pdf':
        return null;
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
      case 'GET /exams':
        return {
          'data': [
            {
              'id': 'e1',
              'code': 'T1',
              'name': 'Term 1',
              'marksLocked': false,
              'areas': ['marks'],
            },
            {
              'id': 'e2',
              'code': 'IND',
              'name': 'Indicators',
              'areas': ['indicators', 'remarks', 'health', 'attendance'],
            },
            {
              'id': 'e3',
              'code': 'PT',
              'name': 'Practical test',
              'areas': ['marks'],
            },
          ],
        };
      case 'GET /exams/e3/entry/sections':
        return {'data': []};
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
                  'maxMarks': '80',
                  'entryLocked': false,
                  'entered': marksSaved.length,
                  'parts': [],
                },
                {
                  'examSubjectId': 'es2',
                  'subjectId': '92',
                  'name': 'Science',
                  'maxMarks': '80',
                  'entryLocked': false,
                  'entered': 0,
                  'parts': [
                    {'id': 'p1', 'name': 'Theory', 'maxMarks': '60.00', 'mine': true},
                    {'id': 'p2', 'name': 'Practical', 'maxMarks': '20.00', 'mine': false},
                  ],
                },
                {
                  'examSubjectId': 'es3',
                  'subjectId': '93',
                  'name': 'Art',
                  'maxMarks': '0',
                  'entryLocked': false,
                  'entered': 0,
                  'parts': [],
                },
              ],
            },
          ],
        };
      case 'GET /exams/e1/marks':
        final subject = c.query?['subjectId'];
        Map<String, Object?> row(String id, String name, int roll, {String? taken = 'compulsory'}) {
          final saved = subject == '91' ? marksSaved[id] : null;
          return {
            'studentId': id,
            'name': name,
            'admissionNo': 'A-$id',
            'rollNo': roll,
            'marks': subject == '92' && id == '41' ? '70.00' : saved?['marks']?.toString(),
            'absent': false,
            'exempt': false,
            'code': saved?['code'],
            'grade': null,
            'taken': taken,
            'parts': subject == '92' && id == '41'
                ? {
                    'p1': {'marks': '52.00', 'absent': false},
                    'p2': {'marks': '18.00', 'absent': false},
                  }
                : <String, Object?>{},
          };
        }
        return {
          'exam': {'id': 'e1', 'code': 'T1', 'name': 'Term 1', 'marksLocked': false},
          'examSubject': {
            'id': 'es$subject',
            'code': 'X',
            'name': switch (subject) {
              '92' => 'Science',
              '93' => 'Art',
              _ => 'Mathematics',
            },
            'maxMarks': subject == '93' ? '0' : '80.00',
            'passMarks': subject == '91' ? '27.00' : null,
            'entryLocked': false,
            'gradeOnly': subject == '93',
            'parts': subject == '92'
                ? [
                    {'id': 'p1', 'name': 'Theory', 'maxMarks': '60.00', 'mine': true},
                    {'id': 'p2', 'name': 'Practical', 'maxMarks': '20.00', 'mine': false},
                  ]
                : [],
          },
          'section': {'id': '300', 'code': 'VI-A'},
          'codes': [
            {'code': 'AB', 'name': 'Absent'},
            {'code': 'ML', 'name': 'Medical'},
            {'code': 'EX', 'name': 'Exempt'},
          ],
          'grades': subject == '93' ? ['A', 'B', 'C'] : <String>[],
          'status': {
            'status': subject == '91' ? marksStage : 'open',
            'remark': subject == '91' && marksStage == 'submitted'
                ? 'Waiting for the class teacher'
                : null,
          },
          'rows': [
            row('41', 'Kid Sample', 1),
            row('42', 'Ria Sample', 2),
            row('43', 'Dev Sample', 3, taken: null),
          ],
        };
      case 'PUT /exams/e1/marks':
        for (final r in (c.body!['rows'] as List).cast<Map<String, Object?>>()) {
          marksSaved['${r['studentId']}'] = r;
        }
        return {'inserted': (c.body!['rows'] as List).length, 'updated': 0};
      case 'PUT /exams/e1/part-marks':
        return {'saved': (c.body!['rows'] as List).length};
      case 'GET /exams/e2/entry/sections':
        return {
          'data': [
            {
              'classSectionId': '300',
              'code': 'VI-A',
              'register': true,
              'indicators': true,
              'remarks': true,
              'subjects': [],
            },
            {
              'classSectionId': '301',
              'code': 'VI-B',
              'register': false,
              'indicators': true,
              'remarks': true,
              'subjects': [],
            },
            {
              'classSectionId': '302',
              'code': 'VI-C',
              'register': false,
              'indicators': false,
              'remarks': false,
              'subjects': [],
            },
          ],
        };
      case 'GET /exams/e2/indicators':
        final mapped = c.query?['classSectionId'] == '301';
        Map<String, Object?> item(
          String id,
          String name,
          String area, {
          String? parent,
          String kind = 'level',
          bool heading = false,
          bool mine = true,
          List<String>? levels,
          List<String> by = const [],
        }) => {
          'id': id,
          'name': name,
          'area': area,
          'parentId': parent,
          'kind': kind,
          'heading': heading,
          'levels': levels,
          'mine': mine,
          'enteredBy': by,
        };
        return {
          'exam': {'id': 'e2', 'code': 'IND', 'name': 'Indicators', 'marksLocked': false},
          'section': {'id': mapped ? '301' : '300', 'code': mapped ? 'VI-B' : 'VI-A'},
          'locked': false,
          'reach': mapped ? 'mapped' : 'all',
          'set': {
            'id': 's1',
            'code': mapped ? 'IND' : 'HPC',
            'name': mapped ? 'Indicators' : 'Progress card',
            'grades': ['B', 'P', 'A'],
            'kind': mapped ? 'indicators' : 'hpc',
            'levelWords': {'B': 'Beginner', 'P': 'Proficient', 'A': 'Advanced'},
          },
          'indicators': [
            item('g1', 'Speaking', 'Language', heading: true),
            item('i1', 'Speaks clearly', 'Language', parent: 'g1', by: ['Ravi Sample (E099)']),
            item('i2', 'Reading note', 'Language', kind: 'text', mine: !mapped),
            item('i3', 'Counts to 100', 'Numeracy', levels: ['Yes', 'No'], mine: !mapped),
          ],
          'rows': [
            {
              'studentId': '41',
              'name': 'Kid Sample',
              'admissionNo': 'A-41',
              'rollNo': 1,
              'grades': {
                'i1': {'grade': 'P', 'note': null},
              },
              if (!mapped)
                'feedback': {
                  'parent': {'text': 'Loves stories', 'byFamily': true},
                },
              if (!mapped) 'photos': 1,
            },
            {
              'studentId': '42',
              'name': 'Ria Sample',
              'admissionNo': 'A-42',
              'rollNo': 2,
              'grades': <String, Object?>{},
              if (!mapped) 'feedback': <String, Object?>{},
              if (!mapped) 'photos': 0,
            },
          ],
        };
      case 'PUT /exams/e2/indicators':
        indicatorPuts.add(c.body!);
        return {'changed': 3};
      case 'GET /exams/e2/indicators/excel':
        return null;
      case 'POST /exams/e2/indicators/upload':
        sheetChecks++;
        final firstTry = sheetChecks == 1;
        return {
          'rows': [
            {'row': 2, 'admissionNo': 'A-41', 'name': 'Kid Sample', 'error': null},
            {
              'row': 3,
              'admissionNo': 'A-42',
              'name': 'Ria Sample',
              'error': firstTry ? 'Level Z is not on the list' : null,
            },
          ],
          'ready': firstTry ? 1 : 2,
          'errors': firstTry ? 1 : 0,
          'applied': c.body!['apply'] == true,
        };
      case 'PUT /exams/e2/hpc-feedback':
        wordsPuts.add(c.body!);
        return {'changed': 2};
      case 'GET /exams/e2/portfolio':
        return {
          'data': [
            if (c.query?['studentId'] == '41' && !photosRemoved.contains('pf1'))
              {
                'id': 'pf1',
                'studentId': '41',
                'caption': 'Science fair',
                'indicatorId': 'i1',
                'indicator': 'Speaks clearly',
                'createdAt': '2026-11-20T05:00:00.000Z',
              },
          ],
        };
      case 'POST /exams/e2/portfolio':
        photosAdded.add(c.body!);
        return {'id': 'pf2'};
      case 'DELETE /exams/e2/portfolio/pf1':
        photosRemoved.add('pf1');
        return {'ok': true};
      case 'GET /exams/e2/portfolio/pf1/image':
        return null;
      case 'GET /exams/e2/remark-items':
        final other = c.query?['classSectionId'] == '301';
        return {
          'section': {'id': other ? '301' : '300', 'code': other ? 'VI-B' : 'VI-A'},
          'locked': false,
          'reason': other ? 'Only the class teacher writes these here.' : null,
          'categories': [
            {
              'id': 'k1',
              'name': 'General',
              'subjectName': null,
              'freeText': true,
              'may': !other,
              'bank': [
                {'code': 'G1', 'text': 'Works hard'},
                {'code': 'G2', 'text': 'Helps others'},
              ],
            },
            {
              'id': 'k2',
              'name': 'Conduct',
              'subjectName': null,
              'freeText': false,
              'may': !other,
              'bank': [
                {'code': 'C1', 'text': 'Very good'},
                {'code': 'C2', 'text': 'Good'},
              ],
            },
            {
              'id': 'k3',
              'name': 'English remarks',
              'subjectName': 'English',
              'freeText': true,
              'may': false,
              'writtenBy': ['Ravi Sample (E099)'],
              'bank': [],
            },
          ],
          'rows': [
            {
              'studentId': '41',
              'name': 'Kid Sample',
              'rollNo': 1,
              'items': {
                'k1': {'text': 'Works hard'},
              },
            },
            {'studentId': '42', 'name': 'Ria Sample', 'rollNo': 2, 'items': <String, Object?>{}},
          ],
        };
      case 'PUT /exams/e2/remark-items':
        remarkPuts.add(c.body!);
        return {'changed': 3};
      case 'GET /exams/e2/remark-items/excel':
        return null;
      case 'POST /exams/e2/remark-items/upload':
        return {
          'rows': [
            {'row': 2, 'admissionNo': 'A-41', 'name': 'Kid Sample', 'error': null},
          ],
          'ready': 1,
          'errors': 0,
          'applied': c.body!['apply'] == true,
        };
      case 'GET /exams/e2/health':
        return {
          'exam': {'id': 'e2', 'code': 'IND', 'name': 'Indicators'},
          'section': {'id': '300', 'code': 'VI-A'},
          'takes': true,
          'locked': false,
          'canEnter': true,
          'rows': [
            {
              'studentId': '41',
              'name': 'Kid Sample',
              'admissionNo': 'A-41',
              'rollNo': 1,
              'current': {
                'heightCm': '120.0',
                'weightKg': '22.5',
                'bmi': '15.6',
                'bloodGroup': 'B+',
                'recordedOn': '2026-11-20',
                'examName': 'Indicators',
              },
              'last': {
                'heightCm': '116.0',
                'weightKg': '21.0',
                'bmi': '15.6',
                'bloodGroup': 'B+',
                'recordedOn': '2026-04-10',
                'examName': 'Term 1',
              },
            },
            {
              'studentId': '42',
              'name': 'Ria Sample',
              'admissionNo': 'A-42',
              'rollNo': 2,
              'current': null,
              'last': null,
            },
          ],
        };
      case 'PUT /exams/e2/health':
        healthPuts.add(c.body!);
        return {'recorded': (c.body!['rows'] as List).length};
      case 'GET /exams/e2/health/excel':
        return null;
      case 'POST /exams/e2/health/upload':
        return {
          'rows': [
            {'row': 2, 'admissionNo': 'A-41', 'name': 'Kid Sample', 'error': null},
          ],
          'ready': 1,
          'errors': 0,
          'applied': c.body!['apply'] == true,
        };
      case 'GET /exams/subject-choices/sections':
        return {
          'data': [
            {'id': '300', 'code': 'VI-A', 'students': 2, 'canEdit': true, 'mine': true},
            {'id': '301', 'code': 'VI-B', 'students': 2, 'canEdit': false, 'mine': true},
            {'id': '302', 'code': 'VI-C', 'students': 2, 'canEdit': false, 'mine': false},
          ],
        };
      case 'GET /exams/subject-choices':
        final mine = c.query?['classSectionId'] == '300';
        Map<String, Object?> sub(String id, String code, String name, String take, [String? g]) => {
          'id': id,
          'code': code,
          'name': name,
          'take': take,
          'groupId': g,
        };
        Map<String, Object?> took(String id, [bool additional = false]) => {
          'subjectId': id,
          'kind': 'optional',
          'additional': additional,
        };
        return {
          'section': {'id': mine ? '300' : '301', 'code': mine ? 'VI-A' : 'VI-B'},
          'fromExams': false,
          'canEdit': mine,
          'subjects': [
            sub('s1', 'ENG', 'English', 'all'),
            sub('s2', 'MAT', 'Mathematics', 'all'),
            sub('s3', 'HIN', 'Hindi', 'group', 'g1'),
            sub('s4', 'SKT', 'Sanskrit', 'group', 'g1'),
            sub('s5', 'CA', 'Computer', 'group', 'g2'),
            sub('s6', 'PE', 'Physical education', 'group', 'g2'),
            sub('s7', 'ART', 'Art', 'free'),
            sub('s8', 'PHY', 'Physics', 'free'),
          ],
          'groups': [
            {
              'id': 'g1',
              'name': 'Second language',
              'kind': 'optional',
              'min': 1,
              'max': 1,
              'subjectIds': ['s3', 's4'],
            },
            {
              'id': 'g2',
              'name': 'Skill subjects',
              'kind': 'additional',
              'min': 0,
              'max': 2,
              'subjectIds': ['s5', 's6'],
            },
          ],
          'streams': [
            {
              'id': 'st1',
              'name': 'Science',
              'subjectIds': ['s8'],
            },
            {'id': 'st2', 'name': 'Arts', 'subjectIds': <String>[]},
          ],
          'rows': [
            {
              'studentId': '41',
              'name': 'Kid Sample',
              'admissionNo': 'A-41',
              'rollNo': 1,
              'stream': 'Science',
              'subjects': [took('s1'), took('s3'), took('s8'), took('s7', true)],
              'marked': ['s3'],
            },
            {
              'studentId': '42',
              'name': 'Ria Sample',
              'admissionNo': 'A-42',
              'rollNo': 2,
              'stream': null,
              'subjects': <Object?>[],
              'marked': <Object?>[],
            },
          ],
        };
      case 'PUT /exams/subject-choices':
        choicePuts.add(c.body!);
        return {'saved': 2};
      case 'POST /exams/subject-choices/last-year':
        return {'copied': 1};
      case 'GET /exams/date-sheets':
        Map<String, Object?> paper(String subject, String on, [String? from, String? to]) => {
          'subject': subject,
          'examOn': on,
          'startsAt': from,
          'endsAt': to,
        };
        return {
          'data': [
            {
              'id': 'd1',
              'name': 'Term 1',
              'note': 'Reporting time 8:30.',
              'classes': [
                {
                  'classId': '60',
                  'classCode': 'VI',
                  'papers': [paper('English', day(-30), '09:00', '12:00')],
                },
              ],
            },
            {
              'id': 'd2',
              'name': 'Term 2',
              'note': null,
              'classes': [
                {
                  'classId': '60',
                  'classCode': 'VI',
                  'papers': [
                    paper('Mathematics', day(3), '09:00', '12:00'),
                    paper('Hindi', day(5)),
                  ],
                },
                {
                  'classId': '70',
                  'classCode': 'VII',
                  'papers': [paper('Science', day(3), '09:00')],
                },
              ],
            },
          ],
        };
      case 'GET /exams/e1/marks/excel':
        return null;
      case 'POST /exams/e1/marks/upload':
        marksSheetChecks++;
        return {
          'rows': [
            {'row': 2, 'admissionNo': 'A-41', 'name': 'Kid Sample', 'error': null},
            {'row': 3, 'admissionNo': 'A-42', 'name': 'Ria Sample', 'error': null},
          ],
          'ready': 2,
          'errors': 0,
          'applied': c.body!['apply'] == true,
        };
      case 'GET /exams/e2/register':
        return {
          'exam': {'id': 'e2', 'code': 'IND', 'name': 'Indicators', 'marksLocked': false},
          'section': {'id': '300', 'code': 'VI-A'},
          'healthVisible': true,
          'remarkBank': [
            {'code': 'R1', 'text': 'Good effort'},
          ],
          'rows': [
            {
              'studentId': '41',
              'name': 'Kid Sample',
              'admissionNo': 'A-41',
              'rollNo': 1,
              'remark': 'Neat work',
              'daysPresent': 40,
              'daysTotal': 45,
              'health': {
                'heightCm': '120.0',
                'weightKg': '22.5',
                'bmi': '15.6',
                'bloodGroup': 'B+',
                'recordedOn': '2026-11-20',
              },
            },
            {
              'studentId': '42',
              'name': 'Ria Sample',
              'admissionNo': 'A-42',
              'rollNo': 2,
              'remark': null,
              'daysPresent': null,
              'daysTotal': null,
              'health': null,
            },
          ],
        };
      case 'PUT /exams/e2/attendance':
        attendancePuts.add(c.body!);
        return {'changed': (c.body!['rows'] as List).length};
      case 'PUT /exams/e2/remarks':
        registerRemarkPuts.add(c.body!);
        return {'changed': (c.body!['rows'] as List).length};
      case 'GET /exams/e2/register/excel':
        return null;
      case 'POST /exams/e2/register/upload':
        return {
          'rows': [
            {'row': 2, 'admissionNo': 'A-41', 'name': 'Kid Sample', 'error': null},
          ],
          'ready': 1,
          'errors': 0,
          'applied': c.body!['apply'] == true,
        };
      case 'POST /exams/e2/attendance/from-daily':
        return {'from': '2026-04-01', 'to': '2026-10-20', 'filled': 1, 'kept': 1, 'noDays': 0};
      case 'GET /exams/entry-status/waiting':
        Map<String, Object?> waiting(String subject, String name) => {
          'examId': 'e1',
          'examCode': 'T1',
          'subjectId': subject,
          'subjectCode': name.substring(0, 2).toUpperCase(),
          'subjectName': name,
          'classSectionId': '300',
          'section': 'VI-A',
          'takers': 2,
          'entered': 2,
          'submittedBy': 'Ravi Sample',
          'submittedAt': '2026-11-20T05:00:00.000Z',
        };
        return {
          'data': [
            if (!marksDone.contains('91')) waiting('91', 'Mathematics'),
            if (!marksDone.contains('92')) waiting('92', 'Science'),
          ],
        };
      case 'POST /exams/e1/entry-status/verify' || 'POST /exams/e1/entry-status/send-back':
        marksDone.add('${c.body!['subjectId']}');
        return {'status': c.path.endsWith('verify') ? 'verified' : 'open'};
      case 'POST /exams/e1/entry-status/submit':
        marksStage = 'submitted';
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
      // lesson plans (docs/design/96, part 7)
      case 'GET /academics/lessons/options':
        return {
          'classes': [
            {'value': '60', 'label': 'VI'},
          ],
          'sections': [
            {'value': '300', 'label': 'VI-A'},
            {'value': '301', 'label': 'VI-B'},
          ],
          'maxFiles': 2,
        };
      case 'POST /academics/lessons':
        lessonUploaded = c.body;
        return {'id': '15'};
      case 'GET /academics/lessons':
        if (c.query?['wrap'] == '1') {
          return {
            'filename': 'lesson-report.${c.query?['format']}',
            'contentType': 'application/pdf',
            'base64': 'JVBERg==',
          };
        }
        final rows = [
          lessonRow('9', 'Food chains', myTurn: true),
          if (!lessonDeleted) lessonRow('12', 'Parts of a leaf', mine: true, files: 1),
        ].where((r) => c.query?['status'] == null || r['status'] == c.query?['status']).toList();
        return {
          'data': rows,
          'counts': {
            'total': lessonDeleted ? 1 : 2,
            'pending': lessonDeleted ? 1 : 2,
            'acknowledged': 0,
            'rejected': 0,
          },
          'page': {'number': 1, 'size': 50, 'total': rows.length},
          'office': false,
        };
      // my syllabus (docs/design/96, part 9)
      case 'GET /academics/syllabus/mine':
        return {
          'data': [
            {
              'classSectionId': '300',
              'section': 'VI-A',
              'classId': '60',
              'subjectId': '5',
              'subject': 'Science',
              'topics': 4,
              'done': 1 + topicsMarked.where((m) => m['status'] == 'done').length,
              'partial': 1,
              'percent': 25,
              'behind': 2,
            },
            {
              'classSectionId': '301',
              'section': 'VI-B',
              'classId': '60',
              'subjectId': '5',
              'subject': 'Science',
              'topics': 4,
              'done': 4,
              'partial': 0,
              'percent': 100,
              'behind': 0,
            },
          ],
        };
      case 'GET /academics/syllabus/tree':
        return {
          'chapters': [
            {
              'id': 'c1',
              'number': 1,
              'name': 'Food',
              'term': 'Term 1',
              'plannedMonth': 7,
              'topics': [
                {
                  'id': 't1',
                  'number': 1,
                  'name': 'Sources of food',
                  'plannedPeriods': 2,
                  'status': 'done',
                  'doneOn': '2026-07-10',
                  'reason': null,
                },
                {
                  'id': 't2',
                  'number': 2,
                  'name': 'Plant parts we eat',
                  'plannedPeriods': 1,
                  'status': topicsMarked.isEmpty ? null : topicsMarked.last['status'],
                  'doneOn': null,
                  'reason': null,
                },
              ],
            },
            {
              'id': 'c2',
              'number': 2,
              'name': 'Fibre',
              'term': null,
              'plannedMonth': null,
              'topics': [],
            },
          ],
        };
      case 'POST /academics/syllabus/mark':
        topicsMarked.add(c.body!);
        return {'saved': true};
      case 'GET /academics/lessons/approvers':
        if (!lessonSetup) throw const ApiException(403, 'forbidden', 'Not allowed');
        return {
          'data': lessonRules,
          'employees': [
            {'value': '15', 'label': 'Asha Teacher (E015)'},
            {'value': '99', 'label': 'Ravi Sample (E099)'},
          ],
          'classes': [
            {'value': '60', 'label': 'VI'},
            {'value': '70', 'label': 'VII'},
          ],
          'departments': ['Science'],
          'roles': [
            {'value': 'academic_coordinator', 'label': 'Academic Coordinator'},
            {'value': 'principal', 'label': 'Principal'},
          ],
        };
      case 'POST /academics/lessons/approvers':
        ruleSaved = c.body;
        lessonRules.add({
          'id': 'r2',
          'scope': c.body!['scope'],
          'employeeId': null,
          'classId': c.body!['classId'],
          'department': null,
          'label': 'VI',
          'levels': [
            {
              'level': 1,
              'kind': 'role',
              'employeeId': null,
              'roleCode': 'principal',
              'label': 'Principal',
            },
          ],
        });
        return {'id': 'r2'};
      case 'DELETE /academics/lessons/approvers/r1':
        lessonRules.removeWhere((r) => r['id'] == 'r1');
        return {'ok': true};
      case 'GET /academics/lessons/9' || 'GET /academics/lessons/12' || 'GET /academics/lessons/15':
        return lessonDetail(c.path.split('/').last);
      case 'POST /academics/lessons/9/decide':
        lessonDecision = '${c.body!['action']}';
        return lessonDetail('9');
      case 'DELETE /academics/lessons/12':
        lessonDeleted = true;
        return {'ok': true};
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
      // the staff calendar (docs/design/96, part 4)
      case 'GET /academics/calendar/staff':
        return {
          'from': '2026-04-01',
          'to': '2027-03-31',
          'holidays': [
            {
              'id': '1',
              'name': 'Founders day',
              'kind': 'holiday',
              'startsOn': '2026-12-02',
              'endsOn': '2026-12-02',
              'appliesTo': 'everyone',
              'campusId': null,
            },
          ],
          'events': [
            {
              'id': '2',
              'title': 'Staff workshop',
              'kind': 'meeting',
              'startsOn': '2026-12-10',
              'endsOn': '2026-12-10',
              'startsAt': '10:00',
              'description': null,
              'audience': 'employees',
            },
          ],
        };
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
  List<Override> overrides = const [],
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
        ...overrides,
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

  testWidgets('Marks as on the website: the exam and sheet, codes, not taken, save, submit', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600));
    final s = S(false);
    await tester.tap(find.byKey(const Key('figToEnter')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('marksScreen')), findsOneWidget);
    // the exams that take marks; the first sheet open
    expect(t.calls.any((c) => c.path == '/exams'), isTrue);
    expect(find.text('Term 1 (T1)'), findsWidgets);
    expect(find.text('VI-A · Mathematics'), findsOneWidget);
    expect(find.text('out of 80 (pass 27) · 0 of 2 entered'), findsOneWidget);
    expect(find.text('3 pupils'), findsOneWidget);
    // who does not take the subject has no boxes
    expect(find.byKey(const Key('mkNotTaken-43')), findsOneWidget);
    expect(find.byKey(const Key('marks-43')), findsNothing);
    // submit waits until every pupil has marks or a code
    expect(find.byKey(const Key('submitMarks')), findsNothing);
    expect(find.text(s.mkSubmitHint), findsOneWidget);
    // over the maximum is refused before sending
    await tester.enterText(find.byKey(const Key('marks-41')), '95');
    await tester.tap(find.byKey(const Key('saveMarksSheet')));
    await tester.pumpAndSettle();
    expect(find.text('Marks can be at most 80.'), findsOneWidget);
    expect(t.calls.where((c) => c.method == 'PUT'), isEmpty);
    // marks for one, the school's code for the other
    await tester.enterText(find.byKey(const Key('marks-41')), '72');
    await tester.tap(find.byKey(const Key('code-42')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AB · Absent').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('saveMarksSheet')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.method == 'PUT' && c.path == '/exams/e1/marks').body, {
      'classSectionId': '300',
      'subjectId': '91',
      'rows': [
        {'studentId': '41', 'marks': 72},
        {'studentId': '42', 'code': 'AB'},
      ],
    });
    expect(find.text('Marks saved (2 new, 0 changed).'), findsOneWidget);
    // read again: all entered, so it can be submitted
    expect(find.text('out of 80 (pass 27) · 2 of 2 entered'), findsOneWidget);
    await tester.tap(find.byKey(const Key('submitMarks')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/exams/e1/entry-status/submit'), isTrue);
    expect(find.text(s.mkSubmitted), findsOneWidget);
    expect(find.text('Submitted'), findsOneWidget);
    expect(find.text('Waiting for the class teacher'), findsOneWidget);
    expect(find.byKey(const Key('mkLockedNote')), findsOneWidget);
    expect(find.byKey(const Key('saveMarksSheet')), findsNothing);

    // a subject entered in parts: only the part the teacher enters, with the total and the other part
    await tester.tap(find.byKey(const Key('mkPick')));
    await tester.pumpAndSettle();
    expect(find.text('VI-A · Science · Practical (20)'), findsNothing);
    await tester.tap(find.text('VI-A · Science · Theory (60)').last);
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Science is entered in parts: Theory 60 + Practical 20 = 80. The total is worked out from the parts.',
      ),
      findsOneWidget,
    );
    expect(find.text('Total: 70 / 80 · Practical 18'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('marks-41'))).controller!.text, '52');
    await tester.enterText(find.byKey(const Key('marks-41')), '50');
    await tester.tap(find.byKey(const Key('code-42')));
    await tester.pumpAndSettle();
    // a part takes only AB
    expect(find.text('ML · Medical'), findsNothing);
    await tester.tap(find.text('AB · Absent').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('saveMarksSheet')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e1/part-marks').body, {
      'classSectionId': '300',
      'partId': 'p1',
      'rows': [
        {'studentId': '41', 'marks': 50, 'absent': false},
        {'studentId': '42', 'absent': true},
      ],
    });
    expect(find.text(s.mkSavedPlain), findsOneWidget);

    // a subject graded on a scale: a grade, not marks
    await tester.tap(find.byKey(const Key('mkPick')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VI-A · Art · 0 entered').last);
    await tester.pumpAndSettle();
    expect(find.text('graded · 0 of 2 entered'), findsOneWidget);
    await tester.tap(find.byKey(const Key('grade-41')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('A').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('saveMarksSheet')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.method == 'PUT' && c.path == '/exams/e1/marks').body, {
      'classSectionId': '300',
      'subjectId': '93',
      'rows': [
        {'studentId': '41', 'grade': 'A'},
      ],
    });

    // another exam with nothing given to the teacher
    await tester.tap(find.byKey(const Key('mkExam')));
    await tester.pumpAndSettle();
    expect(find.text('Indicators (IND)'), findsNothing);
    await tester.tap(find.text('Practical test (PT)').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('mkNoSheet')), findsOneWidget);
  });

  testWidgets('Verify marks in the app: what waits, open the sheet, send back, verify', (
    tester,
  ) async {
    final school = School()..marksStage = 'submitted';
    final (t, _) = await pumpStaff(tester, size: const Size(420, 2600), with_: school);
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Verify marks'));
    await tester.pumpAndSettle();
    // no web page: the app's own list
    expect(find.byKey(const Key('vmList')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-verify-marks')), findsNothing);
    final maths = find.byKey(const Key('vm-e1-300-91'));
    expect(find.descendant(of: maths, matching: find.text('VI-A · Mathematics')), findsOneWidget);
    expect(find.descendant(of: maths, matching: find.text('T1')), findsOneWidget);
    expect(
      find.descendant(
        of: maths,
        matching: find.textContaining('2 of 2 entered · submitted by Ravi Sample'),
      ),
      findsOneWidget,
    );
    // the sheet opens in the app, read only (it is submitted)
    await tester.tap(find.byKey(const Key('vmOpen-e1-300-91')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('vmSheet')), findsOneWidget);
    expect(find.byKey(const Key('mkSheet')), findsOneWidget);
    expect(find.text('Submitted'), findsOneWidget);
    expect(find.byKey(const Key('saveMarksSheet')), findsNothing);
    expect(find.byKey(const Key('mkLockedNote')), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    // send back needs what to correct
    await tester.tap(find.byKey(const Key('vmSendBack-e1-300-92')));
    await tester.pumpAndSettle();
    expect(find.text(s.vmNeedNote), findsOneWidget);
    expect(t.calls.where((c) => c.path.endsWith('/send-back')), isEmpty);
    await tester.enterText(find.byKey(const Key('vmNote-e1-300-92')), 'Check the totals');
    await tester.tap(find.byKey(const Key('vmSendBack-e1-300-92')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e1/entry-status/send-back').body, {
      'classSectionId': '300',
      'subjectId': '92',
      'note': 'Check the totals',
    });
    expect(find.text(s.vmSentBack), findsOneWidget);
    expect(find.byKey(const Key('vm-e1-300-92')), findsNothing);
    // verify
    await tester.tap(find.byKey(const Key('vmVerify-e1-300-91')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e1/entry-status/verify').body, {
      'classSectionId': '300',
      'subjectId': '91',
    });
    expect(find.text(s.vmVerified), findsOneWidget);
    expect(find.byKey(const Key('vmNone')), findsOneWidget);
  });

  // a made-up picked sheet and photo (the phone's pickers cannot run in tests)
  final pickers = <Override>[
    xlsxPickerProvider.overrideWithValue(
      () async => (name: 'sheet.xlsx', bytes: [80, 75, 3, 4, 1, 2]),
    ),
    photoPickerProvider.overrideWithValue(
      (camera) async => (name: 'drawing.png', bytes: [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    ),
  ];

  testWidgets('Indicators and progress card in the app: areas, levels, Excel, words, portfolio', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 4200), overrides: pickers);
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Indicators and progress card'));
    await tester.pumpAndSettle();
    // no web page; the exams that take indicators, the sections the person rates
    expect(find.byKey(const Key('inScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-indicators')), findsNothing);
    expect(find.text('Indicators (IND)'), findsWidgets);
    expect(find.text('VI-A · Progress card'), findsOneWidget);
    // the areas with what is entered (indicators × pupils)
    expect(find.text('Language (1/4)'), findsOneWidget);
    expect(find.text('Numeracy (0/2)'), findsOneWidget);
    expect(find.text('Also entered by: Ravi Sample (E099)'), findsOneWidget);
    // By Excel: one closed line above the pupils (as on Height and weight); opened, its upload while entry is open
    expect(find.byKey(const Key('xlFold')), findsOneWidget);
    expect(find.byKey(const Key('xlUpload')), findsNothing);
    expect(
      tester.getTopLeft(find.byKey(const Key('xlCard'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('inRatings'))).dy),
    );
    await tester.tap(find.byKey(const Key('xlFold')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('xlUpload')), findsOneWidget);
    // a goal's name over its indicators; the level with its words
    final kid = find.byKey(const Key('inPupil-41'));
    expect(find.descendant(of: kid, matching: find.text('Speaking')), findsOneWidget);
    expect(find.descendant(of: kid, matching: find.text('P (Proficient)')), findsOneWidget);
    // a level for Ria, words for Kid; Save sends every box of the area
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('inPupil-42')),
        matching: find.byType(DropdownButtonFormField<String>),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('A (Advanced)').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('inNote-41|i2')), 'Reads well');
    await tester.tap(find.byKey(const Key('inSave')));
    await tester.pumpAndSettle();
    expect(school.indicatorPuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'indicatorId': 'i1', 'grade': 'P'},
        {'studentId': '41', 'indicatorId': 'i2', 'note': 'Reads well'},
        {'studentId': '42', 'indicatorId': 'i1', 'grade': 'A'},
        {'studentId': '42', 'indicatorId': 'i2'},
      ],
    });
    expect(find.text(s.inSaved), findsOneWidget);
    // another area: an indicator with its own levels
    await tester.tap(find.byKey(const Key('inArea-Numeracy')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('inPupil-41')),
        matching: find.byType(DropdownButtonFormField<String>),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Yes'), findsWidgets);
    await tester.tap(find.text('No').last);
    await tester.pumpAndSettle();

    // by Excel: the sheet; an upload checked first (a row with a problem: nothing to save), then saved
    await tester.tap(find.byKey(const Key('xlDownload')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/indicators/excel').query, {
      'classSectionId': '300',
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlUpload')));
    await tester.pumpAndSettle();
    expect(find.text('2 rows read · 1 ready to save · 1 with a problem'), findsOneWidget);
    expect(find.text('Row 3 · A-42 · Ria Sample: Level Z is not on the list'), findsOneWidget);
    expect(find.byKey(const Key('xlSave')), findsNothing);
    final checked = t.calls.lastWhere((c) => c.path == '/exams/e2/indicators/upload').body!;
    expect(checked['apply'], false);
    expect(checked['file'], 'UEsDBAEC');
    await tester.tap(find.byKey(const Key('xlUpload')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlSave')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/indicators/upload').body!['apply'], true);
    expect(find.text('Saved (2).'), findsOneWidget);

    // the progress card: the parent's own words stay; the child's and mine are saved
    expect(find.text('In our words and the portfolio · Kid Sample'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('inWords-parent-41'))).enabled, isFalse);
    expect(find.text(s.inByParent), findsOneWidget);
    await tester.enterText(find.byKey(const Key('inWords-self-41')), 'I like maths');
    await tester.enterText(find.byKey(const Key('inWords-teacher-41')), 'Curious');
    await tester.tap(find.byKey(const Key('inSaveWords')));
    await tester.pumpAndSettle();
    expect(school.wordsPuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'kind': 'self', 'text': 'I like maths'},
        {'studentId': '41', 'kind': 'teacher', 'text': 'Curious'},
      ],
    });
    // the portfolio: remove (asked first), then a photo is asked for, then added with what it shows
    expect(find.text('Science fair'), findsOneWidget);
    await tester.tap(find.byKey(const Key('inPhotoRemove-pf1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('inPhotoRemoveYes')));
    await tester.pumpAndSettle();
    expect(school.photosRemoved, ['pf1']);
    expect(find.byKey(const Key('inNoPhoto')), findsOneWidget);
    await tester.tap(find.byKey(const Key('inAddPhoto')));
    await tester.pumpAndSettle();
    expect(school.photosAdded, isEmpty);
    await tester.tap(find.byKey(const Key('inPickPhoto')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('inPhotoChosen')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('inCaption')), 'Drawing');
    await tester.tap(find.byType(DropdownButtonFormField<String>).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Speaks clearly').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('inAddPhoto')));
    await tester.pumpAndSettle();
    expect(school.photosAdded.single, {
      'classSectionId': '300',
      'studentId': '41',
      'caption': 'Drawing',
      'indicatorId': 'i1',
      'image': {'contentType': 'image/png', 'base64': 'iVBORwECAw=='},
    });
    expect(find.text(s.inAdded), findsOneWidget);

    // a teacher given areas in another section: only theirs, no progress card; a section not rated: not offered
    await tester.tap(find.byKey(const Key('inSection')));
    await tester.pumpAndSettle();
    expect(find.text('VI-C'), findsNothing);
    await tester.tap(find.text('VI-B').last);
    await tester.pumpAndSettle();
    expect(find.text(s.inMappedNote), findsOneWidget);
    expect(find.byKey(const Key('inArea-Numeracy')), findsNothing);
    expect(find.byKey(const Key('inNote-41|i2')), findsNothing);
    expect(find.byKey(const Key('inProgressCard')), findsNothing);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets('Indicators: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})', (
      tester,
    ) async {
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      final handle = tester.ensureSemantics();
      await pumpStaff(tester, hindi: hindi, size: const Size(420, 4200), overrides: pickers);
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

      await tester.tap(find.text(s.classes).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text(s.menu('Indicators and progress card')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('xlFold')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('xlUpload')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inPickPhoto')));
      await check('Indicators');
      handle.dispose();
    });
  }

  testWidgets('Indicators: large text (twice the size) lays out without overflow', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780), overrides: pickers);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Indicators and progress card'));
    await tester.tap(find.text('Indicators and progress card'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Indicators');
    final list = find
        .descendant(of: find.byKey(const Key('inScreen')), matching: find.byType(Scrollable))
        .first;
    for (final k in ['xlFold', 'inSave', 'inSaveWords', 'inAddPhoto']) {
      await tester.scrollUntilVisible(find.byKey(Key(k)), 300, scrollable: list);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: k);
    }
  });

  testWidgets('Remarks in the app: categories, a remark from the list, others, Excel, save', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600), overrides: pickers);
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remarks'));
    await tester.pumpAndSettle();
    // no web page
    expect(find.byKey(const Key('rmScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-remarks')), findsNothing);
    expect(find.text(s.rmIntro), findsOneWidget);
    // By Excel: one closed line above the pupils, as on Height and weight
    expect(find.byKey(const Key('xlFold')), findsOneWidget);
    expect(find.byKey(const Key('xlUpload')), findsNothing);
    expect(
      tester.getTopLeft(find.byKey(const Key('xlCard'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('rmSheet'))).dy),
    );
    // who writes the others
    expect(
      find.text('Written by others here: English remarks (Ravi Sample (E099))'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('rmText-41|k3')), findsNothing);
    // what is written; a remark from the school's list into the free box
    expect(
      tester.widget<TextField>(find.byKey(const Key('rmText-41|k1'))).controller!.text,
      'Works hard',
    );
    await tester.tap(find.byKey(const Key('rmPick-42|k1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('rmBank-G2')));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byKey(const Key('rmText-42|k1'))).controller!.text,
      'Helps others',
    );
    // a list-only category: one of its remarks
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('rmPupil-41')),
        matching: find.byType(DropdownButtonFormField<String>),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Very good').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('rmSave')));
    await tester.pumpAndSettle();
    expect(school.remarkPuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'categoryId': 'k1', 'text': 'Works hard'},
        {'studentId': '41', 'categoryId': 'k2', 'text': 'Very good'},
        {'studentId': '42', 'categoryId': 'k1', 'text': 'Helps others'},
        {'studentId': '42', 'categoryId': 'k2', 'text': ''},
      ],
    });
    expect(find.text(s.inSaved), findsOneWidget);
    // the sheet by Excel, once its line is opened: download, an upload checked then saved
    await tester.tap(find.byKey(const Key('xlFold')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlDownload')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/remark-items/excel').query, {
      'classSectionId': '300',
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlUpload')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlSave')));
    await tester.pumpAndSettle();
    expect(find.text('Saved (1).'), findsOneWidget);
    // a section where the person writes nothing: why
    await tester.tap(find.byKey(const Key('rmSection')));
    await tester.pumpAndSettle();
    expect(find.text('VI-C'), findsNothing);
    await tester.tap(find.text('VI-B').last);
    await tester.pumpAndSettle();
    expect(find.text('Only the class teacher writes these here.'), findsOneWidget);
    expect(find.byKey(const Key('rmSave')), findsNothing);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets('Remarks: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})', (
      tester,
    ) async {
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      final handle = tester.ensureSemantics();
      await pumpStaff(tester, hindi: hindi, size: const Size(420, 2600), overrides: pickers);
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

      await tester.tap(find.text(s.classes).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text(s.menu('Remarks')));
      await check('Remarks');
      await tester.tap(find.byKey(const Key('rmPick-42|k1')));
      await check('The school’s remarks');
      handle.dispose();
    });
  }

  testWidgets('Remarks: large text (twice the size) lays out without overflow', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780), overrides: pickers);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Remarks'));
    await tester.tap(find.text('Remarks'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Remarks');
    final list = find
        .descendant(of: find.byKey(const Key('rmScreen')), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byKey(const Key('rmSave')), 300, scrollable: list);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Remarks, scrolled');
  });

  testWidgets('Height and weight in the app: last reading, what changed is saved, Excel first', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600), overrides: pickers);
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Height and weight'));
    await tester.pumpAndSettle();
    // no web page; only the class teacher's sections
    expect(find.byKey(const Key('hwScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-health')), findsNothing);
    expect(find.text('VI-A · 1 of 2 entered'), findsOneWidget);
    // By Excel: one closed line above the pupils; opened, its download and upload
    expect(find.byKey(const Key('xlFold')), findsOneWidget);
    expect(find.byKey(const Key('xlUpload')), findsNothing);
    expect(
      tester.getTopLeft(find.byKey(const Key('xlCard'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('hwSheet'))).dy),
    );
    // the last reading beside this one
    expect(
      find.text('Last reading: 116 cm · 21 kg · BMI 15.6 (Term 1, 10 Apr 2026)'),
      findsOneWidget,
    );
    expect(find.text('Last reading: —'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('hwHeight-41'))).controller!.text, '120');
    expect(tester.widget<TextField>(find.byKey(const Key('hwWeight-41'))).controller!.text, '22.5');
    expect(find.text('BMI 15.6'), findsOneWidget);
    // nothing changed: nothing sent
    await tester.tap(find.byKey(const Key('hwSave')));
    await tester.pumpAndSettle();
    expect(find.text(s.hwNothing), findsOneWidget);
    expect(school.healthPuts, isEmpty);
    // out of range is refused first
    await tester.enterText(find.byKey(const Key('hwHeight-42')), '300');
    await tester.tap(find.byKey(const Key('hwSave')));
    await tester.pumpAndSettle();
    expect(find.text('Ria Sample: ${s.hwRange}'), findsOneWidget);
    // Ria's readings and blood group; Kid's weight emptied (it is cleared)
    await tester.enterText(find.byKey(const Key('hwHeight-42')), '118');
    await tester.enterText(find.byKey(const Key('hwWeight-42')), '20');
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('hwPupil-42')),
        matching: find.byType(DropdownButtonFormField<String>),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('O+').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('hwWeight-41')), '');
    await tester.tap(find.byKey(const Key('hwSave')));
    await tester.pumpAndSettle();
    expect(school.healthPuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'weightKg': null},
        {'studentId': '42', 'heightCm': 118, 'weightKg': 20, 'bloodGroup': 'O+'},
      ],
    });
    expect((school.healthPuts.single['rows'] as List).first, containsPair('weightKg', null));
    expect(find.text('Saved (2).'), findsOneWidget);
    // the sheet by Excel, once its line is opened
    await tester.tap(find.byKey(const Key('xlFold')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('xlUpload')), findsOneWidget);
    await tester.tap(find.byKey(const Key('xlDownload')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/health/excel').query, {
      'classSectionId': '300',
    });
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Height and weight: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi, size: const Size(420, 2600), overrides: pickers);
        final s = S(hindi);
        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Height and weight')));
        await tester.pumpAndSettle();
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(
            tester,
            meetsGuideline(g),
            reason: 'Height and weight: ${g.description}',
          );
        }
        handle.dispose();
      },
    );
  }

  testWidgets('Height and weight: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780), overrides: pickers);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Height and weight'));
    await tester.tap(find.text('Height and weight'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Height and weight');
    final list = find
        .descendant(of: find.byKey(const Key('hwScreen')), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byKey(const Key('hwSave')), 300, scrollable: list);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Height and weight, scrolled');
  });

  testWidgets('Subject choices in the app: groups, other subjects, stream, Opt; saved; last year', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600));
    final s = S(false);
    Finder keyed(String start) => find.byWidgetPredicate(
      (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith(start),
    );
    Future<void> pick(String key, String text) async {
      await tester.tap(keyed(key));
      await tester.pumpAndSettle();
      await tester.tap(find.text(text).last);
      await tester.pumpAndSettle();
    }

    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Subject choices'));
    await tester.pumpAndSettle();
    // no web page; the sections set or seen (not one neither)
    expect(find.byKey(const Key('scScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-subject-choices')), findsNothing);
    expect(find.text('VI-A (2)'), findsWidgets);
    expect(find.text(s.scEveryone('ENG · MAT')), findsOneWidget);
    expect(find.text('A-42 · ${s.scNotSet}'), findsOneWidget);
    // a subject with marks stays: Kid's second language cannot change
    final kidLanguage = tester.widget<DropdownButtonFormField<String>>(keyed('scGroup-41-g1'));
    expect(kidLanguage.onChanged, isNull);
    expect(find.text('Hindi (HIN)'), findsOneWidget);
    // Ria: a second language, a skill, Art, a stream, Art as her additional subject
    await pick('scGroup-42-g1', 'Sanskrit (SKT)');
    await tester.tap(find.byKey(const Key('scTick-42-s5')));
    await tester.tap(find.byKey(const Key('scTick-42-s7')));
    await tester.pumpAndSettle();
    await pick('scStream-42', 'Arts');
    await pick('scOpt-42', 'Art (ART)');
    // Kid moves from Science to Arts: Science's Physics goes, the marked Hindi stays
    await pick('scStream-41', 'Arts');
    await tester.tap(find.byKey(const Key('scSave')));
    await tester.pumpAndSettle();
    expect(school.choicePuts.single, {
      'classSectionId': '300',
      'rows': [
        {
          'studentId': '41',
          'stream': 'Arts',
          'subjects': [
            {'subjectId': 's3', 'additional': false},
            {'subjectId': 's7', 'additional': true},
          ],
        },
        {
          'studentId': '42',
          'stream': 'Arts',
          'subjects': [
            {'subjectId': 's4', 'additional': false},
            {'subjectId': 's5', 'additional': false},
            {'subjectId': 's7', 'additional': true},
          ],
        },
      ],
    });
    expect(find.text(s.inSaved), findsOneWidget);
    // last year's choices for those without
    await tester.tap(find.byKey(const Key('scLastYear')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/subject-choices/last-year').body, {
      'classSectionId': '300',
    });
    expect(find.text(s.scCopied(1)), findsOneWidget);
    // a section the person teaches but does not set: to see only
    await tester.tap(find.byKey(const Key('scSection')));
    await tester.pumpAndSettle();
    expect(find.text('VI-C (2)'), findsNothing);
    await tester.tap(find.text('VI-B (2)').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('scViewOnly')), findsOneWidget);
    expect(find.byKey(const Key('scSave')), findsNothing);
    expect(find.byKey(const Key('scLastYear')), findsNothing);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Subject choices: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi, size: const Size(420, 2600));
        final s = S(hindi);
        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Subject choices')));
        await tester.pumpAndSettle();
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g), reason: 'Subject choices: ${g.description}');
        }
        handle.dispose();
      },
    );
  }

  testWidgets('Subject choices: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Subject choices'));
    await tester.tap(find.text('Subject choices'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Subject choices');
    final list = find
        .descendant(of: find.byKey(const Key('scScreen')), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byKey(const Key('scLastYear')), 300, scrollable: list);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Subject choices, scrolled');
  });

  testWidgets('Exam date sheet in the app: the coming exam, a row a date, a column a class', (
    tester,
  ) async {
    final (t, _) = await pumpStaff(tester, size: const Size(420, 2000));
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Exam date sheet'));
    await tester.pumpAndSettle();
    // no web page; the coming exam first
    expect(find.byKey(const Key('dsScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-date-sheet')), findsNothing);
    expect(t.calls.any((c) => c.path == '/exams/date-sheets'), isTrue);
    expect(find.text('Term 2'), findsWidgets);
    // a row a date (two papers on day 3 share its row)
    expect(find.text(s.date(day(3))), findsOneWidget);
    expect(find.text(s.date(day(5))), findsOneWidget);
    // the classes as columns; each paper with its time; the day under the date
    expect(find.text('VI'), findsOneWidget);
    expect(find.text('VII'), findsOneWidget);
    expect(find.text('Mathematics'), findsOneWidget);
    expect(find.text('09:00–12:00'), findsOneWidget);
    expect(find.text('Science'), findsOneWidget);
    expect(find.text('09:00'), findsOneWidget);
    expect(find.text('Hindi'), findsOneWidget);
    expect(find.text(s.dsDayLong(DateTime.parse(day(3)).weekday)), findsOneWidget);
    // another exam, with its note
    await tester.tap(find.byKey(const Key('dsExam')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Term 1').last);
    await tester.pumpAndSettle();
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Reporting time 8:30.'), findsOneWidget);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Exam date sheet: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi, size: const Size(420, 2000));
        final s = S(hindi);
        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Exam date sheet')));
        await tester.pumpAndSettle();
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g), reason: 'Exam date sheet: ${g.description}');
        }
        handle.dispose();
      },
    );
  }

  testWidgets('Exam date sheet: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Exam date sheet'));
    await tester.tap(find.text('Exam date sheet'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Exam date sheet');
  });

  testWidgets('Marks by Excel in the app: a closed line; the sheet; an upload checked then saved', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600), overrides: pickers);
    await tester.tap(find.byKey(const Key('figToEnter')));
    await tester.pumpAndSettle();
    // one closed line above the sheet
    expect(find.byKey(const Key('xlFold')), findsOneWidget);
    expect(find.byKey(const Key('xlUpload')), findsNothing);
    expect(
      tester.getTopLeft(find.byKey(const Key('xlCard'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('mkSheet'))).dy),
    );
    await tester.tap(find.byKey(const Key('xlFold')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlDownload')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e1/marks/excel').query, {
      'classSectionId': '300',
      'subjectId': '91',
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlUpload')));
    await tester.pumpAndSettle();
    expect(find.text('2 rows read · 2 ready to save'), findsOneWidget);
    final checked = t.calls.lastWhere((c) => c.path == '/exams/e1/marks/upload').body!;
    expect(checked, {
      'classSectionId': '300',
      'subjectId': '91',
      'file': 'UEsDBAEC',
      'apply': false,
    });
    await tester.tap(find.byKey(const Key('xlSave')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e1/marks/upload').body!['apply'], true);
    expect(find.text('Saved (2).'), findsOneWidget);
    expect(school.marksSheetChecks, 2);
  });

  testWidgets('Exam attendance in the app: days present of total, saved; counted from daily', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600));
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Exam attendance'));
    await tester.pumpAndSettle();
    // no web page
    expect(find.byKey(const Key('eaScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-exam-register')), findsNothing);
    expect(find.text(s.eaOf('VI-A')), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('eaPresent-41'))).controller!.text, '40');
    expect(tester.widget<TextField>(find.byKey(const Key('eaTotal-41'))).controller!.text, '45');
    // more days present than the total is refused first
    await tester.enterText(find.byKey(const Key('eaPresent-42')), '50');
    await tester.enterText(find.byKey(const Key('eaTotal-42')), '45');
    await tester.tap(find.byKey(const Key('eaSave')));
    await tester.pumpAndSettle();
    expect(find.text(s.eaOver('Ria Sample')), findsOneWidget);
    expect(school.attendancePuts, isEmpty);
    await tester.enterText(find.byKey(const Key('eaPresent-42')), '43');
    await tester.tap(find.byKey(const Key('eaSave')));
    await tester.pumpAndSettle();
    expect(school.attendancePuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'daysPresent': 40, 'daysTotal': 45},
        {'studentId': '42', 'daysPresent': 43, 'daysTotal': 45},
      ],
    });
    expect(find.text(s.eaSaved(2)), findsOneWidget);
    // counted from daily attendance, replacing what is entered
    await tester.tap(find.byKey(const Key('eaOverwrite')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('eaCount')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/attendance/from-daily').body, {
      'classSectionId': '300',
      'overwrite': true,
    });
    expect(find.text(s.eaCounted(1, '1 Apr 2026', '20 Oct 2026', 1)), findsOneWidget);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Exam attendance: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi, size: const Size(420, 2600));
        final s = S(hindi);
        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Exam attendance')));
        await tester.pumpAndSettle();
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g), reason: 'Exam attendance: ${g.description}');
        }
        handle.dispose();
      },
    );
  }

  testWidgets('Exam attendance: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Exam attendance'));
    await tester.tap(find.text('Exam attendance'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Exam attendance');
    final list = find
        .descendant(of: find.byKey(const Key('eaScreen')), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byKey(const Key('eaCount')), 300, scrollable: list);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Exam attendance, scrolled');
  });

  testWidgets('Exam register in the app: remarks, took part, attendance, health; By Excel closed', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 3200), overrides: pickers);
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Exam register'));
    await tester.pumpAndSettle();
    // no web page; the whole register
    expect(find.byKey(const Key('erScreen')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-exam-register')), findsNothing);
    expect(find.text(s.erTitle('VI-A')), findsOneWidget);
    expect(find.text('A-41 · ${s.erLastHealth('20 Nov 2026', '15.6')}'), findsOneWidget);
    // By Excel: one closed line above the register
    expect(find.byKey(const Key('xlFold')), findsOneWidget);
    expect(find.byKey(const Key('xlUpload')), findsNothing);
    expect(
      tester.getTopLeft(find.byKey(const Key('xlCard'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('eaSheet'))).dy),
    );
    // remarks: Kid's as entered; Ria's from the school's list, what she took part in
    expect(
      tester.widget<TextField>(find.byKey(const Key('erRemark-41'))).controller!.text,
      'Neat work',
    );
    await tester.tap(find.byKey(const Key('erPick-42')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('erBank-R1')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('erPart-42')), 'Quiz club');
    await tester.tap(find.byKey(const Key('erSaveRemarks')));
    await tester.pumpAndSettle();
    expect(school.registerRemarkPuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'remark': 'Neat work', 'participation': null, 'promotedTo': null},
        {
          'studentId': '42',
          'remark': 'Good effort',
          'participation': 'Quiz club',
          'promotedTo': null,
        },
      ],
    });
    expect(find.text(s.erRemarksSaved(2)), findsOneWidget);
    // height and weight: the boxes filled from the last reading; Ria's height
    expect(tester.widget<TextField>(find.byKey(const Key('erHeight-41'))).controller!.text, '120');
    await tester.enterText(find.byKey(const Key('erHeight-42')), '118');
    await tester.tap(find.byKey(const Key('erSaveHealth')));
    await tester.pumpAndSettle();
    expect(school.healthPuts.single, {
      'classSectionId': '300',
      'rows': [
        {'studentId': '41', 'heightCm': 120, 'weightKg': 22.5, 'bloodGroup': 'B+'},
        {'studentId': '42', 'heightCm': 118, 'weightKg': null, 'bloodGroup': null},
      ],
    });
    expect(find.text(s.erHealthSaved(2)), findsOneWidget);
    // the register by Excel, once its line is opened
    await tester.tap(find.byKey(const Key('xlFold')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlDownload')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/register/excel').query, {
      'classSectionId': '300',
    });
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('xlUpload')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.path == '/exams/e2/register/upload').body!['apply'], false);
    await tester.tap(find.byKey(const Key('xlSave')));
    await tester.pumpAndSettle();
    expect(find.text('Saved (1).'), findsOneWidget);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Exam register: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi, size: const Size(420, 3200), overrides: pickers);
        final s = S(hindi);
        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Exam register')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('xlFold')));
        await tester.pumpAndSettle();
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g), reason: 'Exam register: ${g.description}');
        }
        handle.dispose();
      },
    );
  }

  testWidgets('Exam register: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780), overrides: pickers);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Exam register'));
    await tester.tap(find.text('Exam register'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Exam register');
    final list = find
        .descendant(of: find.byKey(const Key('erScreen')), matching: find.byType(Scrollable))
        .first;
    for (final k in ['erSaveRemarks', 'erSaveHealth', 'eaCount']) {
      await tester.scrollUntilVisible(find.byKey(Key(k)), 300, scrollable: list);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: k);
    }
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Verify marks: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(
          tester,
          hindi: hindi,
          size: const Size(420, 2600),
          with_: School()..marksStage = 'submitted',
        );
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

        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Verify marks')));
        await check('Verify marks');
        await tester.tap(find.byKey(const Key('vmOpen-e1-300-91')));
        await check('The sheet');
        handle.dispose();
      },
    );
  }

  testWidgets('Verify marks: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Verify marks'));
    await tester.tap(find.text('Verify marks'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Verify marks');
    await tester.scrollUntilVisible(
      find.byKey(const Key('vmSendBack-e1-300-92')),
      200,
      scrollable: find
          .descendant(of: find.byKey(const Key('vmList')), matching: find.byType(Scrollable))
          .first,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Verify marks, scrolled');
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets('Marks: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})', (
      tester,
    ) async {
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      final handle = tester.ensureSemantics();
      await pumpStaff(tester, hindi: hindi, size: const Size(420, 2600));
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

      await tester.tap(find.byKey(const Key('figToEnter')));
      await check('Marks');
      await tester.tap(find.byKey(const Key('mkPick')));
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('Theory (60)').last);
      await check('A part');
      handle.dispose();
    });
  }

  testWidgets('Marks: large text (twice the size) lays out without overflow', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    await scrollTo(tester, find.byKey(const Key('figToEnter')));
    await tester.tap(find.byKey(const Key('figToEnter')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Marks');
    final list = find
        .descendant(of: find.byKey(const Key('marksScreen')), matching: find.byType(Scrollable))
        .first;
    await tester.scrollUntilVisible(find.byKey(const Key('saveMarksSheet')), 200, scrollable: list);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Marks, the sheet');
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

  testWidgets(
    'Lesson plans in the app: upload, the report and its filters, review and acknowledge, delete, PDF',
    (tester) async {
      final (t, school) = await pumpStaff(tester, size: const Size(420, 2400));
      final s = S(false);
      await tester.tap(find.text('Classes').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Lesson plans'));
      await tester.pumpAndSettle();
      // no web page: the app's own screen, Upload Lesson first
      expect(find.byKey(const Key('lpUpload')), findsOneWidget);
      expect(find.byKey(const Key('openWeb-lesson-plans')), findsNothing);
      // a teacher without the set-up right: no Approvers tab
      expect(
        find.descendant(of: find.byKey(const Key('lpTabs')), matching: find.text(s.lpApproversTab)),
        findsNothing,
      );
      // nothing ticked: Submit waits, the hint says why
      expect(tester.widget<FilledButton>(find.byKey(const Key('lpSubmit'))).onPressed, isNull);
      expect(find.byKey(const Key('lpTickHint')), findsOneWidget);
      // master class shows the classes; class section the sections (the ticks start again)
      expect(find.byKey(const Key('lpPick-60')), findsOneWidget);
      await tester.tap(find.byKey(const Key('lpPick-60')));
      await tester.tap(find.byKey(const Key('lpType-section')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('lpPick-60')), findsNothing);
      expect(tester.widget<FilledButton>(find.byKey(const Key('lpSubmit'))).onPressed, isNull);
      await tester.tap(find.byKey(const Key('lpPick-301')));
      await tester.pumpAndSettle();
      // a topic is asked for
      await tester.tap(find.byKey(const Key('lpSubmit')));
      await tester.pumpAndSettle();
      expect(find.text(s.lpNeedTopic), findsOneWidget);
      await tester.enterText(find.byKey(const Key('lpTopic')), 'Unit test lesson');
      await tester.enterText(
        find.byKey(const Key('lpDescription')),
        'Read page 4\n\nDraw <one> cell',
      );
      await tester.tap(find.byKey(const Key('lpSubmit')));
      await tester.pumpAndSettle();
      final sent = school.lessonUploaded!;
      expect(sent['targetType'], 'section');
      expect(sent['sectionIds'], ['301']);
      expect(sent['classIds'], isEmpty);
      expect(sent['topic'], 'Unit test lesson');
      expect(sent['date'], ymd(DateTime.now()));
      expect(sent['description'], '<p>Read page 4</p><p>Draw &lt;one&gt; cell</p>');
      // as the website: the lesson opens, saying it went for approval
      expect(find.text(s.lpUploaded), findsOneWidget);
      expect(find.text('Unit test lesson'), findsWidgets);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // the form is empty again
      expect(find.text('Unit test lesson'), findsNothing);

      // Lesson Report: the counts and the lessons with where each waits
      await tester.tap(
        find.descendant(of: find.byKey(const Key('lpTabs')), matching: find.text(s.lpReportTab)),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('lpRow-9')), findsOneWidget);
      expect(find.byKey(const Key('lpRow-12')), findsOneWidget);
      expect(find.text('Level 1 of 2 pending · Asha Teacher'), findsNWidgets(2));
      expect(find.text('Class: VI · 20 Nov 2026 · 1 attachment'), findsOneWidget);
      // the lesson waiting for me says Review; mine says View
      expect(
        find.descendant(of: find.byKey(const Key('lpOpen-9')), matching: find.text('Review')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('lpOpen-12')), matching: find.text('View')),
        findsOneWidget,
      );
      // a count shows its lessons
      await tester.tap(find.byKey(const Key('lpTile-pending')));
      await tester.pumpAndSettle();
      expect(
        t.calls.lastWhere((c) => c.path == '/academics/lessons').query,
        containsPair('status', 'pending'),
      );
      // the filters: Search applies them, Reset clears them
      await tester.tap(find.byKey(const Key('lpFilters')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('lpKeyword')), 'E015');
      await tester.tap(find.byKey(const Key('lpSearch')));
      await tester.pumpAndSettle();
      final q = t.calls.lastWhere((c) => c.path == '/academics/lessons').query!;
      expect(q['by'], 'employee_code');
      expect(q['q'], 'E015');
      expect(q['status'], 'pending');
      expect(q['record'], 'active');
      await tester.tap(find.byKey(const Key('lpReset')));
      await tester.pumpAndSettle();
      expect(
        t.calls.lastWhere((c) => c.path == '/academics/lessons').query!.containsKey('q'),
        isFalse,
      );

      // the lesson waiting for me: reject wants a remark; acknowledge moves it on
      await tester.tap(find.byKey(const Key('lpOpen-9')));
      await tester.pumpAndSettle();
      expect(find.text(s.lpRule('class')), findsOneWidget);
      expect(find.text('Principal (anyone with this role)'), findsOneWidget);
      expect(find.text(s.lpWaiting), findsOneWidget);
      expect(find.text(s.lpNotReached), findsOneWidget);
      await tester.tap(find.byKey(const Key('lpReject')));
      await tester.pumpAndSettle();
      expect(find.text(s.lpNeedRemark), findsOneWidget);
      expect(t.calls.where((c) => c.path == '/academics/lessons/9/decide'), isEmpty);
      await tester.enterText(find.byKey(const Key('lpRemark')), 'Fine');
      await tester.tap(find.byKey(const Key('lpAcknowledge')));
      await tester.pumpAndSettle();
      expect(t.calls.lastWhere((c) => c.path == '/academics/lessons/9/decide').body, {
        'action': 'acknowledge',
        'remark': 'Fine',
      });
      expect(find.text(s.lpAcknowledgedDone), findsOneWidget);
      // now level 2 waits; not for me
      expect(find.text('Level 2 of 2 pending · Principal'), findsOneWidget);
      expect(find.byKey(const Key('lpAcknowledge')), findsNothing);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      // my own lesson nobody acted on: its description and file, and Delete (asked first)
      await tester.tap(find.byKey(const Key('lpOpen-12')));
      await tester.pumpAndSettle();
      expect(find.text('Read the chapter.\nDraw a leaf.'), findsOneWidget);
      expect(find.text('Attachment 1'), findsOneWidget);
      expect(find.byKey(const Key('lpAcknowledge')), findsNothing);
      await tester.tap(find.byKey(const Key('lpDelete')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('lpDeleteYes')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.method == 'DELETE' && c.path == '/academics/lessons/12'), isTrue);
      expect(find.text(s.lpDeletedDone), findsOneWidget);
      expect(find.byKey(const Key('lpRow-12')), findsNothing);

      // the report as a PDF: the list's own answer with the filters (format, wrap)
      await tester.tap(find.byKey(const Key('lpPdf')));
      await tester.pumpAndSettle();
      final f = t.calls.lastWhere((c) => c.path == '/academics/lessons').query!;
      expect(f['format'], 'pdf');
      expect(f['wrap'], '1');
      expect(find.text(s.lpReportFile), findsWidgets);
    },
  );

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'Lesson plans: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(
          tester,
          hindi: hindi,
          size: const Size(420, 2400),
          with_: School(lessonSetup: true),
        );
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

        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('Lesson plans')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('lpPick-60')));
        await check('Upload Lesson');
        await tester.tap(
          find.descendant(of: find.byKey(const Key('lpTabs')), matching: find.text(s.lpReportTab)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('lpFilters')));
        await check('Lesson Report');
        await tester.tap(find.byKey(const Key('lpOpen-9')));
        await check('A lesson');
        await tester.tap(find.byType(BackButton));
        await tester.pumpAndSettle();
        await tester.tap(
          find.descendant(
            of: find.byKey(const Key('lpTabs')),
            matching: find.text(s.lpApproversTab),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('lpScope-employee')));
        await check('Approvers');
        handle.dispose();
      },
    );
  }

  testWidgets('Lesson plans: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780), with_: School(lessonSetup: true));
    // down the screen's own list (the tab pages slide sideways)
    Future<void> down(String list, Finder f) async {
      if (f.evaluate().isEmpty) {
        await tester.scrollUntilVisible(
          f,
          200,
          scrollable: find
              .descendant(of: find.byKey(Key(list)), matching: find.byType(Scrollable))
              .first,
        );
      }
      await tester.ensureVisible(f);
      await tester.pumpAndSettle();
    }

    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Lesson plans'));
    await tester.tap(find.text('Lesson plans'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Upload Lesson');
    await tester.tap(find.byKey(const Key('lpType-section')));
    await tester.pumpAndSettle();
    await down('lpUpload', find.byKey(const Key('lpSubmit')));
    expect(tester.takeException(), isNull, reason: 'Upload Lesson, scrolled');
    await tester.tap(find.text('Lesson Report'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Lesson Report');
    await tester.tap(find.byKey(const Key('lpFilters')));
    await tester.pumpAndSettle();
    await down('lpReport', find.byKey(const Key('lpSearch')));
    expect(tester.takeException(), isNull, reason: 'the filters');
    await down('lpReport', find.byKey(const Key('lpOpen-9')));
    expect(tester.takeException(), isNull, reason: 'the lessons');
    await tester.tap(find.byKey(const Key('lpOpen-9')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'A lesson');
    await down('lpDetail', find.byKey(const Key('lpReject')));
    expect(tester.takeException(), isNull, reason: 'A lesson, scrolled');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Approvers'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'Approvers');
    await down('lpApprovers', find.byKey(const Key('lpScope-employee')));
    await tester.tap(find.byKey(const Key('lpScope-employee')));
    await tester.pumpAndSettle();
    await down('lpApprovers', find.byKey(const Key('lpSaveRule')));
    expect(tester.takeException(), isNull, reason: 'Approvers, the form');
  });

  testWidgets('Lesson approvers in the app (the set-up right): the rules, add a rule, remove one', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(
      tester,
      size: const Size(420, 2600),
      with_: School(lessonSetup: true),
    );
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lesson plans'));
    await tester.pumpAndSettle();
    // the third tab, as the admin app's Approvers; no web page
    await tester.tap(
      find.descendant(of: find.byKey(const Key('lpTabs')), matching: find.text(s.lpApproversTab)),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('lpApprovers')), findsOneWidget);
    // the rule there is: the school default, its levels
    final r1 = find.byKey(const Key('lpRule-r1'));
    Finder inRule(Finder rule, String text) => find.descendant(of: rule, matching: find.text(text));
    expect(inRule(r1, 'School default'), findsOneWidget);
    expect(inRule(r1, 'Everyone else (school default)'), findsOneWidget);
    expect(inRule(r1, 'Level 1: Academic Coordinator'), findsOneWidget);
    expect(inRule(r1, 'Level 2: Asha Teacher'), findsOneWidget);
    expect(inRule(r1, 'Level 3: –'), findsOneWidget);
    // level 1 is asked for; a class rule asks for the class
    await tester.tap(find.byKey(const Key('lpSaveRule')));
    await tester.pumpAndSettle();
    expect(find.text(s.lpChooseLevel1), findsOneWidget);
    await tester.tap(find.byKey(const Key('lpScope-class')));
    await tester.pumpAndSettle();
    // only the box the rule is for
    expect(find.byKey(const Key('lpRuleClass')), findsOneWidget);
    expect(find.byKey(const Key('lpRuleEmployee')), findsNothing);
    await tester.tap(find.byKey(const Key('lpSaveRule')));
    await tester.pumpAndSettle();
    expect(find.text(s.lpChooseClass), findsOneWidget);
    expect(
      t.calls.where((c) => c.method == 'POST' && c.path == '/academics/lessons/approvers'),
      isEmpty,
    );
    // the class, then level 1 a role, level 2 a person found by typing
    await tester.tap(find.byKey(const Key('lpRuleClass')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('VI').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('lpRuleLevel-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Role: Principal').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('lpRuleLevel-2')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(of: find.byKey(const Key('lpRuleLevel-2')), matching: find.byType(TextField)),
      'Ravi',
    );
    await tester.pumpAndSettle();
    expect(find.text('Asha Teacher (E015)'), findsNothing);
    await tester.tap(find.text('Ravi Sample (E099)').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('lpSaveRule')));
    await tester.pumpAndSettle();
    expect(school.ruleSaved, {
      'scope': 'class',
      'classId': '60',
      'levels': [
        {'kind': 'role', 'roleCode': 'principal'},
        {'kind': 'employee', 'employeeId': '99'},
      ],
    });
    expect(find.text(s.lpRuleSaved), findsOneWidget);
    // the list again, with the new rule; the form empty
    expect(find.byKey(const Key('lpRule-r2')), findsOneWidget);
    expect(find.byKey(const Key('lpRuleClass')), findsNothing);
    // remove (asked first)
    await tester.tap(find.byKey(const Key('lpRuleRemove-r1')));
    await tester.pumpAndSettle();
    expect(find.text(s.lpRemoveRuleAsk('Everyone else (school default)')), findsOneWidget);
    await tester.tap(find.byKey(const Key('lpRuleRemoveYes')));
    await tester.pumpAndSettle();
    expect(
      t.calls.any((c) => c.method == 'DELETE' && c.path == '/academics/lessons/approvers/r1'),
      isTrue,
    );
    expect(find.text(s.lpRuleRemoved), findsOneWidget);
    expect(find.byKey(const Key('lpRule-r1')), findsNothing);
  });

  testWidgets('My syllabus in the app: my classes and subjects, a subject’s topics, marking', (
    tester,
  ) async {
    final (t, school) = await pumpStaff(tester, size: const Size(420, 2600));
    final s = S(false);
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('My syllabus'));
    await tester.pumpAndSettle();
    // no web page: the app's own list
    expect(find.byKey(const Key('syList')), findsOneWidget);
    expect(find.byKey(const Key('openWeb-syllabus')), findsNothing);
    final a = find.byKey(const Key('syRow-300-5'));
    Finder inA(String text) => find.descendant(of: a, matching: find.text(text));
    expect(inA('Science'), findsOneWidget);
    expect(inA('2 behind'), findsOneWidget);
    expect(inA('1 of 4 topics done (+1 partly) · 25% covered'), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('syRow-301-5')), matching: find.text('On track')),
      findsOneWidget,
    );
    // a subject opens in the app, not a web page
    await tester.tap(find.byKey(const Key('syOpen-300-5')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('sySubject')), findsOneWidget);
    expect(find.text('VI-A · Science'), findsWidgets);
    expect(find.text('25% covered: 1 of 4 topics done · 2 behind the plan'), findsOneWidget);
    expect(t.calls.lastWhere((c) => c.path == '/academics/syllabus/tree').query, {
      'classId': '60',
      'subjectId': '5',
      'classSectionId': '300',
    });
    expect(find.text('Chapter 1: Food'), findsOneWidget);
    expect(find.text('Term 1 · planned Jul'), findsOneWidget);
    expect(find.text('1.1 Sources of food'), findsOneWidget);
    expect(find.text('Done · 10 Jul 2026'), findsOneWidget);
    expect(find.text('Pending'), findsOneWidget);
    expect(find.text(s.syNoTopic), findsOneWidget);
    // Not done needs a remark
    await tester.tap(find.byKey(const Key('syMark-not_done-t2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('syError-t2')), findsOneWidget);
    expect(school.topicsMarked, isEmpty);
    // partly done today, with a remark
    await tester.enterText(find.byKey(const Key('syRemark-t2')), 'Half the class did it');
    await tester.tap(find.byKey(const Key('syMark-partial-t2')));
    await tester.pumpAndSettle();
    expect(school.topicsMarked.single, {
      'classSectionId': '300',
      'topicId': 't2',
      'status': 'partial',
      'doneOn': ymd(schoolToday()),
      'reason': 'Half the class did it',
    });
    expect(find.text(s.saved), findsOneWidget);
    // the topic and the coverage read again
    expect(find.text('Partly done'), findsOneWidget);
    expect(t.calls.where((c) => c.path == '/academics/syllabus/tree').length, greaterThan(1));
    // done: the day it was taught goes with it
    await tester.tap(find.byKey(const Key('syMark-done-t2')));
    await tester.pumpAndSettle();
    expect(school.topicsMarked.last['status'], 'done');
    expect(find.text('25% covered: 2 of 4 topics done · 2 behind the plan'), findsOneWidget);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'My syllabus: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        await pumpStaff(tester, hindi: hindi, size: const Size(420, 2600));
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

        await tester.tap(find.text(s.classes).last);
        await tester.pumpAndSettle();
        await tester.tap(find.text(s.menu('My syllabus')));
        await check('My syllabus');
        await tester.tap(find.byKey(const Key('syOpen-300-5')));
        await check('A subject');
        handle.dispose();
      },
    );
  }

  testWidgets('My syllabus: large text (twice the size) lays out without overflow', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpStaff(tester, size: const Size(360, 780));
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('My syllabus'));
    await tester.tap(find.text('My syllabus'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'My syllabus');
    await scrollTo(tester, find.byKey(const Key('syOpen-300-5')));
    await tester.tap(find.byKey(const Key('syOpen-300-5')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'A subject');
    await tester.scrollUntilVisible(
      find.byKey(const Key('syMark-not_done-t2')),
      200,
      scrollable: find
          .descendant(of: find.byKey(const Key('sySubject')), matching: find.byType(Scrollable))
          .first,
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'A subject, scrolled');
  });

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

  testWidgets(
    'marking a class as on the website: saved counts, the window, details, a gate pass, a remark',
    (tester) async {
      final (t, _) = await pumpStaff(
        tester,
        size: const Size(420, 2400),
        with_: School(register: 'open'),
      );
      await tester.tap(find.byKey(const Key('toMark-300')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          '1 present · 0 absent · 1 leave · 0 late · Marked by Asha Teacher (RFID gate) (late)',
        ),
        findsOneWidget,
      );
      expect(find.text('An earlier day: saved as marked late.'), findsOneWidget);
      expect(find.textContaining('A-41 · in '), findsOneWidget);
      expect(find.text('Gate pass: leaves early 12:30'), findsOneWidget);
      // the remark already there, changed, and sent with the marks
      await tester.enterText(find.byKey(const Key('remarkBox-41')), 'Fever, sent home');
      await tester.tap(find.byKey(const Key('saveMarks')));
      await tester.pumpAndSettle();
      final sent = t.calls.lastWhere((c) => c.path == '/attendance/sessions');
      expect((sent.body!['marks'] as List).first, {
        'studentId': '41',
        'code': 'P',
        'remarks': 'Fever, sent home',
      });
      // the month's register of the day register
      await tester.tap(find.byKey(const Key('register-pdf')));
      await tester.pumpAndSettle();
      final file = t.calls.lastWhere((c) => c.path == '/attendance/desk/class-register.pdf');
      expect(file.query, containsPair('classSectionId', '300'));
    },
  );

  testWidgets('a register outside the marking window: read only, as the website says', (
    tester,
  ) async {
    await pumpStaff(
      tester,
      size: const Size(420, 2400),
      with_: School(register: 'closed'),
    );
    await tester.tap(find.byKey(const Key('toMark-300')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('saveMarks')), findsNothing);
    expect(find.byKey(const Key('allPresent')), findsNothing);
    expect(
      find.text(
        'Marking is closed for this day; the coordinator can mark it or reopen it for you.',
      ),
      findsOneWidget,
    );
    expect(find.text('Remark: Fever'), findsOneWidget);
  });

  testWidgets('My timetable as on the website: sections, substitutions, the week grid, a day', (
    tester,
  ) async {
    await pumpStaff(tester, size: const Size(420, 2400));
    await tester.tap(find.text('Classes').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('My timetable'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ttToday')), findsOneWidget);
    // My sections: the role and what the person can do
    expect(find.byKey(const Key('ttSection-a1')), findsOneWidget);
    expect(find.text('Class teacher'), findsOneWidget);
    expect(find.text('Subject teacher'), findsOneWidget);
    expect(find.text('Science · Can: attendance'), findsOneWidget);
    // substitutions this week
    expect(find.text('Asha Teacher covers for Ravi Teacher (On leave)'), findsOneWidget);
    // the week grid: Monday to Saturday, the lesson, the break, the free period
    final week = find.byKey(const Key('ttWeek'));
    expect(week, findsOneWidget);
    expect(find.descendant(of: week, matching: find.text('VI-A')), findsNWidgets(6));
    expect(find.descendant(of: week, matching: find.text('Break')), findsNWidgets(6));
    expect(find.descendant(of: week, matching: find.text('free')), findsNWidgets(6));
    // a day at a time
    await tester.tap(find.byKey(const Key('ttView-day')));
    await tester.pumpAndSettle();
    Finder inRow(String id, String text) =>
        find.descendant(of: find.byKey(Key('ttDay-$id')), matching: find.text(text));
    expect(inRow('p1', 'VI-A'), findsOneWidget);
    expect(inRow('p1', 'Mathematics · 12'), findsOneWidget);
    expect(inRow('p2', 'Lunch'), findsOneWidget);
    expect(inRow('p3', 'free'), findsOneWidget);
  });

  testWidgets('Holidays and almanac: the staff calendar in the app, not a web page', (
    tester,
  ) async {
    final (t, _) = await pumpStaff(tester, size: const Size(420, 2400));
    await tester.tap(find.text('More').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Holidays and almanac'));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/academics/calendar/staff'), isTrue);
    expect(t.calls.any((c) => c.path == '/academics/calendar'), isFalse);
    // the lists of the session: the holiday and the staff meeting
    await tester.tap(find.byKey(const Key('calView-holidays')));
    await tester.pumpAndSettle();
    expect(find.text('Founders day'), findsOneWidget);
    await tester.tap(find.byKey(const Key('calView-events')));
    await tester.pumpAndSettle();
    expect(find.text('Staff workshop'), findsOneWidget);
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
