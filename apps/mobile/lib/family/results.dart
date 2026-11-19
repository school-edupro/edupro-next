import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The child's released results: each card (exam, term, annual) with its marks, the report card to read and its PDF.
class ResultsScreen extends ConsumerWidget {
  const ResultsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<List<Json>>(
      value: ref.watch(resultsProvider(profile)),
      refresh: () => ref.refresh(resultsProvider(profile).future),
      children: (terms) => [
        if (terms.isEmpty) EmptyLine(s.nothingYet),
        for (final t in terms) _TermCard(profile: profile, term: t),
      ],
    );
  }
}

class _TermCard extends ConsumerWidget {
  const _TermCard({required this.profile, required this.term});
  final Profile profile;
  final Json term;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final closed = term['withheld'] == true || term['held'] == true;
    final release = '${term['releaseId']}';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text('${term['name']}', style: Theme.of(context).textTheme.titleMedium),
            ),
            if (term['releasedAt'] != null)
              Text(
                s.date('${term['releasedAt']}'.split('T').first),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: Tokens.sp2),
            for (final e in asList(term['exams']))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
                // the name, then its figures (they wrap under it with large text)
                child: Wrap(
                  spacing: Tokens.sp3,
                  runSpacing: Tokens.sp1,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('${e['name']}', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                    if (e['pct'] != null) Text('${e['pct']}%'),
                    if (e['grade'] != null)
                      Text('${e['grade']}', style: const TextStyle(fontWeight: Tokens.fwBold)),
                    if (e['rank'] != null) Text(s.rank((e['rank'] as num).toInt())),
                    if (e['result'] != null) StatusChip('${e['result']}', Tone.neutral),
                  ],
                ),
              ),
            const SizedBox(height: Tokens.sp3),
            if (closed)
              Notice(text: term['feeDue'] == true ? s.heldForFees : s.withheld)
            else
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  OutlinedButton.icon(
                    key: Key('reportCard-$release'),
                    icon: const Icon(Icons.visibility_outlined),
                    label: Text(s.reportCard),
                    onPressed: () => pushPage(
                      context,
                      '${term['name']}',
                      ReportCardView(releaseId: release, studentId: profile.studentId!),
                    ),
                  ),
                  OutlinedButton.icon(
                    key: Key('reportCardPdf-$release'),
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    label: Text(s.reportCardPdf),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => FileScreen(
                          title: '${term['name']}',
                          load: () => reportCardPdf(
                            ref.read(apiProvider),
                            ref.read(transportProvider),
                            releaseId: release,
                            studentId: profile.studentId!,
                            late: s.pdfLate,
                            failed: s.pdfFailed,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

/// The report card as the school prints it (the API's page), inside the app.
final _reportCardProvider = FutureProvider.autoDispose.family<String, (String, String)>((
  ref,
  a,
) async {
  final (release, student) = a;
  final r = asJson(
    await ref.read(apiProvider).familyResultsView(releaseId: release, studentId: student),
  );
  return '${r['html'] ?? ''}';
});

class ReportCardView extends ConsumerWidget {
  const ReportCardView({super.key, required this.releaseId, required this.studentId});
  final String releaseId;
  final String studentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final html = ref.watch(_reportCardProvider((releaseId, studentId)));
    return switch (html) {
      AsyncValue(:final value?) => InAppWebView(
        key: const Key('reportCardPage'),
        initialData: InAppWebViewInitialData(data: value),
        initialSettings: InAppWebViewSettings(javaScriptEnabled: false, cacheEnabled: false),
      ),
      AsyncValue(:final error?) => Center(child: ErrorText(errorText(s, error))),
      _ => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
    };
  }
}
