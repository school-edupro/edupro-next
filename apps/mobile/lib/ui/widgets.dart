import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// The sign-in and lock pages: the EduPro band on top, the form in a card.
class BrandedPage extends StatelessWidget {
  const BrandedPage({super.key, required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Tokens.sp5),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Semantics(
                    header: true,
                    child: Text(
                      'EduPro',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: Tokens.fwBold,
                      ),
                    ),
                  ),
                  const SizedBox(height: Tokens.sp5),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(Tokens.sp5),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Semantics(
                            header: true,
                            child: Text(title, style: Theme.of(context).textTheme.titleLarge),
                          ),
                          const SizedBox(height: Tokens.sp3),
                          ...children,
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ErrorText extends StatelessWidget {
  const ErrorText(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Text(text, style: TextStyle(color: Theme.of(context).colorScheme.error)),
  );
}

/// A highlighted line (the code a school shows on screen).
class Notice extends StatelessWidget {
  const Notice({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(Tokens.sp3),
    decoration: BoxDecoration(
      color: Tokens.statusInfoBg,
      borderRadius: BorderRadius.circular(Tokens.radiusSm),
    ),
    child: Text(text, style: const TextStyle(color: Tokens.mobCyan700)),
  );
}

/// English / हिन्दी, kept for next time.
class LanguageSwitch extends ConsumerWidget {
  const LanguageSwitch({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hindi = ref.watch(hindiProvider);
    return SegmentedButton<bool>(
      segments: const [
        ButtonSegment(value: false, label: Text('English')),
        ButtonSegment(value: true, label: Text('हिन्दी')),
      ],
      selected: {hindi},
      onSelectionChanged: (v) => ref.read(hindiProvider.notifier).set(v.first),
    );
  }
}

/// Loading, an error with "try again", or the content.
class AsyncBody<T> extends ConsumerWidget {
  const AsyncBody({super.key, required this.value, required this.data, required this.retry});
  final AsyncValue<T> value;
  final Widget Function(T) data;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return value.when(
      data: data,
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ErrorText('$e'.contains('offline') ? s.offline : '$e'),
              const SizedBox(height: Tokens.sp3),
              OutlinedButton(onPressed: retry, child: Text(s.retry)),
            ],
          ),
        ),
      ),
    );
  }
}
