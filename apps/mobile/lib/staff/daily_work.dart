import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart' show ImagePicker, ImageSource;
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import 'data.dart';

/// Daily work as on the staff website (docs/design/96): the day's sheet of homework and classwork, the same sheet for
/// assignments, and the report of what was posted.
class DailyWorkScreen extends ConsumerWidget {
  const DailyWorkScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('dailyWorkTabs'),
              // the three share the width (a long name wraps), so none sits off a narrow screen
              tabs: [
                for (final label in [s.homeworkAndClasswork, s.assignmentsTab, s.workReport])
                  Tab(
                    height: 56,
                    child: Text(
                      label,
                      maxLines: 2,
                      softWrap: true,
                      textAlign: TextAlign.center,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                WorkSheetTab(profile: profile, mode: 'daily'),
                WorkSheetTab(profile: profile, mode: 'assignment'),
                WorkReportTab(profile: profile),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _two(int n) => n.toString().padLeft(2, '0');
String _publishText(DateTime d) => '${ymd(d)}T${_two(d.hour)}:${_two(d.minute)}';
DateTime? _parseLocal(String? v) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})').firstMatch(v ?? '');
  if (m == null) return null;
  return DateTime(
    int.parse(m[1]!),
    int.parse(m[2]!),
    int.parse(m[3]!),
    int.parse(m[4]!),
    int.parse(m[5]!),
  );
}

DateTime _day(String ymdText) => DateTime.parse(ymdText);

/// A list of words or ids from the API (names of sections, section ids).
List<String> _strings(Object? v) => [for (final x in (v as List?) ?? const []) '$x'];

/// The day's sheet (homework and classwork, or assignments): the date, the class and its sections, then a card per
/// subject with its boxes and files; Publish on, Ask to acknowledge, Save and publish.
class WorkSheetTab extends ConsumerStatefulWidget {
  const WorkSheetTab({super.key, required this.profile, required this.mode});
  final Profile profile;

  /// `daily` (homework and classwork) or `assignment`
  final String mode;

  @override
  ConsumerState<WorkSheetTab> createState() => _WorkSheetTabState();
}

class _WorkSheetTabState extends ConsumerState<WorkSheetTab> with AutomaticKeepAliveClientMixin {
  Json? _sheet;
  String? _date;
  String? _classId;
  List<String> _chosen = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _saved;
  DateTime? _publishAt;
  bool _ack = false;
  final Map<String, TextEditingController> _text = {};
  final Map<String, String?> _due = {};
  final Map<String, List<PickedFile>> _files = {};

  bool get _assignment => widget.mode == 'assignment';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load({bool keepMessage = false}) async {
    setState(() {
      _loading = true;
      _error = null;
      if (!keepMessage) _saved = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .dailyWorkSheet(
              mode: widget.mode,
              date: _date,
              classId: _classId,
              sections: _chosen.isEmpty ? null : _chosen.join(','),
            ),
      );
      if (!mounted) return;
      for (final c in _text.values) {
        c.dispose();
      }
      _text.clear();
      _due.clear();
      _files.clear();
      for (final row in asList(r['rows'])) {
        final id = '${asJson(row['subject'])['id']}';
        for (final k in _assignment ? ['assignment'] : ['homework', 'classwork']) {
          final e = row[k] is Map ? asJson(row[k]) : null;
          _text['$k:$id'] = TextEditingController(text: e == null ? '' : '${e['text'] ?? ''}');
          if (k == 'assignment') _due[id] = e?['dueOn'] as String?;
        }
      }
      setState(() {
        _sheet = r;
        _date = '${r['date']}';
        _classId = r['classId'] == null ? null : '${r['classId']}';
        _chosen = _strings(r['chosen']);
        _publishAt = _parseLocal(r['publishAt'] as String?) ?? DateTime.now();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = errorText(ref.read(stringsProvider), e);
        _loading = false;
      });
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date == null ? now : _day(_date!),
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (d == null) return;
    _date = ymd(d);
    await _load();
  }

  Future<void> _addFile(String key, {bool camera = false}) async {
    final s = ref.read(stringsProvider);
    final maxMb = (_sheet?['maxMb'] as num?)?.toInt() ?? 10;
    PickedFile? f;
    if (camera) {
      final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 80);
      if (x == null) return;
      f = PickedFile(name: x.name, bytes: await x.readAsBytes(), contentType: 'image/jpeg');
    } else {
      final picked = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
      );
      final p = picked.firstOrNull;
      if (p == null) return;
      f = PickedFile(
        name: p.name,
        bytes: await p.readAsBytes(),
        contentType: contentTypeOf(p.name),
      );
    }
    if (f.bytes.length > maxMb * 1024 * 1024) {
      if (mounted) setState(() => _error = s.fileTooBig(maxMb));
      return;
    }
    setState(() => _files[key] = [...?_files[key], f!]);
  }

  Future<void> _pickPublish() async {
    final now = DateTime.now();
    final at = _publishAt ?? now;
    final d = await showDatePicker(
      context: context,
      initialDate: at,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(at));
    if (t == null) return;
    setState(() => _publishAt = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  Future<void> _save() async {
    final s = ref.read(stringsProvider);
    final sheet = _sheet;
    if (sheet == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _saved = null;
    });
    final api = ref.read(apiProvider);
    final t = ref.read(transportProvider);
    Future<List<String>> up(String key) async => [
      for (final f in _files[key] ?? const <PickedFile>[]) await uploadFile(api, t, f),
    ];
    try {
      final rows = <SaveSheetDtoRowsItem>[];
      for (final row in asList(sheet['rows'])) {
        final id = '${asJson(row['subject'])['id']}';
        rows.add(
          SaveSheetDtoRowsItem(
            subjectId: id,
            homework: _text['homework:$id']?.text.trim() ?? '',
            classwork: _text['classwork:$id']?.text.trim() ?? '',
            assignment: _text['assignment:$id']?.text.trim() ?? '',
            dueOn: _due[id],
            homeworkFileIds: await up('homework:$id'),
            classworkFileIds: await up('classwork:$id'),
            assignmentFileIds: await up('assignment:$id'),
          ),
        );
      }
      final r = asJson(
        await api.dailyWorkSaveSheet(
          body: SaveSheetDto(
            date: '${sheet['date']}',
            classSectionIds: _chosen,
            mode: widget.mode,
            publishAt: _publishAt == null ? null : _publishText(_publishAt!),
            ackRequired: _ack,
            rows: rows,
          ),
        ),
      );
      if (!mounted) return;
      _saved = s.savedCounts(
        (r['created'] as num?)?.toInt() ?? 0,
        (r['updated'] as num?)?.toInt() ?? 0,
      );
      await _load(keepMessage: true);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = ref.watch(stringsProvider);
    final sheet = _sheet;
    if (sheet == null) {
      return _loading
          ? Center(
              child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
            )
          : ListView(
              padding: const EdgeInsets.all(Tokens.sp4),
              children: [
                Text(_error ?? s.noClassForWork),
                const SizedBox(height: Tokens.sp3),
                OutlinedButton(onPressed: _load, child: Text(s.retry)),
              ],
            );
    }
    final classes = asList(sheet['classes']);
    final sections = [
      for (final o in asList(sheet['options']))
        if (_classId != null && '${o['classId']}' == _classId) o,
    ];
    final rows = asList(sheet['rows']);
    final all = _chosen.length;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return ListView(
      key: Key('workSheet-${widget.mode}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Wrap(
          spacing: Tokens.sp3,
          runSpacing: Tokens.sp3,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            OutlinedButton.icon(
              key: Key('sheetDate-${widget.mode}'),
              onPressed: _loading ? null : _pickDate,
              icon: const Icon(Icons.calendar_today_outlined),
              label: Text('${s.dateWord}: ${s.date(sheet['date'] ?? '')}'),
            ),
            DropdownMenu<String>(
              key: Key('sheetClass-${widget.mode}'),
              label: Text(s.classWord),
              hintText: s.selectClass,
              initialSelection: _classId,
              enabled: !_loading,
              onSelected: (v) {
                if (v == null || v == _classId) return;
                _classId = v;
                _chosen = const [];
                _load();
              },
              dropdownMenuEntries: [
                for (final c in classes)
                  DropdownMenuEntry(value: '${c['id']}', label: '${c['name']}'),
              ],
            ),
          ],
        ),
        if (sections.isNotEmpty) ...[
          const SizedBox(height: Tokens.sp3),
          Text(s.sectionsUntick, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              for (final o in sections)
                FilterChip(
                  key: Key('sheetSection-${o['classSectionId']}'),
                  label: Text('${o['section']}'),
                  selected: _chosen.contains('${o['classSectionId']}'),
                  onSelected: _loading
                      ? null
                      : (on) {
                          final id = '${o['classSectionId']}';
                          final next = on
                              ? [..._chosen, id]
                              : _chosen.where((x) => x != id).toList();
                          if (next.isEmpty) return;
                          _chosen = next;
                          _load();
                        },
                ),
            ],
          ),
        ],
        const SizedBox(height: Tokens.sp3),
        if (_saved != null) _Banner(text: _saved!, ok: true, key: const Key('sheetSaved')),
        if (_error != null) _Banner(text: _error!, ok: false, key: const Key('sheetError')),
        if (_loading) const LinearProgressIndicator(),
        if (all == 0)
          Text(
            classes.isEmpty ? s.noClassForWork : s.sheetPickClass,
            style: TextStyle(color: muted),
          )
        else if (rows.isEmpty)
          Text(s.noSubjectHere, style: TextStyle(color: muted))
        else ...[
          for (final row in rows) _subjectCard(s, asJson(row), all, muted),
          const SizedBox(height: Tokens.sp2),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.publishOn, style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: Tokens.sp1),
                  OutlinedButton.icon(
                    key: Key('sheetPublish-${widget.mode}'),
                    onPressed: _busy ? null : _pickPublish,
                    icon: const Icon(Icons.schedule),
                    label: Text(_publishAt == null ? '—' : s.dateTime(_publishAt!)),
                  ),
                  const SizedBox(height: Tokens.sp1),
                  Text(
                    s.publishHelp(sheet['publishTime'] as String?),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  SwitchListTile(
                    key: Key('sheetAck-${widget.mode}'),
                    contentPadding: EdgeInsets.zero,
                    title: Text(s.askAckSheet),
                    value: _ack,
                    onChanged: _busy ? null : (v) => setState(() => _ack = v),
                  ),
                  Text(
                    s.sheetHelp((sheet['maxMb'] as num?)?.toInt() ?? 10),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  const SizedBox(height: Tokens.sp3),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: Key('saveSheet-${widget.mode}'),
                      onPressed: _busy || _loading ? null : _save,
                      child: Text(_busy ? s.loading : s.saveAndPublish),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _subjectCard(S s, Json row, int all, Color muted) {
    final subject = asJson(row['subject']);
    final id = '${subject['id']}';
    final name = '${subject['name']}';
    final rowSections = _strings(row['sections']);
    final boxes = _assignment
        ? [('assignment', s.assignmentWord)]
        : [('homework', s.homework), ('classwork', s.classwork)];
    return Card(
      key: Key('sheetSubject-$id'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              name,
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: Tokens.fwSemibold),
            ),
            if (rowSections.length < all)
              Text(
                s.onlySections(rowSections.join(', ')),
                style: TextStyle(color: muted, fontSize: 13),
              ),
            for (final (k, label) in boxes) ...[
              const SizedBox(height: Tokens.sp3),
              TextField(
                key: Key('sheet-$k-$id'),
                controller: _text['$k:$id'],
                enabled: !_busy,
                minLines: 2,
                maxLines: 8,
                maxLength: 8000,
                buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                decoration: InputDecoration(
                  labelText: label,
                  hintText: s.enterWork(label),
                  border: const OutlineInputBorder(),
                  alignLabelWithHint: true,
                ),
              ),
              Wrap(
                spacing: Tokens.sp2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  TextButton.icon(
                    key: Key('sheetFile-$k-$id'),
                    onPressed: _busy ? null : () => _addFile('$k:$id'),
                    icon: const Icon(Icons.attach_file),
                    label: Text(s.addFile),
                  ),
                  IconButton(
                    tooltip: s.takePhoto,
                    onPressed: _busy ? null : () => _addFile('$k:$id', camera: true),
                    icon: const Icon(Icons.photo_camera_outlined),
                  ),
                  for (final f in _files['$k:$id'] ?? const <PickedFile>[])
                    InputChip(
                      label: Text(f.name, overflow: TextOverflow.ellipsis),
                      deleteButtonTooltipMessage: s.removeFile(f.name),
                      onDeleted: _busy
                          ? null
                          : () => setState(
                              () => _files['$k:$id'] = [
                                for (final x in _files['$k:$id']!)
                                  if (!identical(x, f)) x,
                              ],
                            ),
                    ),
                ],
              ),
              if (k == 'assignment')
                OutlinedButton.icon(
                  key: Key('sheetDue-$id'),
                  onPressed: _busy
                      ? null
                      : () async {
                          final from = _day('${_sheet!['date']}');
                          final d = await showDatePicker(
                            context: context,
                            initialDate: _due[id] == null ? from : _day(_due[id]!),
                            firstDate: from,
                            lastDate: from.add(const Duration(days: 366)),
                          );
                          if (d != null) setState(() => _due[id] = ymd(d));
                        },
                  icon: const Icon(Icons.event_outlined),
                  label: Text(_due[id] == null ? s.dueDate : s.dueShort(s.date(_due[id]!))),
                ),
              _posted(s, row[k] is Map ? asJson(row[k]) : null, all, muted),
            ],
          ],
        ),
      ),
    );
  }

  Widget _posted(S s, Json? e, int all, Color muted) {
    if (e == null) return const SizedBox.shrink();
    final sections = _strings(e['sections']);
    final files = asList(e['attachments']);
    return Padding(
      padding: const EdgeInsets.only(top: Tokens.sp1),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            s.postedWork(
              sections.length < all ? sections.join(', ') : null,
              (e['files'] as num?)?.toInt() ?? 0,
            ),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (files.isNotEmpty)
            Attachments(
              count: files.length,
              load: (i) => ref
                  .read(apiProvider)
                  .dailyWorkFile(id: '${files[i]['workId']}', fileId: '${files[i]['fileId']}'),
            ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({super.key, required this.text, required this.ok});
  final String text;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    final color = ok ? Tokens.statusSuccess : Theme.of(context).colorScheme.error;
    return Container(
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      padding: const EdgeInsets.all(Tokens.sp3),
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
      ),
      child: Semantics(liveRegion: true, child: Text(text)),
    );
  }
}

/// What was posted between two dates (as the website's Report): by date, class and subject — homework and classwork,
/// then assignments — with their files, when they publish, who posted and how many acknowledged; Excel and PDF.
class WorkReportTab extends ConsumerStatefulWidget {
  const WorkReportTab({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<WorkReportTab> createState() => _WorkReportTabState();
}

class _WorkReportTabState extends ConsumerState<WorkReportTab> with AutomaticKeepAliveClientMixin {
  late String _from = ymd(DateTime.now().subtract(const Duration(days: 6)));
  late String _to = ymd(DateTime.now());
  String _section = '';
  String _kind = '';
  List<Json>? _items;
  String? _error;
  bool _loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .dailyWorkList(
              from: _from,
              to: _to,
              classSectionId: _section.isEmpty ? null : _section,
              size: 200,
            ),
      );
      if (!mounted) return;
      setState(() {
        _items = [for (final x in asList(r['data'])) asJson(x)];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = errorText(ref.read(stringsProvider), e);
        _loading = false;
      });
    }
  }

  Future<void> _pick(bool from) async {
    final d = await showDatePicker(
      context: context,
      initialDate: _day(from ? _from : _to),
      firstDate: DateTime(DateTime.now().year - 2),
      lastDate: DateTime(DateTime.now().year + 1, 12, 31),
    );
    if (d == null) return;
    setState(() => from ? _from = ymd(d) : _to = ymd(d));
    await _load();
  }

  void _file(String format) {
    final s = ref.read(stringsProvider);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(
          title: s.workReportFile,
          load: () => ref
              .read(apiProvider)
              .dailyWorkReportFile(
                format: format,
                from: _from,
                to: _to,
                classSectionId: _section.isEmpty ? null : _section,
                kind: _kind.isEmpty ? null : _kind,
              ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = ref.watch(stringsProvider);
    final options = ref.watch(workOptionsProvider(widget.profile)).value?.data ?? const <Json>[];
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final items = _items ?? const <Json>[];
    return ListView(
      key: const Key('workReport'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Wrap(
          spacing: Tokens.sp3,
          runSpacing: Tokens.sp3,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            OutlinedButton.icon(
              key: const Key('reportFrom'),
              onPressed: () => _pick(true),
              icon: const Icon(Icons.calendar_today_outlined),
              label: Text('${s.fromWord}: ${s.date(_from)}'),
            ),
            OutlinedButton.icon(
              key: const Key('reportTo'),
              onPressed: () => _pick(false),
              icon: const Icon(Icons.calendar_today_outlined),
              label: Text('${s.toWord}: ${s.date(_to)}'),
            ),
            DropdownMenu<String>(
              key: const Key('reportClass'),
              label: Text(s.classWord),
              initialSelection: _section,
              onSelected: (v) {
                _section = v ?? '';
                _load();
              },
              dropdownMenuEntries: [
                DropdownMenuEntry(value: '', label: s.allMyClasses),
                for (final o in options)
                  DropdownMenuEntry(value: '${o['classSectionId']}', label: '${o['section']}'),
              ],
            ),
            DropdownMenu<String>(
              key: const Key('reportKind'),
              label: Text(s.showWord),
              initialSelection: _kind,
              onSelected: (v) => setState(() => _kind = v ?? ''),
              dropdownMenuEntries: [
                DropdownMenuEntry(value: '', label: s.showBoth),
                DropdownMenuEntry(value: 'daily', label: s.showDaily),
                DropdownMenuEntry(value: 'assignment', label: s.assignmentsTab),
              ],
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        Wrap(
          spacing: Tokens.sp2,
          children: [
            OutlinedButton.icon(
              key: const Key('reportExcel'),
              onPressed: () => _file('xlsx'),
              icon: const Icon(Icons.table_chart_outlined),
              label: const Text('Excel'),
            ),
            OutlinedButton.icon(
              key: const Key('reportPdf'),
              onPressed: () => _file('pdf'),
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: const Text('PDF'),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _Banner(text: _error!, ok: false),
        if (!_loading && _error == null) ...[
          if (_kind != 'assignment') ..._group(s, items, false, muted),
          if (_kind != 'daily') ..._group(s, items, true, muted),
        ],
      ],
    );
  }

  List<Widget> _group(S s, List<Json> items, bool assignment, Color muted) {
    final lines = <String, List<Json>>{};
    for (final it in items) {
      if (assignment != (it['kind'] == 'assignment')) continue;
      final k = '${it['assignedOn']}|${it['section']}|${it['subjectName'] ?? ''}';
      (lines[k] ??= []).add(it);
    }
    final title = assignment ? s.assignmentsTab : s.homeworkAndClasswork;
    return [
      Padding(
        padding: const EdgeInsets.only(top: Tokens.sp3, bottom: Tokens.sp2),
        child: Semantics(
          header: true,
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwSemibold),
          ),
        ),
      ),
      if (lines.isEmpty) Text(s.nothingPostedDays, style: TextStyle(color: muted)),
      for (final list in lines.values)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  [
                    s.dayShort(list.first['assignedOn'] ?? ''),
                    '${list.first['section']}',
                    if (list.first['subjectName'] != null) '${list.first['subjectName']}',
                  ].join(' · '),
                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                ),
                for (final kind in assignment ? ['assignment'] : ['homework', 'classwork'])
                  for (final x in list.where((x) => x['kind'] == kind)) _entry(s, x, kind, muted),
              ],
            ),
          ),
        ),
    ];
  }

  Widget _entry(S s, Json x, String kind, Color muted) {
    final files = asList(x['files']);
    final publish = DateTime.tryParse('${x['publishAt']}');
    final label = switch (kind) {
      'homework' => s.homework,
      'classwork' => s.classwork,
      _ => s.assignmentWord,
    };
    return Padding(
      padding: const EdgeInsets.only(top: Tokens.sp2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: muted, fontSize: 13)),
          SelectionArea(
            child: Text('${(x['body'] ?? '').toString().isNotEmpty ? x['body'] : x['title']}'),
          ),
          if (files.isNotEmpty)
            Attachments(
              count: files.length,
              load: (i) => ref
                  .read(apiProvider)
                  .dailyWorkFile(id: '${x['id']}', fileId: '${files[i]['id']}'),
            ),
          Text(
            [
              if (publish != null)
                x['scheduled'] == true
                    ? s.publishesAt(s.dateTime(publish))
                    : s.publishedAt(s.dateTime(publish)),
              if (x['postedBy'] != null) '${x['postedBy']}',
              if (x['dueOn'] != null) s.dueShort(s.date('${x['dueOn']}')),
              if (x['ackRequired'] == true) s.ackCount((x['ackCount'] as num?)?.toInt() ?? 0),
            ].join(' · '),
            style: TextStyle(color: muted, fontSize: 13),
          ),
        ],
      ),
    );
  }
}
