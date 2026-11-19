import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/theme.dart';
import '../theme/tokens.g.dart';
import 'widgets.dart';

/// The signed-in app: the profile in the bar (a tap switches), Home and More (phase A); the native daily screens
/// join as tabs in phases B and C.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final profiles = ref.watch(profilesProvider);
    return AsyncBody<ProfilesState>(
      value: profiles,
      retry: () => ref.invalidate(profilesProvider),
      data: (st) {
        final p = st.current;
        if (p == null) {
          return Scaffold(
            appBar: AppBar(title: Text(s.appName)),
            body: Padding(padding: const EdgeInsets.all(Tokens.sp5), child: Text(s.noProfiles)),
          );
        }
        return Scaffold(
          appBar: AppBar(
            titleSpacing: Tokens.sp3,
            title: InkWell(
              key: const Key('profileSwitch'),
              onTap: st.all.length > 1 ? () => _switch(context, st) : null,
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: Tokens.mobCyan600,
                    child: Text(
                      p.name.isEmpty ? '?' : p.name[0].toUpperCase(),
                      style: const TextStyle(color: Tokens.mobWhite),
                    ),
                  ),
                  const SizedBox(width: Tokens.sp3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.name, overflow: TextOverflow.ellipsis),
                        Text(
                          '${_kind(s, p)} · ${p.schoolName}',
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: Tokens.mobNavy100),
                        ),
                      ],
                    ),
                  ),
                  if (st.all.length > 1)
                    Semantics(label: s.profiles, child: const Icon(Icons.expand_more)),
                ],
              ),
            ),
            actions: [
              IconButton(
                tooltip: s.settings,
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => context.push('/settings'),
              ),
            ],
          ),
          body: _tab == 0 ? _Home(profile: p) : _More(profile: p),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: [
              NavigationDestination(icon: const Icon(Icons.home_outlined), label: s.home),
              NavigationDestination(icon: const Icon(Icons.apps), label: s.more),
            ],
          ),
        );
      },
    );
  }

  static String _kind(S s, Profile p) => switch (p.kind) {
    'staff' => s.kindStaff,
    'student' => s.kindStudent,
    _ => s.kindParent,
  };

  Future<void> _switch(BuildContext context, ProfilesState st) async {
    final s = ref.read(stringsProvider);
    final chosen = await showModalBottomSheet<Profile>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text(s.profiles, style: Theme.of(context).textTheme.titleMedium)),
            for (final p in st.all)
              ListTile(
                key: Key('profile-${p.id}'),
                leading: Icon(p.isStaff ? Icons.badge_outlined : Icons.family_restroom),
                title: Text(p.name),
                subtitle: Text(
                  [_kind(s, p), p.detail, p.schoolName].whereType<String>().join(' · '),
                ),
                selected: p.id == st.current?.id,
                onTap: () => Navigator.of(context).pop(p),
              ),
          ],
        ),
      ),
    );
    if (chosen != null) {
      await ref.read(profilesProvider.notifier).choose(chosen);
      setState(() => _tab = 0);
    }
  }
}

class _Home extends ConsumerWidget {
  const _Home({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.welcome(profile.name), style: Theme.of(context).textTheme.titleLarge),
        if (profile.detail != null)
          Text(profile.detail!, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: Tokens.sp4),
        Card(
          child: Padding(padding: const EdgeInsets.all(Tokens.sp4), child: Text(s.todayComing)),
        ),
      ],
    );
  }
}

/// Every screen of the profile's menu; one without a native screen opens its web page inside the app.
class _More extends ConsumerWidget {
  const _More({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final menu = ref.watch(menuProvider(profile.id));
    return AsyncBody<ProfileMenu>(
      value: menu,
      retry: () => ref.invalidate(menuProvider(profile.id)),
      data: (m) => ListView(
        key: const Key('moreList'),
        children: [
          for (final g in m.groups) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp4, Tokens.sp4, Tokens.sp1),
              child: Semantics(
                header: true,
                child: Text(
                  s.menu(g.label),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: Tokens.fwSemibold,
                  ),
                ),
              ),
            ),
            for (final i in g.items)
              ListTile(
                leading: Icon(menuIcon(i.icon)),
                title: Text(s.menu(i.label)),
                subtitle: i.help == null ? null : Text(s.menu(i.help!)),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push(
                  Uri(
                    path: '/web',
                    queryParameters: {'app': m.app, 'to': i.href, 'title': s.menu(i.label)},
                  ).toString(),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
