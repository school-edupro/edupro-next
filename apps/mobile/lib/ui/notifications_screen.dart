import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../family/data.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';

/// The kinds of push the profile's school sends and those the person switched off (docs/design/89 §5.3). Kept by
/// school on the server, so every phone of the person follows it.
final pushKindsProvider = FutureProvider.autoDispose.family<Json, String>((ref, schoolId) async {
  return asJson(await ref.read(apiProvider).commsPushEvents());
});

/// The kinds a profile hears of: a family's (no approvals), staff's (no homework or fees).
List<String> kindsFor(Profile p, List<String> school) {
  const family = [
    'homework',
    'attendance',
    'notices',
    'fees',
    'transport',
    'school_message',
    'queries',
  ];
  const staff = ['approvals', 'notices', 'attendance', 'school_message', 'queries'];
  return [
    for (final k in p.isStaff ? staff : family)
      if (school.contains(k)) k,
  ];
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  List<String>? _off;
  String? _error;

  Future<void> _set(String kind, bool on, List<String> off) async {
    final s = ref.read(stringsProvider);
    final next = on ? (off.where((k) => k != kind).toList()) : {...off, kind}.toList();
    setState(() {
      _off = next;
      _error = null;
    });
    try {
      await ref.read(apiProvider).commsPushSetEvents(body: PushEventsOffDto(off: next));
    } catch (e) {
      setState(() {
        _off = off;
        _error = errorText(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final kinds = ref.watch(pushKindsProvider(p.schoolId));
    return Scaffold(
      appBar: AppBar(title: Text(s.notifications)),
      body: switch (kinds) {
        AsyncValue(:final value?) => ListView(
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(p.schoolName, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: Tokens.sp1),
            Text(s.notificationsHelp),
            const SizedBox(height: Tokens.sp3),
            if (_error != null)
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            if (kindsFor(p, [for (final e in value['events'] as List? ?? const []) '$e']).isEmpty)
              EmptyLine(s.schoolSendsNone),
            for (final k in kindsFor(p, [
              for (final e in value['events'] as List? ?? const []) '$e',
            ]))
              SwitchListTile(
                key: Key('push-$k'),
                contentPadding: EdgeInsets.zero,
                title: Text(s.pushEvent(k)),
                value: !(_off ?? [for (final e in value['off'] as List? ?? const []) '$e'])
                    .contains(k),
                onChanged: (on) =>
                    _set(k, on, _off ?? [for (final e in value['off'] as List? ?? const []) '$e']),
              ),
          ],
        ),
        AsyncValue(:final error?) => Center(child: Text(errorText(s, error))),
        _ => Center(
          child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
        ),
      },
    );
  }
}
