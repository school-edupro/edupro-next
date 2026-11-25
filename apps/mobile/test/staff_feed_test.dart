// The staff app's Messages and Notices: the latest 10, then 10 more as the person scrolls (as the staff website).
// Every name and number here is made up.
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/messages.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/office_orders.dart';
import 'package:edupro/theme/theme.dart';
import 'package:edupro/ui/paged_feed.dart';
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

/// 23 messages and 23 notices: pages of 10, 10 and 3.
Object? answer(Call c) {
  final page = int.tryParse('${c.query?['page'] ?? 1}') ?? 1;
  final size = int.tryParse('${c.query?['size'] ?? 10}') ?? 10;
  final from = (page - 1) * size;
  final upto = (from + size).clamp(0, 23);
  switch ('${c.method} ${c.path}') {
    case 'GET /comms/inbox':
      return {
        'data': [
          for (var i = from; i < upto; i++)
            {
              'id': 'm$i',
              'messageIds': ['$i'],
              'title': 'Message $i',
              'subject': 'Message $i',
              'text': 'Text of message $i.',
              'html': null,
              'channels': ['app'],
              'student': null,
              'sentAt': '2026-11-20T05:00:00Z',
              'status': {},
              'readOnPhone': false,
              'unread': i == 0,
              'attachments': [],
            },
        ],
        'page': {'number': page, 'size': size, 'more': upto < 23},
      };
    case 'GET /academics/notices':
      return {
        'data': [
          for (var i = from; i < upto; i++)
            {
              'id': 'n$i',
              'kind': 'notice',
              'title': 'Notice $i',
              'body': 'Body of notice $i.',
              'bodyFormat': 'text',
              'publishFrom': '2026-11-20',
              'publishedBy': 'Dev Office',
              'isPinned': false,
              'ackRequired': false,
              'ackedByMe': false,
              'targets': [],
              'files': [],
            },
        ],
        'page': {'number': page, 'size': size, 'total': 23},
      };
    case 'POST /comms/inbox/read':
      return {'ok': true};
  }
  throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
}

Future<FakeTransport> pump(
  WidgetTester tester,
  Widget child, {
  bool hindi = false,
  bool dark = false,
}) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = const Size(420, 900) * 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final t = FakeTransport(answer);
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [transportProvider.overrideWithValue(t)],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        home: FamilyPage(title: 'Staff', child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

/// The list itself (not a text box's own scroller inside its header).
final _list = find
    .descendant(of: find.byType(RefreshIndicator), matching: find.byType(Scrollable))
    .first;

/// Scrolls the list down until [f] is built (the list loads its next page on the way).
Future<void> scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 400, scrollable: _list);
  await tester.pumpAndSettle();
}

void main() {
  final s = S(false);

  testWidgets('staff messages: the latest 10 first, then 10 more as it scrolls, then the end', (
    tester,
  ) async {
    final t = await pump(tester, const InboxList(profile: staff));
    List<Call> pages() => t.calls.where((c) => c.path == '/comms/inbox').toList();
    expect(pages().single.query, containsPair('size', 10));
    expect(find.byKey(const Key('message-m0')), findsOneWidget);
    expect(find.byKey(const Key('message-m10')), findsNothing);
    await scrollTo(tester, find.byKey(const Key('message-m15')));
    expect(pages().map((c) => c.query?['page']).take(2), [1, 2]);
    await scrollTo(tester, find.byKey(const Key('feedEnd')));
    expect(pages().map((c) => c.query?['page']), [1, 2, 3]);
    expect(find.byKey(const Key('message-m22')), findsOneWidget);
    expect(find.text(s.pfEnd), findsOneWidget);
  });

  testWidgets('staff notices: 10 at a time with the total; a filter starts again from the newest', (
    tester,
  ) async {
    final t = await pump(tester, const NoticesList(profile: staff));
    List<Call> pages() => t.calls.where((c) => c.path == '/academics/notices').toList();
    expect(pages().single.query, containsPair('size', 10));
    expect(find.byKey(const Key('noticesCount')), findsOneWidget);
    expect(find.byKey(const Key('notice-n0')), findsOneWidget);
    expect(find.byKey(const Key('notice-n10')), findsNothing);
    await scrollTo(tester, find.byKey(const Key('notice-n12')));
    expect(pages().map((c) => c.query?['page']).take(2), [1, 2]);
    // a type chosen: the API is asked again from page 1 with it
    await tester.drag(_list, const Offset(0, 4000));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('noticeKind-circular')));
    await tester.pumpAndSettle();
    expect(pages().last.query, allOf(containsPair('page', 1), containsPair('kind', 'circular')));
  });

  testWidgets('office orders: 10 office orders first, more as it scrolls; all notices the same', (
    tester,
  ) async {
    final t = await pump(tester, const OfficeOrdersScreen(profile: staff));
    List<Call> pages() => t.calls.where((c) => c.path == '/academics/notices').toList();
    expect(
      pages().first.query,
      allOf(containsPair('kind', 'office_order'), containsPair('size', 10)),
    );
    expect(find.byKey(const Key('ooOrder-n0')), findsOneWidget);
    expect(find.byKey(const Key('ooOrder-n10')), findsNothing);
    await scrollTo(tester, find.byKey(const Key('ooOrder-n12')));
    expect(pages().map((c) => c.query?['page']).take(2), [1, 2]);
    await tester.tap(find.text(S(false).ooAllTab));
    await tester.pumpAndSettle();
    expect(pages().last.query, allOf(containsPair('page', 1), isNot(contains('kind'))));
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the staff message and notice lists', (tester) async {
      for (final w in const [
        InboxList(profile: staff),
        NoticesList(profile: staff),
        OfficeOrdersScreen(profile: staff),
      ]) {
        await pump(tester, w, hindi: hindi, dark: dark);
        for (final g in [
          textContrastGuideline,
          androidTapTargetGuideline,
          labeledTapTargetGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g));
        }
      }
    });
  }
}
