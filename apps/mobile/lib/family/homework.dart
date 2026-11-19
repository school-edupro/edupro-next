import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// The two weeks of daily work Home looks at for what is due: given from 14 days ago up to today.
(Profile, String, String) workRange(Profile p) {
  final today = DateTime.now();
  return (p, ymd(today.subtract(const Duration(days: 14))), ymd(today));
}

/// Work still to hand in, the nearest first.
List<Json> dueSoon(List<Json> work, {int days = 1000}) {
  final today = ymd(DateTime.now());
  final until = ymd(DateTime.now().add(Duration(days: days)));
  return work
      .where((w) => w['dueOn'] != null && '${w['dueOn']}'.compareTo(today) >= 0)
      .where((w) => '${w['dueOn']}'.compareTo(until) <= 0)
      .toList()
    ..sort((a, b) => '${a['dueOn']}'.compareTo('${b['dueOn']}'));
}

/// Homework as the website shows it (apps/parent/app/(app)/homework), on the phone's own screens.
/// **Homework and classwork**: a day at a time — Previous / Today / Next, any earlier day from the calendar, the
/// days that had work — each subject with its homework, then its classwork. **Assignments**: given from / to,
/// the ones still to do (the nearest due date first), then the ones past the due date.
class HomeworkScreen extends ConsumerStatefulWidget {
  const HomeworkScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<HomeworkScreen> createState() => _HomeworkScreenState();
}

class _HomeworkScreenState extends ConsumerState<HomeworkScreen> {
  String _view = 'day';
  DateTime _date = _today();
  DateTime? _from;
  DateTime? _to;

  static DateTime _today() {
    final n = DateTime.now();
    return DateTime(n.year, n.month, n.day);
  }

  Profile get _p => widget.profile;

  /// the chosen day and the 13 before it: the day's work and the days that had work
  (Profile, String, String) get _window =>
      (_p, ymd(_date.subtract(const Duration(days: 13))), ymd(_date));

  (Profile, String, String) get _range =>
      (_p, _from == null ? '' : ymd(_from!), _to == null ? '' : ymd(_to!));

  @override
  Widget build(BuildContext context) {
    final assignments = ref.watch(assignmentsProvider(_range));
    final today = ymd(_today());
    final open = (assignments.value?.data ?? const <Json>[])
        .where((a) => a['dueOn'] == null || '${a['dueOn']}'.compareTo(today) >= 0)
        .length;
    return _view == 'assignments'
        ? LoadedList<List<Json>>(
            key: const ValueKey('hw-assignments'),
            value: assignments,
            refresh: () => ref.refresh(assignmentsProvider(_range).future),
            children: (list) => [_tabs(open), ..._assignments(list)],
          )
        : LoadedList<List<Json>>(
            key: const ValueKey('hw-day'),
            value: ref.watch(homeworkProvider(_window)),
            refresh: () {
              ref.invalidate(assignmentsProvider(_range));
              return ref.refresh(homeworkProvider(_window).future);
            },
            children: (work) => [_tabs(open), ..._day(work)],
          );
  }

  Widget _tabs(int open) {
    final s = ref.watch(stringsProvider);
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Semantics(
        label: s.homework,
        container: true,
        explicitChildNodes: true,
        child: Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final (v, label) in [
              ('day', s.homeworkAndClasswork),
              ('assignments', open > 0 ? '${s.assignmentsTab} ($open)' : s.assignmentsTab),
            ])
              ChoiceChip(
                key: Key('hwView-$v'),
                label: Text(label),
                selected: _view == v,
                showCheckmark: false,
                onSelected: (_) => setState(() => _view = v),
              ),
          ],
        ),
      ),
    );
  }

  Future<DateTime?> _pickDate(DateTime initial) => showDatePicker(
    context: context,
    initialDate: initial,
    firstDate: DateTime(_today().year - 3),
    lastDate: _today(),
  );

  // ---------------------------------------------------------------- a day

  List<Widget> _day(List<Json> recent) {
    final s = ref.watch(stringsProvider);
    final today = _today();
    final day = ymd(_date);
    final work = recent.where((w) => w['kind'] != 'assignment').toList();
    final ofDay = work.where((w) => '${w['assignedOn']}' == day).toList();
    final days = {for (final w in work) '${w['assignedOn']}'}.toList()
      ..sort((a, b) => b.compareTo(a));
    final subjects = <String, List<Json>>{};
    for (final w in ofDay) {
      (subjects['${w['subjectName'] ?? s.generalSubject}'] ??= []).add(w);
    }
    final title = s.dayLong(_date) + (_date.year == today.year ? '' : ' ${_date.year}');
    return [
      Row(
        children: [
          IconButton(
            key: const Key('dayBack'),
            tooltip: s.previous,
            icon: const Icon(Icons.chevron_left),
            onPressed: () => setState(() => _date = _date.subtract(const Duration(days: 1))),
          ),
          Expanded(
            child: Text(
              title,
              key: const Key('hwDay'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
          ),
          IconButton(
            key: const Key('dayNext'),
            tooltip: s.next,
            icon: const Icon(Icons.chevron_right),
            onPressed: _date.isBefore(today)
                ? () => setState(() => _date = _date.add(const Duration(days: 1)))
                : null,
          ),
        ],
      ),
      Wrap(
        spacing: Tokens.sp2,
        runSpacing: Tokens.sp2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          OutlinedButton.icon(
            key: const Key('pickDay'),
            icon: const Icon(Icons.event),
            label: Text(s.chooseDay(s.date(_date))),
            onPressed: () async {
              final d = await _pickDate(_date);
              if (d != null) setState(() => _date = d);
            },
          ),
          if (_date != today)
            TextButton(
              key: const Key('dayToday'),
              onPressed: () => setState(() => _date = today),
              child: Text(s.today),
            ),
        ],
      ),
      if (days.isNotEmpty) ...[
        const SizedBox(height: Tokens.sp3),
        Semantics(
          label: s.daysWithWork,
          container: true,
          explicitChildNodes: true,
          child: Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              for (final d in days.take(7))
                ChoiceChip(
                  key: Key('workDay-$d'),
                  label: Text(d == ymd(today) ? s.today : s.dayShort(d)),
                  selected: d == day,
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _date = DateTime.parse(d)),
                ),
            ],
          ),
        ),
      ],
      const SizedBox(height: Tokens.sp3),
      if (ofDay.isEmpty)
        EmptyLine(_date == today ? s.nothingToday : s.nothingThatDay)
      else
        for (final MapEntry(:key, :value) in subjects.entries) ...[
          SectionTitle(key),
          for (final kind in const ['homework', 'classwork'])
            for (final w in value.where((w) => w['kind'] == kind)) WorkEntry(profile: _p, work: w),
        ],
    ];
  }

  // ---------------------------------------------------------------- assignments

  List<Widget> _assignments(List<Json> list) {
    final s = ref.watch(stringsProvider);
    final today = ymd(_today());
    final open =
        list.where((a) => a['dueOn'] == null || '${a['dueOn']}'.compareTo(today) >= 0).toList()
          ..sort((a, b) => '${a['dueOn'] ?? '9999'}'.compareTo('${b['dueOn'] ?? '9999'}'));
    final past = list
        .where((a) => a['dueOn'] != null && '${a['dueOn']}'.compareTo(today) < 0)
        .toList();
    Widget one(Json w) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: Tokens.sp2, bottom: Tokens.sp1),
          child: Text(
            '${w['subjectName'] ?? s.generalSubject} · ${s.givenOn(s.dayShort(w['assignedOn'] ?? ''))}',
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
        ),
        WorkEntry(profile: _p, work: w),
      ],
    );
    return [
      Wrap(
        spacing: Tokens.sp2,
        runSpacing: Tokens.sp2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          OutlinedButton.icon(
            key: const Key('asgFrom'),
            icon: const Icon(Icons.event),
            label: Text('${s.givenFrom}: ${_from == null ? '—' : s.date(_from!)}'),
            onPressed: () async {
              final d = await _pickDate(_from ?? _today());
              if (d != null) setState(() => _from = d);
            },
          ),
          OutlinedButton.icon(
            key: const Key('asgTo'),
            icon: const Icon(Icons.event),
            label: Text('${s.givenTo}: ${_to == null ? '—' : s.date(_to!)}'),
            onPressed: () async {
              final d = await _pickDate(_to ?? _today());
              if (d != null) setState(() => _to = d);
            },
          ),
          if (_from != null || _to != null)
            TextButton(
              key: const Key('asgClear'),
              onPressed: () => setState(() {
                _from = null;
                _to = null;
              }),
              child: Text(s.clearDates),
            ),
        ],
      ),
      SectionTitle(s.toDo),
      if (open.isEmpty) EmptyLine(s.noPendingAssignment) else for (final w in open) one(w),
      if (past.isNotEmpty) ...[SectionTitle(s.pastDueDate), for (final w in past) one(w)],
    ];
  }
}

/// One piece of work as the website shows it: its kind, the text, the due date (overdue in red), the files, who
/// posted it and when, and "I have seen this" when the teacher asks for it.
class WorkEntry extends ConsumerStatefulWidget {
  const WorkEntry({super.key, required this.profile, required this.work});
  final Profile profile;
  final Json work;

  @override
  ConsumerState<WorkEntry> createState() => _WorkEntryState();
}

class _WorkEntryState extends ConsumerState<WorkEntry> {
  late bool _seen =
      widget.work['ackedFor'] is List &&
      (widget.work['ackedFor'] as List).contains(widget.profile.studentId);
  bool _busy = false;

  Future<void> _ack() async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      await ref
          .read(apiProvider)
          .documentsAck(
            body: AckDto(
              type: 'daily_work',
              id: '${widget.work['id']}',
              studentId: widget.profile.studentId,
            ),
          );
      if (mounted) setState(() => _seen = true);
      ref.invalidate(homeworkProvider);
      ref.invalidate(assignmentsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final w = widget.work;
    final id = '${w['id']}';
    final kind = '${w['kind']}';
    final today = ymd(DateTime.now());
    final due = w['dueOn'] as String?;
    final late = kind == 'assignment' && due != null && due.compareTo(today) < 0;
    final title = '${w['title'] ?? ''}';
    final body = '${w['body'] ?? ''}';
    final files = asList(w['files']);
    final published = DateTime.tryParse('${w['publishAt'] ?? ''}');
    return Card(
      key: Key('entry-$id'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Tag(
              s.workKind(kind),
              color: switch (kind) {
                'classwork' => Tokens.statusInfoBg,
                'assignment' => Tokens.statusWarningBg,
                _ => Tokens.mobCyan100,
              },
            ),
            const SizedBox(height: Tokens.sp2),
            if (title.isNotEmpty && title != body)
              Text(title, style: const TextStyle(fontWeight: Tokens.fwBold)),
            if (body.isNotEmpty) SelectionArea(child: Text(body)),
            if (due != null) ...[
              const SizedBox(height: Tokens.sp2),
              StatusChip(
                '${s.dueShort(s.dayShort(due))}${late ? ' · ${s.overdueWord}' : ''}',
                late
                    ? Tone.danger
                    : due == today
                    ? Tone.warning
                    : Tone.neutral,
              ),
            ],
            if (files.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Attachments(
                count: files.length,
                load: (i) =>
                    ref.read(apiProvider).dailyWorkFile(id: id, fileId: '${files[i]['id']}'),
              ),
            ],
            const SizedBox(height: Tokens.sp2),
            Text(
              [
                if (w['postedBy'] != null) '${w['postedBy']}',
                if (published != null) s.publishedAt(s.dateTime(published)),
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            if (w['ackRequired'] == true) ...[
              const SizedBox(height: Tokens.sp2),
              _seen
                  ? Row(
                      children: [
                        const Icon(Icons.check_circle, color: Tokens.statusSuccess),
                        const SizedBox(width: Tokens.sp2),
                        Text(s.acknowledged),
                      ],
                    )
                  : FilledButton(
                      key: Key('ack-$id'),
                      onPressed: _busy ? null : _ack,
                      child: Text(s.acknowledge),
                    ),
            ],
          ],
        ),
      ),
    );
  }
}

/// One piece of work in the list; a tap opens it.
class WorkTile extends ConsumerWidget {
  const WorkTile({super.key, required this.profile, required this.work});
  final Profile profile;
  final Json work;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final seen = work['ackedFor'] is List && (work['ackedFor'] as List).contains(profile.studentId);
    return Card(
      child: ListTile(
        key: Key('work-${work['id']}'),
        title: Text('${work['title']}'),
        subtitle: Text(
          [
            s.workKind('${work['kind']}'),
            if (work['subjectName'] != null) '${work['subjectName']}',
            if (work['dueOn'] != null) s.dueOn(s.dayShort(work['dueOn'])),
          ].join(' · '),
        ),
        trailing: work['ackRequired'] == true && !seen
            ? const Icon(Icons.mark_email_unread_outlined)
            : const Icon(Icons.chevron_right),
        onTap: () => pushPage(
          context,
          s.workKind('${work['kind']}'),
          WorkDetail(profile: profile, work: work),
        ),
      ),
    );
  }
}

/// A piece of work in full: the text, who gave it, the dates, the files, and "I have seen this" when asked.
class WorkDetail extends ConsumerStatefulWidget {
  const WorkDetail({super.key, required this.profile, required this.work});
  final Profile profile;
  final Json work;

  @override
  ConsumerState<WorkDetail> createState() => _WorkDetailState();
}

class _WorkDetailState extends ConsumerState<WorkDetail> {
  late bool _seen =
      (widget.work['ackedFor'] is List) &&
      (widget.work['ackedFor'] as List).contains(widget.profile.studentId);
  bool _busy = false;

  Future<void> _ack() async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      await ref
          .read(apiProvider)
          .documentsAck(
            body: AckDto(
              type: 'daily_work',
              id: '${widget.work['id']}',
              studentId: widget.profile.studentId,
            ),
          );
      setState(() => _seen = true);
      ref.invalidate(homeworkProvider(workRange(widget.profile)));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final w = widget.work;
    final files = asList(w['files']);
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Semantics(
          header: true,
          child: Text('${w['title']}', style: Theme.of(context).textTheme.titleLarge),
        ),
        const SizedBox(height: Tokens.sp1),
        Text(
          [
            if (w['subjectName'] != null) '${w['subjectName']}',
            s.dayShort(w['assignedOn']),
            if (w['postedBy'] != null) s.postedBy('${w['postedBy']}'),
          ].join(' · '),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (w['dueOn'] != null) ...[
          const SizedBox(height: Tokens.sp2),
          StatusChip(s.dueOn(s.date(w['dueOn'])), Tone.warning),
        ],
        const SizedBox(height: Tokens.sp4),
        SelectionArea(child: Text('${w['body'] ?? ''}')),
        const SizedBox(height: Tokens.sp4),
        Attachments(
          count: files.length,
          load: (i) =>
              ref.read(apiProvider).dailyWorkFile(id: '${w['id']}', fileId: '${files[i]['id']}'),
        ),
        if (w['ackRequired'] == true) ...[
          const SizedBox(height: Tokens.sp4),
          _seen
              ? Row(
                  children: [
                    const Icon(Icons.check_circle, color: Tokens.statusSuccess),
                    const SizedBox(width: Tokens.sp2),
                    Text(s.acknowledged),
                  ],
                )
              : FilledButton(
                  key: const Key('ackWork'),
                  onPressed: _busy ? null : _ack,
                  child: Text(s.acknowledge),
                ),
        ],
      ],
    );
  }
}
