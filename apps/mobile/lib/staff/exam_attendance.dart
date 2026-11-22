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
import 'registers.dart';
import 'sheet_excel.dart';

const _blood = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/// A section's exam register for an exam: each pupil's remark, what they took part in, the class promoted to, days
/// present of the total and (for those who see health) the last height and weight.
final examRegisterProvider = FutureProvider.autoDispose.family<Json, (String, String)>((
  ref,
  a,
) async {
  final (exam, section) = a;
  return asJson(await ref.read(apiProvider).examEntryRegister(id: exam, classSectionId: section));
});

/// A row sent as the website sends it: an empty value goes as null (the API clears it), which the generated rows
/// leave out.
class _RemarkRow extends PutRemarksDtoRowsItem {
  _RemarkRow(this.json) : super(studentId: '${json['studentId']}', remark: '${json['remark']}');
  final Map<String, Object?> json;

  @override
  Map<String, Object?> toJson() => json;
}

class _HealthRow extends PutHealthDtoRowsItem {
  _HealthRow(this.json) : super(studentId: '${json['studentId']}');
  final Map<String, Object?> json;

  @override
  Map<String, Object?> toJson() => json;
}

/// The Exam register as on the staff website (docs/design/96, parts 17 and 18): the exam and the class teacher's
/// section; with [full], each pupil's remark (the school's remarks to pick from), what they took part in, the class
/// promoted to, days present of total, height, weight and blood group, the sheet by Excel (one closed line) and a
/// Save for each part; without it, the menu's Exam attendance (the days only). Count from daily attendance under both.
/// No web page.
class ExamAttendanceScreen extends ConsumerStatefulWidget {
  const ExamAttendanceScreen({super.key, required this.profile, this.full = false});
  final Profile profile;

  /// the whole register (the menu's Exam register), not the attendance only
  final bool full;

  @override
  ConsumerState<ExamAttendanceScreen> createState() => _ExamAttendanceScreenState();
}

class _ExamAttendanceScreenState extends ConsumerState<ExamAttendanceScreen> {
  String? _exam;
  String? _section;

  String get _areas => widget.full ? 'remarks|attendance|health' : 'attendance';

  @override
  Widget build(BuildContext context) {
    if (!widget.full) return _fill(context);
    final s = ref.watch(stringsProvider);
    // the whole register: Fill the register, and the registers as the admin's (docs/design/97)
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('erTabs'),
              tabs: [
                Tab(text: s.rgFill),
                Tab(text: s.rgRegisters),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _fill(context),
                StaffRegistersTab(profile: widget.profile),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _fill(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final examsAsync = ref.watch(examsTakingProvider((widget.profile, _areas)));
    Widget page(List<Widget> children) => ListView(
      key: Key(widget.full ? 'erScreen' : 'eaScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: children,
    );
    return examsAsync.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => page([ErrorText(errorText(s, e))]),
      data: (exams) {
        if (exams == null) return page([Text(s.inDenied, key: const Key('eaDenied'))]);
        if (exams.isEmpty) {
          return page([
            Text(
              s.mkNoExam,
              key: const Key('eaNoExam'),
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
            ref.invalidate(examsTakingProvider((widget.profile, _areas)));
            ref.invalidate(entrySectionsProvider((widget.profile, examId)));
            if (chosen != null) {
              ref.invalidate(examRegisterProvider((examId, '${chosen['classSectionId']}')));
            }
          },
          child: page([
            Text(s.eaIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('eaExam'),
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
                key: const Key('eaNoSection'),
                style: TextStyle(color: muted),
              )
            else ...[
              KeyedSubtree(
                key: ValueKey('eaSection-$examId'),
                child: DropdownMenu<String>(
                  key: const Key('eaSection'),
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
              ExamAttendanceView(
                key: ValueKey('eaView-$examId-${chosen['classSectionId']}-${widget.full}'),
                examId: examId,
                sectionId: '${chosen['classSectionId']}',
                full: widget.full,
              ),
            ],
          ]),
        );
      },
    );
  }
}

/// One section's register: the sheet by Excel (the full register), each pupil's boxes, the Saves, Count from daily.
class ExamAttendanceView extends ConsumerStatefulWidget {
  const ExamAttendanceView({
    super.key,
    required this.examId,
    required this.sectionId,
    this.full = false,
  });
  final String examId;
  final String sectionId;
  final bool full;

  @override
  ConsumerState<ExamAttendanceView> createState() => _ExamAttendanceViewState();
}

class _ExamAttendanceViewState extends ConsumerState<ExamAttendanceView> {
  final Map<String, TextEditingController> _present = {};
  final Map<String, TextEditingController> _total = {};
  final Map<String, TextEditingController> _remark = {};
  final Map<String, TextEditingController> _part = {};
  final Map<String, TextEditingController> _promoted = {};
  final Map<String, TextEditingController> _height = {};
  final Map<String, TextEditingController> _weight = {};
  final Map<String, String> _bloodOf = {};
  Object? _filledFrom;
  int _version = 0;
  String _from = '';
  String _to = '';
  bool _overwrite = false;
  bool _busy = false;
  String? _error;

  (String, String) get _key => (widget.examId, widget.sectionId);

  @override
  void dispose() {
    for (final m in [_present, _total, _remark, _part, _promoted, _height, _weight]) {
      for (final c in m.values) {
        c.dispose();
      }
    }
    super.dispose();
  }

  static String _num(Object? v) {
    final n = num.tryParse('${v ?? ''}');
    if (n == null) return '${v ?? ''}';
    return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
  }

  void _fill(Json reg) {
    if (identical(_filledFrom, reg)) return;
    _filledFrom = reg;
    _version++;
    for (final r in asList(reg['rows'])) {
      final id = '${r['studentId']}';
      final h = asJson(r['health']);
      (_present[id] ??= TextEditingController()).text = '${r['daysPresent'] ?? ''}';
      (_total[id] ??= TextEditingController()).text = '${r['daysTotal'] ?? ''}';
      (_remark[id] ??= TextEditingController()).text = '${r['remark'] ?? ''}';
      (_part[id] ??= TextEditingController()).text = '${r['participation'] ?? ''}';
      (_promoted[id] ??= TextEditingController()).text = '${r['promotedTo'] ?? ''}';
      (_height[id] ??= TextEditingController()).text = _num(h['heightCm']);
      (_weight[id] ??= TextEditingController()).text = _num(h['weightKg']);
      _bloodOf[id] = '${h['bloodGroup'] ?? ''}';
    }
  }

  String _say(S s, Object e) {
    if (e is ApiException) {
      final known = s.eaError(e.type);
      if (known != null) return known;
    }
    return errorText(s, e);
  }

  void _toast(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _send(Future<dynamic> Function() call, String Function(Json r) done) async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(await call());
      if (!mounted) return;
      _toast(done(r));
      ref.invalidate(examRegisterProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _error = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// As the website: the pupils with both boxes filled.
  Future<void> _saveAttendance(List<Json> rows) async {
    final s = ref.read(stringsProvider);
    final out = <PutExamAttendanceDtoRowsItem>[];
    for (final r in rows) {
      final id = '${r['studentId']}';
      final p = _present[id]!.text.trim();
      final t = _total[id]!.text.trim();
      if (p.isEmpty || t.isEmpty) continue;
      final present = int.tryParse(p);
      final total = int.tryParse(t);
      if (present == null || total == null || present < 0 || total < 1) {
        return setState(() => _error = s.eaNotNumber('${r['name']}'));
      }
      if (present > total) return setState(() => _error = s.eaOver('${r['name']}'));
      out.add(PutExamAttendanceDtoRowsItem(studentId: id, daysPresent: present, daysTotal: total));
    }
    if (out.isEmpty) return setState(() => _error = s.eaNothing);
    await _send(
      () => ref
          .read(apiProvider)
          .examEntryPutAttendance(
            id: widget.examId,
            body: PutExamAttendanceDto(classSectionId: widget.sectionId, rows: out),
          ),
      (r) => s.eaSaved((r['changed'] as num?)?.toInt() ?? out.length),
    );
  }

  /// As the website: the pupils with a remark, with what they took part in and the class promoted to (empty: cleared).
  Future<void> _saveRemarks(List<Json> rows) async {
    final s = ref.read(stringsProvider);
    final out = <PutRemarksDtoRowsItem>[
      for (final r in rows)
        if (_remark['${r['studentId']}']!.text.trim().isNotEmpty)
          _RemarkRow({
            'studentId': '${r['studentId']}',
            'remark': _remark['${r['studentId']}']!.text.trim(),
            'participation': _part['${r['studentId']}']!.text.trim().isEmpty
                ? null
                : _part['${r['studentId']}']!.text.trim(),
            'promotedTo': _promoted['${r['studentId']}']!.text.trim().isEmpty
                ? null
                : _promoted['${r['studentId']}']!.text.trim(),
          }),
    ];
    if (out.isEmpty) return setState(() => _error = s.erNoRemark);
    await _send(
      () => ref
          .read(apiProvider)
          .examEntryPutRemarks(
            id: widget.examId,
            body: PutRemarksDto(classSectionId: widget.sectionId, rows: out),
          ),
      (r) => s.erRemarksSaved((r['changed'] as num?)?.toInt() ?? out.length),
    );
  }

  /// As the website: the pupils with a height, a weight or a blood group (an empty one goes as null).
  Future<void> _saveHealth(List<Json> rows) async {
    final s = ref.read(stringsProvider);
    final out = <PutHealthDtoRowsItem>[];
    for (final r in rows) {
      final id = '${r['studentId']}';
      final row = <String, Object?>{'studentId': id};
      for (final (field, box, lo, hi) in [
        ('heightCm', _height[id]!, 40, 250),
        ('weightKg', _weight[id]!, 3, 200),
      ]) {
        final text = box.text.trim();
        final value = text.isEmpty ? null : num.tryParse(text);
        if (text.isNotEmpty && (value == null || value < lo || value > hi)) {
          return setState(() => _error = '${r['name']}: ${s.hwRange}');
        }
        row[field] = value;
      }
      final blood = _bloodOf[id] ?? '';
      row['bloodGroup'] = blood.isEmpty ? null : blood;
      if (row['heightCm'] != null || row['weightKg'] != null || row['bloodGroup'] != null) {
        out.add(_HealthRow(row));
      }
    }
    if (out.isEmpty) return setState(() => _error = s.erNoHealth);
    await _send(
      () => ref
          .read(apiProvider)
          .examEntryPutHealth(
            id: widget.examId,
            body: PutHealthDto(classSectionId: widget.sectionId, rows: out),
          ),
      (r) => s.erHealthSaved((r['recorded'] as num?)?.toInt() ?? out.length),
    );
  }

  Future<void> _pickDay(bool from) async {
    final today = schoolToday();
    final current = from ? _from : _to;
    final d = await showDatePicker(
      context: context,
      initialDate: current.isEmpty ? today : DateTime.parse(current),
      firstDate: DateTime(today.year - 1),
      lastDate: DateTime(today.year + 1, 12, 31),
    );
    if (d != null) setState(() => from ? _from = ymd(d) : _to = ymd(d));
  }

  Future<void> _count() async {
    final s = ref.read(stringsProvider);
    await _send(
      () => ref
          .read(apiProvider)
          .examEntryAttendanceFromDaily(
            id: widget.examId,
            body: AttendanceFromDailyDto(
              classSectionId: widget.sectionId,
              from: _from.isEmpty ? null : _from,
              to: _to.isEmpty ? null : _to,
              overwrite: _overwrite,
            ),
          ),
      (r) => s.eaCounted(
        (r['filled'] as num?)?.toInt() ?? 0,
        '${r['from'] ?? ''}'.isEmpty ? '' : s.date('${r['from']}'),
        '${r['to'] ?? ''}'.isEmpty ? '' : s.date('${r['to']}'),
        (r['kept'] as num?)?.toInt() ?? 0,
      ),
    );
  }

  /// The school's general remarks, to put in the box (and change).
  Future<void> _choose(TextEditingController box, List<Json> bank) async {
    final s = ref.read(stringsProvider);
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
                  child: Text(s.rmChoose, style: Theme.of(c).textTheme.titleMedium),
                ),
              ),
              for (final b in bank)
                ListTile(
                  key: Key('erBank-${b['code']}'),
                  title: Text('${b['text']}'),
                  onTap: () => Navigator.pop(c, '${b['text']}'),
                ),
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
    final async = ref.watch(examRegisterProvider(_key));
    if (!async.hasValue) {
      return async.hasError ? ErrorText(_say(s, async.error!)) : const LinearProgressIndicator();
    }
    final reg = async.value!;
    _fill(reg);
    final rows = asList(reg['rows']);
    final section = asJson(reg['section']);
    final locked = asJson(reg['exam'])['marksLocked'] == true;
    final full = widget.full;
    final showHealth = full && reg['healthVisible'] == true;
    final bank = asList(reg['remarkBank']);
    InputDecoration box(String label, {Widget? suffix}) => InputDecoration(
      labelText: label,
      border: const OutlineInputBorder(),
      isDense: true,
      suffixIcon: suffix,
    );
    Widget gap() => const SizedBox(height: Tokens.sp2);
    final sheet = Card(
      key: const Key('eaSheet'),
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
                    full ? s.erTitle('${section['code']}') : s.eaOf('${section['code']}'),
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
            for (final r in rows)
              () {
                final id = '${r['studentId']}';
                final h = asJson(r['health']);
                final blood = _bloodOf[id] ?? '';
                return Container(
                  key: Key('eaPupil-$id'),
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
                        [
                          '${r['admissionNo'] ?? ''}',
                          if (full && h['recordedOn'] != null)
                            s.erLastHealth(
                              s.date('${h['recordedOn']}'),
                              h['bmi'] == null ? null : '${h['bmi']}',
                            ),
                        ].where((x) => x.isNotEmpty).join(' · '),
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                      if (full) ...[
                        gap(),
                        TextField(
                          key: Key('erRemark-$id'),
                          controller: _remark[id],
                          enabled: !locked,
                          maxLength: 600,
                          minLines: 1,
                          maxLines: 4,
                          decoration: box(
                            s.erRemark,
                            suffix: !locked && bank.isNotEmpty
                                ? IconButton(
                                    key: Key('erPick-$id'),
                                    tooltip: '${s.rmChoose}: ${r['name']}',
                                    icon: const Icon(Icons.list_alt_outlined),
                                    onPressed: () => _choose(_remark[id]!, bank),
                                  )
                                : null,
                          ).copyWith(counterText: ''),
                        ),
                        gap(),
                        TextField(
                          key: Key('erPart-$id'),
                          controller: _part[id],
                          enabled: !locked,
                          maxLength: 300,
                          decoration: box(s.erTookPart).copyWith(counterText: ''),
                        ),
                        gap(),
                        TextField(
                          key: Key('erPromoted-$id'),
                          controller: _promoted[id],
                          enabled: !locked,
                          maxLength: 40,
                          decoration: box(s.erPromoted).copyWith(counterText: ''),
                        ),
                      ],
                      gap(),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              key: Key('eaPresent-$id'),
                              controller: _present[id],
                              enabled: !locked,
                              keyboardType: TextInputType.number,
                              decoration: box(s.eaPresent),
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: Tokens.sp2),
                            child: Text('/'),
                          ),
                          Expanded(
                            child: TextField(
                              key: Key('eaTotal-$id'),
                              controller: _total[id],
                              enabled: !locked,
                              keyboardType: TextInputType.number,
                              decoration: box(s.eaTotal),
                            ),
                          ),
                        ],
                      ),
                      if (showHealth) ...[
                        gap(),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                key: Key('erHeight-$id'),
                                controller: _height[id],
                                enabled: !locked,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                decoration: box(s.hwHeight),
                              ),
                            ),
                            const SizedBox(width: Tokens.sp2),
                            Expanded(
                              child: TextField(
                                key: Key('erWeight-$id'),
                                controller: _weight[id],
                                enabled: !locked,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                decoration: box(s.hwWeight),
                              ),
                            ),
                          ],
                        ),
                        gap(),
                        DropdownButtonFormField<String>(
                          key: Key('erBlood-$id-$_version'),
                          initialValue: blood,
                          isExpanded: true,
                          decoration: box(s.hwBlood),
                          items: [
                            const DropdownMenuItem(value: '', child: Text('—')),
                            for (final b in [
                              ..._blood,
                              if (blood.isNotEmpty && !_blood.contains(blood)) blood,
                            ])
                              DropdownMenuItem(value: b, child: Text(b)),
                          ],
                          onChanged: locked ? null : (v) => setState(() => _bloodOf[id] = v ?? ''),
                        ),
                      ],
                    ],
                  ),
                );
              }(),
            if (_error != null) ...[ErrorText(_error!), gap()],
            if (locked)
              Text(
                s.eaLocked,
                key: const Key('eaLocked'),
                style: TextStyle(color: muted),
              )
            else ...[
              if (full) ...[
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    key: const Key('erSaveRemarks'),
                    onPressed: _busy ? null : () => _saveRemarks(rows),
                    child: Text(s.erSaveRemarks),
                  ),
                ),
                gap(),
              ],
              SizedBox(
                width: double.infinity,
                child: full
                    ? OutlinedButton(
                        key: const Key('eaSave'),
                        onPressed: _busy ? null : () => _saveAttendance(rows),
                        child: Text(s.eaSave),
                      )
                    : FilledButton(
                        key: const Key('eaSave'),
                        onPressed: _busy ? null : () => _saveAttendance(rows),
                        child: Text(_busy ? s.loading : s.eaSave),
                      ),
              ),
              if (showHealth) ...[
                gap(),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const Key('erSaveHealth'),
                    onPressed: _busy ? null : () => _saveHealth(rows),
                    child: Text(s.hwSave),
                  ),
                ),
              ],
              const Divider(height: Tokens.sp5),
              Text(s.eaFromDailyHelp, style: TextStyle(color: muted, fontSize: 13)),
              gap(),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  OutlinedButton.icon(
                    key: const Key('eaFrom'),
                    onPressed: _busy ? null : () => _pickDay(true),
                    icon: const Icon(Icons.calendar_today_outlined),
                    label: Text('${s.fromWord}: ${_from.isEmpty ? '—' : s.date(_from)}'),
                  ),
                  OutlinedButton.icon(
                    key: const Key('eaTo'),
                    onPressed: _busy ? null : () => _pickDay(false),
                    icon: const Icon(Icons.calendar_today_outlined),
                    label: Text('${s.toWord}: ${_to.isEmpty ? '—' : s.date(_to)}'),
                  ),
                ],
              ),
              SwitchListTile(
                key: const Key('eaOverwrite'),
                contentPadding: EdgeInsets.zero,
                title: Text(s.eaReplace),
                value: _overwrite,
                onChanged: _busy ? null : (v) => setState(() => _overwrite = v),
              ),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  key: const Key('eaCount'),
                  onPressed: _busy ? null : _count,
                  icon: const Icon(Icons.calculate_outlined),
                  label: Text(s.eaCount),
                ),
              ),
            ],
          ],
        ),
      ),
    );
    if (!full) return sheet;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // the register by Excel, one closed line as on Marks and Height and weight (docs/design/96 part 18)
        SheetByExcel(
          folded: true,
          title: s.erTitle('${section['code']}'),
          help: s.xlRegisterHelp,
          canUpload: !locked,
          download: () => ref
              .read(apiProvider)
              .examEntryRegisterExcel(id: widget.examId, classSectionId: widget.sectionId),
          upload: (file, apply) => ref
              .read(apiProvider)
              .examEntryRegisterUpload(
                id: widget.examId,
                body: SectionSheetUploadDto(
                  classSectionId: widget.sectionId,
                  file: file,
                  apply: apply,
                ),
              ),
          onSaved: () => ref.invalidate(examRegisterProvider(_key)),
        ),
        const SizedBox(height: Tokens.sp3),
        sheet,
      ],
    );
  }
}
