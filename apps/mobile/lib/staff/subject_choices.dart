import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The sections whose choices the person sets (the class teacher) or sees (teaches there), as the website lists them.
final choiceSectionsProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  try {
    final r = asJson(await ref.read(apiProvider).subjectChoicesSections());
    return [
      for (final x in asList(r['data']))
        if (x['canEdit'] == true || x['mine'] == true) x,
    ];
  } on ApiException catch (e) {
    if (e.status == 403) return const [];
    rethrow;
  }
});

/// A section's subjects, groups, streams and each student's choices.
final choicesProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, section) async =>
      asJson(await ref.read(apiProvider).subjectChoicesList(classSectionId: section)),
);

/// Subject choices as on the staff website (docs/design/96, part 15): the section, then each student's stream, the
/// subject of each choice group, the other subjects and their own additional subject ("Opt"); the compulsory ones come
/// with them and a subject with marks this year stays. Save the choices; Bring last year's choices for those without.
/// No web page.
class SubjectChoicesScreen extends ConsumerStatefulWidget {
  const SubjectChoicesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<SubjectChoicesScreen> createState() => _SubjectChoicesScreenState();
}

class _SubjectChoicesScreenState extends ConsumerState<SubjectChoicesScreen> {
  String? _section;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final sectionsAsync = ref.watch(choiceSectionsProvider(widget.profile));
    Widget page(List<Widget> children) => ListView(
      key: const Key('scScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: children,
    );
    return sectionsAsync.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => page([ErrorText(errorText(s, e))]),
      data: (sections) {
        if (sections.isEmpty) {
          return page([
            Text(s.scIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            Text(s.scNoSection, key: const Key('scNoSection')),
          ]);
        }
        final chosen =
            sections.where((x) => '${x['id']}' == _section).firstOrNull ?? sections.first;
        final id = '${chosen['id']}';
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(choiceSectionsProvider(widget.profile));
            ref.invalidate(choicesProvider(id));
          },
          child: page([
            Text(s.scIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('scSection'),
              label: Text(s.inSection),
              expandedInsets: EdgeInsets.zero,
              initialSelection: id,
              trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.inSection),
              selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.inSection),
              onSelected: (v) => setState(() => _section = v),
              dropdownMenuEntries: [
                for (final x in sections)
                  DropdownMenuEntry(value: '${x['id']}', label: '${x['code']} (${x['students']})'),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            ChoicesView(key: ValueKey('scView-$id'), sectionId: id),
          ]),
        );
      },
    );
  }
}

/// One student's choices being made: the stream, the subjects ticked or picked, the additional one.
class _Pick {
  _Pick({required this.stream, required this.subjects, required this.opt});
  String stream;
  final Set<String> subjects;
  String opt;
}

/// One section's choices.
class ChoicesView extends ConsumerStatefulWidget {
  const ChoicesView({super.key, required this.sectionId});
  final String sectionId;

  @override
  ConsumerState<ChoicesView> createState() => _ChoicesViewState();
}

class _ChoicesViewState extends ConsumerState<ChoicesView> {
  final Map<String, _Pick> _picks = {};
  Object? _filledFrom;
  int _version = 0;
  bool _busy = false;
  String? _error;

  void _fill(Json data) {
    if (identical(_filledFrom, data)) return;
    _filledFrom = data;
    _version++;
    _picks.clear();
    for (final r in asList(data['rows'])) {
      final subs = asList(r['subjects']);
      _picks['${r['studentId']}'] = _Pick(
        stream: '${r['stream'] ?? ''}',
        subjects: {for (final x in subs) '${x['subjectId']}'},
        opt: '${subs.where((x) => x['additional'] == true).firstOrNull?['subjectId'] ?? ''}',
      );
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  /// As the website's save: the groups' and other subjects chosen, with the marked ones kept; a new stream takes the
  /// old stream's subjects off (the server adds the compulsory ones and the stream's).
  Future<void> _save(Json data) async {
    final s = ref.read(stringsProvider);
    final groups = asList(data['groups']);
    final free = [
      for (final x in asList(data['subjects']))
        if (x['take'] == 'free') '${x['id']}',
    ];
    final inChoice = {
      for (final g in groups) ...[for (final id in (g['subjectIds'] as List?) ?? const []) '$id'],
      ...free,
    };
    final streamSubjects = {
      for (final st in asList(data['streams']))
        '${st['name']}': [for (final id in (st['subjectIds'] as List?) ?? const []) '$id'],
    };
    final rows = <PutSubjectChoicesDtoRowsItem>[];
    for (final r in asList(data['rows'])) {
      final sid = '${r['studentId']}';
      final p = _picks[sid]!;
      final had = {for (final x in asList(r['subjects'])) '${x['subjectId']}'};
      final marked = [
        for (final id in (r['marked'] as List?) ?? const [])
          if (had.contains('$id')) '$id',
      ];
      final before = '${r['stream'] ?? ''}';
      var ids = [
        for (final id in p.subjects)
          if (inChoice.contains(id)) id,
      ];
      if (ids.isNotEmpty || p.stream.isNotEmpty || had.isNotEmpty) ids.addAll(marked);
      if (before.isNotEmpty && before != p.stream) {
        final old = streamSubjects[before] ?? const <String>[];
        final keep = streamSubjects[p.stream] ?? const <String>[];
        ids = [
          for (final id in ids)
            if (!old.contains(id) || keep.contains(id) || marked.contains(id)) id,
        ];
      }
      rows.add(
        PutSubjectChoicesDtoRowsItem(
          studentId: sid,
          stream: p.stream.isEmpty ? null : p.stream,
          subjects: [
            for (final id in ids.toSet())
              PutSubjectChoicesDtoRowsItemSubjectsItem(subjectId: id, additional: id == p.opt),
          ],
        ),
      );
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .subjectChoicesPut(
            body: PutSubjectChoicesDto(classSectionId: widget.sectionId, rows: rows),
          );
      if (!mounted) return;
      _toast(s.inSaved);
      ref.invalidate(choicesProvider(widget.sectionId));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _lastYear() async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .subjectChoicesLastYear(body: SubjectChoicesQueryDto(classSectionId: widget.sectionId)),
      );
      if (!mounted) return;
      _toast(s.scCopied((r['copied'] as num?)?.toInt() ?? 0));
      ref.invalidate(choicesProvider(widget.sectionId));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final async = ref.watch(choicesProvider(widget.sectionId));
    if (!async.hasValue) {
      return async.hasError
          ? ErrorText(errorText(s, async.error!))
          : const LinearProgressIndicator();
    }
    final data = async.value!;
    _fill(data);
    final subjects = asList(data['subjects']);
    final groups = asList(data['groups']);
    final streams = asList(data['streams']);
    final rows = asList(data['rows']);
    final compulsory = subjects.where((x) => x['take'] == 'all').toList();
    final free = subjects.where((x) => x['take'] == 'free').toList();
    final showStream = streams.isNotEmpty || rows.any((r) => '${r['stream'] ?? ''}'.isNotEmpty);
    final open = data['canEdit'] == true;
    final showOpt = subjects.any((x) => x['take'] != 'all');
    final section = asJson(data['section']);
    final nothing = !showStream && groups.isEmpty && free.isEmpty;
    return Card(
      key: const Key('scSheet'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text(
                '${section['code']}',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
            ),
            if (!open)
              Text(
                s.scViewOnly,
                key: const Key('scViewOnly'),
                style: TextStyle(color: muted),
              ),
            if (compulsory.isNotEmpty)
              Text(
                s.scEveryone(compulsory.map((x) => '${x['code']}').join(' · ')),
                key: const Key('scEveryone'),
                style: TextStyle(color: muted, fontSize: 13),
              ),
            const SizedBox(height: Tokens.sp3),
            if (nothing)
              Text(s.scNothing, key: const Key('scNothing'))
            else ...[
              for (final r in rows)
                _student(s, r, subjects, groups, streams, free, showStream, showOpt, open, muted),
              if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
              if (open)
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const Key('scSave'),
                    onPressed: _busy ? null : () => _save(data),
                    child: Text(_busy ? s.loading : s.scSave),
                  ),
                ),
            ],
            if (open && data['fromExams'] != true) ...[
              const SizedBox(height: Tokens.sp4),
              Text(s.scLastYearHelp, style: TextStyle(color: muted, fontSize: 13)),
              const SizedBox(height: Tokens.sp1),
              OutlinedButton.icon(
                key: const Key('scLastYear'),
                onPressed: _busy ? null : _lastYear,
                icon: const Icon(Icons.history),
                label: Text(s.scLastYear),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _student(
    S s,
    Json r,
    List<Json> subjects,
    List<Json> groups,
    List<Json> streams,
    List<Json> free,
    bool showStream,
    bool showOpt,
    bool open,
    Color muted,
  ) {
    final sid = '${r['studentId']}';
    final p = _picks[sid]!;
    final had = {for (final x in asList(r['subjects'])) '${x['subjectId']}'};
    final marked = {for (final id in (r['marked'] as List?) ?? const []) '$id'};
    bool locked(String id) => had.contains(id) && marked.contains(id);
    Json? subject(String id) => subjects.where((x) => '${x['id']}' == id).firstOrNull;
    String nameOf(String id) {
      final x = subject(id);
      return x == null ? id : '${x['name']} (${x['code']})';
    }

    String codeOf(String id) => '${subject(id)?['code'] ?? id}';
    InputDecoration box(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true);
    // the student's own additional subject: one taken, not compulsory nor of an additional group
    final optable = [
      for (final x in subjects)
        if (p.subjects.contains('${x['id']}') &&
            x['take'] != 'all' &&
            !(x['take'] == 'group' &&
                groups.where((g) => '${g['id']}' == '${x['groupId']}').firstOrNull?['kind'] ==
                    'additional'))
          x,
    ];
    Widget tick(String id, String label) => FilterChip(
      key: Key('scTick-$sid-$id'),
      label: Text(label),
      tooltip: locked(id) ? '${nameOf(id)}: ${s.scMarkedNote}' : nameOf(id),
      selected: p.subjects.contains(id),
      onSelected: !open || locked(id)
          ? null
          : (on) => setState(() => on ? p.subjects.add(id) : p.subjects.remove(id)),
    );
    return Container(
      key: Key('scStudent-$sid'),
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
            '${r['rollNo'] == null ? '' : '${r['rollNo']}. '}${r['name']}',
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
          Text(
            '${r['admissionNo'] ?? ''}${asList(r['subjects']).isEmpty ? ' · ${s.scNotSet}' : ''}',
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (showStream) ...[
            const SizedBox(height: Tokens.sp2),
            if (streams.isNotEmpty)
              DropdownButtonFormField<String>(
                key: Key('scStream-$sid-$_version'),
                initialValue: p.stream,
                isExpanded: true,
                decoration: box(s.scStream),
                items: [
                  const DropdownMenuItem(value: '', child: Text('-')),
                  for (final st in [
                    ...streams.map((x) => '${x['name']}'),
                    if (p.stream.isNotEmpty && !streams.any((x) => x['name'] == p.stream)) p.stream,
                  ])
                    DropdownMenuItem(value: st, child: Text(st)),
                ],
                onChanged: open ? (v) => setState(() => p.stream = v ?? '') : null,
              )
            else
              Text('${s.scStream}: ${p.stream.isEmpty ? '—' : p.stream}'),
          ],
          for (final g in groups) ...[
            const SizedBox(height: Tokens.sp2),
            () {
              final ids = [for (final id in (g['subjectIds'] as List?) ?? const []) '$id'];
              if ((g['max'] as num?)?.toInt() == 1) {
                final v = ids.where(p.subjects.contains).firstOrNull ?? '';
                return DropdownButtonFormField<String>(
                  key: Key('scGroup-$sid-${g['id']}-$_version'),
                  initialValue: v,
                  isExpanded: true,
                  decoration: box('${g['name']}'),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('-')),
                    for (final id in ids)
                      DropdownMenuItem(
                        value: id,
                        child: Text(nameOf(id), overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: !open || ids.any(locked)
                      ? null
                      : (x) => setState(() {
                          p.subjects.removeAll(ids);
                          if ((x ?? '').isNotEmpty) p.subjects.add(x!);
                        }),
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${g['name']}', style: TextStyle(color: muted, fontSize: 13)),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    children: [for (final id in ids) tick(id, codeOf(id))],
                  ),
                ],
              );
            }(),
          ],
          if (free.isNotEmpty) ...[
            const SizedBox(height: Tokens.sp2),
            Text(s.scOther, style: TextStyle(color: muted, fontSize: 13)),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              children: [for (final x in free) tick('${x['id']}', '${x['code']}')],
            ),
          ],
          if (showOpt) ...[
            const SizedBox(height: Tokens.sp2),
            DropdownButtonFormField<String>(
              key: Key('scOpt-$sid-$_version-${optable.length}'),
              initialValue: optable.any((x) => '${x['id']}' == p.opt) ? p.opt : '',
              isExpanded: true,
              decoration: box(s.scOpt),
              items: [
                const DropdownMenuItem(value: '', child: Text('-')),
                for (final x in optable)
                  DropdownMenuItem(
                    value: '${x['id']}',
                    child: Text('${x['name']} (${x['code']})', overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: !open || optable.isEmpty ? null : (v) => setState(() => p.opt = v ?? ''),
            ),
          ],
        ],
      ),
    );
  }
}
