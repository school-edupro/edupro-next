import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

Tone attendanceTone(String code) => switch (code) {
  'P' => Tone.success,
  'A' => Tone.danger,
  'L' || 'SR' || 'H' => Tone.warning,
  _ => Tone.info,
};

Tone leaveTone(String status) => switch (status) {
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  'pending' => Tone.warning,
  _ => Tone.neutral,
};

/// The child's attendance month by month, and the leave applications (apply, cancel one still waiting).
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final now = DateTime.now();
    final att = ref.watch(attendanceProvider((p, ym(_month))));
    final leaves = ref.watch(leavesProvider(p));
    return LoadedList<Json?>(
      value: att,
      refresh: () {
        ref.invalidate(leavesProvider(p));
        return ref.refresh(attendanceProvider((p, ym(_month))).future);
      },
      children: (child) {
        final days = {for (final d in asList(child?['days'])) '${d['date']}': d};
        final sum = asJson(child?['summary']);
        return [
          Row(
            children: [
              IconButton(
                key: const Key('monthBack'),
                tooltip: s.previous,
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
              ),
              Expanded(
                child: Text(
                  s.month(_month),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                key: const Key('monthNext'),
                tooltip: s.next,
                icon: const Icon(Icons.chevron_right),
                onPressed: _month.year == now.year && _month.month == now.month
                    ? null
                    : () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
              ),
            ],
          ),
          if (child != null)
            Text(
              s.monthSummary(
                (sum['present'] as num? ?? 0).toInt(),
                (sum['absent'] as num? ?? 0).toInt(),
                (sum['leave'] as num? ?? 0).toInt(),
                (sum['days'] as num? ?? 0).toInt(),
              ),
              key: const Key('monthSummary'),
            ),
          const SizedBox(height: Tokens.sp3),
          _MonthGrid(month: _month, days: days),
          SectionTitle(
            s.leaves,
            action: TextButton.icon(
              key: const Key('applyLeave'),
              icon: const Icon(Icons.add),
              label: Text(s.applyLeave),
              onPressed: leaves.value == null ? null : () => _apply(leaves.value!.data),
            ),
          ),
          ...switch (leaves) {
            AsyncValue(:final value?) when asList(value.data['leaves']).isEmpty => [
              EmptyLine(s.nothingYet),
            ],
            AsyncValue(:final value?) => [
              for (final l in asList(value.data['leaves'])) _LeaveTile(profile: p, leave: l),
            ],
            AsyncValue(:final error?) => [ErrorText(errorText(s, error))],
            _ => [const LinearProgressIndicator()],
          },
        ];
      },
    );
  }

  Future<void> _apply(Json rules) async {
    final s = ref.read(stringsProvider);
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.applyLeave,
          child: LeaveForm(profile: widget.profile, rules: rules),
        ),
      ),
    );
    if (sent == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.leaveSent)));
      ref.invalidate(leavesProvider(widget.profile));
    }
  }
}

/// The month as a calendar: each day with its attendance colour and word (read out by the screen reader).
class _MonthGrid extends ConsumerWidget {
  const _MonthGrid({required this.month, required this.days});
  final DateTime month;
  final Map<String, Json> days;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final first = DateTime(month.year, month.month);
    final count = DateTime(month.year, month.month + 1, 0).day;
    final cells = <Widget>[
      for (var w = 1; w <= 7; w++)
        Center(
          child: ExcludeSemantics(
            child: Text(s.weekday(w), style: Theme.of(context).textTheme.labelSmall),
          ),
        ),
      for (var i = 1; i < first.weekday; i++) const SizedBox(),
      for (var d = 1; d <= count; d++) _cell(context, s, DateTime(month.year, month.month, d)),
    ];
    return GridView.count(
      crossAxisCount: 7,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: Tokens.sp1,
      crossAxisSpacing: Tokens.sp1,
      children: cells,
    );
  }

  Widget _cell(BuildContext context, S s, DateTime d) {
    final code = '${days[ymd(d)]?['code'] ?? ''}';
    final (bg, dot) = code.isEmpty
        ? (Colors.transparent, Colors.transparent)
        : switch (attendanceTone(code)) {
            Tone.success => (Tokens.statusSuccessBg, Tokens.statusSuccess),
            Tone.danger => (Tokens.statusDangerBg, Tokens.statusDanger),
            Tone.warning => (Tokens.statusWarningBg, Tokens.statusWarning),
            _ => (Tokens.statusInfoBg, Tokens.statusInfo),
          };
    return Semantics(
      label: '${s.date(d)}: ${code.isEmpty ? '—' : s.attendanceCode(code)}',
      excludeSemantics: true,
      child: Container(
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Tokens.radiusSm)),
        // a day is a small square: with large text its number and code shrink to fit (the screen reader reads
        // the whole day and its status from the label)
        padding: const EdgeInsets.all(2),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // on a tinted day the text is the body colour (the tints stay light in dark mode too); the dot
              // carries the status colour
              Text(
                '${d.day}',
                style: TextStyle(
                  color: code.isEmpty
                      ? Theme.of(context).colorScheme.onSurfaceVariant
                      : Tokens.textBody,
                ),
              ),
              if (code.isNotEmpty)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 2),
                    Text(
                      code,
                      style: const TextStyle(
                        fontSize: 10,
                        color: Tokens.textBody,
                        fontWeight: Tokens.fwBold,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LeaveTile extends ConsumerWidget {
  const _LeaveTile({required this.profile, required this.leave});
  final Profile profile;
  final Json leave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final status = '${leave['status']}';
    final days = (leave['days'] as num? ?? 0).toInt();
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
                    '${leave['leaveTypeLabel'] ?? ''}',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Flexible(child: StatusChip(s.leaveStatus(status), leaveTone(status))),
              ],
            ),
            const SizedBox(height: Tokens.sp1),
            Text(
              '${s.date(leave['fromDate'] ?? '')} – ${s.date(leave['toDate'] ?? '')} · ${s.daysN(days)}',
            ),
            Text('${leave['reason'] ?? ''}', style: Theme.of(context).textTheme.bodySmall),
            if (leave['decisionNote'] != null)
              Text('${leave['decisionNote']}', style: Theme.of(context).textTheme.bodySmall),
            if (status == 'pending')
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  key: Key('cancelLeave-${leave['id']}'),
                  onPressed: () => _cancel(context, ref, s),
                  child: Text(s.cancelLeave),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, S s) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.cancelLeaveAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.close)),
          FilledButton(
            key: const Key('confirmCancelLeave'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.cancelLeave),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).leaveCancel(id: '${leave['id']}');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.leaveCancelled)));
      }
      ref.invalidate(leavesProvider(profile));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }
}

/// A leave application for the child: the kind (type to search), the days, the reason. A leave that needs a
/// certificate goes to the web page, where the file is attached.
class LeaveForm extends ConsumerStatefulWidget {
  const LeaveForm({super.key, required this.profile, required this.rules});
  final Profile profile;
  final Json rules;

  @override
  ConsumerState<LeaveForm> createState() => _LeaveFormState();
}

class _LeaveFormState extends ConsumerState<LeaveForm> {
  String? _type;
  late DateTime _from = DateTime.now();
  late DateTime _to = DateTime.now();
  final _reason = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  int get _days => _to.difference(_from).inDays + 1;

  bool get _needsCertificate {
    final t = asList(widget.rules['types']).where((x) => '${x['value']}' == _type).firstOrNull;
    final c = t?['certificate'];
    if (c == null || c == 'never') return false;
    return c == 'always' || _days > ((widget.rules['longDays'] as num?)?.toInt() ?? 0);
  }

  Future<void> _pick(bool first) async {
    final today = DateTime.now();
    final back = (widget.rules['backDays'] as num?)?.toInt() ?? 0;
    final d = await showDatePicker(
      context: context,
      initialDate: first ? _from : _to,
      firstDate: first ? today.subtract(Duration(days: back)) : _from,
      lastDate: today.add(const Duration(days: 365)),
    );
    if (d == null) return;
    setState(() {
      if (first) {
        _from = d;
        if (_to.isBefore(d)) _to = d;
      } else {
        _to = d;
      }
    });
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    if (_type == null) return setState(() => _error = s.chooseLeaveType);
    if (_reason.text.trim().length < 5) return setState(() => _error = s.reasonShort);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .leaveApply(
            body: LeaveApplyDto(
              studentId: widget.profile.studentId!,
              leaveType: _type!,
              fromDate: ymd(_from),
              toDate: ymd(_to),
              reason: _reason.text.trim(),
            ),
          );
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
    final types = asList(widget.rules['types']);
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        DropdownMenu<String>(
          key: const Key('leaveType'),
          label: Text(s.leaveType),
          trailingIcon: dropArrow(s.leaveType),
          selectedTrailingIcon: dropArrow(s.leaveType, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          onSelected: (v) => setState(() => _type = v),
          dropdownMenuEntries: [
            for (final t in types)
              DropdownMenuEntry(value: '${t['value']}', label: '${t['label']}'),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('leaveFrom'),
                icon: const Icon(Icons.event),
                label: Text('${s.fromDate}: ${s.date(_from)}'),
                onPressed: () => _pick(true),
              ),
            ),
            const SizedBox(width: Tokens.sp2),
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('leaveTo'),
                icon: const Icon(Icons.event),
                label: Text('${s.toDate}: ${s.date(_to)}'),
                onPressed: () => _pick(false),
              ),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        Text(s.daysN(_days)),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('leaveReason'),
          controller: _reason,
          maxLines: 4,
          maxLength: 1000,
          decoration: InputDecoration(labelText: s.reason, border: const OutlineInputBorder()),
        ),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        if (_needsCertificate) ...[
          Notice(text: s.certificateNeeded),
          const SizedBox(height: Tokens.sp3),
          FilledButton(
            key: const Key('leaveOnWeb'),
            onPressed: () => context.push(
              Uri(
                path: '/web',
                queryParameters: {
                  'app': 'parent',
                  'to': '/attendance?view=leave',
                  'title': s.applyLeave,
                },
              ).toString(),
            ),
            child: Text(s.applyOnWeb),
          ),
        ] else
          FilledButton(
            key: const Key('sendLeave'),
            onPressed: _busy ? null : _send,
            child: Text(s.send),
          ),
      ],
    );
  }
}
