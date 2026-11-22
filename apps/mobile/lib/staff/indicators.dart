import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart' show ImagePicker, ImageSource;
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'sheet_excel.dart';

/// Picks a photo from the gallery or the camera (tests put their own in its place).
final photoPickerProvider = Provider<Future<PickedBytes?> Function(bool camera)>(
  (ref) => (camera) async {
    final x = await ImagePicker().pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 80,
    );
    if (x == null) return null;
    return (name: x.name, bytes: await x.readAsBytes());
  },
);

/// The exams of the year that take an area (`indicators`, `remarks`, `health` …), as the website lists them; null
/// when opening exam registers is not part of the person's role.
final examsTakingProvider = FutureProvider.autoDispose.family<List<Json>?, (Profile, String)>((
  ref,
  a,
) async {
  final (_, area) = a;
  try {
    final r = asJson(await ref.read(apiProvider).examsList());
    return [
      for (final e in asList(r['data']))
        if (e['areas'] == null || ((e['areas'] as List?) ?? const []).contains(area)) e,
    ];
  } on ApiException catch (e) {
    if (e.status == 403) return null;
    rethrow;
  }
});

/// A section's indicators sheet for an exam: the set, the items, each pupil's levels and notes (and the progress
/// card's words and photo counts).
final indicatorSheetProvider = FutureProvider.autoDispose.family<Json, (String, String)>((
  ref,
  a,
) async {
  final (exam, section) = a;
  return asJson(await ref.read(apiProvider).examEntryIndicators(id: exam, classSectionId: section));
});

/// A child's portfolio photos in an exam.
final portfolioProvider = FutureProvider.autoDispose.family<List<Json>, (String, String, String)>((
  ref,
  a,
) async {
  final (exam, section, student) = a;
  final r = asJson(
    await ref.read(apiProvider).hpcPortfolio(id: exam, classSectionId: section, studentId: student),
  );
  return [for (final x in asList(r['data'])) asJson(x)];
});

/// Indicators and progress card as on the staff website (docs/design/96, part 12): the exam and the section, the
/// areas with what is entered, each pupil's levels (or written notes) on the area's indicators, the sheet by Excel,
/// and for a Holistic Progress Card the child's, the parent's and the teacher's words and the portfolio photos.
/// No web page.
class IndicatorsScreen extends ConsumerStatefulWidget {
  const IndicatorsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<IndicatorsScreen> createState() => _IndicatorsScreenState();
}

class _IndicatorsScreenState extends ConsumerState<IndicatorsScreen> {
  String? _exam;
  String? _section;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final examsAsync = ref.watch(examsTakingProvider((widget.profile, 'indicators')));
    Widget page(List<Widget> children) => ListView(
      key: const Key('inScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: children,
    );
    return examsAsync.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => page([ErrorText(errorText(s, e))]),
      data: (exams) {
        if (exams == null) return page([Text(s.inDenied, key: const Key('inDenied'))]);
        if (exams.isEmpty) {
          return page([
            Text(
              s.mkNoExam,
              key: const Key('inNoExam'),
              style: TextStyle(color: muted),
            ),
          ]);
        }
        final exam = exams.where((e) => '${e['id']}' == _exam).firstOrNull ?? exams.first;
        final examId = '${exam['id']}';
        final sectionsAsync = ref.watch(entrySectionsProvider((widget.profile, examId)));
        final sections = [
          for (final x in sectionsAsync.value?.data ?? const <Json>[])
            if (x['register'] == true || x['indicators'] == true) x,
        ];
        final chosen =
            sections.where((x) => '${x['classSectionId']}' == _section).firstOrNull ??
            sections.firstOrNull;
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(examsTakingProvider((widget.profile, 'indicators')));
            ref.invalidate(entrySectionsProvider((widget.profile, examId)));
            if (chosen != null) {
              ref.invalidate(indicatorSheetProvider((examId, '${chosen['classSectionId']}')));
            }
          },
          child: page([
            Text(s.inIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('inExam'),
              label: Text(s.mkExam),
              expandedInsets: EdgeInsets.zero,
              initialSelection: examId,
              trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.mkExam),
              selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.mkExam),
              onSelected: (v) => setState(() {
                _exam = v;
                _section = null;
              }),
              dropdownMenuEntries: [
                for (final e in exams)
                  DropdownMenuEntry(value: '${e['id']}', label: '${e['name']} (${e['code']})'),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            if (sectionsAsync.isLoading && !sectionsAsync.hasValue)
              const LinearProgressIndicator()
            else if (sectionsAsync.hasError)
              ErrorText(errorText(s, sectionsAsync.error!))
            else if (chosen == null)
              Text(
                s.inNoSection,
                key: const Key('inNoSection'),
                style: TextStyle(color: muted),
              )
            else ...[
              KeyedSubtree(
                key: ValueKey('inSection-$examId'),
                child: DropdownMenu<String>(
                  key: const Key('inSection'),
                  label: Text(s.inSection),
                  expandedInsets: EdgeInsets.zero,
                  initialSelection: '${chosen['classSectionId']}',
                  trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.inSection),
                  selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.inSection),
                  onSelected: (v) => setState(() => _section = v),
                  dropdownMenuEntries: [
                    for (final x in sections)
                      DropdownMenuEntry(value: '${x['classSectionId']}', label: '${x['code']}'),
                  ],
                ),
              ),
              const SizedBox(height: Tokens.sp3),
              IndicatorSheetView(
                key: ValueKey('inSheet-$examId-${chosen['classSectionId']}'),
                examId: examId,
                sectionId: '${chosen['classSectionId']}',
              ),
            ],
          ]),
        );
      },
    );
  }
}

/// One section's sheet: the areas, the pupils' levels, the sheet by Excel and the progress card's words and photos.
class IndicatorSheetView extends ConsumerStatefulWidget {
  const IndicatorSheetView({super.key, required this.examId, required this.sectionId});
  final String examId;
  final String sectionId;

  @override
  ConsumerState<IndicatorSheetView> createState() => _IndicatorSheetViewState();
}

class _IndicatorSheetViewState extends ConsumerState<IndicatorSheetView> {
  String? _area;
  String? _student;

  /// levels by `student|indicator`; written notes and the progress card's words by the same kind of key
  final Map<String, String> _levels = {};
  final Map<String, TextEditingController> _notes = {};
  final Map<String, TextEditingController> _words = {};
  final _caption = TextEditingController();
  String _shows = '';
  ({List<int> bytes, String type, String name})? _photo;
  Object? _filledFrom;
  int _version = 0;
  bool _busy = false;
  String? _error;
  String? _wordsError;
  String? _photoError;

  (String, String) get _key => (widget.examId, widget.sectionId);

  @override
  void dispose() {
    for (final c in [..._notes.values, ..._words.values]) {
      c.dispose();
    }
    _caption.dispose();
    super.dispose();
  }

  void _fill(Json sheet) {
    if (identical(_filledFrom, sheet)) return;
    _filledFrom = sheet;
    _version++;
    for (final r in asList(sheet['rows']).map(asJson)) {
      final sid = '${r['studentId']}';
      final grades = asJson(r['grades']);
      for (final i in asList(sheet['indicators']).map(asJson)) {
        final k = '$sid|${i['id']}';
        final v = asJson(grades['${i['id']}']);
        _levels[k] = '${v['grade'] ?? ''}';
        (_notes[k] ??= TextEditingController()).text = '${v['note'] ?? ''}';
      }
      final fb = asJson(r['feedback']);
      for (final kind in const ['self', 'parent', 'teacher']) {
        (_words['$sid|$kind'] ??= TextEditingController()).text =
            '${asJson(fb[kind])['text'] ?? ''}';
      }
    }
  }

  String _say(S s, Object e) {
    if (e is ApiException) {
      final known = s.inError(e.type);
      if (known != null) return known;
    }
    return errorText(s, e);
  }

  void _toast(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _saveLevels(List<Json> rows, List<Json> cells) async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .examEntryPutIndicators(
            id: widget.examId,
            body: PutIndicatorsDto(
              classSectionId: widget.sectionId,
              rows: [
                for (final r in rows)
                  for (final c in cells)
                    () {
                      final k = '${r['studentId']}|${c['id']}';
                      final text = c['kind'] == 'text';
                      final grade = _levels[k] ?? '';
                      final note = _notes[k]?.text.trim() ?? '';
                      return PutIndicatorsDtoRowsItem(
                        studentId: '${r['studentId']}',
                        indicatorId: '${c['id']}',
                        grade: !text && grade.isNotEmpty ? grade : null,
                        note: text && note.isNotEmpty ? note : null,
                      );
                    }(),
              ],
            ),
          );
      if (!mounted) return;
      _toast(s.inSaved);
      ref.invalidate(indicatorSheetProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _error = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveWords(Json child) async {
    final s = ref.read(stringsProvider);
    final sid = '${child['studentId']}';
    final fb = asJson(child['feedback']);
    setState(() {
      _busy = true;
      _wordsError = null;
    });
    try {
      await ref
          .read(apiProvider)
          .hpcFeedback(
            id: widget.examId,
            body: PutHpcFeedbackDto(
              classSectionId: widget.sectionId,
              rows: [
                for (final kind in const ['self', 'parent', 'teacher'])
                  // the parent's own words stay as they wrote them
                  if (!(kind == 'parent' && asJson(fb[kind])['byFamily'] == true))
                    PutHpcFeedbackDtoRowsItem(
                      studentId: sid,
                      kind: kind,
                      text: _words['$sid|$kind']?.text.trim() ?? '',
                    ),
              ],
            ),
          );
      if (!mounted) return;
      _toast(s.inSaved);
      ref.invalidate(indicatorSheetProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _wordsError = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickPhoto({required bool camera}) async {
    final s = ref.read(stringsProvider);
    final x = await ref.read(photoPickerProvider)(camera);
    if (x == null) return;
    final bytes = x.bytes;
    final png = bytes.length > 3 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e;
    final jpg = bytes.length > 2 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff;
    if (!png && !jpg) return setState(() => _photoError = s.inPhotoType);
    if (bytes.length > 1000000) return setState(() => _photoError = s.inPhotoTooBig);
    setState(() {
      _photoError = null;
      _photo = (bytes: bytes, type: png ? 'image/png' : 'image/jpeg', name: x.name);
    });
  }

  Future<void> _addPhoto(String studentId) async {
    final s = ref.read(stringsProvider);
    final p = _photo;
    if (p == null) return setState(() => _photoError = s.inChoosePhoto);
    setState(() {
      _busy = true;
      _photoError = null;
    });
    try {
      await ref
          .read(apiProvider)
          .hpcAddPhoto(
            id: widget.examId,
            body: AddPortfolioDto(
              classSectionId: widget.sectionId,
              studentId: studentId,
              caption: _caption.text.trim().isEmpty ? null : _caption.text.trim(),
              indicatorId: _shows.isEmpty ? null : _shows,
              image: AddPortfolioDtoImage(contentType: p.type, base64: base64Encode(p.bytes)),
            ),
          );
      if (!mounted) return;
      _toast(s.inAdded);
      setState(() {
        _photo = null;
        _caption.clear();
        _shows = '';
        _version++;
      });
      ref.invalidate(portfolioProvider((widget.examId, widget.sectionId, studentId)));
      ref.invalidate(indicatorSheetProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _photoError = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removePhoto(String studentId, String itemId) async {
    final s = ref.read(stringsProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.inRemovePhotoAsk),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(
            key: const Key('inPhotoRemoveYes'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(s.remove),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(apiProvider).hpcRemovePhoto(id: widget.examId, itemId: itemId);
      if (!mounted) return;
      _toast(s.removedDone);
      ref.invalidate(portfolioProvider((widget.examId, widget.sectionId, studentId)));
      ref.invalidate(indicatorSheetProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _photoError = _say(s, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final sheetAsync = ref.watch(indicatorSheetProvider(_key));
    if (!sheetAsync.hasValue) {
      return sheetAsync.hasError
          ? ErrorText(_say(s, sheetAsync.error!))
          : const LinearProgressIndicator();
    }
    final sheet = sheetAsync.value!;
    final set = sheet['set'] == null ? null : asJson(sheet['set']);
    if (set == null) {
      return Text(
        s.inNoSet,
        key: const Key('inNoSet'),
        style: TextStyle(color: muted),
      );
    }
    _fill(sheet);
    final items = asList(sheet['indicators']).map(asJson).toList();
    final rows = asList(sheet['rows']).map(asJson).toList();
    final section = asJson(sheet['section']);
    // a teacher given areas sees only theirs (the class teacher every one; docs/design/71)
    final mapped = sheet['reach'] == 'mapped';
    bool shown(Json i) => !mapped || i['mine'] == true;
    String areaOf(Json i) => '${i['area'] ?? 'Other'}';
    final areas = <String>{
      for (final a in items.where((i) => i['heading'] != true && shown(i)).map(areaOf)) a,
    }.toList();
    if (areas.isEmpty) {
      return Text(
        s.inNoneGiven,
        key: const Key('inNoneGiven'),
        style: TextStyle(color: muted),
      );
    }
    final area = areas.contains(_area) ? _area! : areas.first;
    // a goal with its indicators under it, or an indicator alone
    final groups = [
      for (final i in items.where((i) => i['parentId'] == null && areaOf(i) == area))
        (
          item: i,
          kids: items.where((k) => '${k['parentId']}' == '${i['id']}' && shown(k)).toList(),
        ),
    ].where((g) => g.kids.isNotEmpty || (g.item['heading'] != true && shown(g.item))).toList();
    final cells = [
      for (final g in groups) ...(g.kids.isNotEmpty ? g.kids : [g.item]),
    ];
    final others = {
      for (final i in items.where((i) => areaOf(i) == area))
        for (final n in (i['enteredBy'] as List?) ?? const []) '$n',
    }.toList();
    final open = sheet['locked'] != true;
    final grades = [for (final g in (set['grades'] as List?) ?? const []) '$g'];
    final words = asJson(set['levelWords']);
    String level(String g) => words[g] == null ? g : '$g (${words[g]})';
    final hpc = set['kind'] == 'hpc' && !mapped;
    final child =
        rows.where((r) => '${r['studentId']}' == _student).firstOrNull ?? rows.firstOrNull;
    final head = Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwSemibold);
    String areaName(String a) => a == 'Other' ? s.inOther : a;

    int doneIn(String a) {
      final its = items.where((i) => i['heading'] != true && shown(i) && areaOf(i) == a);
      var n = 0;
      for (final r in rows) {
        final g = asJson(r['grades']);
        for (final i in its) {
          final v = asJson(g['${i['id']}']);
          if ('${v['grade'] ?? ''}'.isNotEmpty || '${v['note'] ?? ''}'.isNotEmpty) n++;
        }
      }
      return n;
    }

    int totalIn(String a) =>
        items.where((i) => i['heading'] != true && shown(i) && areaOf(i) == a).length * rows.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${section['code']} · ${set['name']}',
          key: const Key('inSet'),
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: Tokens.sp2),
        // first, so it is there without going past every pupil (a progress card has many indicators)
        SheetByExcel(
          title: '${section['code']} · ${set['name']}',
          help: s.xlIndicatorsHelp,
          canUpload: open,
          download: () => ref
              .read(apiProvider)
              .examEntryIndicatorsExcel(id: widget.examId, classSectionId: widget.sectionId),
          upload: (file, apply) => ref
              .read(apiProvider)
              .examEntryIndicatorsUpload(
                id: widget.examId,
                body: SectionSheetUploadDto(
                  classSectionId: widget.sectionId,
                  file: file,
                  apply: apply,
                ),
              ),
          onSaved: () => ref.invalidate(indicatorSheetProvider(_key)),
        ),
        const SizedBox(height: Tokens.sp3),
        if (areas.length > 1) ...[
          Semantics(
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final a in areas)
                  ChoiceChip(
                    key: Key('inArea-$a'),
                    label: Text('${areaName(a)} (${doneIn(a)}/${totalIn(a)})'),
                    selected: a == area,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _area = a),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp3),
        ],
        Card(
          key: const Key('inRatings'),
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
                      child: Text('${section['code']} · ${areaName(area)}', style: head),
                    ),
                    open
                        ? StatusChip(s.mkPupils(rows.length), Tone.neutral)
                        : StatusChip(s.mkLocked, Tone.warning),
                  ],
                ),
                if (mapped)
                  Text(s.inMappedNote, style: TextStyle(color: muted, fontSize: 13))
                else if (others.isNotEmpty)
                  Text(s.inAlsoBy(others.join(', ')), style: TextStyle(color: muted, fontSize: 13)),
                const SizedBox(height: Tokens.sp3),
                for (final r in rows) _pupil(s, r, groups, grades, level, open, muted),
                if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
                if (open)
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: const Key('inSave'),
                      onPressed: _busy ? null : () => _saveLevels(rows, cells),
                      child: Text(_busy ? s.loading : s.inSave),
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (hpc && child != null) ...[
          const SizedBox(height: Tokens.sp3),
          _progressCard(s, rows, child, items, open, muted, head),
        ],
      ],
    );
  }

  /// A pupil's levels on the area: a goal's name over its indicators; a level from the list, or written words.
  Widget _pupil(
    S s,
    Json r,
    List<({Json item, List<Json> kids})> groups,
    List<String> grades,
    String Function(String) level,
    bool open,
    Color muted,
  ) {
    final sid = '${r['studentId']}';
    Widget cell(Json c) {
      final k = '$sid|${c['id']}';
      if (c['kind'] == 'text') {
        return Padding(
          padding: const EdgeInsets.only(top: Tokens.sp2),
          child: TextField(
            key: Key('inNote-$k'),
            controller: _notes[k],
            enabled: open,
            maxLength: 600,
            minLines: 1,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: '${c['name']}',
              border: const OutlineInputBorder(),
              isDense: true,
              counterText: '',
            ),
          ),
        );
      }
      final own = c['levels'] is List ? [for (final g in c['levels'] as List) '$g'] : grades;
      final v = _levels[k] ?? '';
      return Padding(
        padding: const EdgeInsets.only(top: Tokens.sp2),
        child: DropdownButtonFormField<String>(
          key: Key('inLevel-$k-$_version'),
          initialValue: v,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: '${c['name']}',
            border: const OutlineInputBorder(),
            isDense: true,
          ),
          items: [
            const DropdownMenuItem(value: '', child: Text('-')),
            for (final g in [...own, if (v.isNotEmpty && !own.contains(v)) v])
              DropdownMenuItem(
                value: g,
                child: Text(level(g), overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: open ? (x) => setState(() => _levels[k] = x ?? '') : null,
        ),
      );
    }

    return Container(
      key: Key('inPupil-$sid'),
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
          for (final g in groups)
            if (g.kids.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp2),
                child: Text('${g.item['name']}', style: TextStyle(color: muted, fontSize: 13)),
              ),
              for (final k in g.kids) cell(k),
            ] else
              cell(g.item),
        ],
      ),
    );
  }

  /// The Holistic Progress Card's words (the child's, the parent's, the teacher's) and the portfolio photos.
  Widget _progressCard(
    S s,
    List<Json> rows,
    Json child,
    List<Json> items,
    bool open,
    Color muted,
    TextStyle? head,
  ) {
    final sid = '${child['studentId']}';
    final fb = asJson(child['feedback']);
    final photos = ref.watch(portfolioProvider((widget.examId, widget.sectionId, sid)));
    final levelItems = items.where((i) => i['heading'] != true && i['kind'] == 'level').toList();
    return Card(
      key: const Key('inProgressCard'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(header: true, child: Text(s.inWordsTitle('${child['name']}'), style: head)),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('inPupilPick'),
              label: Text(s.inPupil),
              expandedInsets: EdgeInsets.zero,
              initialSelection: sid,
              enableFilter: true,
              requestFocusOnTap: true,
              menuHeight: 360,
              trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.inPupil),
              selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.inPupil),
              onSelected: (v) => setState(() {
                _student = v;
                _wordsError = null;
                _photoError = null;
                _photo = null;
              }),
              dropdownMenuEntries: [
                for (final r in rows)
                  DropdownMenuEntry(
                    value: '${r['studentId']}',
                    label:
                        '${r['rollNo'] == null ? '' : '${r['rollNo']} · '}${r['name']} · '
                        '${s.inPhotosN((r['photos'] as num?)?.toInt() ?? 0)}',
                  ),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            for (final kind in const ['self', 'parent', 'teacher'])
              () {
                final theirs = kind == 'parent' && asJson(fb[kind])['byFamily'] == true;
                return Padding(
                  padding: const EdgeInsets.only(bottom: Tokens.sp3),
                  child: TextField(
                    key: Key('inWords-$kind-$sid'),
                    controller: _words['$sid|$kind'],
                    enabled: open && !theirs,
                    maxLength: 2000,
                    minLines: 2,
                    maxLines: 6,
                    decoration: InputDecoration(
                      labelText: s.inWordKind(kind),
                      helperText: theirs ? s.inByParent : null,
                      border: const OutlineInputBorder(),
                      alignLabelWithHint: true,
                      counterText: '',
                    ),
                  ),
                );
              }(),
            if (_wordsError != null) ...[
              ErrorText(_wordsError!),
              const SizedBox(height: Tokens.sp2),
            ],
            if (open)
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  key: const Key('inSaveWords'),
                  onPressed: _busy ? null : () => _saveWords(child),
                  child: Text(s.inSaveWords),
                ),
              ),
            const SizedBox(height: Tokens.sp4),
            Semantics(
              header: true,
              child: Text(s.inPortfolio, style: Theme.of(context).textTheme.titleSmall),
            ),
            const SizedBox(height: Tokens.sp1),
            ...photos.when(
              loading: () => [const LinearProgressIndicator()],
              error: (e, _) => [ErrorText(_say(s, e))],
              data: (list) => list.isEmpty
                  ? [
                      Text(
                        s.inNoPhoto,
                        key: const Key('inNoPhoto'),
                        style: TextStyle(color: muted),
                      ),
                    ]
                  : [
                      for (final p in list)
                        ListTile(
                          key: Key('inPhoto-${p['id']}'),
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.photo_outlined),
                          title: Text('${p['caption'] ?? s.inPhoto}'),
                          subtitle: p['indicator'] == null ? null : Text('${p['indicator']}'),
                          trailing: Wrap(
                            children: [
                              IconButton(
                                key: Key('inPhotoView-${p['id']}'),
                                tooltip: '${s.view} ${p['caption'] ?? s.inPhoto}',
                                icon: const Icon(Icons.visibility_outlined),
                                onPressed: () => Navigator.of(context).push(
                                  MaterialPageRoute<void>(
                                    builder: (_) => FileScreen(
                                      title: '${p['caption'] ?? s.inPhoto}',
                                      load: () => ref
                                          .read(apiProvider)
                                          .hpcPhoto(id: widget.examId, itemId: '${p['id']}'),
                                    ),
                                  ),
                                ),
                              ),
                              if (open)
                                IconButton(
                                  key: Key('inPhotoRemove-${p['id']}'),
                                  tooltip: '${s.remove} ${p['caption'] ?? s.inPhoto}',
                                  icon: const Icon(Icons.delete_outline),
                                  onPressed: () => _removePhoto(sid, '${p['id']}'),
                                ),
                            ],
                          ),
                        ),
                    ],
            ),
            if (open) ...[
              const SizedBox(height: Tokens.sp2),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  OutlinedButton.icon(
                    key: const Key('inPickPhoto'),
                    onPressed: _busy ? null : () => _pickPhoto(camera: false),
                    icon: const Icon(Icons.photo_library_outlined),
                    label: Text(s.inChoosePhoto),
                  ),
                  IconButton(
                    tooltip: s.takePhoto,
                    onPressed: _busy ? null : () => _pickPhoto(camera: true),
                    icon: const Icon(Icons.photo_camera_outlined),
                  ),
                  if (_photo != null)
                    InputChip(
                      key: const Key('inPhotoChosen'),
                      label: Text(_photo!.name, overflow: TextOverflow.ellipsis),
                      deleteButtonTooltipMessage: s.removeFile(_photo!.name),
                      onDeleted: () => setState(() => _photo = null),
                    ),
                ],
              ),
              const SizedBox(height: Tokens.sp2),
              TextField(
                key: const Key('inCaption'),
                controller: _caption,
                maxLength: 120,
                decoration: InputDecoration(
                  labelText: s.inCaption,
                  border: const OutlineInputBorder(),
                  isDense: true,
                  counterText: '',
                ),
              ),
              const SizedBox(height: Tokens.sp2),
              DropdownButtonFormField<String>(
                key: Key('inShows-$_version'),
                initialValue: _shows,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: s.inShows,
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
                items: [
                  const DropdownMenuItem(value: '', child: Text('-')),
                  for (final i in levelItems)
                    DropdownMenuItem(
                      value: '${i['id']}',
                      child: Text('${i['name']}', overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (v) => setState(() => _shows = v ?? ''),
              ),
              if (_photoError != null) ...[
                const SizedBox(height: Tokens.sp2),
                ErrorText(_photoError!),
              ],
              const SizedBox(height: Tokens.sp2),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const Key('inAddPhoto'),
                  onPressed: _busy ? null : () => _addPhoto(sid),
                  icon: const Icon(Icons.add_photo_alternate_outlined),
                  label: Text(s.inAddPhoto),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
