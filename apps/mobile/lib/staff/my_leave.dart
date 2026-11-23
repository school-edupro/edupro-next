import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:uuid/uuid.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

Tone staffLeaveTone(String status) => switch (status) {
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  'pending' => Tone.warning,
  _ => Tone.neutral,
};

/// A leave application: the kind (type to search), the days or a half day, the reason. The API may ask to confirm
/// that the leave bridges a holiday or is split (loss of pay); the person sees its words and goes ahead or not.
/// A kind that needs a document (a certificate or letter) takes it here: a PDF or photo of up to 5 MB from the phone,
/// uploaded once and sent with the application (as on the staff website; no web page).
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

  /// the document picked, and its file once uploaded (a confirmed resend does not upload it again)
  PickedFile? _doc;
  String? _docId;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Json? get _kind => widget.types.where((t) => '${t['id']}' == _type).firstOrNull;

  /// a certificate or letter from the phone: a PDF or a photo, 5 MB at most
  Future<void> _pickDoc() async {
    final s = ref.read(stringsProvider);
    final picked = await ref.read(leaveFilePickerProvider)();
    final f = picked.firstOrNull;
    if (f == null || !mounted) return;
    if (!RegExp(r'^(application/pdf|image/(png|jpeg|webp))$').hasMatch(f.contentType)) {
      return setState(() => _error = s.leaveFileType);
    }
    if (f.bytes.length > 5 * 1024 * 1024) return setState(() => _error = s.leaveFileTooBig);
    setState(() {
      _doc = f;
      _docId = null;
      _error = null;
    });
  }

  Future<void> _send({bool bridgeOk = false, bool splitOk = false}) async {
    final s = ref.read(stringsProvider);
    if (_type == null) return setState(() => _error = s.chooseLeaveType);
    if (_reason.text.trim().length < 3) return setState(() => _error = s.reasonNeeded);
    final needsDoc = _kind?['documentNeeded'] == true;
    if (needsDoc && _doc == null) return setState(() => _error = s.addCertificate);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // the document goes up first; its id rides with the application
      if (needsDoc && _doc != null && _docId == null) {
        _docId = await uploadFile(ref.read(apiProvider), ref.read(transportProvider), _doc!);
      }
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
                  documentFileId: needsDoc ? _docId : null,
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
          if (_doc == null)
            OutlinedButton.icon(
              key: const Key('staffLeaveDoc'),
              icon: const Icon(Icons.attach_file),
              label: Text(s.attachDocument),
              onPressed: _busy ? null : _pickDoc,
            )
          else
            Card(
              key: const Key('staffLeaveDocPicked'),
              margin: EdgeInsets.zero,
              child: ListTile(
                leading: Icon(
                  _doc!.contentType == 'application/pdf'
                      ? Icons.picture_as_pdf_outlined
                      : Icons.image_outlined,
                ),
                title: Text(_doc!.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                trailing: TextButton(
                  key: const Key('staffLeaveDocRemove'),
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                          _doc = null;
                          _docId = null;
                        }),
                  child: Text(s.remove),
                ),
              ),
            ),
          const SizedBox(height: Tokens.sp3),
        ],
        FilledButton(
          key: const Key('sendStaffLeave'),
          onPressed: _busy ? null : () => _send(),
          child: Text(_busy ? s.loading : s.send),
        ),
      ],
    );
  }
}
