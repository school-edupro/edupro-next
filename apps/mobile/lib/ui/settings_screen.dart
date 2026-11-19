import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/outbox.dart';
import '../auth/auth_controller.dart';
import '../config.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import '../profiles/profiles.dart';
import 'notifications_screen.dart';
import 'phones_screen.dart';
import 'widgets.dart';

/// Settings: the language, the notifications of the profile's school, the person's phones, signing out.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final profile = ref.watch(profilesProvider).value?.current;
    return Scaffold(
      appBar: AppBar(title: Text(s.settings)),
      body: ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(s.language, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: Tokens.sp2),
          const LanguageSwitch(),
          const SizedBox(height: Tokens.sp5),
          if (profile != null)
            ListTile(
              key: const Key('notifications'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.notifications_outlined),
              title: Text(s.notifications),
              subtitle: Text(profile.schoolName),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => NotificationsScreen(profile: profile)),
              ),
            ),
          ListTile(
            key: const Key('phones'),
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.devices_outlined),
            title: Text(s.phones),
            trailing: const Icon(Icons.chevron_right),
            onTap: () =>
                Navigator.of(context)
                    .push(MaterialPageRoute<void>(builder: (_) => const PhonesScreen())),
          ),
          const SizedBox(height: Tokens.sp5),
          OutlinedButton.icon(
            key: const Key('signOut'),
            icon: const Icon(Icons.logout),
            label: Text(s.signOut),
            onPressed: () async {
              // unsent work belongs to the person: say so before it goes
              final waiting = ref.read(outboxProvider).length;
              if (waiting > 0) {
                final go = await showDialog<bool>(
                  context: context,
                  builder: (c) => AlertDialog(
                    content: Text(s.signOutLoses(waiting)),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.of(c).pop(false),
                        child: Text(s.cancel),
                      ),
                      FilledButton(
                        key: const Key('confirmSignOut'),
                        onPressed: () => Navigator.of(c).pop(true),
                        child: Text(s.signOut),
                      ),
                    ],
                  ),
                );
                if (go != true) return;
              }
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
