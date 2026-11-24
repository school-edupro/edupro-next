// The staff app's Office orders and My profile, native as on the staff website (no web page).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/data.dart' show ymd;
import 'package:edupro/staff/my_profile.dart';
import 'package:edupro/staff/office_orders.dart';
import 'package:edupro/theme/theme.dart';
import 'package:edupro/ui/file_screen.dart';
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

class School {
  School({this.noRecord = false, this.noRight = false});
  final bool noRecord;
  final bool noRight;
  final sent = <String, List<Map<String, Object?>>>{};
  void _keep(String what, Map<String, Object?>? b) => (sent[what] ??= []).add(b ?? const {});

  Map<String, Object?> get profile => {
    'employee': {
      'id': '36',
      'name': 'Asha Teacher',
      'code': 'E01',
      'photo': null,
      'status': 'active',
    },
    'photo': {'fileId': null, 'level': 'edit_approval', 'pending': null},
    'window': {'open': true, 'message': null, 'until': null},
    'canEdit': true,
    'completeness': {'percent': 55, 'missing': <String>[]},
    'sections': [
      {
        'id': 'basic',
        'title': 'Basic information',
        'fields': [
          {
            'key': 'employee_code',
            'label': 'Employee code',
            'type': 'text',
            'level': 'view',
            'value': 'E01',
            'options': null,
            'help': null,
            'required': false,
            'upper': false,
            'when': null,
            'proof': null,
          },
          {
            'key': 'first_name',
            'label': 'First name',
            'type': 'text',
            'level': 'edit_approval',
            'value': 'Asha',
            'options': null,
            'help': null,
            'required': true,
            'upper': false,
            'when': null,
            'proof': null,
          },
          {
            'key': 'gender',
            'label': 'Gender',
            'type': 'list',
            'level': 'edit_direct',
            'value': 'Female',
            'options': ['Female', 'Male', 'Other'],
            'help': null,
            'required': false,
            'upper': false,
            'when': null,
            'proof': null,
          },
          {
            'key': 'birth_date',
            'label': 'Date of birth',
            'type': 'date',
            'level': 'edit_approval',
            'value': '1990-05-04',
            'options': null,
            'help': null,
            'required': false,
            'upper': false,
            'when': null,
            'proof': null,
            'pending': '1990-05-14',
          },
        ],
      },
    ],
    'lists': [
      {
        'id': 'training',
        'title': 'Training',
        'level': 'edit_approval',
        'proof': null,
        'columns': [
          {'key': 'topic', 'label': 'Topic', 'type': 'text', 'required': true, 'options': null},
          {'key': 'trainedOn', 'label': 'Trained on', 'type': 'date', 'options': null},
        ],
        'rows': [
          {
            'id': '5',
            'values': {'topic': 'First aid', 'trainedOn': '2025-06-01'},
            'summary': 'First aid',
            'pending': null,
          },
        ],
        'pendingAdds': <Object>[],
      },
      {
        'id': 'documents',
        'title': 'Documents',
        'level': 'view',
        'proof': null,
        'columns': <Object>[],
        'rows': [
          {
            'id': '8',
            'values': {
              'typeName': 'PAN card',
              'number': 'ABCDE1234F',
              'issuedOn': null,
              'expiresOn': null,
              'fileId': '77',
              'verified': true,
            },
            'summary': 'PAN card',
            'pending': null,
          },
        ],
        'pendingAdds': <Object>[],
      },
    ],
    'requests': [
      {
        'id': '41',
        'status': 'pending',
        'autoApplied': false,
        'createdAt': '2026-11-20T05:00:00.000Z',
        'decidedAt': null,
        'note': null,
        'reason': null,
        'step': {'at': 1, 'of': 2, 'with': 'Ravi Head'},
        'photo': null,
        'fields': [
          {
            'key': 'birth_date',
            'label': 'Date of birth',
            'from': '1990-05-04',
            'to': '1990-05-14',
            'status': 'pending',
            'note': null,
          },
        ],
      },
    ],
  };

  Object? answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /academics/notices':
        if (noRight) throw const ApiException(403, 'forbidden', 'Not allowed');
        final orders = c.query?['kind'] == 'office_order';
        return {
          'data': [
            {
              'id': '3',
              'kind': 'office_order',
              'title': 'Duty roster for the exams',
              'body': '<p>Report at <b>8:30</b>.</p>',
              'bodyFormat': 'html',
              'publishFrom': '2026-11-20',
              'publishedBy': 'Ravi Head',
              'isPinned': false,
              'ackRequired': true,
              'ackedByMe': false,
              'files': [
                {'id': '91', 'name': 'roster.pdf'},
              ],
            },
            if (!orders)
              {
                'id': '4',
                'kind': 'circular',
                'title': 'Winter timings',
                'body': 'School starts at 9:00.',
                'bodyFormat': 'text',
                'publishFrom': '2026-11-18',
                'publishedBy': null,
                'isPinned': false,
                'ackRequired': true,
                'ackedByMe': true,
                'files': <Object>[],
              },
          ],
        };
      case 'POST /academics/acks':
        _keep('ack', c.body);
        return {'ok': true};
      case 'GET /me/employee-profile':
        if (noRecord) throw const ApiException(404, 'not-found', 'No staff record');
        return profile;
      case 'POST /me/employee-profile/changes':
        _keep('changes', c.body);
        final rows = c.body?['rows'];
        return {
          'applied': c.body?['changes'] is Map && (c.body!['changes'] as Map).containsKey('gender')
              ? ['gender']
              : <String>[],
          'pending': rows is List || (c.body?['changes'] as Map?)?.containsKey('first_name') == true
              ? ['x']
              : <String>[],
        };
      case 'POST /me/employee-change-requests/41/cancel':
        _keep('cancel', c.body);
        return {'ok': true};
      // the PDF is made at once by the API (no workers)
      case 'GET /me/employee-profile/pdf':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'employee-profile-E01.pdf',
        );
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
  Size size = const Size(420, 3200),
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

void main() {
  final s = S(false);

  test('the staff menu opens Office orders and My profile natively (no web page)', () {
    expect(nativeScreen(staff, '/office-orders', s), isA<OfficeOrdersScreen>());
    expect(nativeScreen(staff, '/profile', s), isA<StaffProfileScreen>());
  });

  testWidgets('office orders: the text, its attachment, acknowledge; all notices for staff', (
    tester,
  ) async {
    final (t, school) = await pump(tester, const OfficeOrdersScreen(profile: staff));
    expect(t.calls.first.query?['kind'], 'office_order');
    expect(find.text('Duty roster for the exams'), findsOneWidget);
    expect(find.text('Report at 8:30.'), findsOneWidget);
    expect(find.textContaining('Ravi Head'), findsOneWidget);
    expect(find.byKey(const Key('view-ooFile-91')), findsOneWidget);
    expect(find.text('Winter timings'), findsNothing);
    await tapIn(tester, find.byKey(const Key('ooAck-3')));
    expect(school.sent['ack']!.single, {'type': 'notice', 'id': '3'});
    await tapIn(tester, find.text(s.ooAllTab));
    expect(find.text('Winter timings'), findsOneWidget);
    expect(find.text(s.ooAcked), findsOneWidget);
  });

  testWidgets('office orders: no right to read them is an empty list', (tester) async {
    await pump(tester, const OfficeOrdersScreen(profile: staff), school: School(noRight: true));
    expect(find.text(s.ooNone), findsWidgets);
  });

  testWidgets('my profile: the record, a field waiting, the lists, my requests', (tester) async {
    await pump(tester, const StaffProfileScreen(profile: staff));
    expect(find.text('Asha Teacher'), findsOneWidget);
    expect(find.text(s.mpHead('E01', 55)), findsOneWidget);
    expect(find.text('Basic information'), findsOneWidget);
    expect(find.text('04-05-1990'), findsOneWidget);
    expect(find.text('${s.mpWaiting}: 14-05-1990'), findsOneWidget);
    expect(find.byKey(const Key('mpPhotoChange')), findsOneWidget);
    // the lists: training can change, documents only shown (with the file's View)
    expect(find.byKey(const Key('mpAdd-training')), findsOneWidget);
    expect(find.byKey(const Key('mpAdd-documents')), findsNothing);
    expect(find.byKey(const Key('view-mpFile-77')), findsOneWidget);
    expect(find.text(s.mpYes), findsWidgets);
    // my requests open when one waits
    expect(find.textContaining('with Ravi Head (1/2)'), findsOneWidget);
    expect(find.text('Date of birth: 04-05-1990 → 14-05-1990'), findsOneWidget);
  });

  testWidgets('update a section: nothing changed is said; a change and a choice are sent', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StaffProfileScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('mpUpdate-basic')));
    expect(find.byKey(const Key('mpSectionForm')), findsOneWidget);
    // the field already waiting cannot be changed
    await tapIn(tester, find.byKey(const Key('mpSend')));
    expect(find.text(s.mpNoChange), findsOneWidget);
    await tester.enterText(find.byKey(const Key('mpField-first_name')), 'Asha R');
    await tapIn(tester, find.byKey(const Key('mpField-gender')));
    await tester.tap(find.text('Other').last);
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('mpSend')));
    expect(school.sent['changes']!.single, {
      'changes': {'first_name': 'Asha R', 'gender': 'Other'},
      'proofs': <Object>[],
    });
    expect(find.text('${s.mpSent(1, 1)}.'), findsOneWidget);
  });

  testWidgets('a list row: change it, remove it after a yes; withdraw a request', (tester) async {
    final (_, school) = await pump(tester, const StaffProfileScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('mpChange-5')));
    expect(find.byKey(const Key('mpRowForm')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('mpCol-topic')), 'First aid level 2');
    await tapIn(tester, find.byKey(const Key('mpRowSend')));
    expect(school.sent['changes']!.single, {
      'rows': [
        {
          'kind': 'training',
          'op': 'edit',
          'rowId': '5',
          'data': {'topic': 'First aid level 2', 'trainedOn': '2025-06-01'},
        },
      ],
    });
    expect(find.text(s.mpSentForApproval), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('mpRemove-5')));
    await tapIn(tester, find.byKey(const Key('mpAskYes')));
    expect(school.sent['changes']!.last['rows'], [
      {'kind': 'training', 'op': 'remove', 'rowId': '5'},
    ]);
    await tapIn(tester, find.byKey(const Key('mpWithdraw-41')));
    await tapIn(tester, find.byKey(const Key('mpAskYes')));
    expect(school.sent['cancel'], hasLength(1));
    expect(find.text(s.mpWithdrawn), findsOneWidget);
  });

  testWidgets('adding a row needs its required column', (tester) async {
    final (_, school) = await pump(tester, const StaffProfileScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('mpAdd-training')));
    await tapIn(tester, find.byKey(const Key('mpRowSend')));
    expect(find.text(s.mpRequired('Topic')), findsOneWidget);
    expect(school.sent['changes'], isNull);
  });

  testWidgets('my profile as a PDF, made at once (no waiting for the workers)', (tester) async {
    final (t, _) = await pump(tester, const StaffProfileScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('mpPdf')));
    expect(find.byType(FileScreen), findsOneWidget);
    expect(t.calls.where((c) => c.path == '/me/employee-profile/pdf'), hasLength(1));
    expect(t.calls.where((c) => c.path.contains('print') || c.path.contains('exports')), isEmpty);
  });

  testWidgets('the section form checks each field before sending: required, names', (tester) async {
    final (_, school) = await pump(tester, const StaffProfileScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('mpUpdate-basic')));
    await tester.enterText(find.byKey(const Key('mpField-first_name')), '');
    await tapIn(tester, find.byKey(const Key('mpSend')));
    expect(find.text(s.mpFixFields), findsOneWidget);
    expect(find.text(s.mpIsRequired('First name')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('mpField-first_name')), 'Asha2');
    await tapIn(tester, find.byKey(const Key('mpSend')));
    expect(find.text(s.mpRuleName), findsOneWidget);
    expect(school.sent['changes'], isNull);
    await tester.enterText(find.byKey(const Key('mpField-first_name')), "Asha D'Souza");
    await tapIn(tester, find.byKey(const Key('mpSend')));
    expect(school.sent['changes']!.single['changes'], {'first_name': "Asha D'Souza"});
  });

  test('every rule as the server checks it', () {
    Map<String, Object?> f(String key, String type, {bool required = false}) => {
      'key': key,
      'label': key,
      'type': type,
      'required': required,
    };
    String? c(Map<String, Object?> field, String v, [Map<String, String> all = const {}]) =>
        mpCheck(s, field, v, all);
    final now = DateTime.now();
    String ago(int years) => ymd(DateTime(now.year - years, now.month, now.day));
    // required, names
    expect(c(f('first_name', 'text', required: true), ''), s.mpIsRequired('first_name'));
    expect(c(f('last_name', 'text'), ''), isNull);
    expect(c(f('father_name', 'text'), 'R2D2'), s.mpRuleName);
    expect(c(f('father_name', 'text'), "Ravi O'Neil-Kumar"), isNull);
    // the formats
    expect(c(f('mobile', 'mobile'), '12345'), s.mpRuleMobile);
    expect(c(f('mobile', 'mobile'), '+91 98765 43210'), isNull);
    expect(c(f('email', 'email'), 'a@b'), s.mpRuleEmail);
    expect(c(f('aadhaar', 'digits12'), '1234 5678 9012'), isNull);
    expect(c(f('uan', 'digits12'), '1234'), s.mpRule12);
    expect(c(f('pan', 'pan'), 'abcde1234f'), isNull);
    expect(c(f('pan', 'pan'), 'ABCD1234F'), s.mpRulePan);
    expect(c(f('bank_ifsc', 'ifsc'), 'SBIN1001234'), s.mpRuleIfsc);
    expect(c(f('bank_account_no', 'account'), '12345678'), s.mpRuleAccount);
    // numbers, dates
    expect(c(f('sons', 'number'), '21'), s.mpRuleChildren);
    expect(c(f('sons', 'number'), '2'), isNull);
    expect(c(f('dob', 'date'), ago(10)), s.mpRuleAge);
    expect(c(f('dob', 'date'), ago(-1)), s.mpRuleFuture);
    expect(c(f('dob', 'date'), ago(30)), isNull);
    expect(c(f('anniversary', 'date'), ago(40), {'dob': ago(30)}), s.mpRuleAfterBirth);
    expect(c(f('anniversary', 'date'), ago(5), {'dob': ago(30)}), isNull);
    // phone, the emergency mobile
    expect(c(f('phone', 'text'), 'call me'), s.mpRulePhone);
    expect(c(f('phone', 'text'), '+91 22 2345 6789'), isNull);
    expect(
      c(f('emergency_mobile', 'mobile'), '9876543210', {'mobile': '9876543210'}),
      s.mpRuleOwnMobile,
    );
    expect(c(f('emergency_mobile', 'mobile'), '9876543211', {'mobile': '9876543210'}), isNull);
  });

  testWidgets('a sign-in with no staff record is told so', (tester) async {
    await pump(tester, const StaffProfileScreen(profile: staff), school: School(noRecord: true));
    expect(find.text(s.mpNotLinked), findsOneWidget);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): office orders, my profile and its forms', (tester) async {
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
        const OfficeOrdersScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await pump(
        tester,
        const StaffProfileScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.byKey(const Key('mpUpdate-basic')));
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    await pump(
      tester,
      const OfficeOrdersScreen(profile: staff),
      text: 2,
      size: const Size(360, 4000),
    );
    expect(tester.takeException(), isNull);
    await pump(
      tester,
      const StaffProfileScreen(profile: staff),
      text: 2,
      size: const Size(360, 3000),
    );
    expect(tester.takeException(), isNull);
    await tapIn(tester, find.byKey(const Key('mpUpdate-basic')));
    expect(tester.takeException(), isNull);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('mpChange-5')));
    expect(tester.takeException(), isNull);
  });
}
