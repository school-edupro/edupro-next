import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/paged_feed.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of Student leave (as the staff website's, in English and Hindi).
extension StudentLeaveWords on S {
  String _sl(String en, String hi) => hindi ? hi : en;

  String slInboxTab(int n) => _sl('To approve · $n', 'स्वीकृति हेतु · $n');
  String get slAllTab => _sl('All that came to me', 'मेरे पास आई सभी');
  String get slHelp => _sl(
    'Leave the families applied for that waits for your approval.',
    'परिवारों द्वारा माँगी गई छुट्टी जो आपकी स्वीकृति की प्रतीक्षा में है।',
  );
  String get slNoneInbox =>
      _sl('No leave waits for your approval.', 'कोई छुट्टी आपकी स्वीकृति की प्रतीक्षा में नहीं।');
  String get slNoneAll => _sl('Nothing here yet.', 'अभी यहाँ कुछ नहीं।');
  String get slNotYours => _sl(
    'Approving student leave is not part of your role.',
    'विद्यार्थी की छुट्टी स्वीकृत करना आपकी भूमिका में नहीं है।',
  );
  String get slOpen => _sl('Open', 'खोलें');
  String slDays(int n) => n == 1 ? _sl('1 day', '1 दिन') : _sl('$n days', '$n दिन');
  String get slLong => _sl('long leave', 'लंबी छुट्टी');
  String get slReason => _sl('Reason', 'कारण');
  String get slCertificate => _sl('Certificate', 'प्रमाण पत्र');
  String get slNoFile => _sl('None attached', 'कुछ संलग्न नहीं');
  String slAttachment(int n, String number) =>
      _sl('attachment $n of $number', '$number का संलग्नक $n');
  String get slApprovals => _sl('Approvals', 'स्वीकृतियाँ');
  String slWaiting(String who) => _sl('Waiting: $who', 'प्रतीक्षा: $who');
  String slStatus(String status) => switch (status) {
    'approved' => _sl('approved', 'स्वीकृत'),
    'rejected' => _sl('not approved', 'अस्वीकृत'),
    'cancelled' => _sl('cancelled', 'रद्द'),
    _ => _sl('pending', 'लंबित'),
  };
  String slStep(Json a) {
    final by = '${a['actedBy'] ?? ''}';
    final line = switch ('${a['status']}') {
      'approved' => _sl('approved by $by', '$by द्वारा स्वीकृत'),
      'rejected' => _sl('not approved by $by', '$by द्वारा अस्वीकृत'),
      'pending' => _sl(
        'waiting for ${a['approvers'] ?? 'the approver'}',
        '${a['approvers'] ?? 'स्वीकर्ता'} की प्रतीक्षा',
      ),
      'skipped' => '${a['note'] ?? _sl('skipped', 'छोड़ा गया')}',
      _ => _sl('next', 'अगला'),
    };
    final note = a['note'] != null && a['status'] != 'skipped' ? ' · “${a['note']}”' : '';
    return '${a['label']}: $line$note';
  }

  String get slNote => _sl('Note (needed when not approving)', 'टिप्पणी (अस्वीकार करने पर आवश्यक)');
  String get slApprove => _sl('Approve', 'स्वीकृत करें');
  String get slReject => _sl('Do not approve', 'स्वीकृत न करें');
  String get slNeedNote => _sl('Write why it is not approved.', 'लिखें कि क्यों स्वीकृत नहीं।');
  String get slApproved => _sl('Approved at your level.', 'आपके स्तर पर स्वीकृत।');
  String get slRejected => _sl(
    'Not approved. The family sees it in the portal.',
    'अस्वीकृत। परिवार इसे पोर्टल में देखेगा।',
  );
}

final studentLeaveProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).leaveGet(id: id)),
);

String _short(S s, Object? d) {
  final x = DateTime.tryParse('$d');
  return x == null ? '$d' : s.dayShort(x);
}

/// 19 Nov · 1 day, or 19 Nov to 21 Nov · 3 days
String _span(S s, Json l) => l['fromDate'] == l['toDate']
    ? '${_short(s, l['fromDate'])} · ${s.slDays(1)}'
    : '${_short(s, l['fromDate'])} – ${_short(s, l['toDate'])} · ${s.slDays((l['days'] as num?)?.toInt() ?? 0)}';

Color _tint(String status) => switch (status) {
  'approved' => Tokens.mobGreen50,
  'rejected' => Tokens.mobRed50,
  'cancelled' => Tokens.mobGray100,
  _ => Tokens.mobAmber50,
};

String _statusWord(S s, Json l) => l['status'] == 'pending' && l['waitingOn'] != null
    ? s.slWaiting('${l['waitingOn']}')
    : s.slStatus('${l['status']}');

/// Student leave for the teacher as on the staff website: what waits for their approval, and all that came to them.
/// An approved leave shows as LV in the class and the bus roll. No web page.
class StudentLeaveScreen extends ConsumerStatefulWidget {
  const StudentLeaveScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StudentLeaveScreen> createState() => _StudentLeaveScreenState();
}

class _StudentLeaveScreenState extends ConsumerState<StudentLeaveScreen> {
  /// how many wait on me (each page of either list says)
  int _waiting = 0;

  void _onAnswer(Json a) {
    final n = (a['inbox'] as num?)?.toInt() ?? 0;
    if (mounted && n != _waiting) setState(() => _waiting = n);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final profile = widget.profile;
    final waiting = _waiting;
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('slTabs'),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: s.slInboxTab(waiting)),
                Tab(text: s.slAllTab),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _List(profile: profile, tab: 'inbox', onAnswer: _onAnswer),
                _List(profile: profile, tab: 'all', onAnswer: _onAnswer),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One list — `inbox` (waiting on me) or `all` (all that came to me) — the latest 10 first (those waiting on top), 10
/// more as the teacher scrolls (as the staff website).
class _List extends ConsumerStatefulWidget {
  const _List({required this.profile, required this.tab, required this.onAnswer});
  final Profile profile;
  final String tab;
  final void Function(Json answer) onAnswer;

  @override
  ConsumerState<_List> createState() => _ListState();
}

class _ListState extends ConsumerState<_List> {
  /// Student leave is not open to this person (403)
  bool _notYours = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final round = ref.watch(feedRoundProvider('student-leaves'));
    final tab = widget.tab;
    return PagedFeed(
      key: ValueKey('slFeed-$tab-$round'),
      firstCacheKey: 'student-leaves-feed:${widget.profile.id}:$tab',
      load: (page) async {
        try {
          return await ref.read(apiProvider).leaveList(tab: tab, page: page, size: 10);
        } on ApiException catch (e) {
          if (e.status == 403) {
            return {
              'data': <Object>[],
              'page': {'total': 0},
              'notYours': true,
            };
          }
          rethrow;
        }
      },
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      onAnswer: (a) {
        if (mounted && _notYours != (a['notYours'] == true)) {
          setState(() => _notYours = a['notYours'] == true);
        }
        widget.onAnswer(a);
      },
      header: (_, _) => [
        Text(s.slHelp, style: const TextStyle(fontSize: 13)),
        const SizedBox(height: Tokens.sp3),
      ],
      empty: tab == 'inbox' ? s.slNoneInbox : s.slNoneAll,
      emptyCard: Notice(
        text: _notYours ? s.slNotYours : (tab == 'inbox' ? s.slNoneInbox : s.slNoneAll),
      ),
      item: (context, l, _) => _LeaveCard(profile: widget.profile, leave: l),
    );
  }
}

class _LeaveCard extends ConsumerWidget {
  const _LeaveCard({required this.profile, required this.leave});
  final Profile profile;
  final Json leave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final l = leave;
    final id = '${l['id']}';
    void open() =>
        pushPage(context, '${l['number']}', StudentLeaveDetail(profile: profile, id: id));
    return Card(
      key: Key('slLeave-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp2),
      child: InkWell(
        onTap: open,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      '${l['student']}',
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                  ),
                  const SizedBox(width: Tokens.sp2),
                  Flexible(child: Tag(_statusWord(s, l), color: _tint('${l['status']}'))),
                ],
              ),
              Text(
                [l['section'], l['number']].where((x) => x != null).join(' · '),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              const SizedBox(height: Tokens.sp1),
              Text('${l['leaveTypeLabel']} · ${_span(s, l)}'),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton(
                  key: Key('slOpen-$id'),
                  onPressed: open,
                  child: Text(s.slOpen),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One leave in full: the pupil, the type and days, the reason, the certificate, the approvals, and — when it waits
/// on me — Approve or Do not approve (with a note).
class StudentLeaveDetail extends ConsumerStatefulWidget {
  const StudentLeaveDetail({super.key, required this.profile, required this.id});
  final Profile profile;
  final String id;

  @override
  ConsumerState<StudentLeaveDetail> createState() => _StudentLeaveDetailState();
}

class _StudentLeaveDetailState extends ConsumerState<StudentLeaveDetail> {
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _decide(String outcome) async {
    final s = ref.read(stringsProvider);
    final note = _note.text.trim();
    if (outcome == 'rejected' && note.isEmpty) {
      setState(() => _error = s.slNeedNote);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .leaveDecide(
            id: widget.id,
            body: LeaveDecideDto(outcome: outcome, note: note.isEmpty ? null : note),
          );
      ref.read(feedRoundProvider('student-leaves').notifier).bump();
      ref.invalidate(studentLeaveProvider(widget.id));
      // the header's Approvals count and list read again
      ref.invalidate(approvalsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(outcome == 'approved' ? s.slApproved : s.slRejected)));
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final value = ref.watch(studentLeaveProvider(widget.id));
    return switch (value) {
      AsyncValue(:final value?) => ListView(
        key: const Key('slDetail'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(
            '${value['number']} · ${value['student']}',
            style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 18),
          ),
          Text(
            [value['section'], value['admissionNo']].where((x) => x != null).join(' · '),
            style: TextStyle(color: muted),
          ),
          const SizedBox(height: Tokens.sp2),
          Text(
            '${value['leaveTypeLabel']} · ${_span(s, value)}${value['long'] == true ? ' · ${s.slLong}' : ''}',
            style: const TextStyle(fontWeight: Tokens.fwSemibold),
          ),
          SectionTitle(s.slReason),
          Text('${value['reason'] ?? ''}'),
          SectionTitle(s.slCertificate),
          if (asList(value['files']).isEmpty)
            Text(s.slNoFile, style: TextStyle(color: muted))
          else
            Wrap(
              spacing: Tokens.sp2,
              children: [
                for (final (i, f) in asList(value['files']).indexed)
                  FileIcons(
                    name: 'slFile-${f['id']}',
                    label: s.slAttachment(i + 1, '${value['number']}'),
                    load: () =>
                        ref.read(apiProvider).leaveFile(id: widget.id, fileId: '${f['id']}'),
                  ),
              ],
            ),
          SectionTitle(s.slApprovals),
          for (final a in asList(value['approvals']))
            Padding(
              padding: const EdgeInsets.only(bottom: Tokens.sp1),
              child: Text('• ${s.slStep(a)}'),
            ),
          const SizedBox(height: Tokens.sp3),
          if (value['canDecide'] == true) ...[
            TextField(
              key: const Key('slNote'),
              controller: _note,
              maxLength: 500,
              maxLines: 2,
              decoration: InputDecoration(labelText: s.slNote, counterText: ''),
            ),
            if (_error != null) ErrorText(_error!),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                FilledButton(
                  key: const Key('slApprove'),
                  onPressed: _busy ? null : () => _decide('approved'),
                  child: Text(s.slApprove),
                ),
                OutlinedButton(
                  key: const Key('slReject'),
                  onPressed: _busy ? null : () => _decide('rejected'),
                  child: Text(s.slReject),
                ),
              ],
            ),
          ] else
            Align(
              alignment: Alignment.centerLeft,
              child: Tag(_statusWord(s, value), color: _tint('${value['status']}')),
            ),
        ],
      ),
      AsyncValue(:final error?) => Center(
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp5),
          child: ErrorText(errorText(s, error)),
        ),
      ),
      _ => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
    };
  }
}
