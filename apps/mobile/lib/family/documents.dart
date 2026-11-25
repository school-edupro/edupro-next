import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/paged_feed.dart';
import 'common.dart';
import 'data.dart';

/// The papers the teachers and the school shared for the session, as the website's "Session plan and date sheets"
/// (apps/parent/app/(app)/documents): the kinds to pick from; one list by date — the child's class's and the school's,
/// the latest 10 first and 10 more as the family scrolls — each with its kind, its files (View / Download), who
/// shared it and when, and "I have seen this" when the school asks.
class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  String _kind = '';

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final round = ref.watch(feedRoundProvider('family-docs'));
    // the first page kept on the phone for reading offline (all kinds only)
    final keptAs = _kind.isEmpty ? 'docs-feed:${p.id}' : null;
    return PagedFeed(
      key: ValueKey('docsFeed-$_kind-$round'),
      firstCacheKey: keptAs,
      load: (page) => ref
          .read(apiProvider)
          .documentsList(
            studentId: p.studentId,
            kind: _kind.isEmpty ? null : _kind,
            page: page,
            size: 10,
          ),
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      empty: s.nothingShared,
      item: (context, x, _) => _DocCard(profile: p, doc: x),
      header: (_, d) {
        final kinds = asList(d?['kinds']);
        return [
          Text(
            s.docsTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(s.docsHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
          Semantics(
            label: s.docsTitle,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final (value, label) in [
                  ('', s.allKinds),
                  for (final k in kinds) ('${k['value']}', '${k['label']}'),
                ])
                  ChoiceChip(
                    key: Key('docKind-${value.isEmpty ? 'all' : value}'),
                    label: Text(label),
                    selected: _kind == value,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _kind = value),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp2),
        ];
      },
    );
  }
}

class _DocCard extends ConsumerStatefulWidget {
  const _DocCard({required this.profile, required this.doc});
  final Profile profile;
  final Json doc;

  @override
  ConsumerState<_DocCard> createState() => _DocCardState();
}

class _DocCardState extends ConsumerState<_DocCard> {
  late bool _seen =
      widget.doc['ackedFor'] is List &&
      (widget.doc['ackedFor'] as List).contains(widget.profile.studentId);
  bool _busy = false;

  Future<void> _ack() async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      await ref
          .read(apiProvider)
          .documentsAck(
            body: AckDto(
              type: 'document',
              id: '${widget.doc['id']}',
              studentId: widget.profile.studentId,
            ),
          );
      if (mounted) setState(() => _seen = true);
      ref.read(feedRoundProvider('family-docs').notifier).bump();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final x = widget.doc;
    final id = '${x['id']}';
    final files = [for (final f in (x['fileIds'] as List? ?? const [])) '$f'];
    final remark = plainText('${x['remark'] ?? ''}').trim();
    final published = DateTime.tryParse('${x['publishAt'] ?? ''}');
    return Card(
      key: Key('doc-$id'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusChip('${x['kindLabel'] ?? x['kind']}', Tone.info),
                Text('${x['title'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
              ],
            ),
            if (remark.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              SelectionArea(child: Text(remark)),
            ],
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
                if (x['postedBy'] != null) '${x['postedBy']}',
                if (x['section'] != null) '${x['section']}',
                if (published != null) s.publishedAt(s.dateTime(published)),
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            if (x['ackRequired'] == true && widget.profile.studentId != null) ...[
              const SizedBox(height: Tokens.sp2),
              _seen
                  ? Row(
                      children: [
                        const Icon(Icons.check_circle, color: Tokens.statusSuccess),
                        const SizedBox(width: Tokens.sp2),
                        Text(s.acknowledged),
                      ],
                    )
                  : FilledButton(
                      key: Key('docAck-$id'),
                      onPressed: _busy ? null : _ack,
                      child: Text(s.acknowledge),
                    ),
            ],
          ],
        ),
      ),
    );
  }
}
