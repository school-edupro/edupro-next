import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../family/data.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// docs/design/98: the office reopened this section's area (indicators, remarks, exam attendance, height and weight)
/// while the exam is locked — until when and why, as the staff website's note, and for the class teacher **Done —
/// close entry** (asked once more): it locks again with the rest of the exam; what was saved stays.
class AreaEntryNote extends ConsumerStatefulWidget {
  const AreaEntryNote({
    super.key,
    required this.examId,
    required this.sectionId,
    required this.area,
    required this.entry,
    required this.onClosed,
    this.label = false,
  });
  final String examId;
  final String sectionId;

  /// indicators · remarks · attendance · health
  final String area;

  /// the sheet's `entry[area]`: locked, locks, open {until, reason, openedBy}, canClose
  final Json? entry;
  final VoidCallback onClosed;

  /// name the area (the register shows several)
  final bool label;

  @override
  ConsumerState<AreaEntryNote> createState() => _AreaEntryNoteState();
}

class _AreaEntryNoteState extends ConsumerState<AreaEntryNote> {
  bool _busy = false;

  Future<void> _done() async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(s.aeDone),
        content: Text(s.aeDoneBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(
            key: const Key('aeConfirm'),
            style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
            onPressed: () => Navigator.pop(c, true),
            child: Text(s.aeClose),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiProvider)
          .areaEntryClose(
            id: widget.examId,
            body: CloseAreaEntryDto(classSectionId: widget.sectionId, area: widget.area),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(s.aeClosed)));
      widget.onClosed();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(errorText(s, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final open = widget.entry?['open'];
    if (open is! Map) return const SizedBox.shrink();
    final o = asJson(open);
    final until = DateTime.tryParse('${o['until']}');
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      key: Key('aeNote-${widget.area}'),
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          StatusChip(
            '${widget.label ? '${s.aeArea(widget.area)} · ' : ''}'
            '${s.aeOpenUntil(until == null ? '' : s.dateTime(until))}',
            Tone.info,
          ),
          const SizedBox(height: Tokens.sp1),
          Text(
            s.aeReopened(o['openedBy'] == null ? null : '${o['openedBy']}', '${o['reason'] ?? ''}'),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (widget.entry?['canClose'] == true) ...[
            const SizedBox(height: Tokens.sp2),
            OutlinedButton(
              key: Key('aeDone-${widget.area}'),
              onPressed: _busy ? null : _done,
              child: Text(s.aeDone),
            ),
          ],
        ],
      ),
    );
  }
}

/// an area's lock for the section from a sheet: its `entry` (net of a reopening) or, from an older API, the lock given
bool areaLocked(Json sheet, String area, {required bool fallback}) {
  final e = sheet['entry'];
  if (e is Map && e[area] is Map) return asJson(e[area])['locked'] == true;
  return fallback;
}
