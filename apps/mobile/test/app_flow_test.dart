import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/family/assistant.dart' show AssistantScreen;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// Every name and number here is made up.
const profiles = [
  {
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
  },
  {
    'id': 'parent:7:41',
    'kind': 'parent',
    'schoolId': '7',
    'schoolCode': 'SAMPLE',
    'schoolName': 'Sample School',
    'name': 'Kid Sample',
    'detail': 'VI-A · A1234',
    'studentId': '41',
    'app': 'parent',
    'actingAs': 'family',
    'hasPhoto': false,
  },
];

dynamic api(Call c) {
  switch ('${c.method} ${c.path}') {
    case 'POST /auth/otp/start':
      if (c.body!['login'] == '9000000000') {
        throw const ApiException(409, 'conflict', 'Wait a moment before asking for another code.');
      }
      return {
        'challengeId': '00000000-0000-4000-8000-000000000001',
        'sentTo': 'a***@example.test',
        'screenCode': '424242',
      };
    case 'POST /auth/mobile/verify':
      if (c.body!['code'] != '424242') {
        throw const ApiException(
          401,
          'auth.otp_wrong',
          'The code is not right. Check it and try again.',
        );
      }
      return {
        'accessToken': 'otp.a',
        'expiresAt': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
        'refreshToken': 'r' * 43,
        'sessionId': 's1',
        'displayName': 'Asha Teacher',
      };
    case 'POST /me/sign-in':
      return null;
    case 'GET /me/profiles':
      return {'data': profiles};
    case 'GET /me/menu':
      return c.query!['kind'] == 'staff'
          ? {
              'app': 'teacher',
              'groups': [
                {
                  'id': 'classes',
                  'label': 'My classes',
                  'icon': 'book',
                  'items': [
                    {
                      'href': '/attendance',
                      'label': 'Attendance',
                      'help': 'Mark today’s attendance for your sections',
                      'icon': 'check',
                    },
                  ],
                },
              ],
            }
          : {
              'app': 'parent',
              'groups': [
                {
                  'id': 'child',
                  'label': 'My child',
                  'icon': 'users',
                  'items': [
                    {'href': '/homework', 'label': 'Homework', 'help': null, 'icon': 'users'},
                    {'href': '/assistant', 'label': 'Assistant', 'help': null, 'icon': 'message'},
                  ],
                },
              ],
            };
    case 'POST /auth/mobile/sign-out':
      return {'signedOut': true};
    case 'GET /public/schools/SAMPLE/logo':
      // a 1 × 1 PNG
      return {
        'contentType': 'image/png',
        'base64': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      };
  }
  throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
}

Future<(FakeTransport, MemorySecureStore)> pumpApp(
  WidgetTester tester, {
  MemorySecureStore? store,
}) async {
  SharedPreferences.setMockInitialValues({});
  // a phone's screen (the sign-in sheet is taller than the test's default 800 × 600)
  await tester.binding.setSurfaceSize(const Size(400, 860));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final t = FakeTransport(api);
  final mem = store ?? MemorySecureStore();
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
  return (t, mem);
}

void main() {
  testWidgets('first sign-in: the code, a wrong one, the PIN, then home as staff', (tester) async {
    final (t, mem) = await pumpApp(tester);
    expect(find.text('Welcome'), findsOneWidget);
    // a phone that has not signed in yet: EduPro's mark, and Mobilise at the foot
    expect(find.byKey(const Key('bandSchoolName')), findsOneWidget);
    expect(find.text('EduPro'), findsOneWidget);
    expect(find.byKey(const Key('poweredBy')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('login')), 'asha@example.test');
    await tester.tap(find.byKey(const Key('primary')));
    await tester.pumpAndSettle();
    expect(find.textContaining('a***@example.test'), findsOneWidget);
    expect(find.textContaining('424242'), findsOneWidget);
    // the six boxes send a full code on their own
    await tester.enterText(find.byKey(const Key('code')), '111111');
    await tester.pumpAndSettle();
    expect(find.text('The code is not right. Check it and try again.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('code')), '424242');
    await tester.pumpAndSettle();
    final verify = t.calls.firstWhere(
      (c) => c.path == '/auth/mobile/verify' && c.body!['code'] == '424242',
    );
    expect((verify.body!['device'] as Map)['id'], 'phone-test0001');
    expect(mem.values['refresh_token'], 'r' * 43);
    // the app PIN
    expect(find.text('Set an app PIN'), findsOneWidget);
    await enterPin(tester, '2468');
    await tester.tap(find.byKey(const Key('pinNext')));
    await tester.pumpAndSettle();
    expect(find.text('The same PIN again'), findsOneWidget);
    await enterPin(tester, '1357');
    expect(find.text('The two PINs are not the same.'), findsOneWidget);
    await enterPin(tester, '2468');
    expect(find.text('My day'), findsWidgets);
    expect(find.text('Asha Teacher'), findsOneWidget);
    expect(find.textContaining('Staff · Sample School'), findsOneWidget);
  });

  testWidgets(
    'opening a signed-in phone asks the PIN; switching to the parent profile; More in Hindi',
    (tester) async {
      final mem = MemorySecureStore();
      final s = SessionStore(mem);
      await s.save(
        accessToken: 'otp.a',
        expiresAt: DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
        refreshToken: 'r' * 43,
      );
      await s.setPin('2468');
      final (t, _) = await pumpApp(tester, store: mem);
      expect(find.text('Open EduPro'), findsWidgets);
      expect(find.byKey(const Key('pinKey-1')), findsOneWidget);
      await enterPin(tester, '1111');
      expect(find.text('That PIN is not right.'), findsOneWidget);
      await enterPin(tester, '2468');
      expect(find.text('Asha Teacher'), findsOneWidget);
      // Ask on Home only when the menu has the assistant (this teacher's has not)
      expect(find.byKey(const Key('homeAsk')), findsNothing);

      // switch to the parent of the child
      await tester.tap(find.byKey(const Key('profileSwitch')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('profile-parent:7:41')));
      await tester.pumpAndSettle();
      expect(find.text('Kid Sample'), findsOneWidget);
      expect(find.text('VI-A · A1234'), findsOneWidget);
      expect(find.byKey(const Key('homeAsk')), findsOneWidget);
      await tester.tap(find.byKey(const Key('homeAsk')));
      await tester.pumpAndSettle();
      expect(find.byType(AssistantScreen), findsOneWidget);
      // the chat window has its own Close
      await tester.tap(find.byKey(const Key('asstClose')));
      await tester.pumpAndSettle();

      // More: the parent's menu, then in Hindi
      await tester.tap(find.text('More'));
      await tester.pumpAndSettle();
      expect(find.text('Homework'), findsOneWidget);
      // Ask is Home's
      expect(find.byKey(const Key('homeAsk')), findsNothing);
      expect(t.calls.where((c) => c.path == '/me/menu').last.query, {'kind': 'parent'});
      await tester.tap(find.byIcon(Icons.settings_outlined));
      await tester.pumpAndSettle();
      await tester.tap(find.text('हिन्दी'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      // the menu's words in Hindi from the web apps' own dictionary
      expect(find.text('गृहकार्य'), findsOneWidget);
    },
  );

  testWidgets('signing out of the phone goes back to sign-in and forgets the session', (
    tester,
  ) async {
    final mem = MemorySecureStore();
    final s = SessionStore(mem);
    await s.save(
      accessToken: 'otp.a',
      expiresAt: DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
      refreshToken: 'r' * 43,
    );
    await s.setPin('2468');
    final (t, _) = await pumpApp(tester, store: mem);
    await enterPin(tester, '2468');
    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('signOut')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/auth/mobile/sign-out'), isTrue);
    expect(find.byKey(const Key('login')), findsOneWidget);
    expect(mem.values['refresh_token'], isNull);
    expect(mem.values['pin_length'], isNull);
    // the phone remembers its school: the sign-in screen shows its name and logo (fetched once), and Mobilise
    expect(tester.widget<Text>(find.byKey(const Key('bandSchoolName'))).data, 'Sample School');
    expect(find.byKey(const Key('schoolLogo')), findsOneWidget);
    expect(find.byKey(const Key('poweredBy')), findsOneWidget);
    expect(t.calls.where((c) => c.path == '/public/schools/SAMPLE/logo').length, 1);
  });

  testWidgets('a PIN set before its length was kept opens with the Open button', (tester) async {
    final mem = MemorySecureStore();
    final s = SessionStore(mem);
    await s.save(
      accessToken: 'otp.a',
      expiresAt: DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
      refreshToken: 'r' * 43,
    );
    await s.setPin('24680');
    mem.values.remove('pin_length');
    await pumpApp(tester, store: mem);
    await enterPin(tester, '2468');
    // four digits could be the whole PIN or not: nothing happens until Open
    expect(find.text('Open EduPro'), findsWidgets);
    await tester.tap(find.byKey(const Key('pinSubmit')));
    await tester.pumpAndSettle();
    expect(find.text('That PIN is not right.'), findsOneWidget);
    await enterPin(tester, '24680');
    await tester.tap(find.byKey(const Key('pinSubmit')));
    await tester.pumpAndSettle();
    expect(find.text('Asha Teacher'), findsOneWidget);
  });

  testWidgets('choosing the PIN: "Choose another PIN" goes back to the first step', (tester) async {
    final mem = MemorySecureStore();
    final s = SessionStore(mem);
    await s.save(
      accessToken: 'otp.a',
      expiresAt: DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
      refreshToken: 'r' * 43,
    );
    await pumpApp(tester, store: mem);
    expect(find.text('Set an app PIN'), findsOneWidget);
    // Next waits for four digits
    await enterPin(tester, '24');
    expect(tester.widget<FilledButton>(find.byKey(const Key('pinNext'))).onPressed, isNull);
    await tester.tap(find.byKey(const Key('pinDelete')));
    await enterPin(tester, '46813');
    await tester.tap(find.byKey(const Key('pinNext')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pinStartAgain')));
    await tester.pumpAndSettle();
    expect(find.text('Set an app PIN'), findsOneWidget);
    await enterPin(tester, '1357');
    await tester.tap(find.byKey(const Key('pinNext')));
    await tester.pumpAndSettle();
    await enterPin(tester, '1357');
    expect(find.text('Asha Teacher'), findsOneWidget);
    expect(await s.checkPin('1357'), isTrue);
    expect(await s.pinLength, 4);
  });

  for (final dark in [false, true]) {
    testWidgets(
      'accessibility (${dark ? 'dark' : 'light'}): sign-in, code and PIN screens — tap targets, labels, contrast',
      (tester) async {
        tester.platformDispatcher.platformBrightnessTestValue = dark
            ? Brightness.dark
            : Brightness.light;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final handle = tester.ensureSemantics();
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

        await pumpApp(tester);
        await check('sign-in');
        await tester.enterText(find.byKey(const Key('login')), 'asha@example.test');
        await tester.tap(find.byKey(const Key('primary')));
        await check('code');
        await tester.enterText(find.byKey(const Key('code')), '424242');
        await check('choose a PIN');
        await enterPin(tester, '2468');
        await tester.tap(find.byKey(const Key('pinNext')));
        await check('the PIN again');
        handle.dispose();
      },
    );
  }
}
