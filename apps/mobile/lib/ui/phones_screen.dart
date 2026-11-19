import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../family/common.dart';
import '../family/data.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// The person's phones signed in to EduPro (docs/design/89 §5.1, phase D): which, when last used, and signing a lost
/// or old one out (it goes back to sign-in the next time it opens; the school can do the same).
final phonesProvider = FutureProvider.autoDispose<List<Json>>((ref) async {
  return asList(asJson(await ref.read(apiProvider).mobileAuthDevices())['data']);
});

class PhonesScreen extends ConsumerWidget {
  const PhonesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final phones = ref.watch(phonesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.phones)),
      body: switch (phones) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: () => ref.refresh(phonesProvider.future),
          child: ListView(
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [
              if (value.isEmpty) EmptyLine(s.nothingYet),
              for (final p in value)
                Card(
                  child: ListTile(
                    key: Key('phone-${p['id']}'),
                    leading: Icon(
                      p['platform'] == 'ios' ? Icons.phone_iphone : Icons.phone_android,
                    ),
                    title: Text('${p['name'] ?? p['platform']}'),
                    subtitle: Text(
                      [
                        if (p['current'] == true) s.thisPhone,
                        s.lastUsed(s.dateTime(DateTime.parse('${p['lastUsedAt']}'))),
                        if (p['appVersion'] != null) 'EduPro ${p['appVersion']}',
                      ].join(' · '),
                    ),
                    trailing: p['current'] == true
                        ? null
                        : TextButton(
                            key: Key('signOutPhone-${p['id']}'),
                            onPressed: () => _signOut(context, ref, s, p),
                            child: Text(s.signOutPhone),
                          ),
                  ),
                ),
            ],
          ),
        ),
        AsyncValue(:final error?) => Center(child: Text(errorText(s, error))),
        _ => Center(
          child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
        ),
      },
    );
  }

  Future<void> _signOut(BuildContext context, WidgetRef ref, S s, Json p) async {
    final name = '${p['name'] ?? p['platform']}';
    final yes = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        content: Text(s.signOutPhoneAsk(name)),
        actions: [
          TextButton(onPressed: () => Navigator.of(d).pop(false), child: Text(s.cancel)),
          FilledButton(
            key: const Key('confirmSignOutPhone'),
            onPressed: () => Navigator.of(d).pop(true),
            child: Text(s.signOutPhone),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).mobileAuthSignOutDevice(id: '${p['id']}');
      ref.invalidate(phonesProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.phoneSignedOut)));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }
}
