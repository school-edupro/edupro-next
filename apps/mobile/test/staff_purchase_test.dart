// The staff app's Purchase indents, native as on the staff website and the admin's page (no web page).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/purchase_indents.dart';
import 'package:edupro/staff/sheet_excel.dart' show xlsxPickerProvider;
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

Map<String, Object?> _row(
  String id,
  String? number,
  String status, {
  String? route,
  String priority = 'normal',
  String? waitingWith,
  num? estimate,
}) => {
  'id': id,
  'number': number,
  'departmentId': '1',
  'department': 'Science',
  'raisedBy': 'Ravi Sample',
  'raisedById': '9',
  'onBehalfEmployeeId': null,
  'onBehalf': id == '101' ? 'Meena Sample' : null,
  'purpose': 'Class IX chemistry practicals',
  'requiredBy': '2026-12-10',
  'priority': priority,
  'status': status,
  'route': route,
  'bypassRule': null,
  'bypassNote': null,
  'estimate': estimate,
  'showRates': estimate != null,
  'submittedAt': '2026-11-20T05:00:00Z',
  'decidedAt': status == 'approved' ? '2026-11-21T05:00:00Z' : null,
  'decisionNote': null,
  'createdAt': '2026-11-19T05:00:00Z',
  'waitingWith': waitingWith,
  'lines': 2,
  'partClosed': false,
};

class School {
  final decided = <Map<String, Object?>>[];
  final submitted = <String>[];
  final cancelled = <Map<String, Object?>>[];
  final saved = <Map<String, Object?>>[];
  final handed = <Map<String, Object?>>[];
  final ended = <String>[];

  /// a long list (pages of 10)
  int many = 0;

  Object? answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /me':
        return {
          'user': {'id': '9', 'displayName': 'Asha Teacher'},
          'permissions': ['purchase.indent.raise'],
        };
      case 'GET /purchase/list-filters':
        return {
          'departments': [
            {'id': '1', 'name': 'Science'},
            {'id': '2', 'name': 'Sports'},
          ],
          'vendors': [],
        };
      case 'GET /purchase/indents' when many > 0:
        final page = int.tryParse('${c.query?['page'] ?? 1}') ?? 1;
        final size = int.tryParse('${c.query?['size'] ?? 10}') ?? 10;
        final from = (page - 1) * size;
        final upto = (from + size).clamp(0, many);
        return {
          'data': [
            for (var i = from; i < upto; i++) _row('x$i', 'PI/2026-27/${1000 + i}', 'submitted'),
          ],
          'total': many,
          'waitingForMe': 0,
        };
      case 'GET /purchase/indents':
        final view = c.query?['view'];
        final rows = view == 'waiting'
            ? [
                _row(
                  '101',
                  'PI/2026-27/0007',
                  'submitted',
                  priority: 'urgent',
                  waitingWith: 'Asha Teacher',
                  estimate: 1250,
                ),
              ]
            : view == 'mine'
            ? [_row('102', null, 'draft')]
            : [
                _row(
                  '101',
                  'PI/2026-27/0007',
                  'submitted',
                  priority: 'urgent',
                  waitingWith: 'Asha Teacher',
                  estimate: 1250,
                ),
                _row('102', null, 'draft'),
                _row('104', 'PI/2026-27/0004', 'approved', route: 'ordered', estimate: 300),
              ];
        return {'data': rows, 'total': rows.length, 'page': 1, 'size': 50, 'waitingForMe': 1};
      case 'GET /purchase/indents/101':
        return {
          ..._row(
            '101',
            'PI/2026-27/0007',
            'submitted',
            priority: 'urgent',
            waitingWith: 'Asha Teacher',
            estimate: 1250,
          ),
          'lineItems': [
            {
              'id': '501',
              'seq': 1,
              'itemId': '11',
              'itemCode': 'BKR-250',
              'item': 'Beaker 250 ml',
              'inCatalogue': true,
              'quantity': 10,
              'uom': 'PC',
              'uomId': '1',
              'estRate': 100,
              'amount': 1000,
              'rateSource': 'contract',
              'contractVendor': 'Lab Supplies Sample',
              'note': 'Borosilicate',
              'stockFree': 4,
              'stockUom': 'PC',
              'stockStores': [
                {'store': 'Main store', 'free': 4},
              ],
              'stockReason': 'Another size is needed',
              'fileId': '77',
              'fileName': 'spec.pdf',
              'ordered': null,
              'issues': [
                {'id': '31', 'number': 'IS/2026-27/0003', 'status': 'issued'},
              ],
            },
            {
              'id': '502',
              'seq': 2,
              'itemId': null,
              'itemCode': null,
              'item': 'Test tube stand, wooden',
              'inCatalogue': false,
              'quantity': 5,
              'uom': 'PC',
              'uomId': '1',
              'estRate': 50,
              'amount': 250,
              'rateSource': 'typed',
              'contractVendor': null,
              'note': null,
              'stockFree': null,
              'stockUom': null,
              'stockStores': [],
              'stockReason': null,
              'fileId': null,
              'fileName': null,
              'ordered': null,
              'issues': [],
            },
          ],
          'departmentSpendThisYear': 5400,
          'requisitions': [],
          'steps': [
            {
              'id': '61',
              'level': 1,
              'name': 'Head of department',
              'status': 'approved',
              'assignees': [
                {'id': '3', 'name': 'Kiran Sample'},
              ],
              'actedBy': 'Kiran Sample',
              'actedAt': '2026-11-20T06:00:00Z',
              'note': 'Fine',
              'dueAt': null,
              'overdue': false,
            },
            {
              'id': '62',
              'level': 2,
              'name': 'Vice principal',
              'status': 'pending',
              'assignees': [
                {'id': '9', 'name': 'Asha Teacher'},
                {'id': '4', 'name': 'Dev Sample'},
              ],
              'need': 'all',
              'approvedBy': [
                {'id': '4', 'name': 'Dev Sample'},
              ],
              'actedBy': null,
              'actedAt': null,
              'note': null,
              'dueAt': '2026-11-25T06:00:00Z',
              'overdue': false,
            },
          ],
          'history': [
            {
              'kind': 'started',
              'actor': 'Ravi Sample',
              'note': null,
              'detail': {},
              'at': '2026-11-20T05:00:00Z',
            },
            {
              'kind': 'approved',
              'actor': 'Kiran Sample',
              'note': 'Fine',
              'detail': {},
              'at': '2026-11-20T06:00:00Z',
            },
          ],
          'can': {'edit': false, 'submit': false, 'cancel': false, 'decide': true, 'print': true},
        };
      case 'GET /purchase/indents/102':
      case 'GET /purchase/indents/103':
        final id = c.path.split('/').last;
        return {
          ..._row(id, id == '103' ? 'PI/2026-27/0009' : null, id == '103' ? 'submitted' : 'draft'),
          'status': id == '103' ? 'submitted' : 'sent_back',
          'decisionNote': id == '103' ? null : 'Give the size',
          'lineItems': [
            {
              'id': '601',
              'seq': 1,
              'itemId': '12',
              'itemCode': 'BP-1',
              'item': 'Ball pen, blue',
              'inCatalogue': true,
              'quantity': 20,
              'uom': 'PC',
              'uomId': '1',
              'estRate': null,
              'amount': null,
              'rateSource': null,
              'contractVendor': null,
              'note': null,
              'stockFree': 0,
              'stockUom': 'PC',
              'stockStores': [],
              'stockReason': null,
              'fileId': null,
              'fileName': null,
              'ordered': null,
              'issues': [],
            },
          ],
          'departmentSpendThisYear': null,
          'requisitions': [],
          'steps': [],
          'history': [],
          'can': {
            'edit': id == '102',
            'submit': id == '102',
            'cancel': true,
            'decide': false,
            'print': id == '103',
          },
        };
      case 'POST /purchase/indents/101/decide':
        decided.add({...?c.body});
        return {'ok': true};
      case 'POST /purchase/indents/102/submit':
        submitted.add('102');
        return {'id': '102', 'number': 'PI/2026-27/0008'};
      case 'POST /purchase/indents/103/submit':
        submitted.add('103');
        return {'id': '103', 'number': 'PI/2026-27/0009'};
      case 'POST /purchase/indents/102/cancel':
        cancelled.add({...?c.body});
        return {'ok': true};
      case 'POST /purchase/indents':
        saved.add({...?c.body});
        return {'id': '103'};
      case 'PUT /purchase/indents/102':
        saved.add({...?c.body});
        return {'id': '102'};
      case 'GET /purchase/indent-form':
        return {
          'departments': [
            {'id': '1', 'name': 'Science'},
          ],
          'myDepartmentIds': ['1'],
          'anyDepartment': false,
          'showRates': false,
          'items': [
            {
              'id': '12',
              'code': 'BP-1',
              'name': 'Ball pen, blue',
              'category': 'Stationery',
              'uomId': '1',
              'uom': 'PC',
              'decimals': false,
              'lastRate': 5,
              'contractRate': null,
              'contractVendor': null,
              'stockTracked': true,
              'stockUom': 'PC',
              'perUnit': 1,
              'stock': [
                {
                  'storeId': '1',
                  'store': 'Main store',
                  'main': true,
                  'departmentId': null,
                  'free': 50,
                },
              ],
            },
          ],
          'uoms': [
            {'id': '1', 'code': 'PC', 'name': 'Piece', 'decimals': false},
            {'id': '2', 'code': 'KG', 'name': 'Kilogram', 'decimals': true},
          ],
          'staff': [
            {'id': '4', 'code': 'E004', 'name': 'Dev Sample'},
          ],
        };
      case 'POST /purchase/indent-sheet':
        return {
          'lines': [
            {'itemId': '12', 'quantity': 30, 'note': 'For the exams'},
            {'freeText': 'Chart paper', 'uomId': '1', 'quantity': 10},
          ],
          'errors': [
            {'row': 5, 'message': 'Unknown item code'},
          ],
        };
      case 'GET /purchase/delegations':
        return {
          'data': [
            {
              'id': '5',
              'from': 'Asha Teacher',
              'to': 'Dev Sample',
              'startsAt': '2026-11-01T00:00:00Z',
              'endsAt': '2099-12-31T18:29:59Z',
              'reason': 'Conference',
              'revoked': false,
              'active': true,
              'mine': true,
            },
          ],
          'staff': [
            {'id': '4', 'userId': '14', 'code': 'E004', 'name': 'Dev Sample', 'designation': 'PGT'},
          ],
        };
      case 'POST /purchase/delegations':
        handed.add({...?c.body});
        return {'id': '6'};
      case 'DELETE /purchase/delegations/5':
        ended.add('5');
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
  Size size = const Size(420, 2400),
  int many = 0,
}) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final school = School()..many = many;
  final t = FakeTransport(school.answer);
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [
        transportProvider.overrideWithValue(t),
        xlsxPickerProvider.overrideWithValue(
          () async => (name: 'items.xlsx', bytes: List<int>.filled(64, 80)),
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

  testWidgets(
    'indents: the latest 10 first, 10 more as it scrolls, then the end (as the staff website)',
    (tester) async {
      final (t, _) = await pump(
        tester,
        const PurchaseIndentsScreen(profile: staff),
        many: 23,
        size: const Size(420, 900),
      );
      List<Call> pages() => t.calls.where((c) => c.path == '/purchase/indents').toList();
      expect(pages().first.query, allOf(containsPair('page', 1), containsPair('size', 10)));
      expect(find.byKey(const Key('piRow-x0')), findsOneWidget);
      expect(find.byKey(const Key('piRow-x10')), findsNothing);
      final list = find
          .descendant(of: find.byType(RefreshIndicator), matching: find.byType(Scrollable))
          .first;
      await tester.scrollUntilVisible(find.byKey(const Key('piRow-x15')), 400, scrollable: list);
      await tester.pumpAndSettle();
      expect(pages().map((c) => c.query?['page']).take(2), [1, 2]);
      await tester.scrollUntilVisible(find.byKey(const Key('feedEnd')), 400, scrollable: list);
      await tester.pumpAndSettle();
      expect(pages().map((c) => c.query?['page']), [1, 2, 3]);
      expect(find.byKey(const Key('piRow-x22')), findsOneWidget);
    },
  );

  test('the staff menu opens Purchase indents and the hand-over natively (no web page)', () {
    expect(nativeScreen(staff, '/purchase', s), isA<PurchaseIndentsScreen>());
    expect(nativeScreen(staff, '/purchase/hand-over', s), isA<PurchaseHandOverScreen>());
  });

  testWidgets('the list as the admin page: tabs, rows, filters, Excel and PDF', (tester) async {
    final (t, _) = await pump(tester, const PurchaseIndentsScreen(profile: staff));
    // All I can see first, as the admin's list; Waiting for me counts
    expect(find.text(s.piWaitingTab(1)), findsOneWidget);
    expect(find.text(s.piMineTab), findsOneWidget);
    expect(find.text(s.piAllTab), findsOneWidget);
    // no purchase office tabs without the view right
    expect(find.text(s.piToPrTab), findsNothing);
    expect(find.text('PI/2026-27/0007'), findsOneWidget);
    expect(find.text(s.piUrgent), findsOneWidget);
    expect(find.textContaining('Class IX chemistry practicals · 2 lines'), findsWidgets);
    expect(find.text('Ravi Sample (for Meena Sample)'), findsOneWidget);
    expect(find.text('₹1,250'), findsOneWidget);
    expect(find.text(s.piWith('Asha Teacher')), findsOneWidget);
    expect(find.text(s.piRouteWord('ordered')), findsOneWidget);
    expect(find.byKey(const Key('piRaise')), findsOneWidget);
    await tapIn(tester, find.text(s.piMineTab));
    expect(t.calls.last.query?['view'], 'mine');
    expect(find.text('PI/2026-27/0007'), findsNothing);
    expect(find.text(s.piDraft), findsWidgets);
    // a search: the number or purpose
    await tapIn(tester, find.byKey(const Key('piFilters')));
    await tester.enterText(find.byKey(const Key('piQ')), 'chemistry');
    await tapIn(tester, find.byKey(const Key('piShow')));
    final list = t.calls.lastWhere((c) => c.path == '/purchase/indents');
    expect(list.query?['q'], 'chemistry');
    expect(list.query?['view'], 'mine');
    await tapIn(tester, find.byKey(const Key('piExcel')));
    final file = t.calls.lastWhere((c) => c.path == '/purchase/indents/export');
    expect(file.query?['format'], 'xlsx');
    expect(file.query?['q'], 'chemistry');
  });

  testWidgets(
    'an indent in full at my level: facts, lines, levels, history; approve and send back',
    (tester) async {
      final (_, school) = await pump(tester, const IndentDetailScreen(profile: staff, id: '101'));
      expect(find.text('PI/2026-27/0007'), findsOneWidget);
      expect(find.text(s.piKicker('Science')), findsOneWidget);
      expect(find.text(s.piWaitingWith('Asha Teacher')), findsOneWidget);
      expect(find.text(s.piDeptSpend('Science')), findsOneWidget);
      expect(find.text('1. Beaker 250 ml (BKR-250)'), findsOneWidget);
      expect(find.text(s.piBoughtAnyway('Another size is needed')), findsOneWidget);
      expect(find.text(s.piNotInList), findsOneWidget);
      expect(find.text('Lab Supplies Sample'), findsNothing);
      expect(find.textContaining('Lab Supplies Sample'), findsOneWidget);
      expect(find.byKey(const Key('view-piPdf-101')), findsOneWidget);
      expect(find.byKey(const Key('view-piSlip-31')), findsOneWidget);
      expect(find.byKey(const Key('view-piDoc-501')), findsOneWidget);
      // a level that needs all: ticked once they approved
      expect(find.text('Asha Teacher, ✓ Dev Sample'), findsOneWidget);
      expect(find.text(s.piAllMust(1, 2)), findsOneWidget);
      expect(find.textContaining(s.piEvent('started'), findRichText: true), findsOneWidget);
      // send back asks why first
      await tapIn(tester, find.byKey(const Key('piDo-send_back')));
      await tapIn(tester, find.byKey(const Key('piAskYes')));
      expect(find.text(s.piNeedReason), findsOneWidget);
      expect(school.decided, isEmpty);
      await tester.enterText(find.byKey(const Key('piReason')), 'Give the size');
      await tapIn(tester, find.byKey(const Key('piAskYes')));
      expect(school.decided.single, {'action': 'send_back', 'note': 'Give the size'});
      expect(find.text(s.piDone('send_back')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('piDo-approve')));
      await tapIn(tester, find.byKey(const Key('piAskYes')));
      expect(school.decided.last, {'action': 'approve'});
    },
  );

  testWidgets('my own sent back: what to change; send it again, or withdraw with a reason', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const IndentDetailScreen(profile: staff, id: '102'));
    expect(find.text(s.piNoteTitle('sent_back')), findsOneWidget);
    expect(find.text('Give the size'), findsOneWidget);
    expect(find.byKey(const Key('piChange')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('piDo-submit')));
    await tapIn(tester, find.byKey(const Key('piAskYes')));
    expect(school.submitted, ['102']);
    await tapIn(tester, find.byKey(const Key('piDo-cancel')));
    await tester.enterText(find.byKey(const Key('piReason')), 'Not needed now');
    await tapIn(tester, find.byKey(const Key('piAskYes')));
    expect(school.cancelled.single, {'reason': 'Not needed now'});
  });

  testWidgets('raise an indent: the checks, an item with the stores’ stock, the sheet, sent', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const PurchaseIndentsScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('piRaise')));
    expect(find.byKey(const Key('piForm')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('piFormSend')));
    expect(find.text(s.piNeedPurpose), findsOneWidget);
    await tester.enterText(find.byKey(const Key('piFormPurpose')), 'Board exams');
    await tapIn(tester, find.byKey(const Key('piFormSend')));
    expect(find.text(s.piNeedLine), findsOneWidget);
    // the item: what the stores hold free shows under it, and "buy new instead" when they have it
    await tapIn(tester, find.byKey(const Key('piItem-1')));
    await tapIn(tester, find.text('Ball pen, blue (BP-1) · Stationery').last);
    expect(find.text(s.piInStores('50', 'PC', 'Main store 50')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('piQty-1')), '2.5');
    await tapIn(tester, find.byKey(const Key('piFormSend')));
    expect(find.text(s.piNeedWhole(1)), findsOneWidget);
    await tester.enterText(find.byKey(const Key('piQty-1')), '25');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('piWhy-1')), findsOneWidget);
    // the filled item sheet: its lines added, the rows it could not read
    // folded until asked for
    expect(find.byKey(const Key('piSheetPut')), findsNothing);
    await tapIn(tester, find.byKey(const Key('piSheet')));
    await tapIn(tester, find.byKey(const Key('piSheetPut')));
    expect(find.text(s.piSheetAdded(2)), findsOneWidget);
    expect(find.text('${s.piRow(5)}: Unknown item code'), findsOneWidget);
    expect(find.byKey(const Key('piQty-3')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('piFormUrgent')));
    // the form's list builds as it scrolls: down to the buttons
    await tester.scrollUntilVisible(
      find.byKey(const Key('piFormSend')),
      300,
      scrollable: find
          .descendant(of: find.byKey(const Key('piForm')), matching: find.byType(Scrollable))
          .first,
    );
    await tapIn(tester, find.byKey(const Key('piFormSend')));
    final body = school.saved.single;
    expect(body['purpose'], 'Board exams');
    expect(body['priority'], 'urgent');
    expect(body['departmentId'], '1');
    expect(body['lines'], [
      {'itemId': '12', 'quantity': 25},
      {'itemId': '12', 'quantity': 30, 'note': 'For the exams'},
      {'freeText': 'Chart paper', 'quantity': 10, 'uomId': '1'},
    ]);
    expect(school.submitted, ['103']);
    // the new indent opens, saying it was sent
    expect(find.text(s.piSent('PI/2026-27/0009')), findsOneWidget);
    expect(find.byKey(const Key('piDetail')), findsOneWidget);
  });

  testWidgets('hand over my approvals: the colleague, the days, why; end one now', (tester) async {
    final (_, school) = await pump(tester, const PurchaseHandOverScreen(profile: staff));
    expect(find.text('Asha Teacher → Dev Sample'), findsOneWidget);
    expect(find.text(s.piDelegState('active')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('piHoSend')));
    expect(find.text(s.piNeedColleague), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('piHoEnd-5')));
    expect(school.ended, ['5']);
    expect(find.text(s.piEnded), findsOneWidget);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): purchase indents', (tester) async {
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
        const PurchaseIndentsScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await tapIn(tester, find.byKey(const Key('piFilters')));
      await check();
      await tapIn(tester, find.byKey(const Key('piRaise')));
      await check();
      await pump(
        tester,
        const IndentDetailScreen(profile: staff, id: '101'),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await pump(
        tester,
        const IndentDetailScreen(profile: staff, id: '102'),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await pump(
        tester,
        const PurchaseHandOverScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    await pump(
      tester,
      const PurchaseIndentsScreen(profile: staff),
      text: 2,
      size: const Size(360, 4000),
    );
    await tapIn(tester, find.byKey(const Key('piFilters')));
    await tapIn(tester, find.byKey(const Key('piRaise')));
    expect(tester.takeException(), isNull);
    for (final id in ['101', '102']) {
      await pump(
        tester,
        IndentDetailScreen(profile: staff, id: id),
        text: 2,
        size: const Size(360, 5000),
      );
      expect(tester.takeException(), isNull);
    }
    await pump(
      tester,
      const PurchaseHandOverScreen(profile: staff),
      text: 2,
      size: const Size(360, 3000),
    );
    expect(tester.takeException(), isNull);
  });
}
