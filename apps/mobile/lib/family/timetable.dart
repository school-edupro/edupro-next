import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// The child's week, a day at a time (today first): each period with its subject, teacher and room.
class TimetableScreen extends ConsumerStatefulWidget {
  const TimetableScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<TimetableScreen> createState() => _TimetableScreenState();
}

class _TimetableScreenState extends ConsumerState<TimetableScreen> {
  // Monday … Saturday; on Sunday the week ahead opens on Monday
  int _day = DateTime.now().weekday == 7 ? 1 : DateTime.now().weekday;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    return LoadedList<Json>(
      value: ref.watch(timetableProvider(p)),
      refresh: () => ref.refresh(timetableProvider(p).future),
      children: (tt) {
        final periods = asList(tt['periods'])
          ..sort((a, b) => ((a['number'] as num?) ?? 0).compareTo((b['number'] as num?) ?? 0));
        final slots = asList(tt['slots']).where((x) => x['weekday'] == _day).toList();
        return [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SegmentedButton<int>(
              key: const Key('weekday'),
              showSelectedIcon: false,
              segments: [
                for (var d = 1; d <= 6; d++) ButtonSegment(value: d, label: Text(s.weekday(d))),
              ],
              selected: {_day},
              onSelectionChanged: (v) => setState(() => _day = v.first),
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          if (slots.isEmpty) EmptyLine(s.nothingYet),
          if (slots.isNotEmpty)
            for (final period in periods) _row(context, s, period, slots),
        ];
      },
    );
  }

  Widget _row(BuildContext context, S s, Json period, List<Json> slots) {
    final slot = slots.where((x) => '${x['periodId']}' == '${period['id']}').firstOrNull;
    final time = '${s.time(period['startsAt'] as String?)}–${s.time(period['endsAt'] as String?)}';
    if (period['isBreak'] == true) {
      return ListTile(
        dense: true,
        leading: const Icon(Icons.free_breakfast_outlined),
        title: Text(s.breakTime),
        trailing: Text(time),
      );
    }
    return Card(
      child: ListTile(
        leading: CircleAvatar(child: Text('${period['number'] ?? ''}')),
        title: Text(slot?['subjectName'] as String? ?? '—'),
        subtitle: Text(
          [
            if (slot?['teacherName'] != null) '${slot!['teacherName']}',
            if (slot?['room'] != null) '${slot!['room']}',
          ].join(' · '),
        ),
        trailing: Text(time),
      ),
    );
  }
}
