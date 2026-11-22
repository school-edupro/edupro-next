import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import 'data.dart';
import 'marks.dart';

/// The sheets the teachers of the person's sections submitted, waiting to be verified (none when verifying is not
/// part of the role).
final marksWaitingProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((ref, p) async {
  try {
    final r = asJson(await ref.read(apiProvider).examStatusWaiting());
    return [for (final x in asList(r['data'])) asJson(x)];
  } on ApiException catch (e) {
    if (e.status == 403) return const [];
    rethrow;
  }
});

/// Verify marks as on the staff website (docs/design/96, part 11): each sheet submitted for the person's sections —
/// section · subject, the exam, how many entered, who submitted it and when — with **Open the sheet** (in the app,
/// read only), **Verify** (the marks lock) and **Send back** with what to correct. No web page.
class VerifyMarksScreen extends ConsumerStatefulWidget {
  const VerifyMarksScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<VerifyMarksScreen> createState() => _VerifyMarksScreenState();
}

class _VerifyMarksScreenState extends ConsumerState<VerifyMarksScreen> {
  final Map<String, TextEditingController> _notes = {};
  final Map<String, String> _errors = {};
  String? _busy;

  @override
  void dispose() {
    for (final c in _notes.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _key(Json r) => '${r['examId']}-${r['classSectionId']}-${r['subjectId']}';

  Future<void> _act(Json r, {required bool verify}) async {
    final s = ref.read(stringsProvider);
    final k = _key(r);
    final note = _notes[k]?.text.trim() ?? '';
    if (!verify && note.length < 3) return setState(() => _errors[k] = s.vmNeedNote);
    setState(() {
      _busy = k;
      _errors.remove(k);
    });
    final api = ref.read(apiProvider);
    try {
      if (verify) {
        await api.examStatusVerify(
          id: '${r['examId']}',
          body: EntryStatusActionDto(
            classSectionId: '${r['classSectionId']}',
            subjectId: '${r['subjectId']}',
          ),
        );
      } else {
        await api.examStatusSendBack(
          id: '${r['examId']}',
          body: EntryStatusNoteDto(
            classSectionId: '${r['classSectionId']}',
            subjectId: '${r['subjectId']}',
            note: note,
          ),
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(verify ? s.vmVerified : s.vmSentBack)));
      _notes.remove(k)?.dispose();
      ref.invalidate(marksWaitingProvider(widget.profile));
      ref.invalidate(toEnterProvider(widget.profile));
    } catch (e) {
      if (!mounted) return;
      final known = e is ApiException ? s.mkError(e.type) : null;
      setState(() => _errors[k] = known ?? errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  void _open(Json r) {
    final pick = (
      value: '${r['classSectionId']}|${r['subjectId']}',
      label: '${r['section']} · ${r['subjectName']}',
      sectionId: '${r['classSectionId']}',
      subjectId: '${r['subjectId']}',
      partId: null,
    );
    pushPage(
      context,
      '${r['section']} · ${r['subjectName']}',
      ListView(
        key: const Key('vmSheet'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [MarksSheetView(profile: widget.profile, examId: '${r['examId']}', pick: pick)],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final rows = ref.watch(marksWaitingProvider(widget.profile));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(marksWaitingProvider(widget.profile).future),
      child: ListView(
        key: const Key('vmList'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(s.vmSubtitle, style: TextStyle(color: muted)),
          const SizedBox(height: Tokens.sp3),
          ...rows.when(
            loading: () => [const LinearProgressIndicator()],
            error: (e, _) => [Text(errorText(s, e), style: TextStyle(color: muted))],
            data: (list) => list.isEmpty
                ? [
                    Text(
                      s.vmNone,
                      key: const Key('vmNone'),
                      style: TextStyle(color: muted),
                    ),
                  ]
                : [for (final r in list) _card(s, r, muted)],
          ),
        ],
      ),
    );
  }

  Widget _card(S s, Json r, Color muted) {
    final k = _key(r);
    final busy = _busy != null;
    final at = DateTime.tryParse('${r['submittedAt'] ?? ''}');
    return Card(
      key: Key('vm-$k'),
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
                    '${r['section']} · ${r['subjectName']}',
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: Tokens.fwSemibold),
                  ),
                ),
                StatusChip('${r['examCode']}', Tone.warning),
              ],
            ),
            const SizedBox(height: Tokens.sp1),
            Text(
              [
                s.mkEnteredOf(
                  (r['entered'] as num?)?.toInt() ?? 0,
                  (r['takers'] as num?)?.toInt() ?? 0,
                ),
                if (r['submittedBy'] != null)
                  s.vmSubmittedBy(
                    '${r['submittedBy']}',
                    at == null ? '' : s.dateTime(at.toLocal()),
                  ),
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                OutlinedButton.icon(
                  key: Key('vmOpen-$k'),
                  onPressed: () => _open(r),
                  icon: const Icon(Icons.visibility_outlined),
                  label: Text(s.vmOpenSheet),
                ),
                FilledButton.icon(
                  key: Key('vmVerify-$k'),
                  style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                  onPressed: busy ? null : () => _act(r, verify: true),
                  icon: const Icon(Icons.verified_outlined),
                  label: Text(s.vmVerify),
                ),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: Key('vmNote-$k'),
              controller: _notes.putIfAbsent(k, TextEditingController.new),
              enabled: !busy,
              maxLength: 500,
              decoration: InputDecoration(
                labelText: s.vmWhatToCorrect,
                border: const OutlineInputBorder(),
                counterText: '',
                isDense: true,
              ),
            ),
            if (_errors[k] != null)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    _errors[k]!,
                    key: Key('vmError-$k'),
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
              ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                key: Key('vmSendBack-$k'),
                onPressed: busy ? null : () => _act(r, verify: false),
                icon: const Icon(Icons.undo),
                label: Text(s.vmSendBack),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
