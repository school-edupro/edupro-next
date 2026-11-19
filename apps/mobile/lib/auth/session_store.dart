import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the phone keeps its sign-in: the refresh token, the session, the app PIN (salted hash) — in the
/// Keychain (iOS) or the Keystore-backed storage (Android), never in plain preferences.
abstract interface class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class PlatformSecureStore implements SecureStore {
  const PlatformSecureStore();
  static const _s = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _s.read(key: key);
  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _s.delete(key: key);
}

/// For tests: the same contract in memory.
class MemorySecureStore implements SecureStore {
  final Map<String, String> values = {};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// The phone's session: the refresh token lives in secure storage; the access token only in memory.
class SessionStore {
  SessionStore(this._store);
  final SecureStore _store;

  static const _refresh = 'refresh_token';
  static const _session = 'session_id';
  static const _name = 'display_name';
  static const _pin = 'pin';
  static const _pinLength = 'pin_length';
  static const _deviceId = 'device_id';

  String? accessToken;
  int accessExpiresAt = 0;

  Future<String?> get refreshToken => _store.read(_refresh);
  Future<String?> get sessionId => _store.read(_session);
  Future<String?> get displayName => _store.read(_name);

  Future<void> save({
    required String accessToken,
    required int expiresAt,
    required String refreshToken,
    String? sessionId,
    String? displayName,
  }) async {
    this.accessToken = accessToken;
    accessExpiresAt = expiresAt;
    await _store.write(_refresh, refreshToken);
    if (sessionId != null) await _store.write(_session, sessionId);
    if (displayName != null) await _store.write(_name, displayName);
  }

  /// Signed out: everything but the phone's own id goes.
  Future<void> clear() async {
    accessToken = null;
    accessExpiresAt = 0;
    for (final k in [_refresh, _session, _name, _pin, _pinLength]) {
      await _store.delete(k);
    }
  }

  /// The phone's install id, made once and kept (the API binds the session to it).
  Future<String> deviceId(String Function() make) async {
    final have = await _store.read(_deviceId);
    if (have != null) return have;
    final id = make();
    await _store.write(_deviceId, id);
    return id;
  }

  // ---- the app PIN (4–6 digits) that opens the app when the phone has no fingerprint / face set up ----

  Future<bool> get hasPin async => (await _store.read(_pin)) != null;

  Future<void> setPin(String pin) async {
    final salt = base64Url.encode(List<int>.generate(16, (_) => Random.secure().nextInt(256)));
    await _store.write(_pin, '$salt:${_hash(salt, pin)}');
    await _store.write(_pinLength, '${pin.length}');
  }

  /// How many digits the PIN has (the unlock screen's dots; it opens on the last digit). Null for a PIN set
  /// before the length was kept: the screen then has an Open button.
  Future<int?> get pinLength async => int.tryParse(await _store.read(_pinLength) ?? '');

  Future<bool> checkPin(String pin) async {
    final stored = await _store.read(_pin);
    if (stored == null) return false;
    final i = stored.indexOf(':');
    return i > 0 && stored.substring(i + 1) == _hash(stored.substring(0, i), pin);
  }

  static String _hash(String salt, String pin) =>
      sha256.convert(utf8.encode('$salt:$pin')).toString();
}
