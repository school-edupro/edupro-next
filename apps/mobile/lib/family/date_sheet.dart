import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
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

/// The child's exams with their papers: the day, the subject and the time.
class DateSheetScreen extends ConsumerWidget {
  const DateSheetScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<List<Json>>(
      value: ref.watch(dateSheetProvider(profile)),
      refresh: () => ref.refresh(dateSheetProvider(profile).future),
      children: (exams) => [
        if (exams.isEmpty) EmptyLine(s.nothingYet),
        for (final e in exams) ...[
          SectionTitle('${e['name']}'),
          if (e['note'] != null) Text('${e['note']}'),
          Card(
            child: Column(
              children: [
                for (final p in asList(
                  e['papers'],
                )..sort((a, b) => '${a['examOn']}'.compareTo('${b['examOn']}')))
                  ListTile(
                    title: Text('${p['subject']}'),
                    subtitle: Text(s.dayShort(p['examOn'])),
                    trailing: p['startsAt'] == null
                        ? null
                        : Text(
                            '${s.time(p['startsAt'] as String?)}–${s.time(p['endsAt'] as String?)}',
                          ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
