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
import '../ui/paged_feed.dart';
import 'data.dart';

/// The kinds a teacher uploads (the website's Upload), and the ones the list also shows (the school's own).
const _uploadKinds = ['session_plan', 'curriculum', 'date_sheet', 'other'];
const _listKinds = [..._uploadKinds, 'magazine', 'almanac'];

String _two(int n) => n.toString().padLeft(2, '0');
String _localText(DateTime d) => '${ymd(d)}T${_two(d.hour)}:${_two(d.minute)}';

/// Plain text typed on the phone as the website's remark (paragraphs, the characters escaped).
String _remarkHtml(String text) => text
    .split('\n')
    .map((l) => l.trim())
    .where((l) => l.isNotEmpty)
    .map(
      (l) => '<p>${l.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>',
    )
    .join();

/// Session plan, curriculum, date sheet as on the staff website (docs/design/96, part 3): **Upload** for the classes
/// the teacher holds (what, classes, title, remark, files, publish on, acknowledge), and **Uploaded** — the list with
/// its filters, files, who acknowledged, Remove, Excel and PDF. No web page.
class StaffDocumentsScreen extends ConsumerWidget {
  const StaffDocumentsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('docsTabs'),
              tabs: [
                Tab(text: s.docsUploadTab),
                Tab(text: s.docsUploadedTab),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _UploadTab(profile: profile),
                DocumentsListTab(profile: profile),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _UploadTab extends ConsumerStatefulWidget {
  const _UploadTab({required this.profile});
  final Profile profile;

  @override
  ConsumerState<_UploadTab> createState() => _UploadTabState();
}

class _UploadTabState extends ConsumerState<_UploadTab> with AutomaticKeepAliveClientMixin {
  String _kind = 'session_plan';
  final Set<String> _sections = {};
  final _title = TextEditingController();
  final _remark = TextEditingController();
  final List<PickedFile> _files = [];
  DateTime _publish = DateTime.now();
  bool _ack = false;
  bool _busy = false;
  String? _error;
  String? _done;

  @override
  bool get wantKeepAlive => true;

  @override
  void dispose() {
    _title.dispose();
    _remark.dispose();
    super.dispose();
  }

  Future<void> _add({bool camera = false}) async {
    final s = ref.read(stringsProvider);
    if (_files.length >= 5) return setState(() => _error = s.docsTooMany);
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

  Future<void> _pickPublish() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _publish,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_publish));
    if (t == null) return;
    setState(() => _publish = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  Future<void> _upload() async {
    final s = ref.read(stringsProvider);
    if (_sections.isEmpty) return setState(() => _error = s.docsNeedClass);
    if (_title.text.trim().length < 2) return setState(() => _error = s.docsNeedTitle);
    if (_files.isEmpty) return setState(() => _error = s.docsNeedFile);
    setState(() {
      _busy = true;
      _error = null;
      _done = null;
    });
    final api = ref.read(apiProvider);
    try {
      final ids = [for (final f in _files) await uploadFile(api, ref.read(transportProvider), f)];
      final remark = _remarkHtml(_remark.text);
      await api.documentsCreate(
        body: CreateDocumentDto(
          kind: _kind,
          title: _title.text.trim(),
          remark: remark.isEmpty ? null : remark,
          classSectionIds: _sections.toList(),
          fileIds: ids,
          publishAt: _localText(_publish),
          ackRequired: _ack,
        ),
      );
      if (!mounted) return;
      setState(() {
        _done = s.uploadedDone;
        _title.clear();
        _remark.clear();
        _files.clear();
        _ack = false;
        _publish = DateTime.now();
      });
      ref.read(feedRoundProvider('documents').notifier).bump();
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
    final opts = ref.watch(workOptionsProvider(widget.profile));
    final sections = opts.value?.data ?? const <Json>[];
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    if (opts.isLoading && sections.isEmpty) {
      return Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      );
    }
    if (sections.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [Text(s.noClassThisSession, style: TextStyle(color: muted))],
      );
    }
    return ListView(
      key: const Key('docsUpload'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        if (_done != null) _Note(text: _done!, ok: true, key: const Key('docsDone')),
        if (_error != null) _Note(text: _error!, ok: false, key: const Key('docsError')),
        Text(s.whatWord, style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: Tokens.sp1),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final k in _uploadKinds)
              ChoiceChip(
                key: Key('docKind-$k'),
                label: Text(s.docKind(k)),
                selected: _kind == k,
                onSelected: _busy ? null : (_) => setState(() => _kind = k),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        Text(s.docClasses, style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: Tokens.sp1),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final o in sections)
              FilterChip(
                key: Key('docSection-${o['classSectionId']}'),
                label: Text('${o['section']}'),
                selected: _sections.contains('${o['classSectionId']}'),
                onSelected: _busy
                    ? null
                    : (on) => setState(
                        () => on
                            ? _sections.add('${o['classSectionId']}')
                            : _sections.remove('${o['classSectionId']}'),
                      ),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('docTitle'),
          controller: _title,
          enabled: !_busy,
          maxLength: 200,
          decoration: InputDecoration(labelText: s.workTitle, border: const OutlineInputBorder()),
        ),
        const SizedBox(height: Tokens.sp2),
        TextField(
          key: const Key('docRemark'),
          controller: _remark,
          enabled: !_busy,
          minLines: 3,
          maxLines: 8,
          decoration: InputDecoration(
            labelText: s.remarkWord,
            border: const OutlineInputBorder(),
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        Text(s.docsFilesHelp, style: TextStyle(color: muted, fontSize: 13)),
        Wrap(
          spacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton.icon(
              key: const Key('docAddFile'),
              onPressed: _busy ? null : _add,
              icon: const Icon(Icons.attach_file),
              label: Text(s.addFile),
            ),
            IconButton(
              tooltip: s.takePhoto,
              onPressed: _busy ? null : () => _add(camera: true),
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
        Text(s.publishOn, style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: Tokens.sp1),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const Key('docPublish'),
            onPressed: _busy ? null : _pickPublish,
            icon: const Icon(Icons.schedule),
            label: Text(s.dateTime(_publish)),
          ),
        ),
        SwitchListTile(
          key: const Key('docAck'),
          contentPadding: EdgeInsets.zero,
          title: Text(s.askAckSheet),
          value: _ack,
          onChanged: _busy ? null : (v) => setState(() => _ack = v),
        ),
        const SizedBox(height: Tokens.sp2),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            key: const Key('docUpload'),
            onPressed: _busy ? null : _upload,
            icon: const Icon(Icons.upload_outlined),
            label: Text(_busy ? s.loading : s.uploadWord),
          ),
        ),
      ],
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

/// The filters of the Uploaded list.
typedef DocsFilter = ({String kind, String section, String from, String to});

class DocumentsListTab extends ConsumerStatefulWidget {
  const DocumentsListTab({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<DocumentsListTab> createState() => _DocumentsListTabState();
}

class _DocumentsListTabState extends ConsumerState<DocumentsListTab>
    with AutomaticKeepAliveClientMixin {
  DocsFilter _f = (kind: '', section: '', from: '', to: '');

  @override
  bool get wantKeepAlive => true;

  Future<void> _pickDay(bool from) async {
    final now = DateTime.now();
    final current = from ? _f.from : _f.to;
    final d = await showDatePicker(
      context: context,
      initialDate: current.isEmpty ? now : DateTime.parse(current),
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (d == null) return;
    setState(
      () => _f = from
          ? (kind: _f.kind, section: _f.section, from: ymd(d), to: _f.to)
          : (kind: _f.kind, section: _f.section, from: _f.from, to: ymd(d)),
    );
  }

  void _report(String format) {
    final s = ref.read(stringsProvider);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(
          title: s.docsReportFile,
          load: () => ref
              .read(apiProvider)
              .documentsDocumentsReport(
                format: format,
                kind: _f.kind.isEmpty ? null : _f.kind,
                classSectionId: _f.section.isEmpty ? null : _f.section,
                from: _f.from.isEmpty ? null : _f.from,
                to: _f.to.isEmpty ? null : _f.to,
              ),
        ),
      ),
    );
  }

  Future<void> _remove(Json d) async {
    final s = ref.read(stringsProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.removeDocAsk('${d['title']}')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(
            key: const Key('docRemoveYes'),
            onPressed: () => Navigator.pop(c, true),
            child: Text(s.remove),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(apiProvider).documentsRemove(id: '${d['id']}');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.removedDone)));
      ref.read(feedRoundProvider('documents').notifier).bump();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final s = ref.watch(stringsProvider);
    final sections = ref.watch(workOptionsProvider(widget.profile)).value?.data ?? const <Json>[];
    final round = ref.watch(feedRoundProvider('documents'));
    final f = _f;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    // the documents the teacher's classes have (the website's Uploaded): the latest 10, then 10 more as they scroll
    return PagedFeed(
      key: ValueKey('docsFeed-${f.kind}-${f.section}-${f.from}-${f.to}-$round'),
      listKey: const Key('docsList'),
      load: (page) => ref
          .read(apiProvider)
          .documentsList(
            kind: f.kind.isEmpty ? null : f.kind,
            classSectionId: f.section.isEmpty ? null : f.section,
            from: f.from.isEmpty ? null : f.from,
            to: f.to.isEmpty ? null : f.to,
            page: page,
            size: 10,
          ),
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      empty: s.nothingUploaded,
      emptyCard: Text(s.nothingUploaded, style: TextStyle(color: muted)),
      item: (context, d, _) => _docCard(s, d, muted),
      header: (_, _) => [
        Wrap(
          spacing: Tokens.sp3,
          runSpacing: Tokens.sp3,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            DropdownMenu<String>(
              key: const Key('docsKind'),
              label: Text(s.whatWord),
              initialSelection: _f.kind,
              onSelected: (v) => setState(
                () => _f = (kind: v ?? '', section: _f.section, from: _f.from, to: _f.to),
              ),
              dropdownMenuEntries: [
                DropdownMenuEntry(value: '', label: s.allDocKinds),
                for (final k in _listKinds) DropdownMenuEntry(value: k, label: s.docKind(k)),
              ],
            ),
            DropdownMenu<String>(
              key: const Key('docsClass'),
              label: Text(s.classWord),
              initialSelection: _f.section,
              onSelected: (v) =>
                  setState(() => _f = (kind: _f.kind, section: v ?? '', from: _f.from, to: _f.to)),
              dropdownMenuEntries: [
                DropdownMenuEntry(value: '', label: s.allMyClasses),
                for (final o in sections)
                  DropdownMenuEntry(value: '${o['classSectionId']}', label: '${o['section']}'),
              ],
            ),
            OutlinedButton.icon(
              key: const Key('docsFrom'),
              onPressed: () => _pickDay(true),
              icon: const Icon(Icons.calendar_today_outlined),
              label: Text('${s.publishedFrom}: ${_f.from.isEmpty ? '—' : s.date(_f.from)}'),
            ),
            OutlinedButton.icon(
              key: const Key('docsTo'),
              onPressed: () => _pickDay(false),
              icon: const Icon(Icons.calendar_today_outlined),
              label: Text('${s.toWord}: ${_f.to.isEmpty ? '—' : s.date(_f.to)}'),
            ),
            if (_f.from.isNotEmpty || _f.to.isNotEmpty)
              TextButton(
                onPressed: () =>
                    setState(() => _f = (kind: _f.kind, section: _f.section, from: '', to: '')),
                child: Text(s.clearWord),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        Wrap(
          spacing: Tokens.sp2,
          children: [
            OutlinedButton.icon(
              key: const Key('docsExcel'),
              onPressed: () => _report('xlsx'),
              icon: const Icon(Icons.table_chart_outlined),
              label: const Text('Excel'),
            ),
            OutlinedButton.icon(
              key: const Key('docsPdf'),
              onPressed: () => _report('pdf'),
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: const Text('PDF'),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
      ],
    );
  }

  Widget _docCard(S s, Json d, Color muted) {
    final id = '${d['id']}';
    final files = [for (final x in (d['fileIds'] as List?) ?? const []) '$x'];
    final remark = plainText('${d['remark'] ?? ''}').trim();
    final publish = DateTime.tryParse('${d['publishAt']}');
    final section = d['section'] as String?;
    return Card(
      key: Key('doc-$id'),
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
                StatusChip(s.docKind('${d['kind']}'), Tone.neutral),
                if (d['scheduled'] == true) StatusChip(s.scheduledWord, Tone.warning),
                if (section != null)
                  Text(
                    [section, if (d['subject'] != null) '${d['subject']}'].join(' · '),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
              ],
            ),
            const SizedBox(height: Tokens.sp1),
            Text(
              '${d['title']}',
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: Tokens.fwSemibold),
            ),
            if (remark.isNotEmpty) SelectionArea(child: Text(remark)),
            if (files.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Attachments(
                count: files.length,
                load: (i) => ref.read(apiProvider).documentsFile(id: id, fileId: files[i]),
              ),
            ],
            const SizedBox(height: Tokens.sp2),
            Text(
              [
                if (publish != null)
                  d['scheduled'] == true
                      ? s.publishesAt(s.dateTime(publish))
                      : s.publishedAt(s.dateTime(publish)),
                if (d['postedBy'] != null) '${d['postedBy']}',
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            Wrap(
              spacing: Tokens.sp2,
              children: [
                if (d['ackRequired'] == true && section != null)
                  TextButton.icon(
                    key: Key('docAcks-$id'),
                    onPressed: () => pushPage(context, s.whoAcknowledged, _AcksScreen(id: id)),
                    icon: const Icon(Icons.how_to_reg_outlined),
                    label: Text(s.ackCount((d['ackCount'] as num?)?.toInt() ?? 0)),
                  ),
                if (section != null)
                  TextButton.icon(
                    key: Key('docRemove-$id'),
                    onPressed: () => _remove(d),
                    icon: const Icon(Icons.delete_outline),
                    label: Text(s.remove),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Who acknowledged a document: every pupil of the class, acknowledged (when, by whom) or not yet.
class _AcksScreen extends ConsumerWidget {
  const _AcksScreen({required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return FutureBuilder<dynamic>(
      future: ref.read(apiProvider).documentsAckStatus(type: 'document', id: id),
      builder: (context, snap) {
        if (snap.hasError) {
          return Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Text(errorText(s, snap.error!)),
          );
        }
        if (!snap.hasData) {
          return Center(
            child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
          );
        }
        final r = asJson(snap.data);
        final rows = asList(r['data']);
        return ListView(
          key: const Key('docAcksList'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              '${r['title'] ?? ''}',
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: Tokens.fwSemibold),
            ),
            Text(
              s.acknowledgedOf(
                (r['acknowledged'] as num?)?.toInt() ?? 0,
                (r['total'] as num?)?.toInt() ?? 0,
              ),
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: Tokens.sp2),
            for (final x in rows)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('${x['name']}'),
                subtitle: Text(
                  [
                    if (x['rollNo'] != null) '#${x['rollNo']}',
                    if (x['ackedAt'] != null) s.dateTime(DateTime.parse('${x['ackedAt']}')),
                    if (x['by'] != null) '${x['by']}',
                  ].join(' · '),
                ),
                trailing: StatusChip(
                  x['ackedAt'] != null ? s.ackYes : s.ackNotYet,
                  x['ackedAt'] != null ? Tone.success : Tone.warning,
                ),
              ),
          ],
        );
      },
    );
  }
}
