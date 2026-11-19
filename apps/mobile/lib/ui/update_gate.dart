import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_services.dart';
import '../config.dart';
import '../family/data.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// Whether this build must (or may) be updated (`GET /auth/mobile/app-version`, docs/design/89 phase D). A check
/// that fails never stops the app.
final appVersionProvider = FutureProvider<Json>((ref) async {
  try {
    final platform = kIsWeb
        ? 'web'
        : defaultTargetPlatform == TargetPlatform.iOS
        ? 'ios'
        : 'android';
    return asJson(
      await ref
          .read(apiProvider)
          .mobileAuthAppVersion(platform: platform, version: AppConfig.appVersion),
    );
  } catch (_) {
    return const {};
  }
});

/// Covers the app with "Update EduPro" when this build is below the minimum the school's server takes.
class UpdateGate extends ConsumerWidget {
  const UpdateGate({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(appVersionProvider).value ?? const {};
    if (v['mustUpdate'] != true) return child;
    final s = ref.watch(stringsProvider);
    final url = v['storeUrl'] as String?;
    return Scaffold(
      key: const Key('updateRequired'),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.system_update, size: 48),
                const SizedBox(height: Tokens.sp3),
                Semantics(
                  header: true,
                  child: Text(s.updateTitle, style: Theme.of(context).textTheme.headlineSmall),
                ),
                const SizedBox(height: Tokens.sp2),
                Text(s.updateNeeded, textAlign: TextAlign.center),
                const SizedBox(height: Tokens.sp4),
                if (url != null)
                  FilledButton(
                    onPressed: () =>
                        launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
                    child: Text(s.updateNow),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
