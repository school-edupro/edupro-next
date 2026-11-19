import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// Marks entry: the exams with sheets waiting, then their sections and subjects this person may enter.
class MarksHome extends ConsumerWidget {
  const MarksHome({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<List<Json>>(
      value: ref.watch(toEnterProvider(profile)),
      refresh: () => ref.refresh(toEnterProvider(profile).future),
      children: (rows) {
        // one line an exam (the marks area), with what is left to enter
        final exams = <String, Json>{};
        for (final r in rows.where((r) => (r['area'] ?? 'marks') == 'marks')) {
          exams.putIfAbsent('${r['examId']}', () => r);
        }
        return [
          if (exams.isEmpty) EmptyLine(s.nothingToEnter),
          for (final e in exams.values)
            Card(
              child: ListTile(
                key: Key('exam-${e['examId']}'),
                leading: const Icon(Icons.edit_note),
                title: Text('${e['exam']}'),
                subtitle: Text(
                  rows
                      .where((r) => r['examId'] == e['examId'] && (r['area'] ?? 'marks') == 'marks')
                      .map((r) => '${r['section']}: ${r['done']}/${r['total']}')
                      .join(' · '),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => pushPage(
                  context,
                  '${e['exam']}',
                  ExamSheets(profile: profile, examId: '${e['examId']}'),
                ),
              ),
            ),
        ];
      },
    );
  }
}

/// An exam's sections and subjects for this person.
class ExamSheets extends ConsumerWidget {
  const ExamSheets({super.key, required this.profile, required this.examId});
  final Profile profile;
  final String examId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final arg = (profile, examId);
    return LoadedList<List<Json>>(
      value: ref.watch(entrySectionsProvider(arg)),
      refresh: () => ref.refresh(entrySectionsProvider(arg).future),
      children: (sections) => [
        if (sections.isEmpty) EmptyLine(s.nothingToEnter),
        for (final sec in sections) ...[
          SectionTitle('${sec['code']}'),
          for (final sub in asList(sec['subjects']))
            Card(
              child: ListTile(
                key: Key('sheet-${sec['classSectionId']}-${sub['subjectId']}'),
                title: Text('${sub['name']}'),
                subtitle: Text(
                  [
                    s.maxMarks('${sub['maxMarks']}'),
                    if (sub['entered'] != null) '${sub['entered']}',
                    if (sub['entryLocked'] == true) s.sheetClosed,
                  ].join(' · '),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => pushPage(
                  context,
                  '${sec['code']} · ${sub['name']}',
                  MarksSheet(
                    profile: profile,
                    examId: examId,
                    sectionId: '${sec['classSectionId']}',
                    subjectId: '${sub['subjectId']}',
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

/// One subject's marks for a section: a box a pupil (or Absent), saved together; then sent for checking.
class MarksSheet extends ConsumerStatefulWidget {
  const MarksSheet({
    super.key,
    required this.profile,
    required this.examId,
    required this.sectionId,
    required this.subjectId,
  });
  final Profile profile;
  final String examId;
  final String sectionId;
  final String subjectId;

  @override
  ConsumerState<MarksSheet> createState() => _MarksSheetState();
}

class _MarksSheetState extends ConsumerState<MarksSheet> {
  final Map<String, TextEditingController> _boxes = {};
  final Map<String, bool> _absent = {};
  bool _filled = false;
  bool _busy = false;
  String? _error;

  (Profile, String, String, String) get _arg =>
      (widget.profile, widget.examId, widget.sectionId, widget.subjectId);

  @override
  void dispose() {
    for (final c in _boxes.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _fill(Json sheet) {
    if (_filled) return;
    _filled = true;
    for (final r in asList(sheet['rows'])) {
      final id = '${r['studentId']}';
      _boxes[id] = TextEditingController(text: r['marks'] == null ? '' : '${r['marks']}');
      _absent[id] = r['absent'] == true;
    }
  }

  Future<void> _save(Json sheet, {bool submit = false}) async {
    final s = ref.read(stringsProvider);
    final max = num.tryParse('${asJson(sheet['examSubject'])['maxMarks']}');
    final rows = <PutMarksDtoRowsItem>[];
    for (final r in asList(sheet['rows'])) {
      if (r['taken'] == false) continue;
      final id = '${r['studentId']}';
      final absent = _absent[id] == true;
      final text = _boxes[id]?.text.trim() ?? '';
      if (!absent && text.isEmpty) continue;
      final marks = absent ? null : num.tryParse(text);
      if (!absent && marks == null) continue;
      if (marks != null && max != null && marks > max) {
        setState(() => _error = s.marksOver('$max'));
        return;
      }
      rows.add(PutMarksDtoRowsItem(studentId: id, marks: marks, absent: absent));
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      if (rows.isNotEmpty) {
        await api.examEntryPutMarks(
          id: widget.examId,
          body: PutMarksDto(
            classSectionId: widget.sectionId,
            subjectId: widget.subjectId,
            rows: rows,
          ),
        );
      }
      if (submit) {
        await api.examStatusSubmit(
          id: widget.examId,
          body: EntryStatusActionDto(classSectionId: widget.sectionId, subjectId: widget.subjectId),
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(submit ? s.submitted : s.saved)));
      ref.invalidate(toEnterProvider(widget.profile));
      ref.invalidate(entrySectionsProvider((widget.profile, widget.examId)));
      if (submit) {
        _filled = false;
        ref.invalidate(marksSheetProvider(_arg));
      }
    } catch (e) {
      setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return LoadedList<Json>(
      value: ref.watch(marksSheetProvider(_arg)),
      refresh: () {
        _filled = false;
        return ref.refresh(marksSheetProvider(_arg).future);
      },
      children: (sheet) {
        _fill(sheet);
        final sub = asJson(sheet['examSubject']);
        final exam = asJson(sheet['exam']);
        final status = '${asJson(sheet['status'])['status'] ?? 'open'}';
        final parts = asList(sub['parts']);
        final closed =
            exam['marksLocked'] == true || sub['entryLocked'] == true || status != 'open';
        if (parts.isNotEmpty) {
          return [
            Notice(text: s.enterOnWeb),
            const SizedBox(height: Tokens.sp3),
            FilledButton(
              onPressed: () => context.push(
                Uri(
                  path: '/web',
                  queryParameters: {
                    'app': 'teacher',
                    'to': '/marks?exam=${widget.examId}',
                    'title': s.marksEntry,
                  },
                ).toString(),
              ),
              child: Text(s.openPage),
            ),
          ];
        }
        return [
          Text(s.maxMarks('${sub['maxMarks']}'), style: Theme.of(context).textTheme.titleMedium),
          if (closed) ...[const SizedBox(height: Tokens.sp2), Notice(text: s.sheetClosed)],
          const SizedBox(height: Tokens.sp2),
          for (final r in asList(sheet['rows']).where((r) => r['taken'] != false))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
              child: Row(
                children: [
                  SizedBox(width: 32, child: Text('${r['rollNo'] ?? ''}')),
                  Expanded(child: Text('${r['name']}')),
                  SizedBox(
                    width: 84,
                    child: TextField(
                      key: Key('marks-${r['studentId']}'),
                      controller: _boxes['${r['studentId']}'],
                      enabled: !closed && _absent['${r['studentId']}'] != true,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      textAlign: TextAlign.end,
                      decoration: InputDecoration(
                        isDense: true,
                        border: const OutlineInputBorder(),
                        labelText: '${r['name']}',
                        floatingLabelBehavior: FloatingLabelBehavior.never,
                        hintText: '—',
                      ),
                    ),
                  ),
                  const SizedBox(width: Tokens.sp1),
                  Tooltip(
                    message: s.absentShort,
                    child: Checkbox(
                      key: Key('absent-${r['studentId']}'),
                      value: _absent['${r['studentId']}'] == true,
                      onChanged: closed
                          ? null
                          : (v) => setState(() => _absent['${r['studentId']}'] = v == true),
                      semanticLabel: '${s.absentShort}: ${r['name']}',
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: Tokens.sp3),
          if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
          if (!closed) ...[
            FilledButton(
              key: const Key('saveMarksSheet'),
              onPressed: _busy ? null : () => _save(sheet),
              child: Text(s.save),
            ),
            const SizedBox(height: Tokens.sp2),
            OutlinedButton(
              key: const Key('submitMarks'),
              onPressed: _busy ? null : () => _save(sheet, submit: true),
              child: Text(s.submitForCheck),
            ),
          ],
        ];
      },
    );
  }
}
