import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'approval_forms.dart';
import 'queries.dart' show StaffTicketDetail;
import 'data.dart';

/// The Approvals icon in a staff member's bar (docs/design/89 §5.4), with how many things wait for them.
class ApprovalsButton extends ConsumerWidget {
  const ApprovalsButton({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final n = (ref.watch(approvalsProvider(profile)).value?.data['total'] as num?)?.toInt() ?? 0;
    return IconButton(
      key: const Key('approvalsButton'),
      tooltip: n > 0 ? s.approvalsWaiting(n) : s.approvals,
      style: IconButton.styleFrom(
        backgroundColor: Tokens.mobNavy700,
        foregroundColor: Tokens.mobWhite,
        minimumSize: const Size(48, 48),
      ),
      icon: Badge(
        isLabelVisible: n > 0,
        // white with navy figures on the navy bar (the default red is too light for small text)
        backgroundColor: Tokens.mobWhite,
        textColor: Tokens.mobNavy800,
        label: Text(n > 99 ? '99+' : '$n'),
        child: const Icon(Icons.fact_check_outlined),
      ),
      onPressed: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => FamilyPage(
            title: s.approvals,
            child: ApprovalsScreen(profile: profile),
          ),
        ),
      ),
    );
  }
}

/// Everything waiting for the person: by kind, the oldest first; a tap opens it to decide.
class ApprovalsScreen extends ConsumerStatefulWidget {
  const ApprovalsScreen({super.key, required this.profile, this.only});
  final Profile profile;

  /// docs/design/100: a menu's approval page (Leave to approve, Attendance corrections …) as these kinds only
  final List<String>? only;

  @override
  ConsumerState<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends ConsumerState<ApprovalsScreen> {
  String? _kind;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    return LoadedList<Json>(
      value: ref.watch(approvalsProvider(p)),
      refresh: () => ref.refresh(approvalsProvider(p).future),
      children: (box) {
        final only = widget.only;
        final kinds = asList(box['kinds'])
            .where((k) => only == null || only.contains(k['kind']))
            .toList();
        final items = asList(box['items']).where(
          (i) =>
              (only == null || only.contains(i['kind'])) && (_kind == null || i['kind'] == _kind),
        );
        final off = asList(box['unavailable'])
            .where((k) => only == null || only.contains(k['kind']));
        return [
          if (off.isNotEmpty) ...[
            Notice(text: s.someUnavailable(off.map((k) => '${k['label']}').join(', '))),
            const SizedBox(height: Tokens.sp3),
          ],
          if (kinds.length > 1)
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                ChoiceChip(
                  label: Text(
                    '${s.all} (${only == null ? box['total'] : kinds.fold<num>(0, (n, k) => n + ((k['count'] as num?) ?? 0))})',
                  ),
                  selected: _kind == null,
                  onSelected: (_) => setState(() => _kind = null),
                ),
                for (final k in kinds)
                  ChoiceChip(
                    key: Key('kind-${k['kind']}'),
                    label: Text('${k['label']} (${k['count']})'),
                    selected: _kind == k['kind'],
                    onSelected: (_) => setState(() => _kind = '${k['kind']}'),
                  ),
              ],
            ),
          const SizedBox(height: Tokens.sp2),
          if (items.isEmpty) EmptyLine(s.nothingToApprove),
          for (final i in items)
            Card(
              child: ListTile(
                key: Key('approval-${i['kind']}-${i['id']}'),
                title: Text('${i['title']}'),
                subtitle: Text(
                  [
                    kinds.firstWhere(
                      (k) => k['kind'] == i['kind'],
                      orElse: () => {'label': i['kind']},
                    )['label'],
                    if (i['detail'] != null) i['detail'],
                    if (i['at'] != null) s.date('${i['at']}'.split('T').first),
                  ].join(' · '),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                isThreeLine: true,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _open(i),
              ),
            ),
        ];
      },
    );
  }

  Future<void> _open(Json item) async {
    if (item['kind'] == 'query') {
      // a query with me: its own screen in the app (reply, hand over, close), as Queries opens it
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => FamilyPage(
            title: '${item['title']}'.split(' · ').first,
            child: StaffTicketDetail(id: '${item['id']}'),
          ),
        ),
      );
      if (mounted) ref.invalidate(approvalsProvider(widget.profile));
      return;
    }
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => DecideSheet(profile: widget.profile, item: item),
    );
    if (done == true) ref.invalidate(approvalsProvider(widget.profile));
  }
}

/// One item: what it is, its whole record a tap away (Details, in the app), and the decision when it is a yes or no.
class DecideSheet extends ConsumerStatefulWidget {
  const DecideSheet({super.key, required this.profile, required this.item});
  final Profile profile;
  final Json item;

  @override
  ConsumerState<DecideSheet> createState() => _DecideSheetState();
}

class _DecideSheetState extends ConsumerState<DecideSheet> {
  Json get i => widget.item;

  /// docs/design/100: the item's whole record in the app (no web page); deciding there closes this sheet too
  Future<void> _details() async {
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ApprovalDetailScreen(profile: widget.profile, item: i),
      ),
    );
    if (done == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          Tokens.sp4,
          0,
          Tokens.sp4,
          Tokens.sp4 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text('${i['title']}', style: Theme.of(context).textTheme.titleLarge),
              ),
              if (i['detail'] != null) Text('${i['detail']}'),
              if (i['by'] != null || i['at'] != null)
                Text(
                  [
                    if (i['by'] != null) s.postedBy('${i['by']}'),
                    if (i['at'] != null) s.date('${i['at']}'.split('T').first),
                  ].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              if (i['amount'] != null) ...[
                const SizedBox(height: Tokens.sp2),
                Text(s.money(i['amount']), style: Theme.of(context).textTheme.titleMedium),
              ],
              const SizedBox(height: Tokens.sp3),
              OutlinedButton.icon(
                key: const Key('openDetails'),
                icon: const Icon(Icons.article_outlined),
                label: Text(s.details),
                onPressed: _details,
              ),
              const SizedBox(height: Tokens.sp3),
              if (i['decideHere'] != true)
                Notice(text: s.decideOnPage)
              else
                DecisionPanel(item: i, onDone: () => Navigator.of(context).pop(true)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The yes or no on an item (the sheet and the Details screen): the reason when it needs one, Approve and Reject (or
/// the kind's own words), sent to the kind's own route through the inbox.
class DecisionPanel extends ConsumerStatefulWidget {
  const DecisionPanel({super.key, required this.item, required this.onDone});
  final Json item;
  final VoidCallback onDone;

  @override
  ConsumerState<DecisionPanel> createState() => _DecisionPanelState();
}

class _DecisionPanelState extends ConsumerState<DecisionPanel> {
  final _reason = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Json get i => widget.item;

  Future<void> _decide(String decision) async {
    final s = ref.read(stringsProvider);
    final needs = decision == 'reject' ? i['reasonOnReject'] == true : i['reasonOnApprove'] == true;
    if (needs && _reason.text.trim().length < 3) {
      setState(() => _error = s.reasonNeeded);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .approvalsDecide(
            kind: '${i['kind']}',
            id: '${i['id']}',
            body: ApprovalDecisionDto(
              decision: decision,
              reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.done)));
      widget.onDone();
    } catch (e) {
      setState(() {
        _busy = false;
        _error = e is ApiException && e.type == 'mfa-required' ? s.secondFactor : errorText(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final yes = switch ('${i['approveAs']}') {
      'acknowledge' => s.acknowledgeIt,
      'sign' => s.sign,
      _ => s.approve,
    };
    final no = switch (i['rejectAs']) {
      'send_back' => s.sendBack,
      null => null,
      _ => s.reject,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('decisionReason'),
          controller: _reason,
          maxLines: 2,
          maxLength: 500,
          decoration: InputDecoration(
            labelText: i['reasonOnReject'] == true || i['reasonOnApprove'] == true
                ? s.reason
                : s.reasonOptional,
            border: const OutlineInputBorder(),
          ),
        ),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
        Row(
          children: [
            if (no != null) ...[
              Expanded(
                child: OutlinedButton(
                  key: const Key('rejectIt'),
                  onPressed: _busy ? null : () => _decide('reject'),
                  child: Text(no),
                ),
              ),
              const SizedBox(width: Tokens.sp3),
            ],
            Expanded(
              child: FilledButton(
                key: const Key('approveIt'),
                onPressed: _busy ? null : () => _decide('approve'),
                child: Text(yes),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// docs/design/100: an item's record for the Details screen (its kind's own routes, read as the person).
final approvalDetailProvider = FutureProvider.autoDispose.family<Json, (String, String)>((
  ref,
  a,
) async {
  final (kind, id) = a;
  return asJson(await ref.watch(apiProvider).approvalsDetail(kind: kind, id: id));
});

/// An approval's whole record in the app (docs/design/100): its facts, notes, lists as tables, files (View and
/// Download in the app's viewer) and the decision — never a web page.
class ApprovalDetailScreen extends ConsumerWidget {
  const ApprovalDetailScreen({super.key, required this.profile, required this.item});
  final Profile profile;
  final Json item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final key = ('${item['kind']}', '${item['id']}');
    final async = ref.watch(approvalDetailProvider(key));
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return FamilyPage(
      title: s.details,
      child: async.when(
        loading: () =>
            const Padding(padding: EdgeInsets.all(Tokens.sp4), child: LinearProgressIndicator()),
        error: (e, _) =>
            Padding(padding: const EdgeInsets.all(Tokens.sp4), child: ErrorText(errorText(s, e))),
        data: (r) {
          final d = asJson(r['detail']);
          final it = r['item'] is Map ? asJson(r['item']) : item;
          return ListView(
            key: const Key('approvalDetail'),
            padding: const EdgeInsets.all(Tokens.sp4),
            children: [
              Semantics(
                header: true,
                child: Text('${d['title']}', style: Theme.of(context).textTheme.titleLarge),
              ),
              if (d['subtitle'] != null) Text('${d['subtitle']}', style: TextStyle(color: muted)),
              if (d['status'] != null) ...[
                const SizedBox(height: Tokens.sp2),
                Align(
                  alignment: Alignment.centerLeft,
                  child: StatusChip('${d['status']}', Tone.info),
                ),
              ],
              const SizedBox(height: Tokens.sp3),
              if (asList(d['facts']).isNotEmpty)
                Card(
                  key: const Key('approvalFacts'),
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(Tokens.sp3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final f in asList(d['facts']))
                          Padding(
                            padding: const EdgeInsets.only(bottom: Tokens.sp2),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${f['label']}', style: TextStyle(color: muted, fontSize: 13)),
                                Text(
                                  '${f['value']}',
                                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              for (final n in asList(d['notes'])) ...[
                SectionTitle('${n['label']}'),
                Text('${n['text']}'),
              ],
              for (final t in asList(d['tables'])) ...[
                SectionTitle('${t['title']}'),
                _DetailTable(table: t),
              ],
              if (asList(d['files']).isNotEmpty) ...[
                SectionTitle(s.files),
                for (final f in asList(d['files']))
                  Card(
                    margin: const EdgeInsets.only(bottom: Tokens.sp2),
                    child: Padding(
                      padding: const EdgeInsets.all(Tokens.sp3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${f['label']}'),
                          const SizedBox(height: Tokens.sp2),
                          Wrap(
                            spacing: Tokens.sp2,
                            runSpacing: Tokens.sp2,
                            children: [
                              OutlinedButton.icon(
                                key: Key('fileView-${f['fileId']}'),
                                icon: const Icon(Icons.visibility_outlined),
                                label: Text(s.view),
                                onPressed: () => Navigator.of(context).push(
                                  MaterialPageRoute<void>(
                                    builder: (_) => FileScreen(
                                      title: '${f['label']}',
                                      load: () =>
                                          _file(ref, key, '${f['fileId']}', '${f['label']}'),
                                    ),
                                  ),
                                ),
                              ),
                              OutlinedButton.icon(
                                key: Key('fileSave-${f['fileId']}'),
                                icon: const Icon(Icons.download_outlined),
                                label: Text(s.download),
                                onPressed: () => shareFile(
                                  context,
                                  s,
                                  () => _file(ref, key, '${f['fileId']}', '${f['label']}'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
              const SizedBox(height: Tokens.sp4),
              if (it['decideHere'] == true)
                DecisionPanel(item: it, onDone: () => Navigator.of(context).pop(true))
              else if (r['record'] is Map)
                // decided item by item: its own form, in the app (docs/design/100 phase D)
                ApprovalForm(
                  kind: '${item['kind']}',
                  id: '${item['id']}',
                  record: asJson(r['record']),
                  options: asJson(r['options']),
                  onDone: () => Navigator.of(context).pop(true),
                )
              else
                Notice(text: s.decideOnPage),
            ],
          );
        },
      ),
    );
  }

  /// the file asked afresh (the record is read again first), then fetched for the viewer
  static Future<ApiFile> _file(
    WidgetRef ref,
    (String, String) key,
    String fileId,
    String name,
  ) async {
    final r = asJson(
      await ref.read(apiProvider).approvalsFile(kind: key.$1, id: key.$2, fileId: fileId),
    );
    final url = '${asJson(r['download'])['url'] ?? ''}';
    return ref.read(transportProvider).download(url, name: name);
  }
}

/// A record's list as a table that slides sideways (columns wide enough to read).
class _DetailTable extends StatelessWidget {
  const _DetailTable({required this.table});
  final Json table;

  @override
  Widget build(BuildContext context) {
    final line = Theme.of(context).colorScheme.outlineVariant;
    final cols = [for (final c in (table['columns'] as List?) ?? const []) '$c'];
    final rows = [
      for (final r in (table['rows'] as List?) ?? const []) [for (final x in r as List) '$x'],
    ];
    Widget cell(String t, {bool head = false}) => Container(
      width: 140,
      padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: Tokens.sp2),
      decoration: BoxDecoration(
        border: Border(
          right: BorderSide(color: line),
          bottom: BorderSide(color: line),
        ),
      ),
      child: Text(t, style: TextStyle(fontSize: 13, fontWeight: head ? Tokens.fwSemibold : null)),
    );
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [for (final c in cols) cell(c, head: true)],
            ),
          ),
          for (final r in rows)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [for (var i = 0; i < cols.length; i++) cell(i < r.length ? r[i] : '')],
              ),
            ),
        ],
      ),
    );
  }
}
