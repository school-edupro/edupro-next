import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/attendance.dart' show leaveFilePickerProvider;
import 'package:edupro/family/common.dart';
import 'package:edupro/family/queries.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/data.dart' show PickedFile;
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

const kid = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);

/// A made-up school's helpdesk (no real names).
class Desk {
  String status = 'answered';
  bool canReopen = false;
  int? rating;

  Map<String, Object?> row(String id, String st, {String kind = 'query'}) => {
    'id': id,
    'number': 'Q-$id',
    'kind': kind,
    'categoryName': 'Transport',
    'studentName': 'Kid Sample',
    'subject': 'Bus was late',
    'status': st,
    'decision': kind == 'leave' ? 'approved' : null,
    'rating': id == '72' ? 4 : null,
    'openedAt': '2026-11-10T04:00:00Z',
  };

  Object? answer(Call c) {
    switch ('${c.method} ${c.path}') {
      case 'GET /engagement/mine/queries':
        return {
          'data': [row('71', 'open'), row('72', 'closed'), row('73', 'answered', kind: 'leave')],
          'page': {'total': 14},
        };
      case 'GET /engagement/mine/categories':
        return {
          'data': [
            {'code': 'transport', 'name': 'Transport'},
            {'code': 'other', 'name': 'Other'},
          ],
        };
      case 'POST /engagement/mine/queries':
        return {'id': '90'};
      case 'POST /platform/files':
        return {
          'file': {'id': '55'},
          'upload': {'url': '/upload/55', 'method': 'PUT'},
        };
      case 'PUT /upload/55':
        return null;
      case 'POST /platform/files/55/complete':
        return {'ok': true};
      case 'POST /engagement/feedback':
        return {'id': 'f1'};
      case 'GET /engagement/mine/queries/71':
        return {
          ...row('71', status),
          'body': 'The bus came 30 minutes late today.',
          'fileIds': ['501'],
          'leaveFrom': null,
          'leaveTo': null,
          'assignedTo': 'Transport desk',
          'rating': rating,
          'ratingComment': null,
          'responses': [
            {
              'id': 'r1',
              'author': 'Transport desk',
              'authorKind': 'staff',
              'body': 'We have spoken to the driver.',
              'fileIds': [],
              'createdAt': '2026-11-11T05:00:00Z',
            },
          ],
        };
      case 'GET /engagement/mine/queries/71/timeline':
        return {
          'resolution': status == 'closed' ? 'Driver warned; route timing fixed.' : null,
          'level': 1,
          'you': {'canReopen': canReopen, 'reopenUntil': '2026-11-30T00:00:00Z'},
        };
      case 'GET /engagement/mine/queries/71/files/501':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'q.pdf',
        );
      case 'POST /engagement/mine/queries/71/responses':
      case 'POST /engagement/mine/queries/71/reopen':
      case 'POST /engagement/mine/queries/71/rate':
        return {'ok': true};
    }
    throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
  }
}

Future<FakeTransport> pump(
  WidgetTester tester,
  Widget child, {
  Desk? desk,
  bool hindi = false,
  bool dark = false,
  double text = 1,
}) async {
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final t = FakeTransport((desk ?? Desk()).answer);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        transportProvider.overrideWithValue(t),
        leaveFilePickerProvider.overrideWithValue(
          () async => const [
            PickedFile(name: 'ticket.pdf', bytes: [37, 80, 68, 70], contentType: 'application/pdf'),
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
        home: FamilyPage(title: 'Queries', child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

Future<void> tall(WidgetTester tester, [Size size = const Size(420, 2800)]) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
}

Future<void> reach(WidgetTester tester, Finder f) async {
  if (f.evaluate().isEmpty) {
    await tester.dragUntilVisible(f, find.byType(ListView).first, const Offset(0, -250));
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

Future<void> tapIn(WidgetTester tester, Finder f) async {
  await reach(tester, f);
  await tester.tap(f);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the list as on the website: count, status and type, search, pages, quick feedback', (
    tester,
  ) async {
    await tall(tester);
    final t = await pump(tester, const QueriesScreen(profile: kid));
    expect(find.text('Queries, complaints and leave'), findsOneWidget);
    expect(find.text('14 in all · latest first'), findsOneWidget);
    expect(t.calls.last.query, {'studentId': '41', 'order': 'latest', 'page': 1, 'size': 10});
    expect(find.text('Q-71 · Query · Transport · Kid Sample · 10 Nov 2026'), findsOneWidget);
    expect(find.text('Open'), findsWidgets);
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('★★★★'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('qryStatus-active')));
    expect(t.calls.last.query!['status'], 'active');
    await tapIn(tester, find.byKey(const Key('qryKind-complaint')));
    expect(t.calls.last.query!['kind'], 'complaint');
    await reach(tester, find.byKey(const Key('qrySearch')));
    await tester.enterText(find.byKey(const Key('qrySearch')), 'Q-71');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(t.calls.last.query!['q'], 'Q-71');
    expect(find.text('14 found · latest first'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('qryNext')));
    expect(t.calls.last.query!['page'], 2);
    // quick feedback: a rating is needed
    await tapIn(tester, find.byKey(const Key('qryFbSend')));
    expect(find.text('Choose a rating.'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('qryFbStar-5')));
    await tester.enterText(find.byKey(const Key('qryFbComment')), 'Very helpful');
    await tapIn(tester, find.byKey(const Key('qryFbSend')));
    expect(t.calls.lastWhere((c) => c.path == '/engagement/feedback').body, {
      'studentId': '41',
      'category': 'teaching',
      'rating': 5,
      'comment': 'Very helpful',
    });
    expect(find.text('Thank you for your feedback.'), findsOneWidget);
  });

  testWidgets('a new complaint with a file: subject and details asked for; sent with the file', (
    tester,
  ) async {
    await tall(tester);
    final t = await pump(tester, const QueryForm(profile: kid));
    await tapIn(tester, find.byKey(const Key('qrySend')));
    expect(find.text('Write a subject (at least 3 letters).'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('qryFormKind-complaint')));
    await tester.enterText(find.byKey(const Key('qrySubject')), 'Bus was late');
    await tapIn(tester, find.byKey(const Key('qrySend')));
    expect(find.text('Write the details.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('qryBody')), 'The bus came 30 minutes late.');
    await tapIn(tester, find.byKey(const Key('qryNew-addFile')));
    expect(find.text('ticket.pdf'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('qrySend')));
    expect(t.calls.any((c) => c.method == 'PUT' && c.path == '/upload/55'), isTrue);
    expect(t.calls.lastWhere((c) => c.path == '/engagement/mine/queries').body, {
      'studentId': '41',
      'kind': 'complaint',
      'categoryCode': 'other',
      'subject': 'Bus was late',
      'body': 'The bus came 30 minutes late.',
      'fileIds': ['55'],
    });
  });

  testWidgets('a query in full: the answers, a file, a reply sent', (tester) async {
    await tall(tester);
    final t = await pump(
      tester,
      const QueryDetail(profile: kid, id: '71', saved: true),
      desk: Desk()..status = 'open',
    );
    expect(find.text('Q-71 · Transport'), findsOneWidget);
    expect(find.text('Bus was late'), findsOneWidget);
    expect(find.textContaining('handled by Transport desk'), findsOneWidget);
    expect(find.text('Saved.'), findsOneWidget);
    expect(find.text('We have spoken to the driver.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('view-qf-501')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/engagement/mine/queries/71/files/501'), isTrue);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    await reach(tester, find.byKey(const Key('qryReplyText')));
    await tester.enterText(find.byKey(const Key('qryReplyText')), 'Thank you.');
    await tapIn(tester, find.byKey(const Key('qryReplySend')));
    expect(t.calls.lastWhere((c) => c.path.endsWith('/responses')).body, {
      'body': 'Thank you.',
      'fileIds': <String>[],
    });
    // no rating while it is open
    expect(find.byKey(const Key('qryRate')), findsNothing);
  });

  testWidgets('closed: the resolution, reopening within the window, the rating', (tester) async {
    await tall(tester, const Size(420, 3400));
    final desk = Desk()
      ..status = 'closed'
      ..canReopen = true;
    final t = await pump(
      tester,
      const QueryDetail(profile: kid, id: '71'),
      desk: desk,
    );
    expect(find.text('Resolution: Driver warned; route timing fixed.'), findsOneWidget);
    expect(find.byKey(const Key('qryReplyText')), findsNothing);
    expect(find.text('You can reopen it until 30 Nov 2026'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('qryReopen')));
    expect(find.text('Write why (at least 3 letters).'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('qryReopenReason')), 'Still late today');
    await tapIn(tester, find.byKey(const Key('qryReopen')));
    expect(t.calls.lastWhere((c) => c.path.endsWith('/reopen')).body, {
      'reason': 'Still late today',
      'fileIds': <String>[],
    });
    await tapIn(tester, find.byKey(const Key('qryRateStar-3')));
    await tapIn(tester, find.byKey(const Key('qryRate')));
    expect(t.calls.lastWhere((c) => c.path.endsWith('/rate')).body, {'rating': 3});
  });

  testWidgets('rated already: what was given', (tester) async {
    await tall(tester);
    await pump(
      tester,
      const QueryDetail(profile: kid, id: '71'),
      desk: Desk()
        ..status = 'answered'
        ..rating = 5,
    );
    expect(find.text('You rated this 5 of 5'), findsOneWidget);
    expect(find.byKey(const Key('qryRate')), findsNothing);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the list, the form and a query', (tester) async {
      await tall(tester);
      final handle = tester.ensureSemantics();
      for (final w in [
        const QueriesScreen(profile: kid),
        const QueryForm(profile: kid),
        const QueryDetail(profile: kid, id: '71'),
      ]) {
        await pump(tester, w, hindi: hindi, dark: dark);
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(
            tester,
            meetsGuideline(g),
            reason: '${w.runtimeType}: ${g.description}',
          );
        }
      }
      handle.dispose();
    });
  }

  testWidgets('large text (twice the size) on a phone: the list, the form and a query', (
    tester,
  ) async {
    await tall(tester, const Size(360, 780));
    for (final hindi in [false, true]) {
      for (final w in [
        const QueriesScreen(profile: kid),
        const QueryForm(profile: kid),
        const QueryDetail(profile: kid, id: '71'),
      ]) {
        await pump(tester, w, hindi: hindi, text: 2, desk: Desk()..canReopen = true);
        expect(tester.takeException(), isNull, reason: '${w.runtimeType}');
        await tester.drag(find.byType(ListView).first, const Offset(0, -4000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '${w.runtimeType} scrolled');
      }
    }
    expect(const S(false).qryKind('leave'), 'Leave request');
  });
}
