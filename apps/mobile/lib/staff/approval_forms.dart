import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// docs/design/100 phase D: the kinds decided item by item, decided in the app as their pages do (no web page) —
/// a receipt's inspection, a condemnation, a withdrawal's clearance, a transfer from another school, an ACR level,
/// a no-dues clearance. Each step goes to the kind's own route through `POST /approvals/:kind/:id/act`.
class ApprovalForm extends ConsumerWidget {
  const ApprovalForm({
    super.key,
    required this.kind,
    required this.id,
    required this.record,
    required this.options,
    required this.onDone,
  });
  final String kind;
  final String id;
  final Json record;
  final Json options;

  /// the item is decided: back to the inbox
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final act = _Act(ref: ref, kind: kind, id: id, onDone: onDone);
    return switch (kind) {
      'receipt' => _ReceiptForm(record: record, act: act),
      'condemnation' => _CondemnationForm(record: record, act: act),
      'withdrawal' => _WithdrawalForm(record: record, act: act),
      'transfer' => _TransferForm(record: record, options: options, act: act),
      'acr' => _AcrForm(record: record, act: act),
      'no_dues' => _NoDuesForm(record: record, act: act),
      _ => const SizedBox.shrink(),
    };
  }
}

/// sends a step and says how it went
class _Act {
  _Act({required this.ref, required this.kind, required this.id, required this.onDone});
  final WidgetRef ref;
  final String kind;
  final String id;
  final VoidCallback onDone;

  /// `done`: the item is decided (the screen closes); else it stays (a draft saved, a file added)
  Future<Json?> call(
    BuildContext context,
    String step,
    Map<String, Object?> body, {
    bool done = true,
    bool quiet = false,
  }) async {
    final s = ref.read(stringsProvider);
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .approvalsAct(
              kind: kind,
              id: id,
              body: ApprovalActDto(step: step, body: body),
            ),
      );
      if (!context.mounted) return r;
      if (!quiet) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(done ? s.done : s.saved)));
      }
      if (done) onDone();
      return r;
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
      return null;
    }
  }
}

/// asks for a reason (`min` letters) in a window
Future<String?> _ask(
  BuildContext context,
  S s, {
  required String title,
  required String label,
  required String go,
  int min = 3,
}) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (d) => StatefulBuilder(
      builder: (d, set) => AlertDialog(
        title: Text(title),
        content: TextField(
          key: const Key('afReason'),
          controller: c,
          maxLines: 3,
          maxLength: 500,
          decoration: InputDecoration(labelText: label),
          onChanged: (_) => set(() {}),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: Text(s.cancel)),
          FilledButton(
            key: const Key('afReasonOk'),
            style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
            onPressed: c.text.trim().length < min ? null : () => Navigator.pop(d, c.text.trim()),
            child: Text(go),
          ),
        ],
      ),
    ),
  );
}

InputDecoration _box(String label) =>
    InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true);

num? _num(String t) => num.tryParse(t.trim());

void _say(BuildContext context, String text) => ScaffoldMessenger.of(context)
  ..hideCurrentSnackBar()
  ..showSnackBar(SnackBar(content: Text(text)));

/// A goods receipt's inspection: each line's accepted and rejected quantity (why, and which serials), a note;
/// accept as marked, or reject it all.
class _ReceiptForm extends ConsumerStatefulWidget {
  const _ReceiptForm({required this.record, required this.act});
  final Json record;
  final _Act act;

  @override
  ConsumerState<_ReceiptForm> createState() => _ReceiptFormState();
}

class _ReceiptFormState extends ConsumerState<_ReceiptForm> {
  final _acc = <String, TextEditingController>{};
  final _rej = <String, TextEditingController>{};
  final _why = <String, TextEditingController>{};
  final _serials = <String, Set<String>>{};
  final _note = TextEditingController();
  String? _error;
  bool _busy = false;

  List<Json> get _lines =>
      asList(widget.record['lineItems']).where((l) => ((l['received'] as num?) ?? 0) > 0).toList();

  @override
  void initState() {
    super.initState();
    for (final l in _lines) {
      final id = '${l['id']}';
      _acc[id] = TextEditingController(text: '${l['accepted'] ?? l['received']}');
      _rej[id] = TextEditingController(text: '${l['rejected'] ?? 0}');
      _why[id] = TextEditingController(text: '${l['rejectReason'] ?? ''}');
      _serials[id] = {for (final x in (l['rejectedSerials'] as List?) ?? const []) '$x'};
    }
  }

  @override
  void dispose() {
    for (final c in [..._acc.values, ..._rej.values, ..._why.values, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  String _name(Json l) =>
      '${l['description'] ?? l['itemName'] ?? l['name'] ?? l['itemCode'] ?? l['id']}';

  Future<void> _accept() async {
    final s = ref.read(stringsProvider);
    final lines = <Map<String, Object?>>[];
    for (final l in _lines) {
      final id = '${l['id']}';
      final a = _num(_acc[id]!.text);
      final r = _num(_rej[id]!.text) ?? 0;
      if (a == null || a < 0 || r < 0 || a + r != ((l['received'] as num?) ?? 0)) {
        setState(() => _error = s.afQtyAdd(_name(l)));
        return;
      }
      if (r > 0 && _why[id]!.text.trim().isEmpty) {
        setState(() => _error = s.afWhyRejected(_name(l)));
        return;
      }
      lines.add({
        'lineId': id,
        'acceptedQty': a,
        'rejectedQty': r,
        if (r > 0) 'reason': _why[id]!.text.trim(),
        'rejectedSerials': _serials[id]!.toList(),
      });
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    await widget.act(context, 'inspect', {
      'action': 'accept',
      if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      'lines': lines,
    });
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _reject() async {
    final s = ref.read(stringsProvider);
    final why = await _ask(context, s, title: s.afRejectAll, label: s.afWhy, go: s.afRejectAll);
    if (why == null || !mounted) return;
    setState(() => _busy = true);
    await widget.act(context, 'inspect', {'action': 'reject', 'note': why, 'lines': <Object>[]});
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final can = asJson(widget.record['can']);
    if (can.isNotEmpty && can['inspect'] == false) return Notice(text: s.afNotYours);
    return Column(
      key: const Key('afReceipt'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(s.afInspect),
        if (widget.record['committee'] is Map) ...[
          Notice(text: s.afCommittee),
          const SizedBox(height: Tokens.sp2),
        ],
        for (final l in _lines)
          Card(
            key: Key('afLine-${l['id']}'),
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(_name(l), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                  Text(s.afReceived('${l['received']}', '${l['uom'] ?? ''}')),
                  const SizedBox(height: Tokens.sp2),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: Key('afAccepted-${l['id']}'),
                          controller: _acc['${l['id']}'],
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: _box(s.afAccepted),
                        ),
                      ),
                      const SizedBox(width: Tokens.sp2),
                      Expanded(
                        child: TextField(
                          key: Key('afRejected-${l['id']}'),
                          controller: _rej['${l['id']}'],
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: _box(s.afRejected),
                          onChanged: (_) => setState(() {}),
                        ),
                      ),
                    ],
                  ),
                  if ((_num(_rej['${l['id']}']!.text) ?? 0) > 0) ...[
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: Key('afWhy-${l['id']}'),
                      controller: _why['${l['id']}'],
                      maxLength: 300,
                      decoration: _box(s.afWhy),
                    ),
                    if (((l['serials'] as List?) ?? const []).isNotEmpty)
                      Wrap(
                        spacing: Tokens.sp2,
                        children: [
                          for (final x in (l['serials'] as List))
                            FilterChip(
                              label: Text('$x'),
                              selected: _serials['${l['id']}']!.contains('$x'),
                              onSelected: (on) => setState(() {
                                if (on) {
                                  _serials['${l['id']}']!.add('$x');
                                } else {
                                  _serials['${l['id']}']!.remove('$x');
                                }
                              }),
                            ),
                        ],
                      ),
                  ],
                ],
              ),
            ),
          ),
        TextField(
          key: const Key('afNote'),
          controller: _note,
          maxLines: 2,
          maxLength: 1000,
          decoration: _box(s.afNote),
        ),
        if (_error != null) ErrorText(_error!),
        // one under the other: the words fit on a phone in either language
        FilledButton(
          key: const Key('afAcceptMarked'),
          onPressed: _busy ? null : _accept,
          child: Text(s.afAcceptMarked),
        ),
        const SizedBox(height: Tokens.sp2),
        OutlinedButton(
          key: const Key('afRejectAll'),
          onPressed: _busy ? null : _reject,
          child: Text(s.afRejectAll),
        ),
      ],
    );
  }
}

/// A condemnation: a committee member signs (or sends it back); the approver approves, rejects or sends back.
class _CondemnationForm extends ConsumerWidget {
  const _CondemnationForm({required this.record, required this.act});
  final Json record;
  final _Act act;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final can = asJson(record['can']);
    Future<void> withWhy(String action, String title) async {
      final why = await _ask(context, s, title: title, label: s.afWhy, go: title);
      if (why != null && context.mounted) {
        await act(context, 'decide', {'action': action, 'note': why});
      }
    }

    final buttons = <Widget>[
      if (can['sign'] == true)
        FilledButton(
          key: const Key('afSign'),
          style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
          onPressed: () => act(context, 'sign', {}),
          child: Text(s.sign),
        ),
      if (can['decide'] == true)
        FilledButton(
          key: const Key('afApprove'),
          style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
          onPressed: () => act(context, 'decide', {'action': 'approve'}),
          child: Text(s.approve),
        ),
      if (can['decide'] == true)
        OutlinedButton(
          key: const Key('afReject'),
          onPressed: () => withWhy('reject', s.reject),
          child: Text(s.reject),
        ),
      if (can['sendBack'] == true)
        OutlinedButton(
          key: const Key('afSendBack'),
          onPressed: () => withWhy('send_back', s.sendBack),
          child: Text(s.sendBack),
        ),
    ];
    if (buttons.isEmpty) return Notice(text: s.afNotYours);
    return Wrap(
      key: const Key('afCondemnation'),
      spacing: Tokens.sp2,
      runSpacing: Tokens.sp2,
      children: buttons,
    );
  }
}

/// A withdrawal's clearance for my department: clear or hold, the dues, remarks, documents (a charge where the
/// department has one); bypass where it is allowed.
class _WithdrawalForm extends ConsumerStatefulWidget {
  const _WithdrawalForm({required this.record, required this.act});
  final Json record;
  final _Act act;

  @override
  ConsumerState<_WithdrawalForm> createState() => _WithdrawalFormState();
}

class _WithdrawalFormState extends ConsumerState<_WithdrawalForm> {
  final _dues = <String, TextEditingController>{};
  final _remarks = <String, TextEditingController>{};
  final _charge = <String, TextEditingController>{};
  final _docs = <String, List<PickedFile>>{};
  bool _busy = false;

  List<Json> get _mine =>
      asList(widget.record['clearances']).where((c) => c['canAct'] == true).toList();

  @override
  void dispose() {
    for (final c in [..._dues.values, ..._remarks.values, ..._charge.values]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _send(Json c, String status) async {
    final s = ref.read(stringsProvider);
    final d = '${c['department']}';
    final docs = _docs[d] ?? const <PickedFile>[];
    if (status == 'cleared' && c['documentRequired'] == true && docs.isEmpty) {
      _say(context, s.addCertificate);
      return;
    }
    setState(() => _busy = true);
    try {
      final api = ref.read(apiProvider);
      final ids = [for (final f in docs) await uploadFile(api, ref.read(transportProvider), f)];
      if (!mounted) return;
      await widget.act(context, 'clear', {
        'department': d,
        'status': status,
        'dues': _num(_dues[d]?.text ?? '') ?? 0,
        if ((_remarks[d]?.text ?? '').trim().isNotEmpty) 'remarks': _remarks[d]!.text.trim(),
        'documents': [
          for (final id in ids) {'fileId': id},
        ],
        if (_charge[d] != null) 'charge': _num(_charge[d]!.text) ?? 0,
      });
    } catch (e) {
      if (mounted) _say(context, errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _bypass(String d) async {
    final s = ref.read(stringsProvider);
    final why = await _ask(context, s, title: s.afBypass, label: s.afWhy, go: s.afBypass);
    if (why != null && mounted) {
      await widget.act(context, 'bypass', {'department': d, 'reason': why});
    }
  }

  Future<void> _addDoc(String d) async {
    final picked = await ref.read(leaveFilePickerProvider)();
    if (!mounted || picked.isEmpty) return;
    setState(() => _docs[d] = [...?_docs[d], ...picked].take(5).toList());
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    if (_mine.isEmpty) return Notice(text: s.afNotYours);
    return Column(
      key: const Key('afWithdrawal'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final c in _mine)
          () {
            final d = '${c['department']}';
            _dues.putIfAbsent(d, () => TextEditingController(text: '${c['dues'] ?? 0}'));
            _remarks.putIfAbsent(d, TextEditingController.new);
            if (c['chargeKind'] != null && c['chargeMiscFeeId'] == null) {
              _charge.putIfAbsent(d, () => TextEditingController(text: '0'));
            }
            final check = asJson(c['check']);
            return Card(
              key: Key('afClearance-$d'),
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${c['departmentName'] ?? d}',
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                    if (check['detail'] != null) Text('${check['detail']}'),
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: Key('afDues-$d'),
                      controller: _dues[d],
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: _box(s.afDues),
                    ),
                    const SizedBox(height: Tokens.sp2),
                    if (_charge[d] != null) ...[
                      TextField(
                        controller: _charge[d],
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: _box(s.afCharge),
                      ),
                      const SizedBox(height: Tokens.sp2),
                    ],
                    TextField(
                      key: Key('afRemarks-$d'),
                      controller: _remarks[d],
                      maxLines: 2,
                      maxLength: 500,
                      decoration: _box(s.afRemarks),
                    ),
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp2,
                      children: [
                        for (final f in _docs[d] ?? const <PickedFile>[]) Chip(label: Text(f.name)),
                        OutlinedButton.icon(
                          key: Key('afDoc-$d'),
                          icon: const Icon(Icons.attach_file),
                          label: Text(c['documentRequired'] == true ? s.afDocNeeded : s.afDoc),
                          onPressed: _busy ? null : () => _addDoc(d),
                        ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp2),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            key: Key('afHold-$d'),
                            onPressed: _busy ? null : () => _send(c, 'hold'),
                            child: Text(s.afHold),
                          ),
                        ),
                        const SizedBox(width: Tokens.sp3),
                        Expanded(
                          child: FilledButton(
                            key: Key('afClear-$d'),
                            onPressed: _busy ? null : () => _send(c, 'cleared'),
                            child: Text(s.afClear),
                          ),
                        ),
                      ],
                    ),
                    if (c['bypassAllowed'] == true)
                      TextButton(
                        key: Key('afBypass-$d'),
                        onPressed: _busy ? null : () => _bypass(d),
                        child: Text(s.afBypass),
                      ),
                  ],
                ),
              ),
            );
          }(),
      ],
    );
  }
}

/// A student sent from another school: admit into a section with an admission number (roll number optional), or
/// refuse with a reason.
class _TransferForm extends ConsumerStatefulWidget {
  const _TransferForm({required this.record, required this.options, required this.act});
  final Json record;
  final Json options;
  final _Act act;

  @override
  ConsumerState<_TransferForm> createState() => _TransferFormState();
}

class _TransferFormState extends ConsumerState<_TransferForm> {
  String? _section;
  late final _adm = TextEditingController(text: '${widget.options['admissionNo'] ?? ''}');
  final _roll = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _adm.dispose();
    _roll.dispose();
    super.dispose();
  }

  Future<void> _admit() async {
    final s = ref.read(stringsProvider);
    if (_section == null) {
      setState(() => _error = s.afPickSection);
      return;
    }
    if (!RegExp(r'^[A-Za-z0-9/-]{1,40}$').hasMatch(_adm.text.trim())) {
      setState(() => _error = s.afAdmissionNo);
      return;
    }
    final roll = int.tryParse(_roll.text.trim());
    setState(() => _error = null);
    await widget.act(context, 'accept', {
      'classSectionId': _section,
      'admissionNo': _adm.text.trim(),
      'rollNo': ?roll,
    });
  }

  Future<void> _refuse() async {
    final s = ref.read(stringsProvider);
    final why = await _ask(context, s, title: s.afRefuse, label: s.afWhy, go: s.afRefuse, min: 1);
    if (why != null && mounted) await widget.act(context, 'reject', {'reason': why});
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final sections = asList(widget.options['sections']);
    return Column(
      key: const Key('afTransfer'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(s.afAdmit),
        DropdownMenu<String>(
          key: const Key('afSection'),
          label: Text(s.afSection),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          trailingIcon: dropArrow(s.afSection),
          selectedTrailingIcon: dropArrow(s.afSection, open: true),
          onSelected: (v) => setState(() => _section = v),
          dropdownMenuEntries: [
            for (final x in sections)
              DropdownMenuEntry(value: '${x['id']}', label: '${x['label']}'),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        TextField(
          key: const Key('afAdmissionNo'),
          controller: _adm,
          maxLength: 40,
          decoration: _box(s.afAdmissionNoLabel),
        ),
        TextField(
          key: const Key('afRollNo'),
          controller: _roll,
          keyboardType: TextInputType.number,
          decoration: _box(s.afRollNo),
        ),
        if (_error != null) ErrorText(_error!),
        const SizedBox(height: Tokens.sp2),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const Key('afRefuse'),
                onPressed: _refuse,
                child: Text(s.afRefuse),
              ),
            ),
            const SizedBox(width: Tokens.sp3),
            Expanded(
              child: FilledButton(
                key: const Key('afAdmitIt'),
                onPressed: _admit,
                child: Text(s.afAdmit),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// An ACR level: the questionnaire (a rating word per scale question, words, yes or no, files), and for a review
/// level the grade (and why when it differs), whether I agree with the level before, my remarks and the standard
/// remark lines; save, submit, or send it back.
class _AcrForm extends ConsumerStatefulWidget {
  const _AcrForm({required this.record, required this.act});
  final Json record;
  final _Act act;

  @override
  ConsumerState<_AcrForm> createState() => _AcrFormState();
}

class _AcrFormState extends ConsumerState<_AcrForm> {
  final _answers = <String, Object?>{};
  final _text = <String, TextEditingController>{};
  final _remarks = TextEditingController();
  final _gradeWhy = TextEditingController();
  String? _grade;
  String? _agreement;
  final _lines = <String>{};
  bool _busy = false;

  Json get _r => widget.record;
  Json get _can => asJson(asJson(_r['can'])['level']);
  int get _seq => (_can['seq'] as num?)?.toInt() ?? 0;
  Json get _level =>
      asList(_r['levels']).where((l) => (l['seq'] as num?)?.toInt() == _seq).firstOrNull ?? {};

  @override
  void initState() {
    super.initState();
    final l = _level;
    for (final e in asJson(l['answers']).entries) {
      _answers[e.key] = e.value;
    }
    _remarks.text = '${l['remarks'] ?? ''}';
    _gradeWhy.text = '${l['gradeReason'] ?? ''}';
    _grade = l['grade'] == null ? null : '${l['grade']}';
    _agreement = l['agreement'] == null ? null : '${l['agreement']}';
    _lines.addAll([for (final x in (l['remarkIds'] as List?) ?? const []) '$x']);
  }

  @override
  void dispose() {
    for (final c in [..._text.values, _remarks, _gradeWhy]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, Object?> _body() {
    for (final e in _text.entries) {
      _answers[e.key] = e.value.text.trim();
    }
    final review = _can['action'] == 'review';
    return {
      'seq': _seq,
      'answers': {
        for (final e in _answers.entries)
          if (e.value != null && e.value != '') e.key: e.value,
      },
      if (_remarks.text.trim().isNotEmpty) 'remarks': _remarks.text.trim(),
      if (review && _grade != null) 'grade': _grade,
      if (review && _gradeWhy.text.trim().isNotEmpty) 'gradeReason': _gradeWhy.text.trim(),
      if (review && _agreement != null) 'agreement': _agreement,
      if (_lines.isNotEmpty) 'remarkIds': _lines.toList(),
    };
  }

  Future<void> _go(String step) async {
    setState(() => _busy = true);
    await widget.act(context, step, _body(), done: step == 'submit');
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _sendBack() async {
    final s = ref.read(stringsProvider);
    final why = await _ask(context, s, title: s.sendBack, label: s.afWhy, go: s.sendBack, min: 5);
    if (why != null && mounted) await widget.act(context, 'send_back', {'reason': why});
  }

  /// a file for a file question: registered on the ACR (its own files, kept personal), sent, then answered
  Future<void> _addFile(String qid) async {
    final s = ref.read(stringsProvider);
    final have = [for (final x in (_answers[qid] as List?) ?? const []) '$x'];
    if (have.length >= 3) return;
    final picked = (await ref.read(leaveFilePickerProvider)()).firstOrNull;
    if (picked == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final r = await widget.act(
        context,
        'file',
        {
          'fileName': picked.name,
          'contentType': picked.contentType,
          'sizeBytes': picked.bytes.length,
          'classification': 'personal',
        },
        done: false,
        quiet: true,
      );
      final reg = asJson(r?['result']);
      final up = asJson(reg['upload']);
      final id = '${asJson(reg['file'])['id'] ?? ''}';
      if (id.isEmpty) return;
      await ref
          .read(transportProvider)
          .upload(
            '${up['url']}',
            picked.bytes,
            method: '${up['method'] ?? 'PUT'}',
            headers: {for (final e in asJson(up['headers']).entries) e.key: '${e.value}'},
          );
      try {
        await ref.read(apiProvider).filesComplete(id: id);
      } catch (_) {
        // already complete (the local store finishes it on upload)
      }
      if (mounted) setState(() => _answers[qid] = [...have, id]);
    } catch (e) {
      if (mounted) _say(context, errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _question(S s, Json q, List<String> scale, Color muted) {
    final id = '${q['id']}';
    final top = scale.length;
    return switch ('${q['kind']}') {
      'scale' => Wrap(
        spacing: Tokens.sp2,
        runSpacing: Tokens.sp1,
        children: [
          // the top word is the highest number (as the website's sheet counts it)
          for (var i = 0; i < top; i++)
            ChoiceChip(
              key: Key('afScale-$id-${top - i}'),
              label: Text(scale[i]),
              selected: _answers[id] == top - i,
              onSelected: (_) => setState(() => _answers[id] = top - i),
            ),
        ],
      ),
      'yesno' => SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'yes', label: Text(s.yes)),
          ButtonSegment(value: 'no', label: Text(s.no)),
        ],
        emptySelectionAllowed: true,
        selected: {if (_answers[id] != null) '${_answers[id]}'},
        onSelectionChanged: (v) => setState(() => _answers[id] = v.firstOrNull),
      ),
      'file' => Wrap(
        spacing: Tokens.sp2,
        runSpacing: Tokens.sp2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            s.afFiles(((_answers[id] as List?) ?? const []).length),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          OutlinedButton.icon(
            key: Key('afFile-$id'),
            icon: const Icon(Icons.attach_file),
            label: Text(s.afDoc),
            onPressed: _busy ? null : () => _addFile(id),
          ),
        ],
      ),
      _ => TextField(
        controller: _text.putIfAbsent(
          id,
          () => TextEditingController(text: '${_answers[id] ?? ''}'),
        ),
        maxLines: 3,
        maxLength: 4000,
        decoration: _box(s.afAnswer),
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    if (_seq == 0) return Notice(text: s.afNotYours);
    final scale = [for (final x in (_r['scale'] as List?) ?? const []) '$x'];
    final form = asJson(asJson(_r['forms'])['${_level['formId']}']);
    final review = _can['action'] == 'review';
    final finalLevel = _level['final'] == true;
    final bands = asList(_r['bands']);
    final lines = asList(_r['remarkLines'])
        .where((l) => _grade == null || l['grade'] == _grade)
        .toList();
    return Column(
      key: const Key('afAcr'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final sec in asList(form['sections'])) ...[
          SectionTitle('${sec['title']}'),
          for (final q in asList(sec['questions']))
            Padding(
              key: Key('afQ-${q['id']}'),
              padding: const EdgeInsets.only(bottom: Tokens.sp3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${q['text']}${q['required'] == true ? ' *' : ''}'),
                  const SizedBox(height: Tokens.sp1),
                  _question(s, q, scale, muted),
                ],
              ),
            ),
        ],
        if (review) ...[
          SectionTitle(s.afGrade),
          DropdownMenu<String>(
            key: const Key('afGrade'),
            label: Text(s.afGrade),
            expandedInsets: EdgeInsets.zero,
            initialSelection: _grade,
            trailingIcon: dropArrow(s.afGrade),
            selectedTrailingIcon: dropArrow(s.afGrade, open: true),
            onSelected: (v) => setState(() => _grade = v),
            dropdownMenuEntries: [
              for (final b in bands)
                DropdownMenuEntry(value: '${b['label']}', label: '${b['label']}'),
            ],
          ),
          const SizedBox(height: Tokens.sp2),
          TextField(
            key: const Key('afGradeWhy'),
            controller: _gradeWhy,
            maxLines: 2,
            maxLength: 1000,
            decoration: _box(s.afGradeWhy),
          ),
          Text(s.afAgreement),
          const SizedBox(height: Tokens.sp1),
          SegmentedButton<String>(
            key: const Key('afAgreement'),
            segments: [
              ButtonSegment(value: 'agree', label: Text(s.afAgree)),
              ButtonSegment(value: 'partly', label: Text(s.afPartly)),
              ButtonSegment(value: 'disagree', label: Text(s.afDisagree)),
            ],
            emptySelectionAllowed: true,
            selected: {?_agreement},
            onSelectionChanged: (v) => setState(() => _agreement = v.firstOrNull),
          ),
        ],
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('afAcrRemarks'),
          controller: _remarks,
          maxLines: 4,
          maxLength: 4000,
          decoration: _box(s.afRemarks),
        ),
        if (finalLevel && lines.isNotEmpty) ...[
          SectionTitle(s.afRemarkLines),
          for (final l in lines.take(20))
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _lines.contains('${l['id']}'),
              title: Text('${l['text']}'),
              onChanged: (on) => setState(() {
                if (on == true) {
                  _lines.add('${l['id']}');
                } else {
                  _lines.remove('${l['id']}');
                }
              }),
            ),
        ],
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            OutlinedButton(
              key: const Key('afSaveDraft'),
              onPressed: _busy ? null : () => _go('save'),
              child: Text(s.afSaveDraft),
            ),
            FilledButton(
              key: const Key('afSubmit'),
              style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
              onPressed: _busy ? null : () => _go('submit'),
              child: Text(s.afSubmit),
            ),
            if (asJson(_r['can'])['sendBack'] == true)
              TextButton(
                key: const Key('afAcrSendBack'),
                onPressed: _busy ? null : _sendBack,
                child: Text(s.sendBack),
              ),
          ],
        ),
      ],
    );
  }
}

/// An exit's no-dues: my department's dues (none: 0) and a note, then clear it.
class _NoDuesForm extends ConsumerStatefulWidget {
  const _NoDuesForm({required this.record, required this.act});
  final Json record;
  final _Act act;

  @override
  ConsumerState<_NoDuesForm> createState() => _NoDuesFormState();
}

class _NoDuesFormState extends ConsumerState<_NoDuesForm> {
  final _dues = <String, TextEditingController>{};
  final _note = <String, TextEditingController>{};

  @override
  void dispose() {
    for (final c in [..._dues.values, ..._note.values]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final mine = asList(widget.record['clearances'])
        .where((c) => c['status'] == 'pending' && c['mayClear'] == true)
        .toList();
    if (mine.isEmpty) return Notice(text: s.afNotYours);
    return Column(
      key: const Key('afNoDues'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final c in mine)
          () {
            final d = '${c['department']}';
            final dues = _dues.putIfAbsent(d, () => TextEditingController(text: '0'));
            final note = _note.putIfAbsent(d, TextEditingController.new);
            final check = asJson(c['check']);
            return Card(
              key: Key('afNoDue-$d'),
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${c['name'] ?? d}',
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                    if (check['detail'] != null) Text('${check['detail']}'),
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: Key('afNoDueAmount-$d'),
                      controller: dues,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: _box(s.afDues),
                    ),
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: Key('afNoDueNote-$d'),
                      controller: note,
                      maxLength: 500,
                      decoration: _box(s.afNote),
                    ),
                    FilledButton(
                      key: Key('afNoDueClear-$d'),
                      onPressed: () => widget.act(context, 'clear', {
                        'department': d,
                        'dues': _num(dues.text) ?? 0,
                        if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
                      }),
                      child: Text(s.afClearFor('${c['name'] ?? d}')),
                    ),
                  ],
                ),
              ),
            );
          }(),
      ],
    );
  }
}
