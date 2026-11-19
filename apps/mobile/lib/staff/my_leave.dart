import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:uuid/uuid.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

Tone staffLeaveTone(String status) => switch (status) {
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  'pending' => Tone.warning,
  _ => Tone.neutral,
};

/// The person's leave: balances, their requests (withdraw one waiting, ask to cancel one approved), and apply.
class MyLeaveScreen extends ConsumerWidget {
  const MyLeaveScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<Json>(
      value: ref.watch(myLeaveProvider(profile)),
      refresh: () => ref.refresh(myLeaveProvider(profile).future),
      children: (m) {
        final balances = asList(m['balances']);
        final rows = asList(m['rows']);
        final can = asJson(m['can']);
        return [
          if (can['apply'] != false)
            FilledButton.icon(
              key: const Key('applyStaffLeave'),
              icon: const Icon(Icons.add),
              label: Text(s.applyLeave),
              onPressed: () => _apply(context, ref, m),
            ),
          if (balances.isNotEmpty) ...[
            SectionTitle(s.balances),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final b in balances)
                  Chip(label: Text('${b['name']}: ${s.available('${b['available']}')}')),
              ],
            ),
          ],
          SectionTitle(s.myLeave),
          if (rows.isEmpty) EmptyLine(s.nothingYet),
          for (final r in rows) _LeaveRow(profile: profile, row: r),
        ];
      },
    );
  }

  Future<void> _apply(BuildContext context, WidgetRef ref, Json m) async {
    final s = ref.read(stringsProvider);
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.applyLeave,
          child: StaffLeaveForm(types: asList(m['types'])),
        ),
      ),
    );
    if (sent == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.leaveSent)));
      ref.invalidate(myLeaveProvider(profile));
    }
  }
}

class _LeaveRow extends ConsumerWidget {
  const _LeaveRow({required this.profile, required this.row});
  final Profile profile;
  final Json row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final status = '${row['status']}';
    final type = asJson(row['leaveType']);
    final days = row['days'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${type['name'] ?? ''}',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Flexible(child: StatusChip(s.staffLeaveStatus(status), staffLeaveTone(status))),
              ],
            ),
            Text('${s.date(row['from'])} – ${s.date(row['to'])}${days == null ? '' : ' · $days'}'),
            if (row['waitingWith'] != null && status == 'pending')
              Text('${row['waitingWith']}', style: Theme.of(context).textTheme.bodySmall),
            if (row['decisionNote'] != null)
              Text('${row['decisionNote']}', style: Theme.of(context).textTheme.bodySmall),
            if (status == 'pending' || (status == 'approved' && row['cancelStatus'] == null))
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  key: Key('leaveAction-${row['id']}'),
                  onPressed: () => status == 'pending'
                      ? _withdraw(context, ref, s)
                      : _askCancel(context, ref, s),
                  child: Text(status == 'pending' ? s.withdraw : s.askCancel),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _withdraw(BuildContext context, WidgetRef ref, S s) async {
    try {
      await ref
          .read(apiProvider)
          .staffLeaveWithdraw(
            id: '${row['id']}',
            body: const StaffLeaveWithdrawDto(reason: ''),
          );
      ref.invalidate(myLeaveProvider(profile));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  Future<void> _askCancel(BuildContext context, WidgetRef ref, S s) async {
    final c = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(s.askCancel),
        content: TextField(
          key: const Key('cancelReason'),
          controller: c,
          maxLines: 2,
          decoration: InputDecoration(labelText: s.reason),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(d).pop(), child: Text(s.close)),
          FilledButton(onPressed: () => Navigator.of(d).pop(c.text.trim()), child: Text(s.send)),
        ],
      ),
    );
    if (reason == null) return;
    try {
      await ref
          .read(apiProvider)
          .staffLeaveRequestCancel(
            id: '${row['id']}',
            body: StaffLeaveReasonDto(reason: reason),
          );
      ref.invalidate(myLeaveProvider(profile));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }
}

/// A leave application: the kind (type to search), the days or a half day, the reason. The API may ask to confirm
/// that the leave bridges a holiday or is split (loss of pay); the person sees its words and goes ahead or not.
/// A kind that needs a document goes to the web page, where the file is attached.
class StaffLeaveForm extends ConsumerStatefulWidget {
  const StaffLeaveForm({super.key, required this.types});
  final List<Json> types;

  @override
  ConsumerState<StaffLeaveForm> createState() => _StaffLeaveFormState();
}

class _StaffLeaveFormState extends ConsumerState<StaffLeaveForm> {
  String? _type;
  DateTime _from = schoolToday();
  DateTime _to = schoolToday();
  bool _half = false;
  String _session = 'first';
  final _reason = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Json? get _kind => widget.types.where((t) => '${t['id']}' == _type).firstOrNull;

  Future<void> _send({bool bridgeOk = false, bool splitOk = false}) async {
    final s = ref.read(stringsProvider);
    if (_type == null) return setState(() => _error = s.chooseLeaveType);
    if (_reason.text.trim().length < 3) return setState(() => _error = s.reasonNeeded);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await withCall(
          // a new key a try: a confirmed resend is another request
          CallOptions(idempotencyKey: const Uuid().v4()),
          () => ref
              .read(apiProvider)
              .staffLeaveApply(
                body: StaffLeaveApplyDto(
                  leaveTypeId: _type!,
                  from: ymd(_from),
                  to: ymd(_half ? _from : _to),
                  halfDay: _half,
                  session: _half ? _session : null,
                  reason: _reason.text.trim(),
                  bridgeOk: bridgeOk,
                  splitOk: splitOk,
                ),
              ),
        ),
      );
      final confirm = asJson(r['confirm']);
      if (confirm.isNotEmpty) {
        if (!mounted) return;
        setState(() => _busy = false);
        final go = await showDialog<bool>(
          context: context,
          builder: (d) => AlertDialog(
            content: Text('${confirm['message']}'),
            actions: [
              TextButton(onPressed: () => Navigator.of(d).pop(false), child: Text(s.cancel)),
              FilledButton(
                key: const Key('confirmLeave'),
                onPressed: () => Navigator.of(d).pop(true),
                child: Text(s.confirm),
              ),
            ],
          ),
        );
        if (go == true) {
          await _send(
            bridgeOk: bridgeOk || confirm['kind'] == 'bridge',
            splitOk: splitOk || confirm['kind'] == 'split',
          );
        }
        return;
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() {
        _busy = false;
        _error = errorText(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final today = schoolToday();
    final kind = _kind;
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        DropdownMenu<String>(
          key: const Key('staffLeaveType'),
          label: Text(s.leaveType),
          trailingIcon: dropArrow(s.leaveType),
          selectedTrailingIcon: dropArrow(s.leaveType, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          onSelected: (v) => setState(() => _type = v),
          dropdownMenuEntries: [
            for (final t in widget.types)
              DropdownMenuEntry(value: '${t['id']}', label: '${t['name']}'),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        if (kind?['halfDay'] == true)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(s.halfDay),
            value: _half,
            onChanged: (v) => setState(() => _half = v),
          ),
        if (_half)
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'first', label: Text(s.firstHalf)),
              ButtonSegment(value: 'second', label: Text(s.secondHalf)),
            ],
            selected: {_session},
            onSelectionChanged: (v) => setState(() => _session = v.first),
          ),
        const SizedBox(height: Tokens.sp3),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const Key('staffLeaveFrom'),
                onPressed: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _from,
                    firstDate: today.subtract(const Duration(days: 60)),
                    lastDate: today.add(const Duration(days: 365)),
                  );
                  if (d != null) {
                    setState(() {
                      _from = d;
                      if (_to.isBefore(d)) _to = d;
                    });
                  }
                },
                child: Text('${s.fromDate}: ${s.date(_from)}'),
              ),
            ),
            if (!_half) ...[
              const SizedBox(width: Tokens.sp2),
              Expanded(
                child: OutlinedButton(
                  key: const Key('staffLeaveTo'),
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _to,
                      firstDate: _from,
                      lastDate: today.add(const Duration(days: 365)),
                    );
                    if (d != null) setState(() => _to = d);
                  },
                  child: Text('${s.toDate}: ${s.date(_to)}'),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('staffLeaveReason'),
          controller: _reason,
          maxLines: 3,
          maxLength: 1000,
          decoration: InputDecoration(labelText: s.reason, border: const OutlineInputBorder()),
        ),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
        if (kind?['documentNeeded'] == true) ...[
          Notice(text: s.documentNeeded),
          const SizedBox(height: Tokens.sp2),
          FilledButton(
            onPressed: () => context.push(
              Uri(
                path: '/web',
                queryParameters: {'app': 'teacher', 'to': '/my-leave', 'title': s.applyLeave},
              ).toString(),
            ),
            child: Text(s.applyOnWeb),
          ),
        ] else
          FilledButton(
            key: const Key('sendStaffLeave'),
            onPressed: _busy ? null : () => _send(),
            child: Text(s.send),
          ),
      ],
    );
  }
}
