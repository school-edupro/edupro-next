import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// The school's holidays and events, a month at a time.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);

  (Profile, String, String) get _arg =>
      (widget.profile, ymd(_month), ymd(DateTime(_month.year, _month.month + 1, 0)));

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return LoadedList<Json>(
      value: ref.watch(calendarProvider(_arg)),
      refresh: () => ref.refresh(calendarProvider(_arg).future),
      children: (cal) {
        final entries = [
          for (final h in asList(cal['holidays']))
            (start: '${h['startsOn']}', end: '${h['endsOn']}', name: '${h['name']}', holiday: true),
          for (final e in asList(cal['events']))
            (
              start: '${e['startsOn']}',
              end: '${e['endsOn']}',
              name: '${e['title']}',
              holiday: false,
            ),
        ]..sort((a, b) => a.start.compareTo(b.start));
        return [
          Row(
            children: [
              IconButton(
                tooltip: s.previous,
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
              ),
              Expanded(
                child: Text(
                  s.month(_month),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                tooltip: s.next,
                icon: const Icon(Icons.chevron_right),
                onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
              ),
            ],
          ),
          if (entries.isEmpty) EmptyLine(s.nothingYet),
          for (final e in entries)
            Card(
              child: ListTile(
                leading: Icon(e.holiday ? Icons.beach_access_outlined : Icons.event_outlined),
                title: Text(e.name),
                subtitle: Text(
                  e.start == e.end
                      ? s.dayShort(e.start)
                      : '${s.dayShort(e.start)} – ${s.dayShort(e.end)}',
                ),
                trailing: StatusChip(
                  e.holiday ? s.holidays : s.events,
                  e.holiday ? Tone.success : Tone.info,
                ),
              ),
            ),
          const SizedBox(height: Tokens.sp4),
        ];
      },
    );
  }
}
