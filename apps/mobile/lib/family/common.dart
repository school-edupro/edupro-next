import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:share_plus/share_plus.dart';

import '../api/api_transport.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The sentence to show for an error: the API's own, or "no connection".
String errorText(S s, Object e) => e is ApiException ? (e.offline ? s.offline : e.detail) : '$e';

/// A screen's content from the API: loading, an error with "try again", or the content — pulled down to refresh,
/// with a line on top when it is the copy kept from last time (no network).
class LoadedList<T> extends ConsumerWidget {
  const LoadedList({
    super.key,
    required this.value,
    required this.refresh,
    required this.children,
    this.padding = const EdgeInsets.all(Tokens.sp4),
  });
  final AsyncValue<Loaded<T>> value;
  final Future<void> Function() refresh;
  final List<Widget> Function(T data) children;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return switch (value) {
      AsyncValue(:final value?) => RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: padding,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (value.stale) ...[StaleLine(at: value.at), const SizedBox(height: Tokens.sp3)],
            ...children(value.data),
          ],
        ),
      ),
      AsyncValue(:final error?) => Center(
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ErrorText(errorText(s, error)),
              const SizedBox(height: Tokens.sp3),
              OutlinedButton(onPressed: refresh, child: Text(s.retry)),
            ],
          ),
        ),
      ),
      _ => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
    };
  }
}

/// "No connection. This is the copy from …"
class StaleLine extends ConsumerWidget {
  const StaleLine({super.key, required this.at});
  final DateTime at;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return Semantics(
      liveRegion: true,
      child: Container(
        key: const Key('staleLine'),
        padding: const EdgeInsets.all(Tokens.sp3),
        decoration: BoxDecoration(
          color: Tokens.statusWarningBg,
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
        ),
        child: Row(
          children: [
            const Icon(Icons.cloud_off_outlined, size: 18, color: Tokens.statusWarning),
            const SizedBox(width: Tokens.sp2),
            Expanded(
              child: Text(
                s.updatedAt(s.dateTime(at)),
                style: const TextStyle(color: Tokens.textBody),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A heading inside a screen.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action});
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: Tokens.sp4, bottom: Tokens.sp2),
    child: Row(
      children: [
        Expanded(
          child: Semantics(
            header: true,
            child: Text(
              text,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: Tokens.fwSemibold,
                color: Theme.of(context).brightness == Brightness.dark
                    ? Tokens.mobWhite
                    : Tokens.mobNavy800,
              ),
            ),
          ),
        ),
        // a long action (large text) takes what is left and wraps rather than running off the screen
        if (action != null)
          Flexible(
            child: Align(alignment: AlignmentDirectional.centerEnd, child: action!),
          ),
      ],
    ),
  );
}

/// A figure on Home: what it is, the number, a tap to its screen (a cell of [FigureGrid]). A [tone] puts a
/// coloured dot by the number (the status colours are too light for the number itself).
class FigureTile extends StatelessWidget {
  const FigureTile({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.onTap,
    this.tone,
  });
  final String label;
  final String value;

  /// kept for screens that show it; the figure card itself is words and numbers
  final IconData icon;
  final VoidCallback? onTap;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return InkWell(
      onTap: onTap,
      child: Semantics(
        button: onTap != null,
        label: '$label: $value',
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Tokens.sp4, 14, Tokens.sp3, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                maxLines: 2,
                style: t.bodySmall?.copyWith(color: dark ? Tokens.mobGray300 : Tokens.textMuted),
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  if (tone != null) ...[
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Flexible(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        value,
                        maxLines: 1,
                        style: t.titleLarge?.copyWith(
                          fontWeight: Tokens.fwSemibold,
                          fontSize: 24,
                          color: dark ? Tokens.mobWhite : Tokens.mobNavy800,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The figures in one card, two a row with lines between (an even number, as on the web dashboards).
class FigureGrid extends StatelessWidget {
  const FigureGrid({super.key, required this.tiles, this.raised = false});
  final List<Widget> tiles;

  /// with a shadow: the card that sits over the navy band on Home
  final bool raised;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final line = BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray100);
    return Container(
      decoration: BoxDecoration(
        color: dark ? Tokens.mobGray900 : Tokens.mobWhite,
        borderRadius: BorderRadius.circular(Tokens.radiusLg),
        border: raised ? null : Border.all(color: dark ? Tokens.mobGray700 : Tokens.mobGray200),
        boxShadow: raised
            ? const [BoxShadow(color: Color(0x1A00265D), blurRadius: 20, offset: Offset(0, 6))]
            : null,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        type: MaterialType.transparency,
        child: Column(
          children: [
            for (var i = 0; i < tiles.length; i += 2)
              Container(
                decoration: BoxDecoration(
                  border: i + 2 < tiles.length ? Border(bottom: line) : null,
                ),
                child: IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: DecoratedBox(
                          decoration: BoxDecoration(border: Border(right: line)),
                          child: tiles[i],
                        ),
                      ),
                      Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

enum Tone { success, danger, warning, info, neutral }

/// A short status word on a coloured background (Present, Overdue, Approved …).
class StatusChip extends StatelessWidget {
  const StatusChip(this.text, this.tone, {super.key});
  final String text;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    // the word in body text (the status colours are too light for small text on their tints); the dot carries it
    final (bg, dot) = switch (tone) {
      Tone.success => (Tokens.statusSuccessBg, Tokens.statusSuccess),
      Tone.danger => (Tokens.statusDangerBg, Tokens.statusDanger),
      Tone.warning => (Tokens.statusWarningBg, Tokens.statusWarning),
      Tone.info => (Tokens.statusInfoBg, Tokens.statusInfo),
      Tone.neutral => (Tokens.mobGray100, Tokens.mobGray500),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: Tokens.sp1),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Tokens.radiusSm)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: Tokens.sp1),
          Flexible(
            child: Text(
              text,
              style: const TextStyle(
                color: Tokens.textBody,
                fontWeight: Tokens.fwSemibold,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A line of empty-state text.
class EmptyLine extends StatelessWidget {
  const EmptyLine(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: Tokens.sp3),
    child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
  );
}

/// A screen of its own (pushed over the tabs): the navy band with the back button and the title, the page on a
/// light sheet over it (look B).
class FamilyPage extends StatelessWidget {
  const FamilyPage({super.key, required this.title, required this.child, this.actions});
  final String title;
  final Widget child;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Tokens.mobNavy800,
    appBar: AppBar(actions: actions, toolbarHeight: 52),
    body: BandSheet(title: title, child: child),
  );
}

/// A big title on the navy band and the content on a light sheet with rounded top corners.
class BandSheet extends StatelessWidget {
  const BandSheet({super.key, required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp5),
        child: Semantics(
          header: true,
          child: Text(
            title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.headlineSmall
                ?.copyWith(color: Tokens.mobWhite, fontWeight: Tokens.fwSemibold),
          ),
        ),
      ),
      Expanded(
        child: ClipRRect(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          // a Material, not a coloured box: list rows paint their ink on it
          child: Material(
            color: Theme.of(context).scaffoldBackgroundColor,
            child: Padding(
              padding: const EdgeInsets.only(top: Tokens.sp2),
              child: child,
            ),
          ),
        ),
      ),
    ],
  );
}

/// The top of a Home: the navy band goes on with the date and the greeting, and the figures card sits half over it.
class HomeBand extends StatelessWidget {
  const HomeBand({
    super.key,
    required this.date,
    required this.heading,
    required this.figures,
    this.detail,
    this.badge,
  });
  final String date;
  final String heading;
  final String? detail;

  /// a short word on the band's right (staff: in since 8:02)
  final Widget? badge;
  final Widget figures;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          color: Tokens.mobNavy800,
          padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp1, Tokens.sp4, 0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(date, style: const TextStyle(color: Tokens.mobNavy100, fontSize: 14)),
                    const SizedBox(height: 2),
                    Semantics(
                      header: true,
                      child: Text(
                        heading,
                        style: t.headlineSmall?.copyWith(
                          color: Tokens.mobWhite,
                          fontWeight: Tokens.fwSemibold,
                        ),
                      ),
                    ),
                    if (detail != null)
                      Text(detail!, style: const TextStyle(color: Tokens.mobNavy100, fontSize: 14)),
                  ],
                ),
              ),
              ?badge,
            ],
          ),
        ),
        Stack(
          children: [
            const Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: 56,
              child: ColoredBox(color: Tokens.mobNavy800),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp5, Tokens.sp4, 0),
              child: figures,
            ),
          ],
        ),
      ],
    );
  }
}

/// The shortcuts under the figures: four a row, each an icon on a light tile with its name under it.
class ShortcutGrid extends StatelessWidget {
  const ShortcutGrid({super.key, required this.label, required this.items});
  final String label;

  /// (key, name, icon, open)
  final List<(String, String, IconData, VoidCallback)> items;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    Widget tile((String, String, IconData, VoidCallback) x) {
      final (key, text, icon, onTap) = x;
      return Semantics(
        button: true,
        label: text,
        excludeSemantics: true,
        child: InkWell(
          key: Key('shortcut-$key'),
          onTap: onTap,
          borderRadius: BorderRadius.circular(Tokens.radiusLg),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Tokens.sp2, horizontal: 2),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: dark ? Tokens.mobNavy700 : Tokens.mobNavy50,
                    borderRadius: BorderRadius.circular(Tokens.radiusLg),
                  ),
                  child: Icon(icon, size: 26, color: dark ? Tokens.mobWhite : Tokens.mobNavy800),
                ),
                const SizedBox(height: 6),
                Text(
                  text,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    color: dark ? Tokens.mobGray100 : Tokens.mobGray700,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Semantics(
      label: label,
      container: true,
      explicitChildNodes: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2),
        child: Column(
          children: [
            for (var i = 0; i < items.length; i += 4)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var j = i; j < i + 4; j++)
                    Expanded(child: j < items.length ? tile(items[j]) : const SizedBox()),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// A small word on a tint: Now, Done, Substitution (body text; the tint carries the meaning).
class Tag extends StatelessWidget {
  const Tag(this.text, {super.key, this.color = Tokens.mobCyan100});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
    decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
    child: Text(
      text,
      style: const TextStyle(color: Tokens.mobNavy800, fontWeight: Tokens.fwBold, fontSize: 12),
    ),
  );
}

void pushPage(BuildContext context, String title, Widget child) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (_) => FamilyPage(title: title, child: child),
  ),
);

/// The text of a notice or a message written in HTML, as plain paragraphs.
String plainText(String html) => html
    .replaceAll(RegExp(r'<\s*(br|/p|/div|/li|/h[1-6]|/tr)\s*/?>', caseSensitive: false), '\n')
    .replaceAll(RegExp(r'<\s*li[^>]*>', caseSensitive: false), '• ')
    .replaceAll(RegExp(r'<[^>]+>'), '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll(RegExp(r'[ \t]+'), ' ')
    .replaceAll(RegExp(r'\n\s*\n\s*\n+'), '\n\n')
    .trim();

/// Attachments as View and Download icons, numbered (no file names on the links).
class Attachments extends ConsumerWidget {
  const Attachments({super.key, required this.count, required this.load});
  final int count;
  final Future<ApiFile> Function(int i) load;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    if (count == 0) return const SizedBox.shrink();
    return Wrap(
      spacing: Tokens.sp2,
      runSpacing: Tokens.sp2,
      children: [
        for (var i = 0; i < count; i++)
          Container(
            padding: const EdgeInsets.only(left: Tokens.sp3),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(Tokens.radiusSm),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.attach_file, size: 18),
                Flexible(child: Text(s.attachmentN(i + 1))),
                IconButton(
                  key: Key('view-$i'),
                  tooltip: '${s.view} ${s.attachmentN(i + 1)}',
                  icon: const Icon(Icons.visibility_outlined),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => FileScreen(title: s.attachmentN(i + 1), load: () => load(i)),
                    ),
                  ),
                ),
                IconButton(
                  key: Key('download-$i'),
                  tooltip: '${s.download} ${s.attachmentN(i + 1)}',
                  icon: const Icon(Icons.download_outlined),
                  onPressed: () async {
                    try {
                      final f = await load(i);
                      await SharePlus.instance.share(
                        ShareParams(
                          files: [
                            XFile.fromData(
                              Uint8List.fromList(f.bytes),
                              mimeType: f.contentType,
                              name: f.name,
                            ),
                          ],
                          fileNameOverrides: [f.name],
                        ),
                      );
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context)
                            .showSnackBar(SnackBar(content: Text(errorText(s, e))));
                      }
                    }
                  },
                ),
              ],
            ),
          ),
      ],
    );
  }
}
