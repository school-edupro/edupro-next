import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../family/common.dart';
import '../family/data.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';

/// A file the person picked: its name and bytes.
typedef PickedBytes = ({String name, List<int> bytes});

/// Picks a filled .xlsx on the phone (tests put their own in its place).
final xlsxPickerProvider = Provider<Future<PickedBytes?> Function()>(
  (ref) => () async {
    final picked = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['xlsx']);
    final f = picked.firstOrNull;
    if (f == null) return null;
    return (name: f.name, bytes: await f.readAsBytes());
  },
);

/// "By Excel" for a section, as the staff website's card (docs/design/71; the app's docs/design/96 part 12):
/// download the sheet filled with what is entered (opened in the file viewer, to share or save), and — while entry
/// is open — upload the filled .xlsx: every row is checked first (rows read, ready, those with a problem and why),
/// and **Save the rows** writes them only when none has a problem.
class SheetByExcel extends ConsumerStatefulWidget {
  const SheetByExcel({
    super.key,
    required this.title,
    required this.help,
    required this.canUpload,
    required this.download,
    required this.upload,
    required this.onSaved,
    this.folded = false,
  });

  /// the downloaded file's title in the viewer
  final String title;
  final String help;
  final bool canUpload;
  final Future<ApiFile> Function() download;

  /// the file in base64; `apply` false only checks it
  final Future<dynamic> Function(String file, bool apply) upload;
  final VoidCallback onSaved;

  /// shown as one closed line that opens (Height and weight: the pupils come first)
  final bool folded;

  @override
  ConsumerState<SheetByExcel> createState() => _SheetByExcelState();
}

class _SheetByExcelState extends ConsumerState<SheetByExcel> {
  String? _file;
  Json? _preview;
  bool _busy = false;
  String? _error;
  String? _done;

  Future<void> _pick() async {
    final s = ref.read(stringsProvider);
    final f = await ref.read(xlsxPickerProvider)();
    if (f == null) return;
    final bytes = f.bytes;
    if (bytes.length > 1400000) {
      return setState(() {
        _error = s.xlTooLarge;
        _preview = null;
        _done = null;
      });
    }
    final b64 = base64Encode(bytes);
    setState(() {
      _busy = true;
      _error = null;
      _done = null;
      _preview = null;
    });
    try {
      final r = asJson(await widget.upload(b64, false));
      if (!mounted) return;
      setState(() {
        _file = b64;
        _preview = r;
      });
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(await widget.upload(_file!, true));
      if (!mounted) return;
      if (r['applied'] == true) {
        setState(() {
          _done = s.xlSaved((r['ready'] as num?)?.toInt() ?? 0);
          _preview = null;
          _file = null;
        });
        widget.onSaved();
      } else {
        setState(() => _error = s.xlNothing);
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final p = _preview;
    final rows = p == null ? const <Json>[] : asList(p['rows']).map(asJson).toList();
    final bad = rows.where((x) => '${x['error'] ?? ''}'.isNotEmpty).toList();
    final ready = (p?['ready'] as num?)?.toInt() ?? 0;
    final errors = (p?['errors'] as num?)?.toInt() ?? 0;
    final content = <Widget>[
      Text(widget.help, style: TextStyle(color: muted, fontSize: 13)),
      const SizedBox(height: Tokens.sp2),
      Wrap(
        spacing: Tokens.sp2,
        runSpacing: Tokens.sp2,
        children: [
          OutlinedButton.icon(
            key: const Key('xlDownload'),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => FileScreen(title: widget.title, load: widget.download),
              ),
            ),
            icon: const Icon(Icons.download_outlined),
            label: Text(s.xlDownload),
          ),
          if (widget.canUpload)
            OutlinedButton.icon(
              key: const Key('xlUpload'),
              onPressed: _busy ? null : _pick,
              icon: const Icon(Icons.upload_file_outlined),
              label: Text(s.xlUpload),
            ),
        ],
      ),
      if (_busy && p == null) ...[
        const SizedBox(height: Tokens.sp2),
        Text(s.xlChecking, style: TextStyle(color: muted)),
      ],
      if (p != null) ...[
        const SizedBox(height: Tokens.sp2),
        Semantics(
          liveRegion: true,
          child: Text(
            s.xlSummary(rows.length, ready, errors),
            key: const Key('xlSummary'),
            style: TextStyle(
              color: errors > 0 ? Theme.of(context).colorScheme.error : null,
              fontWeight: Tokens.fwSemibold,
            ),
          ),
        ),
        for (final x in bad.take(50))
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp1),
            child: Text(
              s.xlRowProblem(
                x['row'] ?? '',
                '${x['admissionNo'] ?? ''}',
                '${x['name'] ?? '-'}',
                '${x['error']}',
              ),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          ),
        if (errors == 0 && ready > 0) ...[
          const SizedBox(height: Tokens.sp2),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              key: const Key('xlSave'),
              onPressed: _busy ? null : _save,
              child: Text(s.xlSaveRows(ready)),
            ),
          ),
        ],
      ],
      if (_done != null) ...[
        const SizedBox(height: Tokens.sp2),
        Semantics(
          liveRegion: true,
          child: Row(
            children: [
              const Icon(Icons.check_circle_outline, color: Tokens.statusSuccess),
              const SizedBox(width: Tokens.sp2),
              Expanded(child: Text(_done!, key: const Key('xlDone'))),
            ],
          ),
        ),
      ],
      if (_error != null) ...[
        const SizedBox(height: Tokens.sp2),
        Semantics(
          liveRegion: true,
          child: Text(
            _error!,
            key: const Key('xlError'),
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      ],
    ];
    if (widget.folded) {
      // closed until opened: the screen's own entry comes first (Height and weight)
      return Card(
        key: const Key('xlCard'),
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: ExpansionTile(
          key: const Key('xlFold'),
          leading: const Icon(Icons.table_chart_outlined),
          title: Text(s.xlByExcel),
          shape: const Border(),
          collapsedShape: const Border(),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, 0, Tokens.sp3, Tokens.sp3),
          children: content,
        ),
      );
    }
    return Card(
      key: const Key('xlCard'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text(
                s.xlByExcel,
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
            ),
            const SizedBox(height: Tokens.sp1),
            ...content,
          ],
        ),
      ),
    );
  }
}
