import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../auth/auth_controller.dart';
import '../config.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'widgets.dart';

/// Settings: the language and signing this phone out (the list of phones follows in phase D).
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.settings)),
      body: ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(s.language, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: Tokens.sp2),
          const LanguageSwitch(),
          const SizedBox(height: Tokens.sp6),
          OutlinedButton.icon(
            key: const Key('signOut'),
            icon: const Icon(Icons.logout),
            label: Text(s.signOut),
            onPressed: () async {
              await ref.read(authProvider.notifier).signOut();
              if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
            },
          ),
          const SizedBox(height: Tokens.sp5),
          Text('EduPro ${AppConfig.appVersion}', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}
