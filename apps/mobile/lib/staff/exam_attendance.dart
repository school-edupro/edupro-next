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

/// A section's exam register for an exam: each pupil's days present of the total (and what else the register keeps).
final examRegisterProvider = FutureProvider.autoDispose.family<Json, (String, String)>((
  ref,
  a,
) async {
  final (exam, section) = a;
  return asJson(await ref.read(apiProvider).examEntryRegister(id: exam, classSectionId: section));
});

/// Exam attendance as on the staff website (the Exam register with only the attendance; docs/design/96, part 17):
/// the exam and the class teacher's section, each pupil's days present of the total days, Save exam attendance, and
/// Count from daily attendance (from, to, replace what is entered). No web page.
class ExamAttendanceScreen extends ConsumerStatefulWidget {
  const ExamAttendanceScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<ExamAttendanceScreen> createState() => _ExamAttendanceScreenState();
}

class _ExamAttendanceScreenState extends ConsumerState<ExamAttendanceScreen> {
  String? _exam;
  String? _section;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final examsAsync = ref.watch(examsTakingProvider((widget.profile, 'attendance')));
    Widget page(List<Widget> children) => ListView(
      key: const Key('eaScreen'),
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
            ref.invalidate(examsTakingProvider((widget.profile, 'attendance')));
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
                key: ValueKey('eaView-$examId-${chosen['classSectionId']}'),
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

/// One section's exam attendance: the days boxes, Save, Count from daily attendance.
class ExamAttendanceView extends ConsumerStatefulWidget {
  const ExamAttendanceView({super.key, required this.examId, required this.sectionId});
  final String examId;
  final String sectionId;

  @override
  ConsumerState<ExamAttendanceView> createState() => _ExamAttendanceViewState();
}

class _ExamAttendanceViewState extends ConsumerState<ExamAttendanceView> {
  final Map<String, TextEditingController> _present = {};
  final Map<String, TextEditingController> _total = {};
  Object? _filledFrom;
  String _from = '';
  String _to = '';
  bool _overwrite = false;
  bool _busy = false;
  String? _error;

  (String, String) get _key => (widget.examId, widget.sectionId);

  @override
  void dispose() {
    for (final c in [..._present.values, ..._total.values]) {
      c.dispose();
    }
    super.dispose();
  }

  void _fill(Json reg) {
    if (identical(_filledFrom, reg)) return;
    _filledFrom = reg;
    for (final r in asList(reg['rows'])) {
      final id = '${r['studentId']}';
      (_present[id] ??= TextEditingController()).text = '${r['daysPresent'] ?? ''}';
      (_total[id] ??= TextEditingController()).text = '${r['daysTotal'] ?? ''}';
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

  /// As the website: the pupils with both boxes filled.
  Future<void> _save(List<Json> rows) async {
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
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .examEntryPutAttendance(
              id: widget.examId,
              body: PutExamAttendanceDto(classSectionId: widget.sectionId, rows: out),
            ),
      );
      if (!mounted) return;
      _toast(s.eaSaved((r['changed'] as num?)?.toInt() ?? out.length));
      ref.invalidate(examRegisterProvider(_key));
    } catch (e) {
      if (mounted) setState(() => _error = _say(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
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
      );
      if (!mounted) return;
      _toast(
        s.eaCounted(
          (r['filled'] as num?)?.toInt() ?? 0,
          '${r['from'] ?? ''}'.isEmpty ? '' : s.date('${r['from']}'),
          '${r['to'] ?? ''}'.isEmpty ? '' : s.date('${r['to']}'),
          (r['kept'] as num?)?.toInt() ?? 0,
        ),
      );
      ref.invalidate(examRegisterProvider(_key));
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
    final async = ref.watch(examRegisterProvider(_key));
    if (!async.hasValue) {
      return async.hasError ? ErrorText(_say(s, async.error!)) : const LinearProgressIndicator();
    }
    final reg = async.value!;
    _fill(reg);
    final rows = asList(reg['rows']);
    final section = asJson(reg['section']);
    final locked = asJson(reg['exam'])['marksLocked'] == true;
    InputDecoration box(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true);
    return Card(
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
                    s.eaOf('${section['code']}'),
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
              Container(
                key: Key('eaPupil-${r['studentId']}'),
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
                    const SizedBox(height: Tokens.sp2),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            key: Key('eaPresent-${r['studentId']}'),
                            controller: _present['${r['studentId']}'],
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
                            key: Key('eaTotal-${r['studentId']}'),
                            controller: _total['${r['studentId']}'],
                            enabled: !locked,
                            keyboardType: TextInputType.number,
                            decoration: box(s.eaTotal),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
            if (locked)
              Text(
                s.eaLocked,
                key: const Key('eaLocked'),
                style: TextStyle(color: muted),
              )
            else ...[
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const Key('eaSave'),
                  onPressed: _busy ? null : () => _save(rows),
                  child: Text(_busy ? s.loading : s.eaSave),
                ),
              ),
              const Divider(height: Tokens.sp5),
              Text(s.eaFromDailyHelp, style: TextStyle(color: muted, fontSize: 13)),
              const SizedBox(height: Tokens.sp2),
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
  }
}
