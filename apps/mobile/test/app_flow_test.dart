import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
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
                  ],
                },
              ],
            };
    case 'POST /auth/mobile/sign-out':
      return {'signedOut': true};
  }
  throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
}

Future<(FakeTransport, MemorySecureStore)> pumpApp(
  WidgetTester tester, {
  MemorySecureStore? store,
}) async {
  SharedPreferences.setMockInitialValues({});
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
    expect(find.text('Sign in'), findsWidgets);
    await tester.enterText(find.byKey(const Key('login')), 'asha@example.test');
    await tester.tap(find.byKey(const Key('primary')));
    await tester.pumpAndSettle();
    expect(find.textContaining('a***@example.test'), findsOneWidget);
    expect(find.textContaining('424242'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('code')), '111111');
    await tester.tap(find.byKey(const Key('primary')));
    await tester.pumpAndSettle();
    expect(find.text('The code is not right. Check it and try again.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('code')), '424242');
    await tester.tap(find.byKey(const Key('primary')));
    await tester.pumpAndSettle();
    final verify = t.calls.firstWhere(
      (c) => c.path == '/auth/mobile/verify' && c.body!['code'] == '424242',
    );
    expect((verify.body!['device'] as Map)['id'], 'phone-test0001');
    expect(mem.values['refresh_token'], 'r' * 43);
    // the app PIN
    expect(find.text('Set an app PIN'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('pin')), '2468');
    await tester.enterText(find.byKey(const Key('pinAgain')), '1357');
    await tester.tap(find.byKey(const Key('pinSubmit')));
    await tester.pumpAndSettle();
    expect(find.text('The two PINs are not the same.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('pinAgain')), '2468');
    await tester.tap(find.byKey(const Key('pinSubmit')));
    await tester.pumpAndSettle();
    expect(find.text('Welcome, Asha Teacher'), findsOneWidget);
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
      await tester.enterText(find.byKey(const Key('pin')), '1111');
      await tester.tap(find.byKey(const Key('pinSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('That PIN is not right.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('pin')), '2468');
      await tester.tap(find.byKey(const Key('pinSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('Welcome, Asha Teacher'), findsOneWidget);

      // switch to the parent of the child
      await tester.tap(find.byKey(const Key('profileSwitch')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('profile-parent:7:41')));
      await tester.pumpAndSettle();
      expect(find.text('Welcome, Kid Sample'), findsOneWidget);
      expect(find.text('VI-A · A1234'), findsOneWidget);

      // More: the parent's menu, then in Hindi
      await tester.tap(find.text('More'));
      await tester.pumpAndSettle();
      expect(find.text('Homework'), findsOneWidget);
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
    await tester.enterText(find.byKey(const Key('pin')), '2468');
    await tester.tap(find.byKey(const Key('pinSubmit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('signOut')));
    await tester.pumpAndSettle();
    expect(t.calls.any((c) => c.path == '/auth/mobile/sign-out'), isTrue);
    expect(find.byKey(const Key('login')), findsOneWidget);
    expect(mem.values['refresh_token'], isNull);
  });
}
