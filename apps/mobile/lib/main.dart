import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:material_ui/material_ui.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'app.dart';
import 'family/cache_store.dart';
import 'config.dart';

/// EduPro: one app for students, parents and staff (docs/design/89).
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // the installed version (the update check and the phone's session say it)
  if (!AppConfig.versionGiven) {
    try {
      AppConfig.appVersion = (await PackageInfo.fromPlatform()).version;
    } catch (_) {
      // the pubspec's version, as built in
    }
  }
  // a phone keeps the screens' last copies in files of their own (the web build in its preferences)
  if (!kIsWeb) cacheStore = FileCacheStore();
  const app = ProviderScope(child: EduProApp());
  if (AppConfig.sentryDsn.isEmpty) {
    runApp(app);
    return;
  }
  await SentryFlutter.init(
    (o) => o
      ..dsn = AppConfig.sentryDsn
      ..release = 'edupro@${AppConfig.appVersion}'
      // no personal data in crash reports (docs/design/89 §8)
      ..sendDefaultPii = false,
    appRunner: () => runApp(app),
  );
}
