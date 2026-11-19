import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:share_plus/share_plus.dart';

import '../api/api_transport.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'widgets.dart';

/// A file from the API — a report card, a receipt, an attachment — shown in the app (PDF pages or the picture), with
/// Save / Share in the bar (the phone's share sheet saves it to Files or sends it on).
class FileScreen extends ConsumerStatefulWidget {
  const FileScreen({super.key, required this.title, required this.load});
  final String title;
  final Future<ApiFile> Function() load;

  @override
  ConsumerState<FileScreen> createState() => _FileScreenState();
}

class _FileScreenState extends ConsumerState<FileScreen> {
  late Future<ApiFile> _file = widget.load();

  Future<void> _share(ApiFile f) => SharePlus.instance.share(
    ShareParams(
      files: [XFile.fromData(Uint8List.fromList(f.bytes), mimeType: f.contentType, name: f.name)],
      fileNameOverrides: [f.name],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return FutureBuilder<ApiFile>(
      future: _file,
      builder: (context, snap) {
        final f = snap.data;
        return Scaffold(
          appBar: AppBar(
            title: Text(widget.title),
            actions: [
              if (f != null)
                IconButton(
                  key: const Key('shareFile'),
                  tooltip: s.saveOrShare,
                  icon: const Icon(Icons.ios_share),
                  onPressed: () => _share(f),
                ),
            ],
          ),
          body: switch (snap) {
            AsyncSnapshot(hasError: true, :final error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp5),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ErrorText(
                      error is ApiException ? (error.offline ? s.offline : error.detail) : '$error',
                    ),
                    const SizedBox(height: Tokens.sp3),
                    OutlinedButton(
                      onPressed: () => setState(() => _file = widget.load()),
                      child: Text(s.retry),
                    ),
                  ],
                ),
              ),
            ),
            AsyncSnapshot(hasData: true) when f!.isPdf => PdfViewer.data(
              Uint8List.fromList(f.bytes),
              sourceName: f.name,
            ),
            AsyncSnapshot(hasData: true) when f!.isImage => InteractiveViewer(
              child: Center(child: Image.memory(Uint8List.fromList(f.bytes))),
            ),
            AsyncSnapshot(hasData: true) => Center(
              child: FilledButton.icon(
                onPressed: () => _share(f!),
                icon: const Icon(Icons.ios_share),
                label: Text(s.saveOrShare),
              ),
            ),
            _ => Center(
              child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
            ),
          },
        );
      },
    );
  }
}
