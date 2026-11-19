import 'package:dio/dio.dart';
import 'package:edupro/api/api_transport.dart';
import 'package:edupro/api/dio_transport.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

int now() => DateTime.now().millisecondsSinceEpoch ~/ 1000;

void main() {
  late SessionStore session;
  late int signedOut;

  /// A transport over fake networks: the API's calls and the refresh calls apart.
  ({DioTransport t, FakeAdapter api, FakeAdapter refresh}) build({
    required (int, Object?) Function(RequestOptions) api,
    required (int, Object?) Function(RequestOptions) refresh,
    ProfileHeaders profile = const ProfileHeaders(schoolId: '7', actingAs: 'family'),
  }) {
    final a = FakeAdapter(api);
    final r = FakeAdapter(refresh);
    final t = DioTransport(
      baseUrl: 'http://api.test',
      session: session,
      deviceId: () async => 'phone-123456',
      appVersion: '1.0.0',
      profile: () => profile,
      onSignedOut: () => signedOut++,
      dio: Dio()..httpClientAdapter = a,
      refreshDio: Dio()..httpClientAdapter = r,
    );
    return (t: t, api: a, refresh: r);
  }

  (int, Object?) renewed(RequestOptions o) => (
    200,
    {'accessToken': 'otp.new', 'expiresAt': now() + 3600, 'refreshToken': 'r2', 'sessionId': 's1'},
  );

  setUp(() async {
    session = SessionStore(MemorySecureStore());
    signedOut = 0;
    await session.save(accessToken: 'otp.old', expiresAt: now() + 3600, refreshToken: 'r1');
  });

  test("sends the token and the profile's school and acting-as headers", () async {
    final f = build(api: (_) => (200, {'ok': true}), refresh: renewed);
    expect(await f.t.send('GET', '/me', query: {'kind': 'staff'}), {'ok': true});
    final h = f.api.requests.single.headers;
    expect(h['Authorization'], 'Bearer otp.old');
    expect(h['X-School-Id'], '7');
    expect(h['X-Acting-As'], 'family');
    expect(f.api.requests.single.uri.toString(), 'http://api.test/api/v1/me?kind=staff');
    expect(f.refresh.requests, isEmpty);
  });

  test('a call made with its own options goes with its school and idempotency key', () async {
    final f = build(api: (_) => (201, {'ok': true}), refresh: renewed);
    await withCall(
      const CallOptions(schoolId: '9', idempotencyKey: 'phone-key-0001'),
      () => f.t.send('POST', '/attendance/sessions', body: {'a': 1}),
    );
    final h = f.api.requests.single.headers;
    expect(h['X-School-Id'], '9');
    expect(h['Idempotency-Key'], 'phone-key-0001');
    // the profile in use acts as the family; the kept write was made as staff
    expect(h.containsKey('X-Acting-As'), isFalse);
    // outside, the profile's own headers again
    await f.t.send('GET', '/me');
    expect(f.api.requests.last.headers['X-School-Id'], '7');
    expect(f.api.requests.last.headers.containsKey('Idempotency-Key'), isFalse);
  });

  test('renews a token about to end first, once for calls made together', () async {
    await session.save(accessToken: 'otp.old', expiresAt: now() + 10, refreshToken: 'r1');
    final f = build(api: (_) => (200, {}), refresh: renewed);
    await Future.wait([f.t.send('GET', '/a'), f.t.send('GET', '/b')]);
    expect(f.refresh.requests.length, 1);
    expect(f.refresh.requests.single.data, {
      'refreshToken': 'r1',
      'deviceId': 'phone-123456',
      'appVersion': '1.0.0',
    });
    expect(f.api.requests.map((r) => r.headers['Authorization']).toSet(), {'Bearer otp.new'});
    expect(await session.refreshToken, 'r2');
  });

  test('a token the API says has ended is renewed and the call made again', () async {
    var first = true;
    final f = build(
      api: (o) {
        if (first) {
          first = false;
          return (401, {'type': 'unauthenticated', 'detail': 'Invalid or expired session token'});
        }
        return (200, {'again': o.headers['Authorization']});
      },
      refresh: renewed,
    );
    expect(await f.t.send('GET', '/me'), {'again': 'Bearer otp.new'});
  });

  test('a phone the API signed out: the session is forgotten and the app told', () async {
    await session.save(accessToken: 'otp.old', expiresAt: now() + 10, refreshToken: 'r1');
    final f = build(
      api: (_) => (200, {}),
      refresh: (_) => (401, {'type': 'auth.mobile_reused', 'detail': 'This phone is signed out.'}),
    );
    await f.t.send('GET', '/me').catchError((_) => null);
    expect(signedOut, 1);
    expect(await session.refreshToken, isNull);
    expect(session.accessToken, isNull);
  });

  test("the API's problem comes back as an ApiException; no network as offline", () async {
    final f = build(
      api: (_) => (409, {'type': 'conflict', 'detail': 'Already held'}),
      refresh: renewed,
    );
    await expectLater(
      f.t.send('POST', '/x', body: {'a': 1}),
      throwsA(
        isA<ApiException>()
            .having((e) => e.type, 'type', 'conflict')
            .having((e) => e.detail, 'detail', 'Already held'),
      ),
    );
    final offline = DioTransport(
      baseUrl: 'http://api.test',
      session: session,
      deviceId: () async => 'phone-123456',
      appVersion: '1.0.0',
      profile: () => const ProfileHeaders(),
      onSignedOut: () {},
      dio: Dio()..httpClientAdapter = _Throwing(),
      refreshDio: Dio()..httpClientAdapter = _Throwing(),
    );
    await expectLater(
      offline.send('GET', '/me'),
      throwsA(isA<ApiException>().having((e) => e.offline, 'offline', true)),
    );
  });

  test("a school file's signed link goes through the app's own API address", () {
    const api = 'http://localhost:3010';
    expect(
      viaApiBase('http://localhost:4000/api/v1/platform/files/local?token=abc', api),
      'http://localhost:3010/api/v1/platform/files/local?token=abc',
    );
    // already the app's address, a relative link, or another storage: unchanged / on the app's address
    expect(
      viaApiBase('http://localhost:3010/api/v1/platform/files/local?token=abc', api),
      'http://localhost:3010/api/v1/platform/files/local?token=abc',
    );
    expect(
      viaApiBase('/api/v1/platform/files/local?token=abc', api),
      'http://localhost:3010/api/v1/platform/files/local?token=abc',
    );
    expect(
      viaApiBase('https://bucket.example.test/school-1/x.png?X-Sig=1', api),
      'https://bucket.example.test/school-1/x.png?X-Sig=1',
    );
  });
}

class _Throwing extends FakeAdapter {
  _Throwing() : super((_) => (0, null));
  @override
  Future<ResponseBody> fetch(o, s, c) async =>
      throw DioException.connectionError(requestOptions: o, reason: 'no network');
}
