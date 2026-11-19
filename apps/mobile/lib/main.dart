import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'app.dart';
import 'config.dart';

/// EduPro: one app for students, parents and staff (docs/design/89).
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
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
