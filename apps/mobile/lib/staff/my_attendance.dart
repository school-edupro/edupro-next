import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:uuid/uuid.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveTone;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

Tone dayTone(String t) => switch (t) {
  'P' => Tone.success,
  'A' => Tone.danger,
  'HD' || 'HOLD' => Tone.warning,
  'LV' => Tone.info,
  _ => Tone.neutral,
};

/// The person's own attendance month by month (from the school's punch machines: EduPro has no check-in from the
/// phone), with the corrections they asked for and a way to ask for one.
class MyAttendanceScreen extends ConsumerStatefulWidget {
  const MyAttendanceScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<MyAttendanceScreen> createState() => _MyAttendanceScreenState();
}

class _MyAttendanceScreenState extends ConsumerState<MyAttendanceScreen> {
  DateTime _month = DateTime(schoolToday().year, schoolToday().month);

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final arg = (widget.profile, ym(_month));
    final now = schoolToday();
    return LoadedList<Json>(
      value: ref.watch(myStaffAttendanceProvider(arg)),
      refresh: () => ref.refresh(myStaffAttendanceProvider(arg).future),
      children: (m) {
        final days = asList(m['days']).reversed;
        final regs = asList(m['regularisations']);
        return [
          Row(
            children: [
              IconButton(
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
                tooltip: s.next,
                icon: const Icon(Icons.chevron_right),
                onPressed: _month.year == now.year && _month.month == now.month
                    ? null
                    : () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
              ),
            ],
          ),
          if (m['locked'] != true)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const Key('askCorrection'),
                icon: const Icon(Icons.edit_calendar_outlined),
                label: Text(s.askCorrection),
                onPressed: () => _ask(m),
              ),
            ),
          if (regs.isNotEmpty) ...[
            SectionTitle(s.askCorrection),
            for (final r in regs)
              Card(
                child: ListTile(
                  title: Text(s.dayShort('${r['day']}')),
                  subtitle: Text(
                    [
                      if (r['in_time'] != null) '${s.inTime} ${r['in_time']}',
                      if (r['out_time'] != null) '${s.outTime} ${r['out_time']}',
                      if (r['day_type'] != null) s.dayType('${r['day_type']}'),
                      '${r['reason'] ?? ''}',
                    ].join(' · '),
                  ),
                  trailing: r['status'] == 'pending'
                      ? TextButton(
                          onPressed: () => _withdraw('${r['id']}'),
                          child: Text(s.withdraw),
                        )
                      : StatusChip(s.leaveStatus('${r['status']}'), leaveTone('${r['status']}')),
                ),
              ),
          ],
          SectionTitle(s.month(_month)),
          if (days.isEmpty) EmptyLine(s.nothingYet),
          for (final d in days)
            ListTile(
              dense: true,
              title: Text(s.dayShort('${d['day']}')),
              subtitle: Text(
                d['in'] == null && d['out'] == null
                    ? s.noPunches
                    : '${s.inTime} ${d['in'] ?? '—'} · ${s.outTime} ${d['out'] ?? '—'}',
              ),
              trailing: StatusChip(
                '${d['words'] ?? s.dayType('${d['dayType']}')}',
                dayTone('${d['dayType']}'),
              ),
            ),
        ];
      },
    );
  }

  Future<void> _withdraw(String id) async {
    final s = ref.read(stringsProvider);
    try {
      await ref
          .read(apiProvider)
          .staffAttendanceWithdrawReg(
            id: id,
            body: const StaffLeaveWithdrawDto(reason: ''),
          );
      ref.invalidate(myStaffAttendanceProvider((widget.profile, ym(_month))));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  Future<void> _ask(Json m) async {
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: ref.read(stringsProvider).askCorrection,
          child: CorrectionForm(earliest: DateTime.tryParse('${m['correctionFrom'] ?? ''}')),
        ),
      ),
    );
    if (sent == true && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(ref.read(stringsProvider).correctionSent)));
      ref.invalidate(myStaffAttendanceProvider((widget.profile, ym(_month))));
    }
  }
}

/// Asks for a correction of a day: the in / out time, or what the day should be, and why.
class CorrectionForm extends ConsumerStatefulWidget {
  const CorrectionForm({super.key, this.earliest});
  final DateTime? earliest;

  @override
  ConsumerState<CorrectionForm> createState() => _CorrectionFormState();
}

class _CorrectionFormState extends ConsumerState<CorrectionForm> {
  DateTime _day = schoolToday();
  TimeOfDay? _in;
  TimeOfDay? _out;
  String? _type;
  final _reason = TextEditingController();
  String? _error;
  bool _busy = false;
  // one key for this request: a resend after a lost answer is not asked twice
  final _key = const Uuid().v4();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  String? _hm(TimeOfDay? t) => t == null
      ? null
      : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    if (_in == null && _out == null && _type == null) {
      return setState(() => _error = s.correctionNeeds);
    }
    if (_reason.text.trim().length < 3) return setState(() => _error = s.reasonNeeded);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await withCall(
        CallOptions(idempotencyKey: _key),
        () => ref
            .read(apiProvider)
            .staffAttendanceRegularise(
              body: RegulariseDto(
                day: ymd(_day),
                in_: _hm(_in),
                out: _hm(_out),
                dayType: _type,
                reason: _reason.text.trim(),
              ),
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
    final today = schoolToday();
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        OutlinedButton.icon(
          key: const Key('corrDay'),
          icon: const Icon(Icons.event),
          label: Text('${s.dateLabel}: ${s.dayShort(_day)}'),
          onPressed: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _day,
              firstDate: widget.earliest ?? today.subtract(const Duration(days: 60)),
              lastDate: today,
            );
            if (d != null) setState(() => _day = d);
          },
        ),
        const SizedBox(height: Tokens.sp3),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const Key('corrIn'),
                onPressed: () async {
                  final t = await showTimePicker(
                    context: context,
                    initialTime: _in ?? const TimeOfDay(hour: 8, minute: 0),
                  );
                  if (t != null) setState(() => _in = t);
                },
                child: Text('${s.inTime}: ${_hm(_in) ?? '—'}'),
              ),
            ),
            const SizedBox(width: Tokens.sp2),
            Expanded(
              child: OutlinedButton(
                key: const Key('corrOut'),
                onPressed: () async {
                  final t = await showTimePicker(
                    context: context,
                    initialTime: _out ?? const TimeOfDay(hour: 14, minute: 0),
                  );
                  if (t != null) setState(() => _out = t);
                },
                child: Text('${s.outTime}: ${_hm(_out) ?? '—'}'),
              ),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        Wrap(
          spacing: Tokens.sp2,
          children: [
            for (final t in ['P', 'HD', 'WO', 'H'])
              ChoiceChip(
                label: Text(s.dayType(t)),
                selected: _type == t,
                onSelected: (on) => setState(() => _type = on ? t : null),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('corrReason'),
          controller: _reason,
          maxLines: 3,
          maxLength: 500,
          decoration: InputDecoration(labelText: s.reason, border: const OutlineInputBorder()),
        ),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
        FilledButton(
          key: const Key('sendCorrection'),
          onPressed: _busy ? null : _send,
          child: Text(s.send),
        ),
      ],
    );
  }
}
