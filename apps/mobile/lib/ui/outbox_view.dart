import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/outbox.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// A line on top of the staff screens while work waits on the phone; a tap lists it.
class OutboxBanner extends ConsumerWidget {
  const OutboxBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final items = ref.watch(outboxProvider);
    if (items.isEmpty) return const SizedBox.shrink();
    final refused = items.where((i) => i.error != null).length;
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Material(
        color: refused > 0 ? Tokens.statusDangerBg : Tokens.statusWarningBg,
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
        child: ListTile(
          key: const Key('outboxBanner'),
          leading: Icon(
            refused > 0 ? Icons.error_outline : Icons.cloud_upload_outlined,
            color: refused > 0 ? Tokens.statusDanger : Tokens.statusWarning,
          ),
          title: Text(s.unsentN(items.length), style: const TextStyle(color: Tokens.textBody)),
          trailing: const Icon(Icons.chevron_right, color: Tokens.textBody),
          onTap: () =>
              Navigator.of(context)
                  .push(MaterialPageRoute<void>(builder: (_) => const OutboxScreen())),
        ),
      ),
    );
  }
}

/// The work waiting on the phone: send now, or remove one the school refused.
class OutboxScreen extends ConsumerWidget {
  const OutboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final items = ref.watch(outboxProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.unsent)),
      body: ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(s.unsentHelp),
          const SizedBox(height: Tokens.sp3),
          for (final i in items)
            Card(
              child: ListTile(
                key: Key('outbox-${i.key}'),
                title: Text(i.label),
                subtitle: Text(i.error == null ? s.dateTime(i.at) : '${s.refusedKept} ${i.error}'),
                trailing: i.error == null
                    ? null
                    : IconButton(
                        tooltip: s.remove,
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => ref.read(outboxProvider.notifier).remove(i.key),
                      ),
              ),
            ),
          if (items.any((i) => i.error == null))
            FilledButton.icon(
              key: const Key('sendNow'),
              icon: const Icon(Icons.cloud_upload_outlined),
              label: Text(s.sendNow),
              onPressed: () => ref.read(outboxProvider.notifier).flush(),
            ),
        ],
      ),
    );
  }
}
