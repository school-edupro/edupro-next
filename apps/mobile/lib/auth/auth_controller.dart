import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';

/// Where sign-in stands.
sealed class AuthState {
  const AuthState();
}

/// Reading the phone's storage at start.
class AuthStarting extends AuthState {
  const AuthStarting();
}

class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.error});
  final String? error;
}

/// The code was sent; the person types it.
class AuthCodeSent extends AuthState {
  const AuthCodeSent({
    required this.login,
    required this.challengeId,
    this.sentTo,
    this.screenCode,
    this.error,
  });
  final String login;
  final String challengeId;
  final String? sentTo;

  /// Shown on screen when the school allows it (while e-mails and mobiles are corrected).
  final String? screenCode;
  final String? error;

  AuthCodeSent withError(String? e) => AuthCodeSent(
    login: login,
    challengeId: challengeId,
    sentTo: sentTo,
    screenCode: screenCode,
    error: e,
  );
}

/// Signed in on this phone for the first time: an app PIN is set before going on.
class AuthNeedsPin extends AuthState {
  const AuthNeedsPin();
}

/// The phone is signed in but the app is locked: PIN or fingerprint / face.
class AuthLocked extends AuthState {
  const AuthLocked({this.error});
  final String? error;
}

class AuthSignedIn extends AuthState {
  const AuthSignedIn();
}

/// Sign-in on the phone (docs/design/89 §5.1): the one-time code, then the app PIN; later opens unlock with the PIN
/// (or fingerprint / face) and renew the session with the refresh token kept in secure storage.
class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    // the API signed the phone out (elsewhere, by the school, or an old token): back to sign-in
    ref.listen(signedOutSignalProvider, (prev, next) {
      if (prev != null && next != prev) state = const AuthSignedOut();
    });
    return const AuthStarting();
  }

  EduProApi get _api => ref.read(apiProvider);

  /// At start: a phone with a session opens locked; one without, at sign-in.
  Future<void> init() async {
    final store = ref.read(sessionStoreProvider);
    if (await store.refreshToken == null) {
      state = const AuthSignedOut();
    } else {
      state = await store.hasPin ? const AuthLocked() : const AuthNeedsPin();
    }
  }

  /// Step 1: the mobile number, e-mail or a pupil's admission number; a code goes to the person.
  Future<void> start(String login) async {
    final l = login.trim();
    if (l.length < 3) {
      state = const AuthSignedOut(error: 'enterLogin');
      return;
    }
    try {
      final r = await _api.otpStart(
        body: OtpStartDto(login: l, app: 'mobile'),
      ) as Map;
      state = AuthCodeSent(
        login: l,
        challengeId: '${r['challengeId']}',
        sentTo: r['sentTo'] as String?,
        screenCode: r['screenCode'] as String?,
      );
    } on ApiException catch (e) {
      state = AuthSignedOut(error: e.detail);
    }
  }

  /// Step 2: the code; the phone's session is kept, then the app PIN is set.
  Future<void> verify(String code) async {
    final s = state;
    if (s is! AuthCodeSent) return;
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      state = s.withError('codeSix');
      return;
    }
    try {
      final device = await ref.read(deviceProvider.future);
      final r = await _api.mobileAuthVerify(
        body: MobileCodeDto(
          challengeId: s.challengeId,
          code: code,
          device: MobileCodeDtoDevice(
            id: device.id,
            name: device.name,
            platform: device.platform,
            appVersion: device.toJson()['appVersion'] as String?,
          ),
        ),
      ) as Map;
      await ref
          .read(sessionStoreProvider)
          .save(
            accessToken: '${r['accessToken']}',
            expiresAt: (r['expiresAt'] as num).toInt(),
            refreshToken: '${r['refreshToken']}',
            sessionId: r['sessionId'] as String?,
            displayName: r['displayName'] as String?,
          );
      try {
        await _api.meSignIn(
          body: const MeSignInDto(method: 'otp', app: 'mobile'),
        );
      } catch (_) {
        // "last sign-in" is a nicety; never stops the sign-in
      }
      state = const AuthNeedsPin();
    } on ApiException catch (e) {
      state = s.withError(e.detail);
    }
  }

  /// A new code (the API allows one in 30 seconds).
  Future<void> resend() async {
    final s = state;
    if (s is AuthCodeSent) await start(s.login);
  }

  void back() => state = const AuthSignedOut();

  /// The app PIN chosen after the first sign-in.
  Future<void> setPin(String pin) async {
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin)) return;
    await ref.read(sessionStoreProvider).setPin(pin);
    state = const AuthSignedIn();
  }

  /// Opening a locked app: the PIN (or `biometric: true` after the phone's own check), then a fresh token.
  Future<void> unlock({String? pin, bool biometric = false}) async {
    final store = ref.read(sessionStoreProvider);
    if (!biometric && !(await store.checkPin(pin ?? ''))) {
      state = const AuthLocked(error: 'wrongPin');
      return;
    }
    state = const AuthSignedIn();
  }

  /// Signs this phone out (at the API too, best effort) and forgets the session.
  Future<void> signOut() async {
    try {
      await _api.mobileAuthSignOut();
    } catch (_) {
      // signed out here whatever the network says
    }
    await ref.read(sessionStoreProvider).clear();
    state = const AuthSignedOut();
  }
}

final authProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
