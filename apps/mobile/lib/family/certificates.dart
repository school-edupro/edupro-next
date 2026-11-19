import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';
import 'fees.dart';

const _open = ['waiting', 'fee', 'ready'];

String _dmy(String iso) =>
    iso.length < 10 ? iso : '${iso.substring(8, 10)}-${iso.substring(5, 7)}-${iso.substring(0, 4)}';

/// A certificate's PDF: the school's copy when it is there, otherwise made and waited for (up to [wait]).
/// `award`: an achievement certificate of the earlier module.
Future<ApiFile> certificatePdf(
  EduProApi api,
  ApiTransport t,
  S s, {
  required String id,
  required bool award,
  Duration every = const Duration(seconds: 2),
  Duration wait = const Duration(seconds: 60),
}) async {
  final made = asJson(
    award
        ? await api.engagementPlusMyCertificatePdf(id: id)
        : await api.certificateRequestsMyPdf(id: id),
  );
  final exportId = '${made['exportId']}';
  final until = DateTime.now().add(wait);
  while (true) {
    final st = asJson(
      award
          ? await api.feesMyExport(id: exportId)
          : await api.certificateRequestsMyExport(id: exportId),
    );
    final url = asJson(st['download'])['url'];
    if (url is String) {
      return t.download(url, name: 'certificate.pdf', contentType: 'application/pdf');
    }
    if (asJson(st['export'])['status'] == 'failed') throw s.certPdfFailed;
    if (DateTime.now().isAfter(until)) throw s.pdfPreparing;
    await Future<void>.delayed(every);
  }
}

/// Certificates as the website shows them (apps/parent/app/(app)/certificates): the figures; the child's
/// certificates (awards marked), each PDF to view or save; the requests with where each is and what to do next
/// (pay the fee, withdraw), the closed ones folded; and the certificates to ask for, the form opening under the one
/// tapped.
class CertificatesScreen extends ConsumerStatefulWidget {
  const CertificatesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<CertificatesScreen> createState() => _CertificatesScreenState();
}

class _CertificatesScreenState extends ConsumerState<CertificatesScreen> {
  String? _message;
  String? _error;
  String _find = '';

  Profile get _p => widget.profile;

  void _done(String? message, {String? error}) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _error = error;
    });
    ref.invalidate(certificatesProvider(_p));
  }

  Future<void> _withdraw(Json r) async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.withdrawRequestAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.close)),
          FilledButton(
            key: const Key('confirmWithdraw'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.withdraw),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).certificateRequestsWithdraw(id: '${r['id']}');
      _done(s.requestWithdrawn);
    } catch (e) {
      _done(null, error: errorText(s, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return LoadedList<Json>(
      value: ref.watch(certificatesProvider(_p)),
      refresh: () => ref.refresh(certificatesProvider(_p).future),
      children: (d) {
        final mine = asJson(d['mine']);
        final awards = asList(d['awards']);
        final students = asList(mine['students']);
        final me =
            students.where((x) => '${x['id']}' == _p.studentId).firstOrNull ??
            (students.length == 1 ? students.first : null);
        bool forMe(Object? studentId) => me == null || '$studentId' == '${me['id']}';

        // your certificates: the register's, and any achievement record not in it
        final inRegister = {
          for (final c in asList(mine['certificates']))
            if (c['achievementId'] != null) '${c['achievementId']}',
        };
        final items = <Json>[
          for (final c in asList(mine['certificates']))
            if (forMe(c['studentId']))
              {
                'key': 'r${c['id']}',
                'id': '${c['id']}',
                'award': c['award'] == true,
                'pdfAward': false,
                'title': c['award'] == true && c['awardText'] != null
                    ? '${c['awardText']}'
                    : '${c['typeName']}',
                'person': '${c['person'] ?? ''}',
                'meta': [
                  if (c['award'] == true && c['awardText'] != null) '${c['typeName']}',
                  '${c['number'] ?? ''}',
                  if (((c['copyNo'] as num?) ?? 0) > 0) s.duplicateN((c['copyNo'] as num).toInt()),
                  _dmy('${c['issuedOn'] ?? ''}'),
                  if (c['purpose'] != null) '${c['purpose']}',
                  if (((c['revision'] as num?) ?? 1) > 1)
                    s.revisionN((c['revision'] as num).toInt()),
                ],
                'sort': '${c['issuedOn'] ?? ''}',
              },
          for (final a in awards)
            if (!inRegister.contains('${a['id']}') && forMe(a['studentId']))
              {
                'key': 'a${a['id']}',
                'id': '${a['id']}',
                'award': true,
                'pdfAward': true,
                'title': '${a['title'] ?? ''}',
                'person': '${a['student'] ?? ''}',
                'meta': [
                  '${a['serialNo'] ?? ''}',
                  _dmy('${a['issuedOn'] ?? ''}'),
                  if (a['text'] != null) '${a['text']}',
                ],
                'sort': '${a['issuedOn'] ?? ''}',
              },
        ]..sort((x, y) => '${y['sort']}'.compareTo('${x['sort']}'));

        final requests = asList(mine['requests']).where((r) => forMe(r['studentId'])).toList();
        final open = requests.where((r) => _open.contains(r['stage'])).toList();
        final closed = requests.where((r) => !_open.contains(r['stage'])).toList();
        final toPay = open.where((r) => r['stage'] == 'fee').length;
        final askable = me == null
            ? <Json>[]
            : asList(mine['types'])
                  .where(
                    (x) =>
                        x['audience'] == 'STUDENT' &&
                        (me['self'] == true ? x['forStudents'] == true : x['forParents'] == true),
                  )
                  .toList();
        final shown = _find.isEmpty
            ? askable
            : askable
                  .where(
                    (x) => '${x['name']} ${(x['purposes'] as List? ?? const []).join(' ')}'
                        .toLowerCase()
                        .contains(_find.toLowerCase()),
                  )
                  .toList();
        return [
          Text(s.certsHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
          if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
          if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
          FigureGrid(
            key: const Key('certFigures'),
            tiles: [
              FigureTile(
                label: s.readyFig,
                value: '${items.length}',
                icon: Icons.verified_outlined,
                tone: Tokens.statusSuccess,
              ),
              FigureTile(
                label: s.inProgress,
                value: '${open.length - toPay}',
                icon: Icons.hourglass_empty,
                tone: Tokens.statusInfo,
              ),
              FigureTile(
                label: s.toPayFig,
                value: '$toPay',
                icon: Icons.payments_outlined,
                tone: toPay > 0 ? Tokens.statusWarning : null,
              ),
              FigureTile(label: s.canAskFig, value: '${askable.length}', icon: Icons.add_card),
            ],
          ),
          SectionTitle(s.yourCertificates),
          if (items.isEmpty)
            EmptyLine('${s.noCertificates}${askable.isNotEmpty ? ' ${s.askBelow}' : ''}')
          else
            for (final c in items) _certRow(s, muted, c),
          if (requests.isNotEmpty) ...[
            SectionTitle(s.requestsTitle),
            if (open.isEmpty) EmptyLine(s.noRequestInProgress),
            for (final r in open) _requestRow(s, muted, r),
            if (closed.isNotEmpty)
              Card(
                clipBehavior: Clip.antiAlias,
                child: ExpansionTile(
                  key: const Key('earlierRequests'),
                  leading: const Icon(Icons.history_outlined),
                  title: Text(
                    s.earlierRequests(closed.length),
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                  shape: const Border(),
                  collapsedShape: const Border(),
                  expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [for (final r in closed) _requestRow(s, muted, r, flat: true)],
                ),
              ),
          ],
          if (askable.isNotEmpty && me != null) ...[
            SectionTitle(s.askTitle),
            Text(s.tapToAsk('${me['name'] ?? ''}'), style: TextStyle(color: muted, fontSize: 14)),
            const SizedBox(height: Tokens.sp2),
            if (askable.length > 5) ...[
              TextField(
                key: const Key('findCertificate'),
                decoration: InputDecoration(
                  labelText: s.findCertificate,
                  prefixIcon: const Icon(Icons.search),
                  border: const OutlineInputBorder(),
                ),
                onChanged: (v) => setState(() => _find = v.trim()),
              ),
              const SizedBox(height: Tokens.sp2),
              if (shown.isEmpty) EmptyLine(s.noCertMatches),
            ],
            for (final x in shown)
              _AskTile(
                key: ValueKey('ask-${x['code']}'),
                type: x,
                studentId: '${me['id']}',
                onSent: () => _done(s.requestSentCert),
              ),
          ],
        ];
      },
    );
  }

  Widget _certRow(S s, Color muted, Json c) {
    final id = '${c['id']}';
    final meta = [c['person'], ...(c['meta'] as List)].where((x) => '$x'.isNotEmpty).join(' · ');
    return Card(
      key: Key('cert-${c['key']}'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp3, Tokens.sp2, Tokens.sp3),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text('${c['title']}', style: const TextStyle(fontWeight: Tokens.fwBold)),
                      if (c['award'] == true) StatusChip(s.awardTag, Tone.info),
                    ],
                  ),
                  Text(meta, style: TextStyle(color: muted, fontSize: 13)),
                ],
              ),
            ),
            FileIcons(
              name: 'cert-${c['key']}',
              label: '${c['title']}',
              load: () => certificatePdf(
                ref.read(apiProvider),
                ref.read(transportProvider),
                s,
                id: id,
                award: c['pdfAward'] == true,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _requestRow(S s, Color muted, Json r, {bool flat = false}) {
    final stage = '${r['stage']}';
    final fee = num.tryParse('${r['fee'] ?? ''}');
    final copies = ((r['copies'] as num?) ?? 1).toInt();
    final withFee = fee != null && fee > 0;
    final order = ['Asked', 'Approved', if (withFee) 'Fee', 'Being made', 'Ready'];
    final at = switch (stage) {
      'waiting' => 1,
      'fee' => 2,
      'ready' => withFee ? 3 : 2,
      _ => order.length,
    };
    final body = Padding(
      key: Key('request-${r['id']}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('${r['typeName'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
              if (stage == 'rejected') StatusChip(s.notApproved, Tone.danger),
              if (stage == 'withdrawn') StatusChip(s.withdrawnTag, Tone.neutral),
              if (stage == 'issued') StatusChip(s.readyFig, Tone.success),
            ],
          ),
          Text(
            [
              '${r['person'] ?? ''}',
              s.askedOn(_dmy('${r['createdAt'] ?? ''}'.split('T').first)),
              if (r['purpose'] != null) '${r['purpose']}',
              if (copies > 1) s.copiesN(copies),
            ].where((x) => x.isNotEmpty).join(' · '),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (_open.contains(stage)) ...[
            const SizedBox(height: Tokens.sp2),
            Semantics(
              label: s.whereRequestIs,
              container: true,
              explicitChildNodes: true,
              child: Wrap(
                spacing: Tokens.sp1,
                runSpacing: Tokens.sp1,
                children: [
                  for (final (i, step) in order.indexed)
                    StatusChip(
                      s.certStep(step),
                      i < at
                          ? Tone.success
                          : i == at
                          ? Tone.warning
                          : Tone.neutral,
                    ),
                ],
              ),
            ),
          ],
          if (r['decisionNote'] != null)
            Text(
              s.noteFromSchool('${r['decisionNote']}'),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          if (stage == 'issued')
            Text(s.underYourCerts, style: TextStyle(color: muted, fontSize: 13)),
          if (stage == 'fee')
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp2),
              child: FilledButton(
                key: Key('payCert-${r['id']}'),
                onPressed: () => pushPage(context, s.fees, FeesScreen(profile: _p)),
                child: Text(s.payFee(withFee ? s.money(fee * (copies < 1 ? 1 : copies)) : '')),
              ),
            )
          else if (stage == 'waiting' || stage == 'ready')
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton(
                key: Key('withdrawCert-${r['id']}'),
                onPressed: () => _withdraw(r),
                child: Text(s.withdraw),
              ),
            ),
        ],
      ),
    );
    return flat ? body : Card(child: body);
  }
}

/// A certificate to ask for: its name, who decides, what it is for and its fee; tapped, the form opens under it
/// (purpose, copies, a note) and sends the request.
class _AskTile extends ConsumerStatefulWidget {
  const _AskTile({super.key, required this.type, required this.studentId, required this.onSent});
  final Json type;
  final String studentId;
  final VoidCallback onSent;

  @override
  ConsumerState<_AskTile> createState() => _AskTileState();
}

class _AskTileState extends ConsumerState<_AskTile> {
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
    if (purpose.length < 2) return setState(() => _error = s.purposeNeeded);
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
              studentId: widget.studentId,
              purpose: purpose,
              copies: _copies,
              note: _note.text.trim().isEmpty ? null : _note.text.trim(),
            ),
          );
      if (!mounted) return;
      setState(() => _busy = false);
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final x = widget.type;
    final code = '${x['code']}';
    final purposes = [for (final p in (x['purposes'] as List? ?? const [])) '$p'];
    final fee = num.tryParse('${x['fee'] ?? ''}');
    final maxCopies = ((x['maxCopies'] as num?) ?? 1).toInt();
    final deciders = [for (final w in (x['decidedBy'] as List? ?? const [])) '$w'];
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        key: Key('askType-$code'),
        title: Text('${x['name'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
        subtitle: Text(
          [
            s.decidedBy(deciders),
            if (purposes.isNotEmpty)
              s.forPurposes('${purposes.take(3).join(', ')}${purposes.length > 3 ? '…' : ''}'),
          ].join(' · '),
          style: TextStyle(color: muted, fontSize: 13),
        ),
        trailing: Text(
          fee != null && fee > 0 ? s.aCopy(s.money(fee)) : s.freeWord,
          style: const TextStyle(fontWeight: Tokens.fwSemibold),
        ),
        shape: const Border(),
        collapsedShape: const Border(),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp4),
        children: [
          if (purposes.isNotEmpty)
            DropdownMenu<String>(
              key: Key('purpose-$code'),
              label: Text(s.purposeLabel),
              trailingIcon: dropArrow(s.purposeLabel),
              selectedTrailingIcon: dropArrow(s.purposeLabel, open: true),
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
              key: Key('purpose-$code'),
              controller: _purpose,
              maxLength: 200,
              decoration: InputDecoration(
                labelText: s.purposeLabel,
                hintText: s.purposeHint,
                border: const OutlineInputBorder(),
                counterText: '',
              ),
            ),
          if (maxCopies > 1) ...[
            const SizedBox(height: Tokens.sp3),
            Row(
              children: [
                Expanded(child: Text(s.copiesLabel)),
                IconButton(
                  key: Key('copiesLess-$code'),
                  tooltip: '${s.copiesLabel} −',
                  icon: const Icon(Icons.remove_circle_outline),
                  onPressed: _copies > 1 ? () => setState(() => _copies -= 1) : null,
                ),
                Text('$_copies', key: Key('copies-$code')),
                IconButton(
                  key: Key('copiesMore-$code'),
                  tooltip: '${s.copiesLabel} +',
                  icon: const Icon(Icons.add_circle_outline),
                  onPressed: _copies < maxCopies ? () => setState(() => _copies += 1) : null,
                ),
              ],
            ),
          ],
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: Key('note-$code'),
            controller: _note,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: s.noteForSchool,
              border: const OutlineInputBorder(),
              counterText: '',
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          Text(
            '${fee != null && fee > 0 ? s.feeHelp(s.money(fee)) : s.noFee} ${s.decidedBy(deciders)}.',
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
          const SizedBox(height: Tokens.sp3),
          FilledButton(
            key: Key('sendCert-$code'),
            onPressed: _busy ? null : _send,
            child: Text(s.sendRequest),
          ),
        ],
      ),
    );
  }
}
