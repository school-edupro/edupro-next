import 'dart:convert';

import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/family/data.dart';
import 'package:edupro/l10n/strings.dart';
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
      case 'GET /me/profiles':
        return {
          'data': [profile(kind)],
        };
      case 'GET /me/menu':
        return {
          'app': 'parent',
          'groups': [
            {
              'label': 'My child',
              'icon': 'users',
              'items': [
                {'href': '/profile', 'label': 'Profile', 'help': null, 'icon': 'user'},
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
                {'date': day(0), 'code': 'P', 'inAt': null, 'outAt': null},
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
      case 'GET /academics/daily-work':
        expect(c.query!['classSectionId'], '300');
        return {
          'data': [
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
              'html': null,
              'student': {'id': '41', 'name': 'Kid Sample'},
              'sentAt': '${day(-1)}T10:00:00Z',
              'status': {},
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
      case 'GET /academics/calendar':
        return {'holidays': [], 'events': [], 'from': c.query?['from'], 'to': c.query?['to']};
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
                  'note': null,
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
      case 'POST /engagement/mine/profile/41/print':
        return {'id': 'x1'};
      case 'GET /engagement/mine/exports/x1':
        return {
          'export': {'id': 'x1', 'status': 'done'},
          'download': {'url': '/files/profile.pdf'},
        };
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
      expect(find.byKey(const Key('work-501')), findsWidgets);
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

  testWidgets('attendance: the month and its summary; a leave sent and a waiting one cancelled', (
    tester,
  ) async {
    final (t, school) = await pumpFamily(tester);
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Attendance'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('monthSummary')), findsOneWidget);
    expect(find.text('Present 18 · Absent 1 · Leave 1 · of 20 days'), findsOneWidget);
    expect(find.bySemanticsLabel('${S(false).date(now)}: Present'), findsOneWidget);
    // only this child's leave is listed
    await scrollTo(tester, find.text('Doctor visit'));
    expect(find.text('Not this child'), findsNothing);
    expect(find.text('Waiting for approval'), findsOneWidget);

    // apply: the kind, the reason, send
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

    // cancel the one still waiting
    await scrollTo(tester, find.byKey(const Key('cancelLeave-901')));
    await tester.tap(find.byKey(const Key('cancelLeave-901')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirmCancelLeave')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/attendance/leaves/mine/901/cancel'), isTrue);
    expect(school.leaves.firstWhere((l) => l['id'] == '901')['status'], 'cancelled');
  });

  testWidgets('a leave that needs a certificate goes to the web page', (tester) async {
    await pumpFamily(tester);
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Attendance'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.byKey(const Key('applyLeave')));
    await tester.tap(find.byKey(const Key('applyLeave')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('leaveType')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Medical leave').last);
    await tester.pumpAndSettle();
    expect(find.textContaining('needs a certificate'), findsOneWidget);
    expect(find.byKey(const Key('leaveOnWeb')), findsOneWidget);
    expect(find.byKey(const Key('sendLeave')), findsNothing);
  });

  testWidgets('homework: due first, by day; "I have seen this" and an attachment', (tester) async {
    final (t, _) = await pumpFamily(tester);
    await tester.tap(find.text('Academics'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Homework'));
    await tester.pumpAndSettle();
    expect(find.text('Homework due'), findsOneWidget);
    expect(find.text('Fractions page 12'), findsOneWidget);
    await tester.tap(find.byKey(const Key('work-501')).first);
    await tester.pumpAndSettle();
    expect(find.text('Plant a seed in a cup and note what happens each day.'), findsOneWidget);
    expect(find.text('Attachment 1'), findsOneWidget);
    expect(find.text('sheet.pdf'), findsNothing);
    await tester.tap(find.byKey(const Key('ackWork')));
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
    expect(find.byKey(const Key('shareFile')), findsOneWidget);
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
      // the change waiting for approval: withdrawn
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
      // the profile PDF: asked for, waited for, opened in the app
      await tester.tap(find.byKey(const Key('view-profilePdf')));
      await tester.pumpAndSettle();
      expect(t.calls.any((c) => c.path == '/engagement/mine/profile/41/print'), isTrue);
      expect(t.calls.any((c) => c.path == '/files/profile.pdf'), isTrue);
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
    await tester.tap(find.byKey(const Key('work-501')).first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'homework in full');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Attendance'));
    await tester.tap(find.text('Attendance').last);
    await tester.pumpAndSettle();
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
    await tester.tap(find.byKey(const Key('message-m1')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'message in full');
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notices').last);
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
