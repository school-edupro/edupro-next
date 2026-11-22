import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'data.dart';
import 'lesson_plans.dart';

/// The classes and subjects the teacher teaches, with their coverage (none when the syllabus is not part of the role).
final mySyllabusProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((ref, p) async {
  try {
    final r = asJson(await ref.read(apiProvider).syllabusMine());
    return [for (final x in asList(r['data'])) asJson(x)];
  } on ApiException catch (e) {
    if (e.status == 403) return const [];
    rethrow;
  }
});

/// A class and subject's chapters and topics, with what is done in the section.
typedef SyllabusKey = ({String classId, String subjectId, String sectionId});
final syllabusTreeProvider = FutureProvider.autoDispose.family<Json, SyllabusKey>(
  (ref, k) async => asJson(
    await ref
        .read(apiProvider)
        .syllabusTree(classId: k.classId, subjectId: k.subjectId, classSectionId: k.sectionId),
  ),
);

int _n(Object? v) => (v as num?)?.toInt() ?? 0;

/// My syllabus as on the staff website (docs/design/96, part 9): each class and subject the teacher teaches — topics
/// done (and partly), how much is covered, on track or behind the plan; a subject opens its chapters and topics to
/// mark. No web page.
class MySyllabusScreen extends ConsumerWidget {
  const MySyllabusScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final rows = ref.watch(mySyllabusProvider(profile));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(mySyllabusProvider(profile).future),
      child: ListView(
        key: const Key('syList'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(s.sySubtitle, style: TextStyle(color: muted)),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              key: const Key('syLessonPlans'),
              onPressed: () =>
                  pushPage(context, s.menu('Lesson plans'), LessonPlansScreen(profile: profile)),
              icon: const Icon(Icons.menu_book_outlined),
              label: Text(s.menu('Lesson plans')),
            ),
          ),
          ...rows.when(
            loading: () => [const LinearProgressIndicator()],
            error: (e, _) => [Text(errorText(s, e), style: TextStyle(color: muted))],
            data: (list) => list.isEmpty
                ? [
                    Text(
                      s.syNone,
                      key: const Key('syNone'),
                      style: TextStyle(color: muted),
                    ),
                  ]
                : [for (final r in list) _row(context, s, r, muted)],
          ),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, S s, Json r, Color muted) {
    final behind = _n(r['behind']);
    final percent = _n(r['percent']);
    final key = '${r['classSectionId']}-${r['subjectId']}';
    void open() => pushPage(
      context,
      '${r['section']} · ${r['subject']}',
      SyllabusSubjectScreen(
        profile: profile,
        sectionId: '${r['classSectionId']}',
        subjectId: '${r['subjectId']}',
      ),
    );
    return Card(
      key: Key('syRow-$key'),
      child: InkWell(
        onTap: open,
        borderRadius: BorderRadius.circular(Tokens.radiusMd),
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp1,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('${r['section']}', style: TextStyle(color: muted)),
                  StatusChip(
                    behind > 0 ? s.syBehind(behind) : s.syOnTrack,
                    behind > 0 ? Tone.danger : Tone.success,
                  ),
                ],
              ),
              Text(
                '${r['subject']}',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
              const SizedBox(height: Tokens.sp1),
              Semantics(
                label: s.syCovered(percent),
                child: ExcludeSemantics(
                  child: LinearProgressIndicator(
                    value: (percent.clamp(0, 100)) / 100,
                    minHeight: 6,
                    borderRadius: BorderRadius.circular(Tokens.radiusSm),
                  ),
                ),
              ),
              const SizedBox(height: Tokens.sp1),
              Text(
                '${s.syDoneOf(_n(r['done']), _n(r['topics']), _n(r['partial']))} · ${s.syCovered(percent)}',
                style: TextStyle(color: muted, fontSize: 13),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton(
                  key: Key('syOpen-$key'),
                  onPressed: open,
                  child: Text(s.view),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A class and subject's syllabus as on the website: how much is covered, then each chapter (its term and the month it
/// is planned for) and its topics — the periods, Done / Partly done / Not done (and when) or Pending, the remark —
/// each marked with the day it was taught and a remark (needed for Not done).
class SyllabusSubjectScreen extends ConsumerStatefulWidget {
  const SyllabusSubjectScreen({
    super.key,
    required this.profile,
    required this.sectionId,
    required this.subjectId,
  });
  final Profile profile;
  final String sectionId;
  final String subjectId;

  @override
  ConsumerState<SyllabusSubjectScreen> createState() => _SyllabusSubjectScreenState();
}

class _SyllabusSubjectScreenState extends ConsumerState<SyllabusSubjectScreen> {
  final Map<String, TextEditingController> _remarks = {};
  final Map<String, DateTime> _days = {};
  final Map<String, String> _errors = {};
  String? _busy;

  @override
  void dispose() {
    for (final c in _remarks.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _remark(Json t) =>
      _remarks.putIfAbsent('${t['id']}', () => TextEditingController(text: '${t['reason'] ?? ''}'));

  DateTime _day(Json t) =>
      _days['${t['id']}'] ?? DateTime.tryParse('${t['doneOn'] ?? ''}') ?? schoolToday();

  Future<void> _pickDay(Json t) async {
    final today = schoolToday();
    final d = await showDatePicker(
      context: context,
      initialDate: _day(t).isAfter(today) ? today : _day(t),
      firstDate: DateTime(today.year - 2),
      lastDate: today,
    );
    if (d != null) setState(() => _days['${t['id']}'] = d);
  }

  Future<void> _mark(Json t, String status, SyllabusKey key) async {
    final s = ref.read(stringsProvider);
    final id = '${t['id']}';
    final reason = _remark(t).text.trim();
    if (status == 'not_done' && reason.isEmpty) {
      return setState(() => _errors[id] = s.syNeedReason);
    }
    setState(() {
      _busy = id;
      _errors.remove(id);
    });
    try {
      await ref
          .read(apiProvider)
          .syllabusMark(
            body: MarkTopicDto(
              classSectionId: widget.sectionId,
              topicId: id,
              status: status,
              doneOn: status == 'not_done' ? null : ymd(_day(t)),
              reason: reason.isEmpty ? null : reason,
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.saved)));
      ref.invalidate(syllabusTreeProvider(key));
      ref.invalidate(mySyllabusProvider(widget.profile));
    } catch (e) {
      if (mounted) setState(() => _errors[id] = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final row = ref
        .watch(mySyllabusProvider(widget.profile))
        .value
        ?.where(
          (r) =>
              '${r['classSectionId']}' == widget.sectionId &&
              '${r['subjectId']}' == widget.subjectId,
        )
        .firstOrNull;
    if (row == null) {
      return Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      );
    }
    final key = (
      classId: '${row['classId']}',
      subjectId: widget.subjectId,
      sectionId: widget.sectionId,
    );
    final tree = ref.watch(syllabusTreeProvider(key));
    return ListView(
      key: const Key('sySubject'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(
          s.syHeader(_n(row['percent']), _n(row['done']), _n(row['topics']), _n(row['behind'])),
          key: const Key('syHeader'),
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: Tokens.sp3),
        ...tree.when(
          loading: () => [const LinearProgressIndicator()],
          error: (e, _) => [Text(errorText(s, e), style: TextStyle(color: muted))],
          data: (t) => [for (final c in asList(t['chapters'])) _chapter(s, asJson(c), key, muted)],
        ),
      ],
    );
  }

  Widget _chapter(S s, Json c, SyllabusKey key, Color muted) {
    final topics = [for (final t in asList(c['topics'])) asJson(t)];
    final month = _n(c['plannedMonth']);
    final when = [
      if ('${c['term'] ?? ''}'.isNotEmpty) '${c['term']}',
      if (month >= 1 && month <= 12) s.syPlanned(s.monthShort(DateTime(2000, month))),
    ].join(' · ');
    return Card(
      key: Key('syChapter-${c['id']}'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text(
                s.syChapter(_n(c['number']), '${c['name']}'),
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
            ),
            if (when.isNotEmpty) Text(when, style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp2),
            if (topics.isEmpty)
              Text(s.syNoTopic, style: TextStyle(color: muted))
            else
              for (final t in topics) _topic(s, c, t, key, muted),
          ],
        ),
      ),
    );
  }

  Widget _topic(S s, Json c, Json t, SyllabusKey key, Color muted) {
    final id = '${t['id']}';
    final status = t['status'] as String?;
    final tone = switch (status) {
      'done' => Tone.success,
      'partial' => Tone.warning,
      'not_done' => Tone.danger,
      _ => Tone.neutral,
    };
    final busy = _busy != null;
    final small = FilledButton.styleFrom(minimumSize: const Size(48, 44));
    return Container(
      key: Key('syTopic-$id'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: Tokens.sp2),
      padding: const EdgeInsets.all(Tokens.sp2),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${c['number']}.${t['number']} ${t['name']}',
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                s.syPeriods(_n(t['plannedPeriods'])),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              StatusChip(
                [
                  s.syStatus(status),
                  if (status != null && t['doneOn'] != null) s.date('${t['doneOn']}'),
                ].join(' · '),
                tone,
              ),
            ],
          ),
          if ('${t['reason'] ?? ''}'.isNotEmpty)
            Text('${t['reason']}', style: TextStyle(color: muted, fontSize: 13)),
          const SizedBox(height: Tokens.sp2),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton.icon(
                key: Key('syDay-$id'),
                onPressed: busy ? null : () => _pickDay(t),
                icon: const Icon(Icons.calendar_today_outlined),
                label: Text('${s.syTaughtOn}: ${s.date(_day(t))}'),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp2),
          TextField(
            key: Key('syRemark-$id'),
            controller: _remark(t),
            enabled: !busy,
            maxLength: 300,
            decoration: InputDecoration(
              labelText: s.syRemark,
              border: const OutlineInputBorder(),
              counterText: '',
              isDense: true,
            ),
          ),
          if (_errors[id] != null)
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp1),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  _errors[id]!,
                  key: Key('syError-$id'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          const SizedBox(height: Tokens.sp2),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              FilledButton(
                key: Key('syMark-done-$id'),
                style: small,
                onPressed: busy ? null : () => _mark(t, 'done', key),
                child: Text(s.syDone),
              ),
              OutlinedButton(
                key: Key('syMark-partial-$id'),
                onPressed: busy ? null : () => _mark(t, 'partial', key),
                child: Text(s.syPartly),
              ),
              TextButton(
                key: Key('syMark-not_done-$id'),
                onPressed: busy ? null : () => _mark(t, 'not_done', key),
                child: Text(s.syNotDone),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
