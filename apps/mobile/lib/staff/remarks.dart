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
import 'indicators.dart' show examsTakingProvider;
import 'sheet_excel.dart';

/// A section's remarks for an exam: the categories (the person may write, or who does), each pupil's remark.
final remarkSheetProvider = FutureProvider.autoDispose.family<Json, (String, String)>((
  ref,
  a,
) async {
  final (exam, section) = a;
  return asJson(await ref.read(apiProvider).examRemarksItems(id: exam, classSectionId: section));
});

/// Remarks as on the staff website (docs/design/96, part 13): the exam and the section, the sheet by Excel, then each
/// pupil with a remark a category the person writes — free words (the school's remarks to pick from) or one of the
/// category's listed remarks — and who writes the others. No web page.
class RemarksScreen extends ConsumerStatefulWidget {
  const RemarksScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<RemarksScreen> createState() => _RemarksScreenState();
}

class _RemarksScreenState extends ConsumerState<RemarksScreen> {
  String? _exam;
  String? _section;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final examsAsync = ref.watch(examsTakingProvider((widget.profile, 'remarks')));
    Widget page(List<Widget> children) => ListView(
      key: const Key('rmScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: children,
    );
    return examsAsync.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => page([ErrorText(errorText(s, e))]),
      data: (exams) {
        if (exams == null) return page([Text(s.inDenied, key: const Key('rmDenied'))]);
        if (exams.isEmpty) {
          return page([
            Text(
              s.mkNoExam,
              key: const Key('rmNoExam'),
              style: TextStyle(color: muted),
            ),
          ]);
        }
        final exam = exams.where((e) => '${e['id']}' == _exam).firstOrNull ?? exams.first;
        final examId = '${exam['id']}';
        final sectionsAsync = ref.watch(entrySectionsProvider((widget.profile, examId)));
        final sections = [
          for (final x in sectionsAsync.value?.data ?? const <Json>[])
            if (x['remarks'] != false) x,
        ];
        final chosen =
            sections.where((x) => '${x['classSectionId']}' == _section).firstOrNull ??
            sections.firstOrNull;
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(examsTakingProvider((widget.profile, 'remarks')));
            ref.invalidate(entrySectionsProvider((widget.profile, examId)));
            if (chosen != null) {
              ref.invalidate(remarkSheetProvider((examId, '${chosen['classSectionId']}')));
            }
          },
          child: page([
            Text(s.rmIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('rmExam'),
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
                s.rmNoCategory,
                key: const Key('rmNoSection'),
                style: TextStyle(color: muted),
              )
            else ...[
              KeyedSubtree(
                key: ValueKey('rmSection-$examId'),
                child: DropdownMenu<String>(
                  key: const Key('rmSection'),
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
              RemarkSheetView(
                key: ValueKey('rmSheet-$examId-${chosen['classSectionId']}'),
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

/// One section's remarks: the sheet by Excel, the pupils' remarks, Save.
class RemarkSheetView extends ConsumerStatefulWidget {
  const RemarkSheetView({super.key, required this.examId, required this.sectionId});
  final String examId;
  final String sectionId;

  @override
  ConsumerState<RemarkSheetView> createState() => _RemarkSheetViewState();
}

class _RemarkSheetViewState extends ConsumerState<RemarkSheetView> {
  /// free words by `student|category`; a listed remark by the same key
  final Map<String, TextEditingController> _texts = {};
  final Map<String, String> _picked = {};
  Object? _filledFrom;
  int _version = 0;
  bool _busy = false;
  String? _error;

  (String, String) get _key => (widget.examId, widget.sectionId);

  @override
  void dispose() {
    for (final c in _texts.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _fill(Json sheet) {
    if (identical(_filledFrom, sheet)) return;
    _filledFrom = sheet;
    _version++;
    for (final r in asList(sheet['rows'])) {
      final items = asJson(r['items']);
      for (final k in asList(sheet['categories'])) {
        final key = '${r['studentId']}|${k['id']}';
        final text = '${asJson(items['${k['id']}'])['text'] ?? ''}';
        (_texts[key] ??= TextEditingController()).text = text;
        _picked[key] = text;
      }
    }
  }

  String _say(S s, Object e) {
    if (e is ApiException) {
      final known = s.rmError(e.type);
      if (known != null) return e.detail.isNotEmpty ? '$known — ${e.detail}' : known;
    }
    return errorText(s, e);
  }

  Future<void> _save(List<Json> rows, List<Json> cats) async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .examRemarksPutItems(
            id: widget.examId,
            body: PutRemarkItemsDto(
              classSectionId: widget.sectionId,
              rows: [
                for (final r in rows)
                  for (final k in cats)
                    PutRemarkItemsDtoRowsItem(
                      studentId: '${r['studentId']}',
                      categoryId: '${k['id']}',
                      // an empty box clears the remark, as on the website
                      text: k['freeText'] == true
                          ? (_texts['${r['studentId']}|${k['id']}']?.text.trim() ?? '')
                          : (_picked['${r['studentId']}|${k['id']}'] ?? ''),
                    ),
              ],
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(s.inSaved)));
      ref.invalidate(remarkSheetProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _error = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The school's remarks of a free-words category, to put in the box (and change).
  Future<void> _choose(TextEditingController box, Json k) async {
    final s = ref.read(stringsProvider);
    final bank = asList(k['bank']);
    final text = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(c).size.height * 0.7),
          child: ListView(
            shrinkWrap: true,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4),
                child: Semantics(
                  header: true,
                  child: Text('${k['name']}', style: Theme.of(c).textTheme.titleMedium),
                ),
              ),
              for (final b in bank)
                ListTile(
                  key: Key('rmBank-${b['code']}'),
                  title: Text('${b['text']}'),
                  onTap: () => Navigator.pop(c, '${b['text']}'),
                ),
              if (bank.isEmpty)
                Padding(padding: const EdgeInsets.all(Tokens.sp4), child: Text(s.rmChoose)),
            ],
          ),
        ),
      ),
    );
    if (text != null) setState(() => box.text = text);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final sheetAsync = ref.watch(remarkSheetProvider(_key));
    if (!sheetAsync.hasValue) {
      return sheetAsync.hasError
          ? ErrorText(_say(s, sheetAsync.error!))
          : const LinearProgressIndicator();
    }
    final sheet = sheetAsync.value!;
    _fill(sheet);
    final all = asList(sheet['categories']);
    final cats = all.where((k) => k['may'] == true).toList();
    final rows = asList(sheet['rows']);
    final section = asJson(sheet['section']);
    if (cats.isEmpty) {
      return Text(
        '${sheet['reason'] ?? s.rmNoCategory}',
        key: const Key('rmNoCategory'),
        style: TextStyle(color: muted),
      );
    }
    final open = sheet['locked'] != true;
    final others = all.where((k) => k['may'] != true).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // folded, closed, as on Height and weight: one line that opens Download and Upload (asked, 22 Nov 2026)
        SheetByExcel(
          folded: true,
          title: '${section['code']} · ${s.menu('Remarks')}',
          help: s.xlRemarksHelp,
          canUpload: open,
          download: () => ref
              .read(apiProvider)
              .examRemarksItemsExcel(id: widget.examId, classSectionId: widget.sectionId),
          upload: (file, apply) => ref
              .read(apiProvider)
              .examRemarksItemsUpload(
                id: widget.examId,
                body: SectionSheetUploadDto(
                  classSectionId: widget.sectionId,
                  file: file,
                  apply: apply,
                ),
              ),
          onSaved: () => ref.invalidate(remarkSheetProvider(_key)),
        ),
        const SizedBox(height: Tokens.sp3),
        Card(
          key: const Key('rmSheet'),
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
                        '${section['code']}',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: Tokens.fwSemibold),
                      ),
                    ),
                    open
                        ? StatusChip(s.mkPupils(rows.length), Tone.neutral)
                        : StatusChip(s.mkLocked, Tone.warning),
                  ],
                ),
                if (others.isNotEmpty)
                  Text(
                    s.rmByOthers(
                      others
                          .map(
                            (k) =>
                                '${k['name']} (${((k['writtenBy'] as List?) ?? const []).join(', ')})',
                          )
                          .join(' · '),
                    ),
                    key: const Key('rmOthers'),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                const SizedBox(height: Tokens.sp3),
                for (final r in rows) _pupil(s, r, cats, open, muted),
                if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
                if (open)
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: const Key('rmSave'),
                      onPressed: _busy ? null : () => _save(rows, cats),
                      child: Text(_busy ? s.loading : s.inSave),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _pupil(S s, Json r, List<Json> cats, bool open, Color muted) {
    final sid = '${r['studentId']}';
    return Container(
      key: Key('rmPupil-$sid'),
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
          for (final k in cats)
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp2),
              child: () {
                final key = '$sid|${k['id']}';
                final label =
                    '${k['name']}${k['subjectName'] == null ? '' : ' · ${k['subjectName']}'}';
                if (k['freeText'] == true) {
                  final box = _texts[key]!;
                  return TextField(
                    key: Key('rmText-$key'),
                    controller: box,
                    enabled: open,
                    maxLength: 600,
                    minLines: 1,
                    maxLines: 4,
                    decoration: InputDecoration(
                      labelText: label,
                      border: const OutlineInputBorder(),
                      isDense: true,
                      counterText: '',
                      suffixIcon: open && asList(k['bank']).isNotEmpty
                          ? IconButton(
                              key: Key('rmPick-$key'),
                              tooltip: '${s.rmChoose}: $label',
                              icon: const Icon(Icons.list_alt_outlined),
                              onPressed: () => _choose(box, k),
                            )
                          : null,
                    ),
                  );
                }
                final bank = [for (final b in asList(k['bank'])) '${b['text']}'];
                final v = _picked[key] ?? '';
                return DropdownButtonFormField<String>(
                  key: Key('rmList-$key-$_version'),
                  initialValue: v,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: label,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('-')),
                    for (final t in [...bank, if (v.isNotEmpty && !bank.contains(v)) v])
                      DropdownMenuItem(
                        value: t,
                        child: Text(t, maxLines: 2, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: open ? (x) => setState(() => _picked[key] = x ?? '') : null,
                );
              }(),
            ),
        ],
      ),
    );
  }
}
