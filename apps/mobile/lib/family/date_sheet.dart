import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The paper still to come, the nearest first (Home's "next exam").
Json? nextPaper(List<Json> exams) {
  final today = ymd(DateTime.now());
  final papers = [
    for (final e in exams)
      for (final p in asList(e['papers']))
        if ('${p['examOn']}'.compareTo(today) >= 0) {...p, 'exam': e['name']},
  ]..sort((a, b) => '${a['examOn']}'.compareTo('${b['examOn']}'));
  return papers.firstOrNull;
}

String _time(S s, Json p) => p['startsAt'] == null
    ? ''
    : '${s.time(p['startsAt'] as String?)}${p['endsAt'] == null ? '' : '–${s.time(p['endsAt'] as String?)}'}';

/// The child's exam date sheet as the website shows it (apps/parent/app/(app)/date-sheet): the next paper on
/// top; each exam still to come with its papers (date, day, time, subject) and the school's note; the earlier
/// exams folded away.
class DateSheetScreen extends ConsumerWidget {
  const DateSheetScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return LoadedList<List<Json>>(
      value: ref.watch(dateSheetProvider(profile)),
      refresh: () => ref.refresh(dateSheetProvider(profile).future),
      children: (exams) {
        final today = ymd(DateTime.now());
        final coming = exams
            .where((e) => asList(e['papers']).any((p) => '${p['examOn']}'.compareTo(today) >= 0))
            .toList();
        final earlier = exams.where((e) => !coming.contains(e)).toList();
        final next = coming.isEmpty
            ? null
            : asList(coming.first['papers'])
                  .where((p) => '${p['examOn']}'.compareTo(today) >= 0)
                  .firstOrNull;
        return [
          Text(s.dateSheetHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
          if (next != null) ...[
            Notice(
              key: const Key('nextPaper'),
              text: s.nextPaperLine(
                [
                  '${next['subject']}',
                  s.dayLong(DateTime.parse('${next['examOn']}')),
                  if (_time(s, next).isNotEmpty) _time(s, next),
                ].join(' · '),
              ),
            ),
            const SizedBox(height: Tokens.sp3),
          ],
          if (exams.isEmpty || coming.isEmpty) EmptyLine(exams.isEmpty ? s.noDateSheet : s.noExam),
          for (final e in coming) ...[
            SectionTitle('${e['name']}', key: Key('exam-${e['id']}')),
            _Papers(exam: e),
            if ('${e['note'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp2),
                child: Text('${e['note']}', style: TextStyle(color: muted, fontSize: 14)),
              ),
          ],
          if (earlier.isNotEmpty) ...[
            const SizedBox(height: Tokens.sp4),
            Card(
              clipBehavior: Clip.antiAlias,
              child: ExpansionTile(
                key: const Key('earlierExams'),
                leading: const Icon(Icons.history_outlined),
                title: Text(
                  s.earlierExams(earlier.length),
                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                ),
                shape: const Border(),
                collapsedShape: const Border(),
                expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, 0, Tokens.sp3, Tokens.sp3),
                children: [
                  for (final e in earlier) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: Tokens.sp3, bottom: Tokens.sp1),
                      child: Text(
                        '${e['name']}',
                        style: const TextStyle(fontWeight: Tokens.fwBold),
                      ),
                    ),
                    _Papers(exam: e, flat: true),
                  ],
                ],
              ),
            ),
          ],
        ];
      },
    );
  }
}

/// An exam's papers as the website's table: the date with its day, the time, the subject.
class _Papers extends ConsumerWidget {
  const _Papers({required this.exam, this.flat = false});
  final Json exam;

  /// inside the folded earlier exams: no card of its own
  final bool flat;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final papers = asList(exam['papers'])
      ..sort((a, b) => '${a['examOn']}'.compareTo('${b['examOn']}'));
    final rows = Column(
      children: [
        for (final (i, p) in papers.indexed)
          Container(
            key: Key('paper-${exam['id']}-$i'),
            padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: Tokens.sp3),
            decoration: BoxDecoration(
              border: i == 0
                  ? null
                  : Border(top: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray100)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 96,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.date(p['examOn'] ?? '').replaceAll(RegExp(r' \d{4}$'), ''),
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                      Text(
                        s.dayLong(DateTime.parse('${p['examOn']}')).split(',').first,
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: Tokens.sp2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${p['subject']}', style: const TextStyle(fontWeight: Tokens.fwBold)),
                      if (_time(s, p).isNotEmpty)
                        Text(_time(s, p), style: TextStyle(color: muted, fontSize: 13)),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
    return flat ? rows : Card(child: rows);
  }
}
