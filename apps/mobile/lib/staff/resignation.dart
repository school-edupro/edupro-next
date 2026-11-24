import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'office_parts.dart';

/// The words of My resignation (as the staff website's, in English and Hindi).
extension ResignationWords on S {
  String _rs(String en, String hi) => hindi ? hi : en;

  String get rsTitle => _rs('My resignation', 'मेरा त्यागपत्र');
  String rsHead(String name, String code, String type, int days) => _rs(
    '$name ($code) · $type staff · notice period $days days',
    '$name ($code) · $type कर्मचारी · नोटिस अवधि $days दिन',
  );
  String get rsNotLinked => _rs(
    'Your sign-in is not linked to an employee record; ask the office.',
    'आपका साइन-इन किसी कर्मचारी रिकॉर्ड से नहीं जुड़ा है; कार्यालय से पूछें।',
  );
  String rsStatus(String st) => switch (st) {
    'pending' => _rs('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'sent_back' => _rs('Sent back to you', 'आपको वापस भेजा गया'),
    'approved' => _rs('Accepted', 'स्वीकार'),
    'rejected' => _rs('Not accepted', 'स्वीकार नहीं'),
    _ => _rs('Withdrawn', 'वापस लिया गया'),
  };
  String get rsAskedOn => _rs('Asked on', 'माँगा गया');
  String get rsLastDay => _rs('Last working day', 'अंतिम कार्य दिवस');
  String rsAccepted(String d) => _rs('$d (accepted)', '$d (स्वीकृत)');
  String rsProposed(String d) => _rs('$d (proposed)', '$d (प्रस्तावित)');
  String get rsNotice => _rs('Notice', 'नोटिस');
  String get rsWaived => _rs('Shortfall waived', 'कमी माफ़');
  String rsShort(int n, String d) =>
      _rs('$n days short (expected last day $d)', '$n दिन कम (अपेक्षित अंतिम दिन $d)');
  String get rsServed => _rs('Served in full', 'पूरा दिया');
  String get rsWaitingAt => _rs('Waiting at', 'किसके पास');
  String get rsApprovers => _rs('The approvers', 'अनुमोदक');
  String get rsReason => _rs('Reason', 'कारण');
  String get rsLetter => _rs('Letter', 'पत्र');
  String get rsMyLetter => _rs('My letter', 'मेरा पत्र');
  String get rsPapers => _rs('Papers', 'काग़ज़ात');
  String get rsAcceptance => _rs('Acceptance letter', 'स्वीकृति पत्र');
  String get rsFnf => _rs('Full and final statement', 'पूर्ण और अंतिम विवरण');
  String get rsFnfHelp => _rs('(opens once it is approved)', '(स्वीकृत होने पर खुलता है)');
  String get rsPapersHelp => _rs(
    'The relieving letter and the experience certificate are given by the office on your last day.',
    'कार्यमुक्ति पत्र और अनुभव प्रमाणपत्र कार्यालय आपके अंतिम दिन देता है।',
  );
  String rsNoDues(int done, int of) => _rs(
    'No-dues: $done of $of departments cleared',
    'बकाया नहीं: $of में से $done विभागों ने मंज़ूरी दी',
  );
  String rsClear(String name, bool cleared, String? dues) => _rs(
    '$name: ${cleared ? 'cleared' : 'waiting'}${dues != null ? ' · dues $dues' : ''}',
    '$name: ${cleared ? 'मंज़ूर' : 'प्रतीक्षा में'}${dues != null ? ' · बकाया $dues' : ''}',
  );
  String rsSentBack(String note) => _rs('Sent back: $note', 'वापस भेजा गया: $note');
  String get rsProposedDay => _rs('Proposed last working day', 'प्रस्तावित अंतिम कार्य दिवस');
  String get rsNewLetter =>
      _rs('A new letter (PDF or photo, optional)', 'नया पत्र (PDF या फ़ोटो, वैकल्पिक)');
  String get rsAttachLetter => _rs('Attach the letter', 'पत्र जोड़ें');
  String get rsRemoveLetter => _rs('Remove the letter', 'पत्र हटाएँ');
  String get rsLetterWrong => _rs(
    'A PDF or a photo (JPEG, PNG, WebP) up to 5 MB.',
    'PDF या फ़ोटो (JPEG, PNG, WebP), 5 MB तक।',
  );
  String get rsSendAgain => _rs('Send again', 'फिर भेजें');
  String rsWithdraw(String type) => _rs('Withdraw my ${type.toLowerCase()}', 'मेरा $type वापस लें');
  String get rsWithdrawAsk => _rs(
    'Withdraw it? It closes and the approvers are told.',
    'वापस लें? यह बंद होगा और अनुमोदकों को बताया जाएगा।',
  );
  String get rsKeep => _rs('Keep it', 'रहने दें');
  String get rsAsk => _rs('Ask for resignation', 'त्यागपत्र दें');
  String get rsType => _rs('Type', 'प्रकार');
  String rsDayHelp(int days, String d) => _rs(
    'With $days days of notice the last day is $d. An earlier day is a shortfall the school may waive.',
    '$days दिन की नोटिस से अंतिम दिन $d है। इससे पहले का दिन कमी है, जिसे विद्यालय माफ़ कर सकता है।',
  );
  String get rsLetterOptional =>
      _rs('Resignation letter (PDF or photo, optional)', 'त्यागपत्र (PDF या फ़ोटो, वैकल्पिक)');
  String get rsSend => _rs('Send for approval', 'स्वीकृति हेतु भेजें');
  String get rsAtOffice => _rs(
    'The school takes resignations at the office.',
    'विद्यालय कार्यालय में त्यागपत्र लेता है।',
  );
  String get rsEarlier => _rs('Earlier', 'पहले के');
  String rsEarlierLine(String type, String d, String st) =>
      _rs('$type asked on $d: $st', '$type, $d को माँगा: $st');
  String get rsNeedReason =>
      _rs('Write the reason (at least 3 letters).', 'कारण लिखें (कम से कम 3 अक्षर)।');
  String get rsSent => _rs('Sent for approval.', 'स्वीकृति हेतु भेजा गया।');
  String get rsResent => _rs('Sent for approval again.', 'फिर से स्वीकृति हेतु भेजा गया।');
  String get rsWithdrawn => _rs('Withdrawn.', 'वापस लिया गया।');
  String get rsPickDate => _rs('Pick a date', 'तिथि चुनें');
}

/// My exits (null: my sign-in has no employee record).
final myExitsProvider = FutureProvider.autoDispose.family<Json?, Profile>((ref, p) async {
  try {
    return asJson(await ref.read(apiProvider).exitsMine());
  } on ApiException catch (e) {
    if (e.status == 404) return null;
    rethrow;
  }
});

String? _str(Object? v) => v == null || '$v'.isEmpty ? null : '$v';

final _okLetter = RegExp(r'^(application/pdf|image/(png|jpeg|webp))$');

/// My resignation as on the staff website (docs/design/38, part 5): my notice period; the open request with where it
/// is (asked on, last day, notice, waiting at, reason, my letter), once accepted the papers and the no-dues, sent
/// back: change and send again; withdraw until accepted; otherwise ask for it; the earlier ones. No web page.
class ResignationScreen extends ConsumerStatefulWidget {
  const ResignationScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<ResignationScreen> createState() => _ResignationScreenState();
}

class _ResignationScreenState extends ConsumerState<ResignationScreen> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  final _reason = TextEditingController();
  String? _type;
  String? _lastDay;
  PickedFile? _letter;
  bool _busy = false;
  String? _error;
  String? _formFor;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _say(String text) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _pickLetter() async {
    final s = ref.read(stringsProvider);
    final picked = await ref.read(leaveFilePickerProvider)();
    if (picked.isEmpty) return;
    final f = picked.first;
    if (!_okLetter.hasMatch(f.contentType) || f.bytes.length > 5 * 1024 * 1024) {
      return setState(() => _error = s.rsLetterWrong);
    }
    setState(() {
      _letter = f;
      _error = null;
    });
  }

  Future<void> _pickDay(String? cur, String min) async {
    final first = DateTime.parse(min);
    final c = DateTime.tryParse(cur ?? '');
    final d = await showDatePicker(
      context: context,
      initialDate: c != null && !c.isBefore(first) ? c : first,
      firstDate: first,
      lastDate: first.add(const Duration(days: 730)),
    );
    if (d != null) setState(() => _lastDay = ymd(d));
  }

  Future<void> _send({String? resubmitId}) async {
    final s = ref.read(stringsProvider);
    final reason = _reason.text.trim();
    if (reason.length < 3) return setState(() => _error = s.rsNeedReason);
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      final letter = _letter == null
          ? null
          : await uploadFile(api, ref.read(transportProvider), _letter!);
      if (resubmitId != null) {
        await api.exitsResubmit(
          id: resubmitId,
          body: ExitEditDto(reason: reason, proposedLastDay: _lastDay, letterFileId: letter),
        );
      } else {
        await api.exitsApplyMine(
          body: MyExitDto(
            exitType: _type ?? '',
            reason: reason,
            proposedLastDay: _lastDay,
            letterFileId: letter,
          ),
        );
      }
      setState(() {
        _letter = null;
        _formFor = null;
        _reason.clear();
        _lastDay = null;
      });
      ref.invalidate(myExitsProvider(widget.profile));
      _say(resubmitId != null ? s.rsResent : s.rsSent);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withdraw(String id) async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.rsWithdrawAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.rsKeep)),
          FilledButton(
            key: const Key('rsWithdrawYes'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.withdraw),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref
          .read(apiProvider)
          .exitsWithdraw(
            id: id,
            body: const ExitWithdrawDto(reason: 'Withdrawn by the employee'),
          );
      ref.invalidate(myExitsProvider(widget.profile));
      _say(s.rsWithdrawn);
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  Widget _letterField(S s, String label) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(label, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
      const SizedBox(height: Tokens.sp1),
      if (_letter != null)
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: Tokens.sp2,
          children: [
            const Icon(Icons.attach_file, size: 18),
            Text(_letter!.name),
            TextButton(
              key: const Key('rsLetterOff'),
              onPressed: () => setState(() => _letter = null),
              child: Text(s.rsRemoveLetter),
            ),
          ],
        )
      else
        OutlinedButton.icon(
          key: const Key('rsLetter'),
          icon: const Icon(Icons.attach_file),
          label: Text(s.rsAttachLetter),
          onPressed: _pickLetter,
        ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: AsyncBody<Json?>(
          value: ref.watch(myExitsProvider(widget.profile)),
          retry: () => ref.invalidate(myExitsProvider(widget.profile)),
          data: (mine) {
            if (mine == null) {
              return ListView(
                padding: const EdgeInsets.all(Tokens.sp4),
                children: [Notice(text: s.rsNotLinked)],
              );
            }
            final muted = officeMuted(context);
            final emp = asJson(mine['employee']);
            final notice = (mine['noticeDays'] as num?)?.toInt() ?? 0;
            final types = asList(mine['types']);
            final rows = asList(mine['data']);
            final open = rows
                .where((x) => ['pending', 'sent_back', 'approved'].contains(x['status']))
                .firstOrNull;
            final earlier = rows.where((x) => x != open).toList();
            final today = ymd(DateTime.now());
            final expected = ymd(DateTime.now().add(Duration(days: notice)));
            final clearances = asList(mine['clearances']);
            return ListView(
              key: const Key('rsScreen'),
              padding: const EdgeInsets.all(Tokens.sp4),
              children: [
                Text(
                  s.rsHead(
                    '${emp['name'] ?? ''}',
                    '${emp['code'] ?? ''}',
                    '${emp['typeName'] ?? ''}',
                    notice,
                  ),
                  style: TextStyle(color: muted, fontSize: 14),
                ),
                if (open != null)
                  () {
                    final id = '${open['id']}';
                    final st = '${open['status']}';
                    final type = '${asJson(open['exitType'])['name'] ?? ''}';
                    final shortfall = (open['shortfallDays'] as num?)?.toInt() ?? 0;
                    if (_formFor != id && st == 'sent_back') {
                      // the form starts from what was sent (filled after this frame)
                      _formFor = id;
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        if (!mounted) return;
                        _reason.text = '${open['reason'] ?? ''}';
                        setState(() => _lastDay = _str(open['proposedLastDay']));
                      });
                    }
                    return officeCard(
                      context,
                      '$type: ${s.rsStatus(st)}',
                      key: const Key('rsOpen'),
                      [
                        FactLine(s.rsAskedOn, s.date(open['requestedOn'] ?? '')),
                        FactLine(
                          s.rsLastDay,
                          open['acceptedLastDay'] != null
                              ? s.rsAccepted(s.date(open['acceptedLastDay']))
                              : s.rsProposed(s.date(open['proposedLastDay'] ?? '')),
                        ),
                        if (((open['noticeDays'] as num?) ?? 0) > 0)
                          FactLine(
                            s.rsNotice,
                            open['noticeWaived'] == true
                                ? s.rsWaived
                                : shortfall > 0
                                ? s.rsShort(shortfall, s.date(open['expectedLastDay'] ?? ''))
                                : s.rsServed,
                          ),
                        if (st == 'pending')
                          FactLine(s.rsWaitingAt, '${open['waitingAt'] ?? s.rsApprovers}'),
                        FactLine(s.rsReason, '${open['reason'] ?? ''}'),
                        if (open['letterFileId'] != null)
                          Row(
                            children: [
                              Expanded(
                                child: Text(s.rsLetter, style: TextStyle(color: muted)),
                              ),
                              FileIcons(
                                label: s.rsMyLetter,
                                name: 'rsLetter-$id',
                                load: () => api.exitsLetter(id: id),
                              ),
                            ],
                          ),
                        if (st == 'approved') ...[
                          const SizedBox(height: Tokens.sp3),
                          Text(s.rsPapers, style: const TextStyle(fontWeight: Tokens.fwBold)),
                          Wrap(
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(s.rsAcceptance),
                              FileIcons(
                                label: s.rsAcceptance,
                                name: 'rsAcc-$id',
                                load: () => api.exitsLetterFile(id: id, kind: 'acceptance'),
                              ),
                            ],
                          ),
                          Wrap(
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(s.rsFnf),
                              FileIcons(
                                label: s.rsFnf,
                                name: 'rsFnf-$id',
                                load: () => api.exitsFnfFile(id: id),
                              ),
                              Text(s.rsFnfHelp, style: TextStyle(color: muted, fontSize: 13)),
                            ],
                          ),
                          Text(s.rsPapersHelp, style: TextStyle(color: muted, fontSize: 13)),
                          if (clearances.isNotEmpty) ...[
                            const SizedBox(height: Tokens.sp3),
                            Text(
                              s.rsNoDues(
                                clearances.where((x) => x['status'] == 'cleared').length,
                                clearances.length,
                              ),
                              style: const TextStyle(fontWeight: Tokens.fwBold),
                            ),
                            for (final x in clearances)
                              Text(
                                s.rsClear(
                                  '${x['name'] ?? x['department']}',
                                  x['status'] == 'cleared',
                                  ((x['dues'] as num?) ?? 0) > 0 ? s.money(x['dues']) : null,
                                ),
                              ),
                          ],
                        ],
                        if (st == 'sent_back') ...[
                          const SizedBox(height: Tokens.sp3),
                          officeNote(s.rsSentBack('${open['sentBackNote'] ?? ''}')),
                          const SizedBox(height: Tokens.sp3),
                          OfficePickField(
                            key: const Key('rsDay'),
                            label: s.rsProposedDay,
                            value: (_lastDay ?? '').isEmpty ? null : s.date(_lastDay!),
                            hint: s.rsPickDate,
                            onTap: () => _pickDay(_lastDay, '${open['requestedOn']}'),
                          ),
                          const SizedBox(height: Tokens.sp3),
                          TextField(
                            key: const Key('rsReason'),
                            controller: _reason,
                            maxLength: 1000,
                            minLines: 2,
                            maxLines: 5,
                            decoration: InputDecoration(
                              labelText: '${s.rsReason} *',
                              border: const OutlineInputBorder(),
                            ),
                          ),
                          _letterField(s, s.rsNewLetter),
                          if (_error != null) ErrorText(_error!),
                          const SizedBox(height: Tokens.sp2),
                          FilledButton(
                            key: const Key('rsResend'),
                            onPressed: _busy ? null : () => _send(resubmitId: id),
                            child: Text(s.rsSendAgain),
                          ),
                        ],
                        if (st == 'pending' || st == 'sent_back')
                          Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: TextButton(
                              key: const Key('rsWithdraw'),
                              onPressed: () => _withdraw(id),
                              child: Text(s.rsWithdraw(type)),
                            ),
                          ),
                      ],
                    );
                  }()
                else if (types.isNotEmpty)
                  officeCard(context, s.rsAsk, key: const Key('rsAskCard'), [
                    if (types.length > 1) ...[
                      DropdownMenu<String>(
                        key: const Key('rsType'),
                        label: Text(s.rsType),
                        trailingIcon: dropArrow(s.rsType),
                        selectedTrailingIcon: dropArrow(s.rsType, open: true),
                        expandedInsets: EdgeInsets.zero,
                        enableFilter: true,
                        enableSearch: true,
                        requestFocusOnTap: true,
                        initialSelection: _type ?? '${types.first['code']}',
                        onSelected: (v) => setState(() => _type = v),
                        dropdownMenuEntries: [
                          for (final t in types)
                            DropdownMenuEntry(value: '${t['code']}', label: '${t['name']}'),
                        ],
                      ),
                      const SizedBox(height: Tokens.sp3),
                    ],
                    OfficePickField(
                      key: const Key('rsDay'),
                      label: s.rsProposedDay,
                      value: s.date(_lastDay ?? expected),
                      onTap: () => _pickDay(_lastDay ?? expected, today),
                    ),
                    Text(
                      s.rsDayHelp(notice, s.date(expected)),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    const SizedBox(height: Tokens.sp3),
                    TextField(
                      key: const Key('rsReason'),
                      controller: _reason,
                      maxLength: 1000,
                      minLines: 2,
                      maxLines: 5,
                      decoration: InputDecoration(
                        labelText: '${s.rsReason} *',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    _letterField(s, s.rsLetterOptional),
                    if (_error != null) ErrorText(_error!),
                    const SizedBox(height: Tokens.sp2),
                    FilledButton(
                      key: const Key('rsSend'),
                      onPressed: _busy
                          ? null
                          : () {
                              _type ??= '${types.first['code']}';
                              _lastDay ??= expected;
                              _send();
                            },
                      child: Text(s.rsSend),
                    ),
                  ])
                else
                  Padding(
                    padding: const EdgeInsets.only(top: Tokens.sp3),
                    child: Notice(text: s.rsAtOffice),
                  ),
                if (earlier.isNotEmpty)
                  officeCard(context, s.rsEarlier, [
                    for (final x in earlier)
                      Padding(
                        padding: const EdgeInsets.only(bottom: Tokens.sp1),
                        child: Text(
                          '${s.rsEarlierLine('${asJson(x['exitType'])['name'] ?? ''}', s.date(x['requestedOn'] ?? ''), s.rsStatus('${x['status']}'))}${x['decisionNote'] != null ? ' · ${x['decisionNote']}' : ''}',
                        ),
                      ),
                  ]),
              ],
            );
          },
        ),
      ),
    );
  }
}
