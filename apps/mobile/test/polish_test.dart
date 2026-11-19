import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/push/links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// Phase D (docs/design/89): the person's notifications, phones, the update check, an approval push opening the
/// inbox. Every name and number here is made up.
const profiles = [
  {
    'id': 'staff:7',
    'kind': 'staff',
    'schoolId': '7',
    'schoolName': 'Sample School',
    'name': 'Asha Teacher',
    'app': 'teacher',
    'studentId': null,
    'actingAs': null,
  },
  {
    'id': 'parent:7:41',
    'kind': 'parent',
    'schoolId': '7',
    'schoolName': 'Sample School',
    'name': 'Kid Sample',
    'app': 'parent',
    'studentId': '41',
    'actingAs': 'family',
  },
];

class Server {
  bool mustUpdate = false;
  List<Object?> off = [];
  final signedOut = <String>[];

  dynamic answer(Call c) {
    switch ('${c.method} ${c.path}') {
      case 'GET /auth/mobile/app-version':
        return {
          'minimum': '2.0.0',
          'latest': '2.0.0',
          'mustUpdate': mustUpdate,
          'mayUpdate': mustUpdate,
          'storeUrl': 'https://play.example.test/edupro',
        };
      case 'GET /me/profiles':
        return {'data': profiles};
      case 'GET /comms/push/events':
        return {
          'events': ['school_message', 'notices', 'homework', 'approvals', 'attendance'],
          'off': off,
        };
      case 'PUT /comms/push/events':
        off = c.body!['off'] as List<Object?>;
        return {'events': [], 'off': off};
      case 'GET /auth/mobile/devices':
        return {
          'data': [
            {
              'id': 'd1',
              'name': 'This phone',
              'platform': 'android',
              'lastUsedAt': '2026-11-19T05:00:00Z',
              'current': true,
            },
            {
              'id': 'd2',
              'name': 'Old phone',
              'platform': 'ios',
              'lastUsedAt': '2026-10-01T05:00:00Z',
              'current': false,
            },
          ].where((d) => !signedOut.contains(d['id'])).toList(),
        };
      case 'POST /auth/mobile/devices/d2/sign-out':
        signedOut.add('d2');
        return {'signedOut': true};
      case 'GET /approvals/inbox':
        return {
          'total': 1,
          'kinds': [
            {'kind': 'leave', 'label': 'Student leave', 'count': 1},
          ],
          'items': [
            {
              'kind': 'leave',
              'id': '701',
              'title': 'Kid Sample · VI-A',
              'detail': null,
              'by': null,
              'at': null,
              'amount': null,
              'href': '/leaves',
              'app': 'teacher',
              'reasonOnReject': true,
              'reasonOnApprove': false,
              'decideHere': true,
              'approveAs': 'approve',
              'rejectAs': 'reject',
              'url': null,
            },
          ],
          'unavailable': [],
        };
    }
    throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
  }
}

Future<(FakeTransport, Server, WidgetRef)> pumpPhone(
  WidgetTester tester, {
  String profile = 'staff:7',
  bool mustUpdate = false,
}) async {
  SharedPreferences.setMockInitialValues({'profile': profile});
  final server = Server()..mustUpdate = mustUpdate;
  final t = FakeTransport(server.answer);
  final mem = MemorySecureStore();
  final s = SessionStore(mem);
  await s.save(
    accessToken: 'otp.a',
    expiresAt: DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
    refreshToken: 'r' * 43,
  );
  await s.setPin('2468');
  late WidgetRef ref;
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
      child: Consumer(
        builder: (_, r, _) {
          ref = r;
          return const EduProApp();
        },
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (!mustUpdate) {
    await enterPin(tester, '2468');
  }
  return (t, server, ref);
}

void main() {
  testWidgets('notifications: the school\'s kinds for this profile; one switched off and on', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(420, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final (t, server, _) = await pumpPhone(tester);
    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('notifications')));
    await tester.pumpAndSettle();
    // staff: approvals, no homework
    expect(find.byKey(const Key('push-approvals')), findsOneWidget);
    expect(find.byKey(const Key('push-homework')), findsNothing);
    await tester.tap(find.byKey(const Key('push-notices')));
    await tester.pumpAndSettle();
    expect(t.calls.lastWhere((c) => c.method == 'PUT').body, {
      'off': ['notices'],
    });
    expect(server.off, ['notices']);
    await tester.tap(find.byKey(const Key('push-notices')));
    await tester.pumpAndSettle();
    expect(server.off, isEmpty);
  });

  testWidgets('phones: this one marked; an old one signed out', (tester) async {
    final (_, server, _) = await pumpPhone(tester);
    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('phones')));
    await tester.pumpAndSettle();
    expect(find.textContaining('This phone ·'), findsOneWidget);
    expect(find.byKey(const Key('signOutPhone-d1')), findsNothing);
    await tester.tap(find.byKey(const Key('signOutPhone-d2')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('confirmSignOutPhone')));
    await tester.pumpAndSettle();
    expect(server.signedOut, ['d2']);
    expect(find.text('Old phone'), findsNothing);
  });

  testWidgets('a build below the minimum stops at "Update EduPro"', (tester) async {
    await pumpPhone(tester, mustUpdate: true);
    expect(find.byKey(const Key('updateRequired')), findsOneWidget);
    expect(find.text('Update'), findsOneWidget);
  });

  testWidgets('an approval push opens the Approvals inbox, switching a parent profile to staff', (
    tester,
  ) async {
    final (_, _, ref) = await pumpPhone(tester, profile: 'parent:7:41');
    ref.read(routerProvider).push('/open?link=%2F&event=approvals&schoolId=7');
    await tester.pumpAndSettle();
    expect(find.text('Kid Sample · VI-A'), findsOneWidget);
    expect(ref.read(profilesProvider).value!.current!.id, 'staff:7');
  });

  for (final dark in [false, true]) {
    testWidgets('accessibility (${dark ? 'dark' : 'light'}): notifications and phones', (
      tester,
    ) async {
      tester.platformDispatcher.platformBrightnessTestValue = dark
          ? Brightness.dark
          : Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      final handle = tester.ensureSemantics();
      await pumpPhone(tester);
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

      await tester.tap(find.byIcon(Icons.settings_outlined));
      await check('Settings');
      await tester.tap(find.byKey(const Key('notifications')));
      await check('Notifications');
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('phones')));
      await check('Phones');
      handle.dispose();
    });
  }

  test('the push names the kind: approvals are staff work, a family\'s answer decided is not', () {
    expect(LinkTarget.fromData({'link': '/', 'event': 'approvals'})!.kind, 'staff');
    expect(LinkTarget.fromData({'link': '/consents', 'event': 'approvals'})!.kind, isNull);
    expect(LinkTarget.fromData({'link': '/homework', 'event': 'homework'})!.kind, isNull);
    const staff = Profile(
      id: 'staff:7',
      kind: 'staff',
      schoolId: '7',
      schoolName: 'S',
      name: 'A',
      app: 'teacher',
    );
    expect(
      opensApprovals(LinkTarget.fromData({'link': '/leaves', 'event': 'approvals'})!, staff),
      isTrue,
    );
    expect(
      opensApprovals(LinkTarget.fromData({'link': '/notices', 'event': 'notices'})!, staff),
      isFalse,
    );
  });
}
