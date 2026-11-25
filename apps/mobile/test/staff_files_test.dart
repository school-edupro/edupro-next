// The staff app's File movement, native as on the staff website and the admin's page (no web page).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/attendance.dart' show leaveFilePickerProvider;
import 'package:edupro/family/common.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/data.dart' show PickedFile;
import 'package:edupro/staff/file_movement.dart';
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

Map<String, Object?> _row(String id, String status, {String? waitingOn, int round = 1}) => {
  'id': id,
  'number': 'FM-2611-000$id',
  'subject': id == '5' ? 'New lab stools' : 'Sports day budget',
  'status': status,
  'statusLabel': status,
  'round': round,
  'createdBy': id == '5' ? 'Ravi Sample' : 'Asha Teacher',
  'designation': 'PGT',
  'createdAt': '2026-11-20T05:00:00Z',
  'submittedAt': '2026-11-20T05:00:00Z',
  'closedAt': null,
  'attachments': 1,
  'levels': 2,
  'approvedLevels': status == 'approved' ? 2 : 0,
  'waitingOn': waitingOn,
  'mineNow': id == '5',
  'mineFile': id == '6',
};

class School {
  final decided = <Map<String, Object?>>[];
  final withdrawn = <String>[];
  final created = <Map<String, Object?>>[];
  final resubmitted = <Map<String, Object?>>[];

  Object? answer(Call c) {
    if (c.path.startsWith('https://')) return null;
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /file-movement':
        final box = c.query?['box'];
        return {
          'data': box == 'inbox'
              ? [_row('5', 'pending', waitingOn: 'Asha Teacher')]
              : box == 'mine'
              ? [_row('6', 'returned', round: 2)]
              : [_row('5', 'pending', waitingOn: 'Asha Teacher'), _row('6', 'returned', round: 2)],
          'inbox': 1,
          'returned': 1,
          'seesAll': false,
        };
      case 'GET /file-movement/5':
        return {
          ..._row('5', 'pending', waitingOn: 'Asha Teacher'),
          'bodyHtml': '<p>Twenty stools for the chemistry lab.</p>',
          'files': [
            {'id': '91', 'name': 'quote.pdf'},
          ],
          'levelsNow': [
            {
              'round': 1,
              'level': 1,
              'employeeId': '70',
              'name': 'Asha Teacher',
              'designation': 'PGT',
              'status': 'pending',
              'remark': null,
              'actedAt': null,
              'mine': true,
            },
            {
              'round': 1,
              'level': 2,
              'employeeId': '71',
              'name': 'Kiran Sample',
              'designation': 'Principal',
              'status': 'waiting',
              'remark': null,
              'actedAt': null,
              'mine': false,
            },
          ],
          'history': [
            {
              'round': 1,
              'action': 'submitted',
              'level': null,
              'remark': null,
              'at': '2026-11-20T05:00:00Z',
              'by': 'Ravi Sample',
            },
          ],
          'isCreator': false,
          'canDecide': true,
          'canResubmit': false,
          'canWithdraw': false,
          'canDownload': false,
        };
      case 'GET /file-movement/6':
        return {
          ..._row('6', 'returned', round: 2),
          'bodyHtml': '<p>Budget for the sports day.</p><p>Prizes included.</p>',
          'files': [
            {'id': '92', 'name': 'budget.pdf'},
          ],
          'levelsNow': [
            {
              'round': 2,
              'level': 1,
              'employeeId': '71',
              'name': 'Kiran Sample',
              'designation': 'Principal',
              'status': 'returned',
              'remark': 'Add the prize list',
              'actedAt': '2026-11-21T05:00:00Z',
              'mine': false,
            },
          ],
          'history': [
            {
              'round': 1,
              'action': 'returned',
              'level': 1,
              'remark': 'Add the prize list',
              'at': '2026-11-21T05:00:00Z',
              'by': 'Kiran Sample',
            },
          ],
          'isCreator': true,
          'canDecide': false,
          'canResubmit': true,
          'canWithdraw': true,
          'canDownload': false,
        };
      case 'GET /file-movement/9':
        return {
          ..._row('9', 'pending'),
          'bodyHtml': '<p>New.</p>',
          'files': [],
          'levelsNow': [],
          'history': [],
          'canDecide': false,
          'canResubmit': false,
          'canWithdraw': true,
          'canDownload': false,
        };
      case 'GET /file-movement/people':
        return {
          'data': [
            {'id': '71', 'name': 'Kiran Sample'},
            {'id': '72', 'name': 'Meena Sample'},
          ],
        };
      case 'GET /file-movement/dashboard':
        return {
          'seesAll': false,
          'counts': {
            'total': 2,
            'pending': 1,
            'returned': 1,
            'approved': 0,
            'rejected': 0,
            'withdrawn': 0,
          },
          'averageHours': null,
          'averageRounds': null,
          'months': [
            {'m': '2026-11', 'raised': 2, 'approved': 0, 'rejected': 0},
          ],
          'holders': [
            {'name': 'Asha Teacher', 'count': 1, 'oldest': '2026-11-20T05:00:00Z'},
          ],
          'oldest': [_row('5', 'pending', waitingOn: 'Asha Teacher')],
        };
      case 'POST /file-movement/5/decide':
        decided.add({...?c.body});
        return {'ok': true};
      case 'POST /file-movement/6/withdraw':
        withdrawn.add('6');
        return {'ok': true};
      case 'POST /file-movement':
        created.add({...?c.body});
        return {'id': '9'};
      case 'PUT /file-movement/6':
        resubmitted.add({...?c.body});
        return {'id': '6'};
      case 'POST /platform/files':
        return {
          'file': {'id': 'f9'},
          'upload': {'url': 'https://up.test/f9', 'method': 'PUT', 'headers': {}},
        };
      case 'POST /platform/files/f9/complete':
        return {'ok': true};
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<(FakeTransport, School)> pump(
  WidgetTester tester,
  Widget child, {
  bool hindi = false,
  bool dark = false,
  double text = 1,
  Size size = const Size(420, 2600),
}) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final school = School();
  final t = FakeTransport(school.answer);
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [
        transportProvider.overrideWithValue(t),
        leaveFilePickerProvider.overrideWithValue(
          () async => const [
            PickedFile(name: 'quote.pdf', bytes: [37, 80, 68, 70], contentType: 'application/pdf'),
          ],
        ),
      ],
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
  return (t, school);
}

Future<void> tapIn(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  final s = S(false);

  test('the staff menu opens File movement natively (no web page)', () {
    expect(nativeScreen(staff, '/files', s), isA<FilesScreen>());
  });

  testWidgets('the list as the admin page: boxes, cards, filters, Excel and PDF', (tester) async {
    final (t, _) = await pump(tester, const FilesScreen(profile: staff));
    expect(find.text(s.fmBox('inbox', 1, 1, false)), findsOneWidget);
    expect(find.text(s.fmBox('mine', 1, 1, false)), findsOneWidget);
    expect(find.text('FM-2611-0005'), findsOneWidget);
    expect(find.text('New lab stools'), findsOneWidget);
    expect(find.text(s.fmStatusWord('pending')), findsOneWidget);
    expect(find.textContaining(s.fmWith('Asha Teacher')), findsOneWidget);
    await tapIn(tester, find.text(s.fmBox('mine', 1, 1, false)));
    expect(t.calls.last.query?['box'], 'mine');
    expect(find.text(s.fmRound(2)), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('fmFilters')));
    await tester.enterText(find.byKey(const Key('fmQ')), 'budget');
    await tapIn(tester, find.byKey(const Key('fmShow')));
    expect(t.calls.lastWhere((c) => c.path == '/file-movement').query?['q'], 'budget');
    await tapIn(tester, find.byKey(const Key('fmExcel')));
    final file = t.calls.lastWhere((c) => c.path == '/file-movement/export');
    expect(file.query?['format'], 'xlsx');
    expect(file.query?['box'], 'mine');
  });

  testWidgets(
    'a file with me: the message, attachment, levels; send back needs a remark; approve',
    (tester) async {
      final (_, school) = await pump(tester, const FileDetailScreen(profile: staff, id: '5'));
      expect(find.text('Twenty stools for the chemistry lab.'), findsOneWidget);
      expect(find.byKey(const Key('view-fmFile-91')), findsOneWidget);
      expect(find.text('L1 · Asha Teacher'), findsOneWidget);
      expect(find.text(s.fmLevelWord('pending')), findsOneWidget);
      expect(find.text(s.fmLevelWord('waiting')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('fmReturn')));
      expect(find.text(s.fmNeedRemark), findsOneWidget);
      expect(school.decided, isEmpty);
      await tester.enterText(find.byKey(const Key('fmRemark')), 'Fine');
      await tapIn(tester, find.byKey(const Key('fmApprove')));
      expect(school.decided.single, {'outcome': 'approved', 'remark': 'Fine'});
      expect(find.text(s.fmDone('approved')), findsOneWidget);
    },
  );

  testWidgets(
    'my file sent back: the remark, correct and submit again (kept file, new one), withdraw',
    (tester) async {
      final (_, school) = await pump(tester, const FileDetailScreen(profile: staff, id: '6'));
      expect(find.text(s.fmSentBackBy('Kiran Sample', 'Add the prize list')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('fmCorrect')));
      expect(find.byKey(const Key('fmForm')), findsOneWidget);
      // the message as it was, the attachment kept, the approver chosen before
      expect(find.text('Budget for the sports day.\n\nPrizes included.'), findsOneWidget);
      expect(find.text(s.fmKept(1)), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('fmAttach')));
      expect(find.text('quote.pdf'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('fmSubmit')));
      final body = school.resubmitted.single;
      expect(body['subject'], 'Sports day budget');
      expect(body['bodyHtml'], '<p>Budget for the sports day.</p><p>Prizes included.</p>');
      expect(body['fileIds'], ['92', 'f9']);
      expect(body['approverIds'], ['71']);
      expect(find.text(s.fmDone('resubmitted')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('fmWithdraw')));
      await tapIn(tester, find.byKey(const Key('fmWithdrawYes')));
      expect(school.withdrawn, ['6']);
    },
  );

  testWidgets('add new approval: the checks, the approvers in order, submitted and opened', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const FilesScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('fmAdd')));
    await tapIn(tester, find.byKey(const Key('fmSubmit')));
    expect(find.text(s.fmNeedSubject), findsOneWidget);
    await tester.enterText(find.byKey(const Key('fmSubject')), 'Annual day stage');
    await tester.enterText(find.byKey(const Key('fmBody')), 'Stage and sound for the annual day.');
    await tapIn(tester, find.byKey(const Key('fmSubmit')));
    expect(find.text(s.fmNeedL1), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('fmL1')));
    await tapIn(tester, find.text('Kiran Sample').last);
    await tapIn(tester, find.byKey(const Key('fmAddLevel')));
    await tapIn(tester, find.byKey(const Key('fmSubmit')));
    expect(find.text(s.fmNeedEvery), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('fmL2')));
    await tapIn(tester, find.text('Meena Sample').last);
    await tapIn(tester, find.byKey(const Key('fmSubmit')));
    expect(school.created.single, {
      'subject': 'Annual day stage',
      'bodyHtml': '<p>Stage and sound for the annual day.</p>',
      'fileIds': <String>[],
      'approverIds': ['71', '72'],
    });
    expect(find.byKey(const Key('fmDetail')), findsOneWidget);
    expect(find.text(s.fmDone('submitted')), findsOneWidget);
  });

  testWidgets('the dashboard: figures, months, holders, the oldest open', (tester) async {
    await pump(tester, const FileDashboardScreen(profile: staff));
    expect(find.byKey(const Key('fmFigures')), findsOneWidget);
    expect(find.text(s.fmMonthLine(2, 0, 0)), findsOneWidget);
    expect(find.text('Asha Teacher'), findsOneWidget);
    expect(find.byKey(const Key('fmOld-5')), findsOneWidget);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): file movement', (tester) async {
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
        const FilesScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.byKey(const Key('fmFilters')));
      await check();
      await tapIn(tester, find.byKey(const Key('fmAdd')));
      await check();
      for (final id in ['5', '6']) {
        await pump(
          tester,
          FileDetailScreen(profile: staff, id: id),
          hindi: hindi,
          dark: dark,
        );
        await check();
      }
      await pump(
        tester,
        const FileDashboardScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    await pump(tester, const FilesScreen(profile: staff), text: 2, size: const Size(360, 4000));
    await tapIn(tester, find.byKey(const Key('fmFilters')));
    await tapIn(tester, find.byKey(const Key('fmAdd')));
    expect(tester.takeException(), isNull);
    for (final id in ['5', '6']) {
      await pump(
        tester,
        FileDetailScreen(profile: staff, id: id),
        text: 2,
        size: const Size(360, 4000),
      );
      expect(tester.takeException(), isNull);
    }
    await pump(
      tester,
      const FileDashboardScreen(profile: staff),
      text: 2,
      size: const Size(360, 3000),
    );
    expect(tester.takeException(), isNull);
  });
}
