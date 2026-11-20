import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// The school directory as the website shows it (apps/parent/app/(app)/directory): whom to contact at the
/// school and when, under the office's headings; a number calls and an e-mail address writes from the phone.
class DirectoryScreen extends ConsumerWidget {
  const DirectoryScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return LoadedList<List<Json>>(
      value: ref.watch(directoryProvider(profile)),
      refresh: () => ref.refresh(directoryProvider(profile).future),
      children: (rows) {
        final headings = <String>[];
        for (final r in rows) {
          final h = '${r['heading'] ?? ''}';
          if (!headings.contains(h)) headings.add(h);
        }
        return [
          Text(s.directoryHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp2),
          if (rows.isEmpty) EmptyLine(s.directoryEmpty),
          for (final h in headings) ...[
            SectionTitle(h, key: Key('dirHeading-$h')),
            Card(
              child: Column(
                children: [
                  for (final (i, r) in rows.where((r) => '${r['heading'] ?? ''}' == h).indexed)
                    _Entry(row: r, first: i == 0),
                ],
              ),
            ),
          ],
        ];
      },
    );
  }
}

class _Entry extends ConsumerWidget {
  const _Entry({required this.row, required this.first});
  final Json row;
  final bool first;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final r = row;
    final name = '${r['name'] ?? ''}';
    final phone = r['phone'] as String?;
    final email = r['email'] as String?;
    final sub = [
      if (r['designation'] != null) '${r['designation']}',
      if (r['note'] != null) '${r['note']}',
    ].join(' · ');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: Tokens.sp3),
      decoration: BoxDecoration(
        border: first
            ? null
            : Border(top: BorderSide(color: (dark ? Tokens.mobGray700 : Tokens.mobGray100))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(name, style: const TextStyle(fontWeight: Tokens.fwBold)),
          if (sub.isNotEmpty) Text(sub, style: TextStyle(color: muted, fontSize: 13)),
          Wrap(
            spacing: Tokens.sp2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (phone != null && phone.isNotEmpty)
                _Link(
                  icon: Icons.call_outlined,
                  text: phone,
                  label: s.callWho(name),
                  uri: Uri(scheme: 'tel', path: phone.replaceAll(RegExp(r'[^0-9+]'), '')),
                ),
              if (email != null && email.isNotEmpty)
                _Link(
                  icon: Icons.mail_outline,
                  text: email,
                  label: s.emailWho(name),
                  uri: Uri(scheme: 'mailto', path: email),
                ),
            ],
          ),
          if ('${r['timings'] ?? ''}'.isNotEmpty)
            Text('${s.timings}: ${r['timings']}', style: TextStyle(color: muted, fontSize: 13)),
        ],
      ),
    );
  }
}

/// A number or an address: a tap calls or writes from the phone.
class _Link extends StatelessWidget {
  const _Link({required this.icon, required this.text, required this.label, required this.uri});
  final IconData icon;
  final String text;
  final String label;
  final Uri uri;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    button: true,
    excludeSemantics: true,
    child: TextButton.icon(
      style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: Tokens.sp1)),
      icon: Icon(icon, size: 18),
      label: Text(text),
      onPressed: () => launchUrl(uri),
    ),
  );
}
