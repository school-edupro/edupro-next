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

const _blood = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/// A section's height and weight for an exam: each pupil's reading in it and the last one before.
final healthSheetProvider = FutureProvider.autoDispose.family<Json, (String, String)>((
  ref,
  a,
) async {
  final (exam, section) = a;
  return asJson(await ref.read(apiProvider).examEntryHealth(id: exam, classSectionId: section));
});

String _num(Object? v) {
  final n = num.tryParse('${v ?? ''}');
  if (n == null) return '${v ?? ''}';
  return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
}

/// A row of the save with only what changed: a value emptied goes as null (the API clears it), one left alone is
/// not sent (the generated row leaves nulls out, so this one writes its own).
class _HealthRow extends PutHealthDtoRowsItem {
  _HealthRow(this.json) : super(studentId: '${json['studentId']}');
  final Map<String, Object?> json;

  @override
  Map<String, Object?> toJson() => json;
}

/// Height and weight as on the staff website (docs/design/96, part 14): the exam (those taking it) and the section
/// (the class teacher's), how many are entered, the sheet by Excel, then each pupil — the last reading, height,
/// weight, BMI (worked out on saving) and blood group; Save sends what changed. No web page.
class StaffHealthScreen extends ConsumerStatefulWidget {
  const StaffHealthScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffHealthScreen> createState() => _StaffHealthScreenState();
}

class _StaffHealthScreenState extends ConsumerState<StaffHealthScreen> {
  String? _exam;
  String? _section;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final examsAsync = ref.watch(examsTakingProvider((widget.profile, 'health')));
    Widget page(List<Widget> children) => ListView(
      key: const Key('hwScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: children,
    );
    return examsAsync.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => page([ErrorText(errorText(s, e))]),
      data: (exams) {
        if (exams == null) return page([Text(s.inDenied, key: const Key('hwDenied'))]);
        if (exams.isEmpty) {
          return page([
            Text(
              s.hwNoExam,
              key: const Key('hwNoExam'),
              style: TextStyle(color: muted),
            ),
          ]);
        }
        final exam = exams.where((e) => '${e['id']}' == _exam).firstOrNull ?? exams.first;
        final examId = '${exam['id']}';
        final sectionsAsync = ref.watch(entrySectionsProvider((widget.profile, examId)));
        final sections = [
          for (final x in sectionsAsync.value?.data ?? const <Json>[])
            if (x['register'] == true) x,
        ];
        final chosen =
            sections.where((x) => '${x['classSectionId']}' == _section).firstOrNull ??
            sections.firstOrNull;
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(examsTakingProvider((widget.profile, 'health')));
            ref.invalidate(entrySectionsProvider((widget.profile, examId)));
            if (chosen != null) {
              ref.invalidate(healthSheetProvider((examId, '${chosen['classSectionId']}')));
            }
          },
          child: page([
            Text(s.hwIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('hwExam'),
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
                s.hwNoSection,
                key: const Key('hwNoSection'),
                style: TextStyle(color: muted),
              )
            else ...[
              KeyedSubtree(
                key: ValueKey('hwSection-$examId'),
                child: DropdownMenu<String>(
                  key: const Key('hwSection'),
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
              HealthSheetView(
                key: ValueKey('hwSheet-$examId-${chosen['classSectionId']}'),
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

/// One section's height and weight: the sheet by Excel, each pupil's readings, Save.
class HealthSheetView extends ConsumerStatefulWidget {
  const HealthSheetView({super.key, required this.examId, required this.sectionId});
  final String examId;
  final String sectionId;

  @override
  ConsumerState<HealthSheetView> createState() => _HealthSheetViewState();
}

class _HealthSheetViewState extends ConsumerState<HealthSheetView> {
  final Map<String, TextEditingController> _height = {};
  final Map<String, TextEditingController> _weight = {};
  final Map<String, String> _bloodOf = {};
  Object? _filledFrom;
  int _version = 0;
  bool _busy = false;
  String? _error;

  (String, String) get _key => (widget.examId, widget.sectionId);

  @override
  void dispose() {
    for (final c in [..._height.values, ..._weight.values]) {
      c.dispose();
    }
    super.dispose();
  }

  static String _bloodShown(Json r) =>
      '${asJson(r['current'])['bloodGroup'] ?? asJson(r['last'])['bloodGroup'] ?? ''}';

  void _fill(Json sheet) {
    if (identical(_filledFrom, sheet)) return;
    _filledFrom = sheet;
    _version++;
    for (final r in asList(sheet['rows'])) {
      final id = '${r['studentId']}';
      final now = asJson(r['current']);
      (_height[id] ??= TextEditingController()).text = _num(now['heightCm']);
      (_weight[id] ??= TextEditingController()).text = _num(now['weightKg']);
      _bloodOf[id] = _bloodShown(r);
    }
  }

  String _say(S s, Object e) {
    if (e is ApiException) {
      final known = s.hwError(e.type);
      if (known != null) return known;
    }
    return errorText(s, e);
  }

  void _toast(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _save(List<Json> rows) async {
    final s = ref.read(stringsProvider);
    final out = <PutHealthDtoRowsItem>[];
    for (final r in rows) {
      final id = '${r['studentId']}';
      final now = asJson(r['current']);
      final row = <String, Object?>{'studentId': id};
      for (final (field, box, lo, hi) in [
        ('heightCm', _height[id]!, 40, 250),
        ('weightKg', _weight[id]!, 3, 200),
      ]) {
        final text = box.text.trim();
        final was = num.tryParse('${now[field] ?? ''}');
        final value = text.isEmpty ? null : num.tryParse(text);
        if (text.isNotEmpty && value == null) {
          return setState(() => _error = s.hwNotNumber('${r['name']}'));
        }
        if (value != null && (value < lo || value > hi)) {
          return setState(() => _error = '${r['name']}: ${s.hwRange}');
        }
        if (value != was) row[field] = value;
      }
      final blood = _bloodOf[id] ?? '';
      if (blood != _bloodShown(r)) row['bloodGroup'] = blood.isEmpty ? null : blood;
      if (row.length > 1) out.add(_HealthRow(row));
    }
    if (out.isEmpty) {
      setState(() => _error = null);
      return _toast(s.hwNothing);
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .examEntryPutHealth(
              id: widget.examId,
              body: PutHealthDto(classSectionId: widget.sectionId, rows: out),
            ),
      );
      if (!mounted) return;
      _toast(s.hwSaved((r['recorded'] as num?)?.toInt() ?? out.length));
      ref.invalidate(healthSheetProvider(_key));
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
    final sheetAsync = ref.watch(healthSheetProvider(_key));
    if (!sheetAsync.hasValue) {
      return sheetAsync.hasError
          ? ErrorText(_say(s, sheetAsync.error!))
          : const LinearProgressIndicator();
    }
    final sheet = sheetAsync.value!;
    if (sheet['takes'] != true) {
      return Text(
        s.hwNotTaken,
        key: const Key('hwNotTaken'),
        style: TextStyle(color: muted),
      );
    }
    _fill(sheet);
    final rows = asList(sheet['rows']);
    final section = asJson(sheet['section']);
    final locked = sheet['locked'] == true;
    final open = !locked && sheet['canEnter'] == true;
    final done = rows
        .where(
          (r) =>
              asJson(r['current'])['heightCm'] != null || asJson(r['current'])['weightKg'] != null,
        )
        .length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${section['code']} · ${s.mkEnteredOf(done, rows.length)}',
          key: const Key('hwSummary'),
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: Tokens.sp2),
        // first, so it is there without going past every pupil
        SheetByExcel(
          title: '${section['code']} · ${s.menu('Height and weight')}',
          help: s.xlHealthHelp,
          canUpload: open,
          download: () => ref
              .read(apiProvider)
              .examEntryHealthExcel(id: widget.examId, classSectionId: widget.sectionId),
          upload: (file, apply) => ref
              .read(apiProvider)
              .examEntryHealthUpload(
                id: widget.examId,
                body: SectionSheetUploadDto(
                  classSectionId: widget.sectionId,
                  file: file,
                  apply: apply,
                ),
              ),
          onSaved: () => ref.invalidate(healthSheetProvider(_key)),
        ),
        const SizedBox(height: Tokens.sp3),
        Card(
          key: const Key('hwSheet'),
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
                    locked
                        ? StatusChip(s.mkLocked, Tone.warning)
                        : StatusChip(s.mkPupils(rows.length), Tone.neutral),
                  ],
                ),
                const SizedBox(height: Tokens.sp3),
                for (final r in rows) _pupil(s, r, open, muted),
                if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
                if (open)
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: const Key('hwSave'),
                      onPressed: _busy ? null : () => _save(rows),
                      child: Text(_busy ? s.loading : s.hwSave),
                    ),
                  )
                else
                  Text(
                    locked ? s.hwLockedNote : s.hwOnlyClassTeacher,
                    key: const Key('hwClosed'),
                    style: TextStyle(color: muted),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _pupil(S s, Json r, bool open, Color muted) {
    final id = '${r['studentId']}';
    final now = asJson(r['current']);
    final last = r['last'] == null ? null : asJson(r['last']);
    final blood = _bloodOf[id] ?? '';
    String reading(Json x) =>
        '${_num(x['heightCm']).isEmpty ? '-' : _num(x['heightCm'])} cm · '
        '${_num(x['weightKg']).isEmpty ? '-' : _num(x['weightKg'])} kg'
        '${x['bmi'] == null ? '' : ' · BMI ${x['bmi']}'}'
        ' (${x['examName'] ?? s.hwHealthCheck}, ${s.date('${x['recordedOn']}')})';
    InputDecoration box(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true);
    return Container(
      key: Key('hwPupil-$id'),
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
          Text(
            '${s.hwLast}: ${last == null ? '—' : reading(last)}',
            key: Key('hwLast-$id'),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          const SizedBox(height: Tokens.sp2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  key: Key('hwHeight-$id'),
                  controller: _height[id],
                  enabled: open,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: box(s.hwHeight),
                ),
              ),
              const SizedBox(width: Tokens.sp2),
              Expanded(
                child: TextField(
                  key: Key('hwWeight-$id'),
                  controller: _weight[id],
                  enabled: open,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: box(s.hwWeight),
                ),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  key: Key('hwBlood-$id-$_version'),
                  initialValue: blood,
                  isExpanded: true,
                  decoration: box(s.hwBlood),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('-')),
                    for (final b in [
                      ..._blood,
                      if (blood.isNotEmpty && !_blood.contains(blood)) blood,
                    ])
                      DropdownMenuItem(value: b, child: Text(b)),
                  ],
                  onChanged: open ? (v) => setState(() => _bloodOf[id] = v ?? '') : null,
                ),
              ),
              const SizedBox(width: Tokens.sp2),
              Expanded(
                child: Text(
                  'BMI ${now['bmi'] ?? '—'}',
                  key: Key('hwBmi-$id'),
                  style: TextStyle(color: muted),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
