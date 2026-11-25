import 'dart:convert';

import 'package:file_picker/file_picker.dart';
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
import '../ui/paged_feed.dart';
import 'data.dart';

/// Plain text typed on the phone as the website's description (paragraphs, the characters escaped).
String _paragraphs(String text) => text
    .split('\n')
    .map((l) => l.trim())
    .where((l) => l.isNotEmpty)
    .map(
      (l) => '<p>${l.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>',
    )
    .join();

/// The report's filters and page, as the website's form and links carry them.
typedef LessonQuery = ({
  String by,
  String q,
  String from,
  String to,
  String status,
  String level,
  String record,
  String mine,
  int page,
});
const LessonQuery blankLessonQuery = (
  by: 'employee_code',
  q: '',
  from: '',
  to: '',
  status: '',
  level: '',
  record: 'active',
  mine: '',
  page: 1,
);

LessonQuery _with(
  LessonQuery f, {
  String? by,
  String? q,
  String? from,
  String? to,
  String? status,
  String? level,
  String? record,
  String? mine,
  int? page,
}) => (
  by: by ?? f.by,
  q: q ?? f.q,
  from: from ?? f.from,
  to: to ?? f.to,
  status: status ?? f.status,
  level: level ?? f.level,
  record: record ?? f.record,
  mine: mine ?? f.mine,
  page: page ?? f.page,
);

String? _opt(String v) => v.isEmpty ? null : v;

/// The classes and sections the teacher uploads lessons for; none when uploading is not part of the role.
final lessonOptionsProvider = FutureProvider.autoDispose.family<Json, Profile>((ref, p) async {
  try {
    return asJson(await ref.read(apiProvider).lessonUploadsOptions());
  } on ApiException catch (e) {
    if (e.status == 403) return const {'classes': [], 'sections': [], 'maxFiles': 0};
    rethrow;
  }
});

/// One lesson in full.
final lessonProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).lessonUploadsGet(id: id)),
);

/// Who approves whose lessons and the lists to choose from (the admin app's Approvers); null when setting it is
/// not part of the person's role (the set-up right).
final lessonRulesProvider = FutureProvider.autoDispose.family<Json?, Profile>((ref, p) async {
  try {
    return asJson(await ref.read(apiProvider).lessonUploadsRules());
  } on ApiException catch (e) {
    if (e.status == 403) return null;
    rethrow;
  }
});

/// Lesson plans as on the staff website (docs/design/96, part 7): **Upload Lesson** (the date, master class or
/// class section, the classes, the topic, a description, attachments; it goes to the approvers) and **Lesson
/// Report** (the four counts, the filters, Excel and PDF, the lessons with where each one waits; a lesson opens in
/// full with its levels, and acknowledge or reject when it waits for the teacher). For those with the set-up right
/// (as in the admin app), **Approvers**: who approves whose lessons (part 8). No web page.
class LessonPlansScreen extends ConsumerWidget {
  const LessonPlansScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final setup = ref.watch(lessonRulesProvider(profile)).value != null;
    return DefaultTabController(
      key: ValueKey('lpTabs-$setup'),
      length: setup ? 3 : 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('lpTabs'),
              tabs: [
                Tab(text: s.lpUploadTab),
                Tab(text: s.lpReportTab),
                if (setup) Tab(text: s.lpApproversTab),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _UploadTab(profile: profile),
                const LessonReportTab(),
                if (setup) LessonApproversTab(profile: profile),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({super.key, required this.text, required this.ok});
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

// ---- Upload Lesson -------------------------------------------------------------------------------------------

class _UploadTab extends ConsumerStatefulWidget {
  const _UploadTab({required this.profile});
  final Profile profile;

  @override
  ConsumerState<_UploadTab> createState() => _UploadTabState();
}

class _UploadTabState extends ConsumerState<_UploadTab> with AutomaticKeepAliveClientMixin {
  DateTime _date = DateTime.now();
  String _type = 'class';
  final Set<String> _picked = {};
  final _topic = TextEditingController();
  final _description = TextEditingController();
  final List<PickedFile> _files = [];
  bool _busy = false;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    _topic.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _add(int max, {bool camera = false}) async {
    final s = ref.read(stringsProvider);
    if (_files.length >= max) return setState(() => _error = s.lpTooMany(max));
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
    if (f.bytes.length > 10 * 1024 * 1024) return setState(() => _error = s.fileTooBig(10));
    setState(() {
      _error = null;
      _files.add(f!);
    });
  }

  Future<void> _submit() async {
    final s = ref.read(stringsProvider);
    if (_picked.isEmpty) return setState(() => _error = s.lpTickClass);
    if (_topic.text.trim().length < 2) return setState(() => _error = s.lpNeedTopic);
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      final ids = [for (final f in _files) await uploadFile(api, ref.read(transportProvider), f)];
      final description = _paragraphs(_description.text);
      final r = asJson(
        await api.lessonUploadsCreate(
          body: LessonUploadDto(
            date: ymd(_date),
            targetType: _type,
            classIds: _type == 'class' ? _picked.toList() : const [],
            sectionIds: _type == 'section' ? _picked.toList() : const [],
            topic: _topic.text.trim(),
            description: description.isEmpty ? null : description,
            fileIds: ids,
          ),
        ),
      );
      if (!mounted) return;
      final id = '${r['id']}';
      setState(() {
        _picked.clear();
        _topic.clear();
        _description.clear();
        _files.clear();
        _date = DateTime.now();
      });
      ref.read(feedRoundProvider('lessons').notifier).bump();
      // as the website: the lesson opens, saying it went for approval
      pushPage(context, s.lpRequest(id), LessonDetailScreen(id: id, notice: s.lpUploaded));
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
    final opts = ref.watch(lessonOptionsProvider(widget.profile));
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final label = Theme.of(context).textTheme.labelLarge;
    if (opts.isLoading && !opts.hasValue) {
      return Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      );
    }
    if (opts.hasError) {
      return ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [_Note(text: errorText(s, opts.error!), ok: false)],
      );
    }
    final o = opts.value ?? const <String, Object?>{};
    final list = asList(_type == 'class' ? o['classes'] : o['sections']);
    final maxFiles = (o['maxFiles'] as num?)?.toInt() ?? 2;
    return ListView(
      key: const Key('lpUpload'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        if (_error != null) _Note(text: _error!, ok: false, key: const Key('lpError')),
        Text(s.dateWord, style: label),
        const SizedBox(height: Tokens.sp1),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const Key('lpDate'),
            onPressed: _busy ? null : _pickDate,
            icon: const Icon(Icons.calendar_today_outlined),
            label: Text(s.date(_date)),
          ),
        ),
        const SizedBox(height: Tokens.sp4),
        Text(s.lpSelectType, style: label),
        const SizedBox(height: Tokens.sp1),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final (v, text) in [
              ('class', s.lpMasterClassEvery),
              ('section', s.lpClassSection),
            ])
              ChoiceChip(
                key: Key('lpType-$v'),
                label: Text(text),
                selected: _type == v,
                onSelected: _busy
                    ? null
                    : (_) => setState(() {
                        _type = v;
                        _picked.clear();
                      }),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        Text(_type == 'class' ? s.lpMasterClass : s.lpClassSection, style: label),
        const SizedBox(height: Tokens.sp1),
        if (list.isEmpty)
          Text(s.lpNoClass, style: TextStyle(color: muted))
        else
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              for (final c in list)
                FilterChip(
                  key: Key('lpPick-${c['value']}'),
                  label: Text('${c['label']}'),
                  selected: _picked.contains('${c['value']}'),
                  onSelected: _busy
                      ? null
                      : (on) => setState(
                          () => on ? _picked.add('${c['value']}') : _picked.remove('${c['value']}'),
                        ),
                ),
            ],
          ),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('lpTopic'),
          controller: _topic,
          enabled: !_busy,
          maxLength: 200,
          decoration: InputDecoration(labelText: s.lpTopicName, border: const OutlineInputBorder()),
        ),
        const SizedBox(height: Tokens.sp2),
        TextField(
          key: const Key('lpDescription'),
          controller: _description,
          enabled: !_busy,
          minLines: 4,
          maxLines: 12,
          decoration: InputDecoration(
            labelText: s.lpDescription,
            border: const OutlineInputBorder(),
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        Text(s.lpAttachmentsUpTo(maxFiles), style: TextStyle(color: muted, fontSize: 13)),
        Wrap(
          spacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton.icon(
              key: const Key('lpAddFile'),
              onPressed: _busy || _files.length >= maxFiles ? null : () => _add(maxFiles),
              icon: const Icon(Icons.attach_file),
              label: Text(s.addFile),
            ),
            IconButton(
              tooltip: s.takePhoto,
              onPressed: _busy || _files.length >= maxFiles
                  ? null
                  : () => _add(maxFiles, camera: true),
              icon: const Icon(Icons.photo_camera_outlined),
            ),
            for (final f in _files)
              InputChip(
                label: Text(f.name, overflow: TextOverflow.ellipsis),
                deleteButtonTooltipMessage: s.removeFile(f.name),
                onDeleted: _busy ? null : () => setState(() => _files.remove(f)),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            key: const Key('lpSubmit'),
            onPressed: _busy || _picked.isEmpty ? null : _submit,
            icon: const Icon(Icons.send_outlined),
            label: Text(_busy ? s.loading : s.lpSubmit),
          ),
        ),
        if (_picked.isEmpty) ...[
          const SizedBox(height: Tokens.sp1),
          Text(
            s.lpTickClass,
            key: const Key('lpTickHint'),
            style: TextStyle(color: muted, fontSize: 13),
          ),
        ],
      ],
    );
  }
}

// ---- Lesson Report -------------------------------------------------------------------------------------------

class LessonReportTab extends ConsumerStatefulWidget {
  const LessonReportTab({super.key});

  @override
  ConsumerState<LessonReportTab> createState() => _LessonReportTabState();
}

class _LessonReportTabState extends ConsumerState<LessonReportTab>
    with AutomaticKeepAliveClientMixin {
  /// what the list shows, and the filters as being chosen (Search applies them, as on the website)
  LessonQuery _f = blankLessonQuery;
  LessonQuery _edit = blankLessonQuery;
  final _keyword = TextEditingController();

  /// the filters stay open while the list loads again for them
  bool _filtersOpen = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    _keyword.dispose();
    super.dispose();
  }

  void _apply(LessonQuery f) => setState(() {
    _f = f;
    _edit = f;
    _keyword.text = f.q;
  });

  Future<void> _pickDay(bool from) async {
    final now = DateTime.now();
    final current = from ? _edit.from : _edit.to;
    final d = await showDatePicker(
      context: context,
      initialDate: current.isEmpty ? now : DateTime.parse(current),
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (d == null) return;
    setState(() => _edit = from ? _with(_edit, from: ymd(d)) : _with(_edit, to: ymd(d)));
  }

  void _file(String format) {
    final s = ref.read(stringsProvider);
    final f = _f;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(
          title: s.lpReportFile,
          load: () async {
            // the list's own answer as a file (format, wrap=1): the bytes in base64
            final r = asJson(
              await ref
                  .read(apiProvider)
                  .lessonUploadsList(
                    by: f.by,
                    q: _opt(f.q),
                    from: _opt(f.from),
                    to: _opt(f.to),
                    status: _opt(f.status),
                    level: int.tryParse(f.level),
                    record: f.record,
                    mine: _opt(f.mine),
                    format: format,
                    wrap: '1',
                  ),
            );
            return ApiFile(
              bytes: base64Decode('${r['base64'] ?? ''}'),
              contentType: '${r['contentType'] ?? 'application/octet-stream'}',
              name: '${r['filename'] ?? 'lesson-report.$format'}',
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = ref.watch(stringsProvider);
    final round = ref.watch(feedRoundProvider('lessons'));
    final f = _f;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    // the lessons for the filters: the latest 10, then 10 more as the teacher scrolls (as the staff website)
    return PagedFeed(
      key: ValueKey(
        'lpFeed-${f.by}-${f.q}-${f.from}-${f.to}-${f.status}-${f.level}-${f.record}-${f.mine}-$round',
      ),
      listKey: const Key('lpReport'),
      load: (page) async {
        try {
          return await ref
              .read(apiProvider)
              .lessonUploadsList(
                by: f.by,
                q: _opt(f.q),
                from: _opt(f.from),
                to: _opt(f.to),
                status: _opt(f.status),
                level: int.tryParse(f.level),
                record: f.record,
                mine: _opt(f.mine),
                page: page,
                size: 10,
              );
        } on ApiException catch (e) {
          // the report is not part of the role
          if (e.status == 403) {
            return {
              'data': <Object>[],
              'page': {'total': 0},
              'denied': true,
            };
          }
          rethrow;
        }
      },
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      empty: s.lpNone,
      emptyCard: Text(
        s.lpNone,
        key: const Key('lpNone'),
        style: TextStyle(color: muted),
      ),
      item: (context, r, _) => _row(s, r, muted),
      header: (_, a) {
        if (a?['denied'] == true) {
          return [
            Text(
              s.lpNotYourRole,
              key: const Key('lpNotRole'),
              style: TextStyle(color: muted),
            ),
          ];
        }
        final counts = asJson(a?['counts']);
        final office = a?['office'] == true;
        return [
          // the four counts; each shows its lessons (as the website's tiles and status tabs)
          _tiles(s, counts),
          const SizedBox(height: Tokens.sp3),
          _filters(s, office),
          const SizedBox(height: Tokens.sp3),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              OutlinedButton.icon(
                key: const Key('lpExcel'),
                onPressed: () => _file('xlsx'),
                icon: const Icon(Icons.table_chart_outlined),
                label: const Text('Excel'),
              ),
              OutlinedButton.icon(
                key: const Key('lpPdf'),
                onPressed: () => _file('pdf'),
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('PDF'),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
        ];
      },
    );
  }

  Widget _tiles(S s, Json counts) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    Widget tile(String status, String label, Color tone) {
      final selected = _f.status == status;
      final n = (counts[status.isEmpty ? 'total' : status] as num?)?.toInt() ?? 0;
      return Expanded(
        child: Semantics(
          button: true,
          selected: selected,
          child: InkWell(
            key: Key('lpTile-${status.isEmpty ? 'total' : status}'),
            borderRadius: BorderRadius.circular(Tokens.radiusMd),
            onTap: () => _apply(_with(_f, status: status, page: 1)),
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(Tokens.radiusMd),
                border: Border.all(
                  color: selected ? tone : (dark ? Tokens.mobGray700 : Tokens.borderDefault),
                  width: selected ? 2 : 1,
                ),
              ),
              // the status colour down the left side, as the website's tiles
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(width: 4, color: tone),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.all(Tokens.sp3),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(label, style: const TextStyle(fontSize: 13)),
                            Text(
                              '$n',
                              style: Theme.of(context).textTheme.titleLarge
                                  ?.copyWith(fontWeight: Tokens.fwSemibold),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            tile('', s.lpTotal, Tokens.mobCyan600),
            const SizedBox(width: Tokens.sp2),
            tile('pending', s.lpStatus('pending'), Tokens.statusWarning),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            tile('acknowledged', s.lpStatus('acknowledged'), Tokens.statusSuccess),
            const SizedBox(width: Tokens.sp2),
            tile('rejected', s.lpStatus('rejected'), Tokens.statusDanger),
          ],
        ),
      ],
    );
  }

  /// The website's filters in a fold: filter type and keyword, the dates, status, level, record status, show;
  /// Search applies them, Reset clears them.
  Widget _filters(S s, bool office) {
    Widget pick(
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
        initialSelection: value,
        onSelected: (v) => on(v ?? ''),
        dropdownMenuEntries: [for (final (v, l) in entries) DropdownMenuEntry(value: v, label: l)],
      ),
    );
    final active = [
      _f.q,
      _f.from,
      _f.to,
      _f.level,
      _f.mine,
      if (_f.record != 'active') _f.record,
    ].where((x) => x.isNotEmpty).length;
    return Card(
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        key: const Key('lpFilters'),
        initiallyExpanded: _filtersOpen,
        onExpansionChanged: (open) => _filtersOpen = open,
        title: Text(s.lpFilters),
        subtitle: active == 0 ? null : Text('$active'),
        leading: const Icon(Icons.filter_list),
        shape: const Border(),
        childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, 0, Tokens.sp3, Tokens.sp3),
        children: [
          pick('lpBy', s.lpFilterType, _edit.by, [
            for (final v in ['employee_code', 'employee', 'class', 'topic', 'any']) (v, s.lpBy(v)),
          ], (v) => setState(() => _edit = _with(_edit, by: v))),
          Padding(
            padding: const EdgeInsets.only(bottom: Tokens.sp3),
            child: TextField(
              key: const Key('lpKeyword'),
              controller: _keyword,
              maxLength: 80,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _apply(_with(_edit, q: _keyword.text.trim(), page: 1)),
              decoration: InputDecoration(
                labelText: s.lpKeyword,
                border: const OutlineInputBorder(),
                counterText: '',
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: Tokens.sp3),
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton.icon(
                  key: const Key('lpFrom'),
                  onPressed: () => _pickDay(true),
                  icon: const Icon(Icons.calendar_today_outlined),
                  label: Text('${s.lpDateFrom}: ${_edit.from.isEmpty ? '—' : s.date(_edit.from)}'),
                ),
                OutlinedButton.icon(
                  key: const Key('lpTo'),
                  onPressed: () => _pickDay(false),
                  icon: const Icon(Icons.calendar_today_outlined),
                  label: Text('${s.lpDateTo}: ${_edit.to.isEmpty ? '—' : s.date(_edit.to)}'),
                ),
              ],
            ),
          ),
          pick('lpStatus', s.lpStatusWord, _edit.status, [
            ('', s.lpAllStatus),
            for (final v in ['pending', 'acknowledged', 'rejected']) (v, s.lpStatus(v)),
          ], (v) => setState(() => _edit = _with(_edit, status: v))),
          pick('lpLevel', s.lpLevel, _edit.level, [
            ('', s.lpAllLevels),
            for (final n in [1, 2, 3]) ('$n', s.lpLevelPending(n)),
          ], (v) => setState(() => _edit = _with(_edit, level: v))),
          pick('lpRecord', s.lpRecord, _edit.record, [
            ('active', s.lpActive),
            ('deleted', s.lpDeleted),
          ], (v) => setState(() => _edit = _with(_edit, record: v.isEmpty ? 'active' : v))),
          pick('lpMine', s.showWord, _edit.mine, [
            for (final v in ['', 'approve', 'own']) (v, s.lpShow(v, office)),
          ], (v) => setState(() => _edit = _with(_edit, mine: v))),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  key: const Key('lpSearch'),
                  onPressed: () => _apply(_with(_edit, q: _keyword.text.trim(), page: 1)),
                  child: Text(s.lpSearch),
                ),
              ),
              const SizedBox(width: Tokens.sp2),
              Expanded(
                child: OutlinedButton(
                  key: const Key('lpReset'),
                  onPressed: () => _apply(blankLessonQuery),
                  child: Text(s.lpReset),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _row(S s, Json r, Color muted) {
    final id = '${r['id']}';
    final status = '${r['status']}';
    final myTurn = r['myTurn'] == true;
    final files = (r['files'] as num?)?.toInt() ?? 0;
    void open() => pushPage(context, s.lpRequest(id), LessonDetailScreen(id: id));
    return Card(
      key: Key('lpRow-$id'),
      child: InkWell(
        onTap: open,
        borderRadius: BorderRadius.circular(Tokens.radiusMd),
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
                  Text('#$id', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                  StatusChip(s.lpStatus(status), _tone(status)),
                  if (r['deleted'] == true) StatusChip(s.lpDeleted, Tone.neutral),
                ],
              ),
              const SizedBox(height: Tokens.sp1),
              Text(
                '${r['topic']}',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
              Text(
                [
                  '${r['employee']}',
                  '${r['employeeCode']}',
                  if ('${r['department'] ?? ''}'.isNotEmpty) '${r['department']}',
                ].join(' · '),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              Text(
                [
                  '${s.classWord}: ${r['classes']}',
                  s.date(DateTime.parse('${r['requestedAt']}').toLocal()),
                  if (files > 0) s.lpFiles(files),
                ].join(' · '),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              if (status == 'pending') ...[
                const SizedBox(height: Tokens.sp1),
                Text(
                  '${s.lpLevelOf((r['currentLevel'] as num?)?.toInt() ?? 1, (r['levels'] as num?)?.toInt() ?? 1)}'
                  ' · ${r['approver'] ?? '—'}',
                  style: const TextStyle(fontWeight: Tokens.fwSemibold, fontSize: 13),
                ),
              ],
              Align(
                alignment: Alignment.centerRight,
                child: myTurn
                    ? FilledButton(
                        key: Key('lpOpen-$id'),
                        // a normal-size button (the app's filled buttons are full width)
                        style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                        onPressed: open,
                        child: Text(s.lpReview),
                      )
                    : OutlinedButton(key: Key('lpOpen-$id'), onPressed: open, child: Text(s.view)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Tone _tone(String status) => switch (status) {
  'acknowledged' => Tone.success,
  'rejected' => Tone.danger,
  'pending' => Tone.warning,
  _ => Tone.neutral,
};

// ---- one lesson -----------------------------------------------------------------------------------------------

/// One lesson in full, as the website's: what was uploaded and its attachments, the levels it goes through, and
/// (when it waits for the teacher) acknowledge or reject; the teacher's own lesson nobody acted on can be deleted.
class LessonDetailScreen extends ConsumerStatefulWidget {
  const LessonDetailScreen({super.key, required this.id, this.notice});
  final String id;

  /// said on top when the lesson was just uploaded
  final String? notice;

  @override
  ConsumerState<LessonDetailScreen> createState() => _LessonDetailScreenState();
}

class _LessonDetailScreenState extends ConsumerState<LessonDetailScreen> {
  final _remark = TextEditingController();
  late String? _notice = widget.notice;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _remark.dispose();
    super.dispose();
  }

  Future<void> _decide(String action) async {
    final s = ref.read(stringsProvider);
    final remark = _remark.text.trim();
    if (action == 'reject' && remark.isEmpty) return setState(() => _error = s.lpNeedRemark);
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await ref
          .read(apiProvider)
          .lessonUploadsDecide(
            id: widget.id,
            body: LessonDecideDto(action: action, remark: remark.isEmpty ? null : remark),
          );
      if (!mounted) return;
      _remark.clear();
      setState(() => _notice = action == 'reject' ? s.lpRejectedDone : s.lpAcknowledgedDone);
      ref.invalidate(lessonProvider(widget.id));
      ref.read(feedRoundProvider('lessons').notifier).bump();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(String topic) async {
    final s = ref.read(stringsProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.lpDeleteAsk(topic)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(
            key: const Key('lpDeleteYes'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(s.remove),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).lessonUploadsRemove(id: widget.id);
      if (!mounted) return;
      ref.read(feedRoundProvider('lessons').notifier).bump();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.lpDeletedDone)));
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final lesson = ref.watch(lessonProvider(widget.id));
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return lesson.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [_Note(text: errorText(s, e), ok: false)],
      ),
      data: (l) => _body(s, l, muted),
    );
  }

  Widget _body(S s, Json l, Color muted) {
    final status = '${l['status']}';
    final current = (l['currentLevel'] as num?)?.toInt() ?? 1;
    final levels = (l['levels'] as num?)?.toInt() ?? 1;
    final approvals = [for (final a in asList(l['approvals'])) asJson(a)];
    final untouched = approvals.every((a) => a['state'] == 'pending');
    final deleted = l['deleted'] == true;
    final files = [for (final x in (l['fileIds'] as List?) ?? const []) '$x'];
    final description = plainText('${l['description'] ?? ''}').trim();
    final head = Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwSemibold);
    Widget fact(String label, String value) => Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: muted, fontSize: 13)),
          Text(value),
        ],
      ),
    );
    return ListView(
      key: const Key('lpDetail'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        if (_notice != null) _Note(text: _notice!, ok: true, key: const Key('lpNotice')),
        if (_error != null) _Note(text: _error!, ok: false, key: const Key('lpDetailError')),
        Semantics(
          header: true,
          child: Text('${l['topic']}', style: Theme.of(context).textTheme.titleLarge),
        ),
        const SizedBox(height: Tokens.sp1),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp1,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            StatusChip(s.lpStatus(status), _tone(status)),
            if (status == 'pending')
              Text(
                '${s.lpLevelOf(current, levels)} · ${l['approver'] ?? '—'}',
                style: TextStyle(color: muted, fontSize: 13),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(header: true, child: Text(s.lpLesson, style: head)),
                const SizedBox(height: Tokens.sp2),
                fact(
                  s.lpEmployee,
                  '${l['employee']} (${l['employeeCode']})'
                  '${'${l['department'] ?? ''}'.isNotEmpty ? ' · ${l['department']}' : ''}',
                ),
                fact(s.lpLessonDate, s.date('${l['date']}')),
                fact(s.classWord, '${l['classes']}'),
                fact(s.lpRequested, s.dateTime(DateTime.parse('${l['requestedAt']}').toLocal())),
                const Divider(),
                if (description.isEmpty)
                  Text(s.lpNoDescription, style: TextStyle(color: muted))
                else
                  SelectionArea(child: Text(description, key: const Key('lpDescriptionText'))),
                if (files.isNotEmpty) ...[
                  const SizedBox(height: Tokens.sp3),
                  Text(s.lpAttachments, style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: Tokens.sp1),
                  Attachments(
                    count: files.length,
                    load: (i) =>
                        ref.read(apiProvider).lessonUploadsFile(id: widget.id, fileId: files[i]),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(header: true, child: Text(s.lpApproval, style: head)),
                const SizedBox(height: Tokens.sp1),
                Text(
                  s.lpRule(l['ruleScope'] as String?),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                const SizedBox(height: Tokens.sp2),
                for (final a in approvals) _level(s, a, status, current, muted),
                if (l['myTurn'] == true && !deleted) ...[
                  const SizedBox(height: Tokens.sp3),
                  TextField(
                    key: const Key('lpRemark'),
                    controller: _remark,
                    enabled: !_busy,
                    maxLength: 500,
                    decoration: InputDecoration(
                      labelText: s.lpRemarkReject,
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          key: const Key('lpAcknowledge'),
                          onPressed: _busy ? null : () => _decide('acknowledge'),
                          icon: const Icon(Icons.check),
                          label: Text(s.lpAcknowledge),
                        ),
                      ),
                      const SizedBox(width: Tokens.sp2),
                      Expanded(
                        child: OutlinedButton.icon(
                          key: const Key('lpReject'),
                          onPressed: _busy ? null : () => _decide('reject'),
                          icon: const Icon(Icons.close),
                          label: Text(s.lpReject),
                        ),
                      ),
                    ],
                  ),
                ],
                if (!deleted && l['mine'] == true && untouched) ...[
                  const SizedBox(height: Tokens.sp2),
                  TextButton.icon(
                    key: const Key('lpDelete'),
                    onPressed: _busy ? null : () => _delete('${l['topic']}'),
                    icon: const Icon(Icons.delete_outline),
                    label: Text(s.lpDelete),
                  ),
                ],
                if (deleted) ...[
                  const SizedBox(height: Tokens.sp2),
                  Text(s.lpWasDeleted, style: TextStyle(color: muted)),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// A level: who approves (a person, or anyone with a role), where it stands, by whom and when, the remark.
  Widget _level(S s, Json a, String status, int current, Color muted) {
    final level = (a['level'] as num?)?.toInt() ?? 0;
    final state = '${a['state']}';
    final (word, tone) = state != 'pending'
        ? (s.lpStatus(state), _tone(state))
        : status == 'pending' && level == current
        ? (s.lpWaiting, Tone.warning)
        : status == 'pending'
        ? (s.lpNotReached, Tone.neutral)
        : ('–', Tone.neutral);
    final acted = a['actedAt'] != null
        ? '${a['actedBy'] ?? ''} · ${s.dateTime(DateTime.parse('${a['actedAt']}').toLocal())}'
        : null;
    return Container(
      key: Key('lpLevel-$level'),
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
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(s.lpLevelN(level), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              StatusChip(word, tone),
            ],
          ),
          Text('${a['approver']}${a['byRole'] == true ? ' (${s.lpAnyoneWithRole})' : ''}'),
          if (acted != null) Text(acted, style: TextStyle(color: muted, fontSize: 13)),
          if (a['remark'] != null)
            Text('${s.remarkWord}: ${a['remark']}', style: TextStyle(color: muted, fontSize: 13)),
        ],
      ),
    );
  }
}

// ---- Approvers ------------------------------------------------------------------------------------------------

/// Who approves whose lessons, as the admin app's Approvers: the rules (the school default, a department, a class,
/// an employee — up to three levels, each a person or anyone with a role) with Remove, and Add or replace a rule.
class LessonApproversTab extends ConsumerStatefulWidget {
  const LessonApproversTab({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<LessonApproversTab> createState() => _LessonApproversTabState();
}

class _LessonApproversTabState extends ConsumerState<LessonApproversTab>
    with AutomaticKeepAliveClientMixin {
  String _scope = 'default';
  String _department = '';
  String _classId = '';
  String _employeeId = '';

  /// each level: `role:<code>`, `emp:<id>` or empty (no such level)
  final List<String> _levels = ['', '', ''];

  /// a new number empties the form's boxes after a save
  int _version = 0;
  bool _busy = false;
  String? _error;
  String? _notice;

  @override
  bool get wantKeepAlive => true;

  Future<void> _save() async {
    final s = ref.read(stringsProvider);
    final missing = switch (_scope) {
      'department' when _department.isEmpty => s.lpChooseDepartment,
      'class' when _classId.isEmpty => s.lpChooseClass,
      'employee' when _employeeId.isEmpty => s.lpChooseEmployee,
      _ when _levels[0].isEmpty => s.lpChooseLevel1,
      _ => null,
    };
    if (missing != null) {
      return setState(() {
        _error = missing;
        _notice = null;
      });
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await ref
          .read(apiProvider)
          .lessonUploadsSaveRule(
            body: LessonRuleDto(
              scope: _scope,
              employeeId: _scope == 'employee' ? _employeeId : null,
              classId: _scope == 'class' ? _classId : null,
              department: _scope == 'department' ? _department : null,
              levels: [
                for (final v in _levels)
                  if (v.startsWith('role:'))
                    LessonRuleDtoLevelsItem(kind: 'role', roleCode: v.substring(5))
                  else if (v.startsWith('emp:'))
                    LessonRuleDtoLevelsItem(kind: 'employee', employeeId: v.substring(4)),
              ],
            ),
          );
      if (!mounted) return;
      setState(() {
        _notice = s.lpRuleSaved;
        _scope = 'default';
        _department = '';
        _classId = '';
        _employeeId = '';
        _levels.setAll(0, ['', '', '']);
        _version++;
      });
      ref.invalidate(lessonRulesProvider(widget.profile));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(Json rule, String label) async {
    final s = ref.read(stringsProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.lpRemoveRuleAsk(label)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(
            key: const Key('lpRuleRemoveYes'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(s.remove),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await ref.read(apiProvider).lessonUploadsRemoveRule(id: '${rule['id']}');
      if (!mounted) return;
      setState(() => _notice = s.lpRuleRemoved);
      ref.invalidate(lessonRulesProvider(widget.profile));
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
    final data = ref.watch(lessonRulesProvider(widget.profile)).value ?? const <String, Object?>{};
    final rules = [for (final r in asList(data['data'])) asJson(r)];
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final head = Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwSemibold);
    final roles = [for (final r in asList(data['roles'])) asJson(r)];
    final employees = [for (final e in asList(data['employees'])) asJson(e)];
    // who can approve a level: a role (anyone with it) or a person
    final who = [
      for (final r in roles) ('role:${r['value']}', s.lpRole('${r['label']}')),
      for (final e in employees) ('emp:${e['value']}', '${e['label']}'),
    ];
    Widget pick(
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
        initialSelection: value,
        // type to find (a long list of staff); the arrow that opens the list says which list it is
        enableFilter: true,
        trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: label),
        selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: label),
        requestFocusOnTap: true,
        menuHeight: 320,
        enabled: !_busy,
        onSelected: (v) => on(v ?? ''),
        dropdownMenuEntries: [for (final (v, l) in entries) DropdownMenuEntry(value: v, label: l)],
      ),
    );
    return ListView(
      key: const Key('lpApprovers'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        if (_notice != null) _Note(text: _notice!, ok: true, key: const Key('lpRuleNotice')),
        if (_error != null) _Note(text: _error!, ok: false, key: const Key('lpRuleError')),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(header: true, child: Text(s.lpRulesTitle, style: head)),
                const SizedBox(height: Tokens.sp1),
                Text(s.lpRulesHelp, style: TextStyle(color: muted, fontSize: 13)),
                const SizedBox(height: Tokens.sp3),
                if (rules.isEmpty)
                  Text(
                    s.lpNoRule,
                    key: const Key('lpNoRule'),
                    style: TextStyle(color: muted),
                  )
                else
                  for (final r in rules) _rule(s, r, muted),
              ],
            ),
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: KeyedSubtree(
              key: ValueKey('lpRuleForm-$_version'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(header: true, child: Text(s.lpAddRule, style: head)),
                  const SizedBox(height: Tokens.sp1),
                  Text(s.lpAddRuleHelp, style: TextStyle(color: muted, fontSize: 13)),
                  const SizedBox(height: Tokens.sp3),
                  Text(s.lpRuleFor, style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: Tokens.sp1),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp2,
                    children: [
                      for (final v in ['default', 'department', 'class', 'employee'])
                        ChoiceChip(
                          key: Key('lpScope-$v'),
                          label: Text(s.lpRuleForOption(v)),
                          selected: _scope == v,
                          onSelected: _busy ? null : (_) => setState(() => _scope = v),
                        ),
                    ],
                  ),
                  const SizedBox(height: Tokens.sp3),
                  // only the box the rule is for
                  if (_scope == 'department')
                    pick('lpRuleDept', s.lpDepartment, _department, [
                      for (final d in asList(data['departments'])) ('$d', '$d'),
                    ], (v) => setState(() => _department = v)),
                  if (_scope == 'class')
                    pick('lpRuleClass', s.classWord, _classId, [
                      for (final c in asList(data['classes']))
                        ('${asJson(c)['value']}', '${asJson(c)['label']}'),
                    ], (v) => setState(() => _classId = v)),
                  if (_scope == 'employee')
                    pick('lpRuleEmployee', s.lpEmployee, _employeeId, [
                      for (final e in employees) ('${e['value']}', '${e['label']}'),
                    ], (v) => setState(() => _employeeId = v)),
                  for (var n = 1; n <= 3; n++)
                    pick(
                      'lpRuleLevel-$n',
                      n == 1 ? '${s.lpLevelApprover(1)} *' : s.lpLevelApprover(n),
                      _levels[n - 1],
                      [if (n > 1) ('', s.lpNoOne), ...who],
                      (v) => setState(() => _levels[n - 1] = v),
                    ),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      key: const Key('lpSaveRule'),
                      onPressed: _busy ? null : _save,
                      icon: const Icon(Icons.save_outlined),
                      label: Text(_busy ? s.loading : s.lpSaveRule),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// A rule: what it is for, whose lessons, the approver of each level; Remove (asked first).
  Widget _rule(S s, Json r, Color muted) {
    final scope = '${r['scope']}';
    final label = scope == 'default' ? s.lpEveryoneElse : '${r['label']}';
    final levels = [for (final l in asList(r['levels'])) asJson(l)];
    return Container(
      key: Key('lpRule-${r['id']}'),
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
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusChip(s.lpScope(scope), scope == 'default' ? Tone.neutral : Tone.info),
              Text(label, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
            ],
          ),
          const SizedBox(height: Tokens.sp1),
          for (var n = 1; n <= 3; n++)
            Text(
              '${s.lpLevelN(n)}: ${levels.where((l) => l['level'] == n).firstOrNull?['label'] ?? '–'}',
              style: TextStyle(color: n == 1 ? null : muted, fontSize: 13),
            ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              key: Key('lpRuleRemove-${r['id']}'),
              onPressed: _busy ? null : () => _remove(r, label),
              icon: const Icon(Icons.delete_outline),
              label: Text(s.remove),
            ),
          ),
        ],
      ),
    );
  }
}
