import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:uuid/uuid.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
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

/// Asks for a correction of a day: the in / out time, or what the day should be, and why.
class CorrectionForm extends ConsumerStatefulWidget {
  const CorrectionForm({super.key, this.earliest, this.day});
  final DateTime? earliest;

  /// the day to correct, from its row (docs/design/99: Regularise); none: today, changeable
  final DateTime? day;

  @override
  ConsumerState<CorrectionForm> createState() => _CorrectionFormState();
}

class _CorrectionFormState extends ConsumerState<CorrectionForm> {
  late DateTime _day = widget.day ?? schoolToday();
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
