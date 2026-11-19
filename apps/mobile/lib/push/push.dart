import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../config.dart';

/// Push notifications (docs/design/89 §5.3): the phone's Firebase token is registered as the app `mobile` with the
/// school of the profile in use (again on each switch — the API keeps one row a school and token); the API sends
/// through the one EduPro Firebase project. Off until the build carries that project's files
/// (`--dart-define=PUSH=true`).
class Push {
  Push(this.ref);
  final Ref ref;
  String? _token;

  Future<void> registerForCurrentSchool() async {
    if (!AppConfig.pushEnabled) return;
    try {
      if (_token == null) {
        await Firebase.initializeApp();
        final m = FirebaseMessaging.instance;
        final allowed = await m.requestPermission();
        if (allowed.authorizationStatus == AuthorizationStatus.denied) return;
        // TODO(phase D): register() and onRegistered (installation ids) once the workers send to them; the
        // workers' FCM HTTP v1 messages take the classic token today
        // ignore: deprecated_member_use
        _token = await m.getToken();
      }
      final token = _token;
      if (token == null) return;
      final device = await ref.read(deviceProvider.future);
      await ref
          .read(apiProvider)
          .commsPushRegister(
            body: PushDeviceDto(token: token, app: 'mobile', platform: device.platform),
          );
    } catch (_) {
      // push is a help, never a reason the app does not open
    }
  }
}

final pushProvider = Provider<Push>(Push.new);
