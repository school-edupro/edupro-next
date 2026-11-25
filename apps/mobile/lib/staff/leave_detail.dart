import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/paged_feed.dart' show feedRoundProvider;
import '../ui/widgets.dart';
import 'data.dart';
import 'leave_page.dart';
import 'my_leave.dart' show staffLeaveTone;

/// One leave as the website's leave page (`/leave/requests/:id`, the same check: the employee, the approvers, the
/// reporting manager, the leave office).
final leaveDetailProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async {
  return asJson(await ref.watch(apiProvider).staffLeaveGet(id: id));
});

/// A leave's details in the app (no web page): its figures (days, from, to, applied), where it waits, what I may
/// do (withdraw, ask to cancel, approve or reject, decide a cancellation), the leave's facts and its document; then
/// folded — open while they matter — the days counted, who approves, the cancellation and the changes.
class LeaveDetailScreen extends ConsumerStatefulWidget {
  const LeaveDetailScreen({super.key, required this.profile, required this.id});
  final Profile profile;
  final String id;

  @override
  ConsumerState<LeaveDetailScreen> createState() => _LeaveDetailScreenState();
}

class _LeaveDetailScreenState extends ConsumerState<LeaveDetailScreen> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final async = ref.watch(leaveDetailProvider(widget.id));
    return FamilyPage(
      title: s.ldTitle,
      child: async.when(
        loading: () =>
            const Padding(padding: EdgeInsets.all(Tokens.sp4), child: LinearProgressIndicator()),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(Tokens.sp4),
          child: ErrorText(
            e is ApiException && (e.status == 404 || e.status == 403)
                ? s.ldNotFound
                : errorText(s, e),
          ),
        ),
        data: (d) => _body(context, s, d),
      ),
    );
  }

  Widget _body(BuildContext context, S s, Json d) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final type = asJson(d['leaveType']);
    final emp = asJson(d['employee']);
    final status = '${d['status']}';
    final can = asJson(d['can']);
    final days = asList(d['dayRows']);
    final approval = asList(d['approval']);
    final cancellation = asList(d['cancellation']);
    final changes = asList(d['changes']);
    final lop = d['lopPart'] is Map ? asJson(d['lopPart']) : null;
    final applied = d['appliedAt'] == null ? null : DateTime.parse('${d['appliedAt']}');
    final number = '${d['number'] ?? ''}';
    final actions = <Widget>[
      if (can['withdraw'] == true)
        OutlinedButton(
          key: const Key('ldWithdraw'),
          onPressed: _busy ? null : () => _withdraw(d),
          child: Text(s.withdraw),
        ),
      if (can['requestCancel'] == true)
        OutlinedButton(
          key: const Key('ldAskCancel'),
          onPressed: _busy ? null : () => _askCancel(d),
          child: Text(s.askCancel),
        ),
      if (can['decide'] == true) ...[
        FilledButton(
          key: const Key('ldApprove'),
          style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
          onPressed: _busy ? null : () => _decide(d, 'approved', false),
          child: Text(s.lvApprove),
        ),
        OutlinedButton(
          key: const Key('ldReject'),
          onPressed: _busy ? null : () => _reject(d, false),
          child: Text(s.lvReject),
        ),
      ] else if (can['decideCancel'] == true) ...[
        FilledButton(
          key: const Key('ldApprove'),
          style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
          onPressed: _busy ? null : () => _decide(d, 'approved', true),
          child: Text(s.lvApproveCancel),
        ),
        OutlinedButton(
          key: const Key('ldReject'),
          onPressed: _busy ? null : () => _reject(d, true),
          child: Text(s.lvRejectCancel),
        ),
      ],
    ];
    return RefreshIndicator(
      onRefresh: () => ref.refresh(leaveDetailProvider(widget.id).future),
      child: ListView(
        key: const Key('ldScreen'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Semantics(
            header: true,
            child: Text(
              '$number · ${type['name'] ?? ''}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
          Text(
            '${emp['name'] ?? ''} (${emp['code'] ?? ''})'
            '${emp['department'] == null ? '' : ' · ${emp['department']}'}',
            style: TextStyle(color: muted),
          ),
          const SizedBox(height: Tokens.sp2),
          Align(
            alignment: Alignment.centerLeft,
            child: StatusChip(s.staffLeaveStatus(status), staffLeaveTone(status)),
          ),
          const SizedBox(height: Tokens.sp3),
          FigureGrid(
            key: const Key('ldFigures'),
            tiles: [
              FigureTile(label: s.ldDays, value: '${d['days'] ?? ''}', icon: Icons.event_outlined),
              FigureTile(
                label: s.ldApplied,
                value: applied == null ? '—' : s.date(ymd(applied.toLocal())),
                icon: Icons.edit_calendar_outlined,
              ),
              FigureTile(label: s.lvFrom, value: s.date('${d['from']}'), icon: Icons.today),
              FigureTile(label: s.lvTo, value: s.date('${d['to']}'), icon: Icons.event),
            ],
          ),
          if (status == 'pending' && d['waitingWith'] != null) ...[
            const SizedBox(height: Tokens.sp3),
            Notice(text: s.ldWaitingWith('${d['waitingWith']}', d['level'], d['levels'])),
          ],
          if (d['cancelStatus'] == 'pending') ...[
            const SizedBox(height: Tokens.sp3),
            Notice(text: s.ldCancelAsked('${d['cancelReason'] ?? ''}')),
          ],
          if (actions.isNotEmpty) ...[
            const SizedBox(height: Tokens.sp3),
            Wrap(
              key: const Key('ldActions'),
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: actions,
            ),
          ],
          SectionTitle(s.ldTheLeave),
          Card(
            key: const Key('ldFacts'),
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FactLine(s.ldType, '${type['code'] ?? ''} — ${type['name'] ?? ''}'),
                  if (d['halfDay'] == true) FactLine(s.ldDays, s.lvHalf('${d['session']}')),
                  FactLine(
                    s.ldEntered,
                    [
                      s.ldSource('${d['source']}'),
                      if (d['appliedBy'] != null) '${d['appliedBy']}',
                      if (applied != null) s.dateTime(applied),
                    ].join(' · '),
                  ),
                  if ('${d['reason'] ?? ''}'.isNotEmpty) ...[
                    const SizedBox(height: Tokens.sp2),
                    Text(s.reason, style: TextStyle(color: muted, fontSize: 14)),
                    Text('${d['reason']}', key: const Key('ldReason')),
                  ],
                  if (d['note'] != null) ...[
                    const SizedBox(height: Tokens.sp2),
                    Text(s.ldCounted, style: TextStyle(color: muted, fontSize: 14)),
                    Text('${d['note']}'),
                  ],
                  if (lop != null) ...[
                    const SizedBox(height: Tokens.sp2),
                    Text(s.ldLop, style: TextStyle(color: muted, fontSize: 14)),
                    Text(s.ldLopText('${lop['number'] ?? ''}', '${lop['days'] ?? ''}')),
                  ],
                  if (d['decidedBy'] != null) ...[
                    const SizedBox(height: Tokens.sp2),
                    Text(s.ldDecided, style: TextStyle(color: muted, fontSize: 14)),
                    Text(
                      [
                            '${d['decidedBy']}',
                            if (d['decidedAt'] != null)
                              s.dateTime(DateTime.parse('${d['decidedAt']}')),
                          ].join(', ') +
                          (d['decisionNote'] == null ? '' : ' — ${d['decisionNote']}'),
                    ),
                  ],
                  if (d['documentFileId'] != null) ...[
                    const SizedBox(height: Tokens.sp2),
                    Row(
                      children: [
                        Expanded(
                          child: Text(s.ldDocument, style: TextStyle(color: muted, fontSize: 14)),
                        ),
                        FileIcons(
                          label: s.ldDocumentOf(number),
                          name: 'ldDocument',
                          load: () => _document(number),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          if (days.isNotEmpty)
            _Fold(
              keyName: 'ldDays',
              icon: Icons.calendar_month_outlined,
              title: s.ldDaysCounted(days.length),
              children: [
                for (final x in days)
                  _Line(
                    text: [
                      s.date('${x['day']}'),
                      if (((x['portion'] as num?) ?? 1) < 1) s.lvHalf('${x['session']}'),
                      if (s.ldDayKind('${x['kind']}').isNotEmpty) s.ldDayKind('${x['kind']}'),
                      if ('${x['status']}' != status) s.staffLeaveStatus('${x['status']}'),
                    ].join(' · '),
                  ),
              ],
            ),
          if (approval.isNotEmpty)
            _Fold(
              keyName: 'ldApproval',
              icon: Icons.how_to_reg_outlined,
              title: s.ldWhoApproves(approval.length),
              open: status == 'pending',
              children: [for (final x in approval) _Step(step: x)],
            ),
          if (cancellation.isNotEmpty)
            _Fold(
              keyName: 'ldCancellation',
              icon: Icons.event_busy_outlined,
              title: s.ldCancellation,
              open: d['cancelStatus'] == 'pending',
              children: [for (final x in cancellation) _Step(step: x)],
            ),
          if (changes.isNotEmpty)
            _Fold(
              keyName: 'ldChanges',
              icon: Icons.history_outlined,
              title: s.ldChanges(changes.length),
              children: [
                for (final x in changes)
                  _Line(
                    text: '${x['from']} → ${x['to']}: ${x['reason']}',
                    sub: '${x['by'] ?? s.ldOffice}, ${s.dateTime(DateTime.parse('${x['at']}'))}',
                  ),
              ],
            ),
        ],
      ),
    );
  }

  /// the document, its address asked afresh (the same check as the leave), fetched for the viewer
  Future<ApiFile> _document(String number) async {
    final r = asJson(await ref.read(apiProvider).staffLeaveDocument(id: widget.id));
    final f = asJson(r['file']);
    final url = '${asJson(r['download'])['url'] ?? ''}';
    return ref
        .read(transportProvider)
        .download(url, name: '${f['originalName'] ?? 'leave-$number.pdf'}');
  }

  /// the lists the leave shows in, and this page, read again
  void _refresh() {
    ref.invalidate(leaveDetailProvider(widget.id));
    ref.read(feedRoundProvider('my-leave').notifier).bump();
    ref.invalidate(myLeaveProvider(widget.profile));
    ref.read(feedRoundProvider('team-leave').notifier).bump();
    ref.invalidate(leaveMenuProvider(widget.profile));
  }

  Future<void> _run(Future<void> Function() call, String done) async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      await call();
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(done)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withdraw(Json d) async {
    final s = ref.read(stringsProvider);
    final why = await leaveReasonDialog(
      context,
      s,
      title: '${s.withdraw} ${d['number'] ?? ''}',
      label: s.reason,
      confirm: s.withdraw,
      required: false,
    );
    if (why == null) return;
    await _run(
      () => ref
          .read(apiProvider)
          .staffLeaveWithdraw(
            id: widget.id,
            body: StaffLeaveWithdrawDto(reason: why),
          ),
      s.done,
    );
  }

  Future<void> _askCancel(Json d) async {
    final s = ref.read(stringsProvider);
    final why = await leaveReasonDialog(
      context,
      s,
      title: '${s.askCancel} ${d['number'] ?? ''}',
      label: s.reason,
      confirm: s.send,
    );
    if (why == null) return;
    await _run(
      () => ref
          .read(apiProvider)
          .staffLeaveRequestCancel(
            id: widget.id,
            body: StaffLeaveReasonDto(reason: why),
          ),
      s.lvSent,
    );
  }

  Future<void> _reject(Json d, bool cancellation) async {
    final s = ref.read(stringsProvider);
    final why = await leaveReasonDialog(
      context,
      s,
      title: s.lvRejectTitle('${d['number'] ?? ''}'),
      body: s.lvRejectBody('${asJson(d['employee'])['name'] ?? ''}', cancellation),
      label: s.lvWhy,
      confirm: s.lvDoNotApprove,
    );
    if (why == null) return;
    await _decide(d, 'rejected', cancellation, note: why);
  }

  Future<void> _decide(Json d, String outcome, bool cancellation, {String? note}) async {
    final s = ref.read(stringsProvider);
    final body = StaffLeaveDecideDto(outcome: outcome, note: note);
    final api = ref.read(apiProvider);
    await _run(
      () async => cancellation
          ? await api.staffLeaveDecideCancel(id: widget.id, body: body)
          : await api.staffLeaveDecide(id: widget.id, body: body),
      outcome == 'approved' ? s.lvApproved : s.lvRejected,
    );
  }
}

/// A folded card: its title says what is inside (and how many); open while it matters.
class _Fold extends StatelessWidget {
  const _Fold({
    required this.keyName,
    required this.icon,
    required this.title,
    required this.children,
    this.open = false,
  });
  final String keyName;
  final IconData icon;
  final String title;
  final List<Widget> children;
  final bool open;

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: Tokens.sp3),
    clipBehavior: Clip.antiAlias,
    child: ExpansionTile(
      key: Key(keyName),
      leading: Icon(icon),
      title: Text(title, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
      initiallyExpanded: open,
      shape: const Border(),
      collapsedShape: const Border(),
      childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp3),
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

class _Line extends StatelessWidget {
  const _Line({required this.text, this.sub});
  final String text;
  final String? sub;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(text),
        if (sub != null)
          Text(
            sub!,
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13),
          ),
      ],
    ),
  );
}

/// A level of the approval: its name, who sits there, its state, who acted and when, the remark.
class _Step extends ConsumerWidget {
  const _Step({required this.step});
  final Json step;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final st = '${step['status']}';
    final tone = switch (st) {
      'approved' => Tone.success,
      'rejected' => Tone.danger,
      'pending' => Tone.warning,
      _ => Tone.neutral,
    };
    final people = [for (final p in (step['people'] as List?) ?? const []) '$p'];
    return Padding(
      key: Key('ldStep-${step['level']}'),
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                '${step['level']}. ${step['name'] ?? ''}',
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
              StatusChip(s.ldStep(st), tone),
              if (step['overdue'] == true && st == 'pending')
                Text(s.ldOverdue, style: TextStyle(color: muted, fontSize: 13)),
            ],
          ),
          Text(people.isEmpty ? '—' : people.join(', ')),
          if (step['actedBy'] != null)
            Text(
              [
                '${step['actedBy']}',
                if (step['actedAt'] != null) s.dateTime(DateTime.parse('${step['actedAt']}')),
              ].join(', '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          if ('${step['note'] ?? ''}'.isNotEmpty) Text('${step['note']}'),
        ],
      ),
    );
  }
}
