import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'register_sheet.dart';

/// A register's file as the viewer takes it: the API answers with the file in base64.
Future<ApiFile> _asFile(Future<dynamic> call) async {
  final r = asJson(await call);
  return ApiFile(
    bytes: base64Decode('${r['base64'] ?? ''}'),
    contentType: '${r['contentType'] ?? 'application/octet-stream'}',
    name: '${r['filename'] ?? 'register'}',
  );
}

/// PDF and Excel of what is shown, or of every section, as the website's Download menu (a PDF on the website's
/// usual paper: Legal, landscape, fitted to the width).
class _Downloads extends ConsumerWidget {
  const _Downloads({required this.title, required this.call, this.all = true});
  final String title;

  /// the file: `format` pdf or xlsx, `all` every section
  final Future<dynamic> Function(String format, bool all) call;
  final bool all;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    void open(String format, bool every) => Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(title: title, load: () => _asFile(call(format, every))),
      ),
    );
    return Wrap(
      spacing: Tokens.sp2,
      runSpacing: Tokens.sp2,
      children: [
        OutlinedButton.icon(
          key: const Key('rgPdf'),
          onPressed: () => open('pdf', false),
          icon: const Icon(Icons.picture_as_pdf_outlined),
          label: const Text('PDF'),
        ),
        OutlinedButton.icon(
          key: const Key('rgExcel'),
          onPressed: () => open('xlsx', false),
          icon: const Icon(Icons.table_chart_outlined),
          label: const Text('Excel'),
        ),
        if (all) ...[
          OutlinedButton(
            key: const Key('rgAllPdf'),
            onPressed: () => open('pdf', true),
            child: Text(s.rgAllPdf),
          ),
          OutlinedButton(
            key: const Key('rgAllExcel'),
            onPressed: () => open('xlsx', true),
            child: Text(s.rgAllExcel),
          ),
        ],
      ],
    );
  }
}

/// A searchable drop-down of the run's choices, the whole width.
Widget _pick(
  S s,
  String key,
  String label,
  String value,
  List<(String, String)> entries,
  void Function(String) on,
) => Padding(
  padding: const EdgeInsets.only(bottom: Tokens.sp3),
  child: DropdownMenu<String>(
    key: Key(key),
    label: Text(label),
    expandedInsets: EdgeInsets.zero,
    initialSelection: entries.any((e) => e.$1 == value) ? value : entries.firstOrNull?.$1,
    trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: label),
    selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: label),
    onSelected: (v) => on(v ?? ''),
    dropdownMenuEntries: [for (final (v, l) in entries) DropdownMenuEntry(value: v, label: l)],
  ),
);

Widget _notes(BuildContext context, List<String> notes) => notes.isEmpty
    ? const SizedBox.shrink()
    : Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: Tokens.sp3),
        padding: const EdgeInsets.all(Tokens.sp3),
        decoration: BoxDecoration(
          color: Tokens.statusWarningBg,
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final n in notes) Text('• $n', style: const TextStyle(color: Tokens.textBody)),
          ],
        ),
      );

final _markRegistersProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  final r = asJson(await ref.read(apiProvider).markSchemesList());
  return [
    for (final x in asList(r['data']))
      if (asJson(x['rights'])['run'] == true) x,
  ];
});

final _gradeRegistersProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  final r = asJson(await ref.read(apiProvider).gradeRegistersList());
  return [
    for (final x in asList(r['data']))
      if (asJson(x['rights'])['run'] == true) x,
  ];
});

/// The Exam register's Registers (docs/design/97), as the admin's Registers: Mark, Grade, Remark, Attendance and
/// Height & Weight registers, for the classes and sections the person teaches. A mark or grade register opens its
/// run; the other three show here.
class StaffRegistersTab extends ConsumerStatefulWidget {
  const StaffRegistersTab({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffRegistersTab> createState() => _StaffRegistersTabState();
}

class _StaffRegistersTabState extends ConsumerState<StaffRegistersTab>
    with AutomaticKeepAliveClientMixin {
  String _kind = 'mark';

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return ListView(
      key: const Key('rgList'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.rgListHelp, style: TextStyle(color: muted)),
        const SizedBox(height: Tokens.sp3),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final k in const ['mark', 'grade', 'remark', 'attendance', 'health'])
              ChoiceChip(
                key: Key('rgKind-$k'),
                label: Text(s.rgKind(k)),
                selected: _kind == k,
                showCheckmark: false,
                onSelected: (_) => setState(() => _kind = k),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        if (_kind == 'mark' || _kind == 'grade')
          _registerList(s, muted)
        else
          StudentRegisterView(key: ValueKey('rgStudent-$_kind'), type: _kind),
      ],
    );
  }

  Widget _registerList(S s, Color muted) {
    final mark = _kind == 'mark';
    final async = ref.watch(
      mark ? _markRegistersProvider(widget.profile) : _gradeRegistersProvider(widget.profile),
    );
    return async.when(
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => ErrorText(errorText(s, e)),
      data: (list) => list.isEmpty
          ? Text(mark ? s.rgNoMark : s.rgNoGrade, style: TextStyle(color: muted))
          : Column(
              children: [
                for (final r in list)
                  Card(
                    key: Key('rgReg-${r['id']}'),
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
                              Text(
                                '${r['name']}',
                                style: Theme.of(context).textTheme.titleMedium
                                    ?.copyWith(fontWeight: Tokens.fwSemibold),
                              ),
                              StatusChip(
                                r['status'] == 'locked' ? s.mkLocked : s.rgDraft,
                                r['status'] == 'locked' ? Tone.success : Tone.neutral,
                              ),
                              if (r['purpose'] == 'result') StatusChip(s.rgResult, Tone.info),
                            ],
                          ),
                          Text(
                            [
                              asList(r['classes']).map((k) => '${k['code']}').join(', '),
                              mark
                                  ? asList(r['exams'])
                                        .map((e) => '${e['code'] ?? e['key']}')
                                        .join(' · ')
                                  : ((r['assessments'] as List?) ?? const []).join(' · '),
                              if (mark) s.rgSubjectsN((r['subjects'] as num?)?.toInt() ?? 0),
                            ].where((x) => x.isNotEmpty).join(' — '),
                            style: TextStyle(color: muted, fontSize: 13),
                          ),
                          const SizedBox(height: Tokens.sp2),
                          FilledButton.icon(
                            key: Key('rgRun-${r['id']}'),
                            style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                            onPressed: () => pushPage(
                              context,
                              '${r['name']}',
                              mark
                                  ? MarkRegisterRunScreen(id: '${r['id']}', name: '${r['name']}')
                                  : GradeRegisterRunScreen(id: '${r['id']}', name: '${r['name']}'),
                            ),
                            icon: const Icon(Icons.play_arrow),
                            label: Text(s.rgRun),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

// ---- a mark register's run ------------------------------------------------------------------------------------

/// Run a mark register as the website's (docs/design/68, 97): the class (a section; the class ranked together where
/// the person may), the exam of an exam-wise register (and of Missing / Absent), a subject, the Reports with their
/// own choices, PDF and Excel; the sheet or the report's tables.
class MarkRegisterRunScreen extends ConsumerStatefulWidget {
  const MarkRegisterRunScreen({super.key, required this.id, required this.name});
  final String id;
  final String name;

  @override
  ConsumerState<MarkRegisterRunScreen> createState() => _MarkRegisterRunScreenState();
}

class _MarkRegisterRunScreenState extends ConsumerState<MarkRegisterRunScreen> {
  String _place = '';
  String _exam = '';
  String _subject = '';
  String _report = 'register';
  String _view = 'merit';
  String _margin = '5';
  bool _lowest = false;
  String _from = '';
  String _to = '';
  final _top = TextEditingController(text: '3');
  final _pctFrom = TextEditingController();
  final _pctTo = TextEditingController();
  final _failFrom = TextEditingController();
  final _failTo = TextEditingController();
  late Future<dynamic> _future = _load();

  @override
  void dispose() {
    for (final c in [_top, _pctFrom, _pctTo, _failFrom, _failTo]) {
      c.dispose();
    }
    super.dispose();
  }

  num? _n(TextEditingController c) => num.tryParse(c.text.trim());

  Future<dynamic> _load({String? format, bool all = false}) {
    final merit = _place.startsWith('c:');
    final api = ref.read(apiProvider);
    final r = _report;
    return api.markSchemesRegister(
      id: widget.id,
      classSectionId: _place.startsWith('s:') ? _place.substring(2) : null,
      classId: merit ? _place.substring(2) : null,
      view: merit ? _view : 'marks',
      exam: _exam.isEmpty ? null : _exam,
      subject: _subject.isEmpty ? null : _subject,
      report: r == 'register' ? null : r,
      top: r == 'toppers' ? (_top.text.trim().isEmpty ? 'all' : _top.text.trim()) : null,
      pctFrom: r == 'toppers' || r == 'failing' ? _n(_pctFrom) : null,
      pctTo: r == 'toppers' || r == 'failing' ? _n(_pctTo) : null,
      lowest: r == 'toppers' && _lowest ? '1' : null,
      failFrom: r == 'failing' ? _n(_failFrom)?.toInt() : null,
      failTo: r == 'failing' ? _n(_failTo)?.toInt() : null,
      margin: r == 'risk' ? int.tryParse(_margin) : null,
      from: r == 'attendance' && _from.isNotEmpty ? _from : null,
      to: r == 'attendance' && _to.isNotEmpty ? _to : null,
      format: format,
      all: all ? '1' : null,
      paper: format == 'pdf' ? 'Legal' : null,
      orientation: format == 'pdf' ? 'landscape' : null,
      fit: format == 'pdf' ? '1' : null,
    );
  }

  void _reload() => setState(() {
    _future = _load();
  });

  Future<void> _pickDay(bool from) async {
    final today = schoolToday();
    final cur = from ? _from : _to;
    final d = await showDatePicker(
      context: context,
      initialDate: cur.isEmpty ? today : DateTime.parse(cur),
      firstDate: DateTime(today.year - 2),
      lastDate: DateTime(today.year + 1, 12, 31),
    );
    if (d == null) return;
    setState(() => from ? _from = ymd(d) : _to = ymd(d));
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return FutureBuilder<dynamic>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) {
          return ListView(
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [ErrorText(errorText(s, snap.error!))],
          );
        }
        if (!snap.hasData) {
          return Center(
            child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
          );
        }
        final reg = asJson(snap.data);
        final scheme = asJson(reg['scheme']);
        final places = asList(reg['places']);
        final shown = _place.isNotEmpty ? _place : '${places.firstOrNull?['value'] ?? ''}';
        final merit = shown.startsWith('c:');
        final examwise = scheme['type'] == 'examwise';
        final byExam = _report == 'missing' || _report == 'absent';
        final reports = [
          for (final x in asList(reg['reports']))
            if (x['merit'] != true || merit) x,
        ];
        final label = '${places.where((p) => p['value'] == shown).firstOrNull?['label'] ?? ''}';
        final reportLabel = _report == 'register'
            ? s.rgRegister
            : '${reports.where((x) => x['kind'] == _report).firstOrNull?['label'] ?? _report}';
        final counts = asJson(reg['counts']);
        final notes = [for (final n in (reg['notes'] as List?) ?? const []) '$n'];
        final range = reg['range'] is Map ? asJson(reg['range']) : null;
        InputDecoration box(String l) =>
            InputDecoration(labelText: l, border: const OutlineInputBorder(), isDense: true);
        Widget numBox(String key, String label, TextEditingController c) => SizedBox(
          width: 120,
          child: TextField(
            key: Key(key),
            controller: c,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: box(label),
          ),
        );
        return ListView(
          key: const Key('rgMarkRun'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              '${s.rgVersion((scheme['version'] as num?)?.toInt() ?? 1, scheme['status'] == 'draft')}'
              ' · $reportLabel · $label${reg['examName'] != null ? ' · ${reg['examName']}' : ''}',
              key: const Key('rgMarkHead'),
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: Tokens.sp3),
            _pick(
              s,
              'rgPlace',
              s.rgClass,
              shown,
              [for (final p in places) ('${p['value']}', '${p['label']}')],
              (v) {
                _place = v;
                if (!v.startsWith('c:') &&
                    (reports.where((x) => x['kind'] == _report).firstOrNull?['merit'] == true)) {
                  _report = 'register';
                }
                _reload();
              },
            ),
            if (examwise || byExam)
              _pick(
                s,
                'rgExam',
                s.mkExam,
                '${reg['exam'] ?? ''}',
                [
                  if (!examwise) ('', s.rgAllExams),
                  for (final e in (reg['exams'] as List?) ?? const []) ('$e', '$e'),
                ],
                (v) {
                  _exam = v;
                  _reload();
                },
              ),
            if (_report != 'attendance')
              _pick(
                s,
                'rgSubject',
                s.rgSubject,
                _subject,
                [
                  ('', s.rgAllSubjects),
                  for (final x in asList(reg['subjects'])) ('${x['key']}', '${x['title']}'),
                ],
                (v) {
                  _subject = v;
                  _reload();
                },
              ),
            _pick(
              s,
              'rgReport',
              s.rgReport,
              _report,
              [
                ('register', s.rgRegister),
                for (final x in reports) ('${x['kind']}', '${x['label']}'),
              ],
              (v) {
                _report = v.isEmpty ? 'register' : v;
                _reload();
              },
            ),
            if (merit && _report == 'register')
              _pick(
                s,
                'rgView',
                s.rgMeritOrder,
                _view,
                [('merit', s.rgRank), ('division', s.rgDivision)],
                (v) {
                  _view = v;
                  _reload();
                },
              ),
            if (_report == 'toppers' ||
                _report == 'failing' ||
                _report == 'risk' ||
                _report == 'attendance')
              Padding(
                padding: const EdgeInsets.only(bottom: Tokens.sp3),
                child: Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (_report == 'toppers') ...[
                      numBox('rgTop', s.rgTop, _top),
                      numBox('rgPctFrom', s.rgPctFrom, _pctFrom),
                      numBox('rgPctTo', s.rgPctTo, _pctTo),
                      SizedBox(
                        width: 200,
                        child: DropdownButtonFormField<bool>(
                          key: const Key('rgOrder'),
                          initialValue: _lowest,
                          isExpanded: true,
                          decoration: box(s.rgOrder),
                          items: [
                            DropdownMenuItem(value: false, child: Text(s.rgHighest)),
                            DropdownMenuItem(value: true, child: Text(s.rgLowest)),
                          ],
                          onChanged: (v) => setState(() => _lowest = v ?? false),
                        ),
                      ),
                    ],
                    if (_report == 'failing') ...[
                      numBox('rgFailFrom', s.rgFailFrom, _failFrom),
                      numBox('rgFailTo', s.rgFailTo, _failTo),
                      numBox('rgPctFrom', s.rgFinalFrom, _pctFrom),
                      numBox('rgPctTo', s.rgFinalTo, _pctTo),
                    ],
                    if (_report == 'risk')
                      SizedBox(
                        width: 200,
                        child: DropdownButtonFormField<String>(
                          key: const Key('rgMargin'),
                          initialValue: _margin,
                          isExpanded: true,
                          decoration: box(s.rgMargin),
                          items: [
                            for (final m in const ['5', '10'])
                              DropdownMenuItem(value: m, child: Text(s.rgMarginN(int.parse(m)))),
                          ],
                          onChanged: (v) {
                            _margin = v ?? '5';
                            _reload();
                          },
                        ),
                      ),
                    if (_report == 'attendance') ...[
                      OutlinedButton.icon(
                        key: const Key('rgFrom'),
                        onPressed: () => _pickDay(true),
                        icon: const Icon(Icons.calendar_today_outlined),
                        label: Text(
                          '${s.fromWord}: ${s.date(_from.isNotEmpty ? _from : '${range?['from'] ?? ''}')}',
                        ),
                      ),
                      OutlinedButton.icon(
                        key: const Key('rgTo'),
                        onPressed: () => _pickDay(false),
                        icon: const Icon(Icons.calendar_today_outlined),
                        label: Text(
                          '${s.toWord}: ${s.date(_to.isNotEmpty ? _to : '${range?['to'] ?? ''}')}',
                        ),
                      ),
                    ],
                    if (_report == 'toppers' || _report == 'failing')
                      OutlinedButton(
                        key: const Key('rgShow'),
                        onPressed: _reload,
                        child: Text(s.rgShow),
                      ),
                  ],
                ),
              ),
            _Downloads(
              title: '${widget.name} · $label',
              call: (format, all) => _load(format: format, all: all),
            ),
            const SizedBox(height: Tokens.sp3),
            _notes(context, notes),
            if (_report != 'attendance' && counts.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: Tokens.sp3),
                child: Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp1,
                  children: [
                    for (final e in counts.entries)
                      StatusChip('${s.rgResultWord(e.key)} ${e.value}', switch (e.key) {
                        'pass' => Tone.success,
                        'compartment' => Tone.warning,
                        'fail' => Tone.danger,
                        _ => Tone.neutral,
                      }),
                  ],
                ),
              ),
            if (_report != 'register')
              for (final b in asList(reg['blocks'])) ...[
                if (b['band'] != false)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Tokens.sp2),
                    child: Semantics(
                      header: true,
                      child: Text('${b['title']}', style: Theme.of(context).textTheme.titleSmall),
                    ),
                  ),
                if ('${asJson(b['sheet'])['note'] ?? ''}'.isNotEmpty)
                  Text(
                    '${asJson(b['sheet'])['note']}',
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                RegisterSheetView(sheet: asJson(b['sheet']), label: '${b['title']} · $label'),
                const SizedBox(height: Tokens.sp4),
              ]
            else if (reg['sheet'] is Map && asList(asJson(reg['sheet'])['body']).isNotEmpty)
              RegisterSheetView(sheet: asJson(reg['sheet']), label: '${widget.name} · $label')
            else
              Text(
                s.rgNoStudents,
                key: const Key('rgNoStudents'),
                style: TextStyle(color: muted),
              ),
          ],
        );
      },
    );
  }
}

// ---- a grade register's run -----------------------------------------------------------------------------------

/// Run a grade register as the website's (docs/design/69 part 3, 97): the section, the layout (the class sheet or
/// student-wise), the Grade sheet, Grade summary and Analysis (this section or every section), a filter by area and
/// indicator, PDF and Excel.
class GradeRegisterRunScreen extends ConsumerStatefulWidget {
  const GradeRegisterRunScreen({super.key, required this.id, required this.name});
  final String id;
  final String name;

  @override
  ConsumerState<GradeRegisterRunScreen> createState() => _GradeRegisterRunScreenState();
}

class _GradeRegisterRunScreenState extends ConsumerState<GradeRegisterRunScreen> {
  String _section = '';
  String _layout = 'class';
  String _report = 'sheet';
  final Set<String> _areas = {};
  final Set<String> _items = {};
  late Future<dynamic> _future = _load();

  Future<dynamic> _load({String? format, bool all = false}) => ref
      .read(apiProvider)
      .gradeRegistersRun(
        id: widget.id,
        classSectionId: _section.isEmpty ? null : _section,
        layout: _layout,
        report: _report,
        areas: _areas.isEmpty ? null : _areas.join('|'),
        items: _items.isEmpty ? null : _items.join(','),
        format: format,
        all: all ? '1' : null,
        paper: format == 'pdf' ? 'Legal' : null,
        orientation: format == 'pdf' ? 'landscape' : null,
        fit: format == 'pdf' ? '1' : null,
      );

  void _reload() => setState(() {
    _future = _load();
  });

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return FutureBuilder<dynamic>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) {
          return ListView(
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [ErrorText(errorText(s, snap.error!))],
          );
        }
        if (!snap.hasData) {
          return Center(
            child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
          );
        }
        final run = asJson(snap.data);
        final places = asList(run['places']);
        final areas = asList(run['areas']);
        final items = asList(run['items']);
        final sheets = asList(run['sheets']);
        final place = '${run['place'] ?? ''}';
        final notes = [for (final n in (run['notes'] as List?) ?? const []) '$n'];
        final filtered = _areas.isNotEmpty || _items.isNotEmpty;
        return ListView(
          key: const Key('rgGradeRun'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              [
                s.rgGradeReport(_report),
                for (final e in asList(run['exams'])) '${e['label']} = ${e['name']}',
              ].join(' · '),
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: Tokens.sp3),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final r in const ['sheet', 'summary', 'analysis', 'analysis-all'])
                  ChoiceChip(
                    key: Key('rgGradeReport-$r'),
                    label: Text(s.rgGradeReport(r)),
                    selected: _report == r,
                    showCheckmark: false,
                    onSelected: (_) {
                      _report = r;
                      _reload();
                    },
                  ),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            if (_report != 'analysis-all' && places.isNotEmpty)
              _pick(
                s,
                'rgGradeSection',
                s.inSection,
                place,
                [for (final p in places) ('${p['value']}', '${p['label']}')],
                (v) {
                  _section = v;
                  _reload();
                },
              ),
            if (_report == 'sheet')
              _pick(
                s,
                'rgLayout',
                s.rgLayout,
                _layout,
                [('class', s.rgClassSheet), ('student', s.rgStudentWise)],
                (v) {
                  _layout = v;
                  _reload();
                },
              ),
            if (areas.length > 1 || items.length > 1)
              Card(
                margin: const EdgeInsets.only(bottom: Tokens.sp3),
                child: ExpansionTile(
                  key: const Key('rgGradeFilter'),
                  title: Text(s.rgFilter),
                  initiallyExpanded: filtered,
                  shape: const Border(),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, 0, Tokens.sp3, Tokens.sp3),
                  children: [
                    Text(s.rgAreas, style: Theme.of(context).textTheme.labelLarge),
                    Wrap(
                      spacing: Tokens.sp2,
                      children: [
                        for (final a in areas)
                          FilterChip(
                            label: Text('${a['name'] ?? ''}'.isEmpty ? s.inOther : '${a['name']}'),
                            selected: _areas.contains('${a['key']}'),
                            onSelected: (on) => setState(
                              () => on ? _areas.add('${a['key']}') : _areas.remove('${a['key']}'),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp2),
                    Text(s.rgItems, style: Theme.of(context).textTheme.labelLarge),
                    Wrap(
                      spacing: Tokens.sp2,
                      children: [
                        for (final it in items)
                          FilterChip(
                            label: Text('${it['name']}'),
                            selected: _items.contains('${it['key']}'),
                            onSelected: (on) => setState(
                              () => on ? _items.add('${it['key']}') : _items.remove('${it['key']}'),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp2),
                    Wrap(
                      spacing: Tokens.sp2,
                      children: [
                        FilledButton(
                          key: const Key('rgGradeFilterShow'),
                          style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                          onPressed: _reload,
                          child: Text(s.rgShow),
                        ),
                        if (filtered)
                          TextButton(
                            onPressed: () {
                              _areas.clear();
                              _items.clear();
                              _reload();
                            },
                            child: Text(s.rgClearFilter),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            if (sheets.isNotEmpty)
              _Downloads(
                title: widget.name,
                call: (format, all) => _load(format: format, all: all),
              ),
            const SizedBox(height: Tokens.sp3),
            _notes(context, notes),
            if (places.isEmpty)
              Text(
                s.rgNoClass,
                key: const Key('rgGradeNone'),
                style: TextStyle(color: muted),
              ),
            for (final sh in sheets) ...[
              if ('${sh['title'] ?? ''}'.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: Tokens.sp2),
                  child: Semantics(
                    header: true,
                    child: Text('${sh['title']}', style: Theme.of(context).textTheme.titleSmall),
                  ),
                ),
              if ('${sh['note'] ?? ''}'.isNotEmpty)
                Text('${sh['note']}', style: TextStyle(color: muted, fontSize: 13)),
              RegisterSheetView(
                sheet: sh,
                label: '${widget.name} · ${sh['title'] ?? sh['place'] ?? ''}',
              ),
              const SizedBox(height: Tokens.sp4),
            ],
          ],
        );
      },
    );
  }
}

// ---- the Remark, Attendance and Height & Weight registers -----------------------------------------------------

/// The Remark, Attendance or Height & Weight register of a class (docs/design/69 part 1, 97): the class, a section
/// or every section, the exams with entries, the attendance cut-off or the BMI; a sheet a section; PDF and Excel.
class StudentRegisterView extends ConsumerStatefulWidget {
  const StudentRegisterView({super.key, required this.type});
  final String type;

  @override
  ConsumerState<StudentRegisterView> createState() => _StudentRegisterViewState();
}

class _StudentRegisterViewState extends ConsumerState<StudentRegisterView> {
  String _class = '';
  String _section = '';
  Set<String>? _exams;
  String _bmi = '';
  final _cutoff = TextEditingController();
  late Future<dynamic> _future = _load();

  @override
  void dispose() {
    _cutoff.dispose();
    super.dispose();
  }

  Future<dynamic> _load({String? format, bool all = false}) => ref
      .read(apiProvider)
      .studentRegistersRun(
        type: widget.type,
        classId: _class.isEmpty ? null : _class,
        section: all ? 'all' : (_section.isEmpty ? null : _section),
        exams: _exams == null || _exams!.isEmpty ? null : _exams!.join(','),
        cutoff: widget.type == 'attendance' ? int.tryParse(_cutoff.text.trim()) : null,
        bmi: widget.type == 'health' && _bmi.isNotEmpty ? _bmi : null,
        format: format ?? 'json',
        paper: format == 'pdf' ? 'Legal' : null,
        orientation: format == 'pdf' ? 'landscape' : null,
        fit: format == 'pdf' ? '1' : null,
      );

  void _reload() => setState(() {
    _future = _load();
  });

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return FutureBuilder<dynamic>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) return ErrorText(errorText(s, snap.error!));
        if (!snap.hasData) return const LinearProgressIndicator();
        final reg = asJson(snap.data);
        final classes = asList(reg['classes']);
        final sections = asList(reg['sections']);
        final exams = asList(reg['exams']);
        final picked = {for (final e in (reg['picked'] as List?) ?? const []) '$e'};
        if (_cutoff.text.isEmpty && reg['cutoff'] != null) _cutoff.text = '${reg['cutoff']}';
        final klass = classes.where((k) => k['id'] == reg['classId']).firstOrNull;
        final places = asList(reg['places']);
        return Column(
          key: Key('rgStudentView-${widget.type}'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(s.rgAbout(widget.type), style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp3),
            if (classes.isEmpty)
              Text(
                s.rgNoClass,
                key: const Key('rgStudentNone'),
                style: TextStyle(color: muted),
              )
            else ...[
              _pick(
                s,
                'rgStudentClass',
                s.rgClass,
                '${reg['classId'] ?? ''}',
                [for (final k in classes) ('${k['id']}', '${k['name']}')],
                (v) {
                  _class = v;
                  _section = '';
                  _exams = null;
                  _reload();
                },
              ),
              _pick(
                s,
                'rgStudentSection',
                s.inSection,
                '${reg['section'] ?? ''}',
                [
                  if (sections.length > 1) ('all', s.rgAllSections),
                  for (final x in sections) ('${x['id']}', '${x['code']}'),
                ],
                (v) {
                  _section = v;
                  _reload();
                },
              ),
              if (widget.type == 'attendance')
                Padding(
                  padding: const EdgeInsets.only(bottom: Tokens.sp3),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 140,
                        child: TextField(
                          key: const Key('rgCutoff'),
                          controller: _cutoff,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: s.rgCutoff,
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: Tokens.sp2),
                      OutlinedButton(onPressed: _reload, child: Text(s.rgShow)),
                    ],
                  ),
                ),
              if (widget.type == 'health')
                _pick(
                  s,
                  'rgBmi',
                  s.rgBmi,
                  reg['bmi'] == true ? '1' : '0',
                  [('1', s.rgShow), ('0', s.rgHide)],
                  (v) {
                    _bmi = v;
                    _reload();
                  },
                ),
              if (exams.isNotEmpty) ...[
                Text(s.rgExams, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: Tokens.sp1),
                Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp2,
                  children: [
                    for (final e in exams)
                      FilterChip(
                        key: Key('rgStudentExam-${e['id']}'),
                        label: Text('${e['code']}'),
                        tooltip: '${e['name']}',
                        selected: (_exams ?? picked).contains('${e['id']}'),
                        onSelected: (on) {
                          final next = {...(_exams ?? picked)};
                          on ? next.add('${e['id']}') : next.remove('${e['id']}');
                          _exams = next;
                          _reload();
                        },
                      ),
                  ],
                ),
                const SizedBox(height: Tokens.sp3),
              ] else
                Text(s.rgNoData(widget.type), style: TextStyle(color: muted)),
              if (places.isNotEmpty)
                _Downloads(
                  title: '${s.rgKind(widget.type)} · ${klass?['name'] ?? ''}',
                  call: (format, all) => _load(format: format, all: all),
                  all: sections.length > 1,
                ),
              const SizedBox(height: Tokens.sp3),
              for (final p in places) ...[
                Semantics(
                  header: true,
                  child: Text(
                    '${klass?['name'] ?? ''} · ${p['place']}',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                const SizedBox(height: Tokens.sp1),
                _notes(context, [for (final n in (p['notes'] as List?) ?? const []) '$n']),
                for (final sh in asList(p['sheets'])) ...[
                  if ('${sh['title'] ?? ''}'.isNotEmpty)
                    Text('${sh['title']}', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                  if ('${sh['note'] ?? ''}'.isNotEmpty)
                    Text('${sh['note']}', style: TextStyle(color: muted, fontSize: 13)),
                  RegisterSheetView(
                    sheet: sh,
                    label:
                        '${s.rgKind(widget.type)} · ${p['place']}${sh['title'] != null ? ' · ${sh['title']}' : ''}',
                  ),
                  const SizedBox(height: Tokens.sp4),
                ],
              ],
            ],
          ],
        );
      },
    );
  }
}
