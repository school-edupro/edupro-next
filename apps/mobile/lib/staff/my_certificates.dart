import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/certificates.dart' show certificatePdf;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'office_parts.dart';

/// The words of My certificates (as the staff website's, in English and Hindi).
extension StaffCertWords on S {
  String _sc(String en, String hi) => hindi ? hi : en;

  String get scIntro => _sc(
    'Ask the school for an experience, service or visa certificate, and download the ones issued to you.',
    'विद्यालय से अनुभव, सेवा या वीज़ा प्रमाणपत्र माँगें, और आपको जारी प्रमाणपत्र डाउनलोड करें।',
  );
  String get scNotLinked => _sc(
    'Your sign-in is not linked to a staff record.',
    'आपका साइन-इन किसी कर्मचारी रिकॉर्ड से नहीं जुड़ा है।',
  );
  String get scAsk => _sc('Ask for a certificate', 'प्रमाणपत्र माँगें');
  String get scNoneOpen => _sc(
    'The school has not opened any certificate to requests.',
    'विद्यालय ने अभी किसी प्रमाणपत्र के लिए अनुरोध नहीं खोले हैं।',
  );
  String get scPurpose => _sc('Purpose', 'उद्देश्य');
  String get scCopies => _sc('Copies', 'प्रतियाँ');
  String get scNote =>
      _sc('A note for the office (optional)', 'कार्यालय के लिए टिप्पणी (वैकल्पिक)');
  String get scSend => _sc('Send the request', 'अनुरोध भेजें');
  String get scAsked => _sc(
    'Your request is sent. You will see here when it is ready.',
    'आपका अनुरोध भेज दिया गया। तैयार होने पर यहाँ दिखेगा।',
  );
  String get scWithdrawn => _sc('Request withdrawn.', 'अनुरोध वापस लिया गया।');
  String get scWithdrawAsk => _sc('Withdraw this request?', 'यह अनुरोध वापस लें?');
  String get scKeep => _sc('Keep it', 'रहने दें');
  String get scRequests => _sc('My requests', 'मेरे अनुरोध');
  String scStage(String st) => switch (st) {
    'waiting' => _sc('Waiting for approval', 'स्वीकृति की प्रतीक्षा में'),
    'fee' => _sc('Waiting for the fee', 'शुल्क की प्रतीक्षा में'),
    'ready' => _sc('Approved: being prepared', 'स्वीकृत: तैयार हो रहा है'),
    'issued' => _sc('Issued', 'जारी'),
    'rejected' => _sc('Not approved', 'स्वीकृत नहीं'),
    _ => _sc('Withdrawn', 'वापस लिया गया'),
  };
  String get scIssued => _sc('Issued to me', 'मुझे जारी');
  String get scNoneIssued =>
      _sc('No certificate issued to you yet.', 'अभी आपको कोई प्रमाणपत्र जारी नहीं हुआ।');
  String scDuplicate(int n) => _sc('duplicate $n', 'प्रतिलिपि $n');
  String get scNeedPurpose =>
      _sc('Write the purpose (at least 2 letters).', 'उद्देश्य लिखें (कम से कम 2 अक्षर)।');
}

/// My certificate requests and the certificates issued to me.
final staffCertsProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached(
    'staff-certs:${p.id}',
    () => ref.read(apiProvider).certificateRequestsMine(),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

Tone _tone(String st) => switch (st) {
  'waiting' || 'fee' => Tone.warning,
  'ready' => Tone.info,
  'issued' => Tone.success,
  'rejected' => Tone.danger,
  _ => Tone.neutral,
};

/// My certificates as on the staff website (docs/design/87, phase C): ask for an experience, service or visa
/// certificate (the form opening under the one tapped: purpose, copies, a note), see where each request is and
/// withdraw one not yet issued, and open the certificates issued to me as PDF. No web page.
class StaffCertificatesScreen extends ConsumerStatefulWidget {
  const StaffCertificatesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffCertificatesScreen> createState() => _StaffCertificatesScreenState();
}

class _StaffCertificatesScreenState extends ConsumerState<StaffCertificatesScreen> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();

  void _say(String text) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _withdraw(String id) async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.scWithdrawAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.scKeep)),
          FilledButton(
            key: const Key('scWithdrawYes'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.withdraw),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).certificateRequestsWithdraw(id: id);
      ref.invalidate(staffCertsProvider(widget.profile));
      _say(s.scWithdrawn);
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: LoadedList<Json>(
          value: ref.watch(staffCertsProvider(widget.profile)),
          refresh: () => ref.refresh(staffCertsProvider(widget.profile).future),
          children: (d) {
            final muted = officeMuted(context);
            final emp = d['employee'] == null ? null : asJson(d['employee']);
            final types = asList(d['types']).where((t) => t['audience'] == 'STAFF').toList();
            final requests = asList(d['requests'])
                .where(
                  (r) =>
                      emp != null &&
                      r['employeeId'] != null &&
                      '${r['employeeId']}' == '${emp['id']}',
                )
                .toList();
            final certs = asList(d['certificates']);
            final api = ref.read(apiProvider);
            return [
              Text(s.scIntro, style: TextStyle(color: muted, fontSize: 14)),
              if (emp == null)
                Padding(
                  padding: const EdgeInsets.only(top: Tokens.sp3),
                  child: Notice(text: s.scNotLinked),
                )
              else
                officeCard(context, s.scAsk, key: const Key('scAskCard'), [
                  if (types.isEmpty)
                    Text(s.scNoneOpen, style: TextStyle(color: muted))
                  else
                    for (final t in types)
                      _AskType(
                        key: Key('scType-${t['code']}'),
                        type: t,
                        onSent: () {
                          ref.invalidate(staffCertsProvider(widget.profile));
                          _say(s.scAsked);
                        },
                      ),
                ]),
              if (requests.isNotEmpty)
                officeCard(context, s.scRequests, key: const Key('scRequests'), [
                  for (final r in requests)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Tokens.sp2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${r['typeName']} · ${s.date('${r['createdAt'] ?? ''}'.split('T').first)}',
                            style: const TextStyle(fontWeight: Tokens.fwSemibold),
                          ),
                          const SizedBox(height: Tokens.sp1),
                          Wrap(
                            spacing: Tokens.sp2,
                            runSpacing: Tokens.sp1,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              StatusChip(s.scStage('${r['stage']}'), _tone('${r['stage']}')),
                              if (r['stage'] == 'waiting' || r['stage'] == 'ready')
                                TextButton(
                                  key: Key('scWithdraw-${r['id']}'),
                                  onPressed: () => _withdraw('${r['id']}'),
                                  child: Text(s.withdraw),
                                ),
                            ],
                          ),
                          if (r['decisionNote'] != null)
                            Text(
                              '${r['decisionNote']}',
                              style: TextStyle(color: muted, fontSize: 13),
                            ),
                        ],
                      ),
                    ),
                ]),
              officeCard(context, s.scIssued, key: const Key('scIssued'), [
                if (certs.isEmpty) Text(s.scNoneIssued, style: TextStyle(color: muted)),
                for (final c in certs)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Tokens.sp2),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${c['typeName']}',
                                style: const TextStyle(fontWeight: Tokens.fwSemibold),
                              ),
                              Text(
                                [
                                  '${c['number'] ?? ''}',
                                  if (((c['copyNo'] as num?) ?? 0) > 0)
                                    s.scDuplicate((c['copyNo'] as num).toInt()),
                                  s.date(c['issuedOn'] ?? ''),
                                ].join(' · '),
                                style: TextStyle(color: muted, fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                        OutlinedButton(
                          key: Key('scPdf-${c['id']}'),
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => FileScreen(
                                title: '${c['typeName']}',
                                load: () => certificatePdf(
                                  api,
                                  ref.read(transportProvider),
                                  s,
                                  id: '${c['id']}',
                                  award: false,
                                ),
                              ),
                            ),
                          ),
                          child: const Text('PDF'),
                        ),
                      ],
                    ),
                  ),
              ]),
            ];
          },
        ),
      ),
    );
  }
}

/// One certificate to ask for: tapped, the form opens under it — the purpose (the school's list, or in words), the
/// copies when more than one may be asked, a note for the office.
class _AskType extends ConsumerStatefulWidget {
  const _AskType({super.key, required this.type, required this.onSent});
  final Json type;
  final VoidCallback onSent;

  @override
  ConsumerState<_AskType> createState() => _AskTypeState();
}

class _AskTypeState extends ConsumerState<_AskType> {
  final _purpose = TextEditingController();
  final _note = TextEditingController();
  String? _chosen;
  int _copies = 1;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _purpose.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final purposes = [for (final p in (widget.type['purposes'] as List? ?? const [])) '$p'];
    final purpose = purposes.isEmpty ? _purpose.text.trim() : (_chosen ?? '');
    if (purpose.length < 2) return setState(() => _error = s.scNeedPurpose);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .certificateRequestsAsk(
            body: CertificateRequestDto(
              typeCode: '${widget.type['code']}',
              purpose: purpose,
              copies: _copies,
              note: _note.text.trim().isEmpty ? null : _note.text.trim(),
            ),
          );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _purpose.clear();
        _note.clear();
      });
      widget.onSent();
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final x = widget.type;
    final code = '${x['code']}';
    final purposes = [for (final p in (x['purposes'] as List? ?? const [])) '$p'];
    final maxCopies = ((x['maxCopies'] as num?) ?? 1).toInt();
    return Card(
      margin: const EdgeInsets.only(bottom: Tokens.sp2),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        title: Text('${x['name'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
        shape: const Border(),
        collapsedShape: const Border(),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp3, Tokens.sp2, Tokens.sp3, Tokens.sp3),
        children: [
          if (purposes.isNotEmpty)
            DropdownMenu<String>(
              key: Key('scPurpose-$code'),
              label: Text('${s.scPurpose} *'),
              trailingIcon: dropArrow(s.scPurpose),
              selectedTrailingIcon: dropArrow(s.scPurpose, open: true),
              expandedInsets: EdgeInsets.zero,
              enableFilter: true,
              enableSearch: true,
              requestFocusOnTap: true,
              onSelected: (v) => setState(() => _chosen = v),
              dropdownMenuEntries: [
                for (final p in purposes) DropdownMenuEntry(value: p, label: p),
              ],
            )
          else
            TextField(
              key: Key('scPurpose-$code'),
              controller: _purpose,
              maxLength: 200,
              decoration: InputDecoration(
                labelText: '${s.scPurpose} *',
                border: const OutlineInputBorder(),
                counterText: '',
              ),
            ),
          if (maxCopies > 1) ...[
            const SizedBox(height: Tokens.sp2),
            Row(
              children: [
                Expanded(child: Text(s.scCopies)),
                IconButton(
                  key: Key('scLess-$code'),
                  tooltip: '${s.scCopies} −',
                  icon: const Icon(Icons.remove_circle_outline),
                  onPressed: _copies > 1 ? () => setState(() => _copies -= 1) : null,
                ),
                Text('$_copies'),
                IconButton(
                  key: Key('scMore-$code'),
                  tooltip: '${s.scCopies} +',
                  icon: const Icon(Icons.add_circle_outline),
                  onPressed: _copies < maxCopies ? () => setState(() => _copies += 1) : null,
                ),
              ],
            ),
          ],
          const SizedBox(height: Tokens.sp2),
          TextField(
            key: Key('scNote-$code'),
            controller: _note,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: s.scNote,
              border: const OutlineInputBorder(),
              counterText: '',
            ),
          ),
          if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
          const SizedBox(height: Tokens.sp2),
          FilledButton(
            key: Key('scSend-$code'),
            onPressed: _busy ? null : _send,
            child: Text(s.scSend),
          ),
        ],
      ),
    );
  }
}
