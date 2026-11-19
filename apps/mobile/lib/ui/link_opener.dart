import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../push/links.dart';
import '../staff/approvals.dart';
import 'home_shell.dart';
import 'web_page_screen.dart';
import 'widgets.dart';

/// Opens a link target: switches to the profile it is about, then its screen in the app, or its web page.
class LinkOpener extends ConsumerStatefulWidget {
  const LinkOpener({super.key, required this.target});
  final LinkTarget target;

  @override
  ConsumerState<LinkOpener> createState() => _LinkOpenerState();
}

class _LinkOpenerState extends ConsumerState<LinkOpener> {
  Profile? _profile;

  @override
  void initState() {
    super.initState();
    _pick();
  }

  Future<void> _pick() async {
    final st = await ref.read(profilesProvider.future);
    final p = widget.target.profileIn(st.all, st.current);
    if (p != null && p.id != st.current?.id) await ref.read(profilesProvider.notifier).choose(p);
    if (mounted) setState(() => _profile = p);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = _profile;
    if (p == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
        ),
      );
    }
    if (opensApprovals(widget.target, p)) {
      return Scaffold(
        appBar: AppBar(title: Text(s.approvals)),
        body: ApprovalsScreen(profile: p),
      );
    }
    final native = nativeScreen(p, widget.target.path, s);
    if (native != null) {
      return Scaffold(
        appBar: AppBar(title: Text(s.appName)),
        body: native,
      );
    }
    return WebPageScreen(app: p.app, to: widget.target.path, title: s.appName);
  }
}

/// Shown when a link names no page the app can open.
class LinkUnknown extends ConsumerWidget {
  const LinkUnknown({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(),
    body: Center(child: ErrorText(ref.watch(stringsProvider).nothingYet)),
  );
}
