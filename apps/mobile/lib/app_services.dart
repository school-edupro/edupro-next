import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import 'api/api_transport.dart';
import 'api/dio_transport.dart';
import 'api/endpoints.g.dart';
import 'auth/session_store.dart';
import 'config.dart';

/// The phone's secure storage (tests put an in-memory one here).
final secureStoreProvider = Provider<SecureStore>((ref) => const PlatformSecureStore());

final sessionStoreProvider = Provider<SessionStore>(
  (ref) => SessionStore(ref.watch(secureStoreProvider)),
);

/// The headers of the profile in use (set by the profile switcher).
final profileHeadersProvider = NotifierProvider<ProfileHeadersNotifier, ProfileHeaders>(
  ProfileHeadersNotifier.new,
);

class ProfileHeadersNotifier extends Notifier<ProfileHeaders> {
  @override
  ProfileHeaders build() => const ProfileHeaders();
  void set(ProfileHeaders h) => state = h;
}

/// Told when the API signs the phone out, so the app goes back to sign-in.
final signedOutSignalProvider = NotifierProvider<SignedOutSignal, int>(SignedOutSignal.new);

class SignedOutSignal extends Notifier<int> {
  @override
  int build() => 0;
  void fire() => state++;
}

/// The phone as the API knows it: its install id, a name the person recognises, the platform.
class DeviceDetails {
  const DeviceDetails({required this.id, required this.name, required this.platform});
  final String id;
  final String name;
  final String platform;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'platform': platform,
    'appVersion': AppConfig.appVersion,
  };
}

final deviceProvider = FutureProvider<DeviceDetails>((ref) async {
  final store = ref.watch(sessionStoreProvider);
  final id = await store.deviceId(() => 'p${const Uuid().v4().replaceAll('-', '')}');
  final platform = kIsWeb
      ? 'web'
      : defaultTargetPlatform == TargetPlatform.iOS
      ? 'ios'
      : 'android';
  var name = 'Phone';
  try {
    final info = DeviceInfoPlugin();
    if (kIsWeb) {
      name = (await info.webBrowserInfo).browserName.name;
    } else if (defaultTargetPlatform == TargetPlatform.iOS) {
      name = (await info.iosInfo).name;
    } else {
      final a = await info.androidInfo;
      name = '${a.manufacturer} ${a.model}';
    }
  } catch (_) {
    // a name is only for the person's list of phones
  }
  return DeviceDetails(id: id, name: name, platform: platform);
});

final transportProvider = Provider<ApiTransport>((ref) {
  final session = ref.watch(sessionStoreProvider);
  return DioTransport(
    baseUrl: AppConfig.apiBaseUrl,
    session: session,
    deviceId: () async => (await ref.read(deviceProvider.future)).id,
    appVersion: AppConfig.appVersion,
    profile: () => ref.read(profileHeadersProvider),
    onSignedOut: () => ref.read(signedOutSignalProvider.notifier).fire(),
  );
});

/// The API, typed from its own description (endpoints.g.dart).
final apiProvider = Provider<EduProApi>((ref) => EduProApi(ref.watch(transportProvider)));
