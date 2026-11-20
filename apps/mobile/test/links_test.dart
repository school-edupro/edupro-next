import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/push/links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// A tapped notification or a shared link opens its page in the right profile (docs/design/89 §5.3, phase D).
/// Every name and number here is made up.
const staff = Profile(
  id: 'staff:7',
  kind: 'staff',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Asha Teacher',
  app: 'teacher',
);
const parent = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
  actingAs: 'family',
);
const otherSchool = Profile(
  id: 'staff:9',
  kind: 'staff',
  schoolId: '9',
  schoolName: 'Other School',
  name: 'Asha Teacher',
  app: 'teacher',
);

void main() {
  test('a link is a path of the web apps; an outside address or none is not followed', () {
    expect(LinkTarget.fromData({'link': '/homework'})!.path, '/homework');
    expect(
      LinkTarget.fromData({'url': 'https://parent.example.test/leaves?tab=inbox&open=12'})!.path,
      '/leaves?tab=inbox&open=12',
    );
    expect(LinkTarget.fromData({'link': '//evil.example.test/x'}), isNull);
    expect(LinkTarget.fromData({'title': 'No link'}), isNull);
    final t = LinkTarget.fromData({'link': '/fees', 'schoolId': '7', 'studentId': '41'})!;
    expect((t.schoolId, t.studentId), ('7', '41'));
  });

  test('the profile it is about: the child, the school\'s staff profile, or the one in use', () {
    final all = [staff, parent, otherSchool];
    expect(const LinkTarget(path: '/fees', studentId: '41').profileIn(all, staff), parent);
    expect(
      const LinkTarget(path: '/leaves', schoolId: '9', kind: 'staff').profileIn(all, staff),
      otherSchool,
    );
    // a page of another school than the profile in use: that school's profile
    expect(const LinkTarget(path: '/notices', schoolId: '9').profileIn(all, parent), otherSchool);
    expect(const LinkTarget(path: '/notices').profileIn(all, parent), parent);
  });

  testWidgets('a link to a child\'s homework switches a teacher who is a parent to the child', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({'profile': 'staff:7'});
    final t = FakeTransport((c) {
      switch ('${c.method} ${c.path}') {
        case 'GET /me/profiles':
          return {
            'data': [
              for (final p in [staff, parent])
                {
                  'id': p.id,
                  'kind': p.kind,
                  'schoolId': p.schoolId,
                  'schoolName': p.schoolName,
                  'name': p.name,
                  'app': p.app,
                  'studentId': p.studentId,
                  'actingAs': p.actingAs,
                },
            ],
          };
        case 'GET /academics/daily-work/viewer':
          return {
            'students': [
              {'id': '41', 'classSectionId': '300'},
            ],
          };
        case 'GET /academics/daily-work':
          return {
            'data': [
              {
                'id': '501',
                'kind': 'homework',
                'title': 'Plant a seed',
                // today: the Homework screen opens on today's work
                'assignedOn': DateTime.now().toIso8601String().substring(0, 10),
                'dueOn': null,
                'files': [],
                'ackRequired': false,
                'ackedFor': [],
              },
            ],
          };
      }
      throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
    });
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
    await enterPin(tester, '2468');
    ref.read(routerProvider).push('/open?link=%2Fhomework&schoolId=7&studentId=41');
    await tester.pumpAndSettle();
    expect(find.text('Plant a seed'), findsOneWidget);
    expect(ref.read(profilesProvider).value!.current, parent);
    // the child's calls carry the parent's headers
    expect(ref.read(profileHeadersProvider).actingAs, 'family');
  });
}
