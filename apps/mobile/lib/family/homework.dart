import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'common.dart';
import 'data.dart';

/// The two weeks of daily work the app shows: given from 14 days ago up to today.
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

/// Homework, classwork and assignments: what is due first, then the last two weeks by day.
class HomeworkScreen extends ConsumerWidget {
  const HomeworkScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final range = workRange(profile);
    return LoadedList<List<Json>>(
      value: ref.watch(homeworkProvider(range)),
      refresh: () => ref.refresh(homeworkProvider(range).future),
      children: (work) {
        if (work.isEmpty) return [EmptyLine(s.nothingYet)];
        final due = dueSoon(work);
        final byDay = <String, List<Json>>{};
        for (final w in work) {
          (byDay['${w['assignedOn']}'] ??= []).add(w);
        }
        return [
          if (due.isNotEmpty) ...[
            SectionTitle(s.homeworkDue),
            for (final w in due) WorkTile(profile: profile, work: w),
          ],
          for (final MapEntry(:key, :value) in byDay.entries) ...[
            SectionTitle(s.dayShort(key)),
            for (final w in value) WorkTile(profile: profile, work: w),
          ],
        ];
      },
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
