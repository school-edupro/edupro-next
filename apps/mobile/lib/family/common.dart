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
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: Tokens.fwSemibold),
            ),
          ),
        ),
        // a long action (large text) takes what is left and wraps rather than running off the screen
        if (action != null) Flexible(child: action!),
      ],
    ),
  );
}

/// A figure on Home: the number, what it is, a tap to its screen.
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
  final IconData icon;
  final VoidCallback? onTap;
  final Color? tone;

  @override
  Widget build(BuildContext context) => Card(
    margin: EdgeInsets.zero,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Tokens.radiusMd),
      child: Semantics(
        button: onTap != null,
        label: '$label: $value',
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: tone ?? Theme.of(context).colorScheme.primary),
              const SizedBox(height: Tokens.sp2),
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
              ),
              Text(label, maxLines: 2, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Two figures a row (an even number of tiles, as on the web dashboards).
class FigureGrid extends StatelessWidget {
  const FigureGrid({super.key, required this.tiles});
  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (var i = 0; i < tiles.length; i += 2)
        Padding(
          padding: const EdgeInsets.only(bottom: Tokens.sp3),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[i]),
                const SizedBox(width: Tokens.sp3),
                Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
              ],
            ),
          ),
        ),
    ],
  );
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

/// A screen of its own (pushed over the tabs) with the title in the bar.
class FamilyPage extends StatelessWidget {
  const FamilyPage({super.key, required this.title, required this.child, this.actions});
  final String title;
  final Widget child;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title), actions: actions),
    body: child,
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
