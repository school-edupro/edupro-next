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

/// The exams of the year that take marks (as the website lists them); null when entering marks is not part of the
/// person's role.
final markExamsProvider = FutureProvider.autoDispose.family<Loaded<List<Json>?>, Profile>((
  ref,
  p,
) async {
  final r = await cached('markexams:${p.id}', () async {
    try {
      return await ref.read(apiProvider).examsList();
    } on ApiException catch (e) {
      if (e.status == 403) return {'denied': true};
      rethrow;
    }
  });
  final j = asJson(r.data);
  if (j['denied'] == true) return Loaded(null, r.at, stale: r.stale);
  final exams = [
    for (final e in asList(j['data']).map(asJson))
      if (e['areas'] == null || ((e['areas'] as List?) ?? const []).contains('marks')) e,
  ];
  return Loaded(exams, r.at, stale: r.stale);
});

/// A sheet the person may open: a section's subject, or one part of it (Theory, Practical …) they enter.
typedef MarksPick = ({
  String value,
  String label,
  String sectionId,
  String subjectId,
  String? partId,
});

String _num(Object? v) {
  final n = num.tryParse('${v ?? ''}');
  if (n == null) return '${v ?? ''}';
  return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
}

/// The website's options: a subject entered in parts is offered part by part (the parts this teacher enters).
List<MarksPick> marksPicks(S s, List<Json> sections) => [
  for (final sec in sections)
    for (final sub in asList(sec['subjects']).map(asJson))
      if (asList(sub['parts']).isNotEmpty)
        for (final p in asList(sub['parts']).map(asJson).where((p) => p['mine'] == true))
          (
            value: '${sec['classSectionId']}|${sub['subjectId']}|${p['id']}',
            label:
                '${sec['code']} · ${sub['name']} · ${p['name']} (${_num(p['maxMarks'])})'
                '${sub['entryLocked'] == true ? ' (${s.mkLockedWord})' : ''}',
            sectionId: '${sec['classSectionId']}',
            subjectId: '${sub['subjectId']}',
            partId: '${p['id']}',
          )
      else
        (
          value: '${sec['classSectionId']}|${sub['subjectId']}',
          label:
              '${sec['code']} · ${sub['name']}'
              '${sub['entryLocked'] == true ? ' (${s.mkLockedWord})' : ''}'
              ' · ${s.mkEnteredN((sub['entered'] as num?)?.toInt() ?? 0)}',
          sectionId: '${sec['classSectionId']}',
          subjectId: '${sub['subjectId']}',
          partId: null,
        ),
];

/// Marks as on the staff website (docs/design/96, part 10): the exam and the section · subject (a part when the
/// subject is entered in parts), how codes work, then the sheet — each pupil's marks (or grade) and code, those who
/// do not take the subject, Save marks; Open / Submitted / Verified, and Submit for verification once every pupil
/// has marks or a code. No web page.
class MarksHome extends ConsumerStatefulWidget {
  const MarksHome({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<MarksHome> createState() => _MarksHomeState();
}

class _MarksHomeState extends ConsumerState<MarksHome> {
  String? _exam;
  String? _pick;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final examsAsync = ref.watch(markExamsProvider(widget.profile));
    return examsAsync.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [ErrorText(errorText(s, e))],
      ),
      data: (loaded) {
        final exams = loaded.data;
        if (exams == null) {
          return ListView(
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [Text(s.mkNotAllowed, key: const Key('mkDenied'))],
          );
        }
        if (exams.isEmpty) {
          return ListView(
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [
              Text(
                s.mkNoExam,
                key: const Key('mkNoExam'),
                style: TextStyle(color: muted),
              ),
            ],
          );
        }
        final exam = exams.where((e) => '${e['id']}' == _exam).firstOrNull ?? exams.first;
        final examId = '${exam['id']}';
        final sections = ref.watch(entrySectionsProvider((widget.profile, examId)));
        final picks = marksPicks(s, sections.value?.data ?? const []);
        final chosen = picks.where((p) => p.value == _pick).firstOrNull ?? picks.firstOrNull;
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(markExamsProvider(widget.profile));
            ref.invalidate(entrySectionsProvider((widget.profile, examId)));
            if (chosen != null) {
              ref.invalidate(
                marksSheetProvider((widget.profile, examId, chosen.sectionId, chosen.subjectId)),
              );
            }
          },
          child: ListView(
            key: const Key('marksScreen'),
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [
              DropdownMenu<String>(
                key: const Key('mkExam'),
                label: Text(s.mkExam),
                expandedInsets: EdgeInsets.zero,
                initialSelection: examId,
                trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.mkExam),
                selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.mkExam),
                onSelected: (v) => setState(() {
                  _exam = v;
                  _pick = null;
                }),
                dropdownMenuEntries: [
                  for (final e in exams)
                    DropdownMenuEntry(value: '${e['id']}', label: '${e['name']} (${e['code']})'),
                ],
              ),
              const SizedBox(height: Tokens.sp3),
              if (sections.isLoading && !sections.hasValue)
                const LinearProgressIndicator()
              else if (sections.hasError)
                ErrorText(errorText(s, sections.error!))
              else if (picks.isEmpty)
                Text(
                  s.mkNoSheet,
                  key: const Key('mkNoSheet'),
                  style: TextStyle(color: muted),
                )
              else
                KeyedSubtree(
                  // a new list for a new exam
                  key: ValueKey('mkPick-$examId'),
                  child: DropdownMenu<String>(
                    key: const Key('mkPick'),
                    label: Text(s.mkPick),
                    expandedInsets: EdgeInsets.zero,
                    initialSelection: chosen!.value,
                    enableFilter: true,
                    requestFocusOnTap: true,
                    menuHeight: 360,
                    trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.mkPick),
                    selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.mkPick),
                    onSelected: (v) => setState(() => _pick = v),
                    dropdownMenuEntries: [
                      for (final p in picks) DropdownMenuEntry(value: p.value, label: p.label),
                    ],
                  ),
                ),
              const SizedBox(height: Tokens.sp2),
              Text(s.mkHelp, style: TextStyle(color: muted, fontSize: 13)),
              const SizedBox(height: Tokens.sp3),
              if (chosen != null)
                MarksSheetView(
                  key: ValueKey('sheet-$examId-${chosen.value}'),
                  profile: widget.profile,
                  examId: examId,
                  pick: chosen,
                ),
            ],
          ),
        );
      },
    );
  }
}

/// One sheet: a section's subject (or a part of it), as the website's table laid out for a phone.
class MarksSheetView extends ConsumerStatefulWidget {
  const MarksSheetView({
    super.key,
    required this.profile,
    required this.examId,
    required this.pick,
  });
  final Profile profile;
  final String examId;
  final MarksPick pick;

  @override
  ConsumerState<MarksSheetView> createState() => _MarksSheetViewState();
}

class _MarksSheetViewState extends ConsumerState<MarksSheetView> {
  final Map<String, TextEditingController> _boxes = {};
  final Map<String, String> _codes = {};
  final Map<String, String> _grades = {};

  /// a new number rebuilds the code and grade boxes with the values just read
  int _version = 0;
  Object? _filledFrom;
  bool _busy = false;
  String? _error;

  (Profile, String, String, String) get _arg =>
      (widget.profile, widget.examId, widget.pick.sectionId, widget.pick.subjectId);

  @override
  void dispose() {
    for (final c in _boxes.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// The boxes as saved (again after each save, when the sheet is read anew).
  void _fill(Json sheet) {
    if (identical(_filledFrom, sheet)) return;
    _filledFrom = sheet;
    _version++;
    final part = widget.pick.partId;
    for (final r in asList(sheet['rows']).map(asJson)) {
      final id = '${r['studentId']}';
      final p = part == null ? null : asJson(asJson(r['parts'])[part]);
      final marks = part == null ? r['marks'] : p?['marks'];
      (_boxes[id] ??= TextEditingController()).text = marks == null ? '' : _num(marks);
      _codes[id] = part != null
          ? (p?['absent'] == true ? 'AB' : '')
          : '${r['code'] ?? (r['absent'] == true ? 'AB' : (r['exempt'] == true ? 'EX' : ''))}';
      _grades[id] = '${r['grade'] ?? ''}';
    }
  }

  String _say(S s, Object e) {
    if (e is ApiException) {
      final known = s.mkError(e.type);
      if (known != null) return known;
    }
    return errorText(s, e);
  }

  static bool _takes(Json r) => !(r.containsKey('taken') && r['taken'] == null);

  Future<void> _save(Json sheet) async {
    final s = ref.read(stringsProvider);
    final sub = asJson(sheet['examSubject']);
    final part = widget.pick.partId == null
        ? null
        : asList(sub['parts'])
              .map(asJson)
              .where((p) => '${p['id']}' == widget.pick.partId)
              .firstOrNull;
    final max = num.tryParse('${part?['maxMarks'] ?? sub['maxMarks']}');
    final gradeOnly = sub['gradeOnly'] == true && part == null;
    final rows = <PutMarksDtoRowsItem>[];
    final partRows = <PutPartMarksDtoRowsItem>[];
    for (final r in asList(sheet['rows']).map(asJson).where(_takes)) {
      final id = '${r['studentId']}';
      final text = _boxes[id]?.text.trim() ?? '';
      final code = _codes[id] ?? '';
      final grade = _grades[id] ?? '';
      final marks = text.isEmpty ? null : num.tryParse(text);
      if (!gradeOnly && code.isEmpty && text.isNotEmpty && marks == null) {
        return setState(() => _error = s.mkNotNumber('${r['name']}'));
      }
      if (!gradeOnly &&
          code.isEmpty &&
          marks != null &&
          max != null &&
          (marks > max || marks < 0)) {
        return setState(() => _error = s.marksOver(_num(max)));
      }
      if (part != null) {
        // an empty box with no AB clears the pupil's marks in this part, as on the website
        final absent = code == 'AB';
        partRows.add(
          PutPartMarksDtoRowsItem(studentId: id, marks: absent ? null : marks, absent: absent),
        );
        continue;
      }
      // a pupil with nothing written is left as they are
      if (code.isEmpty && (gradeOnly ? grade.isEmpty : marks == null)) continue;
      rows.add(
        PutMarksDtoRowsItem(
          studentId: id,
          marks: code.isEmpty && !gradeOnly ? marks : null,
          code: code.isEmpty ? null : code,
          grade: code.isEmpty && gradeOnly ? grade : null,
        ),
      );
    }
    if (rows.isEmpty && partRows.isEmpty) return setState(() => _error = s.mkNothing);
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      String done;
      if (part != null) {
        await api.examEntryPutPartMarks(
          id: widget.examId,
          body: PutPartMarksDto(
            classSectionId: widget.pick.sectionId,
            partId: widget.pick.partId!,
            rows: partRows,
          ),
        );
        done = s.mkSavedPlain;
      } else {
        final out = asJson(
          await api.examEntryPutMarks(
            id: widget.examId,
            body: PutMarksDto(
              classSectionId: widget.pick.sectionId,
              subjectId: widget.pick.subjectId,
              rows: rows,
            ),
          ),
        );
        done = s.mkSaved(
          (out['inserted'] as num?)?.toInt() ?? 0,
          (out['updated'] as num?)?.toInt() ?? 0,
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(done)));
      _reload();
    } catch (e) {
      if (mounted) setState(() => _error = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _reload() {
    ref.invalidate(marksSheetProvider(_arg));
    ref.invalidate(entrySectionsProvider((widget.profile, widget.examId)));
    ref.invalidate(toEnterProvider(widget.profile));
  }

  Future<void> _submit() async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .examStatusSubmit(
            id: widget.examId,
            body: EntryStatusActionDto(
              classSectionId: widget.pick.sectionId,
              subjectId: widget.pick.subjectId,
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(s.mkSubmitted)));
      _reload();
    } catch (e) {
      if (mounted) setState(() => _error = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final sheetAsync = ref.watch(marksSheetProvider(_arg));
    if (!sheetAsync.hasValue) {
      return sheetAsync.hasError
          ? ErrorText(_say(s, sheetAsync.error!))
          : const LinearProgressIndicator();
    }
    final sheet = sheetAsync.value!.data;
    _fill(sheet);
    final exam = asJson(sheet['exam']);
    final sub = asJson(sheet['examSubject']);
    final section = asJson(sheet['section']);
    final status = asJson(sheet['status']);
    final stage = '${status['status'] ?? 'open'}';
    final locked = exam['marksLocked'] == true || sub['entryLocked'] == true || stage != 'open';
    final parts = asList(sub['parts']).map(asJson).toList();
    final part = widget.pick.partId == null
        ? null
        : parts.where((p) => '${p['id']}' == widget.pick.partId).firstOrNull;
    final others = part == null
        ? const <Json>[]
        : parts.where((p) => '${p['id']}' != widget.pick.partId).toList();
    final rows = asList(sheet['rows']).map(asJson).toList();
    final takers = rows.where(_takes).toList();
    final entered = takers
        .where(
          (r) =>
              r['marks'] != null ||
              '${r['code'] ?? ''}'.isNotEmpty ||
              '${r['grade'] ?? ''}'.isNotEmpty,
        )
        .length;
    final gradeOnly = sub['gradeOnly'] == true && part == null;
    final allCodes = asList(sheet['codes']).map(asJson).toList();
    final codes = [
      for (final c
          in allCodes.isEmpty
              ? [
                  <String, Object?>{'code': 'AB', 'name': s.absentShort},
                ]
              : allCodes)
        if (part == null || c['code'] == 'AB') c,
    ];
    final grades = [for (final g in (sheet['grades'] as List?) ?? const []) '$g'];
    final head = Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwSemibold);
    return Card(
      key: const Key('mkSheet'),
      margin: EdgeInsets.zero,
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
                Semantics(
                  header: true,
                  child: Text(
                    '${section['code'] ?? ''} · ${sub['name'] ?? ''}'
                    '${part != null ? ' · ${part['name']}' : ''}',
                    style: head,
                  ),
                ),
                locked
                    ? StatusChip(s.mkLocked, Tone.warning)
                    : StatusChip(s.mkPupils(rows.length), Tone.neutral),
              ],
            ),
            Text(
              [
                gradeOnly
                    ? s.mkGraded
                    : s.mkOutOf(
                        _num(sub['maxMarks']),
                        sub['passMarks'] == null ? null : _num(sub['passMarks']),
                      ),
                s.mkEnteredOf(entered, takers.length),
              ].join(' · '),
              key: const Key('mkSummary'),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            if (part != null)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(
                  s.mkInParts(
                    '${sub['name']}',
                    parts.map((p) => '${p['name']} ${_num(p['maxMarks'])}').join(' + '),
                    _num(sub['maxMarks']),
                  ),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ),
            const SizedBox(height: Tokens.sp3),
            for (final r in rows)
              _row(s, r, part, others, codes, grades, gradeOnly, locked, sub, muted),
            const SizedBox(height: Tokens.sp2),
            if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
            if (!locked)
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const Key('saveMarksSheet'),
                  onPressed: _busy ? null : () => _save(sheet),
                  child: Text(_busy ? s.loading : s.mkSave),
                ),
              )
            else
              Text(
                s.mkLockedNote,
                key: const Key('mkLockedNote'),
                style: TextStyle(color: muted),
              ),
            const SizedBox(height: Tokens.sp3),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusChip(
                  s.mkStage(stage),
                  stage == 'verified'
                      ? Tone.success
                      : stage == 'submitted'
                      ? Tone.warning
                      : Tone.neutral,
                ),
                if ('${status['remark'] ?? ''}'.isNotEmpty)
                  Text('${status['remark']}', style: TextStyle(color: muted, fontSize: 13)),
              ],
            ),
            const SizedBox(height: Tokens.sp2),
            if (stage == 'open' &&
                exam['marksLocked'] != true &&
                sub['entryLocked'] != true &&
                takers.isNotEmpty &&
                entered == takers.length)
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  key: const Key('submitMarks'),
                  onPressed: _busy ? null : _submit,
                  child: Text(s.mkSubmit),
                ),
              )
            else if (stage == 'open')
              Text(
                s.mkSubmitHint,
                key: const Key('mkSubmitHint'),
                style: TextStyle(color: muted, fontSize: 13),
              ),
          ],
        ),
      ),
    );
  }

  Widget _row(
    S s,
    Json r,
    Json? part,
    List<Json> others,
    List<Json> codes,
    List<String> grades,
    bool gradeOnly,
    bool locked,
    Json sub,
    Color muted,
  ) {
    final id = '${r['studentId']}';
    final code = _codes[id] ?? '';
    // a value saved that is no longer in the list stays choosable (so the box shows it)
    final codeItems = [
      for (final c in codes) ('${c['code']}', '${c['code']} · ${c['name']}'),
      if (code.isNotEmpty && !codes.any((c) => c['code'] == code)) (code, code),
    ];
    final grade = _grades[id] ?? '';
    final gradeItems = [...grades, if (grade.isNotEmpty && !grades.contains(grade)) grade];
    final max = _num(part?['maxMarks'] ?? sub['maxMarks']);
    final partsOf = asJson(r['parts']);
    String partMarks(Json p) {
      final m = partsOf['${p['id']}'];
      if (m == null) return '—';
      final mm = asJson(m);
      return mm['absent'] == true ? 'AB' : (mm['marks'] == null ? '—' : _num(mm['marks']));
    }

    return Container(
      key: Key('mkRow-$id'),
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
          if ('${r['admissionNo'] ?? ''}'.isNotEmpty)
            Text('${r['admissionNo']}', style: TextStyle(color: muted, fontSize: 13)),
          const SizedBox(height: Tokens.sp1),
          if (!_takes(r))
            Text(
              s.mkNotTaken,
              key: Key('mkNotTaken-$id'),
              style: TextStyle(color: muted),
            )
          else ...[
            // the boxes start again from what was read after a save
            KeyedSubtree(
              key: ValueKey('mkBoxes-$id-$_version'),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: gradeOnly
                        ? DropdownButtonFormField<String>(
                            key: Key('grade-$id'),
                            initialValue: grade,
                            isExpanded: true,
                            decoration: InputDecoration(
                              labelText: s.mkGrade,
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                            items: [
                              const DropdownMenuItem(value: '', child: Text('-')),
                              for (final g in gradeItems)
                                DropdownMenuItem(value: g, child: Text(g)),
                            ],
                            onChanged: locked ? null : (v) => setState(() => _grades[id] = v ?? ''),
                          )
                        : TextField(
                            key: Key('marks-$id'),
                            controller: _boxes[id],
                            enabled: !locked && code.isEmpty,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: InputDecoration(
                              labelText: '${part != null ? '${part['name']}' : s.mkMarks} / $max',
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                          ),
                  ),
                  const SizedBox(width: Tokens.sp2),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      key: Key('code-$id'),
                      initialValue: code,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: s.mkCode,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem(value: '', child: Text('-')),
                        for (final (v, l) in codeItems)
                          DropdownMenuItem(
                            value: v,
                            child: Text(l, overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: locked ? null : (v) => setState(() => _codes[id] = v ?? ''),
                    ),
                  ),
                ],
              ),
            ),
            if (part != null)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(
                  [
                    '${s.mkTotal}: ${r['absent'] == true ? 'AB' : (r['marks'] == null ? '—' : _num(r['marks']))}'
                        ' / ${_num(sub['maxMarks'])}',
                    for (final o in others) '${o['name']} ${partMarks(o)}',
                  ].join(' · '),
                  key: Key('mkTotal-$id'),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
