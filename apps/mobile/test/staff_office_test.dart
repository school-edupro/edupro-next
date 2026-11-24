// The staff app's Issued to my department, My resignation, My certificates, My tax and My payslips, native as on the
// staff website (no web page). Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/attendance.dart' show leaveFilePickerProvider;
import 'package:edupro/family/common.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/classes.dart';
import 'package:edupro/staff/data.dart' show PickedFile;
import 'package:edupro/staff/issues.dart';
import 'package:edupro/staff/my_certificates.dart';
import 'package:edupro/staff/my_tax.dart';
import 'package:edupro/staff/resignation.dart';
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

Map<String, Object?> _issue(String id, String status) => {
  'id': id,
  'number': 'ISS/2026-27/00$id',
  'kindLabel': 'Issue',
  'status': status,
  'store': 'Main store',
  'department': 'Science',
  'indent': 'PI/2026-27/0007',
  'takenBy': 'Ravi Sample',
  'purpose': 'Practicals',
  'issuedOn': '2026-11-20',
  'issuedBy': 'Sunil Sample',
  'acknowledgedAt': status == 'acknowledged' ? '2026-11-21T05:00:00Z' : null,
  'acknowledgedBy': status == 'acknowledged' ? 'Asha Teacher' : null,
  'ackNote': null,
  'lines': 2,
  'value': 0,
};

Map<String, Object?> _exit(String status) => {
  'id': '7',
  'exitType': {'code': 'RESIGN', 'name': 'Resignation'},
  'reason': 'Moving to another city',
  'letterFileId': '81',
  'requestedOn': '2026-11-01',
  'proposedLastDay': '2026-12-31',
  'noticeDays': 60,
  'expectedLastDay': '2026-12-31',
  'shortfallDays': 0,
  'acceptedLastDay': status == 'approved' ? '2026-12-31' : null,
  'noticeWaived': false,
  'status': status,
  'bySelf': true,
  'sentBackNote': status == 'sent_back' ? 'Attach the signed letter' : null,
  'decisionNote': null,
  'waitingAt': status == 'pending' ? 'Principal' : null,
};

class School {
  School({this.exit = 'none'});
  final String exit;
  final acked = <Map<String, Object?>>[];
  final exits = <Map<String, Object?>>[];
  final withdrawn = <String>[];
  final resent = <Map<String, Object?>>[];
  final asked = <Map<String, Object?>>[];
  final certWithdrawn = <String>[];
  final declared = <Map<String, Object?>>[];
  final declWithdrawn = <String>[];
  final prev = <Map<String, Object?>>[];
  final regimes = <Map<String, Object?>>[];

  Object? answer(Call c) {
    if (c.path.startsWith('https://')) return null;
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /purchase/issues':
        return {
          'rows': c.query?['mine'] == '1'
              ? [_issue('41', 'issued')]
              : [_issue('42', 'acknowledged')],
        };
      case 'GET /purchase/issues/41':
        return {
          ..._issue('41', 'issued'),
          'lineItems': [
            {
              'id': '1',
              'itemCode': 'BKR-250',
              'item': 'Beaker 250 ml',
              'unit': 'PC',
              'qty': 10,
              'batch': 'B7',
              'returned': 2,
            },
          ],
          'can': {'acknowledge': true},
        };
      case 'POST /purchase/issues/41/acknowledge':
        acked.add({...?c.body});
        return {'ok': true};
      case 'GET /me/exits':
        return {
          'clearances': exit == 'approved'
              ? [
                  {'department': 'LIB', 'name': 'Library', 'status': 'cleared', 'dues': 0},
                  {'department': 'ACC', 'name': 'Accounts', 'status': 'pending', 'dues': 500},
                ]
              : [],
          'employee': {'name': 'Asha Teacher', 'code': 'E007', 'typeName': 'Teaching'},
          'types': [
            {'code': 'RESIGN', 'name': 'Resignation', 'noticeApplies': true},
          ],
          'noticeDays': 60,
          'data': [
            if (exit != 'none') _exit(exit),
            {..._exit('withdrawn'), 'id': '3', 'requestedOn': '2025-06-01'},
          ],
        };
      case 'POST /me/exits':
        exits.add({...?c.body});
        return {'id': '9'};
      case 'POST /people/exits/7/withdraw':
        withdrawn.add('7');
        return {'ok': true};
      case 'POST /people/exits/7/resubmit':
        resent.add({...?c.body});
        return {'ok': true};
      case 'POST /platform/files':
        return {
          'file': {'id': 'f9'},
          'upload': {'url': 'https://up.test/f9', 'method': 'PUT', 'headers': {}},
        };
      case 'POST /platform/files/f9/complete':
        return {'ok': true};
      case 'GET /certificate-requests/mine':
        return {
          'employee': {'id': '70', 'name': 'Asha Teacher', 'code': 'E007'},
          'types': [
            {
              'code': 'EXP',
              'name': 'Experience certificate',
              'audience': 'STAFF',
              'purposes': ['Visa', 'New job'],
              'maxCopies': 2,
            },
            {
              'code': 'BON',
              'name': 'Bonafide',
              'audience': 'STUDENT',
              'purposes': [],
              'maxCopies': 1,
            },
          ],
          'requests': [
            {
              'id': '5',
              'typeName': 'Service certificate',
              'employeeId': '70',
              'purpose': 'Bank',
              'stage': 'waiting',
              'decisionNote': null,
              'createdAt': '2026-11-10T05:00:00Z',
            },
          ],
          'certificates': [
            {
              'id': '9',
              'typeName': 'Experience certificate',
              'number': 'EXP/2026/0009',
              'copyNo': 0,
              'issuedOn': '2026-10-01',
            },
          ],
        };
      case 'POST /certificate-requests/mine':
        asked.add({...?c.body});
        return {'id': '6'};
      case 'POST /certificate-requests/mine/5/withdraw':
        certWithdrawn.add('5');
        return {'ok': true};
      case 'GET /payroll/me/tax':
        return {
          'fy': '2026-27',
          'years': ['2026-27', '2025-26'],
          'year': {
            'declareFrom': '2026-04-01',
            'declareTo': '2027-01-31',
            'proofDue': '2027-01-31',
            'frozen': false,
            'open': true,
          },
          'labels': [
            {'code': 'S80C', 'label': '80C investments', 'appliesTo': 'OLD', 'cap': '150000'},
            {'code': 'HRA_RENT', 'label': 'House rent (HRA)', 'appliesTo': 'OLD', 'cap': null},
          ],
          'declarations': [
            {
              'id': 'd1',
              'lineCode': 'S80C',
              'declared': '50000.00',
              'verified': null,
              'status': 'SUBMITTED',
              'rejectReason': null,
            },
          ],
          'prev': null,
          'regime': {'current': 'NEW', 'cutoffMonth': 12, 'open': true},
          'tax': {
            'fy': '2026-27',
            'month': '2026-12',
            'done': false,
            'regime': 'NEW',
            'annual': null,
            'sheet': {
              'gross': '900000.00',
              'perquisites': null,
              'prevSalary': null,
              'exemptions': null,
              'standardDeduction': '75000.00',
              'pt': '2400.00',
              'otherIncome': null,
              'houseLoss': null,
              'deductions': null,
              'taxable': '822600.00',
              'slabTax': '42260.00',
              'rebate': null,
              'surcharge': null,
              'cess': '1690.40',
              'total': '43950.40',
              'panAbsent': false,
              'ytdTds': '20000.00',
              'monthsLeft': 4,
              'monthly': '5987.60',
              'warnings': [],
            },
            'working': {'hra': null, 'npsEr': null, 'deductions': []},
            'otherRegime': {'regime': 'OLD', 'total': '61000.00', 'monthly': '10250.00'},
            'plan': [
              {'month': '2026-04', 'state': 'deducted', 'amount': '5000.00'},
              {'month': '2026-12', 'state': 'planned', 'amount': '5987.60'},
            ],
          },
          'certificate': {'released': false},
        };
      case 'POST /payroll/me/tax/declarations':
        declared.add({...?c.body});
        return {'message': 'Declared: it counts from the next run.'};
      case 'DELETE /payroll/me/tax/declarations/d1':
        declWithdrawn.add('d1');
        return {'ok': true};
      case 'POST /payroll/me/tax/prev':
        prev.add({...?c.body});
        return {'ok': true};
      case 'POST /payroll/me/tax/regime':
        regimes.add({...?c.body});
        return {'message': 'Your regime is now old.'};
      case 'GET /payroll/me/payslips':
        return {
          'employee': {'id': '70', 'code': 'E007', 'name': 'Asha Teacher'},
          'fy': 2026,
          'years': [2026],
          'rows': [
            {
              'id': 'r1',
              'month': '2026-10',
              'runType': 'REGULAR',
              'grossEarned': '75000.00',
              'totalDeductions': '9790.00',
              'netPay': '65210.00',
              'status': 'PAID',
            },
            {
              'id': 'r2',
              'month': '2026-10',
              'runType': 'BONUS',
              'grossEarned': '5000.00',
              'totalDeductions': '0.00',
              'netPay': '5000.00',
              'status': 'HELD',
            },
          ],
          'ytd': {
            'count': 2,
            'gross': '80000.00',
            'deductions': '9790.00',
            'net': '70210.00',
            'tax': '4000.00',
            'pt': '200.00',
          },
          'passwordHint': 'your PAN in capitals',
        };
      case 'GET /payroll/me/letters':
        return {
          'rows': [
            {
              'id': '3',
              'letterNo': 'INC/2026/03',
              'effectiveFrom': '2026-04-01',
              'kind': 'INCREMENT',
            },
          ],
        };
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
  Size size = const Size(420, 2600),
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
      overrides: [
        transportProvider.overrideWithValue(t),
        leaveFilePickerProvider.overrideWithValue(
          () async => const [
            PickedFile(name: 'letter.pdf', bytes: [37, 80, 68, 70], contentType: 'application/pdf'),
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

  test('the staff menu opens them natively (no web page)', () {
    expect(nativeScreen(staff, '/purchase/issues', s), isA<StaffIssuesScreen>());
    expect(nativeScreen(staff, '/resignation', s), isA<ResignationScreen>());
    expect(nativeScreen(staff, '/my-certificates', s), isA<StaffCertificatesScreen>());
    expect(nativeScreen(staff, '/my-tax', s), isA<MyTaxScreen>());
    expect(nativeScreen(staff, '/my-payslips', s), isA<PayslipsScreen>());
  });

  testWidgets('issued to my department: to acknowledge, earlier, one in full, acknowledge', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const StaffIssuesScreen(profile: staff));
    expect(find.text('ISS/2026-27/0041 · Science'), findsOneWidget);
    expect(find.text(s.isToAck), findsOneWidget);
    expect(find.byKey(const Key('view-isSlip-41')), findsOneWidget);
    expect(find.byKey(const Key('isEarlier')), findsOneWidget);
    expect(find.text('ISS/2026-27/0042'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('isOpen-41')));
    expect(find.byKey(const Key('isDetail')), findsOneWidget);
    expect(find.text('Beaker 250 ml (BKR-250)'), findsOneWidget);
    expect(find.text('${s.isBatch('B7')} · ${s.isBack('2')}'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('isNote')), 'One cracked');
    await tapIn(tester, find.byKey(const Key('isAck')));
    expect(school.acked.single, {'note': 'One cracked'});
    expect(find.text(s.isAckDone), findsOneWidget);
  });

  testWidgets('my resignation: ask with the reason, the notice day and a letter', (tester) async {
    final (_, school) = await pump(tester, const ResignationScreen(profile: staff));
    expect(find.text(s.rsHead('Asha Teacher', 'E007', 'Teaching', 60)), findsOneWidget);
    expect(find.byKey(const Key('rsAskCard')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('rsSend')));
    expect(find.text(s.rsNeedReason), findsOneWidget);
    expect(school.exits, isEmpty);
    await tester.enterText(find.byKey(const Key('rsReason')), 'Moving to another city');
    await tapIn(tester, find.byKey(const Key('rsLetter')));
    expect(find.text('letter.pdf'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('rsSend')));
    final body = school.exits.single;
    expect(body['exitType'], 'RESIGN');
    expect(body['reason'], 'Moving to another city');
    expect(body['letterFileId'], 'f9');
    expect('${body['proposedLastDay']}', matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(find.text(s.rsSent), findsOneWidget);
    // the earlier one
    expect(find.textContaining(s.rsStatus('withdrawn')), findsOneWidget);
  });

  testWidgets('my resignation waiting, sent back and accepted', (tester) async {
    var (_, school) = await pump(
      tester,
      const ResignationScreen(profile: staff),
      school: School(exit: 'pending'),
    );
    expect(find.text('Resignation: ${s.rsStatus('pending')}'), findsOneWidget);
    expect(find.text('Principal'), findsOneWidget);
    expect(find.byKey(const Key('view-rsLetter-7')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('rsWithdraw')));
    await tapIn(tester, find.byKey(const Key('rsWithdrawYes')));
    expect(school.withdrawn, ['7']);

    (_, school) = await pump(
      tester,
      const ResignationScreen(profile: staff),
      school: School(exit: 'sent_back'),
    );
    expect(find.text(s.rsSentBack('Attach the signed letter')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('rsReason')), 'Moving, letter signed');
    await tapIn(tester, find.byKey(const Key('rsResend')));
    expect(school.resent.single['reason'], 'Moving, letter signed');
    expect(school.resent.single['proposedLastDay'], '2026-12-31');

    await pump(
      tester,
      const ResignationScreen(profile: staff),
      school: School(exit: 'approved'),
    );
    expect(find.text('Resignation: ${s.rsStatus('approved')}'), findsOneWidget);
    expect(find.byKey(const Key('view-rsAcc-7')), findsOneWidget);
    expect(find.byKey(const Key('view-rsFnf-7')), findsOneWidget);
    expect(find.text(s.rsNoDues(1, 2)), findsOneWidget);
  });

  testWidgets('my certificates: ask, follow, withdraw, the issued one as PDF', (tester) async {
    final (t, school) = await pump(tester, const StaffCertificatesScreen(profile: staff));
    // staff certificates only
    expect(find.text('Experience certificate'), findsWidgets);
    expect(find.text('Bonafide'), findsNothing);
    await tapIn(tester, find.text('Experience certificate').first);
    await tapIn(tester, find.byKey(const Key('scSend-EXP')));
    expect(find.text(s.scNeedPurpose), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('scPurpose-EXP')));
    await tapIn(tester, find.text('Visa').last);
    await tapIn(tester, find.byKey(const Key('scMore-EXP')));
    await tapIn(tester, find.byKey(const Key('scSend-EXP')));
    expect(school.asked.single, {'typeCode': 'EXP', 'purpose': 'Visa', 'copies': 2});
    expect(find.text(s.scAsked), findsOneWidget);
    expect(find.text(s.scStage('waiting')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('scWithdraw-5')));
    await tapIn(tester, find.byKey(const Key('scWithdrawYes')));
    expect(school.certWithdrawn, ['5']);
    expect(find.text('EXP/2026/0009 · ${s.date('2026-10-01')}'), findsOneWidget);
    expect(find.byKey(const Key('scPdf-9')), findsOneWidget);
    expect(t.calls.where((c) => c.path.contains('/pdf')), isEmpty);
  });

  testWidgets('my tax: the year’s tax, withdraw, declare, an earlier employer, the regime', (
    tester,
  ) async {
    final (_, school) = await pump(tester, const MyTaxScreen(profile: staff));
    expect(find.text(s.txTitle('2026-27')), findsOneWidget);
    expect(find.text('₹43,950.40'), findsWidgets);
    expect(find.text(s.txLine('taxable')), findsOneWidget);
    // only the lines with an amount
    expect(find.text(s.txLine('rebate')), findsNothing);
    expect(find.text(s.txPlanState('deducted')), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('txWithdraw-d1')));
    expect(school.declWithdrawn, ['d1']);
    // declare 80C
    await tapIn(tester, find.byKey(const Key('txDeclare')));
    await tapIn(tester, find.byKey(const Key('txDeclareSend')));
    expect(find.text(s.txNeedAmount), findsOneWidget);
    await tester.enterText(find.byKey(const Key('txAmount')), '1,20,000');
    await tapIn(tester, find.byKey(const Key('txProofs-add')));
    await tapIn(tester, find.byKey(const Key('txDeclareSend')));
    expect(school.declared.single, {
      'fy': '2026-27',
      'lineCode': 'S80C',
      'amount': '120000',
      'proofFileIds': ['f9'],
    });
    expect(find.text('Declared: it counts from the next run.'), findsOneWidget);
    // the earlier employer
    await tapIn(tester, find.byKey(const Key('txPrevOpen')));
    await tester.enterText(find.byKey(const Key('txEmployer')), 'Earlier School Sample');
    await tester.enterText(find.byKey(const Key('txTan')), 'abcd12345e');
    await tester.enterText(find.byKey(const Key('txGross')), '200000');
    await tester.enterText(find.byKey(const Key('txTds')), '5000');
    await tapIn(tester, find.byKey(const Key('txPrevSave')));
    expect(school.prev.single, {
      'fy': '2026-27',
      'employerName': 'Earlier School Sample',
      'employerTan': 'ABCD12345E',
      'gross': '200000',
      'exempt': '0',
      'pf': '0',
      'pt': '0',
      'tds': '5000',
      'proofFileIds': <String>[],
    });
    // the regime: to the other one
    await tapIn(tester, find.byKey(const Key('txRegimeSave')));
    expect(school.regimes.single, {'fy': '2026-27', 'regime': 'OLD'});
    expect(find.text('Your regime is now old.'), findsOneWidget);
  });

  testWidgets('my tax: HRA by month with the landlord', (tester) async {
    final (_, school) = await pump(tester, const MyTaxScreen(profile: staff));
    await tapIn(tester, find.byKey(const Key('txDeclare')));
    await tapIn(tester, find.byKey(const Key('txSection')));
    await tapIn(tester, find.text('House rent (HRA) ${s.txOldOnly}').last);
    await tester.enterText(find.byKey(const Key('txRent-2026-04')), '12000');
    await tester.enterText(find.byKey(const Key('txRent-2026-05')), '12,000');
    await tapIn(tester, find.byKey(const Key('txDeclareSend')));
    expect(find.text(s.txNeedLandlord), findsOneWidget);
    await tester.enterText(find.byKey(const Key('txCity')), 'Sample City');
    await tester.enterText(find.byKey(const Key('txLandlord')), 'Owner Sample');
    await tester.enterText(find.byKey(const Key('txAddress')), '1 Sample Road');
    await tester.enterText(find.byKey(const Key('txRelation')), 'None');
    await tapIn(tester, find.byKey(const Key('txDeclareSend')));
    final body = school.declared.single;
    expect(body['lineCode'], 'HRA_RENT');
    expect(body['hra'], {
      'months': [
        {'month': '2026-04', 'rent': '12000'},
        {'month': '2026-05', 'rent': '12000'},
      ],
      'city': 'Sample City',
      'landlord': {'name': 'Owner Sample', 'address': '1 Sample Road', 'relation': 'None'},
    });
  });

  testWidgets('my payslips as the website: figures, each month, letters', (tester) async {
    await pump(tester, const PayslipsScreen(profile: staff));
    expect(find.text(s.psPassword('your PAN in capitals')), findsOneWidget);
    expect(find.text('₹70,210'), findsOneWidget);
    expect(find.text('₹65,210'), findsOneWidget);
    expect(find.text(s.psRun('BONUS')), findsOneWidget);
    expect(find.text(s.psHeld), findsOneWidget);
    expect(find.byKey(const Key('download-payslip-r1')), findsOneWidget);
    expect(find.byKey(const Key('view-salcert-2026')), findsOneWidget);
    expect(find.text(s.psLetter('INCREMENT', 'INC/2026/03', s.date('2026-04-01'))), findsOneWidget);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): issues, resignation, certificates, tax, payslips', (
      tester,
    ) async {
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
        const StaffIssuesScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
      await pump(
        tester,
        const IssueDetailScreen(profile: staff, id: '41'),
        hindi: hindi,
        dark: dark,
      );
      await check();
      for (final e in ['none', 'sent_back', 'approved']) {
        await pump(
          tester,
          const ResignationScreen(profile: staff),
          school: School(exit: e),
          hindi: hindi,
          dark: dark,
        );
        await check();
      }
      await pump(
        tester,
        const StaffCertificatesScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await tapIn(tester, find.byKey(const Key('scType-EXP')));
      await check();
      await pump(
        tester,
        const MyTaxScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await tapIn(tester, find.byKey(const Key('txDeclare')));
      await tapIn(tester, find.byKey(const Key('txPrevOpen')));
      await check();
      await pump(
        tester,
        const PayslipsScreen(profile: staff),
        hindi: hindi,
        dark: dark,
      );
      await check();
    });
  }

  testWidgets('large text (twice the size): nothing overflows', (tester) async {
    Future<void> at(Widget w, {School? school, Future<void> Function()? then}) async {
      await pump(tester, w, school: school, text: 2, size: const Size(360, 6000));
      if (then != null) await then();
      expect(tester.takeException(), isNull);
    }

    await at(const StaffIssuesScreen(profile: staff));
    await at(const IssueDetailScreen(profile: staff, id: '41'));
    for (final e in ['none', 'pending', 'sent_back', 'approved']) {
      await at(
        const ResignationScreen(profile: staff),
        school: School(exit: e),
      );
    }
    await at(
      const StaffCertificatesScreen(profile: staff),
      then: () => tapIn(tester, find.byKey(const Key('scType-EXP'))),
    );
    await at(
      const MyTaxScreen(profile: staff),
      then: () async {
        await tapIn(tester, find.byKey(const Key('txDeclare')));
        await tapIn(tester, find.byKey(const Key('txPrevOpen')));
      },
    );
    await at(const PayslipsScreen(profile: staff));
  });
}
