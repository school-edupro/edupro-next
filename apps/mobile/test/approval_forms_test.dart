import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/attendance.dart' show leaveFilePickerProvider;
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/approvals.dart';
import 'package:edupro/staff/data.dart';
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fakes.dart';

/// docs/design/100 phase D: the six kinds decided item by item, decided in the app (no web page). Every name,
/// number and amount here is made up.
const _profile = {
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

/// each kind's record (as its own route gives it) and the options the form needs
final Map<String, (Map<String, Object?>, Map<String, Object?>)> _records = {
  'receipt': (
    {
      'lineItems': [
        {
          'id': 'L1',
          'description': 'Chalk boxes',
          'uom': 'box',
          'received': 10,
          'accepted': null,
          'rejected': null,
          'serials': null,
        },
        {
          'id': 'L2',
          'description': 'Projector',
          'uom': 'nos',
          'received': 2,
          'accepted': null,
          'rejected': null,
          'serials': ['SN-1', 'SN-2'],
        },
        {'id': 'L3', 'description': 'Not sent', 'uom': 'nos', 'received': 0},
      ],
      'committee': null,
      'can': {'inspect': true, 'cancel': false},
    },
    {},
  ),
  'condemnation': (
    {
      'can': {'sign': false, 'decide': true, 'sendBack': true},
    },
    {},
  ),
  'withdrawal': (
    {
      'clearances': [
        {
          'department': 'library',
          'departmentName': 'Library',
          'canAct': true,
          'dues': 0,
          'documentRequired': true,
          'bypassAllowed': true,
          'chargeKind': null,
          'chargeMiscFeeId': null,
        },
        {'department': 'fees', 'departmentName': 'Fees', 'canAct': false},
      ],
    },
    {},
  ),
  'transfer': (
    {'status': 'sent'},
    {
      'sections': [
        {'id': 's1', 'label': 'VI-A'},
        {'id': 's2', 'label': 'VI-B'},
      ],
      'admissionNo': 'A-101',
    },
  ),
  'acr': (
    {
      'scale': ['Outstanding', 'Very good', 'Good', 'Fair', 'Poor'],
      'bands': [
        {'minPct': 80, 'label': 'A', 'adverse': false},
        {'minPct': 0, 'label': 'B', 'adverse': false},
      ],
      'forms': {
        'f1': {
          'id': 'f1',
          'name': 'Review',
          'sections': [
            {
              'id': 'x1',
              'title': 'Teaching',
              'questions': [
                {'id': 'q1', 'text': 'Plans lessons', 'kind': 'scale', 'required': true},
                {'id': 'q2', 'text': 'Comments', 'kind': 'text', 'required': false},
                {'id': 'q3', 'text': 'Took part in events', 'kind': 'yesno', 'required': false},
                {'id': 'q4', 'text': 'Evidence', 'kind': 'file', 'required': false},
              ],
            },
          ],
        },
      },
      'levels': [
        {'seq': 1, 'action': 'review', 'formId': null, 'final': false},
        {'seq': 2, 'action': 'review', 'formId': 'f1', 'answers': {}, 'final': true},
      ],
      'remarkLines': [
        {'id': 'r1', 'grade': 'A', 'text': 'A dedicated teacher'},
        {'id': 'r2', 'grade': 'B', 'text': 'Needs support with planning'},
      ],
      'can': {
        'level': {'seq': 2, 'action': 'review'},
        'sendBack': true,
      },
    },
    {},
  ),
  'no_dues': (
    {
      'clearances': [
        {'department': 'it', 'name': 'IT', 'status': 'pending', 'mayClear': true},
        {'department': 'hr', 'name': 'HR', 'status': 'cleared', 'mayClear': true},
      ],
    },
    {},
  ),
};

/// the made-up API: a kind's Details (with its record) and its steps
dynamic _answer(Call c, {Map<String, Object?>? record}) {
  if (c.path.startsWith('https://up.test/')) return null;
  final m = RegExp(r'^/approvals/([a-z_]+)/(\w+)(/act)?$').firstMatch(c.path);
  if (m != null && c.method == 'GET') {
    final (rec, options) = _records[m[1]]!;
    return {
      'item': {'kind': m[1], 'id': m[2], 'decideHere': false},
      'detail': {
        'title': 'Item ${m[2]}',
        'subtitle': null,
        'status': null,
        'facts': [
          {'label': 'Kind', 'value': '${m[1]}'},
        ],
        'notes': [],
        'tables': [],
        'files': [],
      },
      'record': record ?? rec,
      'options': options,
      'steps': [],
    };
  }
  if (m != null && m[3] != null) {
    final step = c.body!['step'];
    return {
      'kind': m[1],
      'id': m[2],
      'step': step,
      'result': step == 'file'
          ? {
              'file': {'id': 'f5'},
              'upload': {'url': 'https://up.test/f5', 'method': 'PUT', 'headers': {}},
            }
          : {'ok': true},
    };
  }
  switch ('${c.method} ${c.path}') {
    case 'POST /platform/files':
      return {
        'file': {'id': 'f9'},
        'upload': {'url': 'https://up.test/f9', 'method': 'PUT', 'headers': {}},
      };
    case 'POST /platform/files/f9/complete' || 'POST /platform/files/f5/complete':
      return {'ok': true};
  }
  throw StateError('unexpected ${c.method} ${c.path}');
}

/// a page with Details of one item opened over it (so the decision can close it)
Future<FakeTransport> _open(
  WidgetTester tester,
  String kind, {
  bool hindi = false,
  Size size = const Size(420, 2600),
  Map<String, Object?>? record,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final t = FakeTransport((c) => _answer(c, record: record));
  await tester.pumpWidget(
    ProviderScope(
      // a fresh app each time (the navigator of the one before is not kept)
      key: UniqueKey(),
      overrides: [
        transportProvider.overrideWithValue(t),
        stringsProvider.overrideWithValue(S(hindi)),
        leaveFilePickerProvider.overrideWithValue(
          () async => [
            const PickedFile(
              name: 'proof.pdf',
              bytes: [37, 80, 68, 70],
              contentType: 'application/pdf',
            ),
          ],
        ),
      ],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        home: Builder(
          builder: (c) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(c).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ApprovalDetailScreen(
                      profile: Profile.fromJson(_profile),
                      item: {'kind': kind, 'id': '5'},
                    ),
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  expect(find.byKey(const Key('approvalDetail')), findsOneWidget);
  return t;
}

Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Map<String, Object?> _act(FakeTransport t, String kind) {
  final c = t.calls.lastWhere((c) => c.path == '/approvals/$kind/5/act');
  return {'step': c.body!['step'], 'body': c.body!['body']};
}

void main() {
  final s = S(false);

  testWidgets('a receipt inspected in the app: accepted and rejected per line, why, serials', (
    tester,
  ) async {
    final t = await _open(tester, 'receipt');
    expect(find.byKey(const Key('afReceipt')), findsOneWidget);
    // a line not received is not inspected
    expect(find.byKey(const Key('afLine-L3')), findsNothing);
    // the quantities must add up to what came
    await tester.enterText(find.byKey(const Key('afAccepted-L1')), '9');
    await tester.enterText(find.byKey(const Key('afRejected-L1')), '2');
    await tester.pumpAndSettle();
    await _tap(tester, find.byKey(const Key('afAcceptMarked')));
    expect(find.text(s.afQtyAdd('Chalk boxes')), findsOneWidget);
    // a rejection needs its reason
    await tester.enterText(find.byKey(const Key('afAccepted-L1')), '8');
    await _tap(tester, find.byKey(const Key('afAcceptMarked')));
    expect(find.text(s.afWhyRejected('Chalk boxes')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('afWhy-L1')), 'Broken in transit');
    await tester.enterText(find.byKey(const Key('afAccepted-L2')), '1');
    await tester.enterText(find.byKey(const Key('afRejected-L2')), '1');
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('afWhy-L2')), 'Cracked lens');
    await _tap(tester, find.widgetWithText(FilterChip, 'SN-2'));
    await tester.enterText(find.byKey(const Key('afNote')), 'Checked by the store');
    await _tap(tester, find.byKey(const Key('afAcceptMarked')));
    expect(_act(t, 'receipt'), {
      'step': 'inspect',
      'body': {
        'action': 'accept',
        'note': 'Checked by the store',
        'lines': [
          {
            'lineId': 'L1',
            'acceptedQty': 8,
            'rejectedQty': 2,
            'reason': 'Broken in transit',
            'rejectedSerials': <String>[],
          },
          {
            'lineId': 'L2',
            'acceptedQty': 1,
            'rejectedQty': 1,
            'reason': 'Cracked lens',
            'rejectedSerials': ['SN-2'],
          },
        ],
      },
    });
    // decided: back where it was opened from, never a web page
    expect(find.byKey(const Key('approvalDetail')), findsNothing);
    expect(find.text('open'), findsOneWidget);
    expect(t.calls.any((c) => c.path.startsWith('/web')), isFalse);
  });

  testWidgets('a receipt rejected as a whole, with a reason; not mine to inspect says so', (
    tester,
  ) async {
    final t = await _open(tester, 'receipt');
    await _tap(tester, find.byKey(const Key('afRejectAll')));
    await tester.enterText(find.byKey(const Key('afReason')), 'Wrong items sent');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('afReasonOk')));
    await tester.pumpAndSettle();
    expect(_act(t, 'receipt'), {
      'step': 'inspect',
      'body': {'action': 'reject', 'note': 'Wrong items sent', 'lines': <Object>[]},
    });
    await _open(
      tester,
      'receipt',
      record: {
        'lineItems': <Object>[],
        'can': {'inspect': false},
      },
    );
    expect(find.text(s.afNotYours), findsOneWidget);
    expect(find.byKey(const Key('afAcceptMarked')), findsNothing);
  });

  testWidgets('a condemnation: reject with a reason (the approver)', (tester) async {
    final t = await _open(tester, 'condemnation');
    expect(find.byKey(const Key('afSign')), findsNothing);
    expect(find.byKey(const Key('afApprove')), findsOneWidget);
    await _tap(tester, find.byKey(const Key('afReject')));
    // too short a reason cannot be sent
    await tester.enterText(find.byKey(const Key('afReason')), 'no');
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.byKey(const Key('afReasonOk'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('afReason')), 'Still usable');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('afReasonOk')));
    await tester.pumpAndSettle();
    expect(_act(t, 'condemnation'), {
      'step': 'decide',
      'body': {'action': 'reject', 'note': 'Still usable'},
    });
  });

  testWidgets('a withdrawal: my department only; a document it needs, sent first; cleared', (
    tester,
  ) async {
    final t = await _open(tester, 'withdrawal');
    expect(find.byKey(const Key('afClearance-library')), findsOneWidget);
    expect(find.byKey(const Key('afClearance-fees')), findsNothing);
    // the document the department needs
    await _tap(tester, find.byKey(const Key('afClear-library')));
    expect(find.text(s.addCertificate), findsOneWidget);
    expect(t.calls.any((c) => c.path == '/approvals/withdrawal/5/act'), isFalse);
    await _tap(tester, find.byKey(const Key('afDoc-library')));
    expect(find.text('proof.pdf'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('afRemarks-library')), 'Books returned');
    await _tap(tester, find.byKey(const Key('afClear-library')));
    expect(t.calls.any((c) => c.path == 'https://up.test/f9'), isTrue);
    expect(_act(t, 'withdrawal'), {
      'step': 'clear',
      'body': {
        'department': 'library',
        'status': 'cleared',
        'dues': 0,
        'remarks': 'Books returned',
        'documents': [
          {'fileId': 'f9'},
        ],
      },
    });
  });

  testWidgets('a withdrawal bypassed with a reason', (tester) async {
    final t = await _open(tester, 'withdrawal');
    await _tap(tester, find.byKey(const Key('afBypass-library')));
    await tester.enterText(find.byKey(const Key('afReason')), 'Librarian on leave');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('afReasonOk')));
    await tester.pumpAndSettle();
    expect(_act(t, 'withdrawal'), {
      'step': 'bypass',
      'body': {'department': 'library', 'reason': 'Librarian on leave'},
    });
  });

  testWidgets('a transfer admitted: a section (searched), the next admission number, a roll', (
    tester,
  ) async {
    final t = await _open(tester, 'transfer');
    await _tap(tester, find.byKey(const Key('afAdmitIt')));
    expect(find.text(s.afPickSection), findsOneWidget);
    // the section list is searched by typing
    await _tap(tester, find.byKey(const Key('afSection')));
    await tester.enterText(
      find.descendant(of: find.byKey(const Key('afSection')), matching: find.byType(TextField)),
      'VI-B',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(MenuItemButton, 'VI-B').last);
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byKey(const Key('afAdmissionNo'))).controller!.text,
      'A-101',
    );
    await tester.enterText(find.byKey(const Key('afRollNo')), '12');
    await _tap(tester, find.byKey(const Key('afAdmitIt')));
    expect(_act(t, 'transfer'), {
      'step': 'accept',
      'body': {'classSectionId': 's2', 'admissionNo': 'A-101', 'rollNo': 12},
    });
  });

  testWidgets('a transfer refused with a reason', (tester) async {
    final t = await _open(tester, 'transfer');
    await _tap(tester, find.byKey(const Key('afRefuse')));
    await tester.enterText(find.byKey(const Key('afReason')), 'No seat in the class');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('afReasonOk')));
    await tester.pumpAndSettle();
    expect(_act(t, 'transfer'), {
      'step': 'reject',
      'body': {'reason': 'No seat in the class'},
    });
  });

  testWidgets('an ACR level: rate, write, yes or no, a file; save a draft; grade and submit', (
    tester,
  ) async {
    final t = await _open(tester, 'acr');
    expect(find.text('Plans lessons *'), findsOneWidget);
    // the top word is the highest number
    await _tap(tester, find.byKey(const Key('afScale-q1-5')));
    await tester.enterText(
      find.descendant(of: find.byKey(const Key('afQ-q2')), matching: find.byType(TextField)),
      'Well prepared',
    );
    await _tap(
      tester,
      find.descendant(of: find.byKey(const Key('afQ-q3')), matching: find.text(s.yes)),
    );
    // a file: registered on the ACR, sent, then answered
    await _tap(tester, find.byKey(const Key('afFile-q4')));
    expect(t.calls.any((c) => c.path == 'https://up.test/f5'), isTrue);
    expect(find.text(s.afFiles(1)), findsOneWidget);
    await _tap(tester, find.byKey(const Key('afSaveDraft')));
    expect(_act(t, 'acr'), {
      'step': 'save',
      'body': {
        'seq': 2,
        'answers': {
          'q1': 5,
          'q3': 'yes',
          'q4': ['f5'],
          'q2': 'Well prepared',
        },
      },
    });
    // a draft keeps the screen open
    expect(find.byKey(const Key('approvalDetail')), findsOneWidget);
    // the grade, agreement and a standard remark of that grade
    await _tap(tester, find.byKey(const Key('afGrade')));
    await tester.tap(find.widgetWithText(MenuItemButton, 'A').last);
    await tester.pumpAndSettle();
    expect(find.text('A dedicated teacher'), findsOneWidget);
    expect(find.text('Needs support with planning'), findsNothing);
    await _tap(tester, find.text(s.afAgree));
    await _tap(tester, find.text('A dedicated teacher'));
    await tester.enterText(find.byKey(const Key('afAcrRemarks')), 'A good year');
    await _tap(tester, find.byKey(const Key('afSubmit')));
    expect(_act(t, 'acr'), {
      'step': 'submit',
      'body': {
        'seq': 2,
        'answers': {
          'q1': 5,
          'q3': 'yes',
          'q4': ['f5'],
          'q2': 'Well prepared',
        },
        'remarks': 'A good year',
        'grade': 'A',
        'agreement': 'agree',
        'remarkIds': ['r1'],
      },
    });
    expect(find.byKey(const Key('approvalDetail')), findsNothing);
  });

  testWidgets('an ACR sent back with a reason of five letters or more', (tester) async {
    final t = await _open(tester, 'acr');
    await _tap(tester, find.byKey(const Key('afAcrSendBack')));
    await tester.enterText(find.byKey(const Key('afReason')), 'Fill');
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.byKey(const Key('afReasonOk'))).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('afReason')), 'Fill the self part');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('afReasonOk')));
    await tester.pumpAndSettle();
    expect(_act(t, 'acr'), {
      'step': 'send_back',
      'body': {'reason': 'Fill the self part'},
    });
  });

  testWidgets('no-dues: my department waiting only; its dues and a note; cleared', (tester) async {
    final t = await _open(tester, 'no_dues');
    expect(find.byKey(const Key('afNoDue-it')), findsOneWidget);
    expect(find.byKey(const Key('afNoDue-hr')), findsNothing);
    await tester.enterText(find.byKey(const Key('afNoDueAmount-it')), '150');
    await tester.enterText(find.byKey(const Key('afNoDueNote-it')), 'Charger not returned');
    await _tap(tester, find.byKey(const Key('afNoDueClear-it')));
    expect(_act(t, 'no_dues'), {
      'step': 'clear',
      'body': {'department': 'it', 'dues': 150, 'note': 'Charger not returned'},
    });
    expect(find.byKey(const Key('approvalDetail')), findsNothing);
  });

  testWidgets('a step the API refuses says why and keeps the form', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final t = FakeTransport((c) {
      if (c.path.endsWith('/act')) {
        throw ApiException(409, 'conflict', 'This clearance was decided already.');
      }
      return _answer(c);
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [transportProvider.overrideWithValue(t)],
        child: MaterialApp(
          theme: eduproTheme(brightness: Brightness.light, webFonts: false),
          home: ApprovalDetailScreen(
            profile: Profile.fromJson(_profile),
            item: const {'kind': 'no_dues', 'id': '5'},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _tap(tester, find.byKey(const Key('afNoDueClear-it')));
    expect(find.text('This clearance was decided already.'), findsOneWidget);
    expect(find.byKey(const Key('afNoDues')), findsOneWidget);
  });

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets(
      'the six forms: accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''})',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
        for (final kind in _records.keys) {
          await _open(tester, kind, hindi: hindi);
          if (kind == 'receipt') {
            // the rejected line's reason and serials shown too
            await tester.enterText(find.byKey(const Key('afRejected-L2')), '1');
            await tester.pumpAndSettle();
          }
          for (final g in [
            androidTapTargetGuideline,
            iOSTapTargetGuideline,
            labeledTapTargetGuideline,
            textContrastGuideline,
          ]) {
            await expectLater(tester, meetsGuideline(g), reason: '$kind: ${g.description}');
          }
        }
        handle.dispose();
      },
    );
  }

  testWidgets('the six forms: large text (twice the size) lays out without overflow', (
    tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    for (final kind in _records.keys) {
      await _open(tester, kind, size: const Size(360, 780));
      for (var i = 0; i < 12; i++) {
        await tester.drag(find.byKey(const Key('approvalDetail')), const Offset(0, -500));
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull, reason: kind);
    }
  });
}
