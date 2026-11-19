import 'package:edupro/api/endpoints.g.dart';
import 'package:edupro/auth/session_store.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

void main() {
  test(
    'the app PIN is kept as a salted hash; signing out forgets it but keeps the phone id',
    () async {
      final mem = MemorySecureStore();
      final s = SessionStore(mem);
      await s.setPin('2468');
      expect(mem.values['pin'], isNot(contains('2468')));
      expect(await s.checkPin('2468'), isTrue);
      expect(await s.checkPin('1357'), isFalse);
      final id = await s.deviceId(() => 'phone-abcdef12');
      await s.save(accessToken: 'otp.a', expiresAt: 1, refreshToken: 'r', sessionId: 's');
      await s.clear();
      expect(await s.hasPin, isFalse);
      expect(await s.refreshToken, isNull);
      expect(await s.deviceId(() => 'another'), id);
    },
  );

  test('the generated client: paths, query and bodies from the API description', () async {
    final t = FakeTransport((_) => {});
    final api = EduProApi(t);
    await api.meMenu(kind: 'staff');
    await api.mobileAuthSignOutDevice(id: 'a/b');
    await api.mobileAuthVerify(
      body: const MobileCodeDto(
        challengeId: 'c',
        code: '123456',
        device: MobileCodeDtoDevice(id: 'phone-1', platform: 'android'),
      ),
    );
    expect(t.calls.map((c) => '${c.method} ${c.path}'), [
      'GET /me/menu',
      'POST /auth/mobile/devices/a%2Fb/sign-out',
      'POST /auth/mobile/verify',
    ]);
    expect(t.calls[0].query, {'kind': 'staff'});
    expect(t.calls[2].body, {
      'challengeId': 'c',
      'code': '123456',
      'device': {'id': 'phone-1', 'platform': 'android'},
    });
  });
}
