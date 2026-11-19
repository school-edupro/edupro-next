import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
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
  const ApprovalsScreen({super.key, required this.profile});
  final Profile profile;

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
        final kinds = asList(box['kinds']);
        final items = asList(box['items']).where((i) => _kind == null || i['kind'] == _kind);
        final off = asList(box['unavailable']);
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
                  label: Text('${s.all} (${box['total']})'),
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
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => DecideSheet(profile: widget.profile, item: item),
    );
    if (done == true) ref.invalidate(approvalsProvider(widget.profile));
  }
}

/// One item: what it is, the full page a tap away, and the decision when it is a yes or no.
class DecideSheet extends ConsumerStatefulWidget {
  const DecideSheet({super.key, required this.profile, required this.item});
  final Profile profile;
  final Json item;

  @override
  ConsumerState<DecideSheet> createState() => _DecideSheetState();
}

class _DecideSheetState extends ConsumerState<DecideSheet> {
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
      Navigator.of(context).pop(true);
    } catch (e) {
      setState(() {
        _busy = false;
        _error = e is ApiException && e.type == 'mfa-required' ? s.secondFactor : errorText(s, e);
      });
    }
  }

  Future<void> _page() async {
    final s = ref.read(stringsProvider);
    final url = i['url'] as String?;
    if (url != null) {
      // an admin page: the browser (the admin app signs in on its own)
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      return;
    }
    if (!mounted) return;
    await context.push(
      Uri(
        path: '/web',
        queryParameters: {'app': 'teacher', 'to': '${i['href']}', 'title': s.approvals},
      ).toString(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final here = i['decideHere'] == true;
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
                key: const Key('openPage'),
                icon: const Icon(Icons.open_in_new),
                label: Text(s.openPage),
                onPressed: _page,
              ),
              const SizedBox(height: Tokens.sp3),
              if (!here)
                Notice(text: s.decideOnPage)
              else ...[
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
            ],
          ),
        ),
      ),
    );
  }
}
